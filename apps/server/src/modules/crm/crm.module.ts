import { Module, forwardRef } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmGoogleService } from './crm-google.service';
import { CrmImportService } from './crm-import.service';
import { CrmPlaybookService } from './crm-playbook.service';
import { CrmVisionService } from './crm-vision.service';
import { CrmService } from './crm.service';
import { AutomationModule } from '../automation/automation.module';

@Module({
  imports: [forwardRef(() => AutomationModule)],
  controllers: [CrmController],
  providers: [CrmService, CrmImportService, CrmPlaybookService, CrmVisionService, CrmGoogleService],
  exports: [CrmService, CrmImportService, CrmPlaybookService, CrmVisionService, CrmGoogleService],
})
export class CrmModule {}
