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
        const reader = await this.episodicMemoryReader(businessId, session.userId);
        const fragments = (
          await this.unifiedMemory.retrieveContext(businessId, {
            query: currentQuery,
            limit: PROMPT_MEMORY_FRAGMENTS + TOOL_CALL_RECORD_HEADROOM,
            ...(reader ? { userId: reader } : { includeEpisodic: false }),
          })
        )
          .filter((fragment) => !isToolCallRecord(fragment))
          .slice(0, PROMPT_MEMORY_FRAGMENTS);

        if (fragments.length > 0) {
          memoryContext.aiMemory = this.formatUnifiedMemory(fragments);
        }
      } catch (err: any) {
        this.logger.warn(
          `[buildMemoryContext] Unified memory retrieval failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (this.learningService) {
      try {
        const lessons = await this.learningService.retrieveLessons(
          businessId,
          currentQuery,
          {
            roleId: session.detectedRole,
            functionId: session.detectedFunction,
            limit: 3,
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
