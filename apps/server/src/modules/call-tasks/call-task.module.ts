import { Module } from '@nestjs/common';
import { CallLogService } from './call-log.service';
import { CallTaskController } from './call-task.controller';

@Module({
  providers: [CallLogService],
  controllers: [CallTaskController],
  exports: [CallLogService],
})
export class CallTaskModule {}
