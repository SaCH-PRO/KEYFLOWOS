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
 * that pass no audit context keep recording the SYSTEM actor on the
 * ContactAuditEntry and attribute no user (a null actorId) on the
 * ContactEvent. As of R0-13c-CT-PATCH-VISIBILITY (residual ST-C, the cases at
 * the end of this file) the events those callers write for update, status
 * change and single delete also say actorType 'SYSTEM', matching the audit
 * entry, where they used to say 'USER'; contact.created and bulk delete still
 * write no actorType.
 * DEC-CONTACTS-002 is unchanged: the ContactAuditEntry write stays
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
 *
 * The cases at the end of the file are the three findings of the
 * R0-03-CT-AUDIT-ACTOR review (ST-A, ST-B, ST-C) that the R0-03 repair handed
 * off as it.todo, each reproduced against the real database with this harness.
 * R0-13c-CT-PATCH-VISIBILITY fixed them in crm.service.ts and made them real
 * cases, required by scripts/proof-admission/manifests/contacts-audit-actor.json.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Many cases here make a dozen HTTP calls and real-DB reads each; under the one
// parallel run of every bound suite (run-manifests) the default 5s budget times
// out with no assertion failing. The assertions are unchanged.
vi.setConfig({ testTimeout: 30_000 });

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

    // Raw SQL: the soft-delete extension hides the row from the model client.
    const rows: Array<{ deleted_at: Date | null }> = await db.$queryRawUnsafe(
      'SELECT deleted_at FROM contacts WHERE id = $1', contactId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).toBeInstanceOf(Date);
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

// ---------------------------------------------------------------------------
// Review repairs (ST-1, ST-2, ST-3). Each was reproduced against the real
// database before the fix; the cases tagged NEGATIVE CONTROL fail on the
// packet head they repair.
// ---------------------------------------------------------------------------

const RID = {
  reassigner: `${P}reassigner`, // STAFF of bizA, crm: write + crm_reassign 'true'
  ownerB: `${P}ownerB`, // OWNER of bizB, no membership in bizA
  bizB: `${P}bizB`,
};

let seq = 0;
/** A live bizA contact seeded directly (no route traffic), owned by `ownerId`. */
async function seedContact(ownerId: string | null = ID.owner) {
  seq += 1;
  return db.contact.create({
    data: { id: `${P}c_repair_${seq}`, businessId: ID.bizA, firstName: `${P}Repair${seq}`, ownerId },
  });
}

/** Every ContactEvent / ContactAuditEntry naming the contact, in ANY tenant. */
async function contactTraces(contactId: string) {
  const [contactEvents, audits] = await Promise.all([
    db.contactEvent.count({ where: { contactId } }),
    db.contactAuditEntry.count({ where: { contactId } }),
  ]);
  return { contactEvents, audits };
}

async function liveRow(contactId: string) {
  const rows: Array<{ owner_id: string | null; deleted_at: Date | null }> = await db.$queryRawUnsafe(
    'SELECT owner_id, deleted_at FROM contacts WHERE id = $1', contactId,
  );
  return rows[0];
}

function bulkDel(bizId: string, actor: string, contactIds: string[]) {
  return request(app.getHttpServer())
    .delete(`/crm/businesses/${bizId}/contacts/bulk`)
    .set('x-test-user', actor)
    .send({ contactIds });
}

