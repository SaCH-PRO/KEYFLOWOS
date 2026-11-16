import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { userCanAccessBusiness } from '../../core/auth/business.guard';
import { LEVEL_RANK, memberModuleLevel, rankOf, type CanonicalModule } from '../../core/authority/module-vocabulary';
import { KeyCortexContextService } from './key-cortex-context.service';
import { UnifiedMemoryRetrievalService } from './unified-memory-retrieval.service';
import { KeyCortexLearningService } from './key-cortex-learning.service';
import type { MemoryFragment, MemorySourceType } from './unified-memory.types';
import {
  CortexQuery,
  CortexContextSnapshot,
  CortexSession,
} from './key-cortex.types';
import { GatewayMessage } from '../ai/model-gateway.service';

/** How many memory fragments a cortex chat prompt carries. */
const PROMPT_MEMORY_FRAGMENTS = 15;
/**
 * W9-KEY-CORTEX-AUDIT review (SEC-W9KCA-2, CR-W9KCA-4): the most tool-call records the business-wide
 * stores hand UnifiedMemoryRetrievalService (it reads at most 50 rows of business_events and 50 of
 * cognitive_events), asked for on top so that leaving them out still fills the prompt's fragments.
 * W11-FLOW-PERCEPTION-SCOPE review (SEC-W11FPS-1/2): it bounds every record isPersonalKeyRecord leaves out (KEY's
 * turn records too), since all of them come from those two stores.
 * W1F-PERCEPTION-MODULE-SCOPE (SEC-W11FPS-3): and every event the reader's module scopes leave out
 * (withinModuleSight), which come from the same two stores, so the bound holds for all of them together.
 */
const TOOL_CALL_RECORD_HEADROOM = 100;
/**
 * W11-CORTEX-MEMORY-COGNITION (owner ruling D-130; CR-W10CCS-1): the most cognition-memory rows
 * UnifiedMemoryRetrievalService hands over (it reads at most 50), asked for on top so that leaving out
 * every row that is not the reader's own still fills the prompt's fragments. With
 * TOOL_CALL_RECORD_HEADROOM it is the rule the pipeline's CHAT_MEMORY_HEADROOM (150) encodes.
 */
const COGNITION_MEMORY_HEADROOM = 50;
/**
 * W11-FLOW-PERCEPTION-SCOPE (review SEC-W11MC-3, D-130): what a prompt's memory read asks for on top of the fragments
 * it renders, so that leaving out every tool-call record and every cognition row that is not the reader's own
 * (readersOwnPromptMemory) still fills it. Shared by buildMemoryContext and the /ai flow chat's perception block.
 */
export const PROMPT_MEMORY_HEADROOM = TOOL_CALL_RECORD_HEADROOM + COGNITION_MEMORY_HEADROOM;
/** The bus events of one KEY tool call (the registry's tool.*, the lifecycle's cortex.action_*). */
const TOOL_CALL_EVENT_TYPES = new Set([
  'tool.executed',
  'tool.failed',
  'tool.replayed',
  'cortex.action_executed',
  'cortex.action_failed',
]);
/**
 * W11-FLOW-PERCEPTION-SCOPE review (SEC-W11FPS-2 class): the ledger's record of one executed KEY call, whatever its subject:
 * the registry's row (subject tool_execution, after.result the tool's answer), the approval orchestrator's execution of
 * an approved proposal (subject key_action_proposal, after.executionResult), and the copies EventEmitterFlowBridgeService
 * republishes of every BusinessEventService row through the bus (business_events subject 'Tool_execution', capitalised;
 * cognitive_events of the same event type, payload the whole ledger input).
 */
const TOOL_CALL_LEDGER_EVENT_TYPES = new Set(['ACTION_EXECUTED', 'ACTION_FAILED', 'ACTION_REPLAYED']);
/**
 * Review SEC-W11FPS-2: KeyCortexActionsService.emitActionEvent's `action.<status>` (success, error, pending_approval,
 * blocked), payload.result the tool's answer; it names no entity, so its business_events row is subject KEY_CORTEX_EVENT.
 */
