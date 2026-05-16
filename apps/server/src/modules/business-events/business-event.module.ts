import { Module, Global } from '@nestjs/common';
import { BusinessEventService } from './business-event.service';
import { BusinessEventInterceptor } from './business-event.interceptor';
import { BusinessEventQueueService } from './business-event.queue';
import { ResilientEmitterService } from './resilient-emitter.service';
import { BusinessEventAnomalyService } from './business-event-anomaly.service';

@Global()
@Module({
  providers: [
    BusinessEventService,
    BusinessEventInterceptor,
    BusinessEventQueueService,
    ResilientEmitterService,
    BusinessEventAnomalyService,
  ],
  exports: [
    BusinessEventService,
    BusinessEventInterceptor,
    BusinessEventQueueService,
    ResilientEmitterService,
    BusinessEventAnomalyService,
  ],
})
export class BusinessEventModule {}
