/**
 * Boot-time environment validation for the Next.js web app.
 *
 * Run from `next.config.ts` (build-time) and from the server-only init
 * module that loads on the first request (`apps/web/src/lib/env.server.ts`).
 *
 * Required vars block boot. Recommended vars only emit warnings.
 *
 * Skip validation entirely with `KEYFLOW_SKIP_ENV_VALIDATION=1`.
 */

import { z } from 'zod';

const optionalUrl = z
  .string()
  .trim()
  .min(1)
  .refine((s) => /^https?:\/\//i.test(s), 'must start with http:// or https://')
  .optional()
  .or(z.literal('').transform(() => undefined));

const RequiredSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z
    .string()
    .trim()
    .min(1, 'is required (e.g. http://localhost:3001)')
    .refine((s) => /^https?:\/\//i.test(s), 'must start with http:// or https://'),
});

const RecommendedSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().trim().min(1).optional().or(z.literal('').transform(() => undefined)),
  NEXT_PUBLIC_SITE_URL: optionalUrl,
});

export interface WebEnvValidationReport {
  ok: boolean;
  missingRequired: string[];
  warnings: string[];
}

export function validateWebEnv(env: NodeJS.ProcessEnv = process.env): WebEnvValidationReport {
  if (env.KEYFLOW_SKIP_ENV_VALIDATION === '1' || env.KEYFLOW_SKIP_ENV_VALIDATION === 'true') {
    return { ok: true, missingRequired: [], warnings: ['env validation skipped via KEYFLOW_SKIP_ENV_VALIDATION'] };
  }

  const missingRequired: string[] = [];
  const warnings: string[] = [];

  const requiredResult = RequiredSchema.safeParse({
    NEXT_PUBLIC_API_BASE_URL: env.NEXT_PUBLIC_API_BASE_URL,
  });
  if (!requiredResult.success) {
    for (const issue of requiredResult.error.issues) {
      missingRequired.push(`${issue.path.join('.') || '<root>'}: ${issue.message}`);
    }
  }

  const recommendedResult = RecommendedSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: env.NEXT_PUBLIC_SITE_URL,
  });
  if (!recommendedResult.success) {
    for (const issue of recommendedResult.error.issues) {
      warnings.push(`${issue.path.join('.') || '<root>'}: ${issue.message}`);
    }
  } else {
    const r = recommendedResult.data;
    if (!r.NEXT_PUBLIC_SUPABASE_URL || !r.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      warnings.push('NEXT_PUBLIC_SUPABASE_URL/ANON_KEY: not set — sign-in & client auth will fail');
    }
  }

  return {
    ok: missingRequired.length === 0,
    missingRequired,
    warnings,
  };
}

/**
 * Throw on missing required vars; print warnings for recommended ones.
 * Used at build time and at server-init time.
 */
export function ensureValidWebEnv(env: NodeJS.ProcessEnv = process.env): void {
  const report = validateWebEnv(env);
  if (report.warnings.length > 0) {
    console.warn('[env] Recommended config issues:\n' + report.warnings.map((w) => `  - ${w}`).join('\n'));
  }
  if (!report.ok) {
    const message =
      '[FATAL] Environment validation failed:\n' +
      report.missingRequired.map((m) => `  - ${m}`).join('\n') +
      '\n\nFix the variables listed above (see .env.example for documentation).';
    console.error(message);
    throw new Error(message);
  }
}
