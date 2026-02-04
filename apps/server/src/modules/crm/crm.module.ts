import { Module, forwardRef } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmImportService } from './crm-import.service';
import { CrmPlaybookService } from './crm-playbook.service';
import { CrmVisionService } from './crm-vision.service';
import { CrmService } from './crm.service';
import { AutomationModule } from '../automation/automation.module';

@Module({
  imports: [forwardRef(() => AutomationModule)],
  controllers: [CrmController],
  providers: [CrmService, CrmImportService, CrmPlaybookService, CrmVisionService],
  exports: [CrmService, CrmImportService, CrmPlaybookService, CrmVisionService],
})
export class CrmModule {}
