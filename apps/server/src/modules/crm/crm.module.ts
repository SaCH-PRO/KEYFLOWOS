import { Module, forwardRef } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmImportService } from './crm-import.service';
import { CrmService } from './crm.service';
import { AutomationModule } from '../automation/automation.module';

@Module({
  imports: [forwardRef(() => AutomationModule)],
  controllers: [CrmController],
  providers: [CrmService, CrmImportService],
  exports: [CrmService, CrmImportService],
})
export class CrmModule {}
