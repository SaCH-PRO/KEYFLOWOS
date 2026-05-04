import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { GlobalHttpExceptionFilter } from './core/filters/http-exception.filter';
import { allowedCorsOrigins } from './core/config/runtime-urls';

export function configureNestApp(app: INestApplication): void {
  const expressApp = app.getHttpAdapter().getInstance();
  // Trust-proxy hop count drives Express's `req.ip` derivation from
  // `x-forwarded-for`. Wrong setting → either spoofable IPs (too high)
  // or every request looks like 127.0.0.1 (too low). Operators MUST
  // set this to the real number of proxies in front of the API
  // (Caddy/nginx/Cloudflare/etc.). Default 1 covers the typical single
  // front-door deploy. We never read XFF manually anywhere — every IP
  // comes from `req.ip` so this single switch governs the whole app.
  const trustProxy = process.env.TRUST_PROXY ?? '1';
  const parsedHops = Number.parseInt(trustProxy, 10);
  expressApp.set('trust proxy', Number.isFinite(parsedHops) ? parsedHops : trustProxy);
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Rate limit everything EXCEPT the top-level health/readiness endpoints
  // — load balancers and the workflow waitForPort probe must always be
  // able to hit them.
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        statusCode: 429,
        message: 'Too many requests, please try again later',
        error: 'Too Many Requests',
      },
      skip: (req) => req.path === '/healthz' || req.path === '/readyz',
    }),
  );

  // CORS allow-list. `allowedCorsOrigins()` already encapsulates the full
  // env-driven precedence chain (APP_URL / NEXT_PUBLIC_SITE_URL / PUBLIC_BASE_URL
  // / REPLIT_DEV_DOMAIN / CORS_ALLOWED_ORIGINS / localhost), so app-bootstrap
  // doesn't need to know anything about specific hosting providers.
  const allowedOrigins = allowedCorsOrigins();

  const isProduction = process.env.NODE_ENV === 'production';

  app.enableCors({
    origin: isProduction
      ? allowedOrigins
      : (_origin, callback) => {
          callback(null, true);
        },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-business-id'],
  });
}
