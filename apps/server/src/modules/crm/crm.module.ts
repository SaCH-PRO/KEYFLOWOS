import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmAiController } from './crm-ai.controller';
import { CrmGoogleController } from './crm-google.controller';
import { CrmSequenceController } from './crm-sequence.controller';
import { CrmActionsService } from './crm-actions.service';
import { CrmAiService } from './crm-ai.service';
import { CrmFlowService } from './crm-flow.service';
import { CrmGoogleService } from './crm-google.service';
import { CrmImportService } from './crm-import.service';
import { CrmJourneyService } from './crm-journey.service';
import { CrmListsService } from './crm-lists.service';
import { CrmPlaybookService } from './crm-playbook.service';
import { CrmRevenueService } from './crm-revenue.service';
import { CrmSequenceService } from './crm-sequence.service';
import { CrmSequenceSchedulerService } from './crm-sequence-scheduler.service';
import { CrmStatsService } from './crm-stats.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CrmVisionService } from './crm-vision.service';
import { CrmService } from './crm.service';
import { CrmRateLimitGuard } from './guards/rate-limit.guard';
import { FeatureFlagGuard } from './guards/feature-flag.guard';
import { PlanLimitGuard } from '../subscriptions/plan-limit.guard';
import { AiModule } from '../ai/ai.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [SubscriptionsModule, AiModule],
  controllers: [CrmController, CrmAiController, CrmGoogleController, CrmSequenceController],
  providers: [CrmService, CrmTimelineService, CrmListsService, CrmStatsService, CrmImportService, CrmPlaybookService, CrmVisionService, CrmGoogleService, CrmFlowService, CrmActionsService, CrmRevenueService, CrmJourneyService, CrmAiService, CrmSequenceService, CrmSequenceSchedulerService, CrmRateLimitGuard, FeatureFlagGuard, PlanLimitGuard],
  exports: [CrmService, CrmTimelineService, CrmListsService, CrmStatsService, CrmImportService, CrmPlaybookService, CrmVisionService, CrmGoogleService, CrmFlowService, CrmActionsService, CrmRevenueService, CrmJourneyService, CrmAiService, CrmSequenceService, CrmSequenceSchedulerService],
})
export class CrmModule {}
