/**
 * V1-55-EVT-ACTIVITY-DEDUPE (M50; owner ruling D-08: Activity rows are the
 * user-visible feed, BusinessEvent the audit trail).
 *
 * flow.module.ts registers ActivityEventListener and AutomationExecutorService
 * side by side, and both listened to the same domain events with a feed write:
 * one emit, two Activity rows for the same module, action and entity
 * (CR-V125-1; the web reader business-timeline.tsx DOUBLE_WRITTEN hid the pair).
 * ActivityEventListener is the feed writer; AutomationExecutorService runs the
 * playbooks, flows and built-in rules on the event and writes no second feed
 * row for it.
 *
 * Pinned here, with the listeners wired the way the full app wires them (each
 * handler found by its @OnEvent metadata, both writing to one feed recorder):
 *   AE-01 one feed row per event for the seven deduped events both classes
 *     listen to, and it is ActivityEventListener's row
 *   AE-02 the census: the events both classes listen to are exactly those
 *     seven, and the executor's only other feed event is post.published (a new
 *     double writer fails this)
 *   AE-03 contact.updated without a status change: the listener writes nothing,
 *     so the executor keeps the one 'Contact updated' row
 *   AE-04 post.published: the executor is the only writer and keeps its row
 *   AE-05 flows, playbooks and the built-in rules are still dispatched on every
 *     deduped event (the dedupe removes the feed write only)
 *   AE-06 a playbook's own run row (automation:executed:playbook) is not a feed
 *     duplicate and is still written
 *   AE-07 contact.created (V1-55b-FEED-DEDUPE-REST, was it.todo): one feed row,
 *     the listener's 'New contact'; the executor's 'New contact added' is gone
 *     (log-redaction.integration.test.ts now observes the executor's run
 *     itself, not a feed row, as proof its listener ran)
 *   AE-08 booking.created (V1-55b, was it.todo; review repair CR-V155-1): one
 *     feed row, the listener's, and it says when the booking is.
 *     bookings.service.ts puts the booking row and its contact on the bus,
 *     never the service, so the listener's detail now carries the start time
 *     itself (the executor's removed 'New booking from <contact>' row was the
 *     only one that did)
 *   AE-09 booking.confirmed stays deduped: the executor's removed row was
 *     'Booking confirmed' with no detail, so the listener's row carries all it
 *     did (title, booking, contact) and no start time is lost
 *
 * Pure: Prisma, CRM, e-mail and the flow runner are mocks; ActivityService is a
 * recorder shared by both listeners.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { AutomationExecutorService } from './automation-executor.service';
import { ActivityEventListener } from './activity-event.listener';

/** What @nestjs/event-emitter's @OnEvent stores on the handler (constants.EVENT_LISTENER_METADATA). */
const EVENT_LISTENER_METADATA = 'EVENT_LISTENER_METADATA';

const BIZ = 'biz_v155';
const CONTACT = { id: 'contact_v155', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@v155.test' };
const INVOICE = {
  id: 'inv_v155',
  invoiceNumber: 'INV-V155',
  total: 250,
  currency: 'TTD',
  contactId: CONTACT.id,
  contact: CONTACT,
};
const BOOKING = { id: 'bk_v155', startTime: new Date('2026-11-03T14:00:00Z'), contactId: CONTACT.id, serviceId: 'svc_v155' };
/** booking.created as BookingsService.createBooking emits it: the booking row (contact included, no service) and its contact. */
const BOOKING_CREATED = { businessId: BIZ, booking: { ...BOOKING, contact: CONTACT }, contact: CONTACT, eventName: 'booking.created' };

type FeedRow = { module: string; action: string; entityType: string; entityId?: string; title: string; [k: string]: unknown };

/** The event names each method of `instance` listens to, read from @OnEvent as the event-emitter loader reads them. */
function handlersFor(instance: object, event: string): Array<(payload: unknown) => Promise<unknown>> {
  const proto = Object.getPrototypeOf(instance);
  const out: Array<(payload: unknown) => Promise<unknown>> = [];
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') continue;
    const fn = proto[key];
    if (typeof fn !== 'function') continue;
    const meta: Array<{ event: string | string[] }> | undefined = Reflect.getMetadata(EVENT_LISTENER_METADATA, fn);
    if (meta?.some((m) => (Array.isArray(m.event) ? m.event.includes(event) : m.event === event))) {
      out.push((payload) => fn.call(instance, payload));
    }
  }
  return out;
}

