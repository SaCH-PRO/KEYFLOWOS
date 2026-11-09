/**
 * PR196-CRM-LIFECYCLE (V1-88, owner ruling D-81) — a paid invoice moves its
 * contact from LEAD or PROSPECT to CLIENT (REAL database, REAL event bus).
 *
 * PR #196 feature 3 (advanceContactLifecycle) is rebuilt under D-81 with its
 * verified defects fixed (pr196-review verdicts, real only):
 *   MC-14  the move was read-then-write (an unconditional update by id): it is
 *          a compare-and-set on the status just read, so concurrent or replayed
 *          deliveries move the contact once
 *   MC-15  duplicate status rows in the Activity feed: one feed row per move (D-08)
 *   MC-16  a raw contact.update outside CrmService: the move goes through
 *          CrmService, records a ContactAuditEntry (SYSTEM, naming the invoice)
 *          and emits contact.updated
 *   MC-21  the "open task" check used 'COMPLETED': the follow-up is created with
 *          the canonical task status (TASK_STATUS.OPEN) and is never suppressed by
 *          the contact's DONE tasks
 *   MC-22  any unrelated open task suppressed the follow-up, and check-then-create
 *          raced: the follow-up is gated by the compare-and-set itself, so exactly
 *          one is created for the move whatever other tasks exist
 *   MC-23 (nit, real part) the follow-up wrote no task_added audit: CrmService writes it
 *          in the move's transaction with its SYSTEM task.created entry and records its
 *          task_added audit, assigned to the contact's owner (D-81) while they are a member
 * D-81 narrows the PR: only invoice.paid moves a contact (not booking.confirmed,
 * store_order.paid, payment.received or quote.*), only LEAD/PROSPECT -> CLIENT,
 * forward-only (a refund's invoice.reopened never moves it back), lifecycleStage
 * untouched, the invoice's own contact in the invoice's business.
 *
 * Cases (RED-BEFORE fail on the unmodified listener; CTL pass before and after):
 *   L-01 CTL         wiring: RevenueEventListener is subscribed to invoice.paid on the bus
 *   L-02 RED-BEFORE  a paid invoice moves its LEAD contact to CLIENT: audited (SYSTEM, the
 *                    invoice), one contact.updated, one status.changed ContactEvent, one
 *                    status feed row, lifecycleStage untouched, one OPEN follow-up task for
 *                    the contact's owner with its task_added audit and assignment
 *   L-03 RED-BEFORE  PROSPECT -> CLIENT the same way
 *   L-04 CTL         CLIENT and LOST contacts are untouched (no task, audit, event, feed row)
 *   L-05 CTL         booking.confirmed, store_order.paid, payment.received and quote.accepted
 *                    leave a LEAD a LEAD with no follow-up
 *   L-06 RED-BEFORE  replayed invoice.paid deliveries: one move, one follow-up, one audit,
 *                    one contact.updated, one feed row
 *   L-07 RED-BEFORE  concurrent deliveries of two paid invoices of one contact (each delivered
 *                    three times at once): one move, one follow-up, one audit, one feed row
 *   L-08 RED-BEFORE  an unrelated OPEN task and DONE / COMPLETED tasks do not suppress the
 *                    follow-up, and are left as they were
 *   L-09 RED-BEFORE  a refund's invoice.reopened leaves the contact CLIENT; paying again adds
 *                    nothing
 *   L-10 CTL         another tenant's event naming this tenant's invoice changes nothing, both ways
 *   L-11 RED-BEFORE  a payload naming another tenant's contact moves only the invoice's own
 *                    contact, in the invoice's business
 *
 * Review repairs (PR196-CRM-LIFECYCLE review; RED before the repair):
 *   SEC-L81-1 (every move case, in expectMovedOnce) the follow-up's task.created ContactEvent
 *                    names SYSTEM (source lifecycle-automation, no actor id), as its task_added
 *                    audit does; CrmTimelineService.addTask recorded it as a USER with a null id
 *                    and mirrored that USER row into the Activity feed. The move now writes ONE
 *                    Activity row of its own, the status row (D-08): no task.created feed row
 *   L-14 (SEC-L81-2) a contact whose owner is no longer a member of the business (a removed
 *                    member keeps Contact.ownerId) or is a member of another business only: the
 *                    contact moves and its one follow-up stays in the business, unassigned, with
 *                    no TaskAssignment naming the outsider
 *
 * Nothing on the event path is mocked: PrismaService, the user, business,
 * membership, contact, invoice and task rows, the real EventEmitter2
 * (EventEmitterModule with event-bus.module.ts's options), RevenueEventListener,
 * CrmService, CrmTimelineService, ContactAuditService, TimelineService (the
 * ContactEvent mirror into Activity) and ActivityEventListener + ActivityService
 * (the Activity feed writer for contact.updated, D-08) write real rows. Off the
 * path and stubbed: plan limits, the contact stats / flow caches, lists, entity
 * resolution, custom field values, evidence, task assignment service, and the
 * contact insight snapshot (markStale recorded). No HTTP route is involved: the
 * trigger is the bus event the invoice workflow emits after commit, delivered
 * with the payload it carries (the invoice row).
 *
 * Fixtures: prefix `v88e_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (sqlLikePrefix) in beforeAll and afterAll; no
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v88e_';

const ID = {
  owner: `${P}owner`, // OWNER of bizA
  rep: `${P}rep`, // STAFF member of bizA; owns the contacts (the follow-up goes to them)
  bizA: `${P}bizA`,
  ownerB: `${P}ownerB`,
  bizB: `${P}bizB`,
  cLead: `${P}cLead`,
  cProspect: `${P}cProspect`,
  cClient: `${P}cClient`,
  cLost: `${P}cLost`,
  cOther: `${P}cOther`, // L-05
  cReplay: `${P}cReplay`,
  cRace: `${P}cRace`,
  cTasks: `${P}cTasks`,
  cRefund: `${P}cRefund`,
  cTenantA: `${P}cTenantA`, // L-10 / L-11: bizA's LEAD
  cTenantB: `${P}cTenantB`, // L-10 / L-11: bizB's LEAD
  gone: `${P}gone`, // L-14: was a STAFF member of bizA, removed (membership deleted)
  cGoneOwner: `${P}cGoneOwner`, // L-14: bizA's LEAD owned by the removed member
  cForeignOwner: `${P}cForeignOwner`, // L-14: bizA's PROSPECT owned by bizB's owner (no bizA membership)
};

/** The follow-up's source (as PR #196 named it). */
const FOLLOW_UP_SOURCE = 'lifecycle-automation';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let db: any;
let app: any;
let bus: any;
let listener: any;
const contactUpdated: any[] = [];
const insightMarks: Array<{ businessId: string; contactId: string }> = [];

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension), children first.
  for (const sql of [
    `DELETE FROM task_assignments WHERE assignable_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM task_assignments WHERE task_id IN (SELECT id FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

let invSeq = 0;
/** A PAID invoice of `contactId` in `businessId`; returns the row as the workflow's invoice.paid payload carries it. */
async function paidInvoice(businessId: string, contactId: string) {
  invSeq += 1;
  const id = `${P}inv${invSeq}`;
  await db.invoice.create({
    data: {
      id,
      businessId,
      contactId,
      invoiceNumber: `${P}INV-${invSeq}`,
      status: 'PAID',
      subtotal: 150,
      total: 150,
      currency: 'TTD',
      paidAt: new Date(),
    },
  });
  return db.invoice.findUnique({ where: { id }, include: { items: true, contact: true } });
}

const paidEvent = (invoice: any, businessId = invoice.businessId) => ({ invoice, businessId, eventName: 'invoice.paid' });

/** Everything the lifecycle move may write for a contact, read back from the database and the bus recorder. */
async function lifecycleOf(contactId: string) {
  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: { businessId: true, status: true, lifecycleStage: true, ownerId: true },
  });
  const tasks = await db.contactTask.findMany({ where: { contactId }, orderBy: { createdAt: 'asc' } });
  const followUps = tasks.filter((t: any) => t.source === FOLLOW_UP_SOURCE);
  const audits = await db.contactAuditEntry.findMany({ where: { contactId }, orderBy: { createdAt: 'asc' } });
  const statusEvents = await db.contactEvent.findMany({ where: { contactId, type: 'status.changed' } });
  const events = await db.contactEvent.findMany({ where: { contactId } });
  const feed = await db.activity.findMany({ where: { contactId }, orderBy: { createdAt: 'asc' } });
  const statusFeed = feed.filter((r: any) => r.module === 'crm' && (r.action === 'updated' || r.action === 'status.changed'));
  const taskFeed = feed.filter((r: any) => r.module === 'crm' && r.action === 'task.created');
  const assignments = followUps.length
    ? await db.taskAssignment.findMany({ where: { taskType: 'ContactTask', taskId: { in: followUps.map((t: any) => t.id) } } })
    : [];
  const updates = contactUpdated.filter((p) => p.contact?.id === contactId);
  return { contact, tasks, followUps, audits, statusEvents, events, feed, statusFeed, taskFeed, assignments, updates };
}

/** Wait until what the bus handlers write for these contacts stops changing (four reads 250 ms apart, 10 s cap). */
async function settle(contactIds: string[]) {
  const fingerprint = async () => {
    const parts: unknown[] = [];
    for (const id of contactIds) {
      const s = await lifecycleOf(id);
      parts.push([s.contact?.status, s.tasks.length, s.audits.length, s.events.length, s.feed.length, s.assignments.length, s.updates.length]);
    }
    return JSON.stringify(parts);
  };
  let prev = await fingerprint();
  let stable = 0;
  const deadline = Date.now() + 10_000;
  while (stable < 4 && Date.now() < deadline) {
    await sleep(250);
    const next = await fingerprint();
    stable = next === prev ? stable + 1 : 0;
    prev = next;
  }
}

/** Nothing of the lifecycle move was written for the contact (status as seeded). */
function expectUntouched(s: Awaited<ReturnType<typeof lifecycleOf>>, status: string) {
  expect(s.contact.status).toBe(status);
  expect(s.followUps, 'no follow-up task').toEqual([]);
  expect(s.audits.filter((a: any) => a.action === 'updated'), 'no status audit').toEqual([]);
  expect(s.statusEvents, 'no status.changed ContactEvent').toEqual([]);
  expect(s.statusFeed, 'no status feed row').toEqual([]);
  expect(s.updates, 'no contact.updated').toEqual([]);
}

/** The one move the contact got: from `from` to CLIENT, named after `invoiceId`, with one follow-up for `owner`. */
function expectMovedOnce(s: Awaited<ReturnType<typeof lifecycleOf>>, from: string, invoiceIds: string[], owner: string | null) {
  expect(s.contact.status).toBe('CLIENT');

  // MC-16 / D-25: one ContactAuditEntry for the move, by SYSTEM, naming the triggering invoice.
  const moves = s.audits.filter((a: any) => a.action === 'updated');
  expect(moves, 'one status audit').toHaveLength(1);
  expect(moves[0]).toMatchObject({
    businessId: s.contact.businessId,
    entityType: 'invoice',
    before: { status: from },
    after: { status: 'CLIENT' },
    changedFields: ['status'],
  });
  expect(moves[0].actor).toMatchObject({ type: 'SYSTEM' });
  expect(invoiceIds).toContain(moves[0].entityId);

  // MC-16: one contact.updated on the bus, LEAD/PROSPECT -> CLIENT, in the contact's business.
  expect(s.updates, 'one contact.updated').toHaveLength(1);
  expect(s.updates[0]).toMatchObject({ businessId: s.contact.businessId, fromStatus: from, toStatus: 'CLIENT' });
  expect(s.updates[0].contact).toMatchObject({ id: expect.any(String), status: 'CLIENT' });

  // The contact timeline: one status.changed entry, by SYSTEM, naming the invoice.
  expect(s.statusEvents, 'one status.changed ContactEvent').toHaveLength(1);
  expect(s.statusEvents[0]).toMatchObject({ businessId: s.contact.businessId, actorType: 'SYSTEM' });
  expect(s.statusEvents[0].data).toMatchObject({ from, to: 'CLIENT' });
  expect(invoiceIds).toContain(s.statusEvents[0].data.invoiceId);

  // MC-15 / D-08: the Activity feed shows the move at most once (once, with its feed writer mounted).
  expect(s.statusFeed, 'one status feed row').toHaveLength(1);
  expect(s.statusFeed[0].data).toMatchObject({ from, to: 'CLIENT' });
  // SEC-L81-1 / D-08: the move writes ONE crm feed row of its own, the status row: no task.created
  // mirror (CrmTimelineService.addTask's, which named a USER with a null id). The crm invoice.* rows
  // are the invoice events' own contact-timeline mirrors (L-12), not the move's.
  expect(s.taskFeed, 'no task.created feed row').toEqual([]);
  expect(
    s.feed.filter((r: any) => r.module === 'crm' && !String(r.action).startsWith('invoice.')).map((r: any) => `${r.action}:${r.entityType}`),
    "the move's crm feed rows",
  ).toEqual(['updated:contact']);

  // MC-21 / MC-22 / MC-23 / D-81: exactly one follow-up, OPEN (canonical), for the contact's owner, audited.
  expect(s.followUps, 'one follow-up task').toHaveLength(1);
  const task = s.followUps[0];
  expect(task).toMatchObject({ businessId: s.contact.businessId, status: 'OPEN', priority: 'NORMAL', assigneeId: owner, deletedAt: null });
  const dueInDays = (new Date(task.dueDate).getTime() - Date.now()) / 86_400_000;
  expect(dueInDays).toBeGreaterThan(6);
  expect(dueInDays).toBeLessThan(8);
  const taskAudits = s.audits.filter((a: any) => a.action === 'task_added');
  expect(taskAudits, 'one task_added audit').toHaveLength(1);
  expect(taskAudits[0]).toMatchObject({ entityType: 'task', entityId: task.id });
  expect(taskAudits[0].actor).toMatchObject({ type: 'SYSTEM' });
  expect(taskAudits[0].after.title).toBe(task.title);
  expect(taskAudits[0].after.assigneeId ?? null, 'the audited assignee').toBe(owner); // the audit diff drops a null
  // SEC-L81-1: the follow-up's contact-timeline entry names SYSTEM too, with no actor id, and the task.
  const taskEvents = s.events.filter((e: any) => e.type === 'task.created');
  expect(taskEvents, 'one task.created ContactEvent').toHaveLength(1);
  expect(taskEvents[0]).toMatchObject({ businessId: s.contact.businessId, actorType: 'SYSTEM', actorId: null, source: FOLLOW_UP_SOURCE });
  expect(taskEvents[0].data).toMatchObject({ taskId: task.id, title: task.title, assigneeId: owner });
  expect(invoiceIds).toContain(taskEvents[0].data.invoiceId);
  // The assignment: the owner (a member of the contact's business), or none (SEC-L81-2).
  expect(s.assignments.map((a: any) => [a.assignableType, a.assignableId, a.assignedBy])).toEqual(owner ? [['User', owner, 'system']] : []);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitterModule, EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { RevenueEventListener } = await import('../src/modules/crm/revenue-event.listener');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
  const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
  const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { ActivityService } = await import('../src/modules/flow/activity.service');
  const { ActivityEventListener } = await import('../src/modules/flow/activity-event.listener');

  const moduleRef = await Test.createTestingModule({
    // event-bus.module.ts's options.
    imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
    providers: [
      PrismaService,
      RevenueEventListener,
      CrmService,
      CrmTimelineService,
      ContactAuditService,
      TimelineService,
      ActivityService,
      ActivityEventListener,
      {
        provide: ContactInsightService,
        useValue: { markStale: async (businessId: string, contactId: string) => { insightMarks.push({ businessId, contactId }); } },
      },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CrmListsService, useValue: {} },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: EntityResolutionService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init(); // registers the @OnEvent subscribers on the bus
  bus = moduleRef.get(EventEmitter2);
  listener = moduleRef.get(RevenueEventListener);
  bus.on('contact.updated', (p: any) => { contactUpdated.push(p); });

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenants, memberships -------------------------------------
  for (const id of [ID.owner, ID.rep, ID.ownerB, ID.gone]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V88E Biz A', ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V88E Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_rep`, userId: ID.rep, businessId: ID.bizA, role: 'STAFF' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  // ---- contacts ---------------------------------------------------------------
  const contact = (id: string, businessId: string, status: string, extra: Record<string, unknown> = {}) =>
    db.contact.create({
      data: {
        id,
        businessId,
        firstName: id.slice(P.length),
        lastName: 'V88e',
        email: `${P}${id.slice(P.length)}@test.local`,
        status,
        ownerId: businessId === ID.bizA ? ID.rep : ID.ownerB,
        ...extra,
      },
    });
  await contact(ID.cLead, ID.bizA, 'LEAD', { lifecycleStage: 'Imported MQL' });
  await contact(ID.cProspect, ID.bizA, 'PROSPECT');
  await contact(ID.cClient, ID.bizA, 'CLIENT', { lifecycleStage: 'customer' });
  await contact(ID.cLost, ID.bizA, 'LOST');
  await contact(ID.cOther, ID.bizA, 'LEAD');
  await contact(ID.cReplay, ID.bizA, 'LEAD');
  await contact(ID.cRace, ID.bizA, 'LEAD');
  await contact(ID.cTasks, ID.bizA, 'LEAD');
  await contact(ID.cRefund, ID.bizA, 'LEAD');
  await contact(ID.cTenantA, ID.bizA, 'LEAD');
  await contact(ID.cTenantB, ID.bizB, 'LEAD');

  // L-14: a STAFF member who owned a contact and was then removed from bizA (the membership row is
  // deleted, as IdentityService.removeTeamMember does; Contact.ownerId stays); and a bizA contact
  // owned by bizB's owner, who has no bizA membership.
  await db.membership.create({ data: { id: `${P}m_gone`, userId: ID.gone, businessId: ID.bizA, role: 'STAFF' } });
  await contact(ID.cGoneOwner, ID.bizA, 'LEAD', { ownerId: ID.gone });
  await db.membership.delete({ where: { id: `${P}m_gone` } });
  await contact(ID.cForeignOwner, ID.bizA, 'PROSPECT', { ownerId: ID.ownerB });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('PR196-CRM-LIFECYCLE: a paid invoice moves its contact LEAD/PROSPECT -> CLIENT (D-81)', () => {
  it('L-01 CTL wiring: RevenueEventListener is subscribed to invoice.paid on the bus', () => {
    expect(bus.listeners('invoice.paid').length).toBeGreaterThan(0);
    expect(typeof listener.onInvoicePaid).toBe('function');
  });

  it('L-02 RED-BEFORE: a paid invoice moves its LEAD contact to CLIENT through CrmService: audited (SYSTEM, the invoice), contact.updated, one feed row, lifecycleStage untouched, one OPEN follow-up for the owner', async () => {
    const inv = await paidInvoice(ID.bizA, ID.cLead);
    bus.emit('invoice.paid', paidEvent(inv));
    await settle([ID.cLead]);

    const s = await lifecycleOf(ID.cLead);
    expectMovedOnce(s, 'LEAD', [inv.id], ID.rep);
    expect(s.contact.lifecycleStage, 'lifecycleStage untouched').toBe('Imported MQL');
    // The ContactEvent and the audit name the invoice.
    expect(s.statusEvents[0].data).toMatchObject({ invoiceId: inv.id, trigger: 'invoice.paid' });
    expect(s.audits.find((a: any) => a.action === 'updated').reason).toContain(inv.invoiceNumber);
    // The existing invoice.paid timeline entry is still written once.
    expect(s.events.filter((e: any) => e.type === 'invoice.paid')).toHaveLength(1);
  });

  it('L-03 RED-BEFORE: PROSPECT -> CLIENT the same way; a null lifecycleStage stays null', async () => {
    const inv = await paidInvoice(ID.bizA, ID.cProspect);
    bus.emit('invoice.paid', paidEvent(inv));
    await settle([ID.cProspect]);

    const s = await lifecycleOf(ID.cProspect);
    expectMovedOnce(s, 'PROSPECT', [inv.id], ID.rep);
    expect(s.contact.lifecycleStage).toBeNull();
  });

  it('L-04 CTL: a CLIENT or LOST contact is untouched by a paid invoice (no task, audit, event or feed row)', async () => {
    const a = await paidInvoice(ID.bizA, ID.cClient);
    const b = await paidInvoice(ID.bizA, ID.cLost);
    bus.emit('invoice.paid', paidEvent(a));
    bus.emit('invoice.paid', paidEvent(b));
    await settle([ID.cClient, ID.cLost]);

    const client = await lifecycleOf(ID.cClient);
    expectUntouched(client, 'CLIENT');
    expect(client.contact.lifecycleStage).toBe('customer');
    expectUntouched(await lifecycleOf(ID.cLost), 'LOST');
  });

  it('L-05 CTL: only invoice.paid moves a contact: booking.confirmed, store_order.paid, payment.received and quote.accepted leave a LEAD a LEAD', async () => {
    const email = `${P}${ID.cOther.slice(P.length)}@test.local`;
    bus.emit('booking.confirmed', { businessId: ID.bizA, booking: { id: `${P}bk1`, businessId: ID.bizA, contactId: ID.cOther } });
    bus.emit('store_order.paid', { businessId: ID.bizA, order: { id: `${P}order1`, customerEmail: email, total: 80, currency: 'TTD' } });
    bus.emit('payment.received', { businessId: ID.bizA, contactId: ID.cOther, amount: 80, currency: 'TTD', provider: 'stripe', externalId: `${P}pi1` });
    bus.emit('quote.accepted', { businessId: ID.bizA, quote: { id: `${P}q1`, contactId: ID.cOther, quoteNumber: 'Q-1' }, acceptedAt: new Date(), source: 'public-link' });
    await settle([ID.cOther]);

    const s = await lifecycleOf(ID.cOther);
    expectUntouched(s, 'LEAD');
    // The events did reach the CRM timeline (the listener ran), they just do not move the status.
    expect(s.events.map((e: any) => e.type).sort()).toEqual(['payment.received', 'quote.accepted', 'store_order.paid']);
  });

  it('L-06 RED-BEFORE: replayed invoice.paid deliveries move the contact once: one follow-up, one audit, one contact.updated, one feed row', async () => {
    const inv = await paidInvoice(ID.bizA, ID.cReplay);
    for (let i = 0; i < 3; i += 1) {
      bus.emit('invoice.paid', paidEvent(inv));
      await settle([ID.cReplay]);
    }
    expectMovedOnce(await lifecycleOf(ID.cReplay), 'LEAD', [inv.id], ID.rep);
  });

  it('L-07 RED-BEFORE: concurrent deliveries of two paid invoices of one contact (each three times at once) move it once: one follow-up, one audit, one contact.updated, one feed row', async () => {
    const a = await paidInvoice(ID.bizA, ID.cRace);
    const b = await paidInvoice(ID.bizA, ID.cRace);
    await Promise.all([a, b, a, b, a, b].map((inv) => listener.onInvoicePaid(paidEvent(inv))));
    await settle([ID.cRace]);
    expectMovedOnce(await lifecycleOf(ID.cRace), 'LEAD', [a.id, b.id], ID.rep);
  });

  it("L-08 RED-BEFORE: the contact's unrelated OPEN task and its DONE / COMPLETED tasks do not suppress the follow-up, and are left as they were", async () => {
    const seeded = [
      { id: `${P}tOpen`, title: 'Call back about the quote', status: 'OPEN', source: 'manual' },
      { id: `${P}tDone`, title: 'Intro call', status: 'DONE', source: 'manual', completedAt: new Date() },
      { id: `${P}tCompleted`, title: 'Calendar follow-up', status: 'COMPLETED', source: 'calendar' },
    ];
    for (const t of seeded) {
      await db.contactTask.create({ data: { ...t, businessId: ID.bizA, contactId: ID.cTasks } });
    }
    const before = await db.contactTask.findMany({ where: { id: { in: seeded.map((t) => t.id) } }, orderBy: { id: 'asc' } });

    const inv = await paidInvoice(ID.bizA, ID.cTasks);
    bus.emit('invoice.paid', paidEvent(inv));
    await settle([ID.cTasks]);

    expectMovedOnce(await lifecycleOf(ID.cTasks), 'LEAD', [inv.id], ID.rep);
    const after = await db.contactTask.findMany({ where: { id: { in: seeded.map((t) => t.id) } }, orderBy: { id: 'asc' } });
    expect(after).toEqual(before);
  });

  it('L-09 RED-BEFORE: a refund that reopens the invoice never moves the contact back; paying it again adds nothing', async () => {
    const inv = await paidInvoice(ID.bizA, ID.cRefund);
    bus.emit('invoice.paid', paidEvent(inv));
    await settle([ID.cRefund]);
    expectMovedOnce(await lifecycleOf(ID.cRefund), 'LEAD', [inv.id], ID.rep);

    // D-14 full refund: PAID -> SENT, paidAt cleared, invoice.reopened on the bus.
    const reopened = await db.invoice.update({ where: { id: inv.id }, data: { status: 'SENT', paidAt: null } });
    bus.emit('invoice.reopened', { invoice: reopened, businessId: ID.bizA, status: 'SENT', previousStatus: 'PAID', eventName: 'invoice.reopened' });
    await settle([ID.cRefund]);
    let s = await lifecycleOf(ID.cRefund);
    expect(s.events.some((e: any) => e.type === 'invoice.reopened'), 'the reopen reached the timeline').toBe(true);
    expectMovedOnce(s, 'LEAD', [inv.id], ID.rep);

    // Paid again: the contact is already CLIENT.
    const repaid = await db.invoice.update({ where: { id: inv.id }, data: { status: 'PAID', paidAt: new Date() }, include: { items: true, contact: true } });
    bus.emit('invoice.paid', paidEvent(repaid));
    await settle([ID.cRefund]);
    s = await lifecycleOf(ID.cRefund);
    expectMovedOnce(s, 'LEAD', [inv.id], ID.rep);
  });

  it("L-10 CTL: another tenant's event naming this tenant's invoice changes nothing, both ways", async () => {
    const invA = await paidInvoice(ID.bizA, ID.cTenantA);
    const invB = await paidInvoice(ID.bizB, ID.cTenantB);
    // bizB's event naming bizA's invoice (and contact); bizA's event naming bizB's.
    bus.emit('invoice.paid', paidEvent(invA, ID.bizB));
    bus.emit('invoice.paid', paidEvent(invB, ID.bizA));
    await settle([ID.cTenantA, ID.cTenantB]);

    expectUntouched(await lifecycleOf(ID.cTenantA), 'LEAD');
    expectUntouched(await lifecycleOf(ID.cTenantB), 'LEAD');
  });

  it("L-11 RED-BEFORE: a payload naming another tenant's contact moves only the invoice's own contact, in the invoice's business", async () => {
    const invB = await paidInvoice(ID.bizB, ID.cTenantB);
    // bizB's own paid invoice, its payload's contactId forged to bizA's contact.
    bus.emit('invoice.paid', paidEvent({ ...invB, contactId: ID.cTenantA }, ID.bizB));
    await settle([ID.cTenantA, ID.cTenantB]);

    expectUntouched(await lifecycleOf(ID.cTenantA), 'LEAD');
    const s = await lifecycleOf(ID.cTenantB);
    expectMovedOnce(s, 'LEAD', [invB.id], ID.ownerB);
    expect(s.followUps[0].businessId).toBe(ID.bizB);
    expect(s.audits.every((a: any) => a.businessId === ID.bizB)).toBe(true);
  });

  it("L-14 (review SEC-L81-2, RED before the repair): a contact whose owner is no longer a member of the business, or is a member of another business only, still moves; its one follow-up stays in the business, unassigned, with no TaskAssignment naming the outsider", async () => {
    expect(await db.membership.findFirst({ where: { userId: ID.gone, businessId: ID.bizA } }), 'the removed member has no bizA membership').toBeNull();
    expect(await db.membership.findFirst({ where: { userId: ID.ownerB, businessId: ID.bizA } }), "bizB's owner has no bizA membership").toBeNull();
    const a = await paidInvoice(ID.bizA, ID.cGoneOwner);
    const b = await paidInvoice(ID.bizA, ID.cForeignOwner);
    bus.emit('invoice.paid', paidEvent(a));
    bus.emit('invoice.paid', paidEvent(b));
    await settle([ID.cGoneOwner, ID.cForeignOwner]);

    for (const [contactId, from, inv, outsider] of [
      [ID.cGoneOwner, 'LEAD', a, ID.gone],
      [ID.cForeignOwner, 'PROSPECT', b, ID.ownerB],
    ] as const) {
      const s = await lifecycleOf(contactId);
      expectMovedOnce(s, from, [inv.id], null);
      expect(s.contact.ownerId, 'the contact keeps its owner (reassigning is a human decision)').toBe(outsider);
      expect(s.followUps[0].businessId).toBe(ID.bizA);
      expect(await db.taskAssignment.findMany({ where: { assignableId: outsider, taskId: s.followUps[0].id } })).toEqual([]);
    }
  });

  // Found while writing L-10 / L-11, outside D-81's move (no status, task, audit or status row is
  // written across tenants, which is what L-10 / L-11 pin).
  it.todo("L-12 (found here, outside this packet): RevenueEventListener.log() writes every event's timeline entry (a ContactEvent and its Activity mirror) for the payload's contactId under the payload's businessId without checking the contact is in that business, so L-10 / L-11's foreign payloads still put an invoice.paid entry on the other tenant's contact (ActivityEventListener's commerce paid row likewise takes the payload's contactId); binding log() to the business changes all its handlers and the revenue-event.listener.spec.ts cases whose contact mock answers null: a separate packet");
  it.todo("L-13 (found here, outside this packet's write set): in the full app AutomationExecutorService.onContactUpdated runs its built-in stage-change rule on this move's contact.updated, as on every status change: an unassigned 'Follow up after stage change' task (source autopilot) and a tags update with its own feed rows, beside the one D-81 follow-up for the owner; folding them needs automation-executor.service.ts");
  it.todo("L-15 (review SEC-L81-3, outside this packet's write set, pre-existing): GET crm/businesses/:businessId/tasks/due (crm.controller.ts dueTasks, crm:read only, no actor) returns CrmTimelineService.dueTasks's rows with include { contact: true } and no visibilityClause, so a PRIVATE or unshared contact's full row (notesInternal, email, phone) reaches every crm:read member through any task due within the window. The D-81 follow-up (due in 7 days) is one such task; AutomationExecutorService's 'Send thank-you note' (due in 1 day) already put every paid invoice's contact there before this packet. Scoping the route to the actor's visibility and selecting a contact summary needs crm.controller.ts and crm-timeline.service.ts: a separate packet");
});
