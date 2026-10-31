/**
 * R0-CT-03-CONTACT-AUDIT-ACTOR — contact create/update/delete record the acting
 * HTTP user (REAL database).
 *
 * CONTACTS-v1 CT-P09: created/updated event and audit evidence must carry the
 * correct actor. Before this packet the contact routes had `req.user` but
 * handed the service no audit context, so every durable trace of a member's
 * edit was actor-less or SYSTEM:
 *   - the in-transaction ContactEvent `contact.created` had no actorType and
 *     no actorId; `contact.updated` / `status.changed` / `contact.deleted`
 *     said actorType USER with no actorId;
 *   - the ContactAuditEntry (privacy/contact-audit.service.ts) recorded
 *     `{ type: 'SYSTEM' }` for every member edit.
 * The contract proven here: a mutation through the HTTP routes records the
 * requesting member as `{ type: USER, id }` on the ContactEvent and on the
 * ContactAuditEntry, whose before/after diff lists exactly the fields that
 * changed; a request with no identity is refused (401) and writes nothing;
 * system-context callers (the KEY adapter, automation-style service calls)
 * that pass no audit context keep recording the SYSTEM actor and attribute
 * no user. DEC-CONTACTS-002 is unchanged: the ContactAuditEntry write stays
 * fire-and-forget, so the cases here wait for the row to land.
 *
 * Nothing on the HTTP or persistence path is mocked: PrismaService, the user,
 * business and membership rows, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * CrmRateLimitGuard, PlanLimitGuard, TeamAuditInterceptor, the global
 * ValidationPipe and GlobalHttpExceptionFilter, CrmController, CrmService,
 * CrmTimelineService (which writes the ContactEvent inside the contact
 * transaction) and ContactAuditService are all real against DATABASE_URL. The
 * stand-ins: identity attachment (a test middleware reads `x-test-user`, loads
 * that seeded user row and attaches `{ id, email, role }` exactly as
 * AuthMiddleware would after Supabase token verification), the unified
 * activity ledger / evidence / task-assignment collaborators of the timeline
 * service and the stats/flow caches (side channels off the write, never read
 * here), and the plan limit (a stub that allows).
 *
 * Requires DATABASE_URL. Every seeded row carries the `tca_` prefix (contacts
 * created through the API are deleted by their business id) and is hard-deleted
 * by raw SQL in beforeAll and afterAll. No $transaction wrapping.
 *
 * Cases tagged NEGATIVE CONTROL are the pre-fix failing controls: on the
 * packet's source base the event has no actorId and the audit actor is SYSTEM.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'tca_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA
  staff: `${P}staff`, // STAFF of bizA, crm: write (edit any)
  bizA: `${P}bizA`,
};

let db: any;
let app: any;
let crm: any; // the real CrmService
let keyAdapter: any; // the real KEY CrmAdapterService over the real CrmService

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension). Contacts are
  // created through the API with generated ids, so they go by business id.
  for (const sql of [
    `DELETE FROM contact_audit_entries WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contact_events WHERE business_id LIKE '${P}%'`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contacts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM memberships WHERE id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function post(actor: string | null, body: Record<string, unknown>) {
  const req = request(app.getHttpServer()).post(`/crm/businesses/${ID.bizA}/contacts`);
  return (actor ? req.set('x-test-user', actor) : req).send(body);
}

function patch(actor: string | null, contactId: string, body: Record<string, unknown>) {
  const req = request(app.getHttpServer()).patch(`/crm/businesses/${ID.bizA}/contacts/${contactId}`);
  return (actor ? req.set('x-test-user', actor) : req).send(body);
}

function del(actor: string | null, contactId: string) {
  const req = request(app.getHttpServer()).delete(`/crm/businesses/${ID.bizA}/contacts/${contactId}`);
  return actor ? req.set('x-test-user', actor) : req;
}

function events(contactId: string, type: string) {
  return db.contactEvent.findMany({
    where: { businessId: ID.bizA, contactId, type },
    orderBy: { createdAt: 'asc' },
  });
}

/** The ContactAuditEntry write is fire-and-forget (DEC-CONTACTS-002): wait for it to land. */
async function auditEntries(contactId: string, action: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await db.contactAuditEntry.findMany({
      where: { businessId: ID.bizA, contactId, action },
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length > 0 || Date.now() > deadline) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Every durable trace the contact routes write for the tenant, for "writes nothing". */
async function traceCounts() {
  const [contacts, live, contactEvents, audits, teamLogs] = await Promise.all([
    db.contact.count({ where: { businessId: ID.bizA } }),
    db.contact.count({ where: { businessId: ID.bizA, deletedAt: null } }),
    db.contactEvent.count({ where: { businessId: ID.bizA } }),
    db.contactAuditEntry.count({ where: { businessId: ID.bizA } }),
    db.teamActivityLog.count({ where: { businessId: ID.bizA } }),
  ]);
  return { contacts, live, contactEvents, audits, teamLogs };
}

/** Let any fire-and-forget write a request might have started reach the database. */
const settle = () => new Promise((r) => setTimeout(r, 300));

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
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
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
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
  const { CrmAdapterService } = await import('../src/modules/key-cortex/adapters/crm-adapter.service');

  // ---- the real HTTP path (wired before any row is seeded, so a wiring
  // fault is reported as itself and not as a seeding failure) -------------
  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      FeatureFlagGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      CrmStatsService,
      CrmService,
      CrmTimelineService,
      ContactAuditService,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      // CrmTimelineService's side channels: the unified activity ledger (its
      // write is already fire-and-forget), evidence and task assignment. The
      // ContactEvent row itself is the real write inside the contact
      // transaction.
      { provide: TimelineService, useValue: { recordEvent: async () => undefined } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
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
  // Identity attachment only. The real AuthMiddleware attaches
  // `{ id, email, role }` from the User row after Supabase verifies the token;
  // this does the same from a header, for seeded tca_ users only. No guard is
  // overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();
  crm = app.get(CrmService);
  // The KEY adapter is a thin wrapper over CrmService with no audit context;
  // constructed over the same real service the routes use.
  keyAdapter = new CrmAdapterService(crm);

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenant, memberships -----------------------------------
  await db.user.create({ data: { id: ID.owner, email: `${ID.owner}@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staff, email: `${ID.staff}@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'TCA Biz A', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m_owner_bizA`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_staff_bizA`, userId: ID.staff, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write' } } });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it('seeded one tenant with an owner and a write-scoped staff member and no contacts', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(2);
    expect(await traceCounts()).toEqual({ contacts: 0, live: 0, contactEvents: 0, audits: 0, teamLogs: 0 });
  });
});

describe('a member edits a contact through the HTTP routes: the member is the recorded actor', () => {
  let contactId: string;

  it('NEGATIVE CONTROL: POST by the owner — the in-transaction contact.created event carries actorType USER and the owner id', async () => {
    const res = await post(ID.owner, { firstName: `${P}Ada`, lastName: 'Lovelace', email: `${P}ada@test.local` });
    expect(res.status).toBe(201);
    contactId = res.body.id;
    expect(contactId).toBeTruthy();

    const created = await events(contactId, 'contact.created');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ actorType: 'USER', actorId: ID.owner });
  });

  it('NEGATIVE CONTROL: POST by the owner — the created ContactAuditEntry actor is the owner, not SYSTEM', async () => {
    const audits = await auditEntries(contactId, 'created');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'USER', id: ID.owner });
  });

  it('NEGATIVE CONTROL: PATCH by the owner — the ContactAuditEntry actor is the owner and its diff lists exactly the changed fields', async () => {
    const res = await patch(ID.owner, contactId, { firstName: `${P}Augusta`, jobTitle: 'Analyst' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: contactId, firstName: `${P}Augusta`, jobTitle: 'Analyst' });

    const audits = await auditEntries(contactId, 'updated');
    expect(audits).toHaveLength(1);
    const entry = audits[0];
    expect(entry.actor).toEqual({ type: 'USER', id: ID.owner });
    expect([...entry.changedFields].sort()).toEqual(['firstName', 'jobTitle']);
    expect(entry.before).toEqual({ firstName: `${P}Ada`, jobTitle: null });
    expect(entry.after).toEqual({ firstName: `${P}Augusta`, jobTitle: 'Analyst' });
  });

  it('NEGATIVE CONTROL: PATCH by the owner — the in-transaction contact.updated event carries the owner id', async () => {
    const updated = await events(contactId, 'contact.updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ actorType: 'USER', actorId: ID.owner });
  });

  it('NEGATIVE CONTROL: DELETE by the owner — the contact.deleted event and the deleted ContactAuditEntry carry the owner id', async () => {
    const res = await del(ID.owner, contactId);
    expect(res.status).toBe(200);

    const deleted = await events(contactId, 'contact.deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ actorType: 'USER', actorId: ID.owner });

    const audits = await auditEntries(contactId, 'deleted');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'USER', id: ID.owner });
    expect(audits[0].changedFields).toEqual(['deletedAt']);

    const row = await db.contact.findFirst({ where: { id: contactId }, select: { deletedAt: true } });
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });
});

