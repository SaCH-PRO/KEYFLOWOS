import { Module } from '@nestjs/common';
import { CommerceController } from './commerce.controller';
import { CommerceAiController } from './commerce-ai.controller';
import { CommerceInsightsController } from './commerce-insights.controller';
import { FinancialCopilotController } from './financial-copilot.controller';
import { CommerceService } from './commerce.service';
import { CommerceStatsService } from './commerce-stats.service';
import { CommerceAiService } from './commerce-ai.service';
import { CommerceVisionService } from './commerce-vision.service';
import { RecurringInvoiceService } from './recurring-invoice.service';
import { ReceiptService } from './receipt.service';
import { GmailService } from './gmail.service';
import { FinancialCopilotService } from './financial-copilot.service';
import { FinancialBriefingSchedulerService } from './financial-briefing-scheduler.service';
import { LandedCostEngine } from './landed-cost-engine.service';
import { MarginAnalysisService } from './margin-analysis.service';
import { SourceRiskService } from './source-risk.service';
import { InventoryRiskService } from './inventory-risk.service';
import { CommerceIntelligenceService } from './commerce-intelligence.service';
import { MarginSnapshotSchedulerService } from './margin-snapshot-scheduler.service';
import { CrmModule } from '../crm/crm.module';
import { AutomationModule } from '../automation/automation.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AiModule } from '../ai/ai.module';
import { PlanLimitGuard } from '../subscriptions/plan-limit.guard';

@Module({
  imports: [CrmModule, AutomationModule, SubscriptionsModule, AiModule],
  controllers: [CommerceController, CommerceAiController, CommerceInsightsController, FinancialCopilotController],
  providers: [
    CommerceService,
    CommerceStatsService,
    CommerceAiService,
    CommerceVisionService,
    RecurringInvoiceService,
    ReceiptService,
    GmailService,
    FinancialCopilotService,
    FinancialBriefingSchedulerService,
    LandedCostEngine,
    MarginAnalysisService,
    SourceRiskService,
    InventoryRiskService,
    CommerceIntelligenceService,
    MarginSnapshotSchedulerService,
    PlanLimitGuard,
  ],
  exports: [
    CommerceService,
    CommerceStatsService,
    RecurringInvoiceService,
    GmailService,
    FinancialCopilotService,
    LandedCostEngine,
    MarginAnalysisService,
    SourceRiskService,
    InventoryRiskService,
  ],
})
export class CommerceModule {}
