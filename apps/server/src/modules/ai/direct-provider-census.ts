/**
 * RR-DIRECT-PROVIDER-CENSUS (D-261, D-262, D-17, D-257)
 *
 * Shrink-only registry of every non-test file in `apps/server/src` (outside
 * `model-gateway.service.ts`) that imports an LLM provider SDK, instantiates a
 * provider SDK client, or references a provider API hostname directly.
 *
 * Every entry records its purpose, whether calls are metered in `AiUsageLog`,
 * whether runtime invocation honours `KEY_DISABLED` (D-17), whether it supports
 * tenant BYOK, and the follow-up slice/rationale owning it.
 *
 * Enforced by `direct-provider-census.spec.ts`:
 *  - Any unregistered file matching a provider SDK or host fails CI.
 *  - Any registered file that no longer matches fails CI (shrink-only).
 */

export type DirectProviderSiteKind = 'direct-call' | 'non-calling-reference';

export interface DirectProviderCensusEntry {
  /** Path relative to repo root (`apps/server/src/...`). */
  readonly file: string;
  /** Whether this file invokes an upstream provider or only references SDK types/CSP hosts. */
  readonly kind: DirectProviderSiteKind;
  /** Concise description of what this file does with the provider SDK / host. */
  readonly purpose: string;
  /** Whether calls write `AiUsageLog` / enforce AI credits (false for non-calling refs & unmetered calls). */
  readonly metered: boolean;
  /** Whether runtime invocation honours `keyDisabled()` / `KEY_DISABLED` (D-17). */
  readonly honoursKeyDisabled: boolean;
  /** Whether calls honour tenant BYOK keys instead of only the platform key. */
  readonly supportsByok: boolean;
  /** Follow-up slice/packet or permanent rationale for retaining this site. */
  readonly migrationTarget: string;
}

export const DIRECT_PROVIDER_CENSUS: readonly DirectProviderCensusEntry[] = [
  {
    file: 'apps/server/src/app-bootstrap.ts',
    kind: 'non-calling-reference',
    purpose: 'Helmet CSP connectSrc allowlist entry for https://api.openai.com; makes no server-side provider calls.',
    metered: false,
    honoursKeyDisabled: false,
    supportsByok: false,
    migrationTarget: 'Retained (HTTP Helmet CSP header configuration; not an outbound API call site)',
  },
  {
    file: 'apps/server/src/modules/ai/ai-usage.service.ts',
    kind: 'direct-call',
    purpose: 'Direct OpenAI SDK calls for embeddings, vision completions, and audio with rate limiting, credits, and AiUsageLog metering.',
    metered: true,
    honoursKeyDisabled: true,
    supportsByok: false,
    migrationTarget: 'Later gateway slice: ModelGatewayService embed()/vision()/audio() surface',
  },
  {
    file: 'apps/server/src/modules/ai/provider-failure-class.ts',
    kind: 'non-calling-reference',
    purpose: 'Imports OpenAI SDK exclusively for instanceof error classification (APIUserAbortError, APIConnectionTimeoutError, APIConnectionError).',
    metered: false,
    honoursKeyDisabled: false,
    supportsByok: false,
    migrationTarget: 'Retained (pure error classifier; never constructs clients or sends requests)',
  },
  {
    file: 'apps/server/src/modules/diagnostics/diagnostics.service.ts',
    kind: 'direct-call',
    purpose: 'Platform operator health probe (checkOpenAI) calling GET /v1/models against AI_INTEGRATIONS_OPENAI_BASE_URL or https://api.openai.com.',
    metered: false,
    honoursKeyDisabled: true,
    supportsByok: false,
    migrationTarget: 'Retained (platform diagnostics health check; skipped under KEY_DISABLED)',
  },
  {
    file: 'apps/server/src/modules/key-cortex/key-cortex-document.service.ts',
    kind: 'direct-call',
    purpose: 'Direct OpenAI embeddings (generateEmbedding) for document indexing and RAG retrieval queries; writes no AiUsageLog row.',
    metered: false,
    honoursKeyDisabled: true,
    supportsByok: false,
    migrationTarget: 'Later gateway slice: ModelGatewayService.embed() (credit metering pending OQ-9; D-257 read-only here)',
  },
  {
    file: 'apps/server/src/modules/key-cortex/key-cortex-voice.service.ts',
    kind: 'direct-call',
    purpose: 'Direct OpenAI TTS (audio.speech.create) and Whisper STT (audio.transcriptions.create) metered via AiUsageService.trackAudioUsage.',
    metered: true,
    honoursKeyDisabled: true,
    supportsByok: false,
    migrationTarget: 'Later gateway slice: ModelGatewayService speak()/transcribe() surface',
  },
  {
    file: 'apps/server/src/modules/phone-voice/realtime-bridge.service.ts',
    kind: 'direct-call',
    purpose: 'Direct WebSocket bridge to wss://api.openai.com/v1/realtime?model=gpt-realtime for telephony g711_ulaw audio.',
    metered: false,
    honoursKeyDisabled: true,
    supportsByok: false,
    migrationTarget: 'Later gateway slice: realtime voice session metering and gateway bridge',
  },
];
