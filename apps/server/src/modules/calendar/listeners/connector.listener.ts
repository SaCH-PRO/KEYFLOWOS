import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BusinessEventService } from '../../business-events/business-event.service';
import { CalendarActionIntelligenceService } from '../calendar-action-intelligence.service';
import type {
  CalendarEventCreatedPayload,
  CalendarEventUpdatedPayload,
} from '../../../core/event-bus/events.types';

@Injectable()
export class CalendarConnectorListener {
  private readonly logger = new Logger(CalendarConnectorListener.name);

  constructor(
    @Inject(BusinessEventService) private readonly businessEventService: BusinessEventService,
    @Inject(CalendarActionIntelligenceService)
    private readonly actionIntelligence: CalendarActionIntelligenceService,
  ) {}

  @OnEvent('calendar_event.created', { async: true })
  async onCalendarEventCreated(payload: CalendarEventCreatedPayload): Promise<void> {
    if (!payload?.businessId) return;
    try {
      await this.emitTemporalEvent(payload, 'calendar_event.created', 'create');
      await this.actionIntelligence.analyzeEvent(payload.businessId, payload);
    } catch (err: any) {
      this.logger.warn(
        `Calendar created handler failed: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('calendar_event.updated', { async: true })
  async onCalendarEventUpdated(payload: CalendarEventUpdatedPayload): Promise<void> {
    if (!payload?.businessId) return;
    try {
      await this.emitTemporalEvent(payload, 'calendar_event.updated', 'update');
      await this.actionIntelligence.analyzeEvent(payload.businessId, payload);
    } catch (err: any) {
      this.logger.warn(
        `Calendar updated handler failed: ${(err as Error).message}`,
      );
    }
  }

  private async emitTemporalEvent(
    payload: CalendarEventCreatedPayload | CalendarEventUpdatedPayload,
    eventType: string,
    action: string,
  ): Promise<void> {
    const startTime = payload.startTime ? new Date(payload.startTime) : null;
    await this.businessEventService.emit({
      businessId: payload.businessId,
      eventType,
      subjectType: 'CalendarEvent',
      subjectId: payload.externalId ?? `${payload.title}:${startTime?.toISOString() ?? Date.now()}`,
      actorType: 'integration',
      actorId: payload.connectorType ?? 'google_calendar',
      action,
      source: 'api',
      after: {
        connectorType: payload.connectorType,
        externalId: payload.externalId,
        title: payload.title,
        startTime: payload.startTime,
        endTime: payload.endTime,
        bookingId: (payload as CalendarEventCreatedPayload).bookingId,
      },
      metadata: {
        feature: 'calendar',
        connectorType: payload.connectorType ?? 'google_calendar',
      },
    });
  }
}
