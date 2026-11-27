import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { userCanAccessBusiness } from '../../core/auth/business.guard';
import { LEVEL_RANK, memberModuleLevel, rankOf, type CanonicalModule } from '../../core/authority/module-vocabulary';
import { KeyCortexContextService } from './key-cortex-context.service';
import { UnifiedMemoryRetrievalService } from './unified-memory-retrieval.service';
import { KeyCortexLearningService } from './key-cortex-learning.service';
import { GENOME_ROW_METADATA_KEY } from './unified-memory.types';
import { DOCUMENT_EXTRACTION_CATEGORY } from '../ai/ai-memory.service';
import type { MemoryFragment, MemorySourceType } from './unified-memory.types';
import { financialProposalsWithProvenance, isFinancialProposal, isMoneyLabel, isMoneyMemoryEvent, PROPOSAL_CLASSIFY_SELECT, proposalTextStatesMoney, type ProposalFields } from '../business-genome/key-genome/genome-finance-scope';
import {
  CortexQuery,
  CortexContextSnapshot,
  CortexSession,
} from './key-cortex.types';
import { GatewayMessage } from '../ai/model-gateway.service';
import { readerSearchOptions } from '../ai/semantic-memory-sight';

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

/**
 * W1F-PERCEPTION-MODULE-SCOPE review (COR-W1FPMS-1): `content` is read for a cognitive event's payload, which
 * UnifiedMemoryRetrievalService renders as `${eventType}: ${JSON.stringify(payload)}` (a task names its type there).
 */
type RecordFragment = Pick<MemoryFragment, 'sourceType' | 'entityType' | 'title' | 'metadata'> & Partial<Pick<MemoryFragment, 'content'>>;
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
 * W1F-PERCEPTION-MODULE-SCOPE review (SEC-W1FPMS-1): every module a business-wide event can name. A record that names
 * none of them, and is no GOVERNANCE_DECISION record, needs read on all of them (eventModulesOf fails closed): a type
 * nobody classified reaches only a reader who may read any module's event (an OWNER or an ADMIN on role defaults),
 * never one whose expenses or revenue scope is none.
 */
export const EVENT_MODULES: readonly CanonicalModule[] = [
  'revenue', 'expenses', 'crm', 'bookings', 'projects', 'operations', 'storefront', 'content', 'automations', 'team',
];

/**
 * W1F-PERCEPTION-MODULE-SCOPE (review SEC-W11FPS-3; D-71/D-146, D-57): the words that name the module whose read scope
 * a business-wide event needs, by the module its data belongs to. The bus writes every domain event
 * EventEmitterFlowBridgeService forwards to business_events and cognitive_events, figures included: money at revenue
 * read (D-57: invoices, payments, quotes, refunds, revenue actions, the Books and the bank; payroll's committed figure
 * is a treasury figure, D-145) and at expenses read (D-146: expenses, bills, receipts, budgets), and the other modules'
 * records. Where a route serves the data behind ModuleScopeGuard the module is the one it requires; the bookings,
 * helpdesk, catalog and task-assignment routes carry no ModuleScopeGuard (review COR-W1FPMS-1), so their events take the
 * module their data belongs to (bookings, operations, storefront, and a task's own type).
 *
 * Review SEC-W1FPMS-1: the families that named no module, and so were business-wide, are classified here. A document's
 * extraction, a Drive file and an ingestion item carry what was read off an invoice or a receipt
 * (DocumentIntelligenceService.extractFromDocument emits the whole result as document.extracted, the Drive intake
 * re-emits it as file.uploaded and ingestion.item.received, PaymentEvidenceService reads bank slips through it): revenue
 * and expenses. A vendor is expenses (D-146); a medical claim and its coding are money owed (revenue). The words in
 * FULL_SIGHT_WORDS name records that can carry any module's data and that no single module governs (a genome or inbox
 * signal, a risk, a reminder or a deadline about anything, a board resolution): they need every module, as a record
 * nobody classified does. The census in key-cortex-prompt-module-scope.spec.ts walks every bridge family and every KEY
 * bus type and fails on one that classifies as nothing.
 */
