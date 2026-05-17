import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
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
import { GamificationModule } from './modules/gamification/gamification.module';
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
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { HelpdeskModule } from './modules/helpdesk/helpdesk.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { FinanceModule } from './modules/finance/finance.module';
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

@Module({
  imports: [
    // Core Modules
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
    GamificationModule,
    WebhooksModule,
    ApiKeysModule,
    ActionsModule,
    UploadsModule,
    AutopilotModule,
    NotificationsModule,
    PaymentsModule,
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
