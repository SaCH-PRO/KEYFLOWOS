import { Module, forwardRef } from '@nestjs/common';
import { CommerceController } from './commerce.controller';
import { AccountingController } from './accounting.controller';
import { CommerceAiController } from './commerce-ai.controller';
import { CommerceInsightsController } from './commerce-insights.controller';
import { FinancialCopilotController } from './financial-copilot.controller';
import { CommerceService } from './commerce.service';
import { CommerceStatsService } from './commerce-stats.service';
import { InvoiceWorkflowService } from './invoice-workflow.service';
import { InvoiceOverdueScheduler } from './invoice-overdue.scheduler';
import { QuoteStaleScheduler } from './quote-stale.scheduler';
import { QuoteStaleListener } from './quote-stale.listener';
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
import { RevenueAttributionService } from './revenue-attribution.service';
import { StorefrontInvoiceAttributionListener } from './storefront-invoice-attribution.listener';
import { CommerceIntelligenceService } from './commerce-intelligence.service';
import { MarginSnapshotSchedulerService } from './margin-snapshot-scheduler.service';
import { StoreReadinessService } from './store-readiness.service';
import { QuoteNotificationsListener } from './quote-notifications.listener';
import { InvoiceReceiptListener } from './invoice-receipt.listener';
import { RevenueActionService } from './revenue-action.service';
import { RevenueActionController } from './revenue-action.controller';
import { RevenueReportingService } from './revenue-reporting.service';
import { RevenueReportingController } from './revenue-reporting.controller';
import { RevenueReportingRollupScheduler } from './revenue-reporting-rollup.scheduler';
import { CrmModule } from '../crm/crm.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AiModule } from '../ai/ai.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PlanLimitGuard } from '../subscriptions/plan-limit.guard';
import type { NotificationsModule as NotificationsModuleType } from '../notifications/notifications.module';

@Module({
  imports: [
    CrmModule,
    SubscriptionsModule,
    AiModule,
    CatalogModule,
    // notifications -> commerce -> notifications is a circular cycle, so we
    // mirror the lazy require pattern used in NotificationsModule itself to
    // avoid a TDZ "Cannot access ... before initialization" error.
    forwardRef(
      () =>
        (require('../notifications/notifications.module') as {
          NotificationsModule: typeof NotificationsModuleType;
        }).NotificationsModule,
    ),
  ],
  controllers: [CommerceController, AccountingController, CommerceAiController, CommerceInsightsController, FinancialCopilotController, RevenueActionController, RevenueReportingController],
  providers: [
    CommerceService,
    CommerceStatsService,
    InvoiceWorkflowService,
    InvoiceOverdueScheduler,
    QuoteStaleScheduler,
    QuoteStaleListener,
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
    RevenueAttributionService,
    StorefrontInvoiceAttributionListener,
    CommerceIntelligenceService,
    MarginSnapshotSchedulerService,
    StoreReadinessService,
    QuoteNotificationsListener,
    InvoiceReceiptListener,
    RevenueActionService,
    RevenueReportingService,
    RevenueReportingRollupScheduler,
    PlanLimitGuard,
  ],
  exports: [
    CommerceService,
    CommerceStatsService,
    InvoiceWorkflowService,
    RecurringInvoiceService,
    GmailService,
    FinancialCopilotService,
    LandedCostEngine,
    MarginAnalysisService,
    SourceRiskService,
    InventoryRiskService,
    RevenueAttributionService,
    RevenueReportingService,
  ],
})
export class CommerceModule {}
