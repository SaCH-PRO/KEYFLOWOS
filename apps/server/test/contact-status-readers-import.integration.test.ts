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
 * W3-V1-38c-IMPORT-STATUS (CF-49, V1-38b residuals) fixed that writer: the
 * import now stores the status column as a ContactStatus (crm.constants.ts
 * importedContactStatus), so it writes no CUSTOMER. Its review (CR-V38c-1)
 * found that storing the LEAD default for a DORMANT cell moves a contact
 * imported as dormant out of Dormant and into Stale Leads and At Risk, a
 * segment change no owner ruling covers, so a DORMANT cell keeps the one
 * legacy dormant status people-flow reads until a ruling says otherwise. Rows
 * the import wrote before V1-38c keep their spelling, and the readers keep
 * reading them. The import is not the only writer outside the CRM DTOs (a
 * playbook's update_status action, review ST-38c-1, follow-up packet).
 *
 * What this suite proves, on rows the real import route wrote:
 *   - WRITER (V1-38c, D-92): an owner's CSV import stores CLIENT for a CUSTOMER
 *     cell and (D-92) for a DORMANT cell. The CUSTOMER and DORMANT rows the
 *     readers below read are then given back the spelling the import wrote
 *     before V1-38c and before D-92 (raw SQL), as rows held from before.
 *   - D-92 (was CR-1, which kept a contact imported as 'DORMANT' in Dormant
 *     whatever its silence and out of At Risk): people-flow reads a stored
 *     'DORMANT' as CLIENT; Dormant is the clients silent 90+ days whatever the
 *     stored spelling, At Risk and Stale Leads go by silence and status alone.
 *   - CR-2, D-92: the readers count an imported 'CUSTOMER' and a stored
 *     'DORMANT' as a CLIENT: people-flow's High-Value Customers and the people
 *     health score's dormant customers.
 *   - V1-38c, D-92: the CSV and link imports store every status cell as a
 *     ContactStatus: canonical values in the vocabulary's spelling, the legacy
 *     CUSTOMER and (D-92) DORMANT in any case as CLIENT (the readers' mapping),
 *     and INACTIVE, an unknown or a blank cell as the LEAD default, the
 *     import's convention for a cell it does not recognise (as for age group).
 *     Those rows go to a second business, so the reader cases above count
 *     only their own.
 *   - D-92 (review ST-38c-1): a playbook's update_status action stores only a
 *     ContactStatus on a real row (bizB as well).
 *   - W4-D92-DORMANT-AS-CLIENT (owner ruling D-92): an imported (or legacy)
 *     DORMANT status is stored as CLIENT, so every stored status is one of
 *     LEAD, PROSPECT, CLIENT, LOST, and "dormant" is always worked out from
 *     inactivity (the Dormant segment shows clients with no recent activity).
 *     The CSV and link imports store CLIENT for a DORMANT cell in any case, and
 *     a playbook's update_status action stores only a ContactStatus (review
 *     ST-38c-1). Rows are not migrated: a row still holding DORMANT (given back
 *     by SQL below, as a row the import wrote before D-92) reads as CLIENT in
 *     the segments and the people health score, and is in Dormant only when it
 *     has been silent 90+ days, as any client. The cases that pinned the
 *     pre-D-92 behaviour (a DORMANT contact active 5 days ago in Dormant, out
 *     of At Risk) are replaced, each naming D-92.
 *   - ST-38c-2 (V1-38c review): import/link reaches only a public address. An
 *     IP literal for a loopback, private, link-local, unspecified or metadata
 *     address (IPv6 bracketed, IPv4-mapped or NAT64 too) and a localhost name
 *     are refused with 400 before anything is fetched or an import is
 *     recorded, and a redirect is followed only to a URL that passes the same
 *     check. A DNS name that resolves to a private address is not caught yet
 *     (follow-up packet).
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
  owner: `${P}owner`, // OWNER of bizA and bizB
  bizA: `${P}bizA`,
  bizB: `${P}bizB`, // V1-38c: the import normalisation rows, kept out of bizA's reader counts
};

/**
 * The imported rows: one per case, keyed by a short name. D-92 added the rows
 * silent 90+ days (dormSilent, clientSilent, leadSilent), so Dormant is proved
 * as the clients past the threshold whatever the stored spelling.
 */
