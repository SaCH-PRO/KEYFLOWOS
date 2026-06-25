import { Injectable, Logger } from '@nestjs/common';

/**
 * =============================================================================
 * Model Gateway — Multi-AI Provider Routing
 * =============================================================================
 * Routes requests to multiple AI providers with failover, load balancing,
 * and provider-specific configuration.
 *
 * Supported Providers:
 *   - OpenAI (GPT-4o, GPT-4o-mini)
 *   - Anthropic (Claude 3.5 Sonnet, Claude 3 Haiku)
 *   - xAI (Grok)
 *   - Moonshot / Kimi (Kimi k1.5)
 *
 * Features:
 *   - Provider selection by capability and availability
 *   - Automatic failover on provider errors
 *   - Token usage tracking
 *   - Response caching
 * =============================================================================
 */

export type ModelProvider = 'openai' | 'anthropic' | 'xai' | 'moonshot';

export interface ModelRequest {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxTokens?: number;
  provider?: ModelProvider;
  model?: string;
}

export interface ModelResponse {
  content: string;
  provider: ModelProvider;
  model: string;
  tokensUsed: { prompt: number; completion: number; total: number };
  latencyMs: number;
  cached: boolean;
}

export interface ProviderConfig {
  name: ModelProvider;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  priority: number; // lower = higher priority
  timeoutMs: number;
}

@Injectable()
export class ModelGateway {
  private readonly logger = new Logger(ModelGateway.name);

  /** Provider configurations — loaded from environment in production. */
  private providers: Map<ModelProvider, ProviderConfig> = new Map();

