import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import OpenAI from 'openai';
import { validateOutputContract, type ContractType } from './ai-output-contracts';

export type AiProvider = 'openai' | 'anthropic' | 'xai' | 'kimi' | 'native' | 'opensource';

export type TaskCategory =
  | 'extraction'
  | 'classification'
  | 'reasoning'
  | 'content-generation'
  | 'summarization'
  | 'analysis'
  | 'tool-calling'
  | 'general';

export type AiMode = 'balanced' | 'premium' | 'fast';

export interface GatewayToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface GatewayToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface GatewayMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: GatewayToolCall[];
  tool_call_id?: string;
}

export interface GatewayRequest {
  businessId: string;
  taskCategory: TaskCategory;
  messages: GatewayMessage[];
  tools?: GatewayToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  maxTokens?: number;
  temperature?: number;
  providerOverride?: AiProvider;
  modelOverride?: string;
  /** @deprecated Use modelOverride */
  model?: string;
  /** Response format hint (e.g. json_object) */
  responseFormat?: { type: string };
  expectedContract?: ContractType;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: string[];
  contractType: ContractType;
}

export interface GatewayResponse {
  content: string | null;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  provider: AiProvider;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: number;
  };
  latencyMs: number;
  fallbackUsed: boolean;
  fallbackProvider?: AiProvider;
  contractValidation?: ContractValidationResult;
}

export interface StreamChunk {
  type: 'content_delta' | 'tool_call_delta' | 'usage' | 'done' | 'error';
  content?: string;
  toolCall?: {
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: number;
  };
  provider?: AiProvider;
  model?: string;
  error?: string;
}

export interface ProviderHealth {
  provider: AiProvider;
  available: boolean;
  configured: boolean;
  avgLatencyMs: number;
  errorRate: number;
  lastErrorAt: Date | null;
  totalCalls: number;
  totalErrors: number;
}

export interface ModelStrategy {
  primary: { provider: AiProvider; model: string };
  fallbacks: Array<{ provider: AiProvider; model: string }>;
}

export interface BudgetCaps {
  monthlyOverall?: number;
  monthlyOpenai?: number;
  monthlyAnthropic?: number;
  monthlyXai?: number;
  monthlyKimi?: number;
}

export interface ProviderBudgetStatus {
  provider: AiProvider;
  budgetCap: number | null;
  spent: number;
  remaining: number | null;
  utilizationPct: number | null;
  isOverBudget: boolean;
  isNearLimit: boolean;
}

export interface BudgetStatus {
  overall: { budgetCap: number | null; spent: number; remaining: number | null; utilizationPct: number | null; isOverBudget: boolean; isNearLimit: boolean };
  byProvider: ProviderBudgetStatus[];
  periodStart: Date;
  periodEnd: Date;
}

export interface AiPreferences {
  aiMode: AiMode;
  preferredWritingStyle?: string;
  byokOpenai?: string;
  byokAnthropic?: string;
  byokXai?: string;
  byokKimi?: string;
  byokNative?: string;
  budgetCaps?: BudgetCaps;
}

const DEFAULT_PREFERENCES: AiPreferences = {
  aiMode: 'balanced',
};

const BUDGET_NEAR_LIMIT_THRESHOLD = 0.85;

const TOKEN_COST_PER_1K: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.0004, output: 0.0016 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-5-haiku-20241022': { input: 0.001, output: 0.005 },
  'grok-2': { input: 0.005, output: 0.015 },
  'grok-2-mini': { input: 0.001, output: 0.005 },
  'moonshot-v1-8k': { input: 0.003, output: 0.003 },
  'moonshot-v1-32k': { input: 0.006, output: 0.006 },
  'moonshot-v1-128k': { input: 0.012, output: 0.012 },
};

