import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export interface RealtimeEvent {
  businessId: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

@Injectable()
export class RealtimeService {
  private readonly events$ = new Subject<RealtimeEvent>();

  emit(event: Omit<RealtimeEvent, 'timestamp'>) {
    this.events$.next({ ...event, timestamp: new Date().toISOString() });
  }

  streamForBusiness(businessId: string): Observable<MessageEvent> {
    return this.events$.pipe(
      filter((e) => e.businessId === businessId),
      map((e) => ({ data: JSON.stringify(e) } as MessageEvent)),
    );
  }
}
