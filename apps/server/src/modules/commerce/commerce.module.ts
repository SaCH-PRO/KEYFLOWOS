import { Module } from '@nestjs/common';
import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { ReceiptService } from './receipt.service';
import { GmailService } from './gmail.service';
import { CrmModule } from '../crm/crm.module';
import { AutomationModule } from '../automation/automation.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [CrmModule, AutomationModule, SubscriptionsModule],
  controllers: [CommerceController],
  providers: [CommerceService, ReceiptService, GmailService],
  exports: [CommerceService, GmailService],
})
export class CommerceModule {}
