import { Module } from '@nestjs/common';
import { ContentRequestService } from './content-request.service';
import { ContentDeliveryService } from './content-delivery.service';
import { ContentInvoiceService } from './content-invoice.service';
import { ContentOpsController } from './content-ops.controller';
import { GoogleDriveModule } from '../google-drive/google-drive.module';
import { ApprovalModule } from '../approvals/approval.module';
import { CommerceModule } from '../commerce/commerce.module';

@Module({
  imports: [GoogleDriveModule, ApprovalModule, CommerceModule],
  providers: [ContentRequestService, ContentDeliveryService, ContentInvoiceService],
  controllers: [ContentOpsController],
  exports: [ContentRequestService, ContentDeliveryService, ContentInvoiceService],
})
export class ContentOpsModule {}
