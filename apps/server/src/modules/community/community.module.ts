// @keyflow:dormant — UI surface gated by featureFlags (KEY-9 cleanup target).
import { Module, forwardRef } from '@nestjs/common';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { ReputationService } from './reputation.service';
import { OpportunityService } from './opportunity.service';
import { PartnerProgramService } from './partner-program.service';
import { ResourceMarketplaceService } from './resource-marketplace.service';
import { NetworkActivityService } from './network-activity.service';
import { NetworkAnalyticsService } from './network-analytics.service';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [forwardRef(() => AiModule), NotificationsModule],
  controllers: [CommunityController],
  providers: [
    CommunityService,
    ReputationService,
    NetworkActivityService,
    OpportunityService,
    PartnerProgramService,
    ResourceMarketplaceService,
    NetworkAnalyticsService,
  ],
  exports: [
    CommunityService,
    ReputationService,
    NetworkActivityService,
    OpportunityService,
    PartnerProgramService,
    ResourceMarketplaceService,
    NetworkAnalyticsService,
  ],
})
export class CommunityModule {}
