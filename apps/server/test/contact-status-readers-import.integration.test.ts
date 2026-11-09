/**
 * V1-38b-STATUS-READERS review repairs: the Contact.status dialects are still
 * WRITTEN, and the status readers keep reading them, against a REAL database.
 *
 * V1-38 gave Contact.status one vocabulary (LEAD | PROSPECT | CLIENT | LOST,
 * crm.constants.ts) and V1-38b moved four readers onto CLIENT, keeping a legacy
 * 'CUSTOMER' row counted as CLIENT. The V1-38b review found two premises false:
 *   - CR-1: V1-38b dropped people-flow's Contact.status 'DORMANT' checks (the
 *     Dormant segment, and At Risk leaving those contacts out) as matching no
 *     row any writer produces. The CSV/link import does produce it.
 *   - CR-2: the readers called a 'CUSTOMER' row one "written before V1-38". The
 *     same import still writes it.
 * The writer: POST /crm/businesses/:businessId/import/file maps a status,
 * stage or pipeline_stage column to 'status' (crm-import.service.ts), copies
 * the cell verbatim (buildContactInput), and CrmService.findOrCreateContact ->
 * createContact writes it (status: input.status ?? 'LEAD').
 *
 * What this suite proves, on rows the real import route wrote:
 *   - WRITER (characterization): an owner's CSV import stores the file's status
 *     column verbatim, so 'DORMANT' and 'CUSTOMER' rows exist after V1-38.
 *   - CR-1: people-flow puts a contact imported as 'DORMANT' in Dormant whatever
 *     its silence and leaves it out of At Risk, as before V1-38b; a canonical
 *     CLIENT is segmented by silence alone, as before.
 *   - CR-2: the readers count an imported 'CUSTOMER' as a CLIENT: people-flow's
 *     High-Value Customers and the people health score's dormant customers.
 *
 * Nothing on the HTTP or persistence path of the import is mocked:
 * PrismaService, the rows, CrmRateLimitGuard, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, the global ValidationPipe and GlobalHttpExceptionFilter,
 * multer (FileInterceptor), CrmController, CrmImportService, CrmService,
 * EntityResolutionService, CrmStatsService, CrmTimelineService and
 * ContactAuditService are real against DATABASE_URL. The stand-ins are the
 * harness of contacts-import-write-scope.integration.test.ts: identity
 * attachment (a test middleware reads `x-test-user` and attaches the seeded
 * user row as AuthMiddleware would), the timeline service's side channels, the
 * caches, the plan limit and the vision model (never called here). The readers
 * (RelationshipHealthService, HealthScoreService) run on the real client.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v86e_` prefix (rows
 * created through the API are deleted by their business id) and is
 * hard-deleted by raw SQL in beforeAll and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v86e_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA
  bizA: `${P}bizA`,
};

/** The imported rows: one per case, keyed by a short name. */
const ROWS = {
  dormRecent: { first: `${P}DormRecent`, email: `${P}dorm-recent@test.local`, status: 'DORMANT', silentDays: 5 },
  dormQuiet: { first: `${P}DormQuiet`, email: `${P}dorm-quiet@test.local`, status: 'DORMANT', silentDays: 40 },
  cust: { first: `${P}Cust`, email: `${P}cust@test.local`, status: 'CUSTOMER', silentDays: 3 },
  client: { first: `${P}Client`, email: `${P}client@test.local`, status: 'CLIENT', silentDays: 3 },
  clientQuiet: { first: `${P}ClientQuiet`, email: `${P}client-quiet@test.local`, status: 'CLIENT', silentDays: 40 },
} as const;
type RowKey = keyof typeof ROWS;

const DAY = 86_400_000;

let db: any;
let app: any;
/** contact id per imported row, filled by the import case. */
const contactId: Partial<Record<RowKey, string>> = {};

