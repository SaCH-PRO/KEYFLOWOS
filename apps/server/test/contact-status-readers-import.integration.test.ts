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
 * canonicalContactStatus), so it writes no dialect. Rows it wrote before
 * V1-38c keep theirs, and the readers keep reading them.
 *
 * What this suite proves, on rows the real import route wrote:
 *   - WRITER (V1-38c): an owner's CSV import stores CLIENT for a CUSTOMER cell
 *     and the LEAD default for a DORMANT cell. The rows the readers below read
 *     are then given back the spelling the import wrote before V1-38c (raw
 *     SQL), as rows held from before it.
 *   - CR-1: people-flow puts a contact imported as 'DORMANT' in Dormant whatever
 *     its silence and leaves it out of At Risk, as before V1-38b; a canonical
 *     CLIENT is segmented by silence alone, as before.
 *   - CR-2: the readers count an imported 'CUSTOMER' as a CLIENT: people-flow's
 *     High-Value Customers and the people health score's dormant customers.
 *   - V1-38c: the CSV and link imports store every status cell as a
 *     ContactStatus: canonical values in the vocabulary's spelling, the legacy
 *     CUSTOMER as CLIENT (the readers' mapping), and DORMANT, INACTIVE, an
 *     unknown or a blank cell as the LEAD default, the import's convention for
 *     a cell it does not recognise (as for age group). Those rows go to a
 *     second business, so the reader cases above count only their own.
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
 * V1-38c: what the import stores for each file status above. Before V1-38c it
 * stored the cell verbatim; the rows below are given that spelling back by SQL.
 */
const STORED_SINCE_V1_38C: Record<string, string> = { DORMANT: 'LEAD', CUSTOMER: 'CLIENT', CLIENT: 'CLIENT' };

describe('WRITER (V1-38c): the CSV import no longer writes a status dialect; rows it wrote before V1-38c still hold one', () => {
  it("V1-38c: an owner's CSV import stores CLIENT for a CUSTOMER cell, the LEAD default for a DORMANT cell and CLIENT as written; the rows the readers below read are given back their pre-V1-38c spelling by SQL", async () => {
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
      expect(rows[0].status, `${k}: the status column ${ROWS[k].status}, in the vocabulary`).toBe(STORED_SINCE_V1_38C[ROWS[k].status]);
      contactId[k] = rows[0].id;
    }

    // Rows the import wrote before V1-38c hold the file's spelling. The
    // readers keep reading it, so the cases below read such rows.
    for (const k of keys) {
      if (ROWS[k].status === STORED_SINCE_V1_38C[ROWS[k].status]) continue;
      await db.$executeRawUnsafe(`UPDATE contacts SET status = $2 WHERE id = $1`, contactId[k], ROWS[k].status);
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
  { key: 'dormant', cell: 'DORMANT', stored: 'LEAD', kind: 'unrecognised' },
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
  { key: 'dormant', cell: 'DORMANT', stored: 'LEAD' },
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

  it("V1-38c: an owner's CSV import of canonical, legacy, unrecognised and blank status cells completes, every row CREATED with no error", async () => {
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

  it('V1-38c: DORMANT, INACTIVE, an unknown word and a blank status cell are dropped as the import drops any cell it does not recognise, so the contact takes the LEAD default', async () => {
    await expectStored('unrecognised');
  });

  it('V1-38c: no contact the CSV import wrote holds a status outside CONTACT_STATUSES', async () => {
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

    it("V1-38c: the link import stores the same: a padded ' customer ' as CLIENT, 'Prospect' as PROSPECT, LOST as written, DORMANT and an unknown stage as the LEAD default", async () => {
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