function eventsOf(cls: { prototype: object }): string[] {
  const names = new Set<string>();
  for (const key of Object.getOwnPropertyNames(cls.prototype)) {
    const fn = (cls.prototype as any)[key];
    if (typeof fn !== 'function') continue;
    const meta: Array<{ event: string | string[] }> | undefined = Reflect.getMetadata(EVENT_LISTENER_METADATA, fn);
    for (const m of meta ?? []) for (const e of [m.event].flat()) names.add(String(e));
  }
  return [...names].sort();
}

/** One flow per trigger event, so a dispatch names the event it ran for. */
const flowFor = (event: string) => `flow_${event.replace(/\./g, '_')}`;
const FLOW_EVENTS = [
  'contact.created',
  'contact.updated',
  'contact.stage_changed',
  'booking.created',
  'booking.confirmed',
  'invoice.paid',
  'invoice.sent',
  'invoice.overdue',
];

function harness(opts: { playbooks?: unknown[] } = {}) {
  const feed: FeedRow[] = [];
  const activity = { log: vi.fn(async (row: FeedRow) => { feed.push(row); return row; }) };
  const prisma = {
    client: {
      automation: {
        findMany: vi.fn(async () => opts.playbooks ?? []),
        update: vi.fn(async () => ({})),
      },
      automationFlow: {
        findMany: vi.fn(async () =>
          FLOW_EVENTS.map((event) => ({
            id: flowFor(event),
            name: `Flow on ${event}`,
            versions: [{ nodes: [{ id: 'n1', type: 'trigger', data: { triggerEvent: event } }] }],
          })),
        ),
      },
      invoiceItem: { findMany: vi.fn(async () => []) },
      projectTemplate: { findMany: vi.fn(async () => []) },
      booking: { count: vi.fn(async () => 1) },
    },
  };
  const crm = {
    addTask: vi.fn(async () => ({})),
    contactDetail: vi.fn(async () => ({ contact: { ...CONTACT, tags: [] } })),
    updateContact: vi.fn(async () => ({})),
    logContactEvent: vi.fn(async () => ({})),
  };
  const flowRunner = { runFlow: vi.fn(async () => ({})) };
  const executor = new AutomationExecutorService(prisma as never, activity as never, crm as never, {} as never, null, flowRunner as never);
  const listener = new ActivityEventListener(activity as never);

  /** Deliver `payload` to every handler the full app registers for `event` on these two classes. */
  async function emit(event: string, payload: unknown) {
    for (const handler of [...handlersFor(listener, event), ...handlersFor(executor, event)]) {
      await handler(payload);
    }
  }
  return { feed, activity, prisma, crm, flowRunner, executor, listener, emit };
}

