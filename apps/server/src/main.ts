import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';
// In monorepo .env lives at repo root; cwd is apps/server when running directly
config({ path: resolve(process.cwd(), '../../.env') });
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureNestApp } from './app-bootstrap';
import { ensureValidServerEnv } from './core/config/env';
import { getReleaseVersion } from './core/utils/release-version';

async function bootstrap() {
  // Fail fast on missing/malformed env. Prints a single, readable list and
  // exits non-zero before NestFactory tries to initialize anything.
  ensureValidServerEnv(process.env);

  // The KEYFLOW_DEV_AUTH_BYPASS escape hatch was removed in the Tier 2 auth
  // hardening pass. If anyone still has it set in their env, hard-fail at
  // boot in EVERY environment so they don't silently expect dev auto-login
  // and end up with a half-authenticated session instead.
  if (
    process.env.KEYFLOW_DEV_AUTH_BYPASS === 'true' ||
    process.env.KEYFLOW_DEV_AUTH_BYPASS === '1'
  ) {
    console.error(
      '[FATAL] KEYFLOW_DEV_AUTH_BYPASS is set, but the dev auth bypass code path no longer exists. Unset this env var (and remove it from any .env file or workflow command) to start the server. To sign in locally, use the real /auth/signup → email-verify → /auth/login flow.',
    );
    process.exit(1);
  }

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
