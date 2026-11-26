import type { AiProvider } from './model-gateway.service';

/**
 * RR-MODEL-LIFECYCLE-GUARD (P124): Owner-maintained model lifecycle catalog.
 *
 * Every (provider, modelId) referenced across PROVIDER_DEFAULT_MODEL,
 * DEFAULT_ROUTING_TABLE, TOKEN_COST_PER_1K, and KeyCortexProviderSelectionService
 * has an entry here. ModelGatewayService refuses to dispatch any candidate whose
 * status is 'retired', regardless of origin (default routing table, DB-loaded
 * routing table, preferredProvider / PROVIDER_DEFAULT_MODEL, or per-request
 * providerOverride + modelOverride).
 *
 * Pending owner ruling OQ-3, every entry starts as 'unverified' with null
 * verification metadata so no default model is marked retired without explicit
 * owner confirmation against live provider deprecation docs.
 */

export const MODEL_LIFECYCLE_CATALOG_TOKEN = 'MODEL_LIFECYCLE_CATALOG';

export const MODEL_LIFECYCLE_STATUSES = [
  'active',
  'deprecated',
  'retired',
  'unverified',
] as const;

export type ModelLifecycleStatus = (typeof MODEL_LIFECYCLE_STATUSES)[number];

export interface ModelLifecycleEntry {
  readonly provider: AiProvider;
  readonly modelId: string;
  readonly status: ModelLifecycleStatus;
  readonly retiresOn: string | null;
  readonly source: string | null;
  readonly checkedAt: string | null;
  readonly checkedBy: string | null;
}

function unverified(provider: AiProvider, modelId: string): ModelLifecycleEntry {
  return Object.freeze({
    provider,
    modelId,
    status: 'unverified',
    retiresOn: null,
    source: null,
    checkedAt: null,
    checkedBy: null,
  });
}

export const MODEL_LIFECYCLE_CATALOG: readonly ModelLifecycleEntry[] = Object.freeze([
  // OpenAI — chat, embeddings, audio
  unverified('openai', 'gpt-4o'),
  unverified('openai', 'gpt-4o-mini'),
  unverified('openai', 'text-embedding-3-small'),
  unverified('openai', 'text-embedding-3-large'),
  unverified('openai', 'gpt-4o-mini-tts'),
  unverified('openai', 'tts-1'),
  unverified('openai', 'whisper-1'),

  // Anthropic
  unverified('anthropic', 'claude-3-5-sonnet-20241022'),
  unverified('anthropic', 'claude-3-5-haiku-20241022'),

  // Google (Gemini)
  unverified('google', 'gemini-2.0-flash'),
  unverified('google', 'gemini-2.5-pro'),

  // xAI (Grok)
  unverified('xai', 'grok-2'),
  unverified('xai', 'grok-2-mini'),

  // Moonshot (Kimi)
  unverified('kimi', 'moonshot-v1-8k'),
  unverified('kimi', 'moonshot-v1-32k'),
  unverified('kimi', 'moonshot-v1-128k'),

  // Infrastructure / self-hosted routes
  unverified('native', 'native-llm'),
  unverified('opensource', 'llama-3.1-70b'),
]);

/**
 * Look up the lifecycle catalog entry for a (provider, modelId) pair.
 * Normalizes whitespace and ASCII case so padded or mixed-case overrides
 * cannot bypass a retired entry.
 */
export function getModelLifecycleEntry(
  provider: string,
  modelId: string,
  catalog: readonly ModelLifecycleEntry[] = MODEL_LIFECYCLE_CATALOG,
): ModelLifecycleEntry | undefined {
  if (typeof provider !== 'string' || typeof modelId !== 'string') {
    return undefined;
  }
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedProvider || !normalizedModelId) {
    return undefined;
  }
  return catalog.find(
    (entry) =>
      entry.provider.trim().toLowerCase() === normalizedProvider &&
      entry.modelId.trim().toLowerCase() === normalizedModelId,
  );
}

/**
 * Look up the lifecycle status for a (provider, modelId) pair, or undefined if absent.
 */
export function getModelLifecycleStatus(
  provider: string,
  modelId: string,
  catalog: readonly ModelLifecycleEntry[] = MODEL_LIFECYCLE_CATALOG,
): ModelLifecycleStatus | undefined {
  return getModelLifecycleEntry(provider, modelId, catalog)?.status;
}

/**
 * Returns true if and only if the (provider, modelId) pair is explicitly marked
 * 'retired' in the catalog. Models with status 'active', 'deprecated',
 * 'unverified', or absent from the catalog are not treated as retired.
 */
export function isModelRetired(
  provider: string,
  modelId: string,
  catalog: readonly ModelLifecycleEntry[] = MODEL_LIFECYCLE_CATALOG,
): boolean {
  return getModelLifecycleStatus(provider, modelId, catalog) === 'retired';
}