const ACTION_EVENT_PREFIX = 'action.';
/** The business_events subjects of one KEY tool call: the registry's ledger and bus rows, the lifecycle's (any case). */
const TOOL_CALL_SUBJECTS = new Set(['tool_execution', 'aiexecutionlog']);
/**
 * W11-FLOW-PERCEPTION-SCOPE review SEC-W11FPS-1: KEY's own records of one member's turn, which KeyCortexLifecycleService
 * publishes through the bus: cortex.turn_started carries what the member typed (rawInput, verbatim), cortex.turn_completed
 * KEY's whole answer to them (responseText), cortex.turn_failed the error; cortex.session_started and
 * cortex.command_status_changed name their session and command.
 */
const KEY_TURN_EVENT_TYPES = new Set([
  'cortex.turn_started',
  'cortex.turn_completed',
  'cortex.turn_failed',
  'cortex.session_started',
  'cortex.command_status_changed',
]);
/** The business_events subjects of KEY's own turn records (any case). */
const KEY_TURN_SUBJECTS = new Set(['keycommand', 'cortexsession']);

type RecordFragment = Pick<MemoryFragment, 'sourceType' | 'entityType' | 'title' | 'metadata'>;
const isBusinessWideEventRecord = (fragment: RecordFragment) =>
  fragment.sourceType === 'business_event' || fragment.sourceType === 'cognitive_event';
const subjectOf = (fragment: RecordFragment) =>
  fragment.sourceType === 'business_event' ? (fragment.entityType ?? '').toLowerCase() : '';

/**
 * W9-KEY-CORTEX-AUDIT review (SEC-W9KCA-2, CR-W9KCA-4): whether a business-wide memory fragment is the
 * record of one person's KEY tool call. Every registry execution writes its ACTION_* ledger row
 * (KeyCortexAuditService: after.result is the tool's answer, metadata.input its input) and its tool.*
 * bus event (persisted to business_events, subject tool_execution, and to cognitive_events, payload
 * input and answer), and the lifecycle's cortex.action_* event goes to both stores too. Those stores are
 * read business-wide, so without this another member's tool answer (a third party's message body) and
 * typed input reached a member's prompt, whose own episodic memory is narrowed to their own rows. The
 * call's own record in a person's memory is its CortexActionLog row (and AiExecutionLog row), read for
 * that member only, input values taken out.
 *
 * W11-FLOW-PERCEPTION-SCOPE review (SEC-W11FPS-2): also the legacy action route's action.<status> (the tool's answer)
 * and every ACTION_* ledger row under any subject (the approval orchestrator's, the bridge's copies), in either store.
 */
export function isToolCallRecord(fragment: RecordFragment): boolean {
  if (!isBusinessWideEventRecord(fragment)) return false;
  const type = fragment.title ?? '';
  return (
    TOOL_CALL_EVENT_TYPES.has(type) ||
    TOOL_CALL_LEDGER_EVENT_TYPES.has(type) ||
    type.startsWith(ACTION_EVENT_PREFIX) ||
    TOOL_CALL_SUBJECTS.has(subjectOf(fragment))
  );
}

/**
 * W11-FLOW-PERCEPTION-SCOPE review SEC-W11FPS-1: whether a business-wide memory fragment is KEY's own record of one
 * member's turn (KEY_TURN_EVENT_TYPES, or a business_events row of subject KeyCommand or CortexSession). What a member
 * typed is ruled private on the key-commands read route too (SEC-V109b-1: rawInput withheld); the member's own turn is
 * in their own cognition memory and session, read for them alone.
 */
export function isKeyTurnRecord(fragment: RecordFragment): boolean {
  if (!isBusinessWideEventRecord(fragment)) return false;
  return KEY_TURN_EVENT_TYPES.has(fragment.title ?? '') || KEY_TURN_SUBJECTS.has(subjectOf(fragment));
}

/**
 * W11-FLOW-PERCEPTION-SCOPE review (SEC-W11FPS-1, SEC-W11FPS-2): what no prompt takes from the business-wide stores
 * (business_events, cognitive_events), for any reader: the record of one person's KEY tool call or KEY turn. The rule of
 * every prompt's memory read: readersOwnPromptMemory (buildMemoryContext, the /ai flow chat's perception block) and the
 * pipeline's chatMemoryFragments (POST /cortex/chat).
 */
export function isPersonalKeyRecord(fragment: RecordFragment): boolean {
  return isToolCallRecord(fragment) || isKeyTurnRecord(fragment);
}

