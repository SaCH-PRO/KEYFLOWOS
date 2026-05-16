import { Module } from '@nestjs/common';
import { EventStreamService } from './event-stream.service';
import { EventStreamController } from './event-stream.controller';

@Module({
  providers: [EventStreamService],
  controllers: [EventStreamController],
  exports: [EventStreamService],
})
export class EventStreamModule {}
