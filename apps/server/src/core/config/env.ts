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
      warnings.push('AI provider keys: none of OPENAI/ANTHROPIC/XAI set — AI features will return errors');
    }
  }

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
