/**
 * P129 — FU-CONTACT-AUDIT-RESIDUAL (V1-71; owner rulings D-25 and D-207 `noteaudit`):
 * every remaining contact write records its ContactAuditEntry durably in the same
 * transaction, or rolls back completely and writes nothing (REAL Postgres database).
 *
 * Covers every residual D-25 writer family left after TOF-CONTACT-AUDIT-AWAIT:
 *  1. Notes and tasks (D-207, both HTTP routes via CrmController -> CrmTimelineService
 *     and the KEY/service wrappers CrmService.addNote / addTask):
 *       - addNote, updateNote, deleteNote
 *       - addTask, updateTask, deleteTask, completeTask, reopenTask
 *  2. Remaining CrmService contact writers:
 *       - undoContact (both branches: no-activity soft-delete & with-activity revert-to-LEAD)
 *       - revertMerge (HTTP route -> CrmService.revertMerge)
 *       - completeNextAction (HTTP route -> CrmService.completeNextAction)
 *       - snoozeNextAction (HTTP route -> CrmService.snoozeNextAction)
 *  3. System-actor & contact sync writers:
 *       - CrmService.advanceToClientOnInvoicePaid (SYSTEM actor: 'updated' + 'task_added')
 *       - GoogleContactsSyncService.sync (create + update)
 *       - OutlookContactsSyncService.sync (create + update)
 *
 * Failure injection uses the contact-audit-durable trigger pattern: a Postgres
 * BEFORE INSERT trigger on `contact_audit_entries` refuses every row for `bizFail`
 * only, installed/dropped under a short `lock_timeout` with retry, and lifted
 * mid-suite via `CREATE OR REPLACE FUNCTION` (taking no table lock) so retries
 * prove the failed attempts left nothing behind.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v71g_` prefix and is
 * hard-deleted via raw SQL (`sqlLikePrefix(P)`) in beforeAll and afterAll.
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

const P = 'v71g_';
const ID = {
  owner: `${P}owner`,
  bizOk: `${P}bizOk`,
  bizFail: `${P}bizFail`,
};

const REFUSE = `${P}refuse_audit`;
const REFUSAL = `${P}injected audit write failure`;

type ContactKey =
  | 'main'
  | 'undoDel'
  | 'undoLead'
  | 'mergePri'
  | 'mergeDup'
  | 'nextComp'
  | 'nextSnooze'
  | 'paidLead'
  | 'syncGUpd'
  | 'syncOUpd';

const cid = (biz: string, key: ContactKey) => `${biz}_${key}`;
const nid = (biz: string, key: string) => `${biz}_note_${key}`;
const tid = (biz: string, key: string) => `${biz}_task_${key}`;
const mid = (biz: string) => `${biz}_merge_op`;
const invId = (biz: string) => `${biz}_inv_paid`;

let db: any;
let app: any;
let crm: any;
let googleSync: any;
let outlookSync: any;
let asyncWrites: ReturnType<typeof trackAsyncWrites> | undefined;
let ipSeq = 1;

const feedCopies: Array<{ businessId: string; action: string; entityId?: string }> = [];
const announced: Array<{ name: string; businessId: string }> = [];

let peopleConnections: Array<Record<string, unknown>> = [];
let graphContacts: Array<Record<string, unknown>> = [];

const fetchStub = vi.fn(async (url: string) => {
  const target = String(url);
  const body = target.startsWith('https://people.googleapis.com/')
    ? { connections: peopleConnections }
    : target.startsWith('https://graph.microsoft.com/')
      ? { value: graphContacts }
      : null;
  if (!body) throw new Error(`unexpected outbound request: ${target}`);
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
});

function nextIp() {
  ipSeq += 1;
  return `10.71.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
}

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
       WHEN (NEW.business_id = '${ID.bizFail}') EXECUTE FUNCTION ${REFUSE}()`,
  );
}

async function liftRefusal() {
  await setRefusal(false);
}

async function dropRefusal() {
  await auditTableDdl(`DROP TRIGGER IF EXISTS ${REFUSE} ON contact_audit_entries`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${REFUSE}()`);
}

async function cleanup() {
  try { await dropRefusal(); } catch { /* best-effort */ }
  for (const sql of [
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM task_assignments WHERE task_id IN (SELECT id FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_external_mappings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_sync_audits WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM connector_statuses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

async function settle() {
  if (!asyncWrites) throw new Error('settle(): async-write tracker not installed');
  await asyncWrites.drain();
}

async function count(sql: string, ...params: unknown[]): Promise<number> {
  const [{ n }] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${sql}`, ...params);
  return n;
}

async function storedContact(id: string): Promise<Record<string, unknown> | null> {
  const rows = await db.$queryRawUnsafe(`SELECT to_jsonb(c) - 'search_vector' AS row FROM contacts c WHERE c.id = $1`, id);
  return rows[0]?.row ?? null;
}

async function storedNote(id: string): Promise<Record<string, unknown> | null> {
  const rows = await db.$queryRawUnsafe(`SELECT to_jsonb(n) AS row FROM contact_notes n WHERE n.id = $1`, id);
  return rows[0]?.row ?? null;
}

async function storedTask(id: string): Promise<Record<string, unknown> | null> {
  const rows = await db.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM contact_tasks t WHERE t.id = $1`, id);
  return rows[0]?.row ?? null;
}

async function storedMergeOp(id: string): Promise<Record<string, unknown> | null> {
  const rows = await db.$queryRawUnsafe(`SELECT to_jsonb(m) AS row FROM merge_operations m WHERE m.id = $1`, id);
  return rows[0]?.row ?? null;
}

function auditsOf(businessId: string, contactId: string) {
  return db.contactAuditEntry.findMany({ where: { businessId, contactId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

function expectGeneric500(body: Record<string, unknown>) {
  expect(body).toMatchObject({ statusCode: 500, message: 'Internal server error' });
  expect(JSON.stringify(body)).not.toContain(REFUSAL);
}

async function traces(businessId: string) {
  await settle();
  return {
    contacts: await count('contacts WHERE business_id = $1', businessId),
    liveContacts: await count('contacts WHERE business_id = $1 AND deleted_at IS NULL', businessId),
    notes: await count('contact_notes WHERE business_id = $1', businessId),
    tasks: await count('contact_tasks WHERE business_id = $1', businessId),
    assignments: await count(
      'task_assignments WHERE task_id IN (SELECT id FROM contact_tasks WHERE business_id = $1)',
      businessId,
    ),
    events: await count('contact_events WHERE business_id = $1', businessId),
    audits: await count('contact_audit_entries WHERE business_id = $1', businessId),
    mappings: await count('contact_external_mappings WHERE business_id = $1', businessId),
    syncAudits: await count('contact_sync_audits WHERE business_id = $1', businessId),
    feedCopies: feedCopies.filter((f) => f.businessId === businessId).length,
    announced: announced.filter((a) => a.businessId === businessId).length,
  };
}

function reqPost(url: string, body: Record<string, unknown> = {}) {
  return request(app.getHttpServer())
    .post(url)
    .set('x-test-user', ID.owner)
    .set('x-forwarded-for', nextIp())
    .send(body);
}

function reqPatch(url: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(url)
    .set('x-test-user', ID.owner)
    .set('x-forwarded-for', nextIp())
    .send(body);
}

function reqDelete(url: string) {
  return request(app.getHttpServer())
    .delete(url)
    .set('x-test-user', ID.owner)
    .set('x-forwarded-for', nextIp());
}

async function seedBusiness(biz: string) {
  await db.business.create({ data: { id: biz, name: `V71G ${biz.slice(P.length)}`, ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${biz}_m_owner`, userId: ID.owner, businessId: biz, role: 'OWNER' } });
  // Outlook sync checks the binder on connectorStatus.metadata.boundBy
  await db.connectorStatus.create({
    data: { businessId: biz, connectorType: 'outlook_contacts', status: 'connected', metadata: { boundBy: ID.owner } },
  });

  const nextAt = new Date('2027-01-15T10:00:00.000Z');
  await db.contact.create({ data: { id: cid(biz, 'main'), businessId: biz, firstName: 'Main', lastName: `${P}seed`, ownerId: ID.owner } });
  await db.contact.create({ data: { id: cid(biz, 'undoDel'), businessId: biz, firstName: 'UndoDel', lastName: `${P}seed`, status: 'LEAD' } });
  await db.contact.create({ data: { id: cid(biz, 'undoLead'), businessId: biz, firstName: 'UndoLead', lastName: `${P}seed`, status: 'CLIENT' } });
  // Give undoLead one existing task so undoContact takes the revert-to-LEAD branch
  await db.contactTask.create({
    data: { id: tid(biz, 'undoActivity'), businessId: biz, contactId: cid(biz, 'undoLead'), title: 'Existing activity', status: 'OPEN' },
  });

  // Merge pair: primary live, duplicate soft-deleted + mergedIntoId = primary, with one repointed note
  const priEmail = `${P}${biz.slice(P.length).toLowerCase()}_pri@test.local`;
  await db.contact.create({ data: { id: cid(biz, 'mergePri'), businessId: biz, firstName: 'Pri', lastName: `${P}seed`, email: priEmail, emailNormalized: priEmail } });
  const dupEmail = `${P}${biz.slice(P.length).toLowerCase()}_dup@test.local`;
  const dup = await db.contact.create({
    data: {
      id: cid(biz, 'mergeDup'),
      businessId: biz,
      firstName: 'Dup',
      lastName: `${P}seed`,
      email: dupEmail,
      emailNormalized: dupEmail,
      deletedAt: new Date('2026-11-26T00:00:00.000Z'),
      mergedIntoId: cid(biz, 'mergePri'),
    },
  });
  await db.contactNote.create({
    data: { id: nid(biz, 'repointed'), businessId: biz, contactId: cid(biz, 'mergePri'), body: 'Repointed from duplicate', source: 'crm' },
  });
  await db.mergeOperation.create({
    data: {
      id: mid(biz),
      businessId: biz,
      primaryId: cid(biz, 'mergePri'),
      duplicateId: cid(biz, 'mergeDup'),
      duplicateSnapshot: {
        id: dup.id,
        firstName: 'Dup',
        lastName: `${P}seed`,
        email: dupEmail,
        emailNormalized: dupEmail,
        status: 'LEAD',
      },
      fieldOverrides: {},
      resolvedFields: {},
      repointedCounts: { notes: { count: 1, ids: [nid(biz, 'repointed')] } },
      actorId: ID.owner,
      actorType: 'USER',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  // Next-action targets
  await db.contact.create({
    data: {
      id: cid(biz, 'nextComp'),
      businessId: biz,
      firstName: 'NextComp',
      lastName: `${P}seed`,
      nextActionAt: nextAt,
      nextActionType: 'CALL',
    },
  });
  await db.contact.create({
    data: {
      id: cid(biz, 'nextSnooze'),
      businessId: biz,
      firstName: 'NextSnooze',
      lastName: `${P}seed`,
      nextActionAt: nextAt,
      nextActionType: 'EMAIL',
    },
  });

  // Paid-invoice lifecycle target
  await db.contact.create({
    data: {
      id: cid(biz, 'paidLead'),
      businessId: biz,
      firstName: 'PaidLead',
      lastName: `${P}seed`,
      status: 'LEAD',
      ownerId: ID.owner,
    },
  });

  // Google & Outlook sync existing update targets
  const gUpdEmail = `${P}${biz.slice(P.length).toLowerCase()}_gupd@test.local`;
  await db.contact.create({
    data: {
      id: cid(biz, 'syncGUpd'),
      businessId: biz,
      firstName: 'OldGoogle',
      lastName: `${P}seed`,
      email: gUpdEmail,
      emailNormalized: gUpdEmail,
      ownerId: ID.owner,
    },
  });
  const oUpdEmail = `${P}${biz.slice(P.length).toLowerCase()}_oupd@test.local`;
  await db.contact.create({
    data: {
      id: cid(biz, 'syncOUpd'),
      businessId: biz,
      firstName: 'OldOutlook',
      lastName: `${P}seed`,
      email: oUpdEmail,
      emailNormalized: oUpdEmail,
      ownerId: ID.owner,
    },
  });

  // Seeded notes & tasks on `main` for update / delete / complete / reopen
  await db.contactNote.create({ data: { id: nid(biz, 'upd'), businessId: biz, contactId: cid(biz, 'main'), body: 'Original note', source: 'crm' } });
  await db.contactNote.create({ data: { id: nid(biz, 'del'), businessId: biz, contactId: cid(biz, 'main'), body: 'Delete me note', source: 'crm' } });
  await db.contactTask.create({ data: { id: tid(biz, 'upd'), businessId: biz, contactId: cid(biz, 'main'), title: 'Original task', priority: 'NORMAL', status: 'OPEN' } });
  await db.contactTask.create({ data: { id: tid(biz, 'del'), businessId: biz, contactId: cid(biz, 'main'), title: 'Delete me task', priority: 'NORMAL', status: 'OPEN' } });
  await db.contactTask.create({ data: { id: tid(biz, 'comp'), businessId: biz, contactId: cid(biz, 'main'), title: 'Complete me task', priority: 'NORMAL', status: 'OPEN' } });
  await db.contactTask.create({
    data: {
      id: tid(biz, 'reopen'),
      businessId: biz,
      contactId: cid(biz, 'main'),
      title: 'Reopen me task',
      priority: 'NORMAL',
      status: 'DONE',
      completedAt: new Date('2026-11-25T12:00:00.000Z'),
    },
  });
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
  const { GoogleContactsSyncService } = await import('../src/modules/connect/google-contacts-sync.service');
  const { OutlookContactsSyncService } = await import('../src/modules/connect/outlook-contacts-sync.service');

  Logger.overrideLogger(['error']);

  asyncWrites = trackAsyncWrites([
    [ContactAuditService.prototype, 'write'],
    [TeamAuditInterceptor.prototype, 'record'],
  ]);

  const events = new EventEmitter2();
  for (const name of [
    'contact.created',
    'contact.updated',
    'contact.deleted',
    'contact.merge_reverted',
    'contact.next_action_cleared',
    'contact.next_action_set',
    'contact_task.created',
    'contact_task.updated',
    'contact_task.deleted',
    'contact_task.completed',
    'contact_task.reopened',
    'crm.contact_event.logged',
  ]) {
    events.on(name, (payload: { businessId?: string }) => {
      if (payload?.businessId?.startsWith(P)) announced.push({ name, businessId: payload.businessId });
    });
  }

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
      CrmImportService,
      EntityResolutionService,
      {
        provide: GoogleContactsSyncService,
        useFactory: (prisma: unknown, crmSvc: unknown, auditSvc: unknown) =>
          new (GoogleContactsSyncService as any)(prisma, crmSvc, auditSvc),
        inject: [PrismaService, CrmService, ContactAuditService],
      },
      {
        provide: OutlookContactsSyncService,
        useFactory: (prisma: unknown, crmSvc: unknown, auditSvc: unknown) =>
          new (OutlookContactsSyncService as any)(prisma, crmSvc, auditSvc),
        inject: [PrismaService, CrmService, ContactAuditService],
      },
      { provide: AiUsageService, useValue: {} },
      { provide: EventEmitter2, useValue: events },
      {
        provide: TimelineService,
        useValue: {
          recordEvent: async (row: { businessId: string; action: string; entityId?: string }) => {
            if (row?.businessId?.startsWith(P)) {
              feedCopies.push({ businessId: row.businessId, action: row.action, entityId: row.entityId });
            }
          },
        },
      },
      { provide: EvidenceService, useValue: { checkTaskEvidence: async () => ({ hasEvidence: true }) } },
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
  googleSync = app.get(GoogleContactsSyncService);
  outlookSync = app.get(OutlookContactsSyncService);
  googleSync.tokens = { getValidAccessToken: async () => 'fake-google-token' };
  outlookSync.tokens = { getValidAccessToken: async () => 'fake-outlook-token' };
  vi.stubGlobal('fetch', fetchStub);

  await cleanup();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await seedBusiness(ID.bizOk);
  await seedBusiness(ID.bizFail);

  await installRefusal();
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await asyncWrites?.drain().catch(() => undefined);
  if (app) await app.close();
  if (db) await cleanup();
  asyncWrites?.restore();
});

describe('fixture sanity (real rows & bounded trigger)', () => {
  it('both tenants start with seeded rows and 0 audit entries; the trigger refuses bizFail only', async () => {
    expect(await count('contact_audit_entries WHERE business_id = $1', ID.bizOk)).toBe(0);
    expect(await count('contact_audit_entries WHERE business_id = $1', ID.bizFail)).toBe(0);

    await expect(
      db.contactAuditEntry.create({
        data: {
          businessId: ID.bizFail,
          contactId: cid(ID.bizFail, 'main'),
          contactHash: `${P}probe`,
          action: 'updated',
          reason: `${P}probe`,
        },
      }),
    ).rejects.toThrow(REFUSAL);
    expect(await count('contact_audit_entries WHERE business_id = $1', ID.bizFail)).toBe(0);
  });
});

describe('RED-BEFORE: with audit writes failing on bizFail, every residual writer fails and rolls back completely', () => {
  const B = ID.bizFail;

  // --- 1. Notes (HTTP + CrmService wrapper) --------------------------------
  it('addNote (HTTP POST /notes) — 500; no note, event, audit row, feed copy or announcement is written', async () => {
    const before = await traces(B);
    const res = await reqPost(`/crm/businesses/${B}/contacts/${cid(B, 'main')}/notes`, {
      body: 'Should roll back on audit failure',
      source: 'crm',
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    expectGeneric500(res.body);
    expect(await traces(B)).toEqual(before);
  });

  it('CrmService.addNote wrapper — rejects and writes no note, event or audit row', async () => {
    const before = await traces(B);
    await expect(
      crm.addNote({ businessId: B, contactId: cid(B, 'main'), body: 'Wrapper rollback note', source: 'key' }),
    ).rejects.toThrow(REFUSAL);
    expect(await traces(B)).toEqual(before);
  });

  it('updateNote (HTTP PATCH /notes/:noteId) — 500; note stays unchanged and nothing else is written', async () => {
    const beforeRow = await storedNote(nid(B, 'upd'));
    const before = await traces(B);
    const res = await reqPatch(`/crm/businesses/${B}/notes/${nid(B, 'upd')}`, { body: 'Mutated note body' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    expectGeneric500(res.body);
    expect(await storedNote(nid(B, 'upd'))).toEqual(beforeRow);
    expect(await traces(B)).toEqual(before);
  });

  it('deleteNote (HTTP DELETE /notes/:noteId) — 500; note still exists and nothing else is written', async () => {
    const beforeRow = await storedNote(nid(B, 'del'));
    const before = await traces(B);
    const res = await reqDelete(`/crm/businesses/${B}/notes/${nid(B, 'del')}`);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    expectGeneric500(res.body);
    expect(await storedNote(nid(B, 'del'))).toEqual(beforeRow);
    expect(await traces(B)).toEqual(before);
  });

  // --- 2. Tasks (HTTP + CrmService wrapper) --------------------------------
  it('addTask (HTTP POST /tasks with assignee) — 500; no task, assignment, event, audit row or announcement is written', async () => {
    const before = await traces(B);
    const res = await reqPost(`/crm/businesses/${B}/contacts/${cid(B, 'main')}/tasks`, {
      title: 'Should roll back on audit failure',
      priority: 'HIGH',
      assigneeId: ID.owner,
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    expectGeneric500(res.body);
    expect(await traces(B)).toEqual(before);
  });

  it('CrmService.addTask wrapper — rejects and writes no task, assignment, event or audit row', async () => {
    const before = await traces(B);
    await expect(
      crm.addTask({ businessId: B, contactId: cid(B, 'main'), title: 'Wrapper rollback task', assigneeId: ID.owner }),
    ).rejects.toThrow(REFUSAL);
    expect(await traces(B)).toEqual(before);
  });

  it('updateTask (HTTP PATCH /tasks/:taskId) — 500; task stays unchanged and nothing else is written', async () => {
    const beforeRow = await storedTask(tid(B, 'upd'));
    const before = await traces(B);
    const res = await reqPatch(`/crm/businesses/${B}/tasks/${tid(B, 'upd')}`, { title: 'Mutated task', priority: 'URGENT' });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    expectGeneric500(res.body);
    expect(await storedTask(tid(B, 'upd'))).toEqual(beforeRow);
    expect(await traces(B)).toEqual(before);
  });

  it('deleteTask (HTTP DELETE /tasks/:taskId) — 500; task still exists and nothing else is written', async () => {
    const beforeRow = await storedTask(tid(B, 'del'));
    const before = await traces(B);
    const res = await reqDelete(`/crm/businesses/${B}/tasks/${tid(B, 'del')}`);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    expectGeneric500(res.body);
    expect(await storedTask(tid(B, 'del'))).toEqual(beforeRow);
    expect(await traces(B)).toEqual(before);
  });

  it('completeTask (HTTP POST /tasks/:taskId/complete) — 500; task stays OPEN and nothing else is written', async () => {
    const beforeRow = await storedTask(tid(B, 'comp'));
    const before = await traces(B);
    const res = await reqPost(`/crm/businesses/${B}/tasks/${tid(B, 'comp')}/complete`, {});
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    expectGeneric500(res.body);
    expect(await storedTask(tid(B, 'comp'))).toEqual(beforeRow);
    expect(await traces(B)).toEqual(before);
  });

  it('reopenTask (HTTP POST /tasks/:taskId/reopen) — 500; task stays DONE and nothing else is written', async () => {
    const beforeRow = await storedTask(tid(B, 'reopen'));
    const before = await traces(B);
    const res = await reqPost(`/crm/businesses/${B}/tasks/${tid(B, 'reopen')}/reopen`, {});
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    expectGeneric500(res.body);
    expect(await storedTask(tid(B, 'reopen'))).toEqual(beforeRow);
    expect(await traces(B)).toEqual(before);
  });

  // --- 3. Remaining CrmService contact writers -----------------------------
  it('undoContact (delete branch, no activity) — rejects; contact stays live and nothing else is written', async () => {
    const beforeRow = await storedContact(cid(B, 'undoDel'));
    const before = await traces(B);
    await expect(crm.undoContact({ businessId: B, contactId: cid(B, 'undoDel') })).rejects.toThrow(REFUSAL);
    expect(await storedContact(cid(B, 'undoDel'))).toEqual(beforeRow);
    expect(await traces(B)).toEqual(before);
  });

  it('undoContact (revert-to-LEAD branch, with activity) — rejects; contact stays CLIENT and nothing else is written', async () => {
    const beforeRow = await storedContact(cid(B, 'undoLead'));
    const before = await traces(B);
    await expect(crm.undoContact({ businessId: B, contactId: cid(B, 'undoLead') })).rejects.toThrow(REFUSAL);
    expect(await storedContact(cid(B, 'undoLead'))).toEqual(beforeRow);
    expect(await traces(B)).toEqual(before);
  });

  it('revertMerge (HTTP POST /duplicates/merges/:mergeId/revert) — 500; duplicate stays soft-deleted, mergeOperation un-reverted, note stays on primary, nothing else written', async () => {
    const beforeDup = await storedContact(cid(B, 'mergeDup'));
    const beforeOp = await storedMergeOp(mid(B));
    const beforeNote = await storedNote(nid(B, 'repointed'));
    const before = await traces(B);
    const res = await reqPost(`/crm/businesses/${B}/duplicates/merges/${mid(B)}/revert`, {});
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    expectGeneric500(res.body);
    expect(await storedContact(cid(B, 'mergeDup'))).toEqual(beforeDup);
    expect(await storedMergeOp(mid(B))).toEqual(beforeOp);
    expect(await storedNote(nid(B, 'repointed'))).toEqual(beforeNote);
    expect(await traces(B)).toEqual(before);
  });

  it('completeNextAction (HTTP POST /next-action/complete) — 500; nextActionAt/Type unchanged and nothing else written', async () => {
    const beforeRow = await storedContact(cid(B, 'nextComp'));
    const before = await traces(B);
    const res = await reqPost(`/crm/businesses/${B}/contacts/${cid(B, 'nextComp')}/next-action/complete`, {});
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    expectGeneric500(res.body);
    expect(await storedContact(cid(B, 'nextComp'))).toEqual(beforeRow);
    expect(await traces(B)).toEqual(before);
  });

  it('snoozeNextAction (HTTP POST /next-action/snooze) — 500; nextActionAt unchanged and nothing else written', async () => {
    const beforeRow = await storedContact(cid(B, 'nextSnooze'));
    const before = await traces(B);
    const res = await reqPost(`/crm/businesses/${B}/contacts/${cid(B, 'nextSnooze')}/next-action/snooze`, {
      snoozeUntil: '2027-02-20T10:00:00.000Z',
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(500);
    expectGeneric500(res.body);
    expect(await storedContact(cid(B, 'nextSnooze'))).toEqual(beforeRow);
    expect(await traces(B)).toEqual(before);
  });

  // --- 4. System-actor & contact sync writers ------------------------------
  it('advanceToClientOnInvoicePaid — rejects; contact stays LEAD, no follow-up task, assignment, event, audit or announcement', async () => {
    const beforeRow = await storedContact(cid(B, 'paidLead'));
    const before = await traces(B);
    await expect(
      crm.advanceToClientOnInvoicePaid({
        businessId: B,
        contactId: cid(B, 'paidLead'),
        invoiceId: invId(B),
        invoiceNumber: 'INV-FAIL-001',
      }),
    ).rejects.toThrow(REFUSAL);
    expect(await storedContact(cid(B, 'paidLead'))).toEqual(beforeRow);
    expect(await traces(B)).toEqual(before);
  });

  it('GoogleContactsSyncService.sync (update) — rejects; existing contact unchanged, no mapping or audit row', async () => {
    const beforeRow = await storedContact(cid(B, 'syncGUpd'));
    const before = await traces(B);
    peopleConnections = [
      {
        resourceName: `people/${P}fail_upd`,
        names: [{ givenName: 'NewGoogle' }],
        emailAddresses: [{ value: `${B.toLowerCase()}_gupd@test.local` }],
      },
    ];
    await expect(googleSync.sync(B)).rejects.toThrow(REFUSAL);
    expect(await storedContact(cid(B, 'syncGUpd'))).toEqual(beforeRow);
    expect(await traces(B)).toEqual(before);
  });

  it('GoogleContactsSyncService.sync (create) — rejects; new contact not created, no mapping or audit row', async () => {
    const before = await traces(B);
    peopleConnections = [
      {
        resourceName: `people/${P}fail_new`,
        names: [{ givenName: 'CreatedGoogle' }],
        emailAddresses: [{ value: `${B.toLowerCase()}_gnew@test.local` }],
      },
    ];
    await expect(googleSync.sync(B)).rejects.toThrow(REFUSAL);
    expect(await traces(B)).toEqual(before);
  });

  it('OutlookContactsSyncService.sync (update) — rejects; existing contact unchanged, no mapping, syncAudit or audit row', async () => {
    const beforeRow = await storedContact(cid(B, 'syncOUpd'));
    const before = await traces(B);
    graphContacts = [
      {
        id: `${P}ofail_upd`,
        givenName: 'NewOutlook',
        emailAddresses: [{ address: `${B.toLowerCase()}_oupd@test.local` }],
        lastModifiedDateTime: '2030-01-01T00:00:00.000Z',
      },
    ];
    await expect(outlookSync.sync(B)).rejects.toThrow(REFUSAL);
    expect(await storedContact(cid(B, 'syncOUpd'))).toEqual(beforeRow);
    expect(await traces(B)).toEqual(before);
  });

  it('OutlookContactsSyncService.sync (create) — rejects; new contact not created, no mapping, syncAudit or audit row', async () => {
    const before = await traces(B);
    graphContacts = [
      {
        id: `${P}ofail_new`,
        givenName: 'CreatedOutlook',
        emailAddresses: [{ address: `${B.toLowerCase()}_onew@test.local` }],
      },
    ];
    await expect(outlookSync.sync(B)).rejects.toThrow(REFUSAL);
    expect(await traces(B)).toEqual(before);
  });
});

describe('happy path on bizOk: every residual writer commits its durable ContactAuditEntry immediately with the write', () => {
  const B = ID.bizOk;
  const OWNER = { type: 'USER', id: ID.owner };

  it('notes: addNote (HTTP + CrmService wrapper), updateNote, deleteNote each commit their audit entry immediately', async () => {
    // HTTP addNote
    const added = await reqPost(`/crm/businesses/${B}/contacts/${cid(B, 'main')}/notes`, {
      body: 'Hello durable note',
      source: 'crm',
    });
    expect(added.status, JSON.stringify(added.body).slice(0, 300)).toBe(201);
    const addRows = (await auditsOf(B, cid(B, 'main'))).filter((r: any) => r.entityId === added.body.id);
    expect(addRows).toHaveLength(1);
    expect(addRows[0]).toMatchObject({
      action: 'note_added',
      entityType: 'note',
      entityId: added.body.id,
      actor: OWNER,
      after: { body: 'Hello durable note', source: 'crm' },
    });

    // CrmService.addNote wrapper (no audit ctx, no authorId -> SYSTEM actor)
    const wrapped = await crm.addNote({
      businessId: B,
      contactId: cid(B, 'main'),
      body: 'System wrapper note',
      source: 'key',
    });
    const wrapRows = (await auditsOf(B, cid(B, 'main'))).filter((r: any) => r.entityId === wrapped.id);
    expect(wrapRows).toHaveLength(1);
    expect(wrapRows[0]).toMatchObject({
      action: 'note_added',
      entityType: 'note',
      entityId: wrapped.id,
      actor: { type: 'SYSTEM' },
      after: { body: 'System wrapper note', source: 'key' },
    });

    // HTTP updateNote
    const upd = await reqPatch(`/crm/businesses/${B}/notes/${nid(B, 'upd')}`, { body: 'Edited note body' });
    expect(upd.status, JSON.stringify(upd.body).slice(0, 300)).toBe(200);
    const updRows = (await auditsOf(B, cid(B, 'main'))).filter((r: any) => r.entityId === nid(B, 'upd'));
    expect(updRows).toHaveLength(1);
    expect(updRows[0]).toMatchObject({
      action: 'note_updated',
      entityType: 'note',
      entityId: nid(B, 'upd'),
      actor: OWNER,
      before: { body: 'Original note' },
      after: { body: 'Edited note body' },
    });

    // HTTP deleteNote
    const delRes = await reqDelete(`/crm/businesses/${B}/notes/${nid(B, 'del')}`);
    expect(delRes.status, JSON.stringify(delRes.body).slice(0, 300)).toBe(200);
    const delRows = (await auditsOf(B, cid(B, 'main'))).filter((r: any) => r.entityId === nid(B, 'del'));
    expect(delRows).toHaveLength(1);
    expect(delRows[0]).toMatchObject({
      action: 'note_deleted',
      entityType: 'note',
      entityId: nid(B, 'del'),
      actor: OWNER,
      before: { body: 'Delete me note', source: 'crm' },
    });
  });

  it('tasks: addTask (HTTP + CrmService wrapper), updateTask, completeTask, reopenTask, deleteTask each commit their audit entry immediately', async () => {
    // HTTP addTask
    const added = await reqPost(`/crm/businesses/${B}/contacts/${cid(B, 'main')}/tasks`, {
      title: 'Follow up durably',
      priority: 'HIGH',
      assigneeId: ID.owner,
    });
    expect(added.status, JSON.stringify(added.body).slice(0, 300)).toBe(201);
    const addRows = (await auditsOf(B, cid(B, 'main'))).filter((r: any) => r.entityId === added.body.id);
    expect(addRows).toHaveLength(1);
    expect(addRows[0]).toMatchObject({
      action: 'task_added',
      entityType: 'task',
      entityId: added.body.id,
      actor: OWNER,
    });
    expect(addRows[0].after).toMatchObject({ title: 'Follow up durably', priority: 'HIGH', assigneeId: ID.owner });

    // CrmService.addTask wrapper (no audit ctx, no creatorId -> SYSTEM actor)
    const wrapped = await crm.addTask({
      businessId: B,
      contactId: cid(B, 'main'),
      title: 'System wrapper task',
      priority: 'NORMAL',
    });
    const wrapRows = (await auditsOf(B, cid(B, 'main'))).filter((r: any) => r.entityId === wrapped.id);
    expect(wrapRows).toHaveLength(1);
    expect(wrapRows[0]).toMatchObject({
      action: 'task_added',
      entityType: 'task',
      entityId: wrapped.id,
      actor: { type: 'SYSTEM' },
    });

    // HTTP updateTask
    const upd = await reqPatch(`/crm/businesses/${B}/tasks/${tid(B, 'upd')}`, { title: 'Updated task title', priority: 'URGENT' });
    expect(upd.status, JSON.stringify(upd.body).slice(0, 300)).toBe(200);
    const updRows = (await auditsOf(B, cid(B, 'main'))).filter((r: any) => r.entityId === tid(B, 'upd'));
    expect(updRows).toHaveLength(1);
    expect(updRows[0]).toMatchObject({
      action: 'task_updated',
      entityType: 'task',
      entityId: tid(B, 'upd'),
      actor: OWNER,
      before: { title: 'Original task', priority: 'NORMAL' },
      after: { title: 'Updated task title', priority: 'URGENT' },
    });

    // HTTP completeTask
    const comp = await reqPost(`/crm/businesses/${B}/tasks/${tid(B, 'comp')}/complete`, {});
    expect(comp.status, JSON.stringify(comp.body).slice(0, 300)).toBe(201);
    const compRows = (await auditsOf(B, cid(B, 'main'))).filter((r: any) => r.entityId === tid(B, 'comp'));
    expect(compRows).toHaveLength(1);
    expect(compRows[0]).toMatchObject({
      action: 'task_completed',
      entityType: 'task',
      entityId: tid(B, 'comp'),
      actor: OWNER,
      before: { status: 'OPEN' },
      after: { status: 'DONE' },
    });

    // HTTP reopenTask
    const reopen = await reqPost(`/crm/businesses/${B}/tasks/${tid(B, 'reopen')}/reopen`, {});
    expect(reopen.status, JSON.stringify(reopen.body).slice(0, 300)).toBe(201);
    const reopenRows = (await auditsOf(B, cid(B, 'main'))).filter((r: any) => r.entityId === tid(B, 'reopen'));
    expect(reopenRows).toHaveLength(1);
    expect(reopenRows[0]).toMatchObject({
      action: 'task_updated',
      entityType: 'task',
      entityId: tid(B, 'reopen'),
      actor: OWNER,
      before: { status: 'DONE' },
      after: { status: 'OPEN' },
    });

    // HTTP deleteTask
    const delRes = await reqDelete(`/crm/businesses/${B}/tasks/${tid(B, 'del')}`);
    expect(delRes.status, JSON.stringify(delRes.body).slice(0, 300)).toBe(200);
    const delRows = (await auditsOf(B, cid(B, 'main'))).filter((r: any) => r.entityId === tid(B, 'del'));
    expect(delRows).toHaveLength(1);
    expect(delRows[0]).toMatchObject({
      action: 'task_deleted',
      entityType: 'task',
      entityId: tid(B, 'del'),
      actor: OWNER,
    });
    expect(delRows[0].before).toMatchObject({ title: 'Delete me task' });
  });

  it('undoContact (both branches): delete branch records deleted (SYSTEM) and revert branch records updated (USER)', async () => {
    const delRes = await crm.undoContact({ businessId: B, contactId: cid(B, 'undoDel') });
    expect(delRes).toEqual({ id: cid(B, 'undoDel'), status: 'deleted' });
    const delAudits = await auditsOf(B, cid(B, 'undoDel'));
    expect(delAudits).toHaveLength(1);
    expect(delAudits[0]).toMatchObject({
      action: 'deleted',
      actor: { type: 'SYSTEM' },
      before: { deletedAt: null },
    });
    expect(typeof delAudits[0].after.deletedAt).toBe('string');

    const revRes = await crm.undoContact({ businessId: B, contactId: cid(B, 'undoLead'), actorId: ID.owner });
    expect(revRes).toEqual({ id: cid(B, 'undoLead'), status: 'reverted_to_lead' });
    const revAudits = await auditsOf(B, cid(B, 'undoLead'));
    expect(revAudits).toHaveLength(1);
    expect(revAudits[0]).toMatchObject({
      action: 'updated',
      actor: OWNER,
      before: { status: 'CLIENT' },
      after: { status: 'LEAD' },
    });
  });

  it('revertMerge (HTTP): restores duplicate, repoints note, and writes restored audit rows for both duplicate and primary', async () => {
    const res = await reqPost(`/crm/businesses/${B}/duplicates/merges/${mid(B)}/revert`, {});
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(await storedContact(cid(B, 'mergeDup'))).toMatchObject({ deleted_at: null, merged_into_id: null });
    expect(await storedNote(nid(B, 'repointed'))).toMatchObject({ contact_id: cid(B, 'mergeDup') });

    const dupAudits = await auditsOf(B, cid(B, 'mergeDup'));
    const priAudits = await auditsOf(B, cid(B, 'mergePri'));
    expect(dupAudits).toHaveLength(1);
    expect(dupAudits[0]).toMatchObject({ action: 'restored', entityId: mid(B), actor: OWNER });
    expect(priAudits).toHaveLength(1);
    expect(priAudits[0]).toMatchObject({ action: 'restored', entityId: mid(B), actor: OWNER });
  });

  it('completeNextAction & snoozeNextAction (HTTP): each commits an updated audit row naming the owner', async () => {
    const comp = await reqPost(`/crm/businesses/${B}/contacts/${cid(B, 'nextComp')}/next-action/complete`, {});
    expect(comp.status, JSON.stringify(comp.body).slice(0, 300)).toBe(201);
    const compAudits = await auditsOf(B, cid(B, 'nextComp'));
    expect(compAudits).toHaveLength(1);
    expect(compAudits[0]).toMatchObject({
      action: 'updated',
      actor: OWNER,
      after: { nextActionAt: null, nextActionType: null },
      reason: 'next_action.completed',
    });
    expect(compAudits[0].before).toMatchObject({ nextActionType: 'CALL' });

    const targetIso = '2027-02-20T10:00:00.000Z';
    const snooze = await reqPost(`/crm/businesses/${B}/contacts/${cid(B, 'nextSnooze')}/next-action/snooze`, {
      snoozeUntil: targetIso,
    });
    expect(snooze.status, JSON.stringify(snooze.body).slice(0, 300)).toBe(201);
    const snoozeAudits = await auditsOf(B, cid(B, 'nextSnooze'));
    expect(snoozeAudits).toHaveLength(1);
    expect(snoozeAudits[0]).toMatchObject({
      action: 'updated',
      actor: OWNER,
      after: { nextActionAt: targetIso },
      reason: 'next_action.snoozed',
    });
  });

  it('advanceToClientOnInvoicePaid: commits updated (invoice) and task_added (task) audit rows with SYSTEM actor', async () => {
    const moved = await crm.advanceToClientOnInvoicePaid({
      businessId: B,
      contactId: cid(B, 'paidLead'),
      invoiceId: invId(B),
      invoiceNumber: 'INV-OK-001',
    });
    expect(moved).toMatchObject({ id: cid(B, 'paidLead'), status: 'CLIENT' });
    const rows = await auditsOf(B, cid(B, 'paidLead'));
    expect(rows.map((r: any) => r.action)).toEqual(['updated', 'task_added']);
    expect(rows[0]).toMatchObject({
      action: 'updated',
      entityType: 'invoice',
      entityId: invId(B),
      actor: { type: 'SYSTEM', label: 'lifecycle-automation' },
      before: { status: 'LEAD' },
      after: { status: 'CLIENT' },
    });
    expect(rows[1]).toMatchObject({
      action: 'task_added',
      entityType: 'task',
      actor: { type: 'SYSTEM', label: 'lifecycle-automation' },
    });
  });

  it('GoogleContactsSyncService.sync & OutlookContactsSyncService.sync: create and update commit durable audit entries', async () => {
    peopleConnections = [
      {
        resourceName: `people/${P}ok_upd`,
        names: [{ givenName: 'NewGoogleOk' }],
        emailAddresses: [{ value: `${B.toLowerCase()}_gupd@test.local` }],
      },
      {
        resourceName: `people/${P}ok_new`,
        names: [{ givenName: 'FreshGoogleOk' }],
        emailAddresses: [{ value: `${B.toLowerCase()}_gnew@test.local` }],
      },
    ];
    const gOut = await googleSync.sync(B);
    expect(gOut).toMatchObject({ imported: 1, updated: 1 });
    const gUpdAudits = await auditsOf(B, cid(B, 'syncGUpd'));
    expect(gUpdAudits).toHaveLength(1);
    expect(gUpdAudits[0]).toMatchObject({ action: 'updated', reason: 'google_contacts sync', actor: OWNER });
    const gNew = await db.contact.findFirst({ where: { businessId: B, emailNormalized: `${B.toLowerCase()}_gnew@test.local` } });
    expect(gNew).toBeTruthy();
    const gNewAudits = await auditsOf(B, gNew.id);
    expect(gNewAudits).toHaveLength(1);
    expect(gNewAudits[0]).toMatchObject({ action: 'created', reason: 'google_contacts sync', actor: OWNER });

    graphContacts = [
      {
        id: `${P}ook_upd`,
        givenName: 'NewOutlookOk',
        emailAddresses: [{ address: `${B.toLowerCase()}_oupd@test.local` }],
        lastModifiedDateTime: '2030-01-01T00:00:00.000Z',
      },
      {
        id: `${P}ook_new`,
        givenName: 'FreshOutlookOk',
        emailAddresses: [{ address: `${B.toLowerCase()}_onew@test.local` }],
      },
    ];
    const oOut = await outlookSync.sync(B);
    expect(oOut).toMatchObject({ imported: 1, updated: 1 });
    const oUpdAudits = await auditsOf(B, cid(B, 'syncOUpd'));
    expect(oUpdAudits).toHaveLength(1);
    expect(oUpdAudits[0]).toMatchObject({ action: 'updated', reason: 'outlook_contacts sync', actor: OWNER });
    const oNew = await db.contact.findFirst({ where: { businessId: B, emailNormalized: `${B.toLowerCase()}_onew@test.local` } });
    expect(oNew).toBeTruthy();
    const oNewAudits = await auditsOf(B, oNew.id);
    expect(oNewAudits).toHaveLength(1);
    expect(oNewAudits[0]).toMatchObject({ action: 'created', reason: 'outlook_contacts sync', actor: OWNER });
  });
});

describe('after lifting refusal on bizFail: every previously failed write succeeds once and writes its exact audit row', () => {
  const B = ID.bizFail;

  it('lifts the refusal trigger function without locking the table', async () => {
    await liftRefusal();
  });

  it('retried note, task, undoContact, revertMerge, nextAction, advanceToClient and sync writes all succeed once and audit once', async () => {
    const noteRes = await reqPost(`/crm/businesses/${B}/contacts/${cid(B, 'main')}/notes`, { body: 'Retried note', source: 'crm' });
    expect(noteRes.status).toBe(201);
    expect((await auditsOf(B, cid(B, 'main'))).filter((r: any) => r.entityId === noteRes.body.id)).toHaveLength(1);

    const taskRes = await reqPost(`/crm/businesses/${B}/contacts/${cid(B, 'main')}/tasks`, { title: 'Retried task', assigneeId: ID.owner });
    expect(taskRes.status).toBe(201);
    expect((await auditsOf(B, cid(B, 'main'))).filter((r: any) => r.entityId === taskRes.body.id)).toHaveLength(1);

    const undoRes = await crm.undoContact({ businessId: B, contactId: cid(B, 'undoDel') });
    expect(undoRes).toEqual({ id: cid(B, 'undoDel'), status: 'deleted' });
    expect(await auditsOf(B, cid(B, 'undoDel'))).toHaveLength(1);

    const revRes = await reqPost(`/crm/businesses/${B}/duplicates/merges/${mid(B)}/revert`, {});
    expect(revRes.status).toBe(201);
    expect(await auditsOf(B, cid(B, 'mergeDup'))).toHaveLength(1);
    expect(await auditsOf(B, cid(B, 'mergePri'))).toHaveLength(1);

    const compNext = await reqPost(`/crm/businesses/${B}/contacts/${cid(B, 'nextComp')}/next-action/complete`, {});
    expect(compNext.status).toBe(201);
    expect(await auditsOf(B, cid(B, 'nextComp'))).toHaveLength(1);

    const snoozeNext = await reqPost(`/crm/businesses/${B}/contacts/${cid(B, 'nextSnooze')}/next-action/snooze`, {
      snoozeUntil: '2027-02-20T10:00:00.000Z',
    });
    expect(snoozeNext.status).toBe(201);
    expect(await auditsOf(B, cid(B, 'nextSnooze'))).toHaveLength(1);

    const moved = await crm.advanceToClientOnInvoicePaid({
      businessId: B,
      contactId: cid(B, 'paidLead'),
      invoiceId: invId(B),
      invoiceNumber: 'INV-RETRY-001',
    });
    expect(moved).toMatchObject({ id: cid(B, 'paidLead'), status: 'CLIENT' });
    expect((await auditsOf(B, cid(B, 'paidLead'))).map((r: any) => r.action)).toEqual(['updated', 'task_added']);

    peopleConnections = [
      {
        resourceName: `people/${P}retry_upd`,
        names: [{ givenName: 'NewGoogleRetry' }],
        emailAddresses: [{ value: `${B.toLowerCase()}_gupd@test.local` }],
      },
      {
        resourceName: `people/${P}retry_new`,
        names: [{ givenName: 'FreshGoogleRetry' }],
        emailAddresses: [{ value: `${B.toLowerCase()}_gnew@test.local` }],
      },
    ];
    expect(await googleSync.sync(B)).toMatchObject({ imported: 1, updated: 1 });
    expect(await auditsOf(B, cid(B, 'syncGUpd'))).toHaveLength(1);

    graphContacts = [
      {
        id: `${P}oretry_upd`,
        givenName: 'NewOutlookRetry',
        emailAddresses: [{ address: `${B.toLowerCase()}_oupd@test.local` }],
        lastModifiedDateTime: '2030-01-01T00:00:00.000Z',
      },
      {
        id: `${P}oretry_new`,
        givenName: 'FreshOutlookRetry',
        emailAddresses: [{ address: `${B.toLowerCase()}_onew@test.local` }],
      },
    ];
    expect(await outlookSync.sync(B)).toMatchObject({ imported: 1, updated: 1 });
    expect(await auditsOf(B, cid(B, 'syncOUpd'))).toHaveLength(1);
  });
});
