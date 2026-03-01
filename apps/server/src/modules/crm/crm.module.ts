import { Module, forwardRef } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmAiService } from './crm-ai.service';
import { CrmFlowService } from './crm-flow.service';
import { CrmGoogleService } from './crm-google.service';
import { CrmImportService } from './crm-import.service';
import { CrmPlaybookService } from './crm-playbook.service';
import { CrmSequenceService } from './crm-sequence.service';
import { CrmVisionService } from './crm-vision.service';
import { CrmService } from './crm.service';
import { AiModule } from '../ai/ai.module';
import { AutomationModule } from '../automation/automation.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [forwardRef(() => AutomationModule), SubscriptionsModule, AiModule],
  controllers: [CrmController],
  providers: [CrmService, CrmImportService, CrmPlaybookService, CrmVisionService, CrmGoogleService, CrmFlowService, CrmAiService, CrmSequenceService],
  exports: [CrmService, CrmImportService, CrmPlaybookService, CrmVisionService, CrmGoogleService, CrmFlowService, CrmAiService, CrmSequenceService],
})
export class CrmModule {}