/**
 * W11-FLOW-PERCEPTION-SCOPE review CR-W11FPS-1: the stores that describe the business, not one member (every source but
 * cognition memory and the episodic AiExecutionLog and CortexActionLog). A prompt with no reader reads these by name
 * (MemoryRetrievalOptions.sourceTypes): business events stay (an overdue invoice), and no member's personal row is read.
 */
export const BUSINESS_WIDE_MEMORY_SOURCES: readonly MemorySourceType[] = [
  'ai_memory',
  'ai_memory_embedding',
  'genome_memory_event',
  'temporal_flow_memory',
  'cognitive_event',
  'conversation',
  'business_event',
];

/**
 * W1F-PERCEPTION-MODULE-SCOPE (review SEC-W11FPS-3; D-71/D-146, D-57): the words that name the module whose read scope
 * a business-wide event needs, by the module REST guards for it. The bus writes every domain event
 * EventEmitterFlowBridgeService forwards to business_events and cognitive_events, figures included: money at revenue
 * read (D-57: invoices, payments, quotes, refunds, revenue actions, the Books and the bank; payroll's committed figure
 * is a treasury figure, D-145) and at expenses read (D-146: expenses, bills, receipts, budgets), and the other modules'
 * records (crm, bookings, projects, operations, storefront, content, automations, team).
 */
const MODULE_WORDS: ReadonlyArray<readonly [CanonicalModule, readonly string[]]> = [
  [
    'revenue',
    [
      'invoice', 'invoices', 'payment', 'payments', 'revenue', 'refund', 'refunds', 'deposit', 'deposits', 'transaction',
      'transactions', 'bank', 'banking', 'reconciliation', 'quote', 'quotes', 'payout', 'payouts', 'ledger', 'journal',
      'receivable', 'receivables', 'commerce', 'finance', 'financial', 'cash', 'cashflow', 'treasury', 'charge', 'charges',
      'billing', 'payroll',
    ],
  ],
  ['expenses', ['expense', 'expenses', 'budget', 'budgets', 'bill', 'bills', 'receipt', 'receipts']],
  ['crm', ['crm', 'contact', 'contacts', 'lead', 'leads', 'deal', 'deals', 'opportunity', 'opportunities', 'outreach', 'sequence', 'sequences', 'call']],
  ['bookings', ['booking', 'bookings', 'reservation', 'reservations', 'appointment', 'appointments', 'calendar', 'meeting', 'meetings']],
  ['projects', ['project', 'projects', 'task', 'tasks', 'milestone', 'milestones']],
  [
    'operations',
    ['ticket', 'tickets', 'helpdesk', 'support', 'inbox', 'message', 'messages', 'whatsapp', 'procurement', 'purchase', 'contract', 'contracts', 'payroll'],
  ],
  ['storefront', ['product', 'products', 'catalog', 'inventory', 'stock', 'order', 'orders', 'marketplace', 'storelink', 'checkout']],
  ['content', ['campaign', 'campaigns', 'content', 'asset', 'assets', 'marketing']],
  ['automations', ['autopilot', 'automation', 'automations']],
  ['team', ['employee', 'employees', 'hr', 'candidate', 'candidates', 'recruiting']],
];
const WORD_MODULES: ReadonlyMap<string, readonly CanonicalModule[]> = (() => {
  const map = new Map<string, CanonicalModule[]>();
  for (const [module, words] of MODULE_WORDS) {
    for (const word of words) map.set(word, [...(map.get(word) ?? []), module]);
  }
  return map;
})();
/**
 * W1F-PERCEPTION-MODULE-SCOPE: a GOVERNANCE_DECISION record (the approval orchestrator's propose, approve and reject
 * rows, and their bridged copies) is a business-wide approval item, kept for every reader whatever words it carries.
 */
const BUSINESS_WIDE_EVENT_TYPES = new Set(['GOVERNANCE_DECISION']);

