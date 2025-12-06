import { Module, forwardRef } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmImportService } from './crm-import.service';
import { CrmPlaybookService } from './crm-playbook.service';
import { CrmService } from './crm.service';
import { AutomationModule } from '../automation/automation.module';

@Module({
  imports: [forwardRef(() => AutomationModule)],
  controllers: [CrmController],
  providers: [CrmService, CrmImportService, CrmPlaybookService],
  exports: [CrmService, CrmImportService, CrmPlaybookService],
})
export class CrmModule {}
