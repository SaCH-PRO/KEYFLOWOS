import { Module, forwardRef } from '@nestjs/common';
import { CommerceController } from './commerce.controller';
import { AccountingController } from './accounting.controller';
import { CommerceAiController } from './commerce-ai.controller';
import { CommerceInsightsController } from './commerce-insights.controller';
import { FinancialCopilotController } from './financial-copilot.controller';
import { RecurringInvoiceController } from './recurring-invoice.controller';
import { CommerceService } from './commerce.service';
import { CommerceStatsService } from './commerce-stats.service';
import { InvoiceWorkflowService } from './invoice-workflow.service';
import { InvoiceOverdueScheduler } from './invoice-overdue.scheduler';
import { QuoteStaleScheduler } from './quote-stale.scheduler';
import { QuoteStaleListener } from './quote-stale.listener';
import { CommerceAiService } from './commerce-ai.service';
import { CommerceVisionService } from './commerce-vision.service';
import { RecurringInvoiceService } from './recurring-invoice.service';
import { InvoiceReceiptBuilderService } from './invoice-receipt-builder.service';
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
import { PaymentEvidenceService } from './payment-evidence.service';
import { RevenueReportingService } from './revenue-reporting.service';
import { RevenueReportingController } from './revenue-reporting.controller';
import { RevenueReportingRollupScheduler } from './revenue-reporting-rollup.scheduler';
import { RevenueForecastService } from './revenue-forecast.service';
import { SlowPayerDetector } from './slow-payer-detector.service';
import { PricingSignalsService } from './pricing-signals.service';
import { RevenueBriefingService } from './revenue-briefing.service';
import { WeeklyRevenueReviewScheduler } from './weekly-revenue-review.scheduler';
import { RevenueIntelligenceController } from './revenue-intelligence.controller';
import { TimeCostService } from './time-cost.service';
import { LeverageController } from './leverage.controller';
import { MarginOnPaymentListener } from './margin-on-payment.listener';
import { CrmModule } from '../crm/crm.module';
import { FinanceModule } from '../finance/finance.module';
import { PublicEventsModule } from '../public-events/public-events.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AiModule } from '../ai/ai.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PlanLimitGuard } from '../subscriptions/plan-limit.guard';
import { DocumentTemplateModule } from './document-template/document-template.module';
import { DocumentTemplateController } from './document-template/document-template.controller';
import { DocumentTemplateService } from './document-template/document-template.service';
import { GoogleDriveModule } from '../google-drive/google-drive.module';
import { TaskAssignmentModule } from '../task-assignments/task-assignment.module';
import { DriveIntakeController } from './drive-intake.controller';
import { DriveIntakeOrchestrator } from './drive-intake-orchestrator.service';
import { DriveIntakeListener } from './drive-intake.listener';
import type { NotificationsModule as NotificationsModuleType } from '../notifications/notifications.module';

@Module({
  imports: [
    forwardRef(() => CrmModule),
    forwardRef(() => FinanceModule),
    PublicEventsModule,
    SubscriptionsModule,
    forwardRef(() => AiModule),
    CatalogModule,
    forwardRef(() => FinanceModule),
    DocumentTemplateModule,
    GoogleDriveModule,
    TaskAssignmentModule,
    // notifications -> commerce -> notifications is a circular cycle, so we
    // Dynamic import avoids a TDZ "Cannot access ... before initialization" error.
    forwardRef(
      async () =>
        (await import('../notifications/notifications.module')).NotificationsModule,
    ),
  ],
  controllers: [CommerceController, AccountingController, CommerceAiController, CommerceInsightsController, FinancialCopilotController, RecurringInvoiceController, RevenueActionController, RevenueReportingController, RevenueIntelligenceController, LeverageController, DocumentTemplateController, DriveIntakeController],
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
    InvoiceReceiptBuilderService,
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
    PaymentEvidenceService,
    RevenueReportingService,
    RevenueReportingRollupScheduler,
    RevenueForecastService,
    SlowPayerDetector,
    PricingSignalsService,
    RevenueBriefingService,
    WeeklyRevenueReviewScheduler,
    TimeCostService,
    MarginOnPaymentListener,
    PlanLimitGuard,
    DocumentTemplateService,
    DriveIntakeOrchestrator,
    DriveIntakeListener,
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
    RevenueActionService,
    RevenueForecastService,
    SlowPayerDetector,
    PricingSignalsService,
    RevenueBriefingService,
    TimeCostService,
    DocumentTemplateService,
    DriveIntakeOrchestrator,
  ],
})
export class CommerceModule {}