const DEFAULT_ROUTING_TABLE: Record<AiMode, Record<TaskCategory, ModelStrategy>> = {
  balanced: {
    extraction: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
    classification: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
    reasoning: {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
    'content-generation': {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
    summarization: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
    'tool-calling': {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
    analysis: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
    general: {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
  },
  premium: {
    extraction: {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-32k' },
      ],
    },
    classification: {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-32k' },
      ],
    },
    reasoning: {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-32k' },
      ],
    },
    'content-generation': {
      primary: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      fallbacks: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'kimi', model: 'moonshot-v1-32k' },
      ],
    },
    summarization: {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-32k' },
      ],
    },
    'tool-calling': {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-32k' },
      ],
    },
    analysis: {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-32k' },
      ],
    },
    general: {
      primary: { provider: 'openai', model: 'gpt-4o' },
      fallbacks: [
        { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { provider: 'kimi', model: 'moonshot-v1-32k' },
      ],
    },
  },
  fast: {
    extraction: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [
        { provider: 'xai', model: 'grok-2-mini' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
    classification: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [
        { provider: 'xai', model: 'grok-2-mini' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
    reasoning: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [
        { provider: 'xai', model: 'grok-2-mini' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
    'content-generation': {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [
        { provider: 'xai', model: 'grok-2-mini' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
    summarization: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [
        { provider: 'xai', model: 'grok-2-mini' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
    'tool-calling': {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [
        { provider: 'xai', model: 'grok-2-mini' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
    analysis: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [
        { provider: 'xai', model: 'grok-2-mini' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
    general: {
      primary: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbacks: [
        { provider: 'xai', model: 'grok-2-mini' },
        { provider: 'kimi', model: 'moonshot-v1-8k' },
      ],
    },
  },
};

interface ProviderMetrics {
  totalCalls: number;
  totalErrors: number;
  latencies: number[];
  lastErrorAt: Date | null;
}

@Injectable()
export class ModelGatewayService {
  private readonly logger = new Logger(ModelGatewayService.name);

  private readonly openai: OpenAI;
  private readonly providerClients = new Map<AiProvider, { configured: boolean }>();
  private readonly providerMetrics = new Map<AiProvider, ProviderMetrics>();
  private readonly preferencesCache = new Map<string, { data: AiPreferences; expiresAt: number }>();
  private readonly encryptionKey: Buffer;
  private readonly byokEncryptionAvailable: boolean;
  private routingTable: Record<AiMode, Record<TaskCategory, ModelStrategy>>;
  private routingTableLoaded = false;

  private static readonly PREFERENCES_TTL_MS = 120_000;
  private static readonly MAX_RETRIES = 2;
  private static readonly RETRY_DELAY_MS = 500;
  private static readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {
    this.openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    this.routingTable = structuredClone(DEFAULT_ROUTING_TABLE);

    const encSecret = process.env.BYOK_ENCRYPTION_SECRET;
    this.byokEncryptionAvailable = !!encSecret;
    if (!encSecret) {
      this.logger.warn('BYOK_ENCRYPTION_SECRET not set — BYOK key storage will be unavailable');
    }
    this.encryptionKey = encSecret
      ? scryptSync(encSecret, 'keyflowos-byok-salt', 32)
      : randomBytes(32);

    this.providerClients.set('openai', {
      configured: !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    });
    this.providerClients.set('anthropic', {
      configured: !!process.env.ANTHROPIC_API_KEY,
    });
    this.providerClients.set('xai', {
      configured: !!process.env.XAI_API_KEY,
    });
    this.providerClients.set('kimi', {
      configured: !!process.env.KIMI_API_KEY,
    });
    this.providerClients.set('native', {
      configured: !!process.env.NATIVE_AI_API_KEY,
    });
    this.providerClients.set('opensource', {
      configured: !!process.env.OPENROUTER_API_KEY || !!process.env.OLLAMA_BASE_URL,
    });

    for (const provider of ['openai', 'anthropic', 'xai', 'kimi', 'native', 'opensource'] as AiProvider[]) {
      this.providerMetrics.set(provider, {
        totalCalls: 0,
        totalErrors: 0,
        latencies: [],
        lastErrorAt: null,
      });
    }
  }

  private validateContract(
    rawContent: string,
    contractType: ContractType,
  ): ContractValidationResult {
    try {
      const parsed = JSON.parse(rawContent);
      const validation = validateOutputContract(parsed, contractType);
      if (!validation.valid) {
        this.logger.warn(
          `Output contract [${contractType}] validation failed: ${validation.errors.join(', ')}`,
        );
      }
      return { ...validation, contractType };
    } catch {
      return {
        valid: false,
        errors: ['Response is not valid JSON'],
        contractType,
      };
    }
  }

  private encryptSecret(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ModelGatewayService.ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  private decryptSecret(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) return '';
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(ModelGatewayService.ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  async complete(request: GatewayRequest): Promise<GatewayResponse> {
    if (!this.routingTableLoaded) {
      await this.loadRoutingConfig();
    }

    const preferences = await this.getPreferences(request.businessId);
    const mode = preferences.aiMode;
    const strategy = this.resolveStrategy(request, mode, preferences);

    const budgetCaps = preferences.budgetCaps;
    let spendByProvider: Record<string, number> | undefined;
    let totalSpend: number | undefined;

    if (budgetCaps && this.hasBudgetCaps(budgetCaps)) {
      const spendData = await this.getCurrentMonthSpend(request.businessId);
      spendByProvider = spendData.byProvider;
      totalSpend = spendData.total;
    }

    const candidates = [strategy.primary, ...strategy.fallbacks];
    const budgetFilteredCandidates = this.filterCandidatesByBudget(
      candidates, budgetCaps, spendByProvider, totalSpend,
    );

    let lastError: Error | null = null;
    let fallbackUsed = false;
    let fallbackProvider: AiProvider | undefined;
    let budgetDegraded = false;

    const effectiveCandidates = budgetFilteredCandidates.length > 0
      ? budgetFilteredCandidates
      : candidates;

    if (budgetFilteredCandidates.length === 0 && candidates.length > 0) {
      this.logger.warn(
        `All providers over budget for business ${request.businessId}, allowing request with degraded routing`,
      );
      budgetDegraded = true;
    }

    for (let i = 0; i < effectiveCandidates.length; i++) {
      const candidate = effectiveCandidates[i];

      if (!this.isProviderAvailable(candidate.provider, preferences)) {
        continue;
      }

      if (i > 0 || (budgetDegraded && candidate !== candidates[0])) {
        fallbackUsed = true;
        fallbackProvider = candidate.provider;
        this.logger.warn(
          `Falling back to ${candidate.provider}/${candidate.model} for ${request.taskCategory} (business: ${request.businessId})`,
        );
      }

      try {
        const result = await this.executeWithRetries(
          request,
          candidate.provider,
          candidate.model,
          preferences,
        );

        const response: GatewayResponse = {
          ...result,
          fallbackUsed,
          fallbackProvider,
        };

        if (request.expectedContract) {
          const contentToValidate = response.toolCalls?.length
            ? response.toolCalls[0]?.function?.arguments
            : response.content;

          if (contentToValidate) {
            response.contractValidation = this.validateContract(
              contentToValidate,
              request.expectedContract,
            );

            if (!response.contractValidation.valid) {
              const errors = response.contractValidation.errors.join('; ');
              this.logger.error(
                `Contract [${request.expectedContract}] enforcement failed for ${request.taskCategory}: ${errors}`,
              );
              throw new Error(
                `AI output contract violation [${request.expectedContract}]: ${errors}`,
              );
            }
          }
        }

        return response;
      } catch (err: any) {
        lastError = err as Error;
        this.recordProviderError(candidate.provider);
        this.logger.error(
          `Provider ${candidate.provider}/${candidate.model} failed: ${lastError.message}`,
        );
      }
    }

    throw lastError || new Error('No AI providers available');
  }

  async *streamComplete(request: GatewayRequest): AsyncGenerator<StreamChunk> {
    if (!this.routingTableLoaded) {
      await this.loadRoutingConfig();
    }

    const preferences = await this.getPreferences(request.businessId);
    const mode = preferences.aiMode;
    const strategy = this.resolveStrategy(request, mode, preferences);
    const candidates = [strategy.primary, ...strategy.fallbacks];

    const budgetCaps = preferences.budgetCaps;
    let spendByProvider: Record<string, number> | undefined;
    let totalSpend: number | undefined;

    if (budgetCaps && this.hasBudgetCaps(budgetCaps)) {
      const spendData = await this.getCurrentMonthSpend(request.businessId);
      spendByProvider = spendData.byProvider;
      totalSpend = spendData.total;
    }

    const budgetFilteredCandidates = this.filterCandidatesByBudget(
      candidates, budgetCaps, spendByProvider, totalSpend,
    );

    const effectiveCandidates = budgetFilteredCandidates.length > 0
      ? budgetFilteredCandidates
      : candidates;

    if (budgetFilteredCandidates.length === 0 && candidates.length > 0) {
      this.logger.warn(
        `All providers over budget for streaming business ${request.businessId}, allowing request with degraded routing`,
      );
    }

    let lastError: Error | null = null;

    for (let i = 0; i < effectiveCandidates.length; i++) {
      const candidate = effectiveCandidates[i];

      if (!this.isProviderAvailable(candidate.provider, preferences)) {
        continue;
      }

      if (i > 0) {
        this.logger.warn(
          `Stream falling back to ${candidate.provider}/${candidate.model} for ${request.taskCategory} (business: ${request.businessId})`,
        );
      }

      try {
        const startTime = Date.now();
        const stream = this.callProviderStream(request, candidate.provider, candidate.model, preferences);

        for await (const chunk of stream) {
          yield { ...chunk, provider: candidate.provider, model: candidate.model };
        }

        const latencyMs = Date.now() - startTime;
        this.recordProviderSuccess(candidate.provider, latencyMs);
        return;
      } catch (err: any) {
        lastError = err as Error;
        this.recordProviderError(candidate.provider);
        this.logger.error(
          `Stream provider ${candidate.provider}/${candidate.model} failed: ${lastError.message}`,
        );
      }
    }

    yield {
      type: 'error',
      error: lastError?.message || 'No AI providers available',
    };
  }

  private async *callProviderStream(
    request: GatewayRequest,
    provider: AiProvider,
    model: string,
    preferences: AiPreferences,
  ): AsyncGenerator<StreamChunk> {
    const normalizedMessages = this.normalizeMessages(request.messages, provider);

    switch (provider) {
      case 'openai':
        yield* this.streamOpenAi(normalizedMessages, model, request, preferences.byokOpenai);
        break;
      case 'anthropic':
        yield* this.streamAnthropic(normalizedMessages, model, request, preferences.byokAnthropic);
        break;
      case 'xai':
        yield* this.streamXai(normalizedMessages, model, request, preferences.byokXai);
        break;
      case 'kimi':
        yield* this.streamKimi(normalizedMessages, model, request, preferences.byokKimi);
        break;
      case 'native':
        yield* this.streamNative(normalizedMessages, model, request, preferences.byokNative);
        break;
      case 'opensource':
        yield* this.streamOpensource(normalizedMessages, model, request);
        break;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private async *streamOpenAi(
    messages: GatewayMessage[],
    model: string,
    request: GatewayRequest,
    byokKey?: string,
  ): AsyncGenerator<StreamChunk> {
    const client = byokKey ? new OpenAI({ apiKey: byokKey }) : this.openai;

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      max_tokens: request.maxTokens ?? 500,
      temperature: request.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools as OpenAI.Chat.Completions.ChatCompletionTool[];
      if (request.toolChoice) {
        params.tool_choice = request.toolChoice as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
      }
    }

    const stream = await client.chat.completions.create(params);

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;

      if (delta?.content) {
        yield { type: 'content_delta', content: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          yield {
            type: 'tool_call_delta',
            toolCall: {
              index: tc.index,
              id: tc.id,
              name: tc.function?.name,
              argumentsDelta: tc.function?.arguments,
            },
          };
        }
      }

      if (chunk.usage) {
        const promptTokens = chunk.usage.prompt_tokens ?? 0;
        const completionTokens = chunk.usage.completion_tokens ?? 0;
        const costs = TOKEN_COST_PER_1K[model] || TOKEN_COST_PER_1K['gpt-4o'];
        const estimatedCost =
          (promptTokens / 1000) * costs.input +
          (completionTokens / 1000) * costs.output;

        yield {
          type: 'usage',
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            estimatedCost: Math.round(estimatedCost * 10000) / 10000,
          },
        };
      }
    }

    yield { type: 'done' };
  }

  private async *streamAnthropic(
    messages: GatewayMessage[],
    model: string,
    request: GatewayRequest,
    byokKey?: string,
  ): AsyncGenerator<StreamChunk> {
    const apiKey = byokKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Anthropic API key not configured');

    let systemPrompt = '';
    const nonSystemMessages: Array<{ role: string; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n\n' : '') + (msg.content || '');
      } else if (msg.role === 'tool') {
        nonSystemMessages.push({
          role: 'user',
          content: `[Tool result for ${msg.tool_call_id}]: ${msg.content}`,
        });
      } else {
        nonSystemMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content || '',
        });
      }
    }

    if (nonSystemMessages.length === 0) {
      nonSystemMessages.push({ role: 'user', content: 'Please respond.' });
    }

    const mergedMessages: Array<{ role: string; content: string }> = [];
    for (const msg of nonSystemMessages) {
      if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === msg.role) {
        mergedMessages[mergedMessages.length - 1].content += '\n\n' + msg.content;
      } else {
        mergedMessages.push({ ...msg });
      }
    }

    if (mergedMessages.length > 0 && mergedMessages[0].role !== 'user') {
      mergedMessages.unshift({ role: 'user', content: 'Continue.' });
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? 500,
      temperature: request.temperature ?? 0.7,
      messages: mergedMessages,
      stream: true,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic streaming API error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Anthropic streaming response has no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;

            try {
              const event = JSON.parse(jsonStr);

              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                yield { type: 'content_delta', content: event.delta.text };
              }

              if (event.type === 'message_start' && event.message?.usage) {
                inputTokens = event.message.usage.input_tokens ?? 0;
              }

              if (event.type === 'message_delta' && event.usage) {
                outputTokens = event.usage.output_tokens ?? 0;
              }
            } catch {
              /* intentionally empty */
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const totalTokens = inputTokens + outputTokens;
    const costs = TOKEN_COST_PER_1K[model] || TOKEN_COST_PER_1K['claude-3-5-sonnet-20241022'];
    const estimatedCost =
      (inputTokens / 1000) * costs.input +
      (outputTokens / 1000) * costs.output;

    yield {
      type: 'usage',
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens,
        estimatedCost: Math.round(estimatedCost * 10000) / 10000,
      },
    };

    yield { type: 'done' };
  }

  private async *streamXai(
    messages: GatewayMessage[],
    model: string,
    request: GatewayRequest,
    byokKey?: string,
  ): AsyncGenerator<StreamChunk> {
    const apiKey = byokKey || process.env.XAI_API_KEY;
    if (!apiKey) throw new Error('xAI API key not configured');

    const client = new OpenAI({
      apiKey,
      baseURL: 'https://api.x.ai/v1',
    });

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      max_tokens: request.maxTokens ?? 500,
      temperature: request.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools as OpenAI.Chat.Completions.ChatCompletionTool[];
      if (request.toolChoice) {
        params.tool_choice = request.toolChoice as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
      }
    }

    const stream = await client.chat.completions.create(params);

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;

      if (delta?.content) {
        yield { type: 'content_delta', content: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          yield {
            type: 'tool_call_delta',
            toolCall: {
              index: tc.index,
              id: tc.id,
              name: tc.function?.name,
              argumentsDelta: tc.function?.arguments,
            },
          };
        }
      }

      if (chunk.usage) {
        const promptTokens = chunk.usage.prompt_tokens ?? 0;
        const completionTokens = chunk.usage.completion_tokens ?? 0;
        const costs = TOKEN_COST_PER_1K[model] || TOKEN_COST_PER_1K['grok-2'];
        const estimatedCost =
          (promptTokens / 1000) * costs.input +
          (completionTokens / 1000) * costs.output;

        yield {
          type: 'usage',
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            estimatedCost: Math.round(estimatedCost * 10000) / 10000,
          },
        };
      }
    }

    yield { type: 'done' };
  }

  private async *streamKimi(
    messages: GatewayMessage[],
    model: string,
    request: GatewayRequest,
    byokKey?: string,
  ): AsyncGenerator<StreamChunk> {
    const apiKey = byokKey || process.env.KIMI_API_KEY;
    if (!apiKey) throw new Error('Kimi API key not configured');

    const client = new OpenAI({
      apiKey,
      baseURL: 'https://api.moonshot.cn/v1',
    });

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      max_tokens: request.maxTokens ?? 500,
      temperature: request.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools as OpenAI.Chat.Completions.ChatCompletionTool[];
      if (request.toolChoice) {
        params.tool_choice = request.toolChoice as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
      }
    }

    const stream = await client.chat.completions.create(params);

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;

      if (delta?.content) {
        yield { type: 'content_delta', content: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          yield {
            type: 'tool_call_delta',
            toolCall: {
              index: tc.index,
              id: tc.id,
              name: tc.function?.name,
              argumentsDelta: tc.function?.arguments,
            },
          };
        }
      }

      if (chunk.usage) {
        const promptTokens = chunk.usage.prompt_tokens ?? 0;
        const completionTokens = chunk.usage.completion_tokens ?? 0;
        const costs = TOKEN_COST_PER_1K[model] || TOKEN_COST_PER_1K['moonshot-v1-8k'];
        const estimatedCost =
          (promptTokens / 1000) * costs.input +
          (completionTokens / 1000) * costs.output;

        yield {
          type: 'usage',
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            estimatedCost: Math.round(estimatedCost * 10000) / 10000,
          },
        };
      }
    }

    yield { type: 'done' };
  }

  private async *streamNative(
    messages: GatewayMessage[],
    model: string,
    request: GatewayRequest,
    byokKey?: string,
  ): AsyncGenerator<StreamChunk> {
    const apiKey = byokKey || process.env.NATIVE_AI_API_KEY || 'native-key';
    const baseURL = process.env.KEYFLOW_NATIVE_AI_URL || process.env.NATIVE_AI_BASE_URL;
    if (!baseURL) throw new Error('Native AI base URL not configured');

    const client = new OpenAI({
      apiKey,
      baseURL,
    });

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      max_tokens: request.maxTokens ?? 500,
      temperature: request.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools as OpenAI.Chat.Completions.ChatCompletionTool[];
      if (request.toolChoice) {
        params.tool_choice = request.toolChoice as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
      }
    }

    const stream = await client.chat.completions.create(params);

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;

      if (delta?.content) {
        yield { type: 'content_delta', content: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          yield {
            type: 'tool_call_delta',
            toolCall: {
              index: tc.index,
              id: tc.id,
              name: tc.function?.name,
              argumentsDelta: tc.function?.arguments,
            },
          };
        }
      }

      if (chunk.usage) {
        const promptTokens = chunk.usage.prompt_tokens ?? 0;
        const completionTokens = chunk.usage.completion_tokens ?? 0;
        const costs = TOKEN_COST_PER_1K[model] || { input: 0, output: 0 };
        const estimatedCost =
          (promptTokens / 1000) * costs.input +
          (completionTokens / 1000) * costs.output;

        yield {
          type: 'usage',
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            estimatedCost: Math.round(estimatedCost * 10000) / 10000,
          },
        };
      }
    }

    yield { type: 'done' };
  }

  private async *streamOpensource(
    messages: GatewayMessage[],
    model: string,
    request: GatewayRequest,
  ): AsyncGenerator<StreamChunk> {
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const ollamaBase = process.env.OLLAMA_BASE_URL;

    if (!openrouterKey && !ollamaBase) {
      throw new Error('No open-source AI provider configured (OPENROUTER_API_KEY or OLLAMA_BASE_URL)');
    }

    const client = ollamaBase
      ? new OpenAI({ apiKey: 'ollama', baseURL: `${ollamaBase}/v1` })
      : new OpenAI({
          apiKey: openrouterKey,
          baseURL: 'https://openrouter.ai/api/v1',
        });

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      max_tokens: request.maxTokens ?? 500,
      temperature: request.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools as OpenAI.Chat.Completions.ChatCompletionTool[];
      if (request.toolChoice) {
        params.tool_choice = request.toolChoice as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
      }
    }

    const stream = await client.chat.completions.create(params);

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;

      if (delta?.content) {
        yield { type: 'content_delta', content: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          yield {
            type: 'tool_call_delta',
            toolCall: {
              index: tc.index,
              id: tc.id,
              name: tc.function?.name,
              argumentsDelta: tc.function?.arguments,
            },
          };
        }
      }

      if (chunk.usage) {
        const promptTokens = chunk.usage.prompt_tokens ?? 0;
        const completionTokens = chunk.usage.completion_tokens ?? 0;
        const costs = TOKEN_COST_PER_1K[model] || { input: 0, output: 0 };
        const estimatedCost =
          (promptTokens / 1000) * costs.input +
          (completionTokens / 1000) * costs.output;

        yield {
          type: 'usage',
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            estimatedCost: Math.round(estimatedCost * 10000) / 10000,
          },
        };
      }
    }

    yield { type: 'done' };
  }

  private hasBudgetCaps(caps?: BudgetCaps): boolean {
    if (!caps) return false;
    return !!(caps.monthlyOverall || caps.monthlyOpenai || caps.monthlyAnthropic || caps.monthlyXai || caps.monthlyKimi);
  }

  private getProviderBudgetCap(provider: AiProvider, caps?: BudgetCaps): number | undefined {
    if (!caps) return undefined;
    switch (provider) {
      case 'openai': return caps.monthlyOpenai;
      case 'anthropic': return caps.monthlyAnthropic;
      case 'xai': return caps.monthlyXai;
      case 'kimi': return caps.monthlyKimi;
      default: return undefined;
    }
  }

  private filterCandidatesByBudget(
    candidates: Array<{ provider: AiProvider; model: string }>,
    budgetCaps?: BudgetCaps,
    spendByProvider?: Record<string, number>,
    totalSpend?: number,
  ): Array<{ provider: AiProvider; model: string }> {
    if (!budgetCaps || !this.hasBudgetCaps(budgetCaps) || !spendByProvider) {
      return candidates;
    }

    if (budgetCaps.monthlyOverall && totalSpend !== undefined && totalSpend >= budgetCaps.monthlyOverall) {
      this.logger.warn(`Overall monthly budget cap ($${budgetCaps.monthlyOverall}) reached. Total spend: $${totalSpend.toFixed(4)}`);
      return [];
    }

    return candidates.filter(candidate => {
      const providerCap = this.getProviderBudgetCap(candidate.provider, budgetCaps);
      if (providerCap === undefined) return true;
      const providerSpend = spendByProvider[candidate.provider] || 0;
      if (providerSpend >= providerCap) {
        this.logger.warn(
          `Provider ${candidate.provider} over budget cap ($${providerCap}). Spend: $${providerSpend.toFixed(4)}`,
        );
        return false;
      }
      return true;
    });
  }

  async getCurrentMonthSpend(businessId: string): Promise<{ total: number; byProvider: Record<string, number> }> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [totalAgg, byProviderRaw] = await Promise.all([
      this.prisma.client.aiUsageLog.aggregate({
        where: { businessId, createdAt: { gte: startOfMonth } },
        _sum: { estimatedCost: true },
      }),
      (this.prisma.client.aiUsageLog.groupBy as any)({
        by: ['provider'],
        where: { businessId, createdAt: { gte: startOfMonth } },
        _sum: { estimatedCost: true },
      }),
    ]);

    const byProvider: Record<string, number> = {};
    for (const row of byProviderRaw as any[]) {
      byProvider[row.provider] = row._sum?.estimatedCost ?? 0;
    }

    return {
      total: totalAgg._sum.estimatedCost ?? 0,
      byProvider,
    };
  }

  async getBudgetStatus(businessId: string): Promise<BudgetStatus> {
    const preferences = await this.getPreferences(businessId);
    const budgetCaps = preferences.budgetCaps;
    const spend = await this.getCurrentMonthSpend(businessId);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const overallCap = budgetCaps?.monthlyOverall ?? null;
    const overallUtilization = overallCap ? (spend.total / overallCap) * 100 : null;

    const byProvider: ProviderBudgetStatus[] = (['openai', 'anthropic', 'xai', 'kimi'] as AiProvider[]).map(provider => {
      const cap = this.getProviderBudgetCap(provider, budgetCaps) ?? null;
      const providerSpend = spend.byProvider[provider] || 0;
      const remaining = cap !== null ? Math.max(0, cap - providerSpend) : null;
      const utilizationPct = cap !== null && cap > 0 ? (providerSpend / cap) * 100 : null;

      return {
        provider,
        budgetCap: cap,
        spent: Math.round(providerSpend * 10000) / 10000,
        remaining: remaining !== null ? Math.round(remaining * 10000) / 10000 : null,
        utilizationPct: utilizationPct !== null ? Math.round(utilizationPct * 100) / 100 : null,
        isOverBudget: cap !== null && providerSpend >= cap,
        isNearLimit: cap !== null && utilizationPct !== null && utilizationPct >= BUDGET_NEAR_LIMIT_THRESHOLD * 100,
      };
    });

    return {
      overall: {
        budgetCap: overallCap,
        spent: Math.round(spend.total * 10000) / 10000,
        remaining: overallCap !== null ? Math.round(Math.max(0, overallCap - spend.total) * 10000) / 10000 : null,
        utilizationPct: overallUtilization !== null ? Math.round(overallUtilization * 100) / 100 : null,
        isOverBudget: overallCap !== null && spend.total >= overallCap,
        isNearLimit: overallCap !== null && overallUtilization !== null && overallUtilization >= BUDGET_NEAR_LIMIT_THRESHOLD * 100,
      },
      byProvider,
      periodStart,
      periodEnd,
    };
  }

  private resolveStrategy(
    request: GatewayRequest,
    mode: AiMode,
    _preferences: AiPreferences,
  ): ModelStrategy {
    if (request.providerOverride && request.modelOverride) {
      return {
        primary: { provider: request.providerOverride, model: request.modelOverride },
        fallbacks: this.routingTable[mode][request.taskCategory]?.fallbacks ?? [],
      };
    }

    return this.routingTable[mode][request.taskCategory] || this.routingTable[mode].general;
  }

  private isProviderAvailable(provider: AiProvider, preferences: AiPreferences): boolean {
    if (provider === 'openai') {
      return !!(preferences.byokOpenai || process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
    }
    if (provider === 'anthropic') {
      return !!(preferences.byokAnthropic || process.env.ANTHROPIC_API_KEY);
    }
    if (provider === 'xai') {
      return !!(preferences.byokXai || process.env.XAI_API_KEY);
    }
    if (provider === 'kimi') {
      return !!(preferences.byokKimi || process.env.KIMI_API_KEY);
    }
    if (provider === 'native') {
      return !!(preferences.byokNative || process.env.NATIVE_AI_API_KEY || process.env.KEYFLOW_NATIVE_AI_URL);
    }
    if (provider === 'opensource') {
      return !!(process.env.OPENROUTER_API_KEY || process.env.OLLAMA_BASE_URL);
    }
    return false;
  }

  private async executeWithRetries(
    request: GatewayRequest,
    provider: AiProvider,
    model: string,
    preferences: AiPreferences,
  ): Promise<GatewayResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= ModelGatewayService.MAX_RETRIES; attempt++) {
      try {
        const startTime = Date.now();
        const result = await this.callProvider(request, provider, model, preferences);
        const latencyMs = Date.now() - startTime;

        this.recordProviderSuccess(provider, latencyMs);

        return {
          ...result,
          provider,
          model,
          latencyMs,
          fallbackUsed: false,
        };
      } catch (err: any) {
        lastError = err as Error;

        if (this.isRetryable(lastError) && attempt < ModelGatewayService.MAX_RETRIES) {
          await this.delay(ModelGatewayService.RETRY_DELAY_MS * (attempt + 1));
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error('Exhausted retries');
  }

  private async callProvider(
    request: GatewayRequest,
    provider: AiProvider,
    model: string,
    preferences: AiPreferences,
  ): Promise<Omit<GatewayResponse, 'provider' | 'model' | 'latencyMs' | 'fallbackUsed' | 'fallbackProvider'>> {
    const normalizedMessages = this.normalizeMessages(request.messages, provider);

    switch (provider) {
      case 'openai':
        return this.callOpenAi(normalizedMessages, model, request, preferences.byokOpenai);
      case 'anthropic':
        return this.callAnthropic(normalizedMessages, model, request, preferences.byokAnthropic);
      case 'xai':
        return this.callXai(normalizedMessages, model, request, preferences.byokXai);
      case 'kimi':
        return this.callKimi(normalizedMessages, model, request, preferences.byokKimi);
      case 'native':
        return this.callNative(normalizedMessages, model, request, preferences.byokNative);
      case 'opensource':
        return this.callOpensource(normalizedMessages, model, request);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  private normalizeMessages(messages: GatewayMessage[], provider: AiProvider): GatewayMessage[] {
    if (provider === 'openai' || provider === 'xai' || provider === 'kimi' || provider === 'native' || provider === 'opensource') {
      return messages;
    }

    if (provider === 'anthropic') {
      return messages.map(msg => {
        if (msg.role === 'system') {
          return msg;
        }
        return msg;
      });
    }

    return messages;
  }

  private async callOpenAi(
    messages: GatewayMessage[],
    model: string,
    request: GatewayRequest,
    byokKey?: string,
  ): Promise<Omit<GatewayResponse, 'provider' | 'model' | 'latencyMs' | 'fallbackUsed' | 'fallbackProvider'>> {
    const client = byokKey
      ? new OpenAI({ apiKey: byokKey })
      : this.openai;

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      max_tokens: request.maxTokens ?? 500,
      temperature: request.temperature ?? 0.7,
    };

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools as OpenAI.Chat.Completions.ChatCompletionTool[];
      if (request.toolChoice) {
        params.tool_choice = request.toolChoice as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
      }
    }

    const response = await client.chat.completions.create(params);

    const choice = response.choices[0];
    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const totalTokens = promptTokens + completionTokens;
    const costs = TOKEN_COST_PER_1K[model] || TOKEN_COST_PER_1K['gpt-4o'];
    const estimatedCost =
      (promptTokens / 1000) * costs.input +
      (completionTokens / 1000) * costs.output;

    const toolCalls = choice?.message?.tool_calls
      ?.filter(tc => tc.type === 'function')
      .map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));

    return {
      content: choice?.message?.content ?? null,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCost: Math.round(estimatedCost * 10000) / 10000,
      },
    };
  }

  private async callAnthropic(
    messages: GatewayMessage[],
    model: string,
    request: GatewayRequest,
    byokKey?: string,
  ): Promise<Omit<GatewayResponse, 'provider' | 'model' | 'latencyMs' | 'fallbackUsed' | 'fallbackProvider'>> {
    const apiKey = byokKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Anthropic API key not configured');

    let systemPrompt = '';
    const nonSystemMessages: Array<{ role: string; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n\n' : '') + (msg.content || '');
      } else if (msg.role === 'tool') {
        nonSystemMessages.push({
          role: 'user',
          content: `[Tool result for ${msg.tool_call_id}]: ${msg.content}`,
        });
      } else {
        nonSystemMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content || '',
        });
      }
    }

    if (nonSystemMessages.length === 0) {
      nonSystemMessages.push({ role: 'user', content: 'Please respond.' });
    }

    const mergedMessages: Array<{ role: string; content: string }> = [];
    for (const msg of nonSystemMessages) {
      if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === msg.role) {
        mergedMessages[mergedMessages.length - 1].content += '\n\n' + msg.content;
      } else {
        mergedMessages.push({ ...msg });
      }
    }

    if (mergedMessages.length > 0 && mergedMessages[0].role !== 'user') {
      mergedMessages.unshift({ role: 'user', content: 'Continue.' });
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? 500,
      temperature: request.temperature ?? 0.7,
      messages: mergedMessages,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => ({
        name: t.function.name,
        description: t.function.description || '',
        input_schema: t.function.parameters || { type: 'object', properties: {} },
      }));
      if (request.toolChoice === 'auto') {
        body.tool_choice = { type: 'auto' };
      } else if (request.toolChoice === 'required') {
        body.tool_choice = { type: 'any' };
      } else if (typeof request.toolChoice === 'object' && request.toolChoice?.function?.name) {
        body.tool_choice = { type: 'tool', name: request.toolChoice.function.name };
      }
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
    }

    interface AnthropicContentBlock {
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }

    const data: {
      content: AnthropicContentBlock[];
      usage?: { input_tokens?: number; output_tokens?: number };
    } = await response.json();

    const textBlocks = data.content?.filter(block => block.type === 'text') ?? [];
    const content = textBlocks.length > 0
      ? textBlocks.map(block => block.text ?? '').join('')
      : null;

    const toolUseBlocks = data.content?.filter(block => block.type === 'tool_use') ?? [];
    const toolCalls = toolUseBlocks.length > 0
      ? toolUseBlocks.map((block) => {
          return {
            id: block.id ?? `call_${Date.now()}`,
            type: 'function' as const,
            'function': {
              name: block.name ?? '',
              'arguments': JSON.stringify(block.input ?? {}),
            },
          };
        })
      : undefined;

    const promptTokens = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;
    const totalTokens = promptTokens + completionTokens;
    const costs = TOKEN_COST_PER_1K[model] || TOKEN_COST_PER_1K['claude-3-5-sonnet-20241022'];
    const estimatedCost =
      (promptTokens / 1000) * costs.input +
      (completionTokens / 1000) * costs.output;

    return {
      content,
      toolCalls,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCost: Math.round(estimatedCost * 10000) / 10000,
      },
    };
  }

  private async callXai(
    messages: GatewayMessage[],
    model: string,
    request: GatewayRequest,
    byokKey?: string,
  ): Promise<Omit<GatewayResponse, 'provider' | 'model' | 'latencyMs' | 'fallbackUsed' | 'fallbackProvider'>> {
    const apiKey = byokKey || process.env.XAI_API_KEY;
    if (!apiKey) throw new Error('xAI API key not configured');

    const client = new OpenAI({
      apiKey,
      baseURL: 'https://api.x.ai/v1',
    });

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      max_tokens: request.maxTokens ?? 500,
      temperature: request.temperature ?? 0.7,
    };

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools as OpenAI.Chat.Completions.ChatCompletionTool[];
      if (request.toolChoice) {
        params.tool_choice = request.toolChoice as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
      }
    }

    const response = await client.chat.completions.create(params);

    const choice = response.choices[0];
    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const totalTokens = promptTokens + completionTokens;
    const costs = TOKEN_COST_PER_1K[model] || TOKEN_COST_PER_1K['grok-2'];
    const estimatedCost =
      (promptTokens / 1000) * costs.input +
      (completionTokens / 1000) * costs.output;

    const xaiToolCalls = choice?.message?.tool_calls
      ?.filter(tc => tc.type === 'function')
      .map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));

    return {
      content: choice?.message?.content ?? null,
      toolCalls: xaiToolCalls && xaiToolCalls.length > 0 ? xaiToolCalls : undefined,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCost: Math.round(estimatedCost * 10000) / 10000,
      },
    };
  }

  private async callKimi(
    messages: GatewayMessage[],
    model: string,
    request: GatewayRequest,
    byokKey?: string,
  ): Promise<Omit<GatewayResponse, 'provider' | 'model' | 'latencyMs' | 'fallbackUsed' | 'fallbackProvider'>> {
    const apiKey = byokKey || process.env.KIMI_API_KEY;
    if (!apiKey) throw new Error('Kimi API key not configured');

    const client = new OpenAI({
      apiKey,
      baseURL: 'https://api.moonshot.cn/v1',
    });

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      max_tokens: request.maxTokens ?? 500,
      temperature: request.temperature ?? 0.7,
    };

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools as OpenAI.Chat.Completions.ChatCompletionTool[];
      if (request.toolChoice) {
        params.tool_choice = request.toolChoice as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
      }
    }

    const response = await client.chat.completions.create(params);

    const choice = response.choices[0];
    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const totalTokens = promptTokens + completionTokens;
    const costs = TOKEN_COST_PER_1K[model] || TOKEN_COST_PER_1K['moonshot-v1-8k'];
    const estimatedCost =
      (promptTokens / 1000) * costs.input +
      (completionTokens / 1000) * costs.output;

    const kimiToolCalls = choice?.message?.tool_calls
      ?.filter(tc => tc.type === 'function')
      .map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));

    return {
      content: choice?.message?.content ?? null,
      toolCalls: kimiToolCalls && kimiToolCalls.length > 0 ? kimiToolCalls : undefined,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCost: Math.round(estimatedCost * 10000) / 10000,
      },
    };
  }

  private async callNative(
    messages: GatewayMessage[],
    model: string,
    request: GatewayRequest,
    byokKey?: string,
  ): Promise<Omit<GatewayResponse, 'provider' | 'model' | 'latencyMs' | 'fallbackUsed' | 'fallbackProvider'>> {
    const apiKey = byokKey || process.env.NATIVE_AI_API_KEY || 'native-key';
    const baseURL = process.env.KEYFLOW_NATIVE_AI_URL || process.env.NATIVE_AI_BASE_URL;
    if (!baseURL) throw new Error('Native AI base URL not configured');

    const client = new OpenAI({
      apiKey,
      baseURL,
    });

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      max_tokens: request.maxTokens ?? 500,
      temperature: request.temperature ?? 0.7,
    };

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools as OpenAI.Chat.Completions.ChatCompletionTool[];
      if (request.toolChoice) {
        params.tool_choice = request.toolChoice as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
      }
    }

    const response = await client.chat.completions.create(params);

    const choice = response.choices[0];
    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const totalTokens = promptTokens + completionTokens;
    const costs = TOKEN_COST_PER_1K[model] || { input: 0, output: 0 };
    const estimatedCost =
      (promptTokens / 1000) * costs.input +
      (completionTokens / 1000) * costs.output;

    const nativeToolCalls = choice?.message?.tool_calls
      ?.filter(tc => tc.type === 'function')
      .map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));

    return {
      content: choice?.message?.content ?? null,
      toolCalls: nativeToolCalls && nativeToolCalls.length > 0 ? nativeToolCalls : undefined,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCost: Math.round(estimatedCost * 10000) / 10000,
      },
    };
  }

  private async callOpensource(
    messages: GatewayMessage[],
    model: string,
    request: GatewayRequest,
  ): Promise<Omit<GatewayResponse, 'provider' | 'model' | 'latencyMs' | 'fallbackUsed' | 'fallbackProvider'>> {
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const ollamaBase = process.env.OLLAMA_BASE_URL;

    if (!openrouterKey && !ollamaBase) {
      throw new Error('No open-source AI provider configured (OPENROUTER_API_KEY or OLLAMA_BASE_URL)');
    }

    const client = ollamaBase
      ? new OpenAI({ apiKey: 'ollama', baseURL: `${ollamaBase}/v1` })
      : new OpenAI({
          apiKey: openrouterKey,
          baseURL: 'https://openrouter.ai/api/v1',
        });

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      max_tokens: request.maxTokens ?? 500,
      temperature: request.temperature ?? 0.7,
    };

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools as OpenAI.Chat.Completions.ChatCompletionTool[];
      if (request.toolChoice) {
        params.tool_choice = request.toolChoice as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
      }
    }

    const response = await client.chat.completions.create(params);

    const choice = response.choices[0];
    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const totalTokens = promptTokens + completionTokens;
    const costs = TOKEN_COST_PER_1K[model] || { input: 0, output: 0 };
    const estimatedCost =
      (promptTokens / 1000) * costs.input +
      (completionTokens / 1000) * costs.output;

    const osToolCalls = choice?.message?.tool_calls
      ?.filter(tc => tc.type === 'function')
      .map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));

    return {
      content: choice?.message?.content ?? null,
      toolCalls: osToolCalls && osToolCalls.length > 0 ? osToolCalls : undefined,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCost: Math.round(estimatedCost * 10000) / 10000,
      },
    };
  }

  async getPreferences(businessId: string): Promise<AiPreferences> {
    const cached = this.preferencesCache.get(businessId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    try {
      const memory = await this.prisma.client.aiMemory.findUnique({
        where: {
          businessId_category_key: {
            businessId,
            category: 'settings',
            key: 'ai_preferences',
          },
        },
      });

      if (memory?.value) {
        const parsed = JSON.parse(memory.value);
        const prefs: AiPreferences = { ...DEFAULT_PREFERENCES, ...parsed };

        if (prefs.byokOpenai) prefs.byokOpenai = this.safeDecrypt(prefs.byokOpenai);
        if (prefs.byokAnthropic) prefs.byokAnthropic = this.safeDecrypt(prefs.byokAnthropic);
        if (prefs.byokXai) prefs.byokXai = this.safeDecrypt(prefs.byokXai);
        if (prefs.byokKimi) prefs.byokKimi = this.safeDecrypt(prefs.byokKimi);
        if (prefs.byokNative) prefs.byokNative = this.safeDecrypt(prefs.byokNative);

        this.preferencesCache.set(businessId, {
          data: prefs,
          expiresAt: Date.now() + ModelGatewayService.PREFERENCES_TTL_MS,
        });
        return prefs;
      }
    } catch {
      /* intentionally empty */
    }

    this.preferencesCache.set(businessId, {
      data: DEFAULT_PREFERENCES,
      expiresAt: Date.now() + ModelGatewayService.PREFERENCES_TTL_MS,
    });
    return { ...DEFAULT_PREFERENCES };
  }

  private safeDecrypt(value: string): string {
    if (!value || !value.includes(':')) return value;
    try {
      return this.decryptSecret(value);
    } catch {
      return value;
    }
  }

  async updatePreferences(
    businessId: string,
    updates: Partial<AiPreferences>,
  ): Promise<AiPreferences> {
    const hasByokUpdate = !!(
      (updates.byokOpenai && updates.byokOpenai !== '') ||
      (updates.byokAnthropic && updates.byokAnthropic !== '') ||
      (updates.byokXai && updates.byokXai !== '') ||
      (updates.byokKimi && updates.byokKimi !== '') ||
      (updates.byokNative && updates.byokNative !== '')
    );
    if (hasByokUpdate && !this.byokEncryptionAvailable) {
      throw new Error('BYOK key storage requires BYOK_ENCRYPTION_SECRET to be configured');
    }

    const current = await this.getPreferences(businessId);
    const merged = { ...current, ...updates };

    if (merged.byokOpenai === '') merged.byokOpenai = undefined;
    if (merged.byokAnthropic === '') merged.byokAnthropic = undefined;
    if (merged.byokXai === '') merged.byokXai = undefined;
    if (merged.byokKimi === '') merged.byokKimi = undefined;
    if (merged.byokNative === '') merged.byokNative = undefined;

    const validModes: AiMode[] = ['balanced', 'premium', 'fast'];
    if (!validModes.includes(merged.aiMode)) {
      merged.aiMode = 'balanced';
    }

    const toStore = { ...merged };
    if (toStore.byokOpenai) toStore.byokOpenai = this.encryptSecret(toStore.byokOpenai);
    if (toStore.byokAnthropic) toStore.byokAnthropic = this.encryptSecret(toStore.byokAnthropic);
    if (toStore.byokXai) toStore.byokXai = this.encryptSecret(toStore.byokXai);
    if (toStore.byokKimi) toStore.byokKimi = this.encryptSecret(toStore.byokKimi);
    if (toStore.byokNative) toStore.byokNative = this.encryptSecret(toStore.byokNative);

    await this.prisma.client.aiMemory.upsert({
      where: {
        businessId_category_key: {
          businessId,
          category: 'settings',
          key: 'ai_preferences',
        },
      },
      create: {
        businessId,
        category: 'settings',
        key: 'ai_preferences',
        value: JSON.stringify(toStore),
        source: 'user',
      },
      update: {
        value: JSON.stringify(toStore),
      },
    });

    this.preferencesCache.delete(businessId);
    return merged;
  }

  getProviderHealth(): ProviderHealth[] {
    const results: ProviderHealth[] = [];

    for (const provider of ['openai', 'anthropic', 'xai', 'kimi', 'native', 'opensource'] as AiProvider[]) {
      const config = this.providerClients.get(provider);
      const metrics = this.providerMetrics.get(provider)!;

      const recentLatencies = metrics.latencies.slice(-100);
      const avgLatency = recentLatencies.length > 0
        ? recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length
        : 0;
      const errorRate = metrics.totalCalls > 0
        ? metrics.totalErrors / metrics.totalCalls
        : 0;

      results.push({
        provider,
        available: !!config?.configured,
        configured: !!config?.configured,
        avgLatencyMs: Math.round(avgLatency),
        errorRate: Math.round(errorRate * 10000) / 10000,
        lastErrorAt: metrics.lastErrorAt,
        totalCalls: metrics.totalCalls,
        totalErrors: metrics.totalErrors,
      });
    }

    return results;
  }

  getRoutingConfig(): Record<AiMode, Record<TaskCategory, ModelStrategy>> {
    return this.routingTable;
  }

  async loadRoutingConfig(): Promise<void> {
    try {
      const config = await this.prisma.client.aiMemory.findUnique({
        where: {
          businessId_category_key: {
            businessId: '__system__',
            category: 'settings',
            key: 'routing_table',
          },
        },
      });

      if (config?.value) {
        const parsed = JSON.parse(config.value);
        this.routingTable = this.mergeWithDefaults(parsed);
        this.logger.log('Loaded routing config from database');
      }
    } catch (err: any) {
      this.logger.warn(`Failed to load routing config from DB, using defaults: ${(err as Error).message}`);
    }
    this.routingTableLoaded = true;
  }

  async updateRoutingConfig(
    updates: Partial<Record<AiMode, Partial<Record<TaskCategory, ModelStrategy>>>>,
  ): Promise<Record<AiMode, Record<TaskCategory, ModelStrategy>>> {
    for (const mode of Object.keys(updates) as AiMode[]) {
      if (!this.routingTable[mode]) continue;
      const modeUpdates = updates[mode];
      if (!modeUpdates) continue;
      for (const task of Object.keys(modeUpdates) as TaskCategory[]) {
        const strategy = modeUpdates[task];
        if (strategy) {
          this.routingTable[mode][task] = strategy;
        }
      }
    }

    await this.prisma.client.aiMemory.upsert({
      where: {
        businessId_category_key: {
          businessId: '__system__',
          category: 'settings',
          key: 'routing_table',
        },
      },
      create: {
        businessId: '__system__',
        category: 'settings',
        key: 'routing_table',
        value: JSON.stringify(this.routingTable),
        source: 'admin',
      },
      update: {
        value: JSON.stringify(this.routingTable),
      },
    });

    this.logger.log('Routing config updated and persisted');
    return this.routingTable;
  }

  private mergeWithDefaults(
    stored: Record<string, Record<string, ModelStrategy>>,
  ): Record<AiMode, Record<TaskCategory, ModelStrategy>> {
    const result = structuredClone(DEFAULT_ROUTING_TABLE);
    for (const mode of Object.keys(stored) as AiMode[]) {
      if (!result[mode]) continue;
      for (const task of Object.keys(stored[mode]) as TaskCategory[]) {
        if (stored[mode][task]?.primary) {
          result[mode][task] = stored[mode][task];
        }
      }
    }
    return result;
  }

  private recordProviderSuccess(provider: AiProvider, latencyMs: number): void {
    const metrics = this.providerMetrics.get(provider);
    if (metrics) {
      metrics.totalCalls++;
      metrics.latencies.push(latencyMs);
      if (metrics.latencies.length > 500) {
        metrics.latencies = metrics.latencies.slice(-250);
      }
    }
  }

  private recordProviderError(provider: AiProvider): void {
    const metrics = this.providerMetrics.get(provider);
    if (metrics) {
      metrics.totalCalls++;
      metrics.totalErrors++;
      metrics.lastErrorAt = new Date();
    }
  }

  private isRetryable(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('rate limit') ||
      msg.includes('timeout') ||
      msg.includes('429') ||
      msg.includes('503') ||
      msg.includes('500') ||
      msg.includes('econnreset') ||
      msg.includes('socket hang up')
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
