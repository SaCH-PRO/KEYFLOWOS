import { Module, forwardRef } from '@nestjs/common';
import { EmailMarketingController } from './email-marketing.controller';
import { MarketingSyncController } from './marketing-sync.controller';
import { EmailMarketingService } from './email-marketing.service';
import { MarketingAiController } from './marketing-ai.controller';
import { MarketingAiService } from './marketing-ai.service';
import { MarketingStrategyService } from './marketing-strategy.service';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { CampaignIntelligenceService } from './campaign-intelligence.service';
import { AiModule } from '../ai/ai.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { CommerceModule } from '../commerce/commerce.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AiModule, SubscriptionsModule, forwardRef(() => CommerceModule), NotificationsModule],
  controllers: [EmailMarketingController, MarketingAiController, MarketingSyncController],
  providers: [EmailMarketingService, MarketingAiService, MarketingStrategyService, CampaignSchedulerService, CampaignIntelligenceService],
  exports: [EmailMarketingService],
})
export class EmailMarketingModule {}