const MONEY_DOCUMENT_WORDS = ['document', 'documents', 'doc', 'docs', 'file', 'files', 'ingestion', 'extracted', 'extraction'];
const FULL_SIGHT_WORDS = ['signal', 'signals', 'risk', 'risks', 'reminder', 'reminders', 'deadline', 'deadlines', 'board', 'resolution', 'resolutions'];
const MODULE_WORDS: ReadonlyArray<readonly [CanonicalModule, readonly string[]]> = [
  [
    'revenue',
    [
      'invoice', 'invoices', 'payment', 'payments', 'revenue', 'refund', 'refunds', 'deposit', 'deposits', 'transaction',
      'transactions', 'bank', 'banking', 'reconciliation', 'quote', 'quotes', 'payout', 'payouts', 'ledger', 'journal',
      'receivable', 'receivables', 'commerce', 'finance', 'financial', 'cash', 'cashflow', 'treasury', 'charge', 'charges',
      'billing', 'payroll', 'claim', 'claims', 'coding', 'medical', ...MONEY_DOCUMENT_WORDS,
    ],
  ],
  ['expenses', ['expense', 'expenses', 'budget', 'budgets', 'bill', 'bills', 'receipt', 'receipts', 'vendor', 'vendors', ...MONEY_DOCUMENT_WORDS]],
  [
    'crm',
    ['crm', 'contact', 'contacts', 'lead', 'leads', 'deal', 'deals', 'opportunity', 'opportunities', 'outreach', 'sequence', 'sequences', 'call', 'demo', 'demos'],
  ],
  [
    'bookings',
    ['booking', 'bookings', 'reservation', 'reservations', 'appointment', 'appointments', 'calendar', 'meeting', 'meetings', 'guest', 'guests', 'visitor', 'visitors'],
  ],
  // Review COR-W1FPMS-1: not 'task' or 'tasks'; a task is filed by its own type (taskModulesOf), and a call log's source
  // 'call_tasks' is the CRM's.
  ['projects', ['project', 'projects', 'milestone', 'milestones', 'bug', 'bugs', 'qa']],
  [
    'operations',
    [
      'ticket', 'tickets', 'helpdesk', 'support', 'inbox', 'message', 'messages', 'whatsapp', 'procurement', 'purchase', 'contract',
      'contracts', 'payroll', 'delivery', 'deliveries', 'communications', 'sentiment', 'legal', 'it', 'restaurant', 'shift', 'shifts',
      'dispatch', 'technician', 'technicians',
    ],
  ],
  ['storefront', ['product', 'products', 'catalog', 'inventory', 'stock', 'order', 'orders', 'marketplace', 'storelink', 'storefront', 'checkout']],
  ['content', ['campaign', 'campaigns', 'content', 'asset', 'assets', 'marketing', 'social', 'mention', 'mentions', 'media', 'audio', 'video', 'design']],
  ['automations', ['autopilot', 'automation', 'automations']],
  [
    'team',
    ['employee', 'employees', 'hr', 'candidate', 'candidates', 'recruiting', 'user', 'users', 'onboarding', 'application', 'applications', 'training', 'course', 'courses'],
  ],
  ...EVENT_MODULES.map((module) => [module, FULL_SIGHT_WORDS] as const),
];
const WORD_MODULES: ReadonlyMap<string, readonly CanonicalModule[]> = (() => {
  const map = new Map<string, CanonicalModule[]>();
  for (const [module, words] of MODULE_WORDS) {
    for (const word of words) if (!map.get(word)?.includes(module)) map.set(word, [...(map.get(word) ?? []), module]);
  }
  return map;
})();
/**
 * Review SEC-W1FPMS-1: compound names whose words alone name nothing, matched whole (lower-case) on an event type's
 * family (its first segment), a subject or a source: the bridge's check_in.* (subject CheckIn, source front_desk),
 * field_service.* (FieldService, field_service), and a flow run.
 */