describe('ST-1: PATCH cannot reassign a contact without the reassign permission', () => {
  beforeAll(async () => {
    await db.user.create({ data: { id: RID.reassigner, email: `${RID.reassigner}@test.local`, role: 'USER' } });
    await db.membership.create({
      data: {
        id: `${P}m_reassigner_bizA`, userId: RID.reassigner, businessId: ID.bizA, role: 'STAFF',
        permissionScopes: { crm: 'write', crm_reassign: 'true' },
      },
    });
  });

  it('NEGATIVE CONTROL: a write-scoped staff member (reassign false) PATCHing ownerId to themself is refused 403 and nothing is written', async () => {
    const contact = await seedContact(ID.owner);
    const before = await traceCounts();
    const res = await patch(ID.staff, contact.id, { ownerId: ID.staff });
    expect(res.status).toBe(403);
    await settle();
    expect(await traceCounts()).toEqual(before);
    expect((await liveRow(contact.id)).owner_id).toBe(ID.owner);
  });

  it('NEGATIVE CONTROL: the refusal also covers a reassignment bundled with an ordinary edit (no partial write)', async () => {
    const contact = await seedContact(ID.owner);
    const before = await traceCounts();
    const res = await patch(ID.staff, contact.id, { ownerId: ID.staff, jobTitle: 'Bundled' });
    expect(res.status).toBe(403);
    await settle();
    expect(await traceCounts()).toEqual(before);
    const row = await db.contact.findFirst({ where: { id: contact.id }, select: { ownerId: true, jobTitle: true } });
    expect(row).toEqual({ ownerId: ID.owner, jobTitle: null });
  });

  it('the same staff member may resend the CURRENT owner with an edit: not a reassignment, 200, recorded as updated', async () => {
    const contact = await seedContact(ID.owner);
    const res = await patch(ID.staff, contact.id, { ownerId: ID.owner, jobTitle: 'Unchanged owner' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: contact.id, ownerId: ID.owner, jobTitle: 'Unchanged owner' });
    const updated = await auditEntries(contact.id, 'updated');
    expect(updated).toHaveLength(1);
    expect(updated[0].actor).toEqual({ type: 'USER', id: ID.staff });
    await settle();
    expect(await db.contactAuditEntry.count({ where: { contactId: contact.id, action: 'reassigned' } })).toBe(0);
  });

  it('a staff member granted crm_reassign may reassign through PATCH, recorded as reassigned by that member', async () => {
    const contact = await seedContact(ID.owner);
    const res = await patch(RID.reassigner, contact.id, { ownerId: RID.reassigner });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: contact.id, ownerId: RID.reassigner });
    const audits = await auditEntries(contact.id, 'reassigned');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'USER', id: RID.reassigner });
    expect(audits[0].reason).toContain(ID.owner);
    expect(audits[0].reason).toContain(RID.reassigner);
  });

  it('the business owner may always reassign through PATCH', async () => {
    const contact = await seedContact(null);
    const res = await patch(ID.owner, contact.id, { ownerId: ID.staff });
    expect(res.status).toBe(200);
    expect((await liveRow(contact.id)).owner_id).toBe(ID.staff);
    const audits = await auditEntries(contact.id, 'reassigned');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'USER', id: ID.owner });
  });
});

describe('ST-2: two concurrent DELETEs of one contact delete it once', () => {
  it('NEGATIVE CONTROL: of two concurrent DELETEs one is 200 and one 404, with exactly one contact.deleted event and one deleted audit entry (3 rounds)', async () => {
    for (let round = 0; round < 3; round += 1) {
      const contact = await seedContact(ID.owner);
      const [a, b] = await Promise.all([del(ID.owner, contact.id), del(ID.owner, contact.id)]);
      expect([a.status, b.status].sort()).toEqual([200, 404]);

      expect(await events(contact.id, 'contact.deleted')).toHaveLength(1);
      expect(await auditEntries(contact.id, 'deleted')).toHaveLength(1);
      await settle();
      expect(await contactTraces(contact.id)).toEqual({ contactEvents: 1, audits: 1 });
      expect((await liveRow(contact.id)).deleted_at).toBeInstanceOf(Date);
    }
  });

  it('a sequential repeat DELETE stays 404 and writes nothing', async () => {
    const contact = await seedContact(ID.owner);
    expect((await del(ID.owner, contact.id)).status).toBe(200);
    await auditEntries(contact.id, 'deleted');
    await settle();
    const before = await contactTraces(contact.id);
    expect((await del(ID.owner, contact.id)).status).toBe(404);
    await settle();
    expect(await contactTraces(contact.id)).toEqual(before);
  });
});

