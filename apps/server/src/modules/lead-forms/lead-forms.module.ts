import { Module } from '@nestjs/common';
import { LeadFormsController } from './lead-forms.controller';
import { LeadFormsService } from './lead-forms.service';

@Module({
  controllers: [LeadFormsController],
  providers: [LeadFormsService],
  exports: [LeadFormsService],
})
export class LeadFormsModule {}
