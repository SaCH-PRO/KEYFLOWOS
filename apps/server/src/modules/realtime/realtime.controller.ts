import { Controller, Sse, Param, UseGuards, Req } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RealtimeService } from './realtime.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('realtime')
@UseGuards(AuthGuard, BusinessGuard)
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Sse('businesses/:businessId/events')
  events(@Param('businessId') businessId: string): Observable<MessageEvent> {
    return this.realtime.streamForBusiness(businessId);
  }
}