const FAMILY_MODULES: ReadonlyMap<string, readonly CanonicalModule[]> = new Map<string, readonly CanonicalModule[]>([
  ['check_in', ['bookings']],
  ['checkin', ['bookings']],
  ['front_desk', ['bookings']],
  ['field_service', ['operations']],
  ['fieldservice', ['operations']],
  ['flow_run', ['automations']],
]);
/**
 * W1F-PERCEPTION-MODULE-SCOPE: a GOVERNANCE_DECISION record (the approval orchestrator's propose, approve and reject
 * rows, and their bridged copies) is a business-wide approval item, kept for every reader whatever words it carries.
 * The only business-wide event record: anything else names a module or fails closed (review SEC-W1FPMS-1).
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

/** Review SEC-W1FPMS-1: an event type, subject or source whole and its first dot segment, lower-case ('check_in.completed'). */
function familiesOf(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  const whole = value.toLowerCase();
  return [whole, whole.split('.')[0]];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Review COR-W1FPMS-1: the payload of a business-wide event record. A business_events row the bus wrote carries it as
 * `after` (KeyCortexEventBusService.persistAudit); a cognitive_events row's payload is carried in its fragment's
 * metadata.payload (UnifiedMemoryRetrievalService). Unreadable: none.
 * FU-KEY-MEMORY-MONEY-SIGHT (COR-W1FPMS-1 follow-up): read from the carried payload, never parsed back out of the
 * rendered content (`${eventType}: ${JSON.stringify(payload)}`): a fragment that carries none has none, and a task
 * record with none fails closed (taskModulesOf: every module a task can be filed under).
 */
function eventPayloadOf(fragment: RecordFragment): Record<string, unknown> | undefined {
  const payload = fragment.sourceType === 'business_event' ? fragment.metadata?.after : fragment.metadata?.payload;
  return isPlainObject(payload) ? payload : undefined;
}

/** Review COR-W1FPMS-1: TaskAssignmentService's task types and the module each is served under. */
const TASK_TYPE_MODULES: Readonly<Record<string, CanonicalModule>> = {
  ContactTask: 'crm',
  ProjectTask: 'projects',
  AutopilotTask: 'automations',
};

/**
 * Review COR-W1FPMS-1: the modules of a task record (stored type task.*: the bridge strips 'tasks.' and 'autopilot.',
 * so an autopilot task is stored as task.created, subject Task, source task_assignments). By the task's own type when
 * the payload names one (TaskAssignmentService's task.assigned / task.unassigned): a ContactTask at crm, a ProjectTask at
 * projects, an AutopilotTask at automations, any other type at every module. The delegation loop's own events
 * (autopilot.task.created / auto_executed: a category or loopType, no taskType) at automations. A record that names no
 * task type (task.transferred, which can move any) at every module a task can be filed under. null: not a task record.
 */
function taskModulesOf(fragment: RecordFragment): readonly CanonicalModule[] | null {
  if (!/^tasks?\./.test(fragment.title ?? '')) return null;
  const payload = eventPayloadOf(fragment);
  const nested = isPlainObject(payload?.metadata) ? payload.metadata : undefined;
  const ledgerMeta = isPlainObject(fragment.metadata?.metadata) ? fragment.metadata.metadata : undefined;
  const taskType = payload?.taskType ?? nested?.taskType ?? ledgerMeta?.taskType;
  if (typeof taskType === 'string') {
    const module = Object.prototype.hasOwnProperty.call(TASK_TYPE_MODULES, taskType) ? TASK_TYPE_MODULES[taskType] : undefined;
    return module ? [module] : EVENT_MODULES;
  }
  if (payload && (typeof payload.loopType === 'string' || typeof payload.category === 'string')) return ['automations'];
  return Object.values(TASK_TYPE_MODULES);
}

/**
 * W1F-PERCEPTION-MODULE-SCOPE (review SEC-W11FPS-3; D-71/D-146, D-57): the modules whose read scope a reader needs to
 * see a business-wide event record (business_events, cognitive_events), named by its event type, its subject (a
 * business_events row's subjectType) and its source (a cognitive_events row's sourceType): every module MODULE_WORDS
 * and FAMILY_MODULES name for them, and a task's by its own type (taskModulesOf). [] for a GOVERNANCE_DECISION record
 * (business-wide) and for a fragment of another store (AiMemory facts, genome and temporal-flow memory, and the reader's
 * own episodic rows).
 *
 * Review SEC-W1FPMS-1: a record that names no module needs read on every module an event can name (EVENT_MODULES). It
 * used to be business-wide, so a type nobody classified failed open: a receipt's extracted totals (document.extracted)
 * reached a member whose expenses and revenue scopes are none.
 */
export function eventModulesOf(fragment: RecordFragment): CanonicalModule[] {
  if (!isBusinessWideEventRecord(fragment)) return [];
  if (BUSINESS_WIDE_EVENT_TYPES.has(fragment.title ?? '')) return [];
  const source = fragment.sourceType === 'cognitive_event' ? fragment.metadata?.sourceType : undefined;
  const subject = fragment.sourceType === 'business_event' ? fragment.entityType : undefined;
  const modules = new Set<CanonicalModule>();
  const add = (list: readonly CanonicalModule[] | null | undefined) => {
    for (const module of list ?? []) modules.add(module);
  };
  for (const value of [fragment.title, subject, source]) {
    for (const family of familiesOf(value)) add(FAMILY_MODULES.get(family));
    for (const word of wordsOf(value)) add(WORD_MODULES.get(word));
  }
  add(taskModulesOf(fragment));
  return modules.size ? [...modules] : [...EVENT_MODULES];
}

/**
 * MEM-SEMANTIC-SIGHT (D-234, D-257): the modules the names `values` name (an entity type, a source module, an event's
 * type, source or module column), by the same words and families eventModulesOf reads an event record by. [] when they
 * name none: the caller decides what an unclassified source needs (a semantic hit's fails closed).
 */
export function modulesNamedBy(...values: unknown[]): CanonicalModule[] {
  const modules = new Set<CanonicalModule>();
  for (const value of values) {
    for (const family of familiesOf(value)) for (const module of FAMILY_MODULES.get(family) ?? []) modules.add(module);
    for (const word of wordsOf(value)) for (const module of WORD_MODULES.get(word) ?? []) modules.add(module);
  }
  return [...modules];
}

/** W1F-PERCEPTION-MODULE-SCOPE: whether a reader may read a module (at least 'read'). */
export type ModuleSight = (module: CanonicalModule) => boolean;
/** No member, no module (as KEY's standing context gives a turn with no member no figure, PR195-KEY-GATES). */
export const NO_MODULE_SIGHT: ModuleSight = () => false;
/**
 * W1F-PERCEPTION-MODULE-SCOPE review (SEC-W1FPMS-2, COR-W1FPMS-2): the sight of a turn whose modules were resolved
 * elsewhere (a staff position's, JobRolePolicyService.perceptionForPosition): exactly the modules named.
 */
export function moduleSightOf(modules: readonly string[]): ModuleSight {
  const named = new Set(modules);
  return (module) => named.has(module);
}

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
  if (!reader) return NO_MODULE_SIGHT;
  if (!prisma) {
    // MEM-DOC-EXTRACTION-SIGHT orchestrator review (COR-MDX-2): a service built without its database client reads no
    // membership, so its reader sees no module (fail closed). Said loudly: it is a wiring fault, not a member's scope.
    logger.warn(`[${logTag}][${businessId}] no database client: no membership read, the reader sees no module (wiring fault)`);
    return NO_MODULE_SIGHT;
  }
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

/**
 * FU-KEY-MEMORY-MONEY-SIGHT (review SEC-W1FPMS-3): the GenomeMemoryEvent row a genome fragment carries
 * (GENOME_ROW_METADATA_KEY, written by UnifiedMemoryRetrievalService after the row's own metadata). undefined for a
 * fragment of another store, and for a genome fragment that carries none.
 */
function genomeRowOf(fragment: RecordFragment): Record<string, unknown> | undefined {
  if (fragment.sourceType !== 'genome_memory_event') return undefined;
  const row = fragment.metadata?.[GENOME_ROW_METADATA_KEY];
  return isPlainObject(row) ? row : undefined;
}

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * FU-KEY-MEMORY-MONEY-SIGHT (review SEC-W1FPMS-3; D-128, D-100): the modules a reader needs to see a genome memory
 * record. The genome's money memory events (isMoneyMemoryEvent, the rule its REST routes withhold them by: a
 * FINANCE_GENOME or finance-filed row, a CROSS_DOMAIN row, the customer-sales snapshot) need revenue read; a genome
 * fragment that carries no row is read as money (fail closed); any other genome record stays business-wide ([]).
 * [] for a fragment of another store.
 */