describe('ST-3: bulk delete writes traces only for the rows it deleted, naming the requester', () => {
  beforeAll(async () => {
    await db.user.create({ data: { id: RID.ownerB, email: `${RID.ownerB}@test.local`, role: 'USER' } });
    await db.business.create({ data: { id: RID.bizB, name: 'TCA Biz B', ownerId: RID.ownerB } });
    await db.membership.create({ data: { id: `${P}m_ownerB_bizB`, userId: RID.ownerB, businessId: RID.bizB, role: 'OWNER' } });
  });

  it('NEGATIVE CONTROL: another tenant’s owner bulk-deleting a bizA contact id through bizB: deleted 0, the contact stays live and NO event or audit row is written in either tenant', async () => {
    const foreign = await seedContact(ID.owner);
    const bizBEventsBefore = await db.contactEvent.count({ where: { businessId: RID.bizB } });
    const bizBAuditsBefore = await db.contactAuditEntry.count({ where: { businessId: RID.bizB } });

    const res = await bulkDel(RID.bizB, RID.ownerB, [foreign.id]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 0 });
    await settle();

    expect((await liveRow(foreign.id)).deleted_at).toBeNull();
    expect(await contactTraces(foreign.id)).toEqual({ contactEvents: 0, audits: 0 });
    expect(await db.contactEvent.count({ where: { businessId: RID.bizB } })).toBe(bizBEventsBefore);
    expect(await db.contactAuditEntry.count({ where: { businessId: RID.bizB } })).toBe(bizBAuditsBefore);
  });

  it('NEGATIVE CONTROL: the bizA owner’s bulk delete records the owner on every contact.deleted event and bulk_deleted audit entry; a missing id gets nothing', async () => {
    const one = await seedContact(ID.owner);
    const two = await seedContact(ID.staff);
    const missing = `${P}c_missing`;

    const res = await bulkDel(ID.bizA, ID.owner, [one.id, two.id, missing]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 2 });

    for (const c of [one, two]) {
      expect((await liveRow(c.id)).deleted_at).toBeInstanceOf(Date);
      const deleted = await events(c.id, 'contact.deleted');
      expect(deleted).toHaveLength(1);
      expect(deleted[0]).toMatchObject({ actorType: 'USER', actorId: ID.owner, data: { bulk: true } });
      const audits = await auditEntries(c.id, 'bulk_deleted');
      expect(audits).toHaveLength(1);
      expect(audits[0].actor).toEqual({ type: 'USER', id: ID.owner });
    }
    await settle();
    expect(await contactTraces(missing)).toEqual({ contactEvents: 0, audits: 0 });
  });

  it('a repeat bulk delete of already-deleted ids deletes 0 and writes nothing', async () => {
    const contact = await seedContact(ID.owner);
    expect((await bulkDel(ID.bizA, ID.owner, [contact.id])).body).toEqual({ deleted: 1 });
    await auditEntries(contact.id, 'bulk_deleted');
    await settle();
    const before = await contactTraces(contact.id);

    const again = await bulkDel(ID.bizA, ID.owner, [contact.id]);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ deleted: 0 });
    await settle();
    expect(await contactTraces(contact.id)).toEqual(before);
  });

  it('system-context bulk delete (no audit context) keeps the SYSTEM actor and attributes no user', async () => {
    const contact = await seedContact(ID.owner);
    expect(await crm.bulkDeleteContacts({ businessId: ID.bizA, contactIds: [contact.id] })).toEqual({ deleted: 1 });
    const deleted = await events(contact.id, 'contact.deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0].actorId).toBeNull();
    const audits = await auditEntries(contact.id, 'bulk_deleted');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'SYSTEM' });
  });
});

// ---------------------------------------------------------------------------
// Review hand-offs (R0-03-CT-AUDIT-ACTOR review ST-A, ST-B, ST-C), each
// reproduced against the real database with this harness and left here as an
// it.todo by the R0-03 repair. R0-13c-CT-PATCH-VISIBILITY turns them into real
// cases (its own suite, contacts-patch-visibility.integration.test.ts, covers
// ST-A and ST-B in depth). Cases tagged NEGATIVE CONTROL fail on the R0-13c
// base, where CrmService.updateContact read the row with the tenant predicate
// only, never checked the new owner's membership, and wrote actorType 'USER'
// on system-context events.
// ---------------------------------------------------------------------------

