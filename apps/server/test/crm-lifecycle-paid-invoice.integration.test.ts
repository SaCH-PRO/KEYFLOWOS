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
 *                    leave a LEAD a LEAD with no follow-up (the store_order.paid names an order
 *                    stored PAID in bizA: W9-STORE-PAID-LISTENERS, V18-T2)
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
 * W9-CRM-RESIDUALS (was it.todo; RED before the packet):
 *   L-12 a payload's timeline entry is bound to the payload's business: no ContactEvent (nor
 *        Activity mirror, nor commerce paid row contact) for a contact of another business
 *   L-13 (D-81) the executor's built-in stage-change rule skips the D-81 move's contact.updated
 *        (no second follow-up, no tags update); a member's move still runs it
 *   L-15 (SEC-L81-3, D-37) GET tasks/due lists only the tasks of contacts the member may open,
 *        each with a contact summary (no notesInternal); L-15 mounts CrmController under the
 *        real guards for its one route
 *
 * W9-CRM-RESIDUALS review repair (SEC-W9CR-1, D-37; RED before the repair):
 *   L-16 the next-action reads beside tasks/due (GET next-actions, contact-next-actions,
 *        autopilot-actions, ai-next-actions and its AI prompt) name only the contacts the member
 *        may open; it seeds a business of its own (bizN) and mounts CrmController as L-15 does
 *        (crmControllerApp) over the real CrmActionsService (the AI gateway a recorder, no
 *        provider traffic) and CrmService
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
import request from 'supertest';
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
  // W9-CRM-RESIDUALS (L-12, L-13, L-15; created by those cases).
  cBindA: `${P}cBindA`, // L-12: bizA's CLIENT, named by bizB's payloads
  cBindB: `${P}cBindB`, // L-12: bizB's CLIENT
  cStage: `${P}cStage`, // L-13: bizA's LEAD moved by a paid invoice (D-81)
  cStageHuman: `${P}cStageHuman`, // L-13: bizA's LEAD a member moves to CLIENT
  cDuePriv: `${P}cDuePriv`, // L-15: bizA's PRIVATE contact of the OWNER (rep may not open it)
  cDueTeam: `${P}cDueTeam`, // L-15: bizA's TEAM contact of rep
  // W9-CRM-RESIDUALS review SEC-W9CR-1 (L-16; created by that case): a business of its own, so the
  // next-action reads list only these rows (getNextActions keeps 20, getAutopilotActions 15).
  bizN: `${P}bizN`, // OWNER: owner; STAFF: rep
  nxPrivTask: `${P}nxPrivTask`, // bizN's PRIVATE CLIENT of the OWNER, with an overdue and an upcoming task
  nxTeamTask: `${P}nxTeamTask`, // bizN's TEAM CLIENT of rep, the same
  nxPrivLead: `${P}nxPrivLead`, // bizN's PRIVATE new LEAD of the OWNER, with a SENT and a PAID invoice
  nxTeamLead: `${P}nxTeamLead`, // bizN's TEAM new LEAD of rep, the same
};

/** The follow-up's source (as PR #196 named it). */
const FOLLOW_UP_SOURCE = 'lifecycle-automation';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let db: any;
let app: any;
let bus: any;
let listener: any;
let crmService: any;
let prismaService: any;
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
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  crmService = moduleRef.get(CrmService);
  prismaService = moduleRef.get(PrismaService);
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

/**
 * CrmController under the real guards (AuthGuard, BusinessGuard, ModuleScopeGuard, the CRM rate
 * limit, feature flag and plan limit guards), for the routes L-15 and L-16 call. `real` names the
 * collaborators on those routes by class name; every other one is an empty stand-in, so a route that
 * reached one would fail. Identity is attached from `x-test-user` exactly as AuthMiddleware attaches
 * it after token verification; no guard is overridden.
 */
