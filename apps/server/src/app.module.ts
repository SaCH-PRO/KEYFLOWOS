import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
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
import { AuthMiddleware } from './core/auth/auth.middleware';

@Module({
  imports: [
    // Core Modules
    PrismaModule,
    EventBusModule,
    AuthModule,
    TrpcModule, // <-- IMPORT THE TRPC MODULE

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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
