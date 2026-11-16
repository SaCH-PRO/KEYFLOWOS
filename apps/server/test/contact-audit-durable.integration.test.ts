/**
 * TOF-CONTACT-AUDIT-AWAIT (V1-63; owner ruling D-25, DEC-CONTACTS-002 Option A) — every contact
 * create, update and delete records its ContactAuditEntry, or does not happen. Against a REAL
 * database, through the HTTP routes.
 *
 * D-25: "Every contact write records a ContactAuditEntry." Before this packet
 * CrmService.auditContact started the entry fire-and-forget (`void this.contactAudit.write(...)`)
 * after the contact's transaction had committed, and ContactAuditService.write caught and only
 * logged every failure ("Never throws"), so awaiting it would have changed nothing: when the audit
 * row could not be written the contact was created, changed or deleted all the same, the request
 * answered 2xx, and the write had no audit row.
 *
 * The contract proven here, for POST, PATCH and DELETE /crm/businesses/:businessId/contacts:
 *   - with the audit write failing (the database refuses the row), the request fails and writes
 *     nothing: no contact row created, changed or deleted, no ContactEvent, no audit row, no team
 *     log, no contact.* announcement and no Activity feed copy;
 *   - a normal write leaves exactly one audit row for itself, already there when the request
 *     answers, naming the member who made it (R0-CT-03);
 *   - the same write retried once the failure is gone writes once and is audited once (no
 *     duplicate row from the failed attempt).
 * The failure is injected in the database, not in the code under test: a trigger on
 * contact_audit_entries refuses every row for one business (bizFail) only, named with this
 * suite's prefix and dropped in cleanup (the ledger-write-door suite's v15a_slow_stamp pattern).
 *
 * Nothing on the HTTP or persistence path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, PlanLimitGuard, TeamAuditInterceptor, the global
 * ValidationPipe and GlobalHttpExceptionFilter, CrmController, CrmService, CrmTimelineService
 * (the ContactEvent row inside the contact transaction) and ContactAuditService are real against
 * DATABASE_URL. The stand-ins: identity attachment (a test middleware reads `x-test-user` and
 * loads that seeded user row as AuthMiddleware would after token verification), the unified
 * activity ledger (a recorder: its calls are the Activity feed copies CrmTimelineService makes),
 * evidence and task assignment, the stats/flow caches and the plan limit (allows), as in
 * contacts-audit-actor.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v63j_` prefix and is hard-deleted by raw
 * SQL (sqlLikePrefix) in beforeAll and afterAll. Cases tagged RED-BEFORE fail on the packet's
 * source base (45d648c8). The CONTROL cases assert what a normal write must keep doing (one audit
 * row, its actor and diff); at the source base their first read, taken as the request answers,
 * fails whenever the fire-and-forget row lands after the answer (it did in the recorded RED run),
 * and their reads after settle() pass.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import { trackAsyncWrites } from './helpers/async-writes.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v63j_';
const ID = {
  owner: `${P}owner`,     // OWNER of both businesses
  bizOk: `${P}bizOk`,     // audit rows are written normally
  bizFail: `${P}bizFail`, // the database refuses every audit row for this business
  // Seeded directly in bizFail (no audit row): the PATCH and DELETE targets.
  upd: `${P}c_upd`,
  del: `${P}c_del`,
};
/** The trigger (and its function) that refuses bizFail's audit rows. */
const REFUSE = `${P}refuse_audit`;
const REFUSAL = `${P}injected audit write failure`;

let db: any;
let app: any;
let crm: any; // the real CrmService, for the system-context caller
let asyncWrites: ReturnType<typeof trackAsyncWrites> | undefined;
/** The Activity feed copies CrmTimelineService hands the unified ledger, by business. */
const feedCopies: Array<{ businessId: string; action: string; entityId?: string }> = [];
/** The contact.* and crm.contact_event.logged announcements, by business. */
const announced: Array<{ name: string; businessId: string }> = [];

async function dropRefusal() {
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${REFUSE} ON contact_audit_entries`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${REFUSE}()`);
}

