/**
 * V1-72 (RR-ERASURE-BUSINESS-EVENTS, owner rulings D-25 and D-261), REAL database.
 *
 * The global BusinessEventInterceptor records every mutation under a
 * :businessId route in business_events, with before = the request body and
 * after = the response (redacted by field name only) and metadata.ip. A
 * contact create or update therefore stores the person's name, email and
 * phone. The GDPR forget purge (D-25) erased the contact, its child rows, its
 * merge snapshots and its audit trail, but never business_events: a forgotten
 * person's email and phone stayed readable in the business's event log.
 *
 * Two gaps, both pinned here:
 *
 *   1. rows written before the purge: the purge transaction now scrubs every
 *      business_events row of the request's business that names the subject
 *      (or a duplicate merged into it): subject_type 'contact' and subject_id
 *      one of them, or a top-level contactId in before/after naming one of
 *      them. before and after become NULL, metadata keeps only route and
 *      httpMethod; the row (event type, action, actor, subject, timestamps)
 *      stays as evidence. The count is in forget_purged.erased, and a failure
 *      of the scrub rolls the whole purge back.
 *   2. rows written after the forget request: the interceptor writes its row
 *      after the handler returned, outside any transaction, through the
 *      resilient emitter (a queue, or a sync fallback). The forget request's
 *      own row, and a mutation whose write is held until after the purge
 *      committed, are written without the snapshots by BusinessEventService
 *      .emit, the one write point every path reaches.
 *
 * Nothing on the boundary is mocked: PrismaService, the guards, CrmController
 * and CrmService (create and update), ContactPrivacyController and Service,
 * ContactAuditService, the BusinessEventInterceptor (installed as
 * APP_INTERCEPTOR, as app.module.ts does) and BusinessEventService are real
 * against DATABASE_URL. The resilient emitter is a pass-through to the real
 * BusinessEventService.emit (no BullMQ in this process) that the held-write
 * case can hold on a deferred. Identity is attached from an `x-test-user`
 * header for seeded v72w_ users only. CRM side channels are stubbed as in
 * contact-privacy-purge.integration.test.ts.
 *
 * Fixtures: prefix `v72w_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v72w_';
const ID = {
  owner: `${P}owner`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  noteEvent: `${P}noteEvent`,
  dup: `${P}dup`, // a duplicate merged into the subject: the same person
  dupEvent: `${P}dupEvent`,
  relEvent: `${P}relEvent`, // a relationship row: the person is its toContactId
  referEvent: `${P}referEvent`, // a refer row: the person is its targetContactId
  gone: `${P}gone`, // purged, then its row hard-deleted
  plantedEvent: `${P}plantedEvent`, // an invoice row whose request body carried a planted contactId
  routeEvent: `${P}routeEvent`, // a row naming the person only by the route's :contactId
  timeCostEvent: `${P}timeCostEvent`, // a time-cost row whose caller-chosen contactId the response echoes
  busEvent: `${P}busEvent`, // a KEY cortex bus audit row: subject_type 'Contact' (capitalised), the contact nested in after

  forgedEvent: `${P}forgedEvent`,
};

/** The subject's personal values. None may survive in bizA's event log. */
const PII = {
  firstName: 'V72W-Ada',
  lastName: 'V72W-Byron',
  email: `${P}ada@test.local`,
  phone: '+1 868 555 0172',
};
const PII_PATCH = { jobTitle: 'V72W-Countess', secondaryEmail: `${P}ada.alt@test.local` };
const PII_HELD = { companyName: 'V72W-Engines-Ltd' };
const NOTE_SECRET = 'V72W note: Ada prefers evenings';
const DUP_PII = { firstName: 'V72W-Dup-Ada', email: `${P}ada.dup@test.local` };
const REL_SECRET = 'V72W relationship note: Ada is the sister';
const REASON = `V72W-Ada asked to be forgotten by email from ${P}ada@test.local`;
const SECRETS = [
  ...Object.values(PII),
  '+18685550172',
  ...Object.values(PII_PATCH),
  ...Object.values(PII_HELD),
  NOTE_SECRET,
  REASON,
  ...Object.values(DUP_PII),
  REL_SECRET,
];
const BYSTANDER = { firstName: 'V72W-Bystander', email: `${P}bystander@test.local`, phone: '+1 868 555 0173' };
const CANCELLER = { firstName: 'V72W-Canceller', email: `${P}canceller@test.local`, phone: '+1 868 555 0174' };

