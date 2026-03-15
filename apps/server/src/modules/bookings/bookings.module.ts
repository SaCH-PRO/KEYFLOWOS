import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsAiController } from './bookings-ai.controller';
import { BookingsService } from './bookings.service';
import { BookingsAiService } from './bookings-ai.service';
import { CalendarService } from './calendar.service';
import { BookingOptimizerService } from './booking-optimizer.service';
import { CrmModule } from '../crm/crm.module';
import { CommerceModule } from '../commerce/commerce.module';
import { AutomationModule } from '../automation/automation.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [CrmModule, CommerceModule, AutomationModule, SubscriptionsModule, AiModule],
  controllers: [BookingsController, BookingsAiController],
  providers: [BookingsService, BookingsAiService, CalendarService, BookingOptimizerService],
  exports: [BookingsService, BookingsAiService, CalendarService, BookingOptimizerService],
})
export class BookingsModule {}
