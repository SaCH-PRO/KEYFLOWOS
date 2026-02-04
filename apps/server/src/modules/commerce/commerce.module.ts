import { Module } from '@nestjs/common';
import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { ReceiptService } from './receipt.service';
import { GmailService } from './gmail.service';
import { CrmModule } from '../crm/crm.module';
import { AutomationModule } from '../automation/automation.module';

@Module({
  imports: [CrmModule, AutomationModule],
  controllers: [CommerceController],
  providers: [CommerceService, ReceiptService, GmailService],
  exports: [CommerceService, GmailService],
})
export class CommerceModule {}
