import { Module, forwardRef } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmAiService } from './crm-ai.service';
import { CrmFlowService } from './crm-flow.service';
import { CrmGoogleService } from './crm-google.service';
import { CrmImportService } from './crm-import.service';
import { CrmListsService } from './crm-lists.service';
import { CrmPlaybookService } from './crm-playbook.service';
import { CrmSequenceService } from './crm-sequence.service';
import { CrmSequenceSchedulerService } from './crm-sequence-scheduler.service';
import { CrmStatsService } from './crm-stats.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CrmVisionService } from './crm-vision.service';
import { CrmService } from './crm.service';
import { AiModule } from '../ai/ai.module';
import { AutomationModule } from '../automation/automation.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [forwardRef(() => AutomationModule), SubscriptionsModule, AiModule],
  controllers: [CrmController],
  providers: [CrmService, CrmTimelineService, CrmListsService, CrmStatsService, CrmImportService, CrmPlaybookService, CrmVisionService, CrmGoogleService, CrmFlowService, CrmAiService, CrmSequenceService, CrmSequenceSchedulerService],
  exports: [CrmService, CrmTimelineService, CrmListsService, CrmStatsService, CrmImportService, CrmPlaybookService, CrmVisionService, CrmGoogleService, CrmFlowService, CrmAiService, CrmSequenceService, CrmSequenceSchedulerService],
})
export class CrmModule {}
