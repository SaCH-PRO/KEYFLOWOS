import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsAiController } from './bookings-ai.controller';
import { BookingsService } from './bookings.service';
import { BookingsAiService } from './bookings-ai.service';
import { CalendarService } from './calendar.service';
import { BookingOptimizerService } from './booking-optimizer.service';
import { CrmModule } from '../crm/crm.module';
import { PublicEventsModule } from '../public-events/public-events.module';
import { CommerceModule } from '../commerce/commerce.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AiModule } from '../ai/ai.module';
import { PlanLimitGuard } from '../subscriptions/plan-limit.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { TimelineModule } from '../timeline/timeline.module';
import { BookingNoShowListener } from './booking-no-show.listener';
import { BookingWaitlistService } from './booking-waitlist.service';
import { BookingWaitlistListener } from './booking-waitlist.listener';

@Module({
  imports: [CrmModule, PublicEventsModule, CommerceModule, SubscriptionsModule, AiModule, NotificationsModule, TimelineModule],
  controllers: [BookingsController, BookingsAiController],
  providers: [
    BookingsService,
    BookingsAiService,
    CalendarService,
    BookingOptimizerService,
    PlanLimitGuard,
    BookingNoShowListener,
    BookingWaitlistService,
    BookingWaitlistListener,
  ],
  exports: [BookingsService, BookingsAiService, CalendarService, BookingOptimizerService, BookingWaitlistService],
})
export class BookingsModule {}
