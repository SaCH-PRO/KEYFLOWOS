import { Test } from '@nestjs/testing';
import { EventEmitterModule, EventEmitter2 } from '@nestjs/event-emitter';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { AiListener } from '../src/modules/ai/ai.listener';
import { BusinessGraphService } from '../src/modules/ai/business-graph.service';

describe('AiListener', () => {
  let app: INestApplication;
  let ai: AiListener;
  let events: EventEmitter2;
  const invalidateCache = vi.fn();

  beforeEach(async () => {
    invalidateCache.mockClear();
    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot({ wildcard: true })],
      providers: [
        AiListener,
        { provide: BusinessGraphService, useValue: { invalidateCache } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    ai = app.get(AiListener);
    events = app.get(EventEmitter2);
  });

  afterEach(async () => {
    await app.close();
  });

  it('captures events emitted on the bus', async () => {
    await events.emitAsync('invoice.paid', { eventName: 'invoice.paid', invoiceId: 'inv_1', businessId: 'biz_a' });
    await events.emitAsync('booking.created', { eventName: 'booking.created', bookingId: 'b_1', businessId: 'biz_a' });

    const log = ai.getEvents();
    expect(log.find((e) => e.event === 'invoice.paid')).toBeTruthy();
    expect(log.find((e) => e.event === 'booking.created')).toBeTruthy();
  });

  const invalidatingCases: Array<[string, string]> = [
    ['contact.created', 'biz_contact'],
    ['contact.updated', 'biz_contact'],
    ['contact.deleted', 'biz_contact'],
    ['contact.merged', 'biz_contact'],
    ['contact.imported', 'biz_contact'],
    ['invoice.paid', 'biz_inv'],
    ['invoice.sent', 'biz_inv'],
    ['invoice.overdue', 'biz_inv'],
    ['booking.created', 'biz_book'],
    ['booking.confirmed', 'biz_book'],
    ['booking.completed', 'biz_book'],
    ['booking.cancelled', 'biz_book'],
    ['booking.rescheduled', 'biz_book'],
    ['product.created', 'biz_prod'],
    ['product.updated', 'biz_prod'],
    ['product.deactivated', 'biz_prod'],
    ['expense.created', 'biz_exp'],
    ['store_order.created', 'biz_store'],
    ['store_order.paid', 'biz_store'],
    ['store_order.shipped', 'biz_store'],
    ['action.executed', 'biz_act'],
    ['action.blocked', 'biz_act'],
  ];

  it.each(invalidatingCases)(
    'invalidates the graph cache for %s with the right businessId',
    async (eventName, businessId) => {
      await events.emitAsync(eventName, { eventName, businessId });
      expect(invalidateCache).toHaveBeenCalledWith(businessId);
    },
  );

  it('emits graph.cache_invalidated with the source event after invalidation', async () => {
    const cacheEvents: any[] = [];
    events.on('graph.cache_invalidated', (p) => cacheEvents.push(p));

    await events.emitAsync('booking.created', { eventName: 'booking.created', businessId: 'biz_x' });

    expect(cacheEvents).toHaveLength(1);
    expect(cacheEvents[0]).toMatchObject({
      businessId: 'biz_x',
      reason: 'data_change',
      sourceEvent: 'booking.created',
    });
  });

  it('does not invalidate cache for non-invalidating domains', async () => {
    await events.emitAsync('campaign.sent', { eventName: 'campaign.sent', businessId: 'biz_y' });
    await events.emitAsync('post.published', { eventName: 'post.published', businessId: 'biz_y' });
    await events.emitAsync('quote.created', { eventName: 'quote.created', businessId: 'biz_y' });

    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it('does not invalidate cache when payload is missing businessId', async () => {
    await events.emitAsync('invoice.paid', { eventName: 'invoice.paid', invoiceId: 'inv_no_biz' });
    expect(invalidateCache).not.toHaveBeenCalled();
  });
});
