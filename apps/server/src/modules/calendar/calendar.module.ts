import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { BookingsModule } from '../bookings/bookings.module';
import { TemporalFlowModule } from '../temporal-flow/temporal-flow.module';
import { AiModule } from '../ai/ai.module';
import { CalendarController } from './calendar.controller';
import { CalendarPermissionService } from './calendar-permission.service';
import { CalendarProjectionService } from './calendar-projection.service';
import { CalendarQueryService } from './calendar-query.service';
import { CalendarConflictService } from './calendar-conflict.service';
import { CalendarInsightService } from './calendar-insight.service';
import { CalendarInsightSchedulerService } from './calendar-insight-scheduler.service';
import { CalendarBackfillService } from './backfill';
import { CalendarSyncService } from './calendar-sync.service';
import { CalendarSyncScheduler } from './calendar-sync.scheduler';
import { CalendarBookingsListener } from './listeners/bookings.listener';
import { CalendarMarketingListener } from './listeners/marketing.listener';
import { CalendarCrmListener } from './listeners/crm.listener';
import { CalendarCommerceListener } from './listeners/commerce.listener';
import { CalendarProjectsListener } from './listeners/projects.listener';
import { CalendarOrdersListener } from './listeners/orders.listener';
import { CalendarConnectorListener } from './listeners/connector.listener';
import { CalendarActionIntelligenceService } from './calendar-action-intelligence.service';
import { GoogleCalendarTemporalSyncService } from './connectors/google-calendar-temporal-sync.service';

@Module({
  imports: [PrismaModule, AiModule, forwardRef(() => BookingsModule), forwardRef(() => TemporalFlowModule)],
  controllers: [CalendarController],
  providers: [
    CalendarProjectionService,
    CalendarBackfillService,
    CalendarPermissionService,
    CalendarQueryService,
    CalendarSyncService,
    CalendarSyncScheduler,
    CalendarConflictService,
    CalendarInsightService,
    CalendarInsightSchedulerService,
    CalendarBookingsListener,
    CalendarMarketingListener,
    CalendarCrmListener,
    CalendarCommerceListener,
    CalendarProjectsListener,
    CalendarOrdersListener,
    CalendarConnectorListener,
    CalendarActionIntelligenceService,
    GoogleCalendarTemporalSyncService,
  ],
  exports: [
    CalendarProjectionService,
    CalendarBackfillService,
    CalendarPermissionService,
    CalendarQueryService,
    CalendarSyncService,
    CalendarConflictService,
    CalendarInsightService,
    GoogleCalendarTemporalSyncService,
  ],
})
export class CalendarModule {}