describe('the recorded actor is the requester, not the business owner', () => {
  let contactId: string;

  it('NEGATIVE CONTROL: a staff member’s status change records the staff member on contact.updated, status.changed and the audit entry', async () => {
    const created = await post(ID.owner, { firstName: `${P}Grace`, lastName: 'Hopper' });
    expect(created.status).toBe(201);
    contactId = created.body.id;
    await auditEntries(contactId, 'created');

    const res = await patch(ID.staff, contactId, { status: 'CLIENT' });
    expect(res.status).toBe(200);

    const updated = await events(contactId, 'contact.updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ actorType: 'USER', actorId: ID.staff });
    const statusChanged = await events(contactId, 'status.changed');
    expect(statusChanged).toHaveLength(1);
    expect(statusChanged[0]).toMatchObject({ actorType: 'USER', actorId: ID.staff, data: { from: 'LEAD', to: 'CLIENT' } });

    const audits = await auditEntries(contactId, 'updated');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'USER', id: ID.staff });
    expect(audits[0].changedFields).toEqual(['status']);
    expect(audits[0].before).toEqual({ status: 'LEAD' });
    expect(audits[0].after).toEqual({ status: 'CLIENT' });
  });
});

describe('a request with no identity is refused (401) and writes nothing', () => {
  let contactId: string;

  beforeAll(async () => {
    const created = await post(ID.owner, { firstName: `${P}Anon`, lastName: 'Target' });
    expect(created.status).toBe(201);
    contactId = created.body.id;
    await auditEntries(contactId, 'created');
    await settle();
  });

  it('POST without identity: 401, no contact, event, audit entry or team log', async () => {
    const before = await traceCounts();
    const res = await post(null, { firstName: `${P}Ghost`, email: `${P}ghost@test.local` });
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('id');
    await settle();
    expect(await traceCounts()).toEqual(before);
  });

  it('PATCH without identity: 401, the row is unchanged and nothing is written', async () => {
    const before = await traceCounts();
    const res = await patch(null, contactId, { firstName: `${P}Hijacked` });
    expect(res.status).toBe(401);
    await settle();
    expect(await traceCounts()).toEqual(before);
    const row = await db.contact.findFirst({ where: { id: contactId }, select: { firstName: true } });
    expect(row?.firstName).toBe(`${P}Anon`);
  });

  it('DELETE without identity: 401, the row stays live and nothing is written', async () => {
    const before = await traceCounts();
    const res = await del(null, contactId);
    expect(res.status).toBe(401);
    await settle();
    expect(await traceCounts()).toEqual(before);
    const row = await db.contact.findFirst({ where: { id: contactId }, select: { deletedAt: true } });
    expect(row?.deletedAt).toBeNull();
  });
});