const ROWS = {
  dormRecent: { first: `${P}DormRecent`, email: `${P}dorm-recent@test.local`, status: 'DORMANT', silentDays: 5 },
  dormQuiet: { first: `${P}DormQuiet`, email: `${P}dorm-quiet@test.local`, status: 'DORMANT', silentDays: 40 },
  dormSilent: { first: `${P}DormSilent`, email: `${P}dorm-silent@test.local`, status: 'DORMANT', silentDays: 100 },
  cust: { first: `${P}Cust`, email: `${P}cust@test.local`, status: 'CUSTOMER', silentDays: 3 },
  client: { first: `${P}Client`, email: `${P}client@test.local`, status: 'CLIENT', silentDays: 3 },
  clientQuiet: { first: `${P}ClientQuiet`, email: `${P}client-quiet@test.local`, status: 'CLIENT', silentDays: 40 },
  clientSilent: { first: `${P}ClientSilent`, email: `${P}client-silent@test.local`, status: 'CLIENT', silentDays: 100 },
  leadSilent: { first: `${P}LeadSilent`, email: `${P}lead-silent@test.local`, status: 'LEAD', silentDays: 100 },
} as const;
type RowKey = keyof typeof ROWS;

const DAY = 86_400_000;

let db: any;
let app: any;
/** The real CrmService and PrismaService of the app under test (D-92: the update_status case drives them). */
let crmService: any;
let prismaService: any;
/** contact id per imported row, filled by the import case. */
const contactId: Partial<Record<RowKey, string>> = {};
/** The status the import stored per row, before any SQL rewrite. */
const storedAtImport: Partial<Record<RowKey, string>> = {};

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

function csvFile(actor: string, content: string, businessId: string = ID.bizA) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/import/file`)
    .query({ type: 'csv' })
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .attach('file', Buffer.from(content, 'utf8'), { filename: `${P}contacts.csv`, contentType: 'text/csv' });
}

function linkImport(actor: string, url: string, businessId: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/import/link`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ url });
}

/** The live contact's stored status for an email in a business, or undefined. */
async function storedStatus(businessId: string, email: string): Promise<string | undefined> {
  const rows: Array<{ status: string }> = await db.$queryRawUnsafe(
    'SELECT status FROM contacts WHERE business_id = $1 AND email_normalized = $2 AND deleted_at IS NULL', businessId, email,
  );
  expect(rows.length, `${email}: at most one live contact`).toBeLessThanOrEqual(1);
  return rows[0]?.status;
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

  crmService = moduleRef.get(CrmService);
  prismaService = moduleRef.get(PrismaService);
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
  await db.business.create({ data: { id: ID.bizB, name: 'V86E Biz B', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.owner, businessId: ID.bizB, role: 'OWNER' } });
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

/**
 * D-92: what the import stores for each file status above (V1-38c for
 * CUSTOMER). Before V1-38c it stored the cell verbatim, and before D-92 a
 * DORMANT cell as DORMANT; a row whose stored status differs from the file's
 * is given that spelling back by SQL, as a row held from before.
 */
const STORED_SINCE_D92: Record<string, string> = { DORMANT: 'CLIENT', CUSTOMER: 'CLIENT', CLIENT: 'CLIENT', LEAD: 'LEAD' };

describe('WRITER (V1-38c, D-92): the CSV import writes neither CUSTOMER nor DORMANT; rows it wrote before still hold their spelling', () => {
  // The explicit timeout: this case imports through the real route and seeds
  // the reader rows, and timed out at the 5 s default in a loaded full run.
  it("V1-38c, D-92: an owner's CSV import of DORMANT, CUSTOMER, CLIENT and LEAD cells completes, one live contact per row; the DORMANT and CUSTOMER rows the readers below read are given back their legacy spelling by SQL", async () => {
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
      storedAtImport[k] = rows[0].status;
      contactId[k] = rows[0].id;
    }

    // Rows the import wrote before V1-38c (CUSTOMER) and before D-92 (DORMANT)
    // hold the file's spelling, and rows are not migrated (D-92). The readers
    // read such rows as CLIENT, so the cases below read them.
    for (const k of keys) {
      if (ROWS[k].status === storedAtImport[k]) continue;
      await db.$executeRawUnsafe(`UPDATE contacts SET status = $2 WHERE id = $1`, contactId[k], ROWS[k].status);
    }

    // Silence per row, and every row untouched for 90 days (the people health
    // score's dormant-customer test reads updated_at).
    for (const k of keys) {
      await db.$executeRawUnsafe(
        `UPDATE contacts SET last_interaction_at = $2, updated_at = $3 WHERE id = $1`,
        contactId[k], new Date(Date.now() - ROWS[k].silentDays * DAY), new Date(Date.now() - 90 * DAY),
      );
    }
  }, 60_000);

  // D-92: replaces the V1-38c (CR-V38c-1) assertion that a DORMANT cell was stored as DORMANT.
  it('D-92: the CSV import stored CLIENT for every DORMANT cell and for the CUSTOMER cell, CLIENT and LEAD as written: no status outside the vocabulary', async () => {
    const keys = Object.keys(ROWS) as RowKey[];
    expect(Object.keys(storedAtImport).sort(), 'the import case ran').toEqual([...keys].sort());
    for (const k of keys) {
      expect(storedAtImport[k], `${k}: the status column ${ROWS[k].status}, as the import stores it since D-92`).toBe(STORED_SINCE_D92[ROWS[k].status]);
    }
  });
});

