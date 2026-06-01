import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthModule } from '../../core/auth/auth.module';
import { TemporalController } from './temporal.controller';
import { TemporalOverviewService } from './temporal-overview.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TemporalController],
  providers: [TemporalOverviewService],
  exports: [TemporalOverviewService],
})
export class TemporalModule {}
