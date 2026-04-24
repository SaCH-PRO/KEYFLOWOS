import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { GlobalHttpExceptionFilter } from './core/filters/http-exception.filter';

function getAllowedOrigins(): string[] {
  const allowedOrigins: string[] = [];
  const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
  const replitSlug = process.env.REPL_SLUG;
  const replitOwner = process.env.REPL_OWNER;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const vercelUrl = process.env.VERCEL_URL;

  if (replitDevDomain) {
    allowedOrigins.push(`https://${replitDevDomain}`);
  }
  if (replitSlug && replitOwner) {
    allowedOrigins.push(`https://${replitSlug}.${replitOwner}.repl.co`);
  }
  if (siteUrl) {
    allowedOrigins.push(siteUrl);
  }
  if (vercelUrl) {
    allowedOrigins.push(`https://${vercelUrl}`);
  }

  allowedOrigins.push('http://localhost:5000', 'http://localhost:3000');
  return Array.from(new Set(allowedOrigins));
}

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

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
      message: { statusCode: 429, message: 'Too many requests, please try again later', error: 'Too Many Requests' },
    }),
  );

  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = getAllowedOrigins();

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
