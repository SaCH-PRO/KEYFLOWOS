import { Module, Global } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

const DSN = process.env.SENTRY_DSN;
const ENV = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0.05'),
    integrations: [],
    beforeSend(event) {
      // Scrub sensitive data
      if (event.request?.headers) {
        const headers = event.request.headers as Record<string, string>;
        delete headers['authorization'];
        delete headers['x-api-key'];
        delete headers['cookie'];
      }
      if (event.request?.data) {
        try {
          const body = JSON.parse(event.request.data as string);
          if (body.password) body.password = '[REDACTED]';
          if (body.token) body.token = '[REDACTED]';
          event.request.data = JSON.stringify(body);
        } catch (err: any) {
            console.error(`Not JSON, leave as-is:`, err);
          }
      }
      return event;
    },
  });
}

@Global()
@Module({
  providers: [],
  exports: [],
})
export class SentryModule {}