/** The seven events both classes wrote a feed row for and V1-55 / V1-55b dedupe, with the listener's row (the one the feed keeps). */
const DEDUPED: Array<{ event: string; payload: Record<string, unknown>; row: Partial<FeedRow> }> = [
  {
    // AE-07 (V1-55b): the executor's removed row was 'New contact added' (detail the name); the listener's names the contact too.
    event: 'contact.created',
    payload: { businessId: BIZ, contact: CONTACT },
    row: { module: 'crm', action: 'created', entityType: 'contact', entityId: CONTACT.id, title: 'New contact', detail: 'Ada Lovelace added to CRM', contactId: CONTACT.id },
  },
  {
    // AE-08 (V1-55b): the listener's row carries the start time (see the AE-08 case for its detail).
    event: 'booking.created',
    payload: BOOKING_CREATED,
    row: { module: 'bookings', action: 'created', entityType: 'booking', entityId: BOOKING.id, title: 'New booking', contactId: CONTACT.id },
  },
  {
    event: 'contact.updated',
    payload: { businessId: BIZ, contact: CONTACT, fromStatus: 'LEAD', toStatus: 'CUSTOMER' },
    row: { module: 'crm', action: 'updated', entityType: 'contact', entityId: CONTACT.id, title: 'Status changed' },
  },
  {
    // AE-09: the executor's removed row was { title: 'Booking confirmed', contactId } with no detail;
    // the listener's row carries the same title, booking and contact.
    event: 'booking.confirmed',
    payload: { businessId: BIZ, booking: BOOKING, contact: CONTACT },
    row: { module: 'bookings', action: 'confirmed', entityType: 'booking', entityId: BOOKING.id, title: 'Booking confirmed', contactId: CONTACT.id },
  },
  {
    event: 'invoice.paid',
    payload: { businessId: BIZ, invoice: INVOICE, eventName: 'invoice.paid' },
    row: { module: 'commerce', action: 'paid', entityType: 'invoice', entityId: INVOICE.id, title: 'Payment received' },
  },
  {
    event: 'invoice.sent',
    payload: { businessId: BIZ, invoice: INVOICE, status: 'SENT', eventName: 'invoice.sent' },
    row: { module: 'commerce', action: 'sent', entityType: 'invoice', entityId: INVOICE.id, title: 'Invoice sent' },
  },
  {
    event: 'invoice.overdue',
    payload: { businessId: BIZ, invoice: INVOICE, status: 'OVERDUE', eventName: 'invoice.overdue' },
    row: { module: 'commerce', action: 'overdue', entityType: 'invoice', entityId: INVOICE.id, title: 'Invoice overdue' },
  },
];

const sameEntity = (a: Partial<FeedRow>) => (b: FeedRow) =>
  b.module === a.module && b.action === a.action && b.entityType === a.entityType && b.entityId === a.entityId;