export function genomeModulesOf(fragment: RecordFragment): CanonicalModule[] {
  if (fragment.sourceType !== 'genome_memory_event') return [];
  const row = genomeRowOf(fragment);
  if (!row) return ['revenue'];
  return isMoneyMemoryEvent({
    sourceType: stringOrNull(row.sourceType),
    eventType: stringOrNull(row.eventType),
    domain: stringOrNull(row.domain),
    section: stringOrNull(row.section),
    // D-238: a proposal outcome event is classified by the proposal fields its own metadata carries, and its title.
    metadata: fragment.metadata,
    title: fragment.title ?? null,
  })
    ? ['revenue']
    : [];
}

/**
 * MEM-DOC-EXTRACTION-SIGHT (D-234 fail closed, D-257): whether a fragment renders a document extraction (an AiMemory row
 * of DOCUMENT_EXTRACTION_CATEGORY, whose provenance is unknown): the row itself (UnifiedMemoryRetrievalService titles an
 * AiMemory fragment with its category and starts its content with `<category>.`), or a semantic copy of one (the
 * backfill's entry form, `<category>: <key> = <value>` with the row's category in its metadata, or the writer's value
 * form, with the row's category as its metadata's `type`).
 */
export function isDocumentExtractionFragment(fragment: Pick<MemoryFragment, 'sourceType' | 'title' | 'metadata'> & Partial<Pick<MemoryFragment, 'content'>>): boolean {
  const content = typeof fragment.content === 'string' ? fragment.content : '';
  if (fragment.sourceType === 'ai_memory') {
    return fragment.title === DOCUMENT_EXTRACTION_CATEGORY || content.startsWith(`${DOCUMENT_EXTRACTION_CATEGORY}.`);
  }
  if (fragment.sourceType === 'ai_memory_embedding') {
    const meta = fragment.metadata;
    return (
      meta?.category === DOCUMENT_EXTRACTION_CATEGORY ||
      meta?.type === DOCUMENT_EXTRACTION_CATEGORY ||
      content.startsWith(`${DOCUMENT_EXTRACTION_CATEGORY}: `)
    );
  }
  return false;
}

