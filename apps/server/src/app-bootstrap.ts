import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { GlobalHttpExceptionFilter } from './core/filters/http-exception.filter';
import { allowedCorsOrigins } from './core/config/runtime-urls';

export function configureNestApp(app: INestApplication): void {
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);
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
      : (_origin, callback) => {
          callback(null, true);
        },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-business-id'],
  });
}
