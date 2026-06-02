import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { DiagnosticsService } from './diagnostics.service';
import { DiagnosticsController } from './diagnostics.controller';
import { AiModule } from '../ai/ai.module';
import { BusinessEventModule } from '../business-events/business-event.module';

@Module({
  imports: [PrismaModule, AiModule, BusinessEventModule],
  controllers: [DiagnosticsController],
  providers: [DiagnosticsService],
  exports: [DiagnosticsService],
})
export class DiagnosticsModule {}
