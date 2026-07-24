import { Module, forwardRef } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { TicketTypeService } from './ticket-type.service';
import { AttendeeService } from './attendee.service';
import { CheckInService } from './check-in.service';
import { CommerceModule } from '../commerce/commerce.module';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [forwardRef(() => CommerceModule), forwardRef(() => CrmModule)],
  controllers: [EventsController],
  providers: [EventsService, TicketTypeService, AttendeeService, CheckInService],
  exports: [EventsService, TicketTypeService, AttendeeService, CheckInService],
})
export class EventsModule {}