  /** In-memory response cache — production: Redis. */
  private cache = new Map<string, ModelResponse>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.loadProviderConfigs();
  }

  /**
   * Send a request to an AI model, with automatic provider selection
   * and failover.
   */
  async generate(request: ModelRequest): Promise<ModelResponse> {
    const startTime = Date.now();

    try {
      this.logger.debug(`Model request: ${request.messages.length} messages`);

      // Check cache
      const cacheKey = this.buildCacheKey(request);
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - this.getCacheTimestamp(cacheKey) < this.CACHE_TTL_MS) {
        this.logger.verbose('Cache hit');
        return { ...cached, cached: true };
      }

      // Select provider
      const provider = this.selectProvider(request.provider);
      if (!provider) {
        throw new Error('No AI provider available');
      }

      // Execute request
      const response = await this.executeWithProvider(provider, request);

      // Cache response
      this.cache.set(cacheKey, { ...response, cached: false });
      this.setCacheTimestamp(cacheKey);

      this.logger.verbose(`Generated ${response.content.length} chars from ${provider.name} in ${Date.now() - startTime}ms`);

      return response;
    } catch (err) {
      this.logger.error(`Generation failed: ${(err as Error).message}`);

      // Attempt failover
      if (!request.provider) {
        this.logger.warn('Attempting failover to next available provider');
        return this.failover(request);
      }

      throw err;
    }
  }

  /** Get provider status for health monitoring. */
  async getProviderStatus(): Promise<
    { provider: ModelProvider; available: boolean; defaultModel: string; latencyMs?: number }[]
  > {
    const statuses: { provider: ModelProvider; available: boolean; defaultModel: string; latencyMs?: number }[] = [];

    for (const [name, config] of this.providers.entries()) {
      const start = Date.now();
      let available = false;

      try {
        // Lightweight health check
        await this.executeWithProvider(config, {
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 5,
        });
        available = true;
      } catch {
        available = false;
      }

      statuses.push({
        provider: name,
        available,
        defaultModel: config.defaultModel,
        latencyMs: available ? Date.now() - start : undefined,
      });
    }

    return statuses;
  }

  /** Select the best available provider. */
  private selectProvider(preferred?: ModelProvider): ProviderConfig | undefined {
    if (preferred && this.providers.has(preferred)) {
      return this.providers.get(preferred);
    }

    // Sort by priority and return best
    const sorted = Array.from(this.providers.values()).sort((a, b) => a.priority - b.priority);
    return sorted[0];
  }

  /** Execute a request against a specific provider. */
  private async executeWithProvider(
    config: ProviderConfig,
    request: ModelRequest,
  ): Promise<ModelResponse> {
    const start = Date.now();

    // Production: use provider SDK (openai, @anthropic-ai/sdk, etc.)
    // For now, return a structured placeholder
    this.logger.verbose(`Executing with ${config.name}/${request.model || config.defaultModel}`);

    // Simulate network latency (50-200ms)
    await this.delay(50 + Math.random() * 150);

    const promptTokens = this.estimateTokens(
      request.messages.map(m => m.content).join(' '),
    );
    const completionTokens = Math.min(request.maxTokens || 500, 500);

    return {
      content: `[Generated via ${config.name}] Production: integrate ${config.name} SDK for real responses.`,
      provider: config.name,
      model: request.model || config.defaultModel,
      tokensUsed: {
        prompt: promptTokens,
        completion: completionTokens,
        total: promptTokens + completionTokens,
      },
      latencyMs: Date.now() - start,
      cached: false,
    };
  }

  /** Failover to next available provider. */
  private async failover(request: ModelRequest): Promise<ModelResponse> {
    const allProviders = Array.from(this.providers.values()).sort((a, b) => a.priority - b.priority);

    for (const provider of allProviders.slice(1)) {
      try {
        this.logger.warn(`Failover to ${provider.name}`);
        return await this.executeWithProvider(provider, request);
      } catch {
        continue;
      }
    }

    throw new Error('All AI providers failed');
  }

  /** Load provider configurations from environment. */
  private loadProviderConfigs(): void {
    // OpenAI
    this.providers.set('openai', {
      name: 'openai',
      apiKey: process.env['OPENAI_API_KEY'] || '',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o',
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
      priority: 1,
      timeoutMs: 30000,
    });

    // Anthropic
    this.providers.set('anthropic', {
      name: 'anthropic',
      apiKey: process.env['ANTHROPIC_API_KEY'] || '',
      baseUrl: 'https://api.anthropic.com',
      defaultModel: 'claude-sonnet-4-20250514',
      models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-opus-4-20250514'],
      priority: 2,
      timeoutMs: 30000,
    });

    // xAI
    this.providers.set('xai', {
      name: 'xai',
      apiKey: process.env['XAI_API_KEY'] || '',
      baseUrl: 'https://api.x.ai/v1',
      defaultModel: 'grok-3',
      models: ['grok-3', 'grok-3-mini'],
      priority: 3,
      timeoutMs: 30000,
    });

    // Moonshot / Kimi
    this.providers.set('moonshot', {
      name: 'moonshot',
      apiKey: process.env['MOONSHOT_API_KEY'] || '',
      baseUrl: 'https://api.moonshot.cn/v1',
      defaultModel: 'kimi-k1.5',
      models: ['kimi-k1.5', 'moonshot-v1-8k', 'moonshot-v1-128k'],
      priority: 4,
      timeoutMs: 30000,
    });
  }

  /** Simple token estimation (1 token ≈ 0.75 words). */
  private estimateTokens(text: string): number {
    const words = text.split(/\s+/).length;
    return Math.ceil(words / 0.75);
  }

  private buildCacheKey(request: ModelRequest): string {
    const content = request.messages.map(m => `${m.role}:${m.content}`).join('|');
    return `${request.provider || 'auto'}_${request.model || 'default'}_${this.hash(content)}`;
  }

  private hash(str: string): string {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
  }

  private cacheTimestamps = new Map<string, number>();

  private setCacheTimestamp(key: string): void {
    this.cacheTimestamps.set(key, Date.now());
  }

  private getCacheTimestamp(key: string): number {
    return this.cacheTimestamps.get(key) || 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
