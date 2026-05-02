import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';
import { GlobalHttpExceptionFilter } from './core/filters/http-exception.filter';
import { allowedCorsOrigins } from './core/config/runtime-urls';
import { ensureValidServerEnv } from './core/config/env';

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
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  // Rate limit everything EXCEPT the top-level health/readiness endpoints
  // — load balancers and the workflow waitForPort probe must always be
  // able to hit them.
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { statusCode: 429, message: 'Too many requests, please try again later', error: 'Too Many Requests' },
    skip: (req) => req.path === '/healthz' || req.path === '/readyz',
  });
  app.use(limiter);

  const allowedOrigins = allowedCorsOrigins();
  const replitSlug = process.env.REPL_SLUG;
  const replitOwner = process.env.REPL_OWNER;
  if (replitSlug && replitOwner) {
    allowedOrigins.push(`https://${replitSlug}.${replitOwner}.repl.co`);
  }

  const isProduction = process.env.NODE_ENV === 'production';

  app.enableCors({
    origin: isProduction
      ? allowedOrigins
      : (origin, callback) => {
          callback(null, true);
        },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-business-id'],
  });
  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[boot] API ready on http://localhost:${port} (commit=${(process.env.GIT_COMMIT || 'unknown').slice(0, 12)}, env=${process.env.NODE_ENV || 'development'})`);
  // eslint-disable-next-line no-console
  console.log(`[boot] Health: GET /healthz  Readiness: GET /readyz`);
}
bootstrap();
