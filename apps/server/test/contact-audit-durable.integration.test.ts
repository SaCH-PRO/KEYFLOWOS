/**
 * TOF-CONTACT-AUDIT-AWAIT (V1-63; owner ruling D-25, DEC-CONTACTS-002 Option A) — every contact
 * write records its ContactAuditEntry, or does not happen. Against a REAL database, through the
 * HTTP routes.
 *
 * D-25: "Every contact write records a ContactAuditEntry." Before this packet
 * CrmService.auditContact started the entry fire-and-forget (`void this.contactAudit.write(...)`)
 * after the contact's transaction had committed, and ContactAuditService.write caught and only
 * logged every failure ("Never throws"), so awaiting it would have changed nothing: when the audit
 * row could not be written the contact was created, changed or deleted all the same, the request
 * answered 2xx, and the write had no audit row. POST contacts/bulk/reassign wrote no audit row at
 * all, even with the audit table healthy.
 *
 * The contract proven here, for POST, PATCH and DELETE /crm/businesses/:businessId/contacts and
 * (review repair SEC-CAA-2 / COR-2) the many-row and merge writes: PATCH and DELETE contacts/bulk,
 * POST contacts/bulk/reassign, POST contacts/:contactId/merge/:duplicateId and the import merge
 * (POST import/image/ocr of a card whose email matches an existing contact, which fills that
 * contact's empty fields through CrmService.findOrCreateContact):
 *   - with the audit write failing (the database refuses the row), the request fails and writes
 *     nothing: no contact row created, changed, reassigned, merged or deleted, no ContactEvent, no
 *     audit row, no team log, no merge operation, no media row, no contact.* announcement and no
 *     Activity feed copy;
 *   - a normal write leaves exactly one audit row per contact it wrote, already there when the
 *     request answers, naming the member who made it (R0-CT-03);
 *   - the same write retried once the failure is gone writes once and is audited once (no
 *     duplicate row from the failed attempt, and the failed attempt left nothing behind).
 * The failure is injected in the database, not in the code under test: a trigger on
 * contact_audit_entries refuses every row for two businesses (bizFail, bizFailMany) only, named
 * with this suite's prefix (the ledger-write-door suite's v15a_slow_stamp pattern). The refusal is
 * lifted by replacing the trigger function's body with a pass-through (CREATE OR REPLACE FUNCTION
 * takes no lock on contact_audit_entries), and the trigger is created and dropped only in
 * beforeAll and cleanup, each under a short lock_timeout and retried (review repair COR-3): a
 * CREATE or DROP TRIGGER queued behind another suite's EXCLUSIVE hold on the table
 * (contacts-persistence [CP-FH-01]) would otherwise block every read of the table behind it.
 *
 * Nothing on the HTTP or persistence path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, PlanLimitGuard, TeamAuditInterceptor, the global
 * ValidationPipe and GlobalHttpExceptionFilter, CrmController, CrmService, CrmTimelineService
 * (the ContactEvent row inside the contact transaction), CrmImportService and
 * EntityResolutionService (the import merge) and ContactAuditService are real against
 * DATABASE_URL. The stand-ins: identity attachment (a test middleware reads `x-test-user` and
 * loads that seeded user row as AuthMiddleware would after token verification), the unified
 * activity ledger (a recorder: its calls are the Activity feed copies CrmTimelineService makes),
 * evidence and task assignment, AI usage (the OCR route makes no provider call), the stats/flow
 * caches and the plan limit (allows), as in contacts-audit-actor.
 *
 * Review repair SEC-TCAC-1 (TOF-CONTACT-AUDIT-CREATE): a reassign decides who owned each contact,
 * and whether the member may still see it, on the row it locks inside its own transaction. The two
 * race cases hold a contact row (SELECT ... FOR UPDATE in a transaction of the test's own), send
 * the reassign, wait until it is parked behind that lock (pg_blocking_pids), then commit an owner
 * change through the holder, standing in for a concurrent PATCH ownerId, before letting it go.
 * Their RED-BEFORE cases fail at 34ee89f2 too, the packet head the repair starts from.
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
  owner: `${P}owner`,     // OWNER of every business
  staff: `${P}staff`,     // STAFF in bizFailMany and bizOkMany: the reassign target
  bizOk: `${P}bizOk`,     // audit rows are written normally
  bizFail: `${P}bizFail`, // the database refuses every audit row for this business
  // Seeded directly in bizFail (no audit row): the PATCH and DELETE targets.
  upd: `${P}c_upd`,
  del: `${P}c_del`,
  // The many-row and merge writes (SEC-CAA-2 / COR-2), in two more businesses so the single-row
  // cases above keep their exact per-business trails.
  bizOkMany: `${P}bizOkMany`,     // audit rows are written normally
  bizFailMany: `${P}bizFailMany`, // the database refuses every audit row for this business too
  // The reassign races (review repair SEC-TCAC-1): audit rows are written normally.
  bizRace: `${P}bizRace`,
  booker: `${P}booker`, // STAFF in bizRace whose book is the contacts they own, with the reassign right
};
/**
 * bizRace's contacts, seeded directly (no audit row): rc1 owned by staff (the owner's reassign
 * race), rv1 and rv2 owned by booker (the my-book member's reassign race, and its CONTROL).
 */
