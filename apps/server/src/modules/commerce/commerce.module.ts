import { Module } from '@nestjs/common';
import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { ReceiptService } from './receipt.service';
import { CrmModule } from '../crm/crm.module';
import { AutomationModule } from '../automation/automation.module';

@Module({
  imports: [CrmModule, AutomationModule],
  controllers: [CommerceController],
  providers: [CommerceService, ReceiptService],
  exports: [CommerceService],
})
export class CommerceModule {}