/**
 * MEM-DOC-EXTRACTION-SIGHT (D-234): whether a prompt's memory read may take the document extractions
 * (MemoryRetrievalOptions.documentExtractions): only for a member reader who may read revenue; never a turn with no
 * member reader (a contact-only position, a SUPER_ADMIN who is no member), whatever its sight.
 */
export function readsDocumentExtractions(sight: ModuleSight, reader: string | null): boolean {
  return reader !== null && sight('revenue');
}

/**
 * FU-KEY-MEMORY-MONEY-SIGHT: the modules a reader needs to see any memory record a prompt renders: a business-wide
 * event's (eventModulesOf) or a genome record's (genomeModulesOf); [] for the other stores.
 * MEM-DOC-EXTRACTION-SIGHT (D-234): a document extraction, or a copy of one, needs revenue read (fail closed).
 */
export function recordModulesOf(fragment: RecordFragment): CanonicalModule[] {
  if (isDocumentExtractionFragment(fragment)) return ['revenue'];
  return fragment.sourceType === 'genome_memory_event' ? genomeModulesOf(fragment) : eventModulesOf(fragment);
}

/**
 * W1F-PERCEPTION-MODULE-SCOPE: whether a reader with `sight` may see `fragment` (every module it names).
 * FU-KEY-MEMORY-MONEY-SIGHT (SEC-W1FPMS-3): a genome money memory event names revenue (recordModulesOf).
 */
export function withinModuleSight(fragment: RecordFragment, sight: ModuleSight): boolean {
  return recordModulesOf(fragment).every(sight);
}

/**
 * FU-KEY-MEMORY-MONEY-SIGHT (review SEC-W1FPMS-4): the genome sources that record a KEY proposal (OutcomeLearningService's
 * record of a proposal's outcome is titled with the proposal's own title).
 */
const PROPOSAL_GENOME_SOURCES = new Set(['KEY_ACTION_PROPOSAL', 'GOVERNANCE_DECISION']);
/** A value a memberless turn's proposal line renders: one plain word (an action, a status, a risk level), never a figure. */
const PROPOSAL_WORD = /^[A-Za-z][A-Za-z_]{0,39}$/;
const proposalWord = (value: unknown): string | undefined =>
  typeof value === 'string' && PROPOSAL_WORD.test(value) ? value : undefined;

/**
 * FU-KEY-MEMORY-MONEY-SIGHT (review SEC-W1FPMS-4): whether a fragment is the record of a KEY proposal: a
 * GOVERNANCE_DECISION record of either business-wide event store (the approval orchestrator's ledger row and its bridged
 * copies), or a genome record of a proposal.
 */
export function isProposalRecord(fragment: RecordFragment): boolean {
  if (isBusinessWideEventRecord(fragment)) return BUSINESS_WIDE_EVENT_TYPES.has(fragment.title ?? '');
  const row = genomeRowOf(fragment);
  return typeof row?.sourceType === 'string' && PROPOSAL_GENOME_SOURCES.has(row.sourceType);
}

/**
 * FU-KEY-MEMORY-MONEY-SIGHT (review SEC-W1FPMS-4; D-73/D-93: no member, no figure): what a memberless turn (a
 * contact-only position on the staff bridge, a SUPER_ADMIN who is no member, a removed member) renders of a proposal
 * record: its action, status and risk level, each only when it is one plain word, and nothing else. GOVERNANCE_DECISION
 * proposals stay business-wide, but their bridged copies carry the proposal's title (the Pro Auto monitor writes
 * '$12,345 outstanding across 7 invoices'), and a rejection its reason and the rejecter. The action and state are read
 * from the ledger row (its action column and `after`) or, for a bridged copy, from the ledger input it carries (its
 * action and `after`); a genome record of a proposal renders its event type. The fragment keeps its id, store, title
 * (the event type) and subject; its content and metadata are replaced.
 */