/** A live bizA contact with sensitive fields, seeded directly (no route traffic). */
async function seedSensitiveContact(visibility: 'PRIVATE' | 'TEAM', ownerId: string) {
  seq += 1;
  const email = `${P}handoff-${seq}@test.local`;
  return db.contact.create({
    data: {
      id: `${P}c_handoff_${seq}`, businessId: ID.bizA, firstName: `${P}Handoff${seq}`, ownerId, visibility,
      email, emailNormalized: email, phone: `+1555013${String(seq).padStart(4, '0')}`, notesInternal: `${P}internal-notes-${seq}`,
    },
  });
}

function detail(actor: string, contactId: string) {
  return request(app.getHttpServer()).get(`/crm/businesses/${ID.bizA}/contacts/${contactId}`).set('x-test-user', actor);
}

async function rowSnapshot(contactId: string) {
  const rows: Array<{ row: string }> = await db.$queryRawUnsafe(
    'SELECT to_jsonb(c)::text AS row FROM contacts c WHERE c.id = $1', contactId,
  );
  return JSON.parse(rows[0].row);
}

describe('ST-A: PATCH applies the GET visibility clause', () => {
  it("NEGATIVE CONTROL: a crm 'write' STAFF member who gets 404 on GET for the owner's PRIVATE contact also gets 404 on PATCH {} and on PATCH {jobTitle}: no row in the body, no change, no ContactEvent and no ContactAuditEntry", async () => {
    const contact = await seedSensitiveContact('PRIVATE', ID.owner);
    expect((await detail(ID.staff, contact.id)).status).toBe(404);
    await settle();
    const before = await traceCounts();
    const rowBefore = await rowSnapshot(contact.id);

    for (const body of [{}, { jobTitle: `${P}Hijacked` }]) {
      const res = await patch(ID.staff, contact.id, body);
      expect(res.status, JSON.stringify(body)).toBe(404);
      expect(res.body.message).toBe('Contact not found');
      for (const key of ['id', 'email', 'phone', 'notesInternal']) expect(res.body).not.toHaveProperty(key);
      for (const secret of [contact.email, contact.phone, contact.notesInternal]) expect(res.text).not.toContain(String(secret));
    }
    await settle();
    expect(await traceCounts()).toEqual(before);
    expect(await rowSnapshot(contact.id)).toEqual(rowBefore);
    expect(await contactTraces(contact.id)).toEqual({ contactEvents: 0, audits: 0 });
  });
});

describe('ST-B: a PATCH reassignment must name a member of this business', () => {
  it("NEGATIVE CONTROL: the owner and a crm_reassign STAFF member PATCHing ownerId to another tenant's user, an unknown id or '' are refused 400 with nothing written, and no 'reassigned' audit entry names the outsider", async () => {
    for (const actor of [ID.owner, RID.reassigner]) {
      for (const ownerId of [RID.ownerB, `${P}not-a-user-at-all`, '']) {
        const label = `${actor} -> '${ownerId}'`;
        const contact = await seedSensitiveContact('TEAM', ID.owner);
        await settle();
        const before = await traceCounts();
        const res = await patch(actor, contact.id, { ownerId });
        expect(res.status, label).toBe(400);
        expect(String(res.body.message), label).toMatch(/must belong to a member of this business/);
        await settle();
        expect(await traceCounts(), label).toEqual(before);
        expect((await liveRow(contact.id)).owner_id, label).toBe(ID.owner);
        expect(await contactTraces(contact.id), label).toEqual({ contactEvents: 0, audits: 0 });
      }
    }
  });
});

