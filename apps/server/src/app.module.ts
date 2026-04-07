import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './core/prisma/prisma.module';
import { EventBusModule } from './core/event-bus/event-bus.module';
import { AuthModule } from './core/auth/auth.module';
import { TrpcModule } from './trpc.module';
import { IdentityModule } from './modules/identity/identity.module';
import { CrmModule } from './modules/crm/crm.module';
import { CommerceModule } from './modules/commerce/commerce.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { SocialModule } from './modules/social/social.module';
import { AutomationModule } from './modules/automation/automation.module';
import { SiteModule } from './modules/site/site.module';
import { AiModule } from './modules/ai/ai.module';
import { FlowModule } from './modules/flow/flow.module';
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
import { ExpensesModule } from './modules/expenses/expenses.module';
import { ReportsModule } from './modules/reports/reports.module';
import { EmailMarketingModule } from './modules/email-marketing/email-marketing.module';
import { LeadFormsModule } from './modules/lead-forms/lead-forms.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { EducationModule } from './modules/education/education.module';
import { CommunityModule } from './modules/community/community.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { MomentumModule } from './modules/momentum/momentum.module';
import { SeedModule } from './core/seed/seed.module';
import { OnboardingConciergeModule } from './modules/onboarding-concierge/onboarding-concierge.module';
import { BusinessGuidanceModule } from './modules/business-guidance/business-guidance.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { GoogleDriveModule } from './modules/google-drive/google-drive.module';

@Module({
  imports: [
    // Core Modules
    PrismaModule,
    EventBusModule,
    AuthModule,
    TrpcModule,

    // Feature Modules
    IdentityModule,
    CrmModule,
    CommerceModule,
    BookingsModule,
    SocialModule,
    AutomationModule,
    SiteModule,
    AiModule,
    FlowModule,
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
    ExpensesModule,
    ReportsModule,
    EmailMarketingModule,
    LeadFormsModule,
    TemplatesModule,
    EducationModule,
    CommunityModule,
    MarketplaceModule,
    MomentumModule,
    SeedModule,
    OnboardingConciergeModule,
    BusinessGuidanceModule,
    DocumentsModule,
    GoogleDriveModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AuthMiddleware,
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
