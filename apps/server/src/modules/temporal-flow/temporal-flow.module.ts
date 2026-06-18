import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { TemporalFlowController } from './temporal-flow.controller';
import { TemporalFlowService } from './temporal-flow.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TemporalFlowController],
  providers: [TemporalFlowService],
  exports: [TemporalFlowService],
})
export class TemporalFlowModule {}
