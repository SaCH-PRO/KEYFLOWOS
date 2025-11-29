import { Test } from '@nestjs/testing';
import { EventEmitterModule, EventEmitter2 } from '@nestjs/event-emitter';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { AiListener } from '../src/modules/ai/ai.listener';

describe('AiListener', () => {
  let app: INestApplication;
  let ai: AiListener;
  let events: EventEmitter2;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot({ wildcard: true })],
      providers: [AiListener],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    ai = app.get(AiListener);
    events = app.get(EventEmitter2);
  });

  afterAll(async () => {
    await app.close();
  });

  it('captures events emitted on the bus', async () => {
    await events.emitAsync('invoice.paid', { eventName: 'invoice.paid', invoiceId: 'inv_1' });
    await events.emitAsync('booking.created', { eventName: 'booking.created', bookingId: 'b_1' });

    const log = ai.getEvents();
    expect(log.find((e) => e.event === 'invoice.paid')).toBeTruthy();
    expect(log.find((e) => e.event === 'booking.created')).toBeTruthy();
  });
});