describe('D-92 (was CR-1): people-flow segments read a stored legacy DORMANT as CLIENT; dormancy comes from inactivity only', () => {
  it('D-92: Dormant holds the clients silent 90+ days whatever the stored spelling (CLIENT, legacy DORMANT), and not the LEAD silent as long', async () => {
    expect(contactId.dormSilent, 'the import case ran').toBeTruthy();
    expect(await segmentIds('dormant')).toEqual(idsOf('dormSilent', 'clientSilent'));
  });

  // D-92: before D-92 the contact stored as DORMANT and active 5 days ago was in Dormant.
  it('D-92: a contact stored as DORMANT and active 5 days ago is no longer in Dormant, nor is the one silent 40 days', async () => {
    expect(contactId.dormRecent, 'the import case ran').toBeTruthy();
    const dormant = await segmentIds('dormant');
    expect(dormant).not.toContain(contactId.dormRecent);
    expect(dormant).not.toContain(contactId.dormQuiet);
  });

  // D-92: before D-92 At Risk left out a contact stored as DORMANT.
  it('D-92: At Risk holds every contact silent 30+ days, the ones stored as DORMANT included, as a canonical CLIENT silent as long', async () => {
    expect(await segmentIds('at-risk')).toEqual(idsOf('dormQuiet', 'dormSilent', 'clientQuiet', 'clientSilent', 'leadSilent'));
  });

  it('CR-V38c-1, D-92: Stale Leads holds no contact stored as DORMANT, however long silent (it reads as CLIENT, not a lead), and holds the LEAD silent as long', async () => {
    expect(contactId.dormQuiet, 'the import case ran').toBeTruthy();
    expect(await segmentIds('stale-leads')).toEqual(idsOf('leadSilent'));
  });
});

describe("CR-2, D-92: the readers count an imported 'CUSTOMER', and a stored legacy 'DORMANT', as a CLIENT", () => {
  // D-92: before D-92 the contact stored as DORMANT and active 5 days ago was not a High-Value Customer.
  it('D-92: people-flow High-Value Customers holds the imported CUSTOMER, the CLIENT and the contact stored as DORMANT, all active in the last 30 days', async () => {
    expect(await segmentIds('high-value')).toEqual(idsOf('cust', 'client', 'dormRecent'));
  });

  // D-92: before D-92 the rows stored as DORMANT were not counted (3 dormant customers then).
  it('D-92: the people health score counts the imported CUSTOMER, the CLIENT rows and the rows stored as DORMANT, all untouched for 60+ days, as dormant customers, and not the LEAD', async () => {
    const { HealthScoreService } = await import('../src/modules/intelligence/health-score.service');
    const people = await (new HealthScoreService({ client: db } as any) as any).calculatePeopleHealth(ID.bizA);
    expect(people.metrics.totalContacts).toBe(Object.keys(ROWS).length);
    expect(people.metrics.dormantCustomers).toBe(Object.keys(ROWS).length - 1);
  });
});

/**
 * D-92 (V1-38c review ST-38c-1): a playbook's update_status action, driven
 * through the real AutomationExecutorService.executeAction and the real
 * CrmService.updateContact of the app under test, on bizB rows (out of bizA's
 * reader counts). Before D-92 it stored 'ACTIVE' by default, or the CUSTOMER
 * or DORMANT the action named.
 */
