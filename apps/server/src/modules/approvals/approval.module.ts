import { Module, forwardRef } from '@nestjs/common';
import { ApprovalRequestService } from './approval-request.service';
import { ApprovalController } from './approval.controller';
import { KeyCortexModule } from '../key-cortex/key-cortex.module';

@Module({
  imports: [forwardRef(() => KeyCortexModule)],
  providers: [ApprovalRequestService],
  controllers: [ApprovalController],
  exports: [ApprovalRequestService],
})
export class ApprovalModule {}
