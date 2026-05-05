import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CrmModule } from '../crm/crm.module';
import { CommerceModule } from '../commerce/commerce.module';
import { FinanceModule } from '../finance/finance.module';
import { PublicEventsModule } from '../public-events/public-events.module';
import { SiteController } from './site.controller';
import { SiteService } from './site.service';
import { StoreOrderService } from './store-order.service';
import { PromoCodeService } from './promo-code.service';
import { IntakeService } from './intake.service';
import { QualificationService } from './qualification.service';
import { StorefrontConversionService } from './storefront-conversion.service';
import { StorefrontConversionScheduler } from './storefront-conversion.scheduler';
import { PresenceController } from './presence/presence.controller';
import { PresenceService } from './presence/presence.service';
import { PresenceOverviewService } from './presence/presence-overview.service';
import { StorefrontIntelligenceService } from './presence/storefront-intelligence.service';
import { StorefrontIntelligenceScheduler } from './presence/storefront-intelligence.scheduler';
import { CustomerReferralService } from './customer-referral.service';
import { CaseStudyService } from './case-study.service';

@Module({
  imports: [
    PrismaModule,
    AiModule,
    PaymentsModule,
    NotificationsModule,
    CrmModule,
    CommerceModule,
    FinanceModule,
    forwardRef(() => PublicEventsModule),
  ],
  controllers: [SiteController, PresenceController],
  providers: [SiteService, StoreOrderService, PromoCodeService, IntakeService, QualificationService, StorefrontConversionService, StorefrontConversionScheduler, PresenceService, PresenceOverviewService, StorefrontIntelligenceService, StorefrontIntelligenceScheduler, CustomerReferralService, CaseStudyService],
  exports: [SiteService, StoreOrderService, PromoCodeService, IntakeService, QualificationService, StorefrontConversionService, PresenceService, PresenceOverviewService, StorefrontIntelligenceService, CustomerReferralService, CaseStudyService],
})
export class SiteModule {}