const RACE = ['rc1', 'rv1', 'rv2'] as const;
type RaceKey = (typeof RACE)[number];
const race = (key: RaceKey) => `${ID.bizRace}_${key}`;
/**
 * The contacts each many-row write starts from, seeded directly (no audit row) in both businesses
 * under the same keys: bulk status update (bs1, bs2), bulk tag add (bt1), bulk delete (bd1, bd2),
 * merge (mp the primary, md the duplicate, which fills mp's empty job title and company), reassign (ra1, ra2, owned by the owner) and the import
 * merge target (im, whose email the OCR card carries).
 */
const MANY = ['bs1', 'bs2', 'bt1', 'bd1', 'bd2', 'mp', 'md', 'ra1', 'ra2', 'im'] as const;
type ManyKey = (typeof MANY)[number];
const many = (businessId: string, key: ManyKey) => `${businessId}_${key}`;
const importEmail = (businessId: string) => `${businessId.toLowerCase()}-import@test.local`;
/** The trigger (and its function) that refuses bizFail's and bizFailMany's audit rows. */
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

/**
 * DDL on contact_audit_entries under a short lock_timeout, retried (review repair COR-3). CREATE
 * TRIGGER and DROP TRIGGER lock the table; queued behind another session's EXCLUSIVE hold
 * (contacts-persistence [CP-FH-01] holds it for 1.5 s in a parallel run) a DROP TRIGGER would
 * block every read of the table behind it until that hold ends. Under lock_timeout it gives up
 * its place in the queue within LOCK_TIMEOUT_MS and tries again.
 */
const LOCK_TIMEOUT_MS = 100;
const DDL_ATTEMPTS = 150;
async function auditTableDdl(sql: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
        await tx.$executeRawUnsafe(sql);
      });
      return;
    } catch (err: any) {
      const lockTimeout = err?.meta?.code === '55P03' || /lock timeout/i.test(String(err?.message));
      if (!lockTimeout || attempt >= DDL_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, LOCK_TIMEOUT_MS));
    }
  }
}

/** The trigger function's body: refuse the row, or (lifted) let it through. No table lock. */
async function setRefusal(refuse: boolean) {
  const body = refuse ? `RAISE EXCEPTION '${REFUSAL}';` : 'RETURN NEW;';
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION ${REFUSE}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} END $$`,
  );
}

async function installRefusal() {
  await setRefusal(true);
  await auditTableDdl(
    `CREATE TRIGGER ${REFUSE} BEFORE INSERT ON contact_audit_entries FOR EACH ROW
       WHEN (NEW.business_id IN ('${ID.bizFail}', '${ID.bizFailMany}')) EXECUTE FUNCTION ${REFUSE}()`,
  );
}

/** Lift the refusal mid-suite without touching the table's locks. */
async function liftRefusal() {
  await setRefusal(false);
}

async function dropRefusal() {
  await auditTableDdl(`DROP TRIGGER IF EXISTS ${REFUSE} ON contact_audit_entries`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${REFUSE}()`);
}

