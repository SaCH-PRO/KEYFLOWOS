import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureNestApp } from './app-bootstrap';
import { ensureValidServerEnv } from './core/config/env';
import { getReleaseVersion } from './core/utils/release-version';

async function bootstrap() {
  // Fail fast on missing/malformed env. Prints a single, readable list and
  // exits non-zero before NestFactory tries to initialize anything.
  ensureValidServerEnv(process.env);

  if (
    process.env.NODE_ENV === 'production' &&
    (process.env.KEYFLOW_DEV_AUTH_BYPASS === 'true' || process.env.KEYFLOW_DEV_AUTH_BYPASS === '1')
  ) {
    // Hard-fail: the dev bypass must never run in production.
    // eslint-disable-next-line no-console
    console.error(
      '[FATAL] KEYFLOW_DEV_AUTH_BYPASS is enabled in production. This is unsafe — refusing to start. Unset KEYFLOW_DEV_AUTH_BYPASS or run with NODE_ENV !== "production".',
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
      // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
    console.warn(
      '[WARN] SUPABASE_SERVICE_ROLE_KEY is not set. POST /identity/signup will return server_misconfigured until this is configured.',
    );
  }

  const app = await NestFactory.create(AppModule);
  configureNestApp(app);
  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[boot] API ready on http://localhost:${port} (commit=${getReleaseVersion().short}, env=${process.env.NODE_ENV || 'development'})`);
  // eslint-disable-next-line no-console
  console.log(`[boot] Health: GET /healthz  Readiness: GET /readyz`);
}
bootstrap();
