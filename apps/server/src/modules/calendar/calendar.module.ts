import { Module } from '@nestjs/common';
import { CalendarProjectionService } from './calendar-projection.service';
import { CalendarBackfillService } from './backfill';

@Module({
  providers: [CalendarProjectionService, CalendarBackfillService],
  exports: [CalendarProjectionService, CalendarBackfillService],
})
export class CalendarModule {}
