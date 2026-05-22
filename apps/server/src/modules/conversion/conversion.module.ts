import { Module, forwardRef } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConversionController } from './conversion.controller';
import { AbandonedCartRecoveryService } from './abandoned-cart-recovery.service';
import { ReviewSolicitationService } from './review-solicitation.service';
import { UpsellService } from './upsell.service';
import { ReferralRewardService } from './referral-reward.service';
import { SalesTeamService } from './sales-team.service';
import { LeadMagnetService } from './lead-magnet.service';
import { MerchantSubscriptionService } from './merchant-subscription.service';

@Module({
  imports: [forwardRef(() => CatalogModule), forwardRef(() => NotificationsModule)],
  controllers: [ConversionController],
  providers: [
    AbandonedCartRecoveryService,
    ReviewSolicitationService,
    UpsellService,
    ReferralRewardService,
    SalesTeamService,
    LeadMagnetService,
    MerchantSubscriptionService,
  ],
  exports: [
    AbandonedCartRecoveryService,
    ReviewSolicitationService,
    UpsellService,
    ReferralRewardService,
    SalesTeamService,
    LeadMagnetService,
    MerchantSubscriptionService,
  ],
})
export class ConversionModule {}