/** The lower-case words of an event type, subject or source: 'proactive.invoice_overdue', 'RecurringInvoice', 'key_inbox'. */
function wordsOf(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * W1F-PERCEPTION-MODULE-SCOPE (review SEC-W11FPS-3; D-71/D-146, D-57): the modules whose read scope a reader needs to
 * see a business-wide event record (business_events, cognitive_events), named by its event type, its subject (a
 * business_events row's subjectType) and its source (a cognitive_events row's sourceType): every module MODULE_WORDS
 * names for any of their words. [] is business-wide: a record that names no module, a GOVERNANCE_DECISION proposal, or
 * a fragment of another store (AiMemory facts, genome and temporal-flow memory, and the reader's own episodic rows).
 */
export function eventModulesOf(fragment: RecordFragment): CanonicalModule[] {
  if (!isBusinessWideEventRecord(fragment)) return [];
  if (BUSINESS_WIDE_EVENT_TYPES.has(fragment.title ?? '')) return [];
  const source = fragment.sourceType === 'cognitive_event' ? fragment.metadata?.sourceType : undefined;
  const subject = fragment.sourceType === 'business_event' ? fragment.entityType : undefined;
  const modules = new Set<CanonicalModule>();
  for (const word of [...wordsOf(fragment.title), ...wordsOf(subject), ...wordsOf(source)]) {
    for (const module of WORD_MODULES.get(word) ?? []) modules.add(module);
  }
  return [...modules];
}

/** W1F-PERCEPTION-MODULE-SCOPE: whether a reader may read a module (at least 'read'). */
export type ModuleSight = (module: CanonicalModule) => boolean;
/** No member, no module (as KEY's standing context gives a turn with no member no figure, PR195-KEY-GATES). */
const NO_MODULE_SIGHT: ModuleSight = () => false;

/**
 * W1F-PERCEPTION-MODULE-SCOPE (review SEC-W11FPS-3; D-71/D-146, D-57): the modules `reader` may read in `businessId`,
 * read as ModuleScopeGuard reads a membership (memberModuleLevel: its explicit permissionScopes, an array included,
 * else its role's defaults; an OWNER membership with an explicit map is bound by it, D-140). Membership is the rule
 * (D-104), as for KEY's standing context (keyContextSight): no reader, no membership (a SUPER_ADMIN who is no member,
 * a removed member), no client to read with, or a read that fails: no module (fail closed).
 */
export async function readersModuleSight(
  prisma: PrismaService | undefined,
  businessId: string,
  reader: string | null,
  logger: Pick<Logger, 'warn'> = cognitionMemoryLogger,
  logTag = 'promptMemory',
): Promise<ModuleSight> {
  if (!reader || !prisma) return NO_MODULE_SIGHT;
  try {
    const membership = await prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: reader, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (!membership) return NO_MODULE_SIGHT;
    return (module) => rankOf(memberModuleLevel(membership, module)) >= LEVEL_RANK.read;
  } catch (err: unknown) {
    logger.warn(
      `[${logTag}][${businessId}] module scope read failed, no module's events read: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NO_MODULE_SIGHT;
  }
}

/** W1F-PERCEPTION-MODULE-SCOPE: whether a reader with `sight` may see `fragment` (every module it names). */
export function withinModuleSight(fragment: RecordFragment, sight: ModuleSight): boolean {
  return eventModulesOf(fragment).every(sight);
}

const cognitionMemoryLogger = new Logger('ReadersOwnCognitionMemory');

/**
 * W10-CORTEX-CHAT-SCOPE review SEC-W10CCS-R2, shared by W11-CORTEX-MEMORY-COGNITION (owner ruling D-130):
 * which of the cognition-memory fragments among `fragments` are the reader's own rows
 * (CognitionMemory.userId, in this business). CognitionMemory is a per-member store (what a member typed,
 * verbatim, and KEY's whole answer to them, which can carry P&L figures another member may not see under
 * D-57) that UnifiedMemoryRetrievalService reads business-wide. A fragment does not carry its row's member,
 * so the rows are read by id. No reader, or no cognition fragment: none, and nothing is read. A row with no
 * member (KEY's own tool-outcome and action-outcome learning rows, a record of someone's tool call) is
 * nobody's own. A read that fails, or no client to read with: none (fail closed).
 *
 * Both prompt paths of POST /cortex/chat keep a cognition fragment only when its id is in this set: the
 * pipeline's chatMemoryFragments and KeyCortexPromptContextService.buildMemoryContext.
 */
export async function readersOwnCognitionMemory(
  prisma: PrismaService | undefined,
  businessId: string,
  reader: string | null,
  fragments: ReadonlyArray<Pick<MemoryFragment, 'id' | 'sourceType'>>,
  logger: Pick<Logger, 'warn'> = cognitionMemoryLogger,
  logTag = 'cognitionMemory',
): Promise<Set<string>> {
  const ids = fragments.filter((fragment) => fragment.sourceType === 'cognition_memory').map((fragment) => fragment.id);
  if (!reader || ids.length === 0 || !prisma) return new Set();
  try {
    const rows = await prisma.client.cognitionMemory.findMany({
      where: { id: { in: ids }, businessId, userId: reader },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  } catch (err: unknown) {
    logger.warn(
      `[${logTag}][${businessId}] cognition memory owner check failed, none of it read: ${err instanceof Error ? err.message : String(err)}`,
    );
    return new Set();
  }
}

/**
 * W9-KEY-CORTEX-AUDIT, shared by W11-FLOW-PERCEPTION-SCOPE (review SEC-W11MC-3, D-130): the member whose own memory a
 * prompt may read. The requester when they own the business or hold a membership in it (BusinessGuard's own predicate,
 * userCanAccessBusiness), else nobody. No user (a turn that names no member: the Chatwoot support desk, the staff
 * bridge), a user who is no member (a platform SUPER_ADMIN passes BusinessGuard without one; a removed member), no
 * client to check with, or a check that cannot be made: nobody, so no per-member memory is read (fail closed).
 */
export async function promptMemoryReader(
  prisma: PrismaService | undefined,
  businessId: string,
  userId: string | null | undefined,
  logger: Pick<Logger, 'warn'> = cognitionMemoryLogger,
  logTag = 'promptMemory',
): Promise<string | null> {
  if (!userId || !prisma) return null;
  try {
    return (await userCanAccessBusiness(prisma, userId, businessId)) ? userId : null;
  } catch (err: unknown) {
    logger.warn(
      `[${logTag}][${businessId}] membership check failed, no episodic memory read: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * W11-FLOW-PERCEPTION-SCOPE (review SEC-W11MC-3, D-130): the fragments of a business-wide memory read that may render
 * into `reader`'s prompt, at most `limit` of them, in the order read. No KEY tool call's or KEY turn's record from the
 * business-wide stores (isPersonalKeyRecord: another member's tool answer, typed input, typed chat and KEY's answer to
 * them; a call is in its member's own episodic rows, a turn in their own cognition memory; review SEC-W11FPS-1/2), and
 * a cognition fragment only when its row is the reader's own (readersOwnCognitionMemory; a member-less row is nobody's
 * own, and no reader reads none). The read is expected to have asked for `limit` plus PROMPT_MEMORY_HEADROOM.
 *
 * W1F-PERCEPTION-MODULE-SCOPE (review SEC-W11FPS-3; D-71/D-146, D-57): and a business-wide event only when the reader
 * may read every module it names (withinModuleSight, by readersModuleSight: their membership's module levels; no
 * reader has none). An owner's expense, a Stripe payment or an invoice total no longer reaches a member whose expenses
 * or revenue scope is none, nor a turn with no reader; a GOVERNANCE_DECISION proposal and a record that names no module
 * stay business-wide. The membership is read only when an event names a module.
 *
 * The one rule of KeyCortexPromptContextService.buildMemoryContext and the pipeline's chatMemoryFragments (POST
 * /cortex/chat and its stream) and of FlowOrchestratorService.buildPerceptionSection (POST
 * /ai/businesses/:id/flow/chat and its stream, the staff bridge).
 */
export async function readersOwnPromptMemory<F extends Pick<MemoryFragment, 'id' | 'sourceType' | 'entityType' | 'title' | 'metadata'>>(
  prisma: PrismaService | undefined,
  businessId: string,
  reader: string | null,
  fragments: ReadonlyArray<F>,
  limit: number,
  logger: Pick<Logger, 'warn'> = cognitionMemoryLogger,
  logTag = 'promptMemory',
): Promise<F[]> {
  const withoutKeyRecords = fragments.filter((fragment) => !isPersonalKeyRecord(fragment));
  const namesAModule = withoutKeyRecords.some((fragment) => eventModulesOf(fragment).length > 0);
  const [sight, own] = await Promise.all([
    namesAModule ? readersModuleSight(prisma, businessId, reader, logger, logTag) : Promise.resolve(NO_MODULE_SIGHT),
    readersOwnCognitionMemory(prisma, businessId, reader, withoutKeyRecords, logger, logTag),
  ]);
  return withoutKeyRecords
    .filter((fragment) => withinModuleSight(fragment, sight))
    .filter((fragment) => fragment.sourceType !== 'cognition_memory' || own.has(fragment.id))
    .slice(0, limit);
}

/**
 * KeyCortexPromptContextService
 *
 * Builds the message array and contextual memory blocks for the LLM prompt.
 */
@Injectable()
export class KeyCortexPromptContextService {
  private readonly logger = new Logger(KeyCortexPromptContextService.name);

  constructor(
    private readonly contextService: KeyCortexContextService,
    @Optional()
    @Inject(UnifiedMemoryRetrievalService)
    private readonly unifiedMemory?: UnifiedMemoryRetrievalService,
    @Optional()
    @Inject(KeyCortexLearningService)
    private readonly learningService?: KeyCortexLearningService,
    // W9-KEY-CORTEX-AUDIT: reads whether the session's user is a member of the business
    // (episodicMemoryReader). Without it no episodic memory is read (fail closed).
    @Optional()
    @Inject(PrismaService)
    private readonly prisma?: PrismaService,
  ) {}

  /**
   * Build the message array for the model gateway.
   */
  buildMessages(
    query: CortexQuery,
    context: CortexContextSnapshot,
    systemPrompt: string,
    session?: CortexSession,
    memoryContext?: {
      runningSummary?: string;
      aiMemory?: string;
      semanticMemory?: string;
      lessons?: string;
    },
  ): GatewayMessage[] {
    const messages: GatewayMessage[] = [];

    messages.push({
      role: 'system',
      content: systemPrompt,
    });

    const runningSummary = memoryContext?.runningSummary ?? session?.runningSummary;
    if (runningSummary) {
      messages.push({
        role: 'system',
        content: `=== CONVERSATION SUMMARY ===\n${runningSummary}\n===========================`,
      });
    }

    if (memoryContext?.aiMemory) {
      messages.push({
        role: 'system',
        content: memoryContext.aiMemory,
      });
    }

    if (memoryContext?.semanticMemory) {
      messages.push({
        role: 'system',
        content: memoryContext.semanticMemory,
      });
    }

    if (memoryContext?.lessons) {
      messages.push({
        role: 'system',
        content: memoryContext.lessons,
      });
    }

    const contextSummary = this.contextService.formatContextForPrompt(context);
    messages.push({
      role: 'system',
      content: contextSummary,
    });

    if (session && session.messages.length > 0) {
      const recentMessages = session.messages.slice(-10);
      for (const msg of recentMessages) {
        messages.push({
          role: msg.role === 'action_result' ? 'system' : msg.role,
          content: msg.content,
        });
      }
    }

    messages.push({
      role: 'user',
      content: query.text,
    });

    return messages;
  }

  /**
   * Build contextual memory block for the LLM prompt.
   *
   * W11-CORTEX-MEMORY-COGNITION review SEC-W11MC-1 (owner ruling D-130): `requesterId` is the member the turn is
   * read for (the pipeline's query.userId, the id chatMemoryFragments reads the same prompt's memory for), not the
   * member the session names: the WS key:chat handler hands the pipeline the client's session id unchecked, and
   * getOrCreateSession loads any session by id. No requester reads no per-member memory (fail closed).
   */
  async buildMemoryContext(
    businessId: string,
    session: CortexSession,
    requesterId: string | undefined,
  ): Promise<{
    runningSummary?: string;
    aiMemory?: string;
    semanticMemory?: string;
    lessons?: string;
  }> {
    const memoryContext: {
      runningSummary?: string;
      aiMemory?: string;
      semanticMemory?: string;
      lessons?: string;
    } = {};

    if (session.runningSummary) {
      memoryContext.runningSummary = session.runningSummary;
    }

    const currentQuery =
      session.messages.length > 0
        ? session.messages[session.messages.length - 1]?.content ?? ''
        : '';

    // W11-CORTEX-MEMORY-COGNITION (owner ruling D-130): the member this prompt is read for, once, for both
    // blocks below (the memory fragments and the learned lessons). Nobody when the requester is no member
    // of the business (W9-KEY-CORTEX-AUDIT, D-104 membership-only).
    // Review SEC-W11MC-1 (D-130): the requester, never session.userId: a turn on another member's session
    // reads the requester's own memory and lessons, as chatMemoryFragments does for the same prompt.
    const reader =
      this.unifiedMemory || this.learningService
        ? await this.episodicMemoryReader(businessId, requesterId)
        : null;

    if (this.unifiedMemory) {
      try {
        // W9-KEY-CORTEX-AUDIT: this block renders into one person's prompt, so its episodic memory
        // (AiExecutionLog and CortexActionLog rows: what someone asked KEY to do, tool answers
        // included) is that member's own (MemoryRetrievalOptions.userId), never every member's. A
        // session that names no member of the business reads none at all (fail closed). The
        // business-wide stores are not narrowed by member.
        //
        // Review SEC-W9KCA-2 / CR-W9KCA-4: but no tool call's record is taken from them
        // (isToolCallRecord): a call is in its member's own episodic rows. The headroom keeps the
        // prompt's fragment count when records are left out.
        //
        // W11-CORTEX-MEMORY-COGNITION (owner ruling D-130, SEC-W10CCS-R2 residual): a cognition-memory
        // fragment (what a member typed and KEY's answer to them) is kept only when its row is the
        // reader's own (readersOwnCognitionMemory, the pipeline's chatMemoryFragments rule); a member-less
        // row is nobody's own, and a reader who is no member reads none. The cognition headroom keeps the
        // fragment count when another member's rows are left out (CR-W10CCS-1).
        //
        // W11-FLOW-PERCEPTION-SCOPE (SEC-W11MC-3): both rules and the headroom are readersOwnPromptMemory and
        // PROMPT_MEMORY_HEADROOM, which the /ai flow chat's perception block keeps too.
        const fragments = await this.unifiedMemory.retrieveContext(businessId, {
          query: currentQuery,
          limit: PROMPT_MEMORY_FRAGMENTS + PROMPT_MEMORY_HEADROOM,
          ...(reader ? { userId: reader } : { includeEpisodic: false }),
        });
        const kept = await readersOwnPromptMemory(
          this.prisma,
          businessId,
          reader,
          fragments,
          PROMPT_MEMORY_FRAGMENTS,
          this.logger,
          'buildMemoryContext',
        );

        if (kept.length > 0) {
          memoryContext.aiMemory = this.formatUnifiedMemory(kept);
        }
      } catch (err: any) {
        this.logger.warn(
          `[buildMemoryContext] Unified memory retrieval failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // W11-CORTEX-MEMORY-COGNITION, owner ruling D-130 option (A): the learned-lessons block carries only
    // lessons from the reader's own conversations (retrieveLessons' userId: their CognitionMemory rows);
    // another member's lessons and a member-less row's are not shown. A session that names no member of
    // the business reads no lessons at all (fail closed).
    if (this.learningService && reader) {
      try {
        const lessons = await this.learningService.retrieveLessons(
          businessId,
          currentQuery,
          {
            roleId: session.detectedRole,
            functionId: session.detectedFunction,
            limit: 3,
            userId: reader,
          },
        );
        if (lessons.length > 0) {
          memoryContext.lessons =
            '=== LEARNED LESSONS ===\n' +
            lessons.map((l: string, i: number) => `${i + 1}. ${l}`).join('\n') +
            '\n========================';
        }
      } catch (err: any) {
        this.logger.warn(
          `[buildMemoryContext] Lesson retrieval failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return memoryContext;
  }

  /**
   * W9-KEY-CORTEX-AUDIT: the member whose episodic memory a prompt may read: the requester (review
   * SEC-W11MC-1: not the session's user) when they own the business or hold a membership in it
   * (BusinessGuard's own predicate, userCanAccessBusiness), else nobody. No user, a user who is no member
   * (a platform SUPER_ADMIN passes BusinessGuard without one; a removed member), or a check that cannot
   * be made: nobody, so no episodic memory is read. W11-FLOW-PERCEPTION-SCOPE: promptMemoryReader, shared
   * with the /ai flow chat's perception block.
   */
  private episodicMemoryReader(businessId: string, userId: string | undefined): Promise<string | null> {
    return promptMemoryReader(this.prisma, businessId, userId, this.logger, 'buildMemoryContext');
  }

  formatUnifiedMemory(fragments: any[]): string {
    const lines = [
      '=== RELEVANT MEMORY ===',
      ...fragments.map(
        (f, i) =>
          `${i + 1}. [${f.sourceType}] ${(f.title ?? 'memory').replace(/\n/g, ' ')}: ${(f.content ?? '').toString().slice(0, 250)}`,
      ),
      '========================',
    ];
    return lines.join('\n');
  }
}
