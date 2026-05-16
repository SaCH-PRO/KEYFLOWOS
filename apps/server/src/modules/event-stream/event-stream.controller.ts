import { Controller, Get, Param, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { EventStreamService, StreamEnvelope } from './event-stream.service';

@Controller()
@UseGuards(AuthGuard, BusinessGuard)
export class EventStreamController {
  constructor(private readonly stream: EventStreamService) {}

  @Sse('businesses/:businessId/events/stream')
  streamEvents(@Param('businessId') businessId: string): Observable<StreamEnvelope> {
    const { observable, cleanup } = this.stream.subscribe(businessId);
    // NestJS handles cleanup when client disconnects via observable completion
    observable.subscribe({
      error: cleanup,
      complete: cleanup,
    });
    return observable;
  }
}