export function memberlessProposalView<F extends RecordFragment>(fragment: F): F {
  if (fragment.sourceType === 'genome_memory_event') {
    const action = proposalWord(genomeRowOf(fragment)?.eventType);
    return { ...fragment, title: action ?? 'KEY_ACTION_PROPOSAL', content: `proposal ${action ?? 'recorded'}`, metadata: { action } };
  }
  const payload = eventPayloadOf(fragment);
  // A bridged copy carries the whole ledger input (BusinessEventService.emit's): its own action and `after`.
  const copied = payload?.eventType === 'GOVERNANCE_DECISION' && isPlainObject(payload.after) ? payload : undefined;
  const state = copied ? (copied.after as Record<string, unknown>) : payload;
  const action = proposalWord(copied ? copied.action : fragment.sourceType === 'business_event' ? fragment.metadata?.action : payload?.action);
  const status = proposalWord(state?.status);
  const riskLevel = proposalWord(state?.riskLevel);
  const parts = [`proposal ${action ?? 'recorded'}`];
  if (status) parts.push(`status ${status}`);
  if (riskLevel) parts.push(`risk ${riskLevel}`);
  return { ...fragment, content: parts.join(', '), metadata: { action, status, riskLevel } };
}

/**
 * D-238: the ids a proposal record may name its KEY proposal by: its own subject (the ledger row, a genome outcome) and
 * the ledger input's subject, proposal and approval ids (a bridged or cognitive copy). The first that resolves is used.
 */
function proposalIdsOf(fragment: RecordFragment): string[] {
  const ids: string[] = [];
  const own = (fragment as { entityId?: unknown }).entityId;
  if (typeof own === 'string' && own) ids.push(own);
  const payload = eventPayloadOf(fragment);
  for (const key of ['subjectId', 'proposalId', 'approvalId'] as const) {
    const v = payload?.[key];
    if (typeof v === 'string' && v) ids.push(v);
  }
  return [...new Set(ids)];
}

/** D-238: the proposal fields a record carries itself (the propose record's metadata; a genome outcome's metadata and title). */
function proposalFieldsOfRecord(fragment: RecordFragment): ProposalFields | null {
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  if (fragment.sourceType === 'genome_memory_event') {
    const m = isPlainObject(fragment.metadata) ? fragment.metadata : {};
    return {
      carriesMoney: bool(m.carriesMoney),
      actionType: str(m.actionType),
      module: str(m.module),
      toolName: str(m.toolName),
      title: fragment.title ?? null,
      executionResult: m.executionResult,
    };
  }
  const payload = eventPayloadOf(fragment);
  const copied = payload?.eventType === 'GOVERNANCE_DECISION' && isPlainObject(payload.metadata) ? payload.metadata : undefined;
  const ledger = fragment.sourceType === 'business_event' && isPlainObject(fragment.metadata?.metadata) ? (fragment.metadata!.metadata as Record<string, unknown>) : undefined;
  const m = (copied ?? ledger) as Record<string, unknown> | undefined;
  if (!m || (m.actionType === undefined && m.toolName === undefined && m.module === undefined && m.carriesMoney === undefined)) return null;
  return {
    carriesMoney: bool(m.carriesMoney),
    actionType: str(m.actionType),
    module: str(m.module),
    toolName: str(m.toolName),
    title: str(m.title),
    executionResult: m.executionResult,
  };
}

/** D-238: the free text a proposal record carries itself (a rejection reason, a title, a summary). */
function recordTextMentionsMoney(fragment: RecordFragment): boolean {
  const texts: unknown[] = [];
  const collect = (o: unknown) => {
    if (!isPlainObject(o)) return;
    for (const key of ['reason', 'rejectionReason', 'failureReason', 'title', 'summary']) texts.push(o[key]);
  };
  const payload = eventPayloadOf(fragment);
  collect(payload);
  collect(payload?.metadata);
  collect(payload?.after);
  collect(fragment.metadata?.metadata);
  // The proposal vocabulary, as the proposal's own row is read (review of the Codex fixes, security MAJOR-1).
  return texts.some((t) => typeof t === 'string' && (isMoneyLabel(t) || proposalTextStatesMoney(t)));
}

