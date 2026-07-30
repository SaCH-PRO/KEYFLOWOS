import { Injectable, Logger, Inject } from '@nestjs/common';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { KeyCortexContextService } from './key-cortex-context.service';
import { CortexContextSnapshot } from './key-cortex.types';

/**
 * KeyCortexSuggestionService
 *
 * Generates follow-up suggestions based on the assistant's last message and
 * business context.
 */
@Injectable()
export class KeyCortexSuggestionService {
  private readonly logger = new Logger(KeyCortexSuggestionService.name);

  constructor(
    @Inject(ModelGatewayService)
    private readonly modelGateway: ModelGatewayService,
    private readonly contextService: KeyCortexContextService,
  ) {}

  /**
   * Generate follow-up suggestions based on the last assistant message and business context.
   */
  async generateSuggestions(
    businessId: string,
    lastMessage: string,
    v2Context?: Record<string, unknown>,
    integrationV2Enabled = false,
  ): Promise<string[]> {
    try {
      const contextSnapshot =
        await this.contextService.buildContextSnapshot(businessId);

      let extraContext = '';
      if (v2Context && integrationV2Enabled) {
        const moduleNames = Object.keys(v2Context).join(', ');
        extraContext = `\nAvailable modules: ${moduleNames}. You can suggest actions across any of these modules.`;
      }

      const suggestionPrompt = `Based on the following AI assistant response and business context, suggest 3 natural follow-up questions or commands the user might want to ask next.

Assistant's last message (excerpt): "${lastMessage.slice(0, 500)}"

Business context:
- Genome Stage: ${contextSnapshot.genomeStage}
- Pending invoices: ${contextSnapshot.pendingInvoices}
- Active projects: ${contextSnapshot.activeProjects.length}
- Unread messages: ${contextSnapshot.unreadMessages}${extraContext}

Return ONLY a JSON array of 3 strings. Each should be a complete, natural sentence.
Example: ["Can you break that down by month?", "Create a task for this", "What are the risks?"]`;

      const result = await (this.modelGateway as any).complete({
        messages: [{ role: 'user', content: suggestionPrompt }],
        model: 'gpt-4o-mini',
        temperature: 0.8,
        maxTokens: 500,
      });

      const jsonMatch = result.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return this.getDefaultSuggestions(contextSnapshot);
      }

      const suggestions: string[] = JSON.parse(jsonMatch[0]);
      return suggestions
        .filter((s: any) => typeof s === 'string' && s.length > 5)
        .slice(0, 3);
    } catch (error: any) {
      this.logger.warn(
        `[generateSuggestions] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [
        'Can you explain that in more detail?',
        'Create a task from this analysis',
        'What are the next steps?',
      ];
    }
  }

  getDefaultSuggestions(context: CortexContextSnapshot): string[] {
    const suggestions: string[] = [
      'Can you break that down by category?',
      'Create a task from this analysis',
      'What are the risks I should watch for?',
    ];

    if (context.pendingInvoices > 0) {
      suggestions.push(
        `Follow up on ${context.pendingInvoices} pending invoices`,
      );
    }

    if (context.activeProjects.length > 0) {
      suggestions.push('Show me project status updates');
    }

    return suggestions.slice(0, 3);
  }
}
