import { Module } from '@nestjs/common';
import { FlowController } from './flow.controller';
import { FlowListener } from './flow.listener';
import { FlowService } from './flow.service';
import { BookingsModule } from '../bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [BookingsModule, NotificationsModule],
  controllers: [FlowController],
  providers: [FlowListener, FlowService],
  exports: [FlowService],
})
export class FlowModule {}
