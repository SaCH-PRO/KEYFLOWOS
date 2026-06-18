import { Test } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import type { INestApplication } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CalendarConnectorListener } from '../src/modules/calendar/listeners/connector.listener';
import { CalendarActionIntelligenceService } from '../src/modules/calendar/calendar-action-intelligence.service';
import { BusinessEventService } from '../src/modules/business-events/business-event.service';
import { AiUsageService } from '../src/modules/ai/ai-usage.service';
import type {
  CalendarEventCreatedPayload,
  CalendarEventUpdatedPayload,
} from '../src/core/event-bus/events.types';

function future(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

describe('Calendar action intelligence smoke (B.4)', () => {
  let app: INestApplication;
  let emitter: EventEmitter2;
  let businessEmit: ReturnType<typeof vi.fn>;
  let aiTrack: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    businessEmit = vi.fn().mockResolvedValue(undefined);
    aiTrack = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        intent: 'appointment',
        urgency: 'normal',
        confidence: 0.9,
        summary: 'Smoke-test calendar event',
        suggestedActions: [
          { type: 'review', label: 'Review calendar event', confidence: 0.9, payload: {} },
        ],
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        CalendarConnectorListener,
        CalendarActionIntelligenceService,
        { provide: BusinessEventService, useValue: { emit: businessEmit } },
        { provide: AiUsageService, useValue: { trackAndComplete: aiTrack } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    emitter = app.get(EventEmitter2);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('emits audit + action-suggestion events on calendar_event.created', async () => {
    const payload: CalendarEventCreatedPayload = {
      connectorType: 'google_calendar',
      externalId: 'evt_smoke_1',
      businessId: 'biz_smoke',
      timestamp: new Date(),
      title: 'Smoke Test Created',
      startTime: future(2),
      endTime: future(3),
      bookingId: 'bk_smoke_1',
    };

    await emitter.emitAsync('calendar_event.created', payload);
    await new Promise((r) => setTimeout(r, 100));

    const eventTypes = businessEmit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain('calendar_event.created');
    expect(eventTypes).toContain('calendar_event.actions_suggested');
    expect(businessEmit).toHaveBeenCalledTimes(2);
    expect(aiTrack).toHaveBeenCalledTimes(1);
  });

  it('emits audit + action-suggestion events on calendar_event.updated', async () => {
    const payload: CalendarEventUpdatedPayload = {
      connectorType: 'google_calendar',
      externalId: 'evt_smoke_2',
      businessId: 'biz_smoke',
      timestamp: new Date(),
      title: 'Smoke Test Updated',
      startTime: future(4),
      endTime: future(5),
    };

    await emitter.emitAsync('calendar_event.updated', payload);
    await new Promise((r) => setTimeout(r, 100));

    const eventTypes = businessEmit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain('calendar_event.updated');
    expect(eventTypes).toContain('calendar_event.actions_suggested');
    expect(businessEmit).toHaveBeenCalledTimes(2);
    expect(aiTrack).toHaveBeenCalledTimes(1);
  });
});
