import { Module, Global } from '@nestjs/common';
import { ErrorDigestService } from './error-digest.service';

/**
 * Global so the digest starts with the app without any module having to ask
 * for it. The registry itself is a module-level singleton rather than a
 * provider — its two reporters (runGuarded, and the exception filter
 * constructed outside the DI container) cannot inject one.
 */
@Global()
@Module({
  providers: [ErrorDigestService],
  exports: [ErrorDigestService],
})
export class ObservabilityModule {}