async function cleanup() {
  try { await dropRefusal(); } catch { /* best-effort */ }
  // Hard-delete via raw SQL (bypasses the soft-delete extension). Contacts created through the
  // API have generated ids, so every table goes by business id.
  for (const sql of [
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function post(businessId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/contacts`)
    .set('x-test-user', ID.owner)
    .send(body);
}

function patch(businessId: string, contactId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(`/crm/businesses/${businessId}/contacts/${contactId}`)
    .set('x-test-user', ID.owner)
    .send(body);
}

function del(businessId: string, contactId: string) {
  return request(app.getHttpServer())
    .delete(`/crm/businesses/${businessId}/contacts/${contactId}`)
    .set('x-test-user', ID.owner);
}

/** Let every write a request started after its answer land (the team log, any fire-and-forget audit). */
async function settle() {
  if (!asyncWrites) throw new Error('settle(): the async-write tracker is not installed');
  await asyncWrites.drain();
}

/** One count by raw SQL: the soft-delete extension would hide deleted contacts from db.contact.count. */
async function count(sql: string, ...params: unknown[]): Promise<number> {
  const [{ n }] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${sql}`, ...params);
  return n;
}

/** Every durable trace a contact write leaves for the business, plus the in-process side channels. */
async function traces(businessId: string) {
  await settle();
  return {
    contacts: await count('contacts WHERE business_id = $1', businessId),
    live: await count('contacts WHERE business_id = $1 AND deleted_at IS NULL', businessId),
    contactEvents: await count('contact_events WHERE business_id = $1', businessId),
    audits: await count('contact_audit_entries WHERE business_id = $1', businessId),
    teamLogs: await count('team_activity_logs WHERE business_id = $1', businessId),
    feedCopies: feedCopies.filter((c) => c.businessId === businessId).length,
    announced: announced.filter((a) => a.businessId === businessId).length,
  };
}

/**
 * The contact row as stored, every column as JSON (raw SQL: a soft-deleted row is read too), or
 * null. search_vector, where a database still carries it, is a tsvector Prisma cannot read.
 */
async function storedContact(id: string): Promise<Record<string, unknown> | null> {
  const rows = await db.$queryRawUnsafe(`SELECT to_jsonb(c) - 'search_vector' AS row FROM contacts c WHERE c.id = $1`, id);
  return rows[0]?.row ?? null;
}

function auditsOf(businessId: string, contactId: string) {
  return db.contactAuditEntry.findMany({ where: { businessId, contactId }, orderBy: { createdAt: 'asc' } });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
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

  // The refused audit writes are expected here; keep their logged failures out of the run output.
  Logger.overrideLogger(['error']);

  // Wait on the writes a request starts after it answers (the team log; on the source base also
  // the fire-and-forget audit entry) instead of sleeping (contacts-persistence, W4-FLAKE-HARDEN).
  asyncWrites = trackAsyncWrites([
    [ContactAuditService.prototype, 'write'],
    [TeamAuditInterceptor.prototype, 'record'],
  ]);

  const events = new EventEmitter2();
  for (const name of ['contact.created', 'contact.updated', 'contact.deleted', 'crm.contact_event.logged']) {
    events.on(name, (payload: { businessId?: string }) => {
      if (payload?.businessId?.startsWith(P)) announced.push({ name, businessId: payload.businessId });
    });
  }

  // ---- the real HTTP path (wired before any row is seeded) ---------------
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
      { provide: EventEmitter2, useValue: events },
      // The unified activity ledger: a recorder of the Activity feed copies CrmTimelineService
      // makes (its write is fire-and-forget and outside the contact transaction).
      {
        provide: TimelineService,
        useValue: {
          recordEvent: async (row: { businessId: string; action: string; entityId?: string }) => {
            if (row?.businessId?.startsWith(P)) feedCopies.push({ businessId: row.businessId, action: row.action, entityId: row.entityId });
          },
        },
      },
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

  await cleanup(); // in case a prior run aborted

  // ---- identity, tenants, memberships ------------------------------------
  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizOk, name: 'V63J Biz Ok', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizFail, name: 'V63J Biz Fail', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m_owner_bizOk`, userId: ID.owner, businessId: ID.bizOk, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_owner_bizFail`, userId: ID.owner, businessId: ID.bizFail, role: 'OWNER' } });

  // ---- bizFail's PATCH and DELETE targets, seeded directly (no audit row) -
  await db.contact.create({ data: { id: ID.upd, businessId: ID.bizFail, firstName: 'Una', lastName: `${P}seed`, jobTitle: 'Clerk' } });
  await db.contact.create({ data: { id: ID.del, businessId: ID.bizFail, firstName: 'Dora', lastName: `${P}seed` } });

  // ---- the injected failure: the database refuses bizFail's audit rows ----
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION ${REFUSE}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${REFUSAL}'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${REFUSE} BEFORE INSERT ON contact_audit_entries FOR EACH ROW
       WHEN (NEW.business_id = '${ID.bizFail}') EXECUTE FUNCTION ${REFUSE}()`,
  );
}, 120_000);

afterAll(async () => {
  await asyncWrites?.drain().catch(() => undefined);
  if (app) await app.close();
  if (db) await cleanup();
  asyncWrites?.restore();
});

describe('fixture sanity (real rows)', () => {
  it('two tenants of one owner, the two seeded bizFail contacts, and no trace of any write yet', async () => {
    expect(await db.membership.count({ where: { userId: ID.owner } })).toBe(2);
    expect(await traces(ID.bizOk)).toEqual({ contacts: 0, live: 0, contactEvents: 0, audits: 0, teamLogs: 0, feedCopies: 0, announced: 0 });
    expect(await traces(ID.bizFail)).toEqual({ contacts: 2, live: 2, contactEvents: 0, audits: 0, teamLogs: 0, feedCopies: 0, announced: 0 });
  });

  it("the database refuses an audit row for bizFail, and only for bizFail (the injected failure is real and bounded)", async () => {
    const entry = (businessId: string, contactId: string) => ({
      data: { businessId, contactId, contactHash: `${P}probe`, action: 'updated', reason: `${P}probe` },
    });
    await expect(db.contactAuditEntry.create(entry(ID.bizFail, ID.upd))).rejects.toThrow(REFUSAL);
    expect(await db.contactAuditEntry.count({ where: { businessId: ID.bizFail } })).toBe(0);

    const okContact = await db.contact.create({ data: { businessId: ID.bizOk, firstName: 'Probe', lastName: `${P}probe` } });
    const probe = await db.contactAuditEntry.create(entry(ID.bizOk, okContact.id));
    expect(probe.id).toBeTruthy();
    await db.$executeRawUnsafe(`DELETE FROM contact_audit_entries WHERE id = $1`, probe.id);
    await db.$executeRawUnsafe(`DELETE FROM contacts WHERE id = $1`, okContact.id);
    expect(await traces(ID.bizOk)).toEqual({ contacts: 0, live: 0, contactEvents: 0, audits: 0, teamLogs: 0, feedCopies: 0, announced: 0 });
  });
});

describe('with the audit write failing, a contact write fails and writes nothing', () => {
  it('RED-BEFORE: POST — the request fails (500) and no contact, event, audit row, team log, announcement or feed copy is written', async () => {
    const before = await traces(ID.bizFail);
    const res = await post(ID.bizFail, { firstName: 'Nadia', lastName: `${P}new`, email: `${P}nadia@test.local` });
    // At 45d648c8: 201, the contact is written and has no audit row.
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    expect(await count('contacts WHERE business_id = $1 AND email = $2', ID.bizFail, `${P}nadia@test.local`)).toBe(0);
    expect(await traces(ID.bizFail)).toEqual(before);
  });

  it('RED-BEFORE: PATCH — the request fails (500), the contact is unchanged and nothing else is written', async () => {
    const row = await storedContact(ID.upd);
    expect(row).toMatchObject({ first_name: 'Una', job_title: 'Clerk' });
    const before = await traces(ID.bizFail);
    const res = await patch(ID.bizFail, ID.upd, { firstName: 'Ursula', jobTitle: 'Manager' });
    // At 45d648c8: 200, the contact is changed and the change has no audit row.
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    // The stored row, every column (updated_at included), is the one read before the request.
    expect(await storedContact(ID.upd)).toEqual(row);
    expect(await traces(ID.bizFail)).toEqual(before);
  });

  it('RED-BEFORE: DELETE — the request fails (500), the contact is still live and nothing else is written', async () => {
    const before = await traces(ID.bizFail);
    const res = await del(ID.bizFail, ID.del);
    // At 45d648c8: 200, the contact is deleted and the deletion has no audit row.
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    const row = await storedContact(ID.del);
    expect(row).not.toBeNull();
    expect(row?.deleted_at).toBeNull();
    expect(await traces(ID.bizFail)).toEqual(before);
  });

  it('RED-BEFORE: a system-context create (no audit context, as the KEY adapter and syncs call it) rejects and writes nothing', async () => {
    const before = await traces(ID.bizFail);
    // At 45d648c8: resolves with the written contact.
    await expect(
      crm.createContact({ businessId: ID.bizFail, firstName: 'Sys', lastName: `${P}system`, email: `${P}system@test.local` }),
    ).rejects.toThrow(REFUSAL);
    expect(await traces(ID.bizFail)).toEqual(before);
  });
});

describe('a normal write leaves exactly one audit row, there when the request answers', () => {
  let contactId: string;

  it("CONTROL: POST — one 'created' row naming the owner; the contact's only audit row", async () => {
    const res = await post(ID.bizOk, { firstName: 'Olive', lastName: `${P}ok`, email: `${P}olive@test.local` });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    contactId = res.body.id;
    // Read before anything is drained: the row committed with the contact.
    const rows = await auditsOf(ID.bizOk, contactId);
    expect(rows.map((r: any) => r.action)).toEqual(['created']);
    expect(rows[0].actor).toEqual({ type: 'USER', id: ID.owner });
    await settle();
    expect((await auditsOf(ID.bizOk, contactId)).map((r: any) => r.action)).toEqual(['created']);
  });

  it("CONTROL: PATCH — one 'updated' row naming the owner, its diff exactly the changed fields", async () => {
    const res = await patch(ID.bizOk, contactId, { firstName: 'Olivia', jobTitle: 'Analyst' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const rows = await auditsOf(ID.bizOk, contactId);
    expect(rows.map((r: any) => r.action)).toEqual(['created', 'updated']);
    const entry = rows[1];
    expect(entry.actor).toEqual({ type: 'USER', id: ID.owner });
    expect([...entry.changedFields].sort()).toEqual(['firstName', 'jobTitle']);
    expect(entry.before).toEqual({ firstName: 'Olive', jobTitle: null });
    expect(entry.after).toEqual({ firstName: 'Olivia', jobTitle: 'Analyst' });
    await settle();
    expect((await auditsOf(ID.bizOk, contactId)).map((r: any) => r.action)).toEqual(['created', 'updated']);
  });

  it("CONTROL: DELETE — one 'deleted' row naming the owner", async () => {
    const res = await del(ID.bizOk, contactId);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const rows = await auditsOf(ID.bizOk, contactId);
    expect(rows.map((r: any) => r.action)).toEqual(['created', 'updated', 'deleted']);
    expect(rows[2].actor).toEqual({ type: 'USER', id: ID.owner });
    expect(rows[2].before).toEqual({ deletedAt: null });
    expect(typeof rows[2].after.deletedAt).toBe('string');
    await settle();
    expect((await auditsOf(ID.bizOk, contactId)).map((r: any) => r.action)).toEqual(['created', 'updated', 'deleted']);
    // The tenant's whole trail: one contact, three events, three audit rows, three team logs.
    const t = await traces(ID.bizOk);
    expect({ contacts: t.contacts, live: t.live, contactEvents: t.contactEvents, audits: t.audits, teamLogs: t.teamLogs })
      .toEqual({ contacts: 1, live: 0, contactEvents: 3, audits: 3, teamLogs: 3 });
  });
});

describe('the same writes retried once the failure is gone: written once, audited once', () => {
  it('the refusal is lifted', async () => {
    await dropRefusal();
    const probe = await db.contactAuditEntry.create({
      data: { businessId: ID.bizFail, contactId: ID.upd, contactHash: `${P}probe`, action: 'updated', reason: `${P}probe` },
    });
    await db.$executeRawUnsafe(`DELETE FROM contact_audit_entries WHERE id = $1`, probe.id);
  });

  it("RED-BEFORE: POST again — 201, one contact with that email and one 'created' row (the failed attempt left nothing to collide with)", async () => {
    const res = await post(ID.bizFail, { firstName: 'Nadia', lastName: `${P}new`, email: `${P}nadia@test.local` });
    // At 45d648c8: 409 contact_email_taken, the failed attempt's contact holds the email.
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const contacts = await db.$queryRawUnsafe(`SELECT id FROM contacts WHERE business_id = $1 AND email = $2`, ID.bizFail, `${P}nadia@test.local`);
    expect(contacts.map((c: any) => c.id)).toEqual([res.body.id]);
    expect((await auditsOf(ID.bizFail, res.body.id)).map((r: any) => r.action)).toEqual(['created']);
  });

  it("RED-BEFORE: PATCH again — 200, one 'updated' row whose diff is the one change (the failed attempt did not already make it)", async () => {
    const res = await patch(ID.bizFail, ID.upd, { firstName: 'Ursula', jobTitle: 'Manager' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    // At 45d648c8: the failed attempt had already written the change, so this row's diff is empty.
    const rows = await auditsOf(ID.bizFail, ID.upd);
    expect(rows.map((r: any) => r.action)).toEqual(['updated']);
    expect(rows[0].before).toEqual({ firstName: 'Una', jobTitle: 'Clerk' });
    expect(rows[0].after).toEqual({ firstName: 'Ursula', jobTitle: 'Manager' });
  });

  it("RED-BEFORE: DELETE again — 200, one 'deleted' row (the failed attempt did not already delete it)", async () => {
    const res = await del(ID.bizFail, ID.del);
    // At 45d648c8: 404, the failed attempt had deleted the contact.
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect((await auditsOf(ID.bizFail, ID.del)).map((r: any) => r.action)).toEqual(['deleted']);
    await settle();
    // bizFail's whole trail: every row is a retried write's, each audited once.
    const t = await traces(ID.bizFail);
    expect({ contacts: t.contacts, live: t.live, contactEvents: t.contactEvents, audits: t.audits, teamLogs: t.teamLogs })
      .toEqual({ contacts: 3, live: 2, contactEvents: 3, audits: 3, teamLogs: 3 });
  });
});