describe("D-92 (ST-38c-1): a playbook's update_status action stores only a ContactStatus on a real row", () => {
  const AUTO = [
    { id: `${P}auto_dormant`, seeded: 'LEAD', action: { type: 'UPDATE_STATUS', value: 'DORMANT' }, stored: 'CLIENT' },
    { id: `${P}auto_dormant_lower`, seeded: 'PROSPECT', action: { type: 'update_status', status: 'dormant' }, stored: 'CLIENT' },
    { id: `${P}auto_customer`, seeded: 'LEAD', action: { type: 'update_status', status: 'CUSTOMER' }, stored: 'CLIENT' },
    { id: `${P}auto_active`, seeded: 'PROSPECT', action: { type: 'update_status', status: 'ACTIVE' }, stored: 'PROSPECT' },
    { id: `${P}auto_default`, seeded: 'LEAD', action: { type: 'update_status' }, stored: 'LEAD' },
    { id: `${P}auto_lost`, seeded: 'CLIENT', action: { type: 'update_status', status: 'lost' }, stored: 'LOST' },
  ];

  it('D-92: DORMANT and CUSTOMER in any case store CLIENT, a canonical status in any case is stored in the vocabulary spelling, and ACTIVE or no status leaves the stored status as it was', async () => {
    const { AutomationExecutorService } = await import('../src/modules/flow/automation-executor.service');
    const { CONTACT_STATUSES } = await import('../src/modules/crm/crm.constants');
    for (const a of AUTO) {
      await db.contact.create({ data: { id: a.id, businessId: ID.bizB, firstName: a.id, status: a.seeded } });
    }
    // Activity and e-mail are never reached by an update_status action.
    const executor = new AutomationExecutorService(prismaService, {} as any, crmService, {} as any, null, null);
    const executeAction = (executor as any).executeAction.bind(executor) as (...args: unknown[]) => Promise<unknown>;
    for (const a of AUTO) {
      await executeAction(ID.bizB, `${P}playbook`, a.action, { contactId: a.id });
    }
    const rows: Array<{ id: string; status: string }> = await db.$queryRawUnsafe(
      `SELECT id, status FROM contacts WHERE id LIKE ${sqlLikePrefix(`${P}auto_`)}`,
    );
    const stored = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    for (const a of AUTO) {
      expect(stored[a.id], `${a.id}: ${JSON.stringify(a.action)} on a ${a.seeded}`).toBe(a.stored);
      expect(CONTACT_STATUSES as readonly string[], a.id).toContain(stored[a.id]);
    }
  }, 60_000);
});

/**
 * D-92 review CR-D92-1: two more writers outside the CRM DTOs stored a status
 * verbatim: KEY Cortex's CRM adapter (update_status, create_contact) and KEY's
 * update_status_with_confirmation (CrmService.bulkUpdateContacts). Driven here
 * through the real CrmAdapterService and the tool's real handler over the real
 * CrmService of the app under test, on bizB rows (out of bizA's reader counts).
 */
