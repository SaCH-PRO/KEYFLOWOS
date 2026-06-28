import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { KeyCortexContextService } from './key-cortex-context.service';
import { UnifiedMemoryRetrievalService } from './unified-memory-retrieval.service';
import { KeyCortexLearningService } from './key-cortex-learning.service';
import {
  CortexQuery,
  CortexContextSnapshot,
  CortexSession,
} from './key-cortex.types';
import { GatewayMessage } from '../ai/model-gateway.service';

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
        const fragments = await this.unifiedMemory.retrieveContext(businessId, {
          query: currentQuery,
          limit: 15,
        });

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