describe('ST-C: system-context callers record the SYSTEM actor on the ContactEvent too', () => {
  it('NEGATIVE CONTROL: a KEY adapter update and status change write actorType SYSTEM with no actorId on contact.updated and status.changed, matching the SYSTEM audit entry', async () => {
    const contact = await keyAdapter.createContact({ businessId: ID.bizA, firstName: `${P}KeyStatus` });
    await auditEntries(contact.id, 'created');

    await keyAdapter.updateContact({ businessId: ID.bizA, contactId: contact.id, status: 'CLIENT' });
    const updated = await events(contact.id, 'contact.updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ actorType: 'SYSTEM', actorId: null });
    const statusChanged = await events(contact.id, 'status.changed');
    expect(statusChanged).toHaveLength(1);
    expect(statusChanged[0]).toMatchObject({ actorType: 'SYSTEM', actorId: null, data: { from: 'LEAD', to: 'CLIENT' } });
    const audits = await auditEntries(contact.id, 'updated');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'SYSTEM' });
  });

  it('NEGATIVE CONTROL: a KEY adapter delete writes actorType SYSTEM with no actorId on contact.deleted, matching the SYSTEM audit entry', async () => {
    const contact = await keyAdapter.createContact({ businessId: ID.bizA, firstName: `${P}KeyDelete` });
    await auditEntries(contact.id, 'created');

    await keyAdapter.deleteContact({ businessId: ID.bizA, contactId: contact.id });
    const deleted = await events(contact.id, 'contact.deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ actorType: 'SYSTEM', actorId: null });
    const audits = await auditEntries(contact.id, 'deleted');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'SYSTEM' });
  });

  it('NEGATIVE CONTROL: the automation / flow-executor shape (CrmService.updateContact with tags, no context) writes actorType SYSTEM with no actorId on contact.updated', async () => {
    const contact = await crm.createContact({ businessId: ID.bizA, firstName: `${P}AutoSystem` });
    await auditEntries(contact.id, 'created');

    await crm.updateContact({ businessId: ID.bizA, contactId: contact.id, tags: ['automated'] });
    const updated = await events(contact.id, 'contact.updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ actorType: 'SYSTEM', actorId: null });
    const audits = await auditEntries(contact.id, 'updated');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'SYSTEM' });
  });

  it('the same edits through the HTTP routes keep recording the requesting member as USER on contact.updated, status.changed and contact.deleted', async () => {
    const contact = await seedContact(ID.owner);
    expect((await patch(ID.staff, contact.id, { status: 'CLIENT' })).status).toBe(200);
    expect((await events(contact.id, 'contact.updated'))[0]).toMatchObject({ actorType: 'USER', actorId: ID.staff });
    expect((await events(contact.id, 'status.changed'))[0]).toMatchObject({ actorType: 'USER', actorId: ID.staff });
    expect((await del(ID.owner, contact.id)).status).toBe(200);
    expect((await events(contact.id, 'contact.deleted'))[0]).toMatchObject({ actorType: 'USER', actorId: ID.owner });
  });
});

// ---------------------------------------------------------------------------
// Review repair (R0-13c-CT-PATCH-VISIBILITY review ST-R4) and one hand-off
// (ST-R3 / CR-1), each reproduced against the real database. The NEGATIVE
// CONTROL fails on the reviewed head 45ede9cf, where a call that names its
// member only as actorUserId (no audit context) was recorded as SYSTEM.
// ---------------------------------------------------------------------------

