import { Module } from '@nestjs/common';
import { CallLogService } from './call-log.service';
import { CallTaskController } from './call-task.controller';
import { CallScriptService } from './call-script.service';
import { ModelGatewayService } from '../ai/model-gateway.service';

@Module({
  providers: [CallLogService, CallScriptService, ModelGatewayService],
  controllers: [CallTaskController],
  exports: [CallLogService, CallScriptService],
})
export class CallTaskModule {}
