import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiListener } from './ai.listener';
import { AiAdvisorService } from './ai-advisor.service';
import { AiUsageService } from './ai-usage.service';
import { OutputTemplateService } from './output-template.service';
import { OutputTemplateController } from './output-template.controller';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { FlowController } from './flow.controller';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [AiController, OutputTemplateController, FlowController],
  providers: [AiListener, AiAdvisorService, AiUsageService, OutputTemplateService, FlowOrchestratorService],
  exports: [AiAdvisorService, AiUsageService, OutputTemplateService, FlowOrchestratorService],
})
export class AiModule {}