async function cleanup() {
  try { await dropRefusal(); } catch { /* best-effort */ }
  // Hard-delete via raw SQL (bypasses the soft-delete extension). Contacts created through the
  // API have generated ids, so every table goes by business id.
  for (const sql of [
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_media WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM merge_operations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function bulkPatch(businessId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(`/crm/businesses/${businessId}/contacts/bulk`)
    .set('x-test-user', ID.owner)
    .send(body);
}

function bulkDelete(businessId: string, contactIds: string[]) {
  return request(app.getHttpServer())
    .delete(`/crm/businesses/${businessId}/contacts/bulk`)
    .set('x-test-user', ID.owner)
    .send({ contactIds });
}

function reassign(businessId: string, contactIds: string[], newOwnerId: string, actor: string = ID.owner) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/contacts/bulk/reassign`)
    .set('x-test-user', actor)
    .send({ contactIds, newOwnerId });
}

function merge(businessId: string, primaryId: string, duplicateId: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/contacts/${primaryId}/merge/${duplicateId}`)
    .set('x-test-user', ID.owner)
    .send({});
}

/** The import merge: a card whose email matches `im` fills im's empty last name and phone. */
function ocrImport(businessId: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/import/image/ocr`)
    .set('x-test-user', ID.owner)
    .send({ ocrText: `Ivo Imported\n${importEmail(businessId)}\n+1 868 555 0101` });
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

/** The refusal's reason stays in the server log: the client gets the generic 500 body only. */
function expectGeneric500(body: Record<string, unknown>) {
  expect(body).toMatchObject({ statusCode: 500, message: 'Internal server error' });
  expect(JSON.stringify(body)).not.toContain(REFUSAL);
}

/** Every seeded many-row contact of the business, as stored (every column). */
async function storedMany(businessId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const key of MANY) out[key] = await storedContact(many(businessId, key));
  return out;
}

/** The many-row traces beyond traces(): merge operations and media rows. */
async function manyTraces(businessId: string) {
  return {
    ...(await traces(businessId)),
    mergeOps: await count('merge_operations WHERE business_id = $1', businessId),
    media: await count('contact_media WHERE business_id = $1', businessId),
  };
}

function auditsOf(businessId: string, contactId: string) {
  return db.contactAuditEntry.findMany({ where: { businessId, contactId }, orderBy: { createdAt: 'asc' } });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Review repair SEC-TCAC-1: holds the contact row (SELECT ... FOR UPDATE) in a transaction of the
 * test's own, sends `call`, waits until a backend of this database is blocked behind the holder
 * (the call has read whatever it reads before its own lock and is parked at the row), runs
 * `change` through the holder (standing in for a concurrent PATCH that commits first), commits,
 * and returns the call's response. Nothing but `change` is written through the holder.
 */
async function racedBehindRowLock(
  contactId: string,
  call: () => PromiseLike<any>,
  change: string,
  ...params: unknown[]
): Promise<{ status: number; body: any }> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let locked!: (pid: number) => void;
  const isLocked = new Promise<number>((resolve) => { locked = resolve; });
  const holder: Promise<void> = db.$transaction(async (tx: any) => {
    const [me] = await tx.$queryRawUnsafe(`SELECT pg_backend_pid()::int AS pid`);
    await tx.$queryRawUnsafe(`SELECT id FROM contacts WHERE id = $1 FOR UPDATE`, contactId);
    locked(me.pid);
    await gate;
    await tx.$executeRawUnsafe(change, ...params);
  }, { maxWait: 10_000, timeout: 30_000 });
  const holderPid = await Promise.race([
    isLocked,
    holder.then(() => { throw new Error('the holder ended before it locked the row'); }),
  ]);
  let pending: Promise<{ status: number; body: any }> | undefined;
  try {
    pending = Promise.resolve(call()).then((res) => res, (err: unknown) => ({ status: -1, body: String(err) }));
    let parked = 0;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const [row] = await db.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))`,
        holderPid,
      );
      parked = row.n;
      if (parked >= 1) break;
      await sleep(25);
    }
    expect(parked, 'the reassign is parked behind the held row').toBeGreaterThanOrEqual(1);
  } finally {
    release();
    await holder;
  }
  return pending!;
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
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
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
  for (const name of ['contact.created', 'contact.updated', 'contact.deleted', 'contact.merged', 'crm.contact_event.logged']) {
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
      // The import merge: the importer and the matcher findOrCreateContact consults are real.
      CrmImportService,
      EntityResolutionService,
      { provide: AiUsageService, useValue: {} },
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
      { provide: ContactCustomFieldValueService, useValue: {} },
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

  // ---- the many-row and merge writes (SEC-CAA-2 / COR-2) ------------------
  await db.user.create({ data: { id: ID.staff, email: `${P}staff@test.local`, role: 'USER' } });
  for (const biz of [ID.bizOkMany, ID.bizFailMany]) {
    await db.business.create({ data: { id: biz, name: `V63J ${biz.slice(P.length)}`, ownerId: ID.owner } });
    await db.membership.create({ data: { id: `${biz}_m_owner`, userId: ID.owner, businessId: biz, role: 'OWNER' } });
    await db.membership.create({ data: { id: `${biz}_m_staff`, userId: ID.staff, businessId: biz, role: 'STAFF' } });
    const seed = (key: ManyKey, data: Record<string, unknown>) =>
      db.contact.create({ data: { id: many(biz, key), businessId: biz, lastName: `${P}seed`, ...data } });
    await seed('bs1', { firstName: 'Bea', status: 'LEAD' });
    await seed('bs2', { firstName: 'Ben', status: 'LEAD' });
    await seed('bt1', { firstName: 'Tia', tags: [`${P}old`] });
    await seed('bd1', { firstName: 'Dee' });
    await seed('bd2', { firstName: 'Dan' });
    await seed('mp', { firstName: 'Mia' });
    // The duplicate fills two of the primary's empty fields. Neither has an email or phone: a merge
    // that copies the duplicate's email or phone into the primary is refused by the live-row unique
    // index before the duplicate is deleted (a merge defect outside this packet, recorded).
    await seed('md', { firstName: 'Mia', jobTitle: 'Buyer', companyName: `${P}Dup Co` });
    await seed('ra1', { firstName: 'Rae', ownerId: ID.owner });
    await seed('ra2', { firstName: 'Rex', ownerId: ID.owner });
    await db.contact.create({
      data: { id: many(biz, 'im'), businessId: biz, firstName: 'Ivo', email: importEmail(biz), emailNormalized: importEmail(biz) },
    });
  }

  // ---- the reassign races (SEC-TCAC-1): the owner, staff and a my-book member with the reassign right ----
  await db.user.create({ data: { id: ID.booker, email: `${P}booker@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizRace, name: 'V63J Biz Race', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${ID.bizRace}_m_owner`, userId: ID.owner, businessId: ID.bizRace, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${ID.bizRace}_m_staff`, userId: ID.staff, businessId: ID.bizRace, role: 'STAFF' } });
  await db.membership.create({
    data: {
      id: `${ID.bizRace}_m_booker`, userId: ID.booker, businessId: ID.bizRace, role: 'STAFF',
      permissionScopes: { crm: 'write', crm_view: 'owned', crm_reassign: 'true' },
    },
  });
  await db.contact.create({ data: { id: race('rc1'), businessId: ID.bizRace, firstName: 'Cass', lastName: `${P}seed`, ownerId: ID.staff } });
  await db.contact.create({ data: { id: race('rv1'), businessId: ID.bizRace, firstName: 'Vera', lastName: `${P}seed`, ownerId: ID.booker } });
  await db.contact.create({ data: { id: race('rv2'), businessId: ID.bizRace, firstName: 'Vic', lastName: `${P}seed`, ownerId: ID.booker } });

  // ---- the injected failure: the database refuses bizFail's and bizFailMany's audit rows ----
  await installRefusal();
}, 120_000);

afterAll(async () => {
  await asyncWrites?.drain().catch(() => undefined);
  if (app) await app.close();
  if (db) await cleanup();
  asyncWrites?.restore();
});

describe('fixture sanity (real rows)', () => {
  it('two tenants of one owner, the two seeded bizFail contacts, and no trace of any write yet', async () => {
    expect(await db.membership.count({ where: { userId: ID.owner, businessId: { in: [ID.bizOk, ID.bizFail] } } })).toBe(2);
    expect(await traces(ID.bizOk)).toEqual({ contacts: 0, live: 0, contactEvents: 0, audits: 0, teamLogs: 0, feedCopies: 0, announced: 0 });
    expect(await traces(ID.bizFail)).toEqual({ contacts: 2, live: 2, contactEvents: 0, audits: 0, teamLogs: 0, feedCopies: 0, announced: 0 });
  });

  it('the many-row tenants: the owner and one STAFF member each, the ten seeded contacts, and no trace of any write yet', async () => {
    for (const biz of [ID.bizOkMany, ID.bizFailMany]) {
      const members = await db.membership.findMany({ where: { businessId: biz }, select: { userId: true, role: true }, orderBy: { userId: 'asc' } });
      expect(members).toEqual([{ userId: ID.owner, role: 'OWNER' }, { userId: ID.staff, role: 'STAFF' }]);
      expect(await manyTraces(biz)).toEqual({
        contacts: MANY.length, live: MANY.length, contactEvents: 0, audits: 0, teamLogs: 0, feedCopies: 0, announced: 0, mergeOps: 0, media: 0,
      });
    }
  });

  it("the database refuses an audit row for bizFail and bizFailMany, and only for them (the injected failure is real and bounded)", async () => {
    const entry = (businessId: string, contactId: string) => ({
      data: { businessId, contactId, contactHash: `${P}probe`, action: 'updated', reason: `${P}probe` },
    });
    await expect(db.contactAuditEntry.create(entry(ID.bizFail, ID.upd))).rejects.toThrow(REFUSAL);
    expect(await db.contactAuditEntry.count({ where: { businessId: ID.bizFail } })).toBe(0);
    await expect(db.contactAuditEntry.create(entry(ID.bizFailMany, many(ID.bizFailMany, 'bs1')))).rejects.toThrow(REFUSAL);
    expect(await db.contactAuditEntry.count({ where: { businessId: ID.bizFailMany } })).toBe(0);

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
    expectGeneric500(res.body);
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
    expectGeneric500(res.body);
    // The stored row, every column (updated_at included), is the one read before the request.
    expect(await storedContact(ID.upd)).toEqual(row);
    expect(await traces(ID.bizFail)).toEqual(before);
  });

  it('RED-BEFORE: DELETE — the request fails (500), the contact is still live and nothing else is written', async () => {
    const before = await traces(ID.bizFail);
    const res = await del(ID.bizFail, ID.del);
    // At 45d648c8: 200, the contact is deleted and the deletion has no audit row.
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    expectGeneric500(res.body);
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

describe('with the audit write failing, a many-row, reassign, merge or import-merge write fails and writes nothing (review repair SEC-CAA-2 / COR-2)', () => {
  const B = ID.bizFailMany;
  const c = (key: ManyKey) => many(B, key);

  /** A refused request: 500 with the generic body, and every seeded row and every trace exactly as before. */
  async function refusedAndWroteNothing(send: () => Promise<any>) {
    const rows = await storedMany(B);
    const before = await manyTraces(B);
    const res = await send();
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    expectGeneric500(res.body);
    // Every seeded contact, every column (updated_at included), is the one read before the request.
    expect(await storedMany(B)).toEqual(rows);
    expect(await manyTraces(B)).toEqual(before);
  }

  it('RED-BEFORE: PATCH contacts/bulk setting a field — 500; neither contact changes and nothing else is written', async () => {
    // At 45d648c8: 200 {"updated":2}, both contacts' status changed, no audit row.
    await refusedAndWroteNothing(() => bulkPatch(B, { contactIds: [c('bs1'), c('bs2')], status: 'CLIENT' }));
  });

  it('RED-BEFORE: PATCH contacts/bulk adding tags — 500; the contact keeps its tags and nothing else is written', async () => {
    // At 45d648c8: 200 {"updated":1}, the tag added, no audit row.
    await refusedAndWroteNothing(() => bulkPatch(B, { contactIds: [c('bt1')], addTags: [`${P}new`] }));
  });

  it('RED-BEFORE: DELETE contacts/bulk — 500; both contacts stay live and nothing else is written', async () => {
    // At 45d648c8: 200 {"deleted":2}, both contacts soft-deleted, no audit row.
    await refusedAndWroteNothing(() => bulkDelete(B, [c('bd1'), c('bd2')]));
  });

  it('RED-BEFORE: POST contacts/bulk/reassign — 500; both contacts keep their owner and nothing else is written', async () => {
    // At 45d648c8: 201 {"reassigned":2}, owner_id moved on both, and a reassign writes no audit row
    // at all (not even with the audit table healthy: see the CONTROL below).
    await refusedAndWroteNothing(() => reassign(B, [c('ra1'), c('ra2')], ID.staff));
  });

  it('RED-BEFORE: POST contacts/:contactId/merge/:duplicateId — 500; the duplicate stays live, the primary unchanged, no merge operation, nothing else written', async () => {
    // At 45d648c8: 201, the duplicate merged away into the primary, no audit row.
    await refusedAndWroteNothing(() => merge(B, c('mp'), c('md')));
  });

  it('RED-BEFORE: POST import/image/ocr of a card matching an existing contact (the import merge) — 500; the contact keeps its empty fields, no media row, nothing else written', async () => {
    // At 45d648c8: 201, the matched contact's last name, phone and source filled, a media row and
    // an event written, no audit row.
    await refusedAndWroteNothing(() => ocrImport(B));
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

describe('a normal many-row, reassign, merge or import-merge write leaves one audit row per contact it wrote, there when the request answers (review repair SEC-CAA-2 / COR-2)', () => {
  const B = ID.bizOkMany;
  const c = (key: ManyKey) => many(B, key);
  const OWNER = { type: 'USER', id: ID.owner };
  const brief = (r: any) => ({ action: r.action, actor: r.actor, before: r.before, after: r.after, reason: r.reason });

  it("CONTROL: PATCH contacts/bulk setting a field — one 'bulk_updated' row per contact, naming the owner", async () => {
    const res = await bulkPatch(B, { contactIds: [c('bs1'), c('bs2')], status: 'CLIENT' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body).toEqual({ updated: 2 });
    for (const key of ['bs1', 'bs2'] as const) {
      // Read before anything is drained: the rows committed with the change.
      expect((await auditsOf(B, c(key))).map(brief), key)
        .toEqual([{ action: 'bulk_updated', actor: OWNER, before: {}, after: { status: 'CLIENT' }, reason: null }]);
      expect(await storedContact(c(key))).toMatchObject({ status: 'CLIENT' });
    }
    await settle();
    for (const key of ['bs1', 'bs2'] as const) expect(await auditsOf(B, c(key)), key).toHaveLength(1);
  });

  it("CONTROL: PATCH contacts/bulk adding tags — one 'bulk_updated' row naming the owner", async () => {
    const res = await bulkPatch(B, { contactIds: [c('bt1')], addTags: [`${P}new`] });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body).toEqual({ updated: 1 });
    expect((await auditsOf(B, c('bt1'))).map(brief))
      .toEqual([{ action: 'bulk_updated', actor: OWNER, before: {}, after: { addedTags: [`${P}new`] }, reason: null }]);
    expect(await storedContact(c('bt1'))).toMatchObject({ tags: [`${P}old`, `${P}new`] });
    await settle();
    expect(await auditsOf(B, c('bt1'))).toHaveLength(1);
  });

  it("CONTROL: DELETE contacts/bulk — one 'bulk_deleted' row per contact, naming the owner", async () => {
    const res = await bulkDelete(B, [c('bd1'), c('bd2')]);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body).toEqual({ deleted: 2 });
    for (const key of ['bd1', 'bd2'] as const) {
      expect((await auditsOf(B, c(key))).map((r: any) => ({ action: r.action, actor: r.actor })), key)
        .toEqual([{ action: 'bulk_deleted', actor: OWNER }]);
      expect((await storedContact(c(key)))?.deleted_at, key).not.toBeNull();
    }
    await settle();
    for (const key of ['bd1', 'bd2'] as const) expect(await auditsOf(B, c(key)), key).toHaveLength(1);
  });

  it("RED-BEFORE: POST contacts/bulk/reassign — one 'reassigned' row per contact, naming the owner, from the old owner to the new", async () => {
    const res = await reassign(B, [c('ra1'), c('ra2')], ID.staff);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body).toEqual({ reassigned: 2, newOwnerId: ID.staff });
    for (const key of ['ra1', 'ra2'] as const) {
      // At 45d648c8: [] — an ownership change, which widens what a 'my book' member can open, had no audit row.
      expect((await auditsOf(B, c(key))).map(brief), key).toEqual([{
        action: 'reassigned',
        actor: OWNER,
        before: { ownerId: ID.owner },
        after: { ownerId: ID.staff },
        reason: `owner ${ID.owner} → ${ID.staff}`,
      }]);
      expect(await storedContact(c(key)), key).toMatchObject({ owner_id: ID.staff });
    }
    await settle();
    for (const key of ['ra1', 'ra2'] as const) expect(await auditsOf(B, c(key)), key).toHaveLength(1);
  });

  it("RED-BEFORE: POST contacts/:contactId/merge/:duplicateId — one 'merged' row for the primary and one for the duplicate, naming the owner who merged them", async () => {
    const res = await merge(B, c('mp'), c('md'));
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const primary = await auditsOf(B, c('mp'));
    const duplicate = await auditsOf(B, c('md'));
    // At 45d648c8 the rows land after the answer, and when they do they name SYSTEM, not the owner.
    expect(primary.map((r: any) => ({ action: r.action, actor: r.actor, reason: r.reason })))
      .toEqual([{ action: 'merged', actor: OWNER, reason: `merged duplicate ${c('md')} into primary` }]);
    expect(primary[0].after).toMatchObject({ jobTitle: 'Buyer', companyName: `${P}Dup Co` });
    expect(duplicate.map((r: any) => ({ action: r.action, actor: r.actor, reason: r.reason })))
      .toEqual([{ action: 'merged', actor: OWNER, reason: `duplicate merged into ${c('mp')}` }]);
    expect(await storedContact(c('md'))).toMatchObject({ merged_into_id: c('mp') });
    await settle();
    expect(await auditsOf(B, c('mp'))).toHaveLength(1);
    expect(await auditsOf(B, c('md'))).toHaveLength(1);
  });

  it("CONTROL: POST import/image/ocr of a card matching an existing contact — one 'updated' row naming the owner, its diff the fields the card filled", async () => {
    const res = await ocrImport(B);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.contact).toMatchObject({ id: c('im'), lastName: 'Imported' });
    const rows = await auditsOf(B, c('im'));
    expect(rows.map((r: any) => ({ action: r.action, actor: r.actor, reason: r.reason })))
      .toEqual([{ action: 'updated', actor: OWNER, reason: 'merged ocr input into existing contact' }]);
    expect(rows[0].changedFields).toEqual(expect.arrayContaining(['lastName', 'phone']));
    expect(rows[0].before).toMatchObject({ lastName: null, phone: null });
    expect(rows[0].after).toMatchObject({ lastName: 'Imported' });
    await settle();
    expect(await auditsOf(B, c('im'))).toHaveLength(1);
  });

  it("bizOkMany's whole trail: one audit row for each contact each write wrote", async () => {
    await settle();
    expect(await manyTraces(B)).toMatchObject({
      contacts: MANY.length,
      live: MANY.length - 3, // bd1, bd2 deleted; md merged away
      audits: 10, // bs1, bs2, bt1, bd1, bd2, ra1, ra2, mp, md, im
      mergeOps: 1,
      media: 1,
    });
  });
});

describe('the same writes retried once the failure is gone: written once, audited once', () => {
  it('the refusal is lifted (the trigger function now lets every row through; no lock is taken on the table)', async () => {
    await liftRefusal();
    for (const [businessId, contactId] of [[ID.bizFail, ID.upd], [ID.bizFailMany, many(ID.bizFailMany, 'bs1')]]) {
      const probe = await db.contactAuditEntry.create({
        data: { businessId, contactId, contactHash: `${P}probe`, action: 'updated', reason: `${P}probe` },
      });
      await db.$executeRawUnsafe(`DELETE FROM contact_audit_entries WHERE id = $1`, probe.id);
    }
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
  });

  it("RED-BEFORE: bizFail's whole trail: every row is a retried write's, each audited once", async () => {
    await settle();
    const t = await traces(ID.bizFail);
    expect({ contacts: t.contacts, live: t.live, contactEvents: t.contactEvents, audits: t.audits, teamLogs: t.teamLogs })
      .toEqual({ contacts: 3, live: 2, contactEvents: 3, audits: 3, teamLogs: 3 });
  });
});

describe('the many-row, reassign, merge and import-merge writes retried once the failure is gone: written once, audited once (review repair SEC-CAA-2 / COR-2)', () => {
  const B = ID.bizFailMany;
  const c = (key: ManyKey) => many(B, key);
  const OWNER = { type: 'USER', id: ID.owner };

  it("CONTROL: PATCH contacts/bulk again (a field, then added tags) — each contact's one 'bulk_updated' row, there when the request answers", async () => {
    const field = await bulkPatch(B, { contactIds: [c('bs1'), c('bs2')], status: 'CLIENT' });
    expect(field.status, JSON.stringify(field.body).slice(0, 300)).toBe(200);
    expect(field.body).toEqual({ updated: 2 });
    const tags = await bulkPatch(B, { contactIds: [c('bt1')], addTags: [`${P}new`] });
    expect(tags.status, JSON.stringify(tags.body).slice(0, 300)).toBe(200);
    for (const key of ['bs1', 'bs2', 'bt1'] as const) {
      expect((await auditsOf(B, c(key))).map((r: any) => r.action), key).toEqual(['bulk_updated']);
    }
    expect(await storedContact(c('bt1'))).toMatchObject({ tags: [`${P}old`, `${P}new`] });
  });

  it("RED-BEFORE: DELETE contacts/bulk again — 200 {\"deleted\":2} and one 'bulk_deleted' row each (the failed attempt did not already delete them)", async () => {
    const res = await bulkDelete(B, [c('bd1'), c('bd2')]);
    // At 45d648c8: 200 {"deleted":0}, the failed attempt had deleted both.
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body).toEqual({ deleted: 2 });
    for (const key of ['bd1', 'bd2'] as const) {
      expect((await auditsOf(B, c(key))).map((r: any) => r.action), key).toEqual(['bulk_deleted']);
    }
  });

  it("RED-BEFORE: POST contacts/bulk/reassign again — one 'reassigned' row each, from the owner the failed attempt left in place", async () => {
    const res = await reassign(B, [c('ra1'), c('ra2')], ID.staff);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body).toEqual({ reassigned: 2, newOwnerId: ID.staff });
    for (const key of ['ra1', 'ra2'] as const) {
      // At 45d648c8: [] (a reassign writes no audit row).
      expect((await auditsOf(B, c(key))).map((r: any) => ({ action: r.action, actor: r.actor, before: r.before, after: r.after })), key)
        .toEqual([{ action: 'reassigned', actor: OWNER, before: { ownerId: ID.owner }, after: { ownerId: ID.staff } }]);
    }
  });

  it("RED-BEFORE: POST contacts/:contactId/merge/:duplicateId again — 201 and one 'merged' row each (the failed attempt did not already merge them)", async () => {
    const res = await merge(B, c('mp'), c('md'));
    // At 45d648c8: 404, the failed attempt had merged the duplicate away.
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect((await auditsOf(B, c('mp'))).map((r: any) => r.action)).toEqual(['merged']);
    expect((await auditsOf(B, c('md'))).map((r: any) => r.action)).toEqual(['merged']);
    expect(await count('merge_operations WHERE business_id = $1', B)).toBe(1);
  });

  it("RED-BEFORE: POST import/image/ocr again — 201 and one 'updated' row whose diff fills the empty fields (the failed attempt did not already fill them)", async () => {
    const res = await ocrImport(B);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const rows = await auditsOf(B, c('im'));
    // At 45d648c8: [] — the failed attempt had already filled them, so the retry changed nothing.
    expect(rows.map((r: any) => ({ action: r.action, actor: r.actor }))).toEqual([{ action: 'updated', actor: OWNER }]);
    expect(rows[0].before).toMatchObject({ lastName: null, phone: null });
    expect(rows[0].after).toMatchObject({ lastName: 'Imported' });
  });

  it("RED-BEFORE: bizFailMany's whole trail is bizOkMany's: every row is a retried write's, each audited once", async () => {
    await settle();
    const failTrail = await manyTraces(B);
    const okTrail = await manyTraces(ID.bizOkMany);
    expect({ ...failTrail, feedCopies: 0, announced: 0 }).toEqual({ ...okTrail, feedCopies: 0, announced: 0 });
    expect(failTrail).toMatchObject({ contacts: MANY.length, live: MANY.length - 3, audits: 10, mergeOps: 1, media: 1 });
  });
});

describe('a reassign decides the owner it moves a contact from, and whether the member may still see it, on the row it locks (review repair SEC-TCAC-1)', () => {
  const OWNER = { type: 'USER', id: ID.owner };
  const brief = (r: any) => ({ action: r.action, actor: r.actor, before: r.before, after: r.after, changedFields: r.changedFields, reason: r.reason });
  const eventsOf = (contactId: string) =>
    db.contactEvent.findMany({ where: { businessId: ID.bizRace, contactId }, select: { type: true, data: true }, orderBy: { createdAt: 'asc' } });
  const moveTo = `UPDATE contacts SET owner_id = $1 WHERE id = $2`;

  it('fixture sanity: bizRace has the owner, staff and the my-book member with the reassign right, its three seeded contacts, and no trace of any write yet', async () => {
    const members = await db.membership.findMany({
      where: { businessId: ID.bizRace }, select: { userId: true, role: true, permissionScopes: true }, orderBy: { userId: 'asc' },
    });
    expect(members).toEqual([
      { userId: ID.booker, role: 'STAFF', permissionScopes: { crm: 'write', crm_view: 'owned', crm_reassign: 'true' } },
      { userId: ID.owner, role: 'OWNER', permissionScopes: null },
      { userId: ID.staff, role: 'STAFF', permissionScopes: null },
    ]);
    expect(await storedContact(race('rc1'))).toMatchObject({ owner_id: ID.staff, deleted_at: null });
    expect(await storedContact(race('rv1'))).toMatchObject({ owner_id: ID.booker, deleted_at: null });
    expect(await storedContact(race('rv2'))).toMatchObject({ owner_id: ID.booker, deleted_at: null });
    expect(await traces(ID.bizRace)).toEqual({ contacts: RACE.length, live: RACE.length, contactEvents: 0, audits: 0, teamLogs: 0, feedCopies: 0, announced: 0 });
  });

  it("RED-BEFORE: an owner change committed while the owner's reassign waits on the row — the 'reassigned' row and the contact.reassigned event record the transition the reassign made, from the owner it found under its lock", async () => {
    // rc1 is staff's when the reassign is sent; the owner takes it back while the reassign is
    // parked, so the reassign really moves it from the owner to staff.
    const res = await racedBehindRowLock(race('rc1'), () => reassign(ID.bizRace, [race('rc1')], ID.staff), moveTo, ID.owner, race('rc1'));
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body).toEqual({ reassigned: 1, newOwnerId: ID.staff });
    expect(await storedContact(race('rc1'))).toMatchObject({ owner_id: ID.staff });
    // At 34ee89f2: [{ before: {}, after: {}, changedFields: [], reason: 'owner v63j_staff → v63j_staff' }]
    // — the owner was read before the transaction, so the trail lost the ownership change.
    expect((await auditsOf(ID.bizRace, race('rc1'))).map(brief)).toEqual([{
      action: 'reassigned',
      actor: OWNER,
      before: { ownerId: ID.owner },
      after: { ownerId: ID.staff },
      changedFields: ['ownerId'],
      reason: `owner ${ID.owner} → ${ID.staff}`,
    }]);
    // At 34ee89f2: fromOwnerId v63j_staff.
    expect(await eventsOf(race('rc1'))).toEqual([
      { type: 'contact.reassigned', data: { fromOwnerId: ID.owner, toOwnerId: ID.staff, actorUserId: ID.owner } },
    ]);
  });

  it("RED-BEFORE: a contact taken out of a my-book member's book while their reassign waits on the row is not moved — 403, the owner's contact keeps its owner and nothing is written", async () => {
    // rv1 is booker's when booker sends the reassign; the owner takes it while it is parked, so it
    // is no longer in booker's book (crm_view 'owned') when the reassign gets the row.
    const res = await racedBehindRowLock(race('rv1'), () => reassign(ID.bizRace, [race('rv1')], ID.staff, ID.booker), moveTo, ID.owner, race('rv1'));
    // At 34ee89f2: 201 {"reassigned":1}, rv1 moved from the owner to staff by a member who can no
    // longer open it: the visibility check was decided before the transaction.
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(403);
    expect(res.body).toMatchObject({ statusCode: 403, message: 'No eligible contacts to reassign' });
    expect(await storedContact(race('rv1'))).toMatchObject({ owner_id: ID.owner });
    expect(await auditsOf(ID.bizRace, race('rv1'))).toEqual([]);
    expect(await eventsOf(race('rv1'))).toEqual([]);
  });

  it("CONTROL: with no race, the my-book member reassigns a contact of their book — 201, one 'reassigned' row naming them, from them to staff", async () => {
    const res = await reassign(ID.bizRace, [race('rv2')], ID.staff, ID.booker);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body).toEqual({ reassigned: 1, newOwnerId: ID.staff });
    expect(await storedContact(race('rv2'))).toMatchObject({ owner_id: ID.staff });
    expect((await auditsOf(ID.bizRace, race('rv2'))).map(brief)).toEqual([{
      action: 'reassigned',
      actor: { type: 'USER', id: ID.booker },
      before: { ownerId: ID.booker },
      after: { ownerId: ID.staff },
      changedFields: ['ownerId'],
      reason: `owner ${ID.booker} → ${ID.staff}`,
    }]);
    expect(await eventsOf(race('rv2'))).toEqual([
      { type: 'contact.reassigned', data: { fromOwnerId: ID.booker, toOwnerId: ID.staff, actorUserId: ID.booker } },
    ]);
  });

  it("RED-BEFORE: bizRace's whole trail: one 'reassigned' row and one event for each contact a reassign moved, nothing for the refused one", async () => {
    await settle();
    // At 34ee89f2: { contactEvents: 3, audits: 3 } — the refused race had moved rv1 and audited it.
    const t = await traces(ID.bizRace);
    expect({ contacts: t.contacts, live: t.live, contactEvents: t.contactEvents, audits: t.audits })
      .toEqual({ contacts: RACE.length, live: RACE.length, contactEvents: 2, audits: 2 });
  });
});
