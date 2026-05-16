import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      // Default maxListeners is 10. With 40+ feature modules registering
      // listeners on the event bus, we routinely exceed that. Raising to 50
      // eliminates the Node EventEmitter memory-leak warning.
      maxListeners: 50,
    }),
  ],
  exports: [EventEmitterModule],
})
export class EventBusModule {}
