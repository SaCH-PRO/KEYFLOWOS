import { Module } from '@nestjs/common';
import { EmailMarketingController } from './email-marketing.controller';
import { EmailMarketingService } from './email-marketing.service';
import { MarketingAiController } from './marketing-ai.controller';
import { MarketingAiService } from './marketing-ai.service';
import { AiModule } from '../ai/ai.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [AiModule, SubscriptionsModule],
  controllers: [EmailMarketingController, MarketingAiController],
  providers: [EmailMarketingService, MarketingAiService],
  exports: [EmailMarketingService],
})
export class EmailMarketingModule {}
