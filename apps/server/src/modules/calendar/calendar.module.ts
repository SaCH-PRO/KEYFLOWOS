import { Module } from '@nestjs/common';
import { CalendarProjectionService } from './calendar-projection.service';
import { CalendarBackfillService } from './backfill';
import { CalendarBookingsListener } from './listeners/bookings.listener';
import { CalendarMarketingListener } from './listeners/marketing.listener';
import { CalendarCrmListener } from './listeners/crm.listener';
import { CalendarCommerceListener } from './listeners/commerce.listener';
import { CalendarProjectsListener } from './listeners/projects.listener';
import { CalendarOrdersListener } from './listeners/orders.listener';

@Module({
  providers: [
    CalendarProjectionService,
    CalendarBackfillService,
    CalendarBookingsListener,
    CalendarMarketingListener,
    CalendarCrmListener,
    CalendarCommerceListener,
    CalendarProjectsListener,
    CalendarOrdersListener,
  ],
  exports: [CalendarProjectionService, CalendarBackfillService],
})
export class CalendarModule {}