describe('D-92 (review CR-D92-1): KEY Cortex and KEY update_status_with_confirmation store only a ContactStatus on a real row', () => {
  const kcCommand = (action: string, parameters: Record<string, unknown>) => ({
    module: 'crm', action, parameters, businessId: ID.bizB, userId: ID.owner, source: 'key_cortex', timestamp: new Date(), correlationId: `${P}kc`,
  });
  async function statusesOf(likePrefix: string): Promise<Record<string, string>> {
    const rows: Array<{ id: string; first_name: string; status: string }> = await db.$queryRawUnsafe(
      `SELECT id, first_name, status FROM contacts WHERE business_id = $1 AND (id LIKE ${sqlLikePrefix(likePrefix)} OR first_name LIKE ${sqlLikePrefix(likePrefix)})`,
      ID.bizB,
    );
    return Object.fromEntries(rows.map((r) => [r.id.startsWith(likePrefix) ? r.id : r.first_name, r.status]));
  }

  it("D-92: KEY Cortex update_status stores 'dormant' and 'customer' as CLIENT and 'lost' as LOST, and refuses ACTIVE and 'churned' leaving the row as it was", async () => {
    const { CrmAdapterService } = await import('../src/modules/key-cortex/adapters/crm-adapter.service');
    const { CONTACT_STATUSES } = await import('../src/modules/crm/crm.constants');
    const CASES = [
      { id: `${P}kcs_dormant_lower`, seeded: 'LEAD', status: 'dormant', stored: 'CLIENT' },
      { id: `${P}kcs_dormant`, seeded: 'PROSPECT', status: 'DORMANT', stored: 'CLIENT' },
      { id: `${P}kcs_customer`, seeded: 'PROSPECT', status: 'customer', stored: 'CLIENT' },
      { id: `${P}kcs_lost`, seeded: 'CLIENT', status: 'lost', stored: 'LOST' },
      { id: `${P}kcs_active`, seeded: 'PROSPECT', status: 'ACTIVE', stored: 'PROSPECT', refused: true },
      { id: `${P}kcs_churned`, seeded: 'CLIENT', status: 'churned', stored: 'CLIENT', refused: true },
    ];
    for (const c of CASES) {
      await db.contact.create({ data: { id: c.id, businessId: ID.bizB, firstName: c.id, status: c.seeded } });
    }
    const adapter = new CrmAdapterService(crmService);
    for (const c of CASES) {
      const run = adapter.execute(kcCommand('update_status', { contactId: c.id, status: c.status }) as any);
      if (c.refused) await expect(run, c.id).rejects.toThrow(/not a contact status/);
      else expect((await run).success, c.id).toBe(true);
    }
    const stored = await statusesOf(`${P}kcs_`);
    for (const c of CASES) {
      expect(stored[c.id], `${c.id}: update_status '${c.status}' on a ${c.seeded}`).toBe(c.stored);
      expect(CONTACT_STATUSES as readonly string[], c.id).toContain(stored[c.id]);
    }
  }, 60_000);

  it("D-92: KEY Cortex create_contact stores LEAD when it names no status (was 'lead') and 'Dormant' as CLIENT, and creates no contact for 'partner'", async () => {
    const { CrmAdapterService } = await import('../src/modules/key-cortex/adapters/crm-adapter.service');
    const adapter = new CrmAdapterService(crmService);
    expect((await adapter.execute(kcCommand('create_contact', { firstName: `${P}kcc_default` }) as any)).success).toBe(true);
    expect((await adapter.execute(kcCommand('create_contact', { firstName: `${P}kcc_dormant`, status: 'Dormant' }) as any)).success).toBe(true);
    await expect(adapter.execute(kcCommand('create_contact', { firstName: `${P}kcc_partner`, status: 'partner' }) as any)).rejects.toThrow(/not a contact status/);
    expect(await statusesOf(`${P}kcc_`)).toEqual({ [`${P}kcc_default`]: 'LEAD', [`${P}kcc_dormant`]: 'CLIENT' });
  }, 60_000);

  it("D-92: KEY update_status_with_confirmation stores 'dormant' as CLIENT on every named contact and refuses ACTIVE leaving the rows as they were", async () => {
    const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
    const ROWS_KB = [
      { id: `${P}kcb_a`, seeded: 'LEAD' },
      { id: `${P}kcb_b`, seeded: 'PROSPECT' },
    ];
    for (const r of ROWS_KB) {
      await db.contact.create({ data: { id: r.id, businessId: ID.bizB, firstName: r.id, status: r.seeded } });
    }
    // The tool's real handler, over the real CrmService (getCrm resolves it from the module ref in the app).
    const executeToolAction = (FlowOrchestratorService.prototype as any).executeToolAction as (...args: unknown[]) => Promise<any>;
    const self = { getCrm: () => crmService };
    const ids = ROWS_KB.map((r) => r.id);
    await expect(
      executeToolAction.call(self, ID.bizB, 'update_status_with_confirmation', { entityType: 'contact', ids, newStatus: 'ACTIVE' }),
    ).rejects.toThrow(/Unsupported contact status/);
    expect(await statusesOf(`${P}kcb_`)).toEqual({ [`${P}kcb_a`]: 'LEAD', [`${P}kcb_b`]: 'PROSPECT' });
    const result = await executeToolAction.call(self, ID.bizB, 'update_status_with_confirmation', { entityType: 'contact', ids, newStatus: 'dormant' });
    expect(result).toEqual({ entityType: 'contact', updatedCount: 2, newStatus: 'CLIENT' });
    expect(await statusesOf(`${P}kcb_`)).toEqual({ [`${P}kcb_a`]: 'CLIENT', [`${P}kcb_b`]: 'CLIENT' });
  }, 120_000);
});

/**
 * V1-38c: the status cells the import is given, and the ContactStatus each must
 * be stored as. `kind` groups them by the case that asserts them.
 */
