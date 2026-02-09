import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { CalendarService } from './calendar.service';
import { CrmModule } from '../crm/crm.module';
import { CommerceModule } from '../commerce/commerce.module';
import { AutomationModule } from '../automation/automation.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [CrmModule, CommerceModule, AutomationModule, SubscriptionsModule],
  controllers: [BookingsController],
  providers: [BookingsService, CalendarService],
  exports: [BookingsService, CalendarService],
})
export class BookingsModule {}
