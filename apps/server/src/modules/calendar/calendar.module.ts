import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { BookingsModule } from '../bookings/bookings.module';
import { CalendarController } from './calendar.controller';
import { CalendarPermissionService } from './calendar-permission.service';
import { CalendarProjectionService } from './calendar-projection.service';
import { CalendarQueryService } from './calendar-query.service';
import { CalendarBackfillService } from './backfill';
import { CalendarSyncService } from './calendar-sync.service';
import { CalendarSyncScheduler } from './calendar-sync.scheduler';
import { CalendarBookingsListener } from './listeners/bookings.listener';
import { CalendarMarketingListener } from './listeners/marketing.listener';
import { CalendarCrmListener } from './listeners/crm.listener';
import { CalendarCommerceListener } from './listeners/commerce.listener';
import { CalendarProjectsListener } from './listeners/projects.listener';
import { CalendarOrdersListener } from './listeners/orders.listener';

@Module({
  imports: [PrismaModule, forwardRef(() => BookingsModule)],
  controllers: [CalendarController],
  providers: [
    CalendarProjectionService,
    CalendarBackfillService,
    CalendarPermissionService,
    CalendarQueryService,
    CalendarSyncService,
    CalendarSyncScheduler,
    CalendarBookingsListener,
    CalendarMarketingListener,
    CalendarCrmListener,
    CalendarCommerceListener,
    CalendarProjectsListener,
    CalendarOrdersListener,
  ],
  exports: [
    CalendarProjectionService,
    CalendarBackfillService,
    CalendarPermissionService,
    CalendarQueryService,
    CalendarSyncService,
  ],
})
export class CalendarModule {}