const V38C_FILE_ROWS = [
  { key: 'lead', cell: 'LEAD', stored: 'LEAD', kind: 'canonical' },
  { key: 'prospect', cell: 'PROSPECT', stored: 'PROSPECT', kind: 'canonical' },
  { key: 'client', cell: 'CLIENT', stored: 'CLIENT', kind: 'canonical' },
  { key: 'lost', cell: 'LOST', stored: 'LOST', kind: 'canonical' },
  { key: 'prospect-lower', cell: 'prospect', stored: 'PROSPECT', kind: 'spelled' },
  { key: 'client-mixed', cell: 'Client', stored: 'CLIENT', kind: 'spelled' },
  { key: 'lost-lower', cell: 'lost', stored: 'LOST', kind: 'spelled' },
  { key: 'customer', cell: 'CUSTOMER', stored: 'CLIENT', kind: 'legacy' },
  { key: 'customer-lower', cell: 'customer', stored: 'CLIENT', kind: 'legacy' },
  // D-92: a DORMANT cell is stored as CLIENT (it was the legacy DORMANT before D-92).
  { key: 'dormant', cell: 'DORMANT', stored: 'CLIENT', kind: 'dormant' },
  { key: 'dormant-lower', cell: 'dormant', stored: 'CLIENT', kind: 'dormant' },
  { key: 'dormant-mixed', cell: 'Dormant', stored: 'CLIENT', kind: 'dormant' },
  { key: 'inactive', cell: 'INACTIVE', stored: 'LEAD', kind: 'unrecognised' },
  { key: 'vip', cell: 'VIP', stored: 'LEAD', kind: 'unrecognised' },
  { key: 'stage', cell: 'Negotiation', stored: 'LEAD', kind: 'unrecognised' },
  { key: 'blank', cell: '', stored: 'LEAD', kind: 'unrecognised' },
] as const;
type V38cKind = (typeof V38C_FILE_ROWS)[number]['kind'];
const v38cEmail = (via: 'file' | 'link', key: string) => `${P}v38c-${via}-${key}@test.local`;

/** The link import does not trim cells, so a padded cell reaches the normaliser as written. */
const V38C_LINK_ROWS = [
  { key: 'customer-padded', cell: ' customer ', stored: 'CLIENT' },
  { key: 'prospect-title', cell: 'Prospect', stored: 'PROSPECT' },
  { key: 'lost', cell: 'LOST', stored: 'LOST' },
  // D-92: a DORMANT cell is stored as CLIENT.
  { key: 'dormant', cell: 'DORMANT', stored: 'CLIENT' },
  { key: 'dormant-padded', cell: ' dormant ', stored: 'CLIENT' },
  { key: 'stage', cell: 'Qualified', stored: 'LEAD' },
] as const;
const V38C_LINK_URL = 'https://v86e-import.example.test/status.csv';