describe('system-context callers keep recording the SYSTEM actor', () => {
  it('KEY adapter create: the contact.created event attributes no user and the audit actor is SYSTEM', async () => {
    const contact = await keyAdapter.createContact({ businessId: ID.bizA, firstName: `${P}Key`, lastName: 'Created' });
    expect(contact?.id).toBeTruthy();

    const created = await events(contact.id, 'contact.created');
    expect(created).toHaveLength(1);
    expect(created[0].actorId).toBeNull();
    expect(created[0].actorType).not.toBe('USER');

    const audits = await auditEntries(contact.id, 'created');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'SYSTEM' });
  });

  it('KEY adapter update and delete: no user on the events, SYSTEM on the audit entries', async () => {
    const contact = await keyAdapter.createContact({ businessId: ID.bizA, firstName: `${P}KeyEdit` });
    await auditEntries(contact.id, 'created');

    await keyAdapter.updateContact({ businessId: ID.bizA, contactId: contact.id, lastName: 'Edited' });
    const updated = await events(contact.id, 'contact.updated');
    expect(updated).toHaveLength(1);
    expect(updated[0].actorId).toBeNull();
    const updAudits = await auditEntries(contact.id, 'updated');
    expect(updAudits).toHaveLength(1);
    expect(updAudits[0].actor).toEqual({ type: 'SYSTEM' });
    expect(updAudits[0].changedFields).toEqual(['lastName']);

    await keyAdapter.deleteContact({ businessId: ID.bizA, contactId: contact.id });
    const deleted = await events(contact.id, 'contact.deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0].actorId).toBeNull();
    const delAudits = await auditEntries(contact.id, 'deleted');
    expect(delAudits).toHaveLength(1);
    expect(delAudits[0].actor).toEqual({ type: 'SYSTEM' });
  });

  it('automation / flow-executor shape (CrmService.updateContact with tags, no context): SYSTEM audit actor, no user on the event', async () => {
    const contact = await crm.createContact({ businessId: ID.bizA, firstName: `${P}Auto` });
    await auditEntries(contact.id, 'created');

    await crm.updateContact({ businessId: ID.bizA, contactId: contact.id, tags: ['vip'] });
    const updated = await events(contact.id, 'contact.updated');
    expect(updated).toHaveLength(1);
    expect(updated[0].actorId).toBeNull();
    const audits = await auditEntries(contact.id, 'updated');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'SYSTEM' });
    expect(audits[0].changedFields).toEqual(['tags']);
  });
});