/** A fresh client address per request: each gets its own rate-limit bucket. */
let ipN = 0;
const nextIp = () => `10.86.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension). Rows created
  // through the API carry generated ids, so they go by business id.
  for (const sql of [
    `DELETE FROM contact_import_contacts WHERE import_id IN (SELECT id FROM contact_imports WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM contact_imports WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_media WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function csvFile(actor: string, content: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/import/file`)
    .query({ type: 'csv' })
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .attach('file', Buffer.from(content, 'utf8'), { filename: `${P}contacts.csv`, contentType: 'text/csv' });
}

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
      // The importer and the matcher findOrCreateContact consults are real.
      CrmImportService,
      EntityResolutionService,
      { provide: AiUsageService, useValue: { trackVision: vi.fn(async () => { throw new Error('no vision call in this suite'); }) } },
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: TimelineService, useValue: { recordEvent: async () => undefined } },
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
  // As app-bootstrap.ts: the client address comes from the proxy header.
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  // Identity attachment only, for seeded v86e_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // Same filter and pipe as app-bootstrap.ts, so status codes are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V86E Biz A', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

/** The contact ids of one people-flow segment, sorted; [] when the segment is empty. */
async function segmentIds(segmentId: string): Promise<string[]> {
  const { RelationshipHealthService } = await import('../src/modules/people-flow/relationship-health.service');
  const segments = await new RelationshipHealthService({ client: db } as any).listSegments(ID.bizA);
  return (segments.find((s: any) => s.id === segmentId)?.contacts.map((c: any) => c.id) ?? []).sort();
}

const idsOf = (...keys: RowKey[]) => keys.map((k) => contactId[k]!).sort();

describe('WRITER: the CSV import still writes a file status column into Contact.status verbatim', () => {
  it("an owner's CSV import with a status column stores DORMANT, CUSTOMER and CLIENT exactly as written (so the dialects are not only rows from before V1-38)", async () => {
    const keys = Object.keys(ROWS) as RowKey[];
    const content = ['first_name,email,status', ...keys.map((k) => `${ROWS[k].first},${ROWS[k].email},${ROWS[k].status}`)].join('\n');
    const res = await csvFile(ID.owner, content);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'COMPLETED', totalRows: keys.length, processedRows: keys.length });

    for (const k of keys) {
      const rows: Array<{ id: string; status: string }> = await db.$queryRawUnsafe(
        'SELECT id, status FROM contacts WHERE business_id = $1 AND email_normalized = $2 AND deleted_at IS NULL', ID.bizA, ROWS[k].email,
      );
      expect(rows, `${k}: one live contact`).toHaveLength(1);
      expect(rows[0].status, `${k}: the status column, verbatim`).toBe(ROWS[k].status);
      contactId[k] = rows[0].id;
    }

    // Silence per row, and every customer row untouched for 90 days (the
    // people health score's dormant-customer test reads updated_at).
    for (const k of keys) {
      await db.$executeRawUnsafe(
        `UPDATE contacts SET last_interaction_at = $2, updated_at = $3 WHERE id = $1`,
        contactId[k], new Date(Date.now() - ROWS[k].silentDays * DAY), new Date(Date.now() - 90 * DAY),
      );
    }
  });
});

describe('CR-1: people-flow segments read an imported DORMANT status as before V1-38b', () => {
  it('Dormant holds both contacts imported as DORMANT, the one active 5 days ago included', async () => {
    expect(contactId.dormRecent, 'the import case ran').toBeTruthy();
    expect(await segmentIds('dormant')).toEqual(idsOf('dormRecent', 'dormQuiet'));
  });

  it('At Risk leaves out the contact imported as DORMANT that has been silent 40 days, and keeps the canonical CLIENT silent as long', async () => {
    expect(await segmentIds('at-risk')).toEqual(idsOf('clientQuiet'));
  });
});

describe("CR-2: the readers count an imported 'CUSTOMER' as a CLIENT", () => {
  it('people-flow High-Value Customers holds the imported CUSTOMER and the CLIENT, both active 3 days ago', async () => {
    expect(await segmentIds('high-value')).toEqual(idsOf('cust', 'client'));
  });

  it('the people health score counts the imported CUSTOMER and both CLIENT rows untouched for 60+ days as dormant customers', async () => {
    const { HealthScoreService } = await import('../src/modules/intelligence/health-score.service');
    const people = await (new HealthScoreService({ client: db } as any) as any).calculatePeopleHealth(ID.bizA);
    expect(people.metrics.totalContacts).toBe(Object.keys(ROWS).length);
    expect(people.metrics.dormantCustomers).toBe(3);
  });
});