describe('V1-38c (W3-V1-38c-IMPORT-STATUS, CF-49): the CSV and link imports store the status column as a ContactStatus', () => {
  let fileImportId: string | undefined;

  async function expectStored(kind: V38cKind) {
    expect(fileImportId, 'the V1-38c CSV import case ran').toBeTruthy();
    const rows = V38C_FILE_ROWS.filter((r) => r.kind === kind);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(await storedStatus(ID.bizB, v38cEmail('file', r.key)), `status cell '${r.cell}'`).toBe(r.stored);
    }
  }

  it("V1-38c: an owner's CSV import of canonical, legacy, unrecognised and blank status cells completes, every row CREATED with no error", { timeout: 60_000 }, async () => {
    const content = [
      'first_name,email,status',
      ...V38C_FILE_ROWS.map((r) => `${P}V38c ${r.key},${v38cEmail('file', r.key)},${r.cell}`),
    ].join('\n');
    const res = await csvFile(ID.owner, content, ID.bizB);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'COMPLETED', totalRows: V38C_FILE_ROWS.length, processedRows: V38C_FILE_ROWS.length });
    fileImportId = res.body.id;
    const records: Array<{ status: string; error: string | null }> = await db.$queryRawUnsafe(
      'SELECT status, error FROM contact_import_contacts WHERE import_id = $1', fileImportId,
    );
    expect(records).toHaveLength(V38C_FILE_ROWS.length);
    for (const r of records) expect(r).toEqual({ status: 'CREATED', error: null });
  });

  it('V1-38c: a canonical status cell (LEAD, PROSPECT, CLIENT, LOST) is stored as written', async () => {
    await expectStored('canonical');
  });

  it("V1-38c: a canonical status in another case ('prospect', 'Client', 'lost') is stored in the vocabulary's spelling", async () => {
    await expectStored('spelled');
  });

  it('V1-38c: the legacy CLIENT spelling CUSTOMER, in any case, is stored as CLIENT, as the status readers read it (isClientStatus)', async () => {
    await expectStored('legacy');
  });

  it('V1-38c: INACTIVE, an unknown word and a blank status cell are dropped as the import drops any cell it does not recognise, so the contact takes the LEAD default', async () => {
    await expectStored('unrecognised');
  });

  // D-92: replaces the V1-38c (CR-V38c-1) case that pinned a DORMANT cell stored as DORMANT, pending an owner ruling.
  it("D-92 (was V1-38c CR-V38c-1): a DORMANT cell in any case ('DORMANT', 'dormant', 'Dormant') is stored as CLIENT, not the legacy DORMANT and not the LEAD default", async () => {
    await expectStored('dormant');
  });

  // D-92: before D-92 the DORMANT cells were the one exception, stored as LEGACY_DORMANT_STATUS.
  it('D-92 (was V1-38c CR-V38c-1): no contact the CSV import wrote holds a status outside CONTACT_STATUSES, the DORMANT cells included', async () => {
    const { CONTACT_STATUSES } = await import('../src/modules/crm/crm.constants');
    expect(fileImportId, 'the V1-38c CSV import case ran').toBeTruthy();
    const rows: Array<{ status: string }> = await db.$queryRawUnsafe(
      'SELECT c.status FROM contacts c JOIN contact_import_contacts r ON r.contact_id = c.id WHERE r.import_id = $1', fileImportId,
    );
    expect(rows).toHaveLength(V38C_FILE_ROWS.length);
    const outside = rows.map((r) => r.status).filter((s) => !(CONTACT_STATUSES as readonly string[]).includes(s));
    expect(outside, 'statuses outside the vocabulary').toEqual([]);
  });

  describe('import/link (global fetch stood in for one fixed URL)', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;
    const served = [
      'first_name,email,status',
      ...V38C_LINK_ROWS.map((r) => `${P}V38cLink ${r.key},${v38cEmail('link', r.key)},${r.cell}`),
    ].join('\n');

    beforeAll(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
        const url = typeof input === 'string' ? input : String(input?.href ?? input?.url);
        if (url === V38C_LINK_URL) return new Response(served, { status: 200, headers: { 'content-type': 'text/csv' } });
        throw new Error(`unexpected outbound fetch in a test: ${url}`);
      }) as any);
    });

    afterAll(() => fetchSpy.mockRestore());

    // D-92: before D-92 this case pinned DORMANT and ' dormant ' stored as DORMANT.
    it("V1-38c, D-92: the link import stores the same: a padded ' customer ' as CLIENT, 'Prospect' as PROSPECT, LOST as written, DORMANT and a padded ' dormant ' as CLIENT, an unknown stage as the LEAD default", { timeout: 60_000 }, async () => {
      const res = await linkImport(ID.owner, V38C_LINK_URL, ID.bizB);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'COMPLETED', totalRows: V38C_LINK_ROWS.length, processedRows: V38C_LINK_ROWS.length });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      for (const r of V38C_LINK_ROWS) {
        expect(await storedStatus(ID.bizB, v38cEmail('link', r.key)), `status cell '${r.cell}'`).toBe(r.stored);
      }
    });
  });
});

/**
 * ST-38c-2 (V1-38c review, pre-existing): import/link fetched any http(s) URL
 * whose host was not one of five literal spellings. WHATWG URL gives an IPv6
 * host in brackets, so the fc/fd/fe80 checks never matched one; 127.0.0.0/8
 * beyond 127.0.0.1, a trailing-dot localhost and NAT64 were not listed; and
 * fetch followed a redirect without checking its target. These cases go
 * through the real route. Global fetch is stood in for fixed public URLs and
 * throws for any other, so a refused URL that reached fetch would fail as a
 * 500, not answer 400.
 */
