/**
 * V1-72 review (SEC-3): two writers create business_events rows directly,
 * not through BusinessEventService.emit, and can carry personal data under a
 * contact subject: KEY's analytics track_event (properties in metadata) and
 * the KEY cortex event bus audit (the bus payload in after). Both apply the
 * same write-time forgotten-contact check before their create.
 */
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsAdapterService } from '../key-cortex/adapters/analytics-adapter.service';
import { KeyCortexEventBusService } from '../key-cortex/key-cortex-event-bus.service';

const SECRET = 'v72w_ada@test.local';

function prisma(forgotten: boolean) {
  const create = vi.fn(async (args: any) => ({ id: 'evt_1', ...args.data }));
  return { client: { $queryRaw: vi.fn(async () => [{ forgotten }]), businessEvent: { create } }, create };
}

describe('direct business_events writers drop a forgotten person (V1-72 review, SEC-3)', () => {
  it('analytics track_event on a forgotten contact writes no properties', async () => {
    const p = prisma(true);
    const svc = new AnalyticsAdapterService({} as never, {} as never, p as never);
    await (svc as any).trackEvent({ businessId: 'biz_1', eventName: 'viewed', contactId: 'c_forgotten', properties: { email: SECRET }, actorId: 'key' });
    const data = p.create.mock.calls[0][0].data;
    expect(JSON.stringify(data)).not.toContain(SECRET);
    expect(data.subjectId).toBe('c_forgotten');
  });

  it('analytics track_event on a contact that is not forgotten keeps its properties', async () => {
    const p = prisma(false);
    const svc = new AnalyticsAdapterService({} as never, {} as never, p as never);
    await (svc as any).trackEvent({ businessId: 'biz_1', eventName: 'viewed', contactId: 'c_live', properties: { email: SECRET }, actorId: 'key' });
    expect(p.create.mock.calls[0][0].data.metadata).toEqual({ email: SECRET });
  });

  it('the event bus audit of a forgotten contact writes no payload', async () => {
    const p = prisma(true);
    const bus = new KeyCortexEventBusService(p as never);
    await (bus as any).persistAudit({
      id: 'e1', type: 'contact.updated', businessId: 'biz_1', source: 'ai', userId: 'u1',
      payload: { contactId: 'c_forgotten', email: SECRET },
      metadata: { entityType: 'contact', entityId: 'c_forgotten', correlationId: 'corr_1' },
    });
    const data = p.create.mock.calls[0][0].data;
    expect(JSON.stringify(data)).not.toContain(SECRET);
    expect(data.correlationId).toBe('corr_1');
  });

  it('the event bus audit in the bridge\'s real shape (entityType \'Contact\', the contact nested) of a forgotten contact writes no payload', async () => {
    const p = prisma(true);
    const bus = new KeyCortexEventBusService(p as never);
    await (bus as any).persistAudit({
      id: 'e3', type: 'contact.updated', businessId: 'biz_1', source: 'system',
      payload: { contact: { id: 'c_forgotten', email: SECRET }, businessId: 'biz_1' },
      metadata: { entityType: 'Contact', entityId: 'c_forgotten' },
    });
    expect(p.client.$queryRaw).toHaveBeenCalled();
    expect(JSON.stringify(p.create.mock.calls[0][0].data)).not.toContain(SECRET);
  });

  it('KEY analytics properties cannot set routeContactId (it names a contact only when the interceptor records it)', async () => {
    const p = prisma(false);
    const svc = new AnalyticsAdapterService({} as never, {} as never, p as never);
    await (svc as any).trackEvent({ businessId: 'biz_1', eventName: 'viewed', contactId: 'c_live', properties: { url: '/', routeContactId: 'c_other' }, actorId: 'key' });
    expect(p.create.mock.calls[0][0].data.metadata).toEqual({ url: '/' });
  });

  it('KEY analytics properties cannot set the keys a scrubbed row keeps (route, httpMethod)', async () => {
    const p = prisma(true);
    const svc = new AnalyticsAdapterService({} as never, {} as never, p as never);
    await (svc as any).trackEvent({ businessId: 'biz_1', eventName: 'viewed', contactId: 'c_forgotten', properties: { route: SECRET, httpMethod: SECRET }, actorId: 'key' });
    expect(JSON.stringify(p.create.mock.calls[0][0].data)).not.toContain(SECRET);
  });

  it('the event bus copy of a business event (any subject type) about a forgotten contact writes no payload', async () => {
    const p = prisma(true);
    const bus = new KeyCortexEventBusService(p as never);
    await (bus as any).persistAudit({
      id: 'e4', type: 'task.update', businessId: 'biz_1', source: 'web',
      payload: {
        businessId: 'biz_1', eventType: 'task.update', subjectType: 'task', subjectId: 't_1',
        before: { title: SECRET }, after: { id: 't_1', contactId: 'c_forgotten', title: SECRET },
        metadata: { route: '/crm/businesses/:businessId/tasks/:taskId', httpMethod: 'PATCH', ip: '203.0.113.9' },
      },
      metadata: { entityType: 'Task', entityId: 't_1' },
    });
    expect(p.client.$queryRaw).toHaveBeenCalled();
    expect(JSON.stringify(p.create.mock.calls[0][0].data)).not.toContain(SECRET);
  });

  it('the event bus audit of a contact that is not forgotten keeps its payload', async () => {
    const p = prisma(false);
    const bus = new KeyCortexEventBusService(p as never);
    await (bus as any).persistAudit({
      id: 'e2', type: 'contact.updated', businessId: 'biz_1', source: 'ai', userId: 'u1',
      payload: { contactId: 'c_live', email: SECRET },
      metadata: { entityType: 'contact', entityId: 'c_live' },
    });
    expect(p.create.mock.calls[0][0].data.after).toEqual({ contactId: 'c_live', email: SECRET });
  });
});
