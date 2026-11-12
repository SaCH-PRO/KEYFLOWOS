import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { userCanAccessBusiness } from '../../core/auth/business.guard';
import { KeyCortexContextService } from './key-cortex-context.service';
import { UnifiedMemoryRetrievalService } from './unified-memory-retrieval.service';
import { KeyCortexLearningService } from './key-cortex-learning.service';
import type { MemoryFragment } from './unified-memory.types';
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
 */
const TOOL_CALL_RECORD_HEADROOM = 100;
/**
 * W11-CORTEX-MEMORY-COGNITION (owner ruling D-130; CR-W10CCS-1): the most cognition-memory rows
 * UnifiedMemoryRetrievalService hands over (it reads at most 50), asked for on top so that leaving out
 * every row that is not the reader's own still fills the prompt's fragments. With
 * TOOL_CALL_RECORD_HEADROOM it is the rule the pipeline's CHAT_MEMORY_HEADROOM (150) encodes.
 */
const COGNITION_MEMORY_HEADROOM = 50;
/** The bus events of one KEY tool call (the registry's tool.*, the lifecycle's cortex.action_*). */
const TOOL_CALL_EVENT_TYPES = new Set([
  'tool.executed',
  'tool.failed',
  'tool.replayed',
  'cortex.action_executed',
  'cortex.action_failed',
]);
/** The business_events subjects of one KEY tool call: the registry's ledger and bus rows, the lifecycle's. */
const TOOL_CALL_SUBJECTS = new Set(['tool_execution', 'AiExecutionLog']);

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
 */
export function isToolCallRecord(fragment: Pick<MemoryFragment, 'sourceType' | 'entityType' | 'title'>): boolean {
  if (fragment.sourceType === 'business_event') return TOOL_CALL_SUBJECTS.has(fragment.entityType ?? '');
  if (fragment.sourceType === 'cognitive_event') return TOOL_CALL_EVENT_TYPES.has(fragment.title);
  return false;
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
   */
  async buildMemoryContext(
    businessId: string,
    session: CortexSession,
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
    // blocks below (the memory fragments and the learned lessons). Nobody when the session names no member
    // of the business (W9-KEY-CORTEX-AUDIT, D-104 membership-only).
    const reader =
      this.unifiedMemory || this.learningService
        ? await this.episodicMemoryReader(businessId, session.userId)
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
        const fragments = (
          await this.unifiedMemory.retrieveContext(businessId, {
            query: currentQuery,
            limit: PROMPT_MEMORY_FRAGMENTS + TOOL_CALL_RECORD_HEADROOM + COGNITION_MEMORY_HEADROOM,
            ...(reader ? { userId: reader } : { includeEpisodic: false }),
          })
        ).filter((fragment) => !isToolCallRecord(fragment));
        const own = await readersOwnCognitionMemory(
          this.prisma,
          businessId,
          reader,
          fragments,
          this.logger,
          'buildMemoryContext',
        );
        const kept = fragments
          .filter((fragment) => fragment.sourceType !== 'cognition_memory' || own.has(fragment.id))
          .slice(0, PROMPT_MEMORY_FRAGMENTS);

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
   * W9-KEY-CORTEX-AUDIT: the member whose episodic memory a prompt for this session may read: the
   * session's user when they own the business or hold a membership in it (BusinessGuard's own
   * predicate, userCanAccessBusiness), else nobody. No user, a user who is no member (a platform
   * SUPER_ADMIN passes BusinessGuard without one; a removed member's session), or a check that cannot
   * be made: nobody, so no episodic memory is read.
   */
  private async episodicMemoryReader(businessId: string, userId: string | undefined): Promise<string | null> {
    if (!userId || !this.prisma) return null;
    try {
      return (await userCanAccessBusiness(this.prisma, userId, businessId)) ? userId : null;
    } catch (err: unknown) {
      this.logger.warn(
        `[buildMemoryContext][${businessId}] membership check failed, no episodic memory read: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
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
