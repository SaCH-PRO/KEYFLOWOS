import { Module } from '@nestjs/common';
import { CommerceController } from './commerce.controller';
import { CommerceAiController } from './commerce-ai.controller';
import { CommerceService } from './commerce.service';
import { CommerceStatsService } from './commerce-stats.service';
import { CommerceAiService } from './commerce-ai.service';
import { RecurringInvoiceService } from './recurring-invoice.service';
import { ReceiptService } from './receipt.service';
import { GmailService } from './gmail.service';
import { CrmModule } from '../crm/crm.module';
import { AutomationModule } from '../automation/automation.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [CrmModule, AutomationModule, SubscriptionsModule, AiModule],
  controllers: [CommerceController, CommerceAiController],
  providers: [CommerceService, CommerceStatsService, CommerceAiService, RecurringInvoiceService, ReceiptService, GmailService],
  exports: [CommerceService, CommerceStatsService, RecurringInvoiceService, GmailService],
})
export class CommerceModule {}
