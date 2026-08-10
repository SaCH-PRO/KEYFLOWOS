import { Module, Global } from '@nestjs/common';
import { GrowthBookService } from './growthbook.service';

/**
 * Global so any module can inject GrowthBookService without re-importing —
 * dynamic feature gating is cross-cutting, like Prisma or Sentry.
 */
@Global()
@Module({
  providers: [GrowthBookService],
  exports: [GrowthBookService],
})
export class GrowthBookModule {}
