import { Module } from '@nestjs/common';
import { FlowController } from './flow.controller';
import { FlowListener } from './flow.listener';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
  imports: [BookingsModule],
  controllers: [FlowController],
  providers: [FlowListener],
})
export class FlowModule {}
