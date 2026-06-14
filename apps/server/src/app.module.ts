import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './core/prisma/prisma.module';
import { BusinessEventModule } from './modules/business-events/business-event.module';
import { BusinessEventInterceptor } from './modules/business-events/business-event.interceptor';
import { EvidenceModule } from './modules/evidence/evidence.module';
import { TaskAssignmentModule } from './modules/task-assignments/task-assignment.module';
import { EventStreamModule } from './modules/event-stream/event-stream.module';
import { ApprovalModule } from './modules/approvals/approval.module';
import { ContentOpsModule } from './modules/content-ops/content-ops.module';
import { EventBusModule } from './core/event-bus/event-bus.module';
import { AuthModule } from './core/auth/auth.module';
import { TrpcModule } from './trpc.module';
import { IdentityModule } from './modules/identity/identity.module';
import { CrmModule } from './modules/crm/crm.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CommerceModule } from './modules/commerce/commerce.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { SocialModule } from './modules/social/social.module';
import { AutomationModule } from './modules/automation/automation.module';
import { SiteModule } from './modules/site/site.module';
import { AiModule } from './modules/ai/ai.module';
import { FlowModule } from './modules/flow/flow.module';
import { TimelineModule } from './modules/timeline/timeline.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AuthMiddleware } from './core/auth/auth.middleware';
import { CorrelationIdMiddleware } from './core/middleware/correlation-id.middleware';
import { LoggingInterceptor } from './core/interceptors/logging.interceptor';
import { ActionsModule } from './modules/actions/actions.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { AutopilotModule } from './modules/autopilot/autopilot.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ConversionModule } from './modules/conversion/conversion.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { HelpdeskModule } from './modules/helpdesk/helpdesk.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { FinanceModule } from './modules/finance/finance.module';
import { ContinentalOpsModule } from './modules/continental-ops/continental-ops.module';
import { ReportsModule } from './modules/reports/reports.module';
import { EmailMarketingModule } from './modules/email-marketing/email-marketing.module';
import { LeadFormsModule } from './modules/lead-forms/lead-forms.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { EducationModule } from './modules/education/education.module';
import { CommunityModule } from './modules/community/community.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { SupplierModule } from './modules/supplier/supplier.module';
import { StructureModule } from './modules/structure/structure.module';
import { MomentumModule } from './modules/momentum/momentum.module';
import { SeedModule } from './core/seed/seed.module';
import { OnboardingConciergeModule } from './modules/onboarding-concierge/onboarding-concierge.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { GoogleDriveModule } from './modules/google-drive/google-drive.module';
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module';
import { CommunicationsModule } from './modules/communications/communications.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { SlackModule } from './modules/slack/slack.module';
import { ShopifyModule } from './modules/shopify/shopify.module';
import { SentryModule } from './core/sentry/sentry.module';
import { ConnectorModule } from './core/connectors/connector.module';
import { KeyflowCommandModule } from './modules/keyflow-command/keyflow-command.module';
import { ConnectModule } from './modules/connect/connect.module';
import { SeoModule } from './modules/seo/seo.module';
import { GrowthIntelligenceModule } from './modules/growth-intelligence/growth-intelligence.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { BlueprintModule } from './modules/blueprint/blueprint.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { PublicEventsModule } from './modules/public-events/public-events.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { AdminAuthModule } from './modules/admin-auth/admin-auth.module';
import { AssetModule } from './modules/assets/asset.module';
import { CallTaskModule } from './modules/call-tasks/call-task.module';
import { TimeTrackingModule } from './modules/time-tracking/time-tracking.module';
import { RetainerModule } from './modules/retainers/retainer.module';
import { PortalModule } from './modules/portal/portal.module';
import { ChangeOrderModule } from './modules/change-orders/change-order.module';
import { CommandModule } from './modules/command/command.module';
import { OsModule } from './modules/os/os.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { TemporalModule } from './modules/temporal/temporal.module';
import { PeopleFlowModule } from './modules/people-flow/people-flow.module';
import { SopModule } from './modules/sop/sop.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { IntegrationHubModule } from './modules/integration-hub/integration-hub.module';
import { ProductAnalyticsModule } from './modules/product-analytics/product-analytics.module';
import { AdminAnalyticsModule } from './modules/admin-analytics/admin-analytics.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { DeviceModule } from './modules/device/device.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { AdminPlatformModule } from './modules/admin-platform/admin-platform.module';
import { TrashModule } from './modules/trash/trash.module';
import { PushNotificationModule } from './modules/push-notifications/push-notification.module';
import { SecurityAuditModule } from './modules/security-audit/security-audit.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';

@Module({
  imports: [
    // Core Modules
    ScheduleModule.forRoot(),
    PrismaModule,
    EventBusModule,
    AuthModule,
    TrpcModule,
    ConnectorModule,
    BusinessEventModule,
    EvidenceModule,
    TaskAssignmentModule,
    EventStreamModule,
    ApprovalModule,
    ContentOpsModule,

    // Feature Modules
    IdentityModule,
    CrmModule,
    CatalogModule,
    CommerceModule,
    BookingsModule,
    SocialModule,
    AutomationModule,
    SiteModule,
    AiModule,
    FlowModule,
    TimelineModule,
    WebhooksModule,
    ApiKeysModule,
    ActionsModule,
    UploadsModule,
    AutopilotModule,
    NotificationsModule,
    PaymentsModule,
    ConversionModule,
    SubscriptionsModule,
    ProjectsModule,
    HelpdeskModule,
    ExpensesModule,
    FinanceModule,
    ReportsModule,
    EmailMarketingModule,
    LeadFormsModule,
    TemplatesModule,
    EducationModule,
    CommunityModule,
    MarketplaceModule,
    ProcurementModule,
    SupplierModule,
    StructureModule,
    MomentumModule,
    SeedModule,
    OnboardingConciergeModule,
    DocumentsModule,
    GoogleDriveModule,
    DiagnosticsModule,
    CommunicationsModule,
    WhatsAppModule,
    SlackModule,
    ShopifyModule,
    ContinentalOpsModule,
    SentryModule,
    KeyflowCommandModule,
    ConnectModule,
    SeoModule,
    GrowthIntelligenceModule,
    FeatureFlagsModule,
    BlueprintModule,
    CalendarModule,
    PublicEventsModule,
    DirectoryModule,
    AdminAuthModule,
    AssetModule,
    CallTaskModule,
    TimeTrackingModule,
    RetainerModule,
    PortalModule,
    ChangeOrderModule,
    CommandModule,
    OsModule,
    GovernanceModule,
    IngestionModule,
    TemporalModule,
    PeopleFlowModule,
    SopModule,
    MarketingModule,
    IntelligenceModule,
    IntegrationHubModule,
    ProductAnalyticsModule,
    AdminAnalyticsModule,
    AnalyticsModule,
    AdminPlatformModule,
    TrashModule,
    PushNotificationModule,
    DeviceModule,
    RealtimeModule,
    SecurityAuditModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AuthMiddleware,
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: BusinessEventInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
    consumer
      .apply(AuthMiddleware)
      .exclude('healthz', 'readyz')
      .forRoutes('*');
  }
}