describe('V1-55-EVT-ACTIVITY-DEDUPE: AutomationExecutorService writes no second feed row for an event ActivityEventListener writes', () => {
  for (const { event, payload, row } of DEDUPED) {
    it(`AE-01 ${event}: one emit, one feed row for the entity, and it is ActivityEventListener's ('${row.title}')`, async () => {
      const h = harness();
      await h.emit(event, payload);
      const rows = h.feed.filter(sameEntity(row));
      expect(rows.map((r) => r.title), `${event} feed rows for ${row.entityType} ${row.entityId}`).toEqual([row.title]);
      expect(rows[0]).toMatchObject({ ...row, businessId: BIZ });
      // No other feed row either: the only rows the pair writes for the event is the listener's.
      expect(h.feed).toHaveLength(1);
    });
  }

  it("AE-02 census: the events both classes listen to are exactly the seven above, and the executor's only other feed event is post.published", () => {
    const executorEvents = eventsOf(AutomationExecutorService);
    const listenerEvents = new Set(eventsOf(ActivityEventListener));
    expect(executorEvents.filter((e) => listenerEvents.has(e))).toEqual(DEDUPED.map((d) => d.event).sort());
    expect(executorEvents.filter((e) => !listenerEvents.has(e))).toEqual(['post.published']);
  });

  it("AE-07 contact.created (V1-55b, was it.todo): one emit, one feed row for the contact, ActivityEventListener's 'New contact'; the executor writes none and still dispatches the contact.created playbooks and flows", async () => {
    const h = harness();
    await h.emit('contact.created', { businessId: BIZ, contact: CONTACT });
    const rows = h.feed.filter(sameEntity({ module: 'crm', action: 'created', entityType: 'contact', entityId: CONTACT.id }));
    expect(rows.map((r) => r.title)).toEqual(['New contact']);
    expect(rows[0]).toMatchObject({ businessId: BIZ, detail: 'Ada Lovelace added to CRM', contactId: CONTACT.id, icon: 'user-plus' });
    expect(h.feed, 'no other feed row').toHaveLength(1);
    expect(h.prisma.client.automation.findMany).toHaveBeenCalledWith({ where: { businessId: BIZ, trigger: 'contact.created', enabled: true, deletedAt: null } });
    expect(h.flowRunner.runFlow.mock.calls.map((c: any[]) => [c[1], c[2]?.trigger, c[2]?.contactId])).toEqual([[flowFor('contact.created'), 'contact.created', CONTACT.id]]);
  });

  it("AE-08 booking.created (V1-55b, was it.todo; CR-V155-1): with the payload bookings.service.ts puts on the bus (the booking row and its contact, no service), one emit writes ONE feed row for the booking, ActivityEventListener's, and it says when the booking is: its detail names the contact and carries the start time", async () => {
    const h = harness();
    await h.emit('booking.created', BOOKING_CREATED);
    const rows = h.feed.filter(sameEntity({ module: 'bookings', action: 'created', entityType: 'booking', entityId: BOOKING.id }));
    const when = new Date(BOOKING.startTime).toLocaleString();
    expect(rows.map((r) => r.title), 'bookings created rows for the booking').toEqual(['New booking']);
    expect(rows[0]).toMatchObject({ businessId: BIZ, contactId: CONTACT.id, detail: `Ada Lovelace booked an appointment for ${when}` });
    expect(rows[0].data).toMatchObject({ bookingId: BOOKING.id, startTime: BOOKING.startTime });
    expect(h.feed, 'no other feed row').toHaveLength(1);
    expect(h.flowRunner.runFlow.mock.calls.map((c: any[]) => [c[1], c[2]?.trigger, c[2]?.bookingId, c[2]?.contactId])).toEqual([
      [flowFor('booking.created'), 'booking.created', BOOKING.id, CONTACT.id],
    ]);
  });

  it('AE-08b booking.created: a booking that carries its service names it beside the start time; a booking with no readable start time keeps the plain detail (no "Invalid Date")', async () => {
    const withService = harness();
    await withService.emit('booking.created', { ...BOOKING_CREATED, booking: { ...BOOKING_CREATED.booking, service: { name: 'Haircut' } } });
    expect(withService.feed.map((r) => r.detail)).toEqual([`Ada Lovelace booked Haircut for ${new Date(BOOKING.startTime).toLocaleString()}`]);

    for (const startTime of [null, undefined, 'not a date']) {
      const h = harness();
      await h.emit('booking.created', { ...BOOKING_CREATED, booking: { ...BOOKING_CREATED.booking, startTime } });
      expect(h.feed.map((r) => [r.title, r.detail]), String(startTime)).toEqual([['New booking', 'Ada Lovelace booked an appointment']]);
    }
  });

  it('AE-03 contact.updated without a status change: the listener writes nothing, so the executor keeps the one "Contact updated" row', async () => {
    for (const payload of [
      { businessId: BIZ, contact: CONTACT },
      { businessId: BIZ, contact: CONTACT, fromStatus: 'LEAD', toStatus: 'LEAD' },
      { businessId: BIZ, contact: CONTACT, toStatus: 'CUSTOMER' },
    ]) {
      const h = harness();
      await h.emit('contact.updated', payload);
      expect(h.feed, JSON.stringify(payload)).toHaveLength(1);
      expect(h.feed[0]).toMatchObject({ businessId: BIZ, module: 'crm', action: 'updated', entityType: 'contact', entityId: CONTACT.id, title: 'Contact updated', icon: 'UserCog' });
      expect(h.feed[0].detail).toBe(payload.toStatus ? `Status changed to ${payload.toStatus}` : undefined);
    }
  });

  it('AE-04 post.published: the executor is the only writer and keeps its row', async () => {
    const h = harness();
    await h.emit('post.published', { businessId: BIZ, post: { id: 'post_v155', content: 'Hello' } });
    expect(h.feed).toHaveLength(1);
    expect(h.feed[0]).toMatchObject({ businessId: BIZ, module: 'social', action: 'published', entityType: 'post', entityId: 'post_v155', title: 'Social post published' });
  });

  for (const { event, payload } of DEDUPED) {
    it(`AE-05 ${event}: playbooks and flows are still dispatched on the event (the dedupe removes the feed write only)`, async () => {
      const h = harness();
      await h.emit(event, payload);
      expect(h.prisma.client.automation.findMany).toHaveBeenCalledWith({
        where: { businessId: BIZ, trigger: event, enabled: true, deletedAt: null },
      });
      const runs = h.flowRunner.runFlow.mock.calls.map((c: any[]) => [c[0], c[1], c[2]?.trigger]);
      expect(runs).toContainEqual([BIZ, flowFor(event), event]);
    });
  }

  it('AE-05b the built-in rules still run: invoice.paid thank-you task, invoice.overdue collect task and tag, stage change follow-up and stage flow, booking.confirmed follow-up event', async () => {
    const paid = harness();
    await paid.emit('invoice.paid', DEDUPED.find((d) => d.event === 'invoice.paid')!.payload);
    expect(paid.crm.addTask).toHaveBeenCalledWith(expect.objectContaining({ businessId: BIZ, contactId: CONTACT.id, title: 'Send thank-you note', source: 'autopilot' }));
    expect(paid.prisma.client.invoiceItem.findMany).toHaveBeenCalledWith({ where: { invoiceId: INVOICE.id }, select: { productId: true } });

    const overdue = harness();
    await overdue.emit('invoice.overdue', DEDUPED.find((d) => d.event === 'invoice.overdue')!.payload);
    expect(overdue.crm.addTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Collect overdue invoice', priority: 'HIGH' }));
    expect(overdue.crm.updateContact).toHaveBeenCalledWith({ businessId: BIZ, contactId: CONTACT.id, tags: ['overdue'] });

    const stage = harness();
    await stage.emit('contact.updated', DEDUPED.find((d) => d.event === 'contact.updated')!.payload);
    expect(stage.crm.addTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Follow up after stage change' }));
    expect(stage.flowRunner.runFlow.mock.calls.map((c: any[]) => c[1])).toContain(flowFor('contact.stage_changed'));

    const confirmed = harness();
    await confirmed.emit('booking.confirmed', DEDUPED.find((d) => d.event === 'booking.confirmed')!.payload);
    expect(confirmed.crm.logContactEvent).toHaveBeenCalledWith(expect.objectContaining({ businessId: BIZ, contactId: CONTACT.id, type: 'booking.status.followup' }));
  });

  it("AE-06 a playbook's own run row is not a feed duplicate: a playbook on invoice.paid still runs and logs automation:executed:playbook next to the one paid row", async () => {
    const h = harness({
      playbooks: [{ id: 'pb_v155', name: 'Thank on paid', condition: null, actionData: { type: 'CREATE_TASK', title: 'Call to thank' } }],
    });
    await h.emit('invoice.paid', DEDUPED.find((d) => d.event === 'invoice.paid')!.payload);
    expect(h.crm.addTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Call to thank', source: 'automation' }));
    expect(h.prisma.client.automation.update).toHaveBeenCalledWith({ where: { id: 'pb_v155' }, data: expect.objectContaining({ runCount: { increment: 1 } }) });
    expect(h.feed.map((r) => `${r.module}:${r.action}:${r.entityType}:${r.entityId}`).sort()).toEqual([
      'automation:executed:playbook:pb_v155',
      `commerce:paid:invoice:${INVOICE.id}`,
    ]);
  });
});