describe('ST-38c-2 (V1-38c review): import/link fetches only a public address, and follows a redirect only to one', () => {
  const REFUSED = [
    'http://[::ffff:127.0.0.1]/contacts.csv', // IPv4-mapped loopback
    'http://[::ffff:a9fe:a9fe]/latest/meta-data/', // IPv4-mapped 169.254.169.254
    'http://[64:ff9b::a9fe:a9fe]/latest/meta-data/', // NAT64 169.254.169.254
    'http://[fd00::1]/contacts.csv', // unique local
    'http://[fe80::1]/contacts.csv', // link-local
    'http://[::1]/contacts.csv',
    'http://[::]/contacts.csv',
    'http://127.0.0.2/contacts.csv', // loopback beyond 127.0.0.1
    'http://2130706433/contacts.csv', // 127.0.0.1 as one number
    'http://100.64.0.1/contacts.csv', // shared address space
    'http://localhost./contacts.csv',
    'http://v86e.localhost/contacts.csv',
  ];
  const ORIGIN = 'https://v86e-import.example.test';
  const TO_METADATA = `${ORIGIN}/to-metadata.csv`;
  const TO_MAPPED = `${ORIGIN}/to-mapped.csv`;
  const TO_PUBLIC = `${ORIGIN}/moved.csv`;
  const REDIRECTED = `${ORIGIN}/redirected/contacts.csv`;
  const LOOP = `${ORIGIN}/loop.csv`;
  const REDIRECT_EMAIL = `${P}v38c-redirect@test.local`;
  const servedRedirected = ['first_name,email,status', `${P}V38cRedirect,${REDIRECT_EMAIL},Client`].join('\n');
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
      const url = typeof input === 'string' ? input : String(input?.href ?? input?.url);
      const redirect = (status: number, location: string) => new Response(null, { status, headers: { location } });
      if (url === TO_METADATA) return redirect(302, 'http://169.254.169.254/latest/meta-data/');
      if (url === TO_MAPPED) return redirect(307, 'http://[::ffff:7f00:1]/contacts.csv');
      if (url === TO_PUBLIC) return redirect(301, '/redirected/contacts.csv');
      if (url === REDIRECTED) return new Response(servedRedirected, { status: 200, headers: { 'content-type': 'text/csv' } });
      if (url === LOOP) return redirect(302, LOOP);
      throw new Error(`unexpected outbound fetch in a test: ${url}`);
    }) as any);
  });

  afterAll(() => fetchSpy.mockRestore());

  const fetchedUrls = () => fetchSpy.mock.calls.map((call: unknown[]) => String(call[0]));

  /** The import jobs recorded for a source URL in bizB, and how many rows each recorded. */
  async function importsOf(url: string): Promise<Array<{ status: string; records: number }>> {
    return db.$queryRawUnsafe(
      `SELECT i.status, (SELECT count(*)::int FROM contact_import_contacts r WHERE r.import_id = i.id) AS records
         FROM contact_imports i WHERE i.business_id = $1 AND i.source_url = $2`,
      ID.bizB, url,
    );
  }

  it.each(REFUSED)('ST-38c-2: %s is refused with 400 before it is fetched, and no import is recorded', async (url) => {
    fetchSpy.mockClear();
    const res = await linkImport(ID.owner, url, ID.bizB);
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await importsOf(url)).toEqual([]);
  });

  it.each([
    ['the metadata address 169.254.169.254', TO_METADATA],
    ['an IPv4-mapped loopback address', TO_MAPPED],
  ])('ST-38c-2: a redirect to %s is refused with 400, its target is never fetched, and the import is FAILED with no row', async (_target, url) => {
    fetchSpy.mockClear();
    const res = await linkImport(ID.owner, url, ID.bizB);
    expect(res.status).toBe(400);
    expect(fetchedUrls()).toEqual([url]);
    expect(await importsOf(url)).toEqual([{ status: 'FAILED', records: 0 }]);
  });

  it('ST-38c-2: a redirect to a public URL is still followed, by the import and never by fetch itself, and the file is imported', async () => {
    fetchSpy.mockClear();
    const res = await linkImport(ID.owner, TO_PUBLIC, ID.bizB);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'COMPLETED', totalRows: 1, processedRows: 1 });
    expect(fetchedUrls()).toEqual([TO_PUBLIC, REDIRECTED]);
    for (const call of fetchSpy.mock.calls as unknown[][]) {
      expect((call[1] as RequestInit | undefined)?.redirect, 'fetch must not follow a redirect unchecked').toBe('manual');
    }
    expect(await storedStatus(ID.bizB, REDIRECT_EMAIL)).toBe('CLIENT');
  });

  it('ST-38c-2: a redirect loop is refused with 400 after a bounded number of hops, and the import is FAILED', async () => {
    fetchSpy.mockClear();
    const res = await linkImport(ID.owner, LOOP, ID.bizB);
    expect(res.status).toBe(400);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(6);
    expect(await importsOf(LOOP)).toEqual([{ status: 'FAILED', records: 0 }]);
  });
});
