import { Module, forwardRef } from '@nestjs/common';
import { EmailMarketingController } from './email-marketing.controller';
import { EmailMarketingService } from './email-marketing.service';
import { MarketingAiController } from './marketing-ai.controller';
import { MarketingAiService } from './marketing-ai.service';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { AiModule } from '../ai/ai.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { CommerceModule } from '../commerce/commerce.module';

@Module({
  imports: [AiModule, SubscriptionsModule, forwardRef(() => CommerceModule)],
  controllers: [EmailMarketingController, MarketingAiController],
  providers: [EmailMarketingService, MarketingAiService, CampaignSchedulerService],
  exports: [EmailMarketingService],
})
export class EmailMarketingModule {}
