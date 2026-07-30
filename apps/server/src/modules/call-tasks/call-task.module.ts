import { Module } from '@nestjs/common';
import { CallLogService } from './call-log.service';
import { CallTaskController } from './call-task.controller';
import { CallScriptService } from './call-script.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  providers: [CallLogService, CallScriptService],
  controllers: [CallTaskController],
  exports: [CallLogService, CallScriptService],
})
export class CallTaskModule {}
