import { Module } from '@nestjs/common';
import { ApprovalRequestService } from './approval-request.service';
import { ApprovalController } from './approval.controller';

@Module({
  providers: [ApprovalRequestService],
  controllers: [ApprovalController],
  exports: [ApprovalRequestService],
})
export class ApprovalModule {}