/**
 * FU-PROPOSAL-REVENUE-SIGHT (owner ruling D-238; D-226, D-227, D-234): the ids of the proposal records among `fragments`
 * that a reader without revenue read may not be handed: the records of a financial proposal, judged by the underlying
 * KeyActionProposal row (its action type, module, tool and title) when it can be read, else by what the record carries;
 * a proposal that cannot be classified, or a read that fails, is withheld (fail closed). Status and risk level go with
 * the record, so they are no channel. Only proposals of `businessId` are read.
 */
async function financialProposalRecordIds(
  prisma: PrismaService | undefined,
  businessId: string,
  fragments: ReadonlyArray<RecordFragment & { id: string }>,
  logger: Pick<Logger, 'warn'>,
  logTag: string,
): Promise<Set<string>> {
  const proposals = fragments.filter((f) => isProposalRecord(f));
  const withheld = new Set<string>();
  if (proposals.length === 0) return withheld;
  const ids = [...new Set(proposals.flatMap(proposalIdsOf))];
  // Round 4 (security minor 2): the row on every classify field, judged with the recommendation it was bridged from.
  let rows = new Map<string, boolean>();
  if (ids.length > 0) {
    try {
      const found = ((await prisma?.client.keyActionProposal.findMany({
        where: { businessId, id: { in: ids } },
        select: PROPOSAL_CLASSIFY_SELECT,
      })) ?? []) as Array<{ id: string } & ProposalFields>;
      const flags = await financialProposalsWithProvenance(prisma, businessId, found);
      rows = new Map(found.map((r, i) => [r.id, flags[i]]));
    } catch (err) {
      logger.warn(`[${logTag}] the KEY proposals behind the proposal records could not be read; they are withheld: ${err instanceof Error ? err.message : String(err)}`);
      for (const f of proposals) withheld.add(f.id);
      return withheld;
    }
  }
  for (const f of proposals) {
    const rowFinancial = proposalIdsOf(f).map((id) => rows.get(id)).find((r) => r !== undefined);
    const own = proposalFieldsOfRecord(f);
    // D-238 ("directly or indirectly"): withheld when the proposal row or the record's own fields (security review
    // MINOR-1: a record naming a money tool under a non-financial proposal's id) are financial, when neither can be
    // read, or when the record's own text (a rejection reason, a title or summary) states money.
    // Round 5 (security m2): a record that names a proposal whose row is not found is withheld, as memory and the
    // timeline withhold it; a record that names none is judged on its own fields (unclassifiable fails closed).
    const namesProposal = proposalIdsOf(f).length > 0;
    const financial =
      rowFinancial !== undefined
        ? rowFinancial || (own ? isFinancialProposal(own) : false)
        : namesProposal || !own || isFinancialProposal(own);
    if (financial || recordTextMentionsMoney(f)) withheld.add(f.id);
  }
  return withheld;
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
 * or revenue scope is none, nor a turn with no reader; a GOVERNANCE_DECISION proposal stays business-wide, and a record
 * that names no module needs every module (review SEC-W1FPMS-1). The membership is read only when an event names a
 * module. `moduleSight`, when given, replaces the reader's (a staff position's turn: review SEC-W1FPMS-2, COR-W1FPMS-2).
 *
 * FU-KEY-MEMORY-MONEY-SIGHT: a genome money memory event (FINANCE_GENOME, a finance-filed row, CROSS_DOMAIN, the
 * customer-sales snapshot: isMoneyMemoryEvent, by the row the fragment carries) needs revenue read, as the genome's REST
 * routes require (D-128, D-100; review SEC-W1FPMS-3). And a turn with no member reader (`reader` null: a contact-only
 * position on the staff bridge, a SUPER_ADMIN who is no member, a removed member) sees a proposal record as its action,
 * status and risk level only, never its title, a rejection reason or any figure (memberlessProposalView; D-73/D-93,
 * review SEC-W1FPMS-4); a member sees it whole.
 *
 * The one rule of KeyCortexPromptContextService.buildMemoryContext and the pipeline's chatMemoryFragments (POST
 * /cortex/chat and its stream) and of FlowOrchestratorService.buildPerceptionSection (POST
 * /ai/businesses/:id/flow/chat and its stream, the staff bridge).
 */
export async function readersOwnPromptMemory<
  F extends Pick<MemoryFragment, 'id' | 'sourceType' | 'entityType' | 'title' | 'metadata'> & Partial<Pick<MemoryFragment, 'content'>>,
