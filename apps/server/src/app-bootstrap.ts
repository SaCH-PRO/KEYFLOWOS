import { INestApplication, ValidationPipe } from '@nestjs/common';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { Server } from 'http';
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

  // Gzip/Brotli compression for JSON and text responses
  app.use(compression());

  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          connectSrc: ["'self'", "https://*.supabase.co", "https://api.openai.com", "https://api.stripe.com"],
          frameSrc: ["'self'", "https://*.stripe.com"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // CORS allow-list. `allowedCorsOrigins()` already encapsulates the full
  // env-driven precedence chain (APP_URL / NEXT_PUBLIC_SITE_URL / PUBLIC_BASE_URL
  // / CORS_ALLOWED_ORIGINS / localhost), so app-bootstrap
  // doesn't need to know anything about specific hosting providers.
  const allowedOrigins = allowedCorsOrigins();

  const isProduction = process.env.NODE_ENV === 'production';

  app.enableCors({
    origin: isProduction
      ? allowedOrigins
      : (_origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
          callback(null, true);
        },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-business-id'],
  });

  // Rate limit everything EXCEPT the top-level health/readiness endpoints
  // — load balancers and the workflow waitForPort probe must always be
  // able to hit them. Dev environments can raise the ceiling via env.
  // NOTE: must run AFTER enableCors — a 429 from this middleware would
  // otherwise reach the browser without CORS headers and surface as a
  // misleading "Failed to fetch" network error instead of a readable 429.
  const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '200', 10);
  app.use(
    rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
      max: Number.isFinite(rateLimitMax) && rateLimitMax > 0 ? rateLimitMax : 200,
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

  // Public widget routes (storefront, bookings, payments, webhooks) must be
  // accessible from any origin because they are embedded in third-party sites.
  // This middleware runs before the global CORS and sets permissive headers
  // for public paths only. Authenticated routes still use the strict allow-list.
  const PUBLIC_ROUTE_PREFIXES = [
    '/site/storefront/public',
    '/bookings/public',
    '/payments/create-checkout',
    '/webhooks',
    '/widgets',
  ];

  expressApp.use((req: Request, res: Response, next: NextFunction) => {
    const isPublic = PUBLIC_ROUTE_PREFIXES.some((p) => req.path.startsWith(p));
    if (isPublic) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-business-id');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  // Request timeout: abort connections that hang longer than 60s.
  // This prevents resource exhaustion from slow clients or stuck queries.
  const httpServer = app.getHttpServer() as Server;
  httpServer.setTimeout(60_000);
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
}