async function crmControllerApp(real: Record<string, unknown>) {
  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { CrmController } = await import('../src/modules/crm/crm.controller');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { CrmCacheService } = await import('../src/modules/crm/crm-cache.service');
  const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
  const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { FeatureFlagGuard } = await import('../src/modules/crm/guards/feature-flag.guard');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CrmImportService } = await import('../src/modules/crm/crm-import.service');
  const { CrmPlaybookService } = await import('../src/modules/crm/crm-playbook.service');
  const { CrmActionsService } = await import('../src/modules/crm/crm-actions.service');
  const { CrmRevenueService } = await import('../src/modules/crm/crm-revenue.service');
  const { CrmJourneyService } = await import('../src/modules/crm/crm-journey.service');
  const { CrmDuplicateDetectionService } = await import('../src/modules/crm/crm-duplicate-detection.service');
  const { CrmDataQualityService } = await import('../src/modules/crm/crm-data-quality.service');
  const { CrmSavedViewsService } = await import('../src/modules/crm/crm-saved-views.service');
  const { CrmRelationshipHealthService } = await import('../src/modules/crm/crm-relationship-health.service');
  const { CrmCommunicationService } = await import('../src/modules/crm/crm-communication.service');
  const { BestChannelService } = await import('../src/modules/crm/best-channel.service');
  const { ConversationAiService } = await import('../src/modules/crm/conversation-ai.service');
  const { CrmNetworkService } = await import('../src/modules/crm/crm-network.service');
  const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');

  const prisma = { client: db } as any;
  const collaborators: any[] = [
    CrmTimelineService, CrmService, CrmStatsService, CrmCacheService, EventEmitter2, CrmListsService, CrmFlowService, EntityResolutionService,
    ContactAuditService, ContactCustomFieldValueService, CrmImportService, CrmPlaybookService, CrmActionsService, CrmRevenueService,
    CrmJourneyService, CrmDuplicateDetectionService, CrmDataQualityService, CrmSavedViewsService, CrmRelationshipHealthService,
    CrmCommunicationService, BestChannelService, ConversationAiService, CrmNetworkService, ContactInsightService,
  ];
  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard, BusinessGuard, ModuleScopeGuard, CrmRateLimitGuard, FeatureFlagGuard, PlanLimitGuard, TeamAuditInterceptor,
      ...collaborators.map((provide) => ({ provide, useValue: real[provide.name] ?? {} })),
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
    ],
  }).compile();
  const http = moduleRef.createNestApplication();
  http.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await http.init();
  return http;
}

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
    // W9-STORE-PAID-LISTENERS (V18-T2; D-18): RevenueEventListener logs store_order.paid only for an order stored PAID in
    // the event's business, so the order this event names exists, PAID, in bizA.
    await db.marketplaceOrder.create({
      data: {
        id: `${P}order1`,
        businessId: ID.bizA,
        orderNumber: `${P}order1`,
        type: 'STANDARD',
        status: 'paid',
        paymentStatus: 'PAID',
        customerName: 'Other Lead',
        customerEmail: email,
        subtotal: 80,
        total: 80,
        currency: 'TTD',
      },
    });
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
  // W9-CRM-RESIDUALS: L-12, L-13 and L-15 were it.todo here (found by PR196-CRM-LIFECYCLE and its
  // review, outside that packet's write set).
  it("L-12 (W9-CRM-RESIDUALS, was it.todo): a payload's timeline entry is bound to the payload's business: RevenueEventListener writes no ContactEvent (nor its Activity mirror) for a contact of another business, and ActivityEventListener's commerce paid row names no such contact; the business's own contact still gets both", async () => {
    const seed = (id: string, businessId: string) =>
      db.contact.create({
        data: {
          id, businessId, firstName: id.slice(P.length), lastName: 'V88e', email: `${P}${id.slice(P.length)}@test.local`,
          status: 'CLIENT', ownerId: businessId === ID.bizA ? ID.rep : ID.ownerB,
        },
      });
    await seed(ID.cBindA, ID.bizA);
    await seed(ID.cBindB, ID.bizB);
    const invA = await paidInvoice(ID.bizA, ID.cBindA);
    const invB = await paidInvoice(ID.bizB, ID.cBindB);

    // bizB's event naming bizA's invoice (L-10's shape), bizB's own invoice with its contactId
    // forged to bizA's contact (L-11's shape), and a bizB payment naming bizA's contact.
    bus.emit('invoice.paid', paidEvent(invA, ID.bizB));
    bus.emit('invoice.paid', paidEvent({ ...invB, contactId: ID.cBindA }, ID.bizB));
    bus.emit('payment.received', { businessId: ID.bizB, contactId: ID.cBindA, amount: 5, currency: 'TTD', provider: 'stripe', externalId: `${P}pi_bind` });
    await settle([ID.cBindA, ID.cBindB]);
    await sleep(500);

    const foreign = await lifecycleOf(ID.cBindA);
    expect(foreign.events, "no ContactEvent on bizA's contact from bizB's payloads").toEqual([]);
    expect(foreign.feed, "no Activity row names bizA's contact").toEqual([]);
    const bizBPaidRows = await db.activity.findMany({ where: { businessId: ID.bizB, module: 'commerce', action: 'paid' } });
    expect(bizBPaidRows.length, "bizB's commerce paid rows were written").toBeGreaterThan(0);
    expect(bizBPaidRows.map((r: any) => r.contactId), "bizB's paid rows name no contact of bizA").not.toContain(ID.cBindA);

    // Control: each business's own payload still writes its contact's entry and paid row.
    bus.emit('invoice.paid', paidEvent(invA));
    bus.emit('invoice.paid', paidEvent(invB));
    await settle([ID.cBindA, ID.cBindB]);
    for (const [contactId, businessId, inv] of [[ID.cBindA, ID.bizA, invA], [ID.cBindB, ID.bizB, invB]] as const) {
      const s = await lifecycleOf(contactId);
      expect(s.contact.status, 'a CLIENT stays CLIENT').toBe('CLIENT');
      const paid = s.events.filter((e: any) => e.type === 'invoice.paid');
      expect(paid, `${contactId}: one invoice.paid entry`).toHaveLength(1);
      expect(paid[0]).toMatchObject({ businessId, actorType: 'SYSTEM' });
      expect(paid[0].data).toMatchObject({ invoiceId: inv.id });
      const paidRows = s.feed.filter((r: any) => r.module === 'commerce' && r.action === 'paid');
      expect(paidRows.map((r: any) => [r.businessId, r.entityId]), `${contactId}: its commerce paid row`).toEqual([[businessId, inv.id]]);
    }
  });

  it("L-13 (W9-CRM-RESIDUALS, was it.todo; D-81): AutomationExecutorService's built-in stage-change rule skips the D-81 move's contact.updated: no 'Follow up after stage change' task and no tags update beside the one D-81 follow-up for the owner; a member's own status change still gets the built-in follow-up", async () => {
    const { AutomationExecutorService } = await import('../src/modules/flow/automation-executor.service');
    const { ActivityService } = await import('../src/modules/flow/activity.service');
    for (const id of [ID.cStage, ID.cStageHuman]) {
      await db.contact.create({
        data: { id, businessId: ID.bizA, firstName: id.slice(P.length), lastName: 'V88e', email: `${P}${id.slice(P.length)}@test.local`, status: 'LEAD', ownerId: ID.rep },
      });
    }
    // The executor as the full app builds it, over the real CrmService behind a call recorder (no
    // playbook or flow exists for the business; no flow runner).
    const crmCalls: Array<{ method: string; input: any }> = [];
    const recordedCrm = new Proxy(crmService, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop === 'string' && typeof value === 'function') {
          return (...args: any[]) => {
            crmCalls.push({ method: prop, input: args[0] });
            return value.apply(target, args);
          };
        }
        return value;
      },
    });
    const executor = new AutomationExecutorService(prismaService, new ActivityService(prismaService), recordedCrm, {} as never, null, null);

    // The D-81 move: its contact.updated reaches the executor as the full app delivers it.
    const inv = await paidInvoice(ID.bizA, ID.cStage);
    bus.emit('invoice.paid', paidEvent(inv));
    await settle([ID.cStage]);
    const moved = contactUpdated.filter((p) => p.contact?.id === ID.cStage);
    expect(moved, 'the D-81 move emitted contact.updated once').toHaveLength(1);
    await executor.onContactUpdated(moved[0]);
    await settle([ID.cStage]);

    expect(crmCalls.map((c) => c.method), 'the built-in rule wrote nothing for the D-81 move').toEqual([]);
    const s = await lifecycleOf(ID.cStage);
    expectMovedOnce(s, 'LEAD', [inv.id], ID.rep);
    expect(s.tasks.map((t: any) => t.source), 'the D-81 follow-up is the only task').toEqual([FOLLOW_UP_SOURCE]);
    const row = await db.contact.findUnique({ where: { id: ID.cStage }, select: { tags: true } });
    expect(row.tags, 'no stage-changed tag').not.toContain('stage-changed');

    // Control: a member's own status change (CrmService.updateContact) still runs the built-in rule.
    await crmService.updateContact({ businessId: ID.bizA, contactId: ID.cStageHuman, status: 'CLIENT', actorUserId: ID.owner });
    const human = contactUpdated.filter((p) => p.contact?.id === ID.cStageHuman && p.toStatus === 'CLIENT');
    expect(human, "the member's move emitted contact.updated").toHaveLength(1);
    crmCalls.length = 0;
    await executor.onContactUpdated(human[0]);
    expect(crmCalls[0], "the member's move gets the built-in follow-up").toMatchObject({
      method: 'addTask',
      input: { businessId: ID.bizA, contactId: ID.cStageHuman, title: 'Follow up after stage change', source: 'autopilot' },
    });
  });

  it("L-15 (W9-CRM-RESIDUALS, was it.todo; review SEC-L81-3, D-37): GET crm/businesses/:businessId/tasks/due lists only the due tasks of contacts the member may open, each with a contact summary (no notesInternal); the OWNER sees every due task, summarised the same way", async () => {
    const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');

    const DUE_SECRET = 'v88e-internal-note-of-a-due-contact-3k9';
    for (const [id, visibility, ownerId] of [[ID.cDuePriv, 'PRIVATE', ID.owner], [ID.cDueTeam, 'TEAM', ID.rep]] as const) {
      await db.contact.create({
        data: {
          id, businessId: ID.bizA, firstName: id.slice(P.length), lastName: 'V88e', email: `${P}${id.slice(P.length)}@test.local`,
          status: 'CLIENT', visibility, ownerId, notesInternal: `${DUE_SECRET} ${id}`,
        },
      });
      await db.contactTask.create({
        data: {
          id: `${P}due_${id.slice(P.length)}`, businessId: ID.bizA, contactId: id, title: `V88e due task ${id.slice(P.length)}`,
          status: 'OPEN', dueDate: new Date(Date.now() + 2 * 86_400_000),
        },
      });
    }

    // The real route: CrmController under the real guards, over the real CrmTimelineService.
    const timeline = new CrmTimelineService({ client: db } as any, {} as any, {} as any, {} as any, {} as any);
    const http = await crmControllerApp({ CrmTimelineService: timeline });
    try {
      const due = (actor: string) => request(http.getHttpServer()).get(`/crm/businesses/${ID.bizA}/tasks/due?windowDays=7`).set('x-test-user', actor);
      const ours = (body: any[]) => body.filter((t) => t.contactId === ID.cDuePriv || t.contactId === ID.cDueTeam);
      const SUMMARY_KEYS = ['displayName', 'email', 'firstName', 'id', 'lastName', 'phone', 'status'];

      const rep = await due(ID.rep);
      expect(rep.status, rep.text.slice(0, 200)).toBe(200);
      expect(ours(rep.body).map((t) => t.contactId), "rep lists its TEAM contact's task only").toEqual([ID.cDueTeam]);
      expect(rep.text, "the OWNER's PRIVATE contact").not.toContain(ID.cDuePriv);
      expect(rep.text, 'notesInternal').not.toContain(DUE_SECRET);
      for (const task of rep.body) {
        expect(Object.keys(task.contact ?? {}).sort(), `task ${task.id}: a contact summary`).toEqual(SUMMARY_KEYS);
      }

      const owner = await due(ID.owner);
      expect(owner.status).toBe(200);
      expect(ours(owner.body).map((t) => t.contactId).sort(), 'the OWNER lists both').toEqual([ID.cDuePriv, ID.cDueTeam].sort());
      expect(owner.text, 'notesInternal').not.toContain(DUE_SECRET);
      for (const task of ours(owner.body)) {
        expect(Object.keys(task.contact).sort()).toEqual(SUMMARY_KEYS);
        expect(task.contact).toMatchObject({ id: task.contactId, firstName: task.contactId.slice(P.length) });
      }
    } finally {
      await http.close();
    }
  });

  it("L-16 (W9-CRM-RESIDUALS repair, review SEC-W9CR-1, D-37): the next-action reads beside GET tasks/due (GET next-actions, contact-next-actions, autopilot-actions and ai-next-actions, with the AI prompt) name only the contacts the member may open; the OWNER's lists and prompt name every contact", async () => {
    const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
    const { CrmActionsService } = await import('../src/modules/crm/crm-actions.service');

    await db.business.create({ data: { id: ID.bizN, name: 'V88E Biz N', ownerId: ID.owner, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${P}m_owner_bizN`, userId: ID.owner, businessId: ID.bizN, role: 'OWNER' } });
    await db.membership.create({ data: { id: `${P}m_rep_bizN`, userId: ID.rep, businessId: ID.bizN, role: 'STAFF' } });
    const DAY = 86_400_000;
    const tail = (id: string) => id.slice(P.length);
    let phone = 0;
    for (const [id, visibility, ownerId, status] of [
      [ID.nxPrivTask, 'PRIVATE', ID.owner, 'CLIENT'], [ID.nxTeamTask, 'TEAM', ID.rep, 'CLIENT'],
      [ID.nxPrivLead, 'PRIVATE', ID.owner, 'LEAD'], [ID.nxTeamLead, 'TEAM', ID.rep, 'LEAD'],
    ] as const) {
      await db.contact.create({
        data: {
          id, businessId: ID.bizN, firstName: tail(id), lastName: 'V88e', email: `${P}${tail(id).toLowerCase()}@test.local`,
          phone: `+1868558${String(1000 + phone++)}`, status, visibility, ownerId, nextActionAt: new Date(Date.now() + DAY), nextActionType: 'call',
        },
      });
    }
    for (const id of [ID.nxPrivTask, ID.nxTeamTask]) {
      await db.contactTask.create({
        data: { id: `${P}nxover_${tail(id)}`, businessId: ID.bizN, contactId: id, title: `V88e overdue ${tail(id)}`, status: 'OPEN', dueDate: new Date(Date.now() - DAY) },
      });
      await db.contactTask.create({
        data: { id: `${P}nxsoon_${tail(id)}`, businessId: ID.bizN, contactId: id, title: `V88e soon ${tail(id)}`, status: 'OPEN', dueDate: new Date(Date.now() + DAY) },
      });
    }
    for (const id of [ID.nxPrivLead, ID.nxTeamLead]) {
      for (const [kind, status] of [['sent', 'SENT'], ['paid', 'PAID']] as const) {
        await db.invoice.create({
          data: {
            id: `${P}nxinv_${kind}_${tail(id)}`, businessId: ID.bizN, contactId: id, invoiceNumber: `${P}NX-${kind}-${tail(id)}`, status,
            subtotal: 75, total: 75, currency: 'TTD', dueDate: new Date(Date.now() + 5 * DAY), paidAt: status === 'PAID' ? new Date() : null,
          },
        });
      }
    }
    /** Every action of one contact pair, by its id (each read's own id scheme). */
    const nextActionIds = (task: string, lead: string) => [
      `task_${P}nxover_${tail(task)}`, `scheduled_${P}nxsoon_${tail(task)}`,
      `newlead_${lead}`, `invoice_${P}nxinv_sent_${tail(lead)}`, `thankyou_${P}nxinv_paid_${tail(lead)}`,
    ];
    const HIDDEN = [ID.nxPrivTask, ID.nxPrivLead];
    const hiddenMarks = HIDDEN.flatMap((id) => [tail(id), `${P}${tail(id).toLowerCase()}@test.local`]);

    // The model's answer names every contact of the business; the read keeps only the ones it put in the prompt.
    const prompts: string[] = [];
    const aiGateway = {
      callAi: async (args: { messages?: Array<{ content: string }> }) => {
        prompts.push((args.messages ?? []).map((m) => m.content).join('\n'));
        const all = [ID.nxPrivTask, ID.nxTeamTask, ID.nxPrivLead, ID.nxTeamLead];
        return {
          content: JSON.stringify(all.map((contactId) => ({ type: 'follow_up', contactId, contactName: tail(contactId), reason: 'v88e recorded', priority: 'high' }))),
        };
      },
    };
    const prisma = { client: db } as any;
    const timeline = new CrmTimelineService(prisma, {} as any, {} as any, {} as any, {} as any);
    const http = await crmControllerApp({
      CrmTimelineService: timeline,
      CrmActionsService: new CrmActionsService(prisma, aiGateway as any, timeline),
      // listNextActions reads through PrismaService only.
      CrmService: crmService,
    });
    try {
      const get = (routePath: string, actor: string) =>
        request(http.getHttpServer()).get(`/crm/businesses/${ID.bizN}/${routePath}`).set('x-test-user', actor);
      const expectNamesNoHidden = (res: { text: string }, what: string) => {
        for (const id of HIDDEN) expect(res.text, `${what}: ${id}`).not.toContain(id);
        for (const mark of hiddenMarks) expect(res.text, `${what}: ${mark}`).not.toContain(mark);
      };

      // GET next-actions
      const repNext = await get('next-actions', ID.rep);
      expect(repNext.status, repNext.text.slice(0, 200)).toBe(200);
      expect(repNext.body.map((a: { id: string }) => a.id).sort(), 'rep: its contacts\' actions only').toEqual(nextActionIds(ID.nxTeamTask, ID.nxTeamLead).sort());
      expectNamesNoHidden(repNext, 'next-actions');
      const ownerNext = await get('next-actions', ID.owner);
      expect(ownerNext.status).toBe(200);
      expect(ownerNext.body.map((a: { id: string }) => a.id).sort(), 'the OWNER: every action').toEqual(
        [...nextActionIds(ID.nxTeamTask, ID.nxTeamLead), ...nextActionIds(ID.nxPrivTask, ID.nxPrivLead)].sort(),
      );
      expect(ownerNext.body.find((a: { id: string }) => a.id === `scheduled_${P}nxsoon_${tail(ID.nxPrivTask)}`)).toMatchObject({
        contactId: ID.nxPrivTask, contactName: `${tail(ID.nxPrivTask)} V88e`,
      });

      // GET contact-next-actions
      const repDue = await get('contact-next-actions?windowDays=7', ID.rep);
      expect(repDue.status, repDue.text.slice(0, 200)).toBe(200);
      expect(repDue.body.items.map((c: { id: string }) => c.id).sort()).toEqual([ID.nxTeamLead, ID.nxTeamTask].sort());
      expectNamesNoHidden(repDue, 'contact-next-actions');
      const ownerDue = await get('contact-next-actions?windowDays=7', ID.owner);
      expect(ownerDue.status).toBe(200);
      expect(ownerDue.body.items.map((c: { id: string }) => c.id).sort()).toEqual([ID.nxPrivLead, ID.nxPrivTask, ID.nxTeamLead, ID.nxTeamTask].sort());

      // GET autopilot-actions
      const repAuto = await get('autopilot-actions', ID.rep);
      expect(repAuto.status, repAuto.text.slice(0, 200)).toBe(200);
      const autoIds = (res: { body: Array<{ id: string }> }) => res.body.map((a) => a.id).sort();
      expect(autoIds(repAuto)).toEqual([`autowelcome_${ID.nxTeamLead}`, `pending_${P}nxsoon_${tail(ID.nxTeamTask)}`].sort());
      expectNamesNoHidden(repAuto, 'autopilot-actions');
      const ownerAuto = await get('autopilot-actions', ID.owner);
      expect(ownerAuto.status).toBe(200);
      expect(autoIds(ownerAuto)).toEqual([
        `autowelcome_${ID.nxPrivLead}`, `autowelcome_${ID.nxTeamLead}`, `pending_${P}nxsoon_${tail(ID.nxPrivTask)}`, `pending_${P}nxsoon_${tail(ID.nxTeamTask)}`,
      ].sort());

      // GET ai-next-actions: the prompt and the answer
      prompts.length = 0;
      const repAi = await get('ai-next-actions', ID.rep);
      expect(repAi.status, repAi.text.slice(0, 200)).toBe(200);
      expect(prompts).toHaveLength(1);
      for (const id of HIDDEN) expect(prompts[0], `the prompt names ${id}`).not.toContain(id);
      for (const id of [ID.nxTeamTask, ID.nxTeamLead]) expect(prompts[0]).toContain(id);
      expect(repAi.body.map((a: { contactId: string }) => a.contactId).sort()).toEqual([ID.nxTeamLead, ID.nxTeamTask].sort());
      expectNamesNoHidden(repAi, 'ai-next-actions');
      prompts.length = 0;
      const ownerAi = await get('ai-next-actions', ID.owner);
      expect(ownerAi.status).toBe(200);
      for (const id of HIDDEN) expect(prompts[0], 'the OWNER\'s prompt').toContain(id);
      expect(ownerAi.body.map((a: { contactId: string }) => a.contactId).sort()).toEqual([ID.nxPrivLead, ID.nxPrivTask, ID.nxTeamLead, ID.nxTeamTask].sort());
    } finally {
      await http.close();
    }
  });
});