>(
  prisma: PrismaService | undefined,
  businessId: string,
  reader: string | null,
  fragments: ReadonlyArray<F>,
  limit: number,
  logger: Pick<Logger, 'warn'> = cognitionMemoryLogger,
  logTag = 'promptMemory',
  moduleSight?: ModuleSight,
): Promise<F[]> {
  const withoutKeyRecords = fragments.filter((fragment) => !isPersonalKeyRecord(fragment));
  // FU-PROPOSAL-REVENUE-SIGHT (D-238): the proposal records of a financial (or unclassifiable) proposal, classified first,
  // so a turn whose proposals are all non-financial still reads no membership.
  const financialProposals = await financialProposalRecordIds(prisma, businessId, withoutKeyRecords, logger, logTag);
  // FU-KEY-MEMORY-MONEY-SIGHT (SEC-W1FPMS-3): a genome money memory event names revenue too (recordModulesOf).
  const namesAModule = financialProposals.size > 0 || withoutKeyRecords.some((fragment) => recordModulesOf(fragment).length > 0);
  // Review SEC-W1FPMS-2 / COR-W1FPMS-2: a staff position's turn hands the sight its position resolved (moduleSight);
  // every other turn's is its reader's membership (readersModuleSight).
  const [sight, own] = await Promise.all([
    moduleSight
      ? Promise.resolve(moduleSight)
      : namesAModule
        ? readersModuleSight(prisma, businessId, reader, logger, logTag)
        : Promise.resolve(NO_MODULE_SIGHT),
    readersOwnCognitionMemory(prisma, businessId, reader, withoutKeyRecords, logger, logTag),
  ]);
  // D-238: a reader without revenue read is handed a proposal record only when its proposal is non-financial (a memberless
  // turn then sees its action, status and risk level only, D-226).
  const readsRevenue = sight('revenue');
  // MEM-DOC-EXTRACTION-SIGHT (D-234): a turn with no member reader sees no document extraction, whatever its sight.
  return withoutKeyRecords
    .filter((fragment) => reader !== null || !isDocumentExtractionFragment(fragment))
    .filter((fragment) => readsRevenue || !financialProposals.has(fragment.id))
    .filter((fragment) => withinModuleSight(fragment, sight))
    .filter((fragment) => fragment.sourceType !== 'cognition_memory' || own.has(fragment.id))
    .slice(0, limit)
    // FU-KEY-MEMORY-MONEY-SIGHT (SEC-W1FPMS-4; D-73/D-93): a turn with no member reader sees a proposal as its action,
    // status and risk level only (memberlessProposalView); a member sees it whole (business-wide).
    .map((fragment) => (reader === null && isProposalRecord(fragment) ? memberlessProposalView(fragment) : fragment));
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
    // MEM-DOC-EXTRACTION-SIGHT orchestrator review (COR-MDX-2): every dependency named by token, so Nest resolves the
    // service, PrismaService included, even where no type metadata is emitted (this first one had no token).
    @Inject(KeyCortexContextService)
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
  ) {
    // COR-MDX-2: without it no member reads memory, so no owner sees an extraction: said at construction, not silently.
    if (!prisma) this.logger.error('KeyCortexPromptContextService built without PrismaService: prompt memory reads fail closed for every reader');
  }

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
        // MEM-DOC-EXTRACTION-SIGHT (D-234): the reader's module sight, read first, so the read takes document
        // extractions only for a reader with revenue read (no reader, none); readersOwnPromptMemory keeps that sight.
        const sight = await readersModuleSight(this.prisma, businessId, reader, this.logger, 'buildMemoryContext');
        const fragments = await this.unifiedMemory.retrieveContext(businessId, {
          query: currentQuery,
          limit: PROMPT_MEMORY_FRAGMENTS + PROMPT_MEMORY_HEADROOM,
          ...(reader ? { userId: reader } : { includeEpisodic: false }),
          documentExtractions: readsDocumentExtractions(sight, reader),
          // MEM-UNIFIED-SEMANTIC-SIGHT (D-257, D-234): the semantic hits of the turn's query pass MEM-SEMANTIC-SIGHT's reader
          // projection before the read's limit (no database client: no sight, so no semantic hit).
          ...(this.prisma ? { semanticSight: readerSearchOptions(this.prisma, businessId, { reader, sight }, this.logger) } : {}),
        });
        const kept = await readersOwnPromptMemory(
          this.prisma,
          businessId,
          reader,
          fragments,
          PROMPT_MEMORY_FRAGMENTS,
          this.logger,
          'buildMemoryContext',
          sight,
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
