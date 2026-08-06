import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';
// In monorepo .env lives at repo root; cwd is apps/server when running directly
config({ path: resolve(process.cwd(), '../../.env') });
import { NestFactory } from '@nestjs/core';
import { configureNestApp } from './app-bootstrap';
import { ensureValidServerEnv, assertNoDevAuthBypass } from './core/config/env';
import { getReleaseVersion } from '@keyflow/shared/release-version';
import { setTenantContextProvider } from '@keyflow/db';
import { getCurrentBusinessId } from './core/tenant/tenant-context';

async function bootstrap() {
  // Fail fast on missing/malformed env. Prints a single, readable list and
  // exits non-zero before NestFactory tries to initialize anything.
  ensureValidServerEnv(process.env);

  // The KEYFLOW_DEV_AUTH_BYPASS escape hatch was removed in the Tier 2 auth
  // hardening pass. If anyone still has it set in their env, hard-fail at
  // boot in EVERY environment so they don't silently expect dev auto-login
  // and end up with a half-authenticated session instead.
  assertNoDevAuthBypass(process.env);

  // When email verification is required, signup absolutely cannot work without
  // both the Supabase service-role key (admin createUser / generateLink) and
  // the Resend API key (actual email delivery). Fail fast at boot rather than
  // at first signup attempt.
  const verificationFlag = (process.env.AUTH_REQUIRE_EMAIL_VERIFICATION || '').trim().toLowerCase();
  const verificationRequired =
    verificationFlag === 'true' ||
    verificationFlag === '1' ||
    (verificationFlag === '' && process.env.NODE_ENV === 'production');
  if (verificationRequired) {
    const missing: string[] = [];
    if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!(process.env.RESEND_API_KEY || '').trim()) missing.push('RESEND_API_KEY');
    if (!(process.env.EMAIL_FROM_ADDRESS || '').trim()) missing.push('EMAIL_FROM_ADDRESS');
    if (missing.length) {
      console.error(
        `[FATAL] AUTH_REQUIRE_EMAIL_VERIFICATION is on but required env vars are missing: ${missing.join(', ')}. Refusing to start.`,
      );
      process.exit(1);
    }
  } else if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) {
    // Even with verification disabled (auto-confirm dev mode), signup still
    // requires the Supabase service-role key for admin createUser. Warn loudly
    // at boot so devs aren't surprised by a runtime "server_misconfigured"
    // response on their first signup attempt.
    console.warn(
      '[WARN] SUPABASE_SERVICE_ROLE_KEY is not set. POST /identity/signup will return server_misconfigured until this is configured.',
    );
  }

  const { AppModule } = await import('./app.module');
  // Install the tenant context provider BEFORE the app starts serving.
  //
  // packages/db ships a Prisma extension that injects `where: { businessId }`
  // into every query on 47 tenant-scoped models. It has been applied to the
  // client since it was written and has never once fired, because
  // tenantOperationAllowed() needs an active businessId and this function —
  // the only thing that supplies one — was called from a test file and nowhere
  // else. A complete isolation mechanism, switched off.
  //
  // It is defence in depth, not the primary control: every query should still
  // scope itself. But three cross-tenant leaks were found in this codebase in a
  // single afternoon, and this is the layer that would have caught all three.
  setTenantContextProvider({ getCurrentBusinessId });

  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureNestApp(app);

  // Graceful shutdown: on SIGTERM/SIGINT finish in-flight requests,
  // close DB connections, and flush logs before exiting.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, '0.0.0.0');
  const version = await getReleaseVersion();

  console.log(`[boot] API ready on http://localhost:${port} (commit=${version.short}, env=${process.env.NODE_ENV || 'development'})`);
  console.log(`[boot] Health: GET /healthz  Readiness: GET /readyz`);

  // Global uncaught-exception safety net: log and exit cleanly so the
  // process manager (Docker, systemd, PM2) can restart us.
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled rejection:', reason);
    process.exit(1);
  });
}
bootstrap();
