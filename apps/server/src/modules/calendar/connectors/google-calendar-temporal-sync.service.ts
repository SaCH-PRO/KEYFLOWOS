import { Injectable, Inject, Logger } from '@nestjs/common';
import { CalendarService } from '../../bookings/calendar.service';
import { TemporalFlowService } from '../../temporal-flow/temporal-flow.service';
import type { TemporalConnectorNormalizer, TemporalFlowEventInput } from '../../temporal-flow/temporal-flow.types';

const PULL_HORIZON_DAYS = 60;

@Injectable()
export class GoogleCalendarTemporalSyncService implements TemporalConnectorNormalizer<unknown> {
  readonly source = 'GOOGLE_CALENDAR';
  private readonly logger = new Logger(GoogleCalendarTemporalSyncService.name);

  constructor(
    @Inject(CalendarService) private readonly calendar: CalendarService,
    @Inject(TemporalFlowService) private readonly temporal: TemporalFlowService,
  ) {}

  normalize(businessId: string, payload: unknown): TemporalFlowEventInput[] {
    const event = payload as {
      id: string;
      summary?: string;
      description?: string;
      start?: string;
      end?: string;
      updated?: string;
      htmlLink?: string;
      location?: string;
      organizer?: string;
      attendees?: Array<{ email: string; displayName?: string }>;
    };

    return [
      {
        businessId,
        source: 'GOOGLE_CALENDAR',
        type: 'google_calendar.event.synced',
        module: 'calendar',
        entityType: 'calendar_event',
        entityId: event.id,
        externalId: event.id,
        externalUrl: event.htmlLink,
        title: event.summary || '(No title)',
        summary: event.description,
        startsAt: event.start ? new Date(event.start) : undefined,
        endsAt: event.end ? new Date(event.end) : undefined,
        occurredAt: event.updated ? new Date(event.updated) : new Date(),
        payload: event as Record<string, unknown>,
        tags: ['calendar', 'external'],
      },
    ];
  }

  async syncBusiness(businessId: string): Promise<{ synced: number; skipped: number }> {
    let synced = 0;
    let skipped = 0;

    try {
      const status = await this.calendar.getCalendarStatus(businessId);
      if (!status.connected) {
        return { synced: 0, skipped: 0 };
      }

      const now = new Date();
      const horizon = new Date(now.getTime() + PULL_HORIZON_DAYS * 24 * 60 * 60 * 1000);
      const events = await this.calendar.listCalendarEvents(
        businessId,
        now.toISOString(),
        horizon.toISOString(),
      );

      for (const ev of events) {
        try {
          const inputs = this.normalize(businessId, ev as unknown);
          for (const input of inputs) {
            await this.temporal.emit(input);
            synced += 1;
          }
        } catch (err: any) {
          this.logger.warn(`Google Calendar temporal sync skipped event: ${(err as Error).message}`);
          skipped += 1;
        }
      }
    } catch (err: any) {
      this.logger.warn(`Google Calendar temporal sync failed: ${(err as Error).message}`);
    }

    return { synced, skipped };
  }
}
