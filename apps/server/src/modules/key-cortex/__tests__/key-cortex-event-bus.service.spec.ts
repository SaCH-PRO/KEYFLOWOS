import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexEventBusService } from '../key-cortex-event-bus.service';

const mockPrisma = {
  client: {
    businessEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
};

function createBus(): KeyCortexEventBusService {
  return new KeyCortexEventBusService(mockPrisma as any);
}

describe('KeyCortexEventBusService', () => {
  let bus: KeyCortexEventBusService;

  beforeEach(() => {
    vi.clearAllMocks();
    bus = createBus();
  });

  it('publishes an event to type-specific subscribers', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribe('lead.created', handler);

    const event = await bus.publish({
      source: 'crm',
      type: 'lead.created',
      businessId: 'biz_1',
      payload: { leadId: 'l1' },
    });

    expect(event.type).toBe('lead.created');
    expect(event.businessId).toBe('biz_1');
    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeInstanceOf(Date);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ payload: { leadId: 'l1' } }));
  });

  it('does not notify unrelated subscribers', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribe('invoice.paid', handler);

    await bus.publish({
      source: 'crm',
      type: 'lead.created',
      businessId: 'biz_1',
      payload: {},
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('notifies wildcard subscribers of all events', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribeAll(handler);

    await bus.publish({ source: 'a', type: 'a.b', businessId: 'biz_1', payload: {} });
    await bus.publish({ source: 'b', type: 'c.d', businessId: 'biz_1', payload: {} });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('notifies source-specific subscribers', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribeSource('key_inbox', handler);

    await bus.publish({ source: 'key_inbox', type: 'message.received', businessId: 'biz_1', payload: {} });
    await bus.publish({ source: 'temporal_flow', type: 'event.recorded', businessId: 'biz_1', payload: {} });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe removes the handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const unsubscribe = bus.subscribe('lead.created', handler);

    unsubscribe();

    await bus.publish({ source: 'crm', type: 'lead.created', businessId: 'biz_1', payload: {} });

    expect(handler).not.toHaveBeenCalled();
  });

  it('persists every event to the audit ledger', async () => {
    await bus.publish({
      source: 'key_inbox',
      type: 'message.received',
      businessId: 'biz_1',
      payload: { msgId: 'm1' },
      metadata: { entityType: 'Message', entityId: 'm1', importance: 'high' },
    });

    expect(mockPrisma.client.businessEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz_1',
          eventType: 'message.received',
          subjectType: 'Message',
          subjectId: 'm1',
          actorType: 'key_inbox',
          source: 'key_cortex_event_bus',
        }),
      }),
    );
  });

  it('isolates subscriber failures so other handlers still run', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('fail'));
    const succeeding = vi.fn().mockResolvedValue(undefined);
    bus.subscribe('lead.created', failing);
    bus.subscribe('lead.created', succeeding);

    await bus.publish({ source: 'crm', type: 'lead.created', businessId: 'biz_1', payload: {} });

    expect(failing).toHaveBeenCalled();
    expect(succeeding).toHaveBeenCalled();
  });

  it('exposes subscriber counts', () => {
    bus.subscribe('lead.created', vi.fn());
    bus.subscribe('lead.created', vi.fn());
    bus.subscribeAll(vi.fn());

    expect(bus.getSubscriberCount('lead.created')).toBe(2);
    expect(bus.getSubscriberCount()).toBe(3);
  });

  it('emit is fire-and-forget', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.subscribe('lead.created', handler);

    bus.emit({ source: 'crm', type: 'lead.created', businessId: 'biz_1', payload: {} });

    // Wait a tick for the promise to resolve
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).toHaveBeenCalled();
  });
});