let db: any;
let app: any;
let privacy: any;
let audit: any;
let ContactPrivacyServiceCtor: any;
let realEmit: (job: any) => Promise<void>;

/** The held-write gate: when armed, the next job matching `match` waits for `release`. */
const gate: {
  match?: (job: any) => boolean;
  release?: () => void;
  held?: Promise<void>;
  heldReached?: Promise<void>;
} = {};

let subjectId = '';
let bystanderId = '';
let cancellerId = '';
let bizBContactId = '';
let forgetRequestId = '';

async function cleanup() {
  for (const sql of [
    `DELETE FROM business_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_forget_requests WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

type EventRow = {
  id: string;
  business_id: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  actor_id: string;
  action: string;
  before: any;
  after: any;
  metadata: any;
  created_at: Date;
};

async function events(businessId: string): Promise<EventRow[]> {
  return db.$queryRawUnsafe(
    `SELECT id, business_id, event_type, subject_type, subject_id, actor_id, action, "before", "after", metadata, created_at
       FROM business_events WHERE business_id = $1 ORDER BY created_at, id`,
    businessId,
  );
}

/** Polls until `predicate` holds over bizA's (or the given business's) rows. */
async function waitForEvents(predicate: (rows: EventRow[]) => boolean, businessId = ID.bizA): Promise<EventRow[]> {
  let rows: EventRow[] = [];
  for (let i = 0; i < 100; i++) {
    rows = await events(businessId);
    if (predicate(rows)) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`business events never reached the expected state: ${JSON.stringify(rows.map((r) => [r.event_type, r.subject_id]))}`);
}

function textOf(row: EventRow): string {
  return JSON.stringify([row.before, row.after, row.metadata]);
}

function holdsNoSecret(row: EventRow, secrets: string[]) {
  const text = textOf(row);
  for (const s of secrets) expect(text, `${row.event_type} ${row.subject_id} still holds ${s}`).not.toContain(s);
}

const api = () => request(app.getHttpServer());
const as = (r: request.Test, user: string) => r.set('x-test-user', user);

/**
 * The request is due only for the instant of this suite's own purgeOne: the
 * purge suite runs the global runPurgeCycle, which purges every due request in
 * the shared database, possibly in parallel with this file.
 */
async function makeNotDue(contactId: string) {
  await db.$executeRawUnsafe(
    `UPDATE contact_forget_requests SET purge_at = now() + interval '7 days' WHERE contact_id = $1`,
    contactId,
  );
}

async function makeDue(contactId: string) {
  await db.$executeRawUnsafe(
    `UPDATE contact_forget_requests SET purge_at = now() - interval '1 minute' WHERE contact_id = $1`,
    contactId,
  );
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
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
  const { ContactPrivacyController } = await import('../src/modules/crm/privacy/contact-privacy.controller');
  const { ContactPrivacyService } = await import('../src/modules/crm/privacy/contact-privacy.service');
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
  const { BusinessEventInterceptor } = await import('../src/modules/business-events/business-event.interceptor');
  const { BusinessEventService } = await import('../src/modules/business-events/business-event.service');
  const { ResilientEmitterService } = await import('../src/modules/business-events/resilient-emitter.service');
  ContactPrivacyServiceCtor = ContactPrivacyService;

  // The resilient emitter's job is to get the row to BusinessEventService.emit
  // (through BullMQ, or its sync fallback). Here it hands the job straight to
  // the real service, unless the gate holds it.
  const emitter = {
    emit: async (job: any) => {
      if (gate.match?.(job)) {
        gate.match = undefined;
        (gate as any).reached?.();
        await gate.held;
      }
      await realEmit(job);
    },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController, ContactPrivacyController],
    providers: [
      PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard, CrmRateLimitGuard, FeatureFlagGuard, PlanLimitGuard,
      TeamAuditInterceptor, CrmStatsService, CrmService, ContactAuditService, ContactPrivacyService,
      BusinessEventService,
      { provide: ResilientEmitterService, useValue: emitter },
      { provide: APP_INTERCEPTOR, useClass: BusinessEventInterceptor },
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: CrmTimelineService, useValue: { logEvent: async () => undefined } },
      { provide: CrmCacheService, useValue: { invalidate: async () => undefined } },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmListsService, useValue: {} },
      { provide: EntityResolutionService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      { provide: CrmImportService, useValue: {} },
      { provide: CrmPlaybookService, useValue: {} },
      { provide: CrmActionsService, useValue: {} },
      { provide: CrmRevenueService, useValue: {} },
      { provide: CrmJourneyService, useValue: {} },
      { provide: CrmDuplicateDetectionService, useValue: {} },
      { provide: CrmDataQualityService, useValue: {} },
      { provide: CrmSavedViewsService, useValue: {} },
      { provide: CrmRelationshipHealthService, useValue: {} },
      { provide: CrmCommunicationService, useValue: {} },
      { provide: BestChannelService, useValue: {} },
      { provide: ConversationAiService, useValue: {} },
      { provide: CrmNetworkService, useValue: {} },
      { provide: ContactInsightService, useValue: {} },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();
  privacy = app.get(ContactPrivacyService);
  audit = app.get(ContactAuditService);
  const eventService = app.get(BusinessEventService);
  realEmit = (job) => eventService.emit(job);

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V72W Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V72W Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
}, 120_000);

afterAll(async () => {
  gate.release?.();
  if (app) await app.close();
  if (db) await cleanup();
});

describe('the GDPR forget purge scrubs the business event log (V1-72, D-25)', () => {
  let bystanderRowsBefore: EventRow[] = [];
  let bizBRowsBefore: EventRow[] = [];

  it('the owner creates the subject and a bystander through the CRM: the interceptor logs both with their snapshots', async () => {
    const subject = await as(api().post(`/crm/businesses/${ID.bizA}/contacts`), ID.owner).send(PII);
    expect(subject.status, JSON.stringify(subject.body)).toBe(201);
    subjectId = subject.body.id;
    const bystander = await as(api().post(`/crm/businesses/${ID.bizA}/contacts`), ID.owner).send(BYSTANDER);
    expect(bystander.status).toBe(201);
    bystanderId = bystander.body.id;
    const canceller = await as(api().post(`/crm/businesses/${ID.bizA}/contacts`), ID.owner).send(CANCELLER);
    expect(canceller.status).toBe(201);
    cancellerId = canceller.body.id;
    const patch = await as(api().patch(`/crm/businesses/${ID.bizA}/contacts/${subjectId}`), ID.owner).send(PII_PATCH);
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);

    // Another business: its own contact, and a row that names the subject's
    // id with the subject's values. bizB's log is not bizA's purge to touch.
    const other = await as(api().post(`/crm/businesses/${ID.bizB}/contacts`), ID.ownerB).send({ firstName: 'V72W-Other', email: `${P}other@test.local` });
    expect(other.status).toBe(201);
    bizBContactId = other.body.id;
    await db.businessEvent.create({
      data: {
        id: ID.forgedEvent, businessId: ID.bizB, eventType: 'contact.update', subjectType: 'contact', subjectId,
        actorType: 'human', actorId: ID.ownerB, action: 'update', source: 'web',
        before: { email: PII.email }, after: { contactId: subjectId, email: PII.email }, metadata: { ip: '203.0.113.72' },
      },
    });
    // A note-shaped row: the interceptor labels contacts/:contactId/notes as a
    // contact event whose subject is the note; the person is its contactId.
    await db.businessEvent.create({
      data: {
        id: ID.noteEvent, businessId: ID.bizA, eventType: 'contact.create', subjectType: 'contact', subjectId: `${P}note1`,
        actorType: 'human', actorId: ID.owner, action: 'create', source: 'web',
        before: { body: NOTE_SECRET }, after: { id: `${P}note1`, contactId: subjectId, body: NOTE_SECRET },
        metadata: { route: '/crm/businesses/:businessId/contacts/:contactId/notes', httpMethod: 'POST', ip: '203.0.113.71' },
      },
    });

    // A duplicate already merged into the subject (soft-deleted, merged_into_id
    // the subject), with an event row of its own.
    await db.contact.create({ data: { id: ID.dup, businessId: ID.bizA, ...DUP_PII, mergedIntoId: subjectId, deletedAt: new Date() } });
    await db.businessEvent.create({
      data: {
        id: ID.dupEvent, businessId: ID.bizA, eventType: 'contact.update', subjectType: 'contact', subjectId: ID.dup,
        actorType: 'human', actorId: ID.owner, action: 'update', source: 'web',
        before: { email: DUP_PII.email }, after: { id: ID.dup, ...DUP_PII }, metadata: { ip: '203.0.113.73' },
      },
    });

    // POST contacts/:contactId/relationships logs the relationship (its
    // toContactId the person); POST contacts/:contactId/refer logs the
    // referrer as subject, the new target's values in before and its id as
    // targetContactId in after.
    await db.businessEvent.create({
      data: {
        id: ID.relEvent, businessId: ID.bizA, eventType: 'contact.create', subjectType: 'contact', subjectId: `${P}rel1`,
        actorType: 'human', actorId: ID.owner, action: 'create', source: 'web',
        before: { toContactId: subjectId, type: 'family', note: REL_SECRET },
        after: { id: `${P}rel1`, fromContactId: `${P}referrer`, toContactId: subjectId, note: REL_SECRET },
        metadata: { route: '/crm/businesses/:businessId/contacts/:contactId/relationships', httpMethod: 'POST', ip: '203.0.113.75' },
      },
    });
    await db.businessEvent.create({
      data: {
        id: ID.referEvent, businessId: ID.bizA, eventType: 'contact.create', subjectType: 'contact', subjectId: `${P}referrer`,
        actorType: 'human', actorId: ID.owner, action: 'create', source: 'web',
        before: { firstName: PII.firstName, email: PII.email, phone: PII.phone },
        after: { relationship: { id: `${P}rel2` }, targetContactId: subjectId },
        metadata: { route: '/crm/businesses/:businessId/contacts/:contactId/refer', httpMethod: 'POST', ip: '203.0.113.76' },
      },
    });

    // SEC-1: `before` is the raw request body. A member who planted the
    // subject's id as contactId in an unrelated invoice PATCH (the DTO drops
    // it, the mutation succeeds) does not get that row scrubbed by the purge.
    await db.businessEvent.create({
      data: {
        id: ID.plantedEvent, businessId: ID.bizA, eventType: 'invoice.update', subjectType: 'invoice', subjectId: `${P}inv1`,
        actorType: 'human', actorId: ID.owner, action: 'update', source: 'web',
        before: { total: 77, contactId: subjectId }, after: { id: `${P}inv1`, total: 77, contactId: `${P}otherContact` },
        metadata: { route: '/commerce/businesses/:businessId/invoices/:invoiceId', httpMethod: 'PATCH', ip: '203.0.113.78' },
      },
    });
    // A row under contacts/:contactId whose snapshots carry no contact key:
    // the interceptor records the route's contactId (server-derived).
    await db.businessEvent.create({
      data: {
        id: ID.routeEvent, businessId: ID.bizA, eventType: 'contact.create', subjectType: 'contact', subjectId: `${P}msg1`,
        actorType: 'human', actorId: ID.owner, action: 'create', source: 'web',
        before: { body: 'V72W message to Ada' }, after: { id: `${P}msg1`, body: 'V72W message to Ada' },
        metadata: { route: '/crm/businesses/:businessId/contacts/:contactId/messages', httpMethod: 'POST', ip: '203.0.113.79', routeContactId: subjectId },
      },
    });

    // Option B: a time-cost entry stores a caller-chosen contactId unchecked
    // and echoes it in its response. A row whose subject is not a contact is
    // not reached through after.contactId, so that path cannot strip a row.
    await db.businessEvent.create({
      data: {
        id: ID.timeCostEvent, businessId: ID.bizA, eventType: 'unknown.update', subjectType: 'unknown', subjectId: `${P}tc1`,
        actorType: 'human', actorId: ID.owner, action: 'update', source: 'web',
        before: { minutes: 6000, costRate: 500, contactId: subjectId }, after: { id: `${P}tc1`, minutes: 6000, costRate: 500, contactId: subjectId },
        metadata: { route: '/commerce/businesses/:businessId/time-cost/:id', httpMethod: 'PATCH', ip: '203.0.113.81' },
      },
    });
    // The KEY cortex event bus writes subject_type from the bridge's entityType,
    // capitalised ('Contact'), with the whole contact nested in its payload.
    await db.businessEvent.create({
      data: {
        id: ID.busEvent, businessId: ID.bizA, eventType: 'contact.updated', subjectType: 'Contact', subjectId,
        actorType: 'ai', actorId: 'key_cortex', action: 'PUBLISHED', source: 'key_cortex_event_bus',
        after: { contact: { id: subjectId, email: PII.email, phone: PII.phone }, businessId: ID.bizA },
        metadata: { importance: 'normal' },
      },
    });

    const rows = await waitForEvents((r) =>
      r.filter((e) => e.subject_id === subjectId).length >= 2 &&
      r.some((e) => e.subject_id === bystanderId) && r.some((e) => e.subject_id === cancellerId));
    const own = rows.filter((e) => e.subject_id === subjectId && e.id !== ID.busEvent);
    expect(own.map((e) => e.event_type).sort()).toEqual(['contact.create', 'contact.update']);
    expect(JSON.stringify(own.map(textOf))).toContain(PII.email);
    expect(own.every((e) => typeof e.metadata?.ip === 'string')).toBe(true);
    bystanderRowsBefore = rows.filter((e) => e.subject_id === bystanderId);
    expect(JSON.stringify(bystanderRowsBefore.map(textOf))).toContain(BYSTANDER.email);
    bizBRowsBefore = await waitForEvents((r) => r.some((e) => e.subject_id === bizBContactId), ID.bizB);
  });

  it("a PATCH on the subject whose event write is held, and the forget request's own row, hold no personal data", async () => {
    let reached!: () => void;
    gate.heldReached = new Promise<void>((r) => { reached = r; });
    (gate as any).reached = reached;
    gate.held = new Promise<void>((r) => { gate.release = r; });
    gate.match = (job) => job.subjectId === subjectId && job.action === 'update';
    const held = await as(api().patch(`/crm/businesses/${ID.bizA}/contacts/${subjectId}`), ID.owner).send(PII_HELD);
    expect(held.status).toBe(200);
    await gate.heldReached; // the handler finished; its event row is not written yet

    const forget = await as(api().post(`/crm/businesses/${ID.bizA}/contacts/${subjectId}/forget`), ID.owner).send({ reason: REASON });
    expect(forget.status, JSON.stringify(forget.body)).toBe(201);
    forgetRequestId = forget.body.id;
    const rows = await waitForEvents((r) => r.some((e) => e.subject_id === forgetRequestId));
    const row = rows.find((e) => e.subject_id === forgetRequestId)!;
    expect(row).toMatchObject({ event_type: 'contact.create', actor_id: ID.owner, action: 'create' });
    expect(row.before, 'the forget row keeps no request body').toBeNull();
    expect(row.after, 'the forget row keeps no response').toBeNull();
    expect(row.metadata?.ip, 'the forget row keeps no ip').toBeUndefined();
    holdsNoSecret(row, SECRETS);
  });

  it('a failure of the business-event scrub rolls the whole purge back', async () => {
    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== '$transaction') return Reflect.get(target, prop, receiver);
        return (fn: (tx: any) => Promise<unknown>, opts?: unknown) =>
          target.$transaction(
            (tx: any) =>
              fn(new Proxy(tx, {
                get(t, p, r) {
                  const v = Reflect.get(t, p, r);
                  if (p !== '$executeRaw') return typeof v === 'function' ? v.bind(t) : v;
                  return (strings: TemplateStringsArray, ...values: unknown[]) => {
                    if (strings.join('?').includes('business_events')) throw new Error('v72w: business-event scrub refused');
                    return v.call(t, strings, ...values);
                  };
                },
              })),
            opts,
          );
      },
    });
    const svc = new ContactPrivacyServiceCtor({ client: failing } as any, audit);
    // This request only (purgeOne, not the global cycle), so no other suite's
    // due request is purged here and no other suite's cycle can race this one.
    await makeDue(subjectId);
    try {
      await expect((svc as any).purgeOne(forgetRequestId, ID.bizA, subjectId)).rejects.toThrow('v72w: business-event scrub refused');
    } finally {
      await makeNotDue(subjectId);
    }

    const [contact] = await db.$queryRawUnsafe(`SELECT email, first_name FROM contacts WHERE id = $1`, subjectId);
    expect(contact).toEqual({ email: PII.email, first_name: PII.firstName });
    const req = await db.contactForgetRequest.findUnique({ where: { id: forgetRequestId } });
    expect(req?.status).toBe('requested');
    const create = (await events(ID.bizA)).find((e) => e.subject_id === subjectId && e.event_type === 'contact.create')!;
    expect(JSON.stringify(create.after)).toContain(PII.email);
    const purged = await db.contactAuditEntry.count({ where: { businessId: ID.bizA, action: 'forget_purged' } });
    expect(purged).toBe(0);
  });

  it('after the purge no event row of the business holds the subject\'s personal data; the rows, their types and actors stay', async () => {
    // The real service over a client that records the transaction options.
    const txOptions: any[] = [];
    const recording = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== '$transaction') return Reflect.get(target, prop, receiver);
        return (fn: any, opts?: any) => { txOptions.push(opts); return target.$transaction(fn, opts); };
      },
    });
    await makeDue(subjectId);
    expect(await (new ContactPrivacyServiceCtor({ client: recording } as any, audit) as any).purgeOne(forgetRequestId, ID.bizA, subjectId)).toBe(true);
    expect((await db.contactForgetRequest.findUnique({ where: { id: forgetRequestId } }))?.status).toBe('purged');
    // The scrub reads the business's whole event log: the purge transaction
    // may not run under Prisma's 5 s interactive default.
    expect(txOptions.length).toBeGreaterThan(0);
    for (const opts of txOptions) expect(opts?.timeout, 'purge transaction timeout').toBeGreaterThanOrEqual(60_000);

    // The held write lands only now, after the purge committed.
    gate.release!();
    const rows = await waitForEvents((r) => r.filter((e) => e.subject_id === subjectId && e.event_type === 'contact.update').length === 2);

    for (const row of rows) if (row.id !== ID.plantedEvent && row.id !== ID.timeCostEvent) holdsNoSecret(row, SECRETS);
    const subjectRows = rows.filter((e) => (e.subject_id === subjectId && e.id !== ID.busEvent) || e.id === ID.noteEvent || e.subject_id === forgetRequestId);
    expect(subjectRows.map((e) => e.event_type).sort()).toEqual(['contact.create', 'contact.create', 'contact.create', 'contact.update', 'contact.update']);
    for (const row of subjectRows) {
      expect(row.before, `${row.event_type} ${row.subject_id} before`).toBeNull();
      expect(row.after, `${row.event_type} ${row.subject_id} after`).toBeNull();
      expect(row.metadata?.ip, `${row.event_type} ${row.subject_id} ip`).toBeUndefined();
      expect(row.actor_id).toBe(ID.owner);
    }
    const planted = rows.find((e) => e.id === ID.plantedEvent)!;
    expect(planted.before, 'a planted body key does not scrub the row').toEqual({ total: 77, contactId: subjectId });
    expect(planted.metadata?.ip).toBe('203.0.113.78');
    const timeCost = rows.find((e) => e.id === ID.timeCostEvent)!;
    expect(timeCost.after, 'a non-contact subject is not reached through after.contactId').toEqual({ id: `${P}tc1`, minutes: 6000, costRate: 500, contactId: subjectId });
    expect(timeCost.metadata?.ip).toBe('203.0.113.81');
    const bus = rows.find((e) => e.id === ID.busEvent)!;
    expect(bus).toMatchObject({ before: null, after: null, metadata: {}, subject_type: 'Contact' });
    const routed = rows.find((e) => e.id === ID.routeEvent)!;
    expect(routed).toMatchObject({ before: null, after: null });
    expect(routed.metadata).toEqual({ route: '/crm/businesses/:businessId/contacts/:contactId/messages', httpMethod: 'POST', routeContactId: subjectId });
    for (const id of [ID.relEvent, ID.referEvent]) {
      const row = rows.find((e) => e.id === id)!;
      expect(row, id).toMatchObject({ before: null, after: null });
      expect(row.metadata?.ip, id).toBeUndefined();
    }
    const dup = rows.find((e) => e.id === ID.dupEvent)!;
    expect(dup).toMatchObject({ before: null, after: null, metadata: {}, event_type: 'contact.update', actor_id: ID.owner });
    const note = rows.find((e) => e.id === ID.noteEvent)!;
    expect(note.metadata).toEqual({ route: '/crm/businesses/:businessId/contacts/:contactId/notes', httpMethod: 'POST' });
  });

  it("the bystander's rows are byte-identical and another business's log is untouched", async () => {
    const rows = await events(ID.bizA);
    expect(rows.filter((e) => e.subject_id === bystanderId)).toEqual(bystanderRowsBefore);
    expect(await events(ID.bizB)).toEqual(bizBRowsBefore);
    const forged = (await events(ID.bizB)).find((e) => e.id === ID.forgedEvent)!;
    expect(forged.after).toEqual({ contactId: subjectId, email: PII.email });
    expect(forged.metadata).toEqual({ ip: '203.0.113.72' });
  });

  it('forget_purged counts the business events it scrubbed', async () => {
    const [entry] = await db.contactAuditEntry.findMany({
      where: { businessId: ID.bizA, contactHash: audit.hashContact(ID.bizA, subjectId), action: 'forget_purged' },
    });
    expect(entry, 'one forget_purged entry').toBeDefined();
    // The create, the first PATCH, the note, relationship and refer rows and
    // the duplicate's row. The forget row and the held PATCH were written
    // without snapshots, so there was nothing to scrub.
    expect(entry.after.erased.businessEventsScrubbed).toBe(8); // and the route-param and bus rows
    // Honest scope: rows that name the person only inside a nested structure
    // (a duplicate check, an import) are not reached by id.
    expect(entry.after.notSwept).toMatch(/nested/);
    // SEC-1: the request body is never read, so a row naming the person only there is not reached.
    expect(entry.after.notSwept).toMatch(/request body/);
    // Option B: retained-record events are kept even when they carry its contactId.
    expect(entry.after.notSwept).toMatch(/even when they carry its contactId/);
  });

  it('a write after the purge that names the merged duplicate holds no personal data', async () => {
    await realEmit({
      businessId: ID.bizA, eventType: 'contact.update', subjectType: 'contact', subjectId: ID.dup,
      actorType: 'human', actorId: ID.owner, action: 'update', source: 'web',
      before: { email: DUP_PII.email }, after: { id: ID.dup, ...DUP_PII },
      metadata: { route: '/crm/businesses/:businessId/contacts/:contactId', httpMethod: 'PATCH', ip: '203.0.113.74' },
    });
    const rows = (await events(ID.bizA)).filter((e) => e.subject_id === ID.dup);
    expect(rows).toHaveLength(2);
    const late = rows.find((e) => e.id !== ID.dupEvent)!;
    expect(late).toMatchObject({ before: null, after: null });
    expect(late.metadata).toEqual({ route: '/crm/businesses/:businessId/contacts/:contactId', httpMethod: 'PATCH' });
  });

  it('a write naming a purged contact whose row was later hard-deleted holds no personal data', async () => {
    await db.contact.create({ data: { id: ID.gone, businessId: ID.bizA, firstName: 'V72W-Gone', email: `${P}gone@test.local` } });
    await db.contactForgetRequest.create({
      data: { id: `${P}goneReq`, businessId: ID.bizA, contactId: null, contactHash: audit.hashContact(ID.bizA, ID.gone), status: 'purged', purgeAt: new Date(), purgedAt: new Date() },
    });
    await db.$executeRawUnsafe(`DELETE FROM contacts WHERE id = $1`, ID.gone);
    await realEmit({
      businessId: ID.bizA, eventType: 'contact.update', subjectType: 'contact', subjectId: ID.gone,
      actorType: 'human', actorId: ID.owner, action: 'update', source: 'web',
      before: { email: `${P}gone@test.local` }, after: { id: ID.gone, firstName: 'V72W-Gone' },
      metadata: { route: '/crm/businesses/:businessId/contacts/:contactId', httpMethod: 'PATCH', ip: '203.0.113.77' },
    });
    const [row] = (await events(ID.bizA)).filter((e) => e.subject_id === ID.gone);
    expect(row).toMatchObject({ before: null, after: null });
    expect(row.metadata).toEqual({ route: '/crm/businesses/:businessId/contacts/:contactId', httpMethod: 'PATCH' });
  });

  it('a PATCH on the bystander that plants the purged subject\'s id in its body keeps its snapshot and ip (SEC-1)', async () => {
    const updates = (r: EventRow[]) => r.filter((e) => e.subject_id === bystanderId && e.event_type === 'contact.update');
    const before = updates(await events(ID.bizA)).length;
    const res = await as(api().patch(`/crm/businesses/${ID.bizA}/contacts/${bystanderId}`), ID.owner).send({ department: 'V72W-Planted', contactId: subjectId });
    expect(res.status).toBe(200);
    const rows = await waitForEvents((r) => updates(r).length > before);
    const row = updates(rows)[updates(rows).length - 1];
    expect(row.before).toEqual({ department: 'V72W-Planted', contactId: subjectId });
    expect(JSON.stringify(row.after)).toContain(BYSTANDER.email);
    expect(typeof row.metadata?.ip).toBe('string');
    expect(row.metadata?.routeContactId).toBe(bystanderId);
  });

  it('a write after the purge that names the subject only by the route\'s contactId holds no personal data', async () => {
    await realEmit({
      businessId: ID.bizA, eventType: 'contact.create', subjectType: 'contact', subjectId: `${P}msg2`,
      actorType: 'human', actorId: ID.owner, action: 'create', source: 'web',
      before: { body: NOTE_SECRET }, after: { id: `${P}msg2`, body: NOTE_SECRET },
      metadata: { route: '/crm/businesses/:businessId/contacts/:contactId/messages', httpMethod: 'POST', ip: '203.0.113.80', routeContactId: subjectId },
    });
    const [row] = (await events(ID.bizA)).filter((e) => e.subject_id === `${P}msg2`);
    expect(row).toMatchObject({ before: null, after: null });
    expect(row.metadata?.ip).toBeUndefined();
  });

  it('a time-cost write after the purge that echoes the purged subject\'s id as contactId keeps its snapshot and ip (option B)', async () => {
    await realEmit({
      businessId: ID.bizA, eventType: 'unknown.update', subjectType: 'unknown', subjectId: `${P}tc2`,
      actorType: 'human', actorId: ID.owner, action: 'update', source: 'web',
      before: { minutes: 1 }, after: { id: `${P}tc2`, minutes: 1, contactId: subjectId },
      metadata: { route: '/commerce/businesses/:businessId/time-cost/:id', httpMethod: 'PATCH', ip: '203.0.113.82' },
    });
    const [row] = (await events(ID.bizA)).filter((e) => e.subject_id === `${P}tc2`);
    expect(row.after).toEqual({ id: `${P}tc2`, minutes: 1, contactId: subjectId });
    expect(row.metadata?.ip).toBe('203.0.113.82');
  });

  it('a PATCH on the bystander after the purge keeps its snapshot as today', async () => {
    const res = await as(api().patch(`/crm/businesses/${ID.bizA}/contacts/${bystanderId}`), ID.owner).send({ jobTitle: 'V72W-Witness' });
    expect(res.status).toBe(200);
    const witness = (e: EventRow) => e.subject_id === bystanderId && e.event_type === 'contact.update' && e.before?.jobTitle === 'V72W-Witness';
    const rows = await waitForEvents((r) => r.some(witness));
    const row = rows.find(witness)!;
    expect(row.before).toEqual({ jobTitle: 'V72W-Witness' });
    expect(JSON.stringify(row.after)).toContain(BYSTANDER.email);
    expect(typeof row.metadata?.ip).toBe('string');
  });

  it('a forget and its cancel log no personal data; the cancelled contact keeps its earlier rows', async () => {
    const forget = await as(api().post(`/crm/businesses/${ID.bizA}/contacts/${cancellerId}/forget`), ID.owner).send({ reason: `about ${CANCELLER.email}` });
    expect(forget.status).toBe(201);
    // The forget row is written while the request is open; then cancel.
    await waitForEvents((r) => r.some((e) => e.subject_id === forget.body.id));
    const cancel = await as(api().post(`/crm/businesses/${ID.bizA}/contacts/${cancellerId}/forget/cancel`), ID.owner).send({});
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(201);
    const rows = await waitForEvents((r) => r.some((e) => e.subject_id === forget.body.id) && r.some((e) => e.subject_id === cancellerId && e.event_type === 'contact.create' && e.metadata?.route?.endsWith('/cancel')));
    const forgetRow = rows.find((e) => e.subject_id === forget.body.id)!;
    const cancelRow = rows.find((e) => e.subject_id === cancellerId && e.metadata?.route?.endsWith('/cancel'))!;
    for (const row of [forgetRow, cancelRow]) holdsNoSecret(row, [...Object.values(CANCELLER), '+18685550174']);
    expect(forgetRow.before).toBeNull();
    expect(forgetRow.after).toBeNull();
    const created = rows.find((e) => e.subject_id === cancellerId && e.metadata?.route === '/crm/businesses/:businessId/contacts')!;
    expect(JSON.stringify(created.after)).toContain(CANCELLER.email);
  });
});
