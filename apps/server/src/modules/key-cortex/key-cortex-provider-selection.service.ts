import { Injectable } from '@nestjs/common';
import {
  CortexQuery,
  CortexProvider,
} from './key-cortex.types';
import { AiPreferences } from '../ai/model-gateway.service';

/**
 * KeyCortexProviderSelectionService
 *
 * Selects the optimal AI provider based on query characteristics and preferences.
 */
@Injectable()
export class KeyCortexProviderSelectionService {
  /**
   * Select the optimal AI provider based on query characteristics and preferences.
   */
  async selectProvider(
    query: CortexQuery,
    preferences: AiPreferences,
  ): Promise<{ provider: CortexProvider; model: string }> {
    if (query.provider) {
      const modelMap: Record<CortexProvider, string> = {
        openai: 'gpt-4o',
        anthropic: 'claude-3-5-sonnet-20241022',
        xai: 'grok-2',
        kimi: 'moonshot-v1-8k',
        native: 'native-llm',
        opensource: 'llama-3.1-70b',
      };
      return { provider: query.provider, model: modelMap[query.provider] };
    }

    const text = query.text.toLowerCase();

    const isReasoning =
      /(?:analyze|reason|think|why|how\s+does|explain|compare|evaluate|assess)/i.test(
        text,
      );
    const isCreative =
      /(?:idea|creative|brainstorm|imagine|design|write|draft|compose)/i.test(
        text,
      );
    const isFast = query.stream === false && text.length < 100;
    const isBudget = (preferences as any).budgetMode;

    if (isBudget) {
      return { provider: 'openai', model: 'gpt-4o-mini' };
    }

    if (isReasoning) {
      return { provider: 'kimi', model: 'moonshot-v1-8k' };
    }

    if (isCreative) {
      return {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
      };
    }

    if (isFast) {
      return { provider: 'openai', model: 'gpt-4o-mini' };
    }

    return { provider: 'openai', model: 'gpt-4o' };
  }
}