describe('ST-C: only a call that names no actor is recorded as SYSTEM', () => {
  it('NEGATIVE CONTROL: POST /contacts/:id/enrich (ContactEnrichmentService hands CrmService.updateContact the member as actorUserId, with no audit context) records that member as USER on contact.updated and on the updated audit entry; a single delete called the same way does too', async () => {
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { ContactEnrichmentService } = await import('../src/modules/crm/enrichment/contact-enrichment.service');
    // The enabled stand-in for the paid provider: no network, one match.
    const provider = { key: 'stub', enabled: true, enrich: async () => ({ status: 'match', result: { jobTitle: `${P}Filled` } }) };
    const enrichment = new ContactEnrichmentService(app.get(PrismaService), crm, provider as any);

    const contact = await seedSensitiveContact('TEAM', ID.owner);
    // Exactly what ContactEnrichmentController forwards for the requesting member.
    const outcome = await enrichment.enrichContact({ businessId: ID.bizA, contactId: contact.id, actorUserId: ID.staff, force: true });
    expect(outcome).toMatchObject({ status: 'enriched', filled: ['jobTitle'] });
    const updated = await events(contact.id, 'contact.updated');
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ actorType: 'USER', actorId: ID.staff });
    const audits = await auditEntries(contact.id, 'updated');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'USER', id: ID.staff });

    await crm.softDeleteContact({ businessId: ID.bizA, contactId: contact.id, actorUserId: ID.owner });
    const deleted = await events(contact.id, 'contact.deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ actorType: 'USER', actorId: ID.owner });
    const deletedAudits = await auditEntries(contact.id, 'deleted');
    expect(deletedAudits).toHaveLength(1);
    expect(deletedAudits[0].actor).toEqual({ type: 'USER', id: ID.owner });
  });

});

// ---------------------------------------------------------------------------
// R0-13c review hand-off ST-R3 / CR-1, left here as an it.todo by the R0-13c
// repair and made a real case by R0-13d-CT-BULK-ENRICH-VISIBILITY (its own
// suite, contacts-patch-visibility.integration.test.ts, covers the HTTP route
// in depth). The NEGATIVE CONTROL fails on the R0-13d base, where
// ContactEnrichmentService mirrored only the edit scope: the hidden contact
// answered no_match with custom.enrichment stamped, or, on a match, a lookup
// that received its email and name followed by 404.
// ---------------------------------------------------------------------------

describe('ST-R3 / CR-1: enrichment applies the GET visibility clause before the provider call', () => {
  it("NEGATIVE CONTROL: a crm 'write' STAFF member enriching the owner's PRIVATE contact (ContactEnrichmentService called as the controller calls it) is refused 404 exactly like an unknown id, for a provider miss and for a forced match, with no provider call, no custom.enrichment stamp and no ContactEvent or ContactAuditEntry", async () => {
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { ContactEnrichmentService } = await import('../src/modules/crm/enrichment/contact-enrichment.service');
    // The enabled stand-in for the paid provider: no network, records each lookup.
    const lookups: unknown[] = [];
    let outcome: Record<string, unknown> = { status: 'no_match' };
    const provider = { key: 'stub', enabled: true, enrich: async (query: unknown) => { lookups.push(query); return outcome; } };
    const enrichment = new ContactEnrichmentService(app.get(PrismaService), crm, provider as any);
    const refusal = (contactId: string, force?: boolean) =>
      enrichment.enrichContact({ businessId: ID.bizA, contactId, actorUserId: ID.staff, force }).then(
        (value: unknown) => ({ value }),
        (err: any) => ({ status: err?.status, response: err?.getResponse?.() }),
      );

    const contact = await seedSensitiveContact('PRIVATE', ID.owner);
    expect((await detail(ID.staff, contact.id)).status).toBe(404);
    await settle();
    const before = await traceCounts();
    const rowBefore = await rowSnapshot(contact.id);

    for (const [label, providerOutcome, force] of [
      ['miss', { status: 'no_match' }, undefined],
      ['forced match', { status: 'match', result: { jobTitle: `${P}Enriched` } }, true],
    ] as const) {
      outcome = providerOutcome;
      const hidden = await refusal(contact.id, force);
      const absent = await refusal(`${P}c_unknown`, force);
      expect(hidden, label).toEqual(absent);
      expect(hidden, label).toMatchObject({ status: 404, response: { message: 'Contact not found' } });
      expect(lookups, label).toEqual([]);
    }
    await settle();
    expect(await traceCounts()).toEqual(before);
    expect(await rowSnapshot(contact.id)).toEqual(rowBefore);
    expect(await contactTraces(contact.id)).toEqual({ contactEvents: 0, audits: 0 });
  });
});
