import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiListener } from './ai.listener';
import { AiAdvisorService } from './ai-advisor.service';
import { AiUsageService } from './ai-usage.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [AiController],
  providers: [AiListener, AiAdvisorService, AiUsageService],
  exports: [AiAdvisorService, AiUsageService],
})
export class AiModule {}
