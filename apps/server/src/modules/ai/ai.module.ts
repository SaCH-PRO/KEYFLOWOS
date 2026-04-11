import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiListener } from './ai.listener';
import { AiAdvisorService } from './ai-advisor.service';
import { AiUsageService } from './ai-usage.service';
import { OutputTemplateService } from './output-template.service';
import { OutputTemplateController } from './output-template.controller';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [AiController, OutputTemplateController],
  providers: [AiListener, AiAdvisorService, AiUsageService, OutputTemplateService],
  exports: [AiAdvisorService, AiUsageService, OutputTemplateService],
})
export class AiModule {}
