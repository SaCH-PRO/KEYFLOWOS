/**
 * V1-72 (RR-ERASURE-BUSINESS-EVENTS, D-25), review repairs: every write path
 * of BusinessEventService drops a forgotten person's snapshots. emitBatch goes
 * through the same check as emit, and a failed write never logs the
 * unscrubbed event. The forgotten-contact read is stubbed here; the real query
 * is pinned against Postgres in test/contact-privacy-business-events.integration.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { BusinessEventService, contactIdsOfEvent } from './business-event.service';

const SECRET = 'v72w_ada@test.local';
const event = () => ({
  businessId: 'biz_1',
  eventType: 'contact.update',
  subjectType: 'contact',
  subjectId: 'c_forgotten',
  actorType: 'human' as const,
  actorId: 'u1',
  action: 'update',
  source: 'web' as const,
  before: { email: SECRET },
  after: { id: 'c_forgotten', email: SECRET },
  metadata: { route: '/crm/businesses/:businessId/contacts/:contactId', httpMethod: 'PATCH', ip: '203.0.113.9' },
});

function prisma(create: (args: any) => Promise<unknown>) {
  const client: any = {
    $queryRaw: vi.fn(async () => [{ forgotten: true }]),
    businessEvent: { create: vi.fn(create) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { client };
}

describe('BusinessEventService: a forgotten person is dropped on every write path (V1-72 review)', () => {
  it('emitBatch writes a forgotten contact\'s event without before, after or ip', async () => {
    const p = prisma(async (args) => args);
    const svc = new BusinessEventService(p as any);
    await svc.emitBatch([event()]);
    expect(p.client.businessEvent.create).toHaveBeenCalledTimes(1);
    const data = p.client.businessEvent.create.mock.calls[0][0].data;
    expect(data.before).toBeUndefined();
    expect(data.after).toBeUndefined();
    expect(data.metadata).toEqual({ route: '/crm/businesses/:businessId/contacts/:contactId', httpMethod: 'PATCH' });
    expect(JSON.stringify(data)).not.toContain(SECRET);
  });

  it('a failed write logs the scrubbed event, not the personal data', async () => {
    const p = prisma(async () => { throw new Error('insert refused'); });
    const svc = new BusinessEventService(p as any);
    const error = vi.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
    await svc.emit(event());
    expect(error).toHaveBeenCalled();
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain('203.0.113.9');
  });

  it('a failed batch logs no personal data either', async () => {
    const p = prisma(async () => { throw new Error('insert refused'); });
    const svc = new BusinessEventService(p as any);
    const error = vi.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
    await svc.emitBatch([event()]);
    expect(JSON.stringify(error.mock.calls)).not.toContain(SECRET);
  });

  it('emitBatch keeps the snapshots of a contact that is not forgotten', async () => {
    const p = prisma(async (args) => args);
    p.client.$queryRaw = vi.fn(async () => [{ forgotten: false }]);
    const svc = new BusinessEventService(p as any);
    await svc.emitBatch([event()]);
    const data = p.client.businessEvent.create.mock.calls[0][0].data;
    expect(data.before).toEqual({ email: SECRET });
    expect(data.metadata.ip).toBe('203.0.113.9');
  });

  it('emit never throws, even on an input it cannot read', async () => {
    const p = prisma(async (args) => args);
    const svc = new BusinessEventService(p as any);
    vi.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
    await expect(svc.emit(undefined as any)).resolves.toBeUndefined();
  });
});

describe('contactIdsOfEvent: only server-derived data names a contact (V1-72 review round 2, SEC-1)', () => {
  it('reads the subject, contactId/fromContactId/toContactId/targetContactId of the after snapshot, and the route contactId', () => {
    expect(contactIdsOfEvent({
      subjectType: 'contact', subjectId: 'rel_1',
      before: { toContactId: 'c_planted', contactId: 'c_planted2' },
      after: { contactId: 'c_1', fromContactId: 'c_from', toContactId: 'c_to', targetContactId: 'c_target' },
      metadata: { routeContactId: 'c_route' },
    }).sort()).toEqual(['c_1', 'c_from', 'c_route', 'c_target', 'c_to', 'rel_1']);
  });

  it('never reads the request body (before): a planted key names no one', () => {
    expect(contactIdsOfEvent({ subjectType: 'invoice', subjectId: 'inv_1', before: { contactId: 'c_planted' }, after: { id: 'inv_1' } })).toEqual([]);
  });
});
