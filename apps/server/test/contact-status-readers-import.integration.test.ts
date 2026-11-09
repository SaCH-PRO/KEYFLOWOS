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
 *   - WRITER (V1-38c): an owner's CSV import stores CLIENT for a CUSTOMER cell
 *     and DORMANT for a DORMANT cell (review CR-V38c-1). The CUSTOMER row the
 *     readers below read is then given back the spelling the import wrote
 *     before V1-38c (raw SQL), as a row held from before it; the DORMANT rows
 *     are read as the import writes them today.
 *   - CR-1: people-flow puts a contact imported as 'DORMANT' in Dormant whatever
 *     its silence and leaves it out of At Risk and Stale Leads, as before
 *     V1-38b, for a contact imported now as for one imported before V1-38c
 *     (CR-V38c-1); a canonical CLIENT is segmented by silence alone, as before.
 *   - CR-2: the readers count an imported 'CUSTOMER' as a CLIENT: people-flow's
 *     High-Value Customers and the people health score's dormant customers.
 *   - V1-38c: the CSV and link imports store every status cell as a
 *     ContactStatus or the legacy dormant status: canonical values in the
 *     vocabulary's spelling, the legacy CUSTOMER as CLIENT (the readers'
 *     mapping), DORMANT in any case as DORMANT (the readers' mapping, review
 *     CR-V38c-1), and INACTIVE, an unknown or a blank cell as the LEAD
 *     default, the import's convention for a cell it does not recognise (as
 *     for age group). Those rows go to a second business, so the reader cases
 *     above count only their own.
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
 * stored the cell verbatim; a row whose stored status differs is given that
 * spelling back by SQL. A DORMANT cell is stored as DORMANT (review CR-V38c-1),
 * so the DORMANT rows are read as the import writes them today.
 */
const STORED_SINCE_V1_38C: Record<string, string> = { DORMANT: 'DORMANT', CUSTOMER: 'CLIENT', CLIENT: 'CLIENT' };

describe('WRITER (V1-38c): the CSV import no longer writes CUSTOMER and keeps DORMANT as the readers read it; rows it wrote before V1-38c still hold their spelling', () => {
  it("V1-38c (CR-V38c-1): an owner's CSV import stores CLIENT for a CUSTOMER cell, DORMANT for a DORMANT cell and CLIENT as written; the CUSTOMER row the readers below read is given back its pre-V1-38c spelling by SQL", async () => {
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
      expect(rows[0].status, `${k}: the status column ${ROWS[k].status}, as the import stores it since V1-38c`).toBe(STORED_SINCE_V1_38C[ROWS[k].status]);
      contactId[k] = rows[0].id;
    }

    // Rows the import wrote before V1-38c hold the file's spelling. The
    // readers keep reading it, so the cases below read such rows. The DORMANT
    // rows need no rewrite: the import still stores DORMANT (CR-V38c-1).
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
  it('Dormant holds both contacts imported as DORMANT, the one active 5 days ago included (CR-V38c-1: as the import writes them now, no SQL rewrite)', async () => {
    expect(contactId.dormRecent, 'the import case ran').toBeTruthy();
    expect(await segmentIds('dormant')).toEqual(idsOf('dormRecent', 'dormQuiet'));
  });

  it('At Risk leaves out the contact imported as DORMANT that has been silent 40 days, and keeps the canonical CLIENT silent as long', async () => {
    expect(await segmentIds('at-risk')).toEqual(idsOf('clientQuiet'));
  });

  it('CR-V38c-1: Stale Leads holds no contact imported as DORMANT, however long silent, as before V1-38c', async () => {
    expect(contactId.dormQuiet, 'the import case ran').toBeTruthy();
    const stale = await segmentIds('stale-leads');
    expect(stale).not.toContain(contactId.dormQuiet);
    expect(stale).not.toContain(contactId.dormRecent);
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
  { key: 'dormant', cell: 'DORMANT', stored: 'DORMANT', kind: 'dormant' },
  { key: 'dormant-lower', cell: 'dormant', stored: 'DORMANT', kind: 'dormant' },
  { key: 'dormant-mixed', cell: 'Dormant', stored: 'DORMANT', kind: 'dormant' },
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
  { key: 'dormant', cell: 'DORMANT', stored: 'DORMANT' },
  { key: 'dormant-padded', cell: ' dormant ', stored: 'DORMANT' },
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

  it('V1-38c: INACTIVE, an unknown word and a blank status cell are dropped as the import drops any cell it does not recognise, so the contact takes the LEAD default', async () => {
    await expectStored('unrecognised');
  });

  it("V1-38c (CR-V38c-1): a DORMANT cell in any case ('DORMANT', 'dormant', 'Dormant') is stored as DORMANT, the legacy status people-flow reads as imported dormant, not the LEAD default, pending an owner ruling", async () => {
    await expectStored('dormant');
  });

  it('V1-38c (CR-V38c-1): no contact the CSV import wrote holds a status outside CONTACT_STATUSES but the DORMANT cells, stored as LEGACY_DORMANT_STATUS', async () => {
    const { CONTACT_STATUSES, LEGACY_DORMANT_STATUS } = await import('../src/modules/crm/crm.constants');
    expect(LEGACY_DORMANT_STATUS).toBe('DORMANT');
    expect(fileImportId, 'the V1-38c CSV import case ran').toBeTruthy();
    const rows: Array<{ status: string }> = await db.$queryRawUnsafe(
      'SELECT c.status FROM contacts c JOIN contact_import_contacts r ON r.contact_id = c.id WHERE r.import_id = $1', fileImportId,
    );
    expect(rows).toHaveLength(V38C_FILE_ROWS.length);
    const outside = rows.map((r) => r.status).filter((s) => !(CONTACT_STATUSES as readonly string[]).includes(s));
    expect(outside, 'statuses outside the vocabulary').toEqual(
      V38C_FILE_ROWS.filter((r) => r.kind === 'dormant').map(() => LEGACY_DORMANT_STATUS),
    );
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

    it("V1-38c (CR-V38c-1): the link import stores the same: a padded ' customer ' as CLIENT, 'Prospect' as PROSPECT, LOST as written, DORMANT and a padded ' dormant ' as DORMANT, an unknown stage as the LEAD default", async () => {
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
