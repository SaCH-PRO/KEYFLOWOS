import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalHttpExceptionFilter } from './core/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  const allowedOrigins: string[] = [];
  const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
  const replitSlug = process.env.REPL_SLUG;
  const replitOwner = process.env.REPL_OWNER;
  if (replitDevDomain) {
    allowedOrigins.push(`https://${replitDevDomain}`);
  }
  if (replitSlug && replitOwner) {
    allowedOrigins.push(`https://${replitSlug}.${replitOwner}.repl.co`);
  }
  allowedOrigins.push('http://localhost:5000', 'http://localhost:3000');

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
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
