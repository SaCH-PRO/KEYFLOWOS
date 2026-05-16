import { Module } from '@nestjs/common';
import { ContentRequestService } from './content-request.service';
import { ContentDeliveryService } from './content-delivery.service';
import { ContentOpsController } from './content-ops.controller';
import { GoogleDriveModule } from '../google-drive/google-drive.module';
import { ApprovalModule } from '../approvals/approval.module';

@Module({
  imports: [GoogleDriveModule, ApprovalModule],
  providers: [ContentRequestService, ContentDeliveryService],
  controllers: [ContentOpsController],
  exports: [ContentRequestService, ContentDeliveryService],
})
export class ContentOpsModule {}
