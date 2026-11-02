/**
 * Boot-time environment validation for the API server.
 *
 * Run as the very first thing inside `bootstrap()` (before NestFactory is
 * created) so a misconfigured environment fails with a single, readable
 * error message instead of producing a silent half-broken server.
 *
 * Required vars are mandatory in every environment.
 * Recommended vars only emit a warning when missing — they don't block boot.
 *
 * To skip validation entirely (e.g. one-off scripts) set
 * `KEYFLOW_SKIP_ENV_VALIDATION=1`.
 */

import { z } from 'zod';

const optionalNonEmpty = z
  .string()
  .trim()
  .min(1)
  .optional()
  .or(z.literal('').transform(() => undefined));

const requiredNonEmpty = z
  .string({ required_error: 'is required' })
  .trim()
  .min(1, 'must be a non-empty string');

const urlString = z
  .string()
  .trim()
  .min(1)
  .refine((s) => /^https?:\/\//i.test(s), 'must start with http:// or https://');

const RequiredSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z
    .string()
    .default('3001')
    .refine((s) => /^\d+$/.test(s) && Number(s) > 0 && Number(s) < 65536, 'must be a valid TCP port'),
  DATABASE_URL: requiredNonEmpty,
});

const RecommendedSchema = z.object({
  // Auth / Supabase — required for real auth, but missing-only-warns so dev
  // boot with the dev-auth bypass still works.
  SUPABASE_URL: optionalNonEmpty,
  SUPABASE_JWT_SECRET: optionalNonEmpty,
  SUPABASE_ANON_KEY: optionalNonEmpty,
  JWT_SECRET: optionalNonEmpty,

  // OpenAI / AI providers — only warn when missing; AI features will degrade
  // gracefully but the server still boots.
  AI_INTEGRATIONS_OPENAI_API_KEY: optionalNonEmpty,
  ANTHROPIC_API_KEY: optionalNonEmpty,
  XAI_API_KEY: optionalNonEmpty,

  // Public URLs
  APP_URL: optionalNonEmpty.refine((v) => v === undefined || /^https?:\/\//i.test(v), 'must start with http:// or https://'),
  API_URL: optionalNonEmpty.refine((v) => v === undefined || /^https?:\/\//i.test(v), 'must start with http:// or https://'),
  PUBLIC_BASE_URL: optionalNonEmpty.refine((v) => v === undefined || /^https?:\/\//i.test(v), 'must start with http:// or https://'),

  // Queues / cache
  REDIS_URL: optionalNonEmpty,
});

/**
 * S3 group: if ANY S3_* var is set, the full required subset must be present.
 * (S3_ENDPOINT and S3_PUBLIC_URL stay optional — empty endpoint means AWS S3.)
 */
function validateS3Group(env: NodeJS.ProcessEnv): string[] {
  const errors: string[] = [];
  const s3Keys = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_ENDPOINT', 'S3_PUBLIC_URL', 'S3_FORCE_PATH_STYLE'];
  const anySet = s3Keys.some((k) => (env[k] ?? '').trim() !== '');
  if (!anySet) return errors;
  const required = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  for (const k of required) {
    if (!env[k] || env[k]!.trim() === '') {
      errors.push(`${k}: required because another S3_* var is set (full S3 config must be provided as a group)`);
    }
  }
  if (env.S3_ENDPOINT && !/^https?:\/\//i.test(env.S3_ENDPOINT)) {
    errors.push('S3_ENDPOINT: must start with http:// or https://');
  }
  return errors;
}

/**
 * If the OAuth feature is in use (any provider key is set) we do not block
 * boot, but we surface a warning when the partner var is missing — this
 * catches `GOOGLE_CLIENT_ID` set without `GOOGLE_CLIENT_SECRET` etc.
 */
function validateOAuthGroups(env: NodeJS.ProcessEnv): string[] {
  const warnings: string[] = [];
  const pairs: [string, string][] = [
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
    ['PAYPAL_CLIENT_ID', 'PAYPAL_WEBHOOK_ID'],
  ];
  for (const [a, b] of pairs) {
    const aSet = !!env[a] && env[a]!.trim() !== '';
    const bSet = !!env[b] && env[b]!.trim() !== '';
    if (aSet !== bSet) {
      warnings.push(`${aSet ? b : a}: missing — set together with ${aSet ? a : b}`);
    }
  }
  return warnings;
}

/**
 * R0-SEC-02: values for SUPABASE_JWT_SECRET that are public, so a server
 * holding one lets anyone mint tokens it verifies locally. Every non-empty
 * value the repository has shipped for the variable (log -S on
 * 'SUPABASE_JWT_SECRET='):
 *   - `your-supabase-jwt-signing-secret`: `.env.example` until the R0-14 review
 *     repair (added in ecb7bba7, removed in f6554848);
 *   - `your-jwt-secret`: DEPLOYMENT.md, for local use (:73) and inside the
 *     NODE_ENV=production Railway block (:183) (review repair SEC02-R1 / CR-2).
 * Compared after trimming. env.spec.ts fails when a doc or template ships a
 * value that is not listed here.
 */
const PUBLIC_SUPABASE_JWT_SECRET_PLACEHOLDERS = new Set(['your-supabase-jwt-signing-secret', 'your-jwt-secret']);

/**
 * Production refuses to boot with a public placeholder in SUPABASE_JWT_SECRET;
 * any other NODE_ENV gets a warning. The value is never echoed.
 */
function validateJwtSecretPlaceholder(env: NodeJS.ProcessEnv): { errors: string[]; warnings: string[] } {
  const value = (env.SUPABASE_JWT_SECRET ?? '').trim();
  if (!PUBLIC_SUPABASE_JWT_SECRET_PLACEHOLDERS.has(value)) return { errors: [], warnings: [] };
  const message =
    'SUPABASE_JWT_SECRET: is a public placeholder (from .env.example or DEPLOYMENT.md), so anyone can sign tokens this server verifies locally. ' +
    'For Release 0 leave it empty (docs/auth-pathway.md); never deploy a placeholder in it';
  return env.NODE_ENV === 'production'
    ? { errors: [message], warnings: [] }
    : { errors: [], warnings: [message] };
}

export type ServerEnv = z.infer<typeof RequiredSchema> & z.infer<typeof RecommendedSchema>;

export interface EnvValidationReport {
  ok: boolean;
  missingRequired: string[];
  warnings: string[];
}

export function validateServerEnv(env: NodeJS.ProcessEnv = process.env): EnvValidationReport {
  if (env.KEYFLOW_SKIP_ENV_VALIDATION === '1' || env.KEYFLOW_SKIP_ENV_VALIDATION === 'true') {
    return { ok: true, missingRequired: [], warnings: ['env validation skipped via KEYFLOW_SKIP_ENV_VALIDATION'] };
  }

  const missingRequired: string[] = [];
  const warnings: string[] = [];

  const requiredResult = RequiredSchema.safeParse({
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    DATABASE_URL: env.DATABASE_URL,
  });
  if (!requiredResult.success) {
    for (const issue of requiredResult.error.issues) {
      missingRequired.push(`${issue.path.join('.') || '<root>'}: ${issue.message}`);
    }
  }

  const recommendedResult = RecommendedSchema.safeParse({
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET,
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
    JWT_SECRET: env.JWT_SECRET,
    AI_INTEGRATIONS_OPENAI_API_KEY: env.AI_INTEGRATIONS_OPENAI_API_KEY,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    XAI_API_KEY: env.XAI_API_KEY,
    APP_URL: env.APP_URL,
    API_URL: env.API_URL,
    PUBLIC_BASE_URL: env.PUBLIC_BASE_URL,
    REDIS_URL: env.REDIS_URL,
  });
  if (!recommendedResult.success) {
    for (const issue of recommendedResult.error.issues) {
      warnings.push(`${issue.path.join('.') || '<root>'}: ${issue.message}`);
    }
  } else {
    const r = recommendedResult.data;
    if (!r.SUPABASE_URL && !env.NEXT_PUBLIC_SUPABASE_URL) {
      warnings.push('SUPABASE_URL: not set (and no NEXT_PUBLIC_SUPABASE_URL fallback) — all authenticated requests will be rejected');
    }
    if (!r.SUPABASE_JWT_SECRET) {
      warnings.push('SUPABASE_JWT_SECRET: not set — local JWT verification unavailable; backend will rely on Supabase getUser() round-trip only');
    }
    if (!r.AI_INTEGRATIONS_OPENAI_API_KEY && !r.ANTHROPIC_API_KEY && !r.XAI_API_KEY) {
      warnings.push('AI provider keys: none of AI_INTEGRATIONS_OPENAI_API_KEY/ANTHROPIC_API_KEY/XAI_API_KEY set — AI features will return errors');
    }
    if (!r.REDIS_URL) {
      warnings.push('REDIS_URL: not set — BullMQ background jobs will fail to start');
    }
    if (env.KEYFLOW_DEV_AUTH_BYPASS === 'true' || env.KEYFLOW_DEV_AUTH_BYPASS === '1') {
      warnings.push('KEYFLOW_DEV_AUTH_BYPASS is enabled — the server will exit immediately to prevent insecure boot');
    }
  }

  const placeholder = validateJwtSecretPlaceholder(env);
  missingRequired.push(...placeholder.errors);
  warnings.push(...placeholder.warnings);

  missingRequired.push(...validateS3Group(env));
  warnings.push(...validateOAuthGroups(env));

  return {
    ok: missingRequired.length === 0,
    missingRequired,
    warnings,
  };
}

export function ensureValidServerEnv(env: NodeJS.ProcessEnv = process.env): void {
  const report = validateServerEnv(env);
  if (report.warnings.length > 0) {
     
    console.warn('[env] Recommended config issues:\n' + report.warnings.map((w) => `  - ${w}`).join('\n'));
  }
  if (!report.ok) {
     
    console.error(
      '[FATAL] Environment validation failed:\n' +
        report.missingRequired.map((m) => `  - ${m}`).join('\n') +
        '\n\nFix the variables listed above (see .env.example for documentation) and restart.',
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Kill switches (V1-24-KEY-KILL-SWITCHES; M47, M52, PRS-M05; owner ruling D-17)
//
// Read from process.env at the moment of the decision, not cached at import,
// so a spec can flip them and a scheduler or dispatch reads the current value.
// ---------------------------------------------------------------------------

/** An on/off env flag is on when it is '1' or 'true' (any case, surrounding space ignored). */
export function envFlagOn(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true';
}

/**
 * The unified scheduler kill switch, for every scheduler in the server: the
 * OnModuleInit interval schedulers, timers armed elsewhere, every @Cron,
 * @Interval and @Timeout handler (V1-24b), and the BullMQ repeatables seeded
 * at boot (the tenants' AI cron triggers and the temporal-flow-memory
 * compaction: not registered, and not run by this process; V1-24b review
 * SEC-V124b-1, CR-V124b-1). True when DISABLE_SCHEDULERS or
 * KF_DISABLE_SCHEDULERS is on, or NODE_ENV is 'test' (the repo convention since
 * invoice-overdue.scheduler.ts, now in one place) unless the test opted in with
 * ENABLE_SCHEDULERS_IN_TEST. KF_DISABLE_SCHEDULERS is the older spelling
 * calendar-sync and crm-data-quality read; it is honoured here so either name
 * stops every scheduler that calls this. A scheduler's own *_SCHEDULER_DISABLED
 * flag stays its own and is checked beside this, not replaced by it.
 *
 * Why NODE_ENV=test: integration suites share one database. A scheduler that
 * ticks inside one suite's app (in-process, or a spawned dist/main.js) stamps
 * rows another suite is asserting on (crm-data-quality's
 * data_quality_last_run_at, the connector nightly sync's connector rows).
 */
export function schedulersDisabled(): boolean {
  return (
    envFlagOn(process.env.DISABLE_SCHEDULERS) ||
    envFlagOn(process.env.KF_DISABLE_SCHEDULERS) ||
    (process.env.NODE_ENV === 'test' && !schedulersOptedInForTest())
  );
}

/**
 * V1-24b: the explicit opt-in a spec sets (1 or true) to run a scheduler, or
 * call a scheduled handler directly, under NODE_ENV=test. It only lifts the
 * NODE_ENV=test default: DISABLE_SCHEDULERS and KF_DISABLE_SCHEDULERS still
 * win, and outside NODE_ENV=test it changes nothing. Never set it for an
 * integration app that shares the database with other suites.
 */
export function schedulersOptedInForTest(): boolean {
  return envFlagOn(process.env.ENABLE_SCHEDULERS_IN_TEST);
}

/**
 * The server-side KEY off switch (D-17): KEY_DISABLED. With it on, the model
 * gateway refuses every dispatch with the R0-07 structured 503 (reason
 * 'key_disabled') before reading anything, so no gateway dispatch reaches a
 * provider, and every cortex @Cron handler returns before it scans a business.
 * Since V1-24b the AI calls that bypass the gateway read it too (KEY voice
 * speak/listen, the embedding, vision and audio helpers, KEY document
 * embeddings, the phone realtime bridge, ElevenLabs TTS, the diagnostics
 * OpenAI check): each refuses before it builds a provider client. A LiveKit
 * KEY voice session is refused before any room or agent dispatch, and the KEY
 * voice agent worker (apps/voice-agent, its own process and environment)
 * rejects every job while the switch is set there (V1-24b review, SEC-V124b-2).
 * KEY_DISABLED_NOT_COVERED (model-gateway.service.ts) is empty, and
 * scheduler-kill-switch.spec.ts fails if a new direct path ignores the switch.
 * Distinct from AI_DISABLED, which only the storefront reads and which does not
 * stop KEY.
 */
export function keyDisabled(): boolean {
  return envFlagOn(process.env.KEY_DISABLED);
}

/**
 * The guard every cortex @Cron handler runs first: KEY is off, or schedulers
 * are switched off (schedulersDisabled(): DISABLE_SCHEDULERS,
 * KF_DISABLE_SCHEDULERS, or NODE_ENV=test without ENABLE_SCHEDULERS_IN_TEST).
 * V1-24 left NODE_ENV=test out because the cortex specs call these handlers
 * directly; but a spawned test server that does not set DISABLE_SCHEDULERS
 * (app-module-boots spreads the runner's env) then ran every cortex cron
 * against the shared database. V1-24b includes it; a spec that calls a handler
 * directly opts in with ENABLE_SCHEDULERS_IN_TEST.
 */
export function keyCronsDisabled(): boolean {
  return keyDisabled() || schedulersDisabled();
}

/**
 * Hard-fail guard for the removed KEYFLOW_DEV_AUTH_BYPASS escape hatch.
 *
 * Call this before importing the Nest application module so a mis-set env var
 * exits immediately with a readable message instead of booting into a half-
 * authenticated state (or being buried under a module-load error).
 */
export function assertNoDevAuthBypass(env: NodeJS.ProcessEnv = process.env): void {
  if (env.KEYFLOW_DEV_AUTH_BYPASS === 'true' || env.KEYFLOW_DEV_AUTH_BYPASS === '1') {
    throw new Error(
      '[FATAL] KEYFLOW_DEV_AUTH_BYPASS is set, but the dev auth bypass code path no longer exists. Unset this env var (and remove it from any .env file or workflow command) to start the server. To sign in locally, use the real /auth/signup → email-verify → /auth/login flow.',
    );
  }
}
