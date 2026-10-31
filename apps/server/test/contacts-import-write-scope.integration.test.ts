/**
 * R0-13b-CT-IMPORT-ACTOR — the contact import routes apply the importing
 * member's CRM edit scope and visibility, against a REAL database.
 *
 * Handed off by R0-13-CT-PERSISTENCE-PROOF (review findings ST-1, ST-2,
 * CR-1). R0-13 made CrmService.createContact refuse a STAFF member whose
 * crm_edit is 'none' and bound the holder a duplicate-identity 409 may name to
 * the actor's visibility, but both checks run only when the caller passes the
 * actor, and only POST /crm/businesses/:businessId/contacts did. The import
 * routes reached createContact through CrmService.findOrCreateContact with no
 * actor:
 *   POST import/image/ocr -> CrmImportService.createContactFromOcr
 *   POST import/file      -> CrmImportService.createFileImport -> processImportRecord
 *   POST import/link      -> CrmImportService.createLinkImport
 *   POST import/scan      -> CrmImportService.scanContactImage (same path, same hole)
 * and findOrCreateContact merged an import row into whichever live contact of
 * the tenant matched its email or phone (EntityResolutionService), with no
 * edit scope or visibility, then returned that contact in the response.
 *
 * What this suite proves, each case built on the contacts-persistence harness
 * with a real CrmImportService:
 *   - NEGATIVE CONTROLS: STAFF with crm write but crm_edit none is refused 403
 *     on import/image/ocr, import/file (csv), import/link and import/scan, and
 *     nothing is written (no import job, contact, event, audit entry or media;
 *     the link is never fetched and the vision model never called).
 *   - BOUNDED 409: an import that collides with a contact the member cannot
 *     open answers 409 with existingContactId null, and names the holder only
 *     when the member can open it (the same answer POST /contacts gives).
 *   - BOUNDED MERGE: an import row that matches an existing contact merges into
 *     it only when the member may edit that contact (visible to them and inside
 *     their edit scope); otherwise the row is refused and the contact is left
 *     exactly as it was.
 *   - POSITIVE CONTROLS: an OWNER import through every route still creates and
 *     merges as before.
 *   - SYSTEM CONTEXT: findOrCreateContact called with no actor, in the shape
 *     the public booking flow uses (bookings.service.ts), is tenant-scoped
 *     only, as before; the actor is an explicit third argument.
 *
 * Nothing on the HTTP or persistence path is mocked: PrismaService, the rows,
 * CrmRateLimitGuard, AuthGuard, BusinessGuard, ModuleScopeGuard, the global
 * ValidationPipe and GlobalHttpExceptionFilter, multer (FileInterceptor),
 * CrmController, CrmImportService, CrmService, EntityResolutionService,
 * CrmStatsService, CrmTimelineService and ContactAuditService are real against
 * DATABASE_URL. The stand-ins: identity attachment (a test middleware reads
 * `x-test-user` and attaches the seeded user row as AuthMiddleware would), the
 * timeline service's side channels, the caches, the plan limit, the vision
 * model behind AiUsageService.trackVision (import/scan; no provider traffic)
 * and global fetch for two fixed import/link URLs (any other URL throws, so no
 * request leaves the process).
 *
 * The import routes are rate limited to 5 calls a minute per handler and
 * business; the cases below stay inside that budget (at most 4 per handler).
 *
 * Requires DATABASE_URL. Every seeded row carries the `k13b_` prefix (rows
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

const P = 'k13b_';
const ID = {
  // identities
  owner: `${P}owner`,             // OWNER of bizA
  staffNoEdit: `${P}staffNoEdit`, // STAFF, crm: write, crm_edit: none (passes the module guard)
  staffWrite: `${P}staffWrite`,   // STAFF, crm: write (view all, edit any)
  staffOwned: `${P}staffOwned`,   // STAFF, crm: write, crm_edit: owned (view all)
  // tenant
  bizA: `${P}bizA`,
  // contacts
  cPriv: `${P}cPriv`,                     // PRIVATE, owned by owner: no STAFF member here can open it
  cTeamAny: `${P}cTeamAny`,               // TEAM, owned by owner: staffWrite may edit it
  cTeamOwnerOnly: `${P}cTeamOwnerOnly`,   // TEAM, owned by owner: staffOwned may open it, not edit it
  cMine: `${P}cMine`,                     // TEAM, owned by staffOwned
  cPrivOwnerMerge: `${P}cPrivOwnerMerge`, // PRIVATE, owned by owner: the owner's own import merges into it
  cPrivSystem: `${P}cPrivSystem`,         // PRIVATE, owned by owner: a system-context call merges into it
};

const MAIL = {
  priv: `${P}priv@test.local`,
  teamAny: `${P}team-any@test.local`,
  teamOwnerOnly: `${P}team-owner-only@test.local`,
  mine: `${P}mine@test.local`,
  privOwnerMerge: `${P}priv-owner-merge@test.local`,
  privSystem: `${P}priv-system@test.local`,
  scan: `${P}scan@test.local`,
};

const LINK_URL_DENIED = 'https://k13b-import.example.test/denied.csv';
const LINK_URL_OWNER = 'https://k13b-import.example.test/owner.csv';

let db: any;
let app: any;
let crmService: any;

/** The vision model behind import/scan: a stand-in, so no provider is called. */
const trackVision = vi.fn(async () => ({
  content: JSON.stringify({
    firstName: `${P}Scan`, lastName: 'Card', email: MAIL.scan, phone: null, companyName: `${P}ScanCo`,
  }),
}));

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension). Rows created
  // through the API carry generated ids, so they go by business id.
  for (const sql of [
    `DELETE FROM contact_import_contacts WHERE import_id IN (SELECT id FROM contact_imports WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM contact_imports WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_media WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

// ---- requests ---------------------------------------------------------------

function ocr(actor: string, ocrText: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/import/image/ocr`)
    .set('x-test-user', actor)
    .send({ ocrText });
}

function csvFile(actor: string, content: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/import/file`)
    .query({ type: 'csv' })
    .set('x-test-user', actor)
    .attach('file', Buffer.from(content, 'utf8'), { filename: `${P}contacts.csv`, contentType: 'text/csv' });
}

function link(actor: string, url: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/import/link`)
    .set('x-test-user', actor)
    .send({ url });
}

function scan(actor: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/import/scan`)
    .set('x-test-user', actor)
    .attach('image', Buffer.from(`${P}not-really-a-jpeg`, 'utf8'), { filename: `${P}card.jpg`, contentType: 'image/jpeg' });
}

function postContact(actor: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/contacts`)
    .set('x-test-user', actor)
    .send(body);
}

function detail(actor: string, contactId: string) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${ID.bizA}/contacts/${contactId}`)
    .set('x-test-user', actor);
}

/** A CSV with the headers the importer maps to firstName, lastName, email and companyName. */
function csv(rows: Array<{ first: string; last?: string; email: string; company?: string }>): string {
  return [
    'first_name,last_name,email,company',
    ...rows.map((r) => [r.first, r.last ?? '', r.email, r.company ?? ''].join(',')),
  ].join('\n');
}

// ---- reads (raw SQL, deleted rows included) -----------------------------------

/** The whole persisted row as JSON, without the trigger-maintained tsvector column. */
async function rawContact(contactId: string): Promise<Record<string, any> | null> {
  const rows: Array<{ row: Record<string, any> }> = await db.$queryRawUnsafe(
    `SELECT to_jsonb(c) - 'search_vector' AS row FROM contacts c WHERE c.id = $1`, contactId,
  );
  return rows[0]?.row ?? null;
}

async function contactIdsWithEmail(email: string): Promise<string[]> {
  const rows: Array<{ id: string }> = await db.$queryRawUnsafe(
    'SELECT id FROM contacts WHERE business_id = $1 AND email_normalized = $2', ID.bizA, email,
  );
  return rows.map((r) => r.id);
}

/** Every durable trace an import leaves for the tenant. */
async function traceCounts() {
  const one = async (sql: string) => {
    const rows: Array<{ n: bigint | number }> = await db.$queryRawUnsafe(sql, ID.bizA);
    return Number(rows[0].n);
  };
  return {
    contacts: await one('SELECT COUNT(*)::int AS n FROM contacts WHERE business_id = $1'),
    live: await one('SELECT COUNT(*)::int AS n FROM contacts WHERE business_id = $1 AND deleted_at IS NULL'),
    contactEvents: await one('SELECT COUNT(*)::int AS n FROM contact_events WHERE business_id = $1'),
    audits: await one('SELECT COUNT(*)::int AS n FROM contact_audit_entries WHERE business_id = $1'),
    imports: await one('SELECT COUNT(*)::int AS n FROM contact_imports WHERE business_id = $1'),
    importRows: await one(
      'SELECT COUNT(*)::int AS n FROM contact_import_contacts r JOIN contact_imports i ON i.id = r.import_id WHERE i.business_id = $1',
    ),
    media: await one('SELECT COUNT(*)::int AS n FROM contact_media WHERE business_id = $1'),
  };
}

/** One contact's row plus every trace written against it. */
async function contactTraces(contactId: string) {
  const one = async (sql: string) => {
    const rows: Array<{ n: bigint | number }> = await db.$queryRawUnsafe(sql, contactId);
    return Number(rows[0].n);
  };
  return {
    row: await rawContact(contactId),
    events: await one('SELECT COUNT(*)::int AS n FROM contact_events WHERE contact_id = $1'),
    audits: await one('SELECT COUNT(*)::int AS n FROM contact_audit_entries WHERE contact_id = $1'),
    media: await one('SELECT COUNT(*)::int AS n FROM contact_media WHERE contact_id = $1'),
    importRows: await one('SELECT COUNT(*)::int AS n FROM contact_import_contacts WHERE contact_id = $1'),
  };
}

async function importRows(importId: string) {
  const rows: Array<{ status: string; contact_id: string | null; error: string | null; raw_data: any }> =
    await db.$queryRawUnsafe(
      'SELECT status, contact_id, error, raw_data FROM contact_import_contacts WHERE import_id = $1', importId,
    );
  return rows;
}

/** Let any fire-and-forget write a request might have started reach the database. */
const settle = () => new Promise((r) => setTimeout(r, 300));

/** A refused import: the status, nothing written for the tenant, and no record in the body. */
async function expectRefusedWithNothingWritten(
  send: () => Promise<{ status: number; body: any }>,
  status: number,
) {
  await settle(); // an earlier case's fire-and-forget writes land before the baseline
  const before = await traceCounts();
  const res = await send();
  expect(res.status).toBe(status);
  expect(res.body.statusCode).toBe(status);
  for (const key of ['id', 'contact', 'media', 'processedRows', 'firstName', 'email']) {
    expect(res.body).not.toHaveProperty(key);
  }
  await settle();
  expect(await traceCounts()).toEqual(before);
  return res;
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
      { provide: AiUsageService, useValue: { trackVision } },
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      // CrmTimelineService's side channels: the unified activity ledger,
      // evidence and task assignment. The ContactEvent row itself is real.
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
  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded k13b_ users. No guard is overridden.
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

  // ---- identities, tenant, memberships -----------------------------------
  for (const id of [ID.owner, ID.staffNoEdit, ID.staffWrite, ID.staffOwned]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'K13B Biz A', ownerId: ID.owner } });
  const m = async (user: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({
      data: { id: `${P}m_${user.slice(P.length)}`, userId: user, businessId: ID.bizA, role, permissionScopes: permissionScopes ?? undefined },
    });
  await m(ID.owner, 'OWNER');
  await m(ID.staffNoEdit, 'STAFF', { crm: 'write', crm_edit: 'none' });
  await m(ID.staffWrite, 'STAFF', { crm: 'write' });
  await m(ID.staffOwned, 'STAFF', { crm: 'write', crm_edit: 'owned' });

  // ---- contacts: lastName and companyName left empty, so a merge shows -----
  const c = async (id: string, email: string, visibility: string, ownerId: string) =>
    db.contact.create({
      data: { id, businessId: ID.bizA, firstName: `${P}${id.slice(P.length)}`, email, emailNormalized: email, visibility, ownerId },
    });
  await c(ID.cPriv, MAIL.priv, 'PRIVATE', ID.owner);
  await c(ID.cTeamAny, MAIL.teamAny, 'TEAM', ID.owner);
  await c(ID.cTeamOwnerOnly, MAIL.teamOwnerOnly, 'TEAM', ID.owner);
  await c(ID.cMine, MAIL.mine, 'TEAM', ID.staffOwned);
  await c(ID.cPrivOwnerMerge, MAIL.privOwnerMerge, 'PRIVATE', ID.owner);
  await c(ID.cPrivSystem, MAIL.privSystem, 'PRIVATE', ID.owner);
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it('seeded one tenant with an owner, three STAFF members and six live contacts, and no import traces', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(4);
    expect(await traceCounts()).toEqual({
      contacts: 6, live: 6, contactEvents: 0, audits: 0, imports: 0, importRows: 0, media: 0,
    });
    expect(await rawContact(ID.cPriv)).toMatchObject({ visibility: 'PRIVATE', owner_id: ID.owner, last_name: null, company_name: null });
  });
});

describe('NEGATIVE CONTROL: STAFF with crm write but crm_edit none cannot import contacts', () => {
  it('POST import/image/ocr by STAFF with crm write but crm_edit none answers 403 and writes no contact, event, audit entry or media; POST /contacts by the same member is refused alike', async () => {
    const email = `${P}ocr-denied@test.local`;
    const res = await expectRefusedWithNothingWritten(
      () => ocr(ID.staffNoEdit, `${P}Ocr Denied\n${email}`),
      403,
    );
    expect(String(res.body.message)).toMatch(/permission to create contacts/i);
    expect(await contactIdsWithEmail(email)).toEqual([]);

    // Parity with the create route the same member is already refused on.
    const direct = await expectRefusedWithNothingWritten(
      () => postContact(ID.staffNoEdit, { firstName: `${P}Direct`, email: `${P}direct-denied@test.local` }),
      403,
    );
    expect(String(direct.body.message)).toBe(String(res.body.message));
  });

  it('POST import/file (csv) by STAFF with crm write but crm_edit none answers 403 and creates no import job, import row, contact, event or audit entry', async () => {
    const rows = [
      { first: `${P}FileDeniedA`, email: `${P}file-denied-a@test.local` },
      { first: `${P}FileDeniedB`, email: `${P}file-denied-b@test.local` },
    ];
    const res = await expectRefusedWithNothingWritten(() => csvFile(ID.staffNoEdit, csv(rows)), 403);
    expect(String(res.body.message)).toMatch(/permission to create contacts/i);
    for (const r of rows) expect(await contactIdsWithEmail(r.email)).toEqual([]);
  });

  describe('import/link (global fetch stood in for two fixed URLs)', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;
    const served: Record<string, string> = {
      [LINK_URL_DENIED]: csv([
        { first: `${P}LinkDeniedA`, email: `${P}link-denied-a@test.local` },
        { first: `${P}LinkDeniedB`, email: `${P}link-denied-b@test.local` },
      ]),
    };

    beforeAll(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
        const url = typeof input === 'string' ? input : String(input?.href ?? input?.url);
        if (url in served) return new Response(served[url], { status: 200, headers: { 'content-type': 'text/csv' } });
        throw new Error(`unexpected outbound fetch in a test: ${url}`);
      }) as any);
    });

    afterAll(() => fetchSpy.mockRestore());

    it('POST import/link by STAFF with crm write but crm_edit none answers 403 before the link is fetched, and creates no import job or contact', async () => {
      const res = await expectRefusedWithNothingWritten(() => link(ID.staffNoEdit, LINK_URL_DENIED), 403);
      expect(String(res.body.message)).toMatch(/permission to create contacts/i);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await contactIdsWithEmail(`${P}link-denied-a@test.local`)).toEqual([]);
    });
  });

  it('POST import/scan by STAFF with crm write but crm_edit none answers 403 before the vision model is called, and writes nothing', async () => {
    trackVision.mockClear();
    const res = await expectRefusedWithNothingWritten(() => scan(ID.staffNoEdit), 403);
    expect(String(res.body.message)).toMatch(/permission to create contacts/i);
    expect(trackVision).not.toHaveBeenCalled();
    expect(await contactIdsWithEmail(MAIL.scan)).toEqual([]);
  });
});

describe('a 409 from an import route names the existing holder only when the importing member can open it', () => {
  it("NEGATIVE CONTROL: STAFF (view all, edit any) importing the email of the owner's PRIVATE contact through import/image/ocr gets 409 with existingContactId null; the holder is untouched, and the same member's GET of it answers 404", async () => {
    await settle();
    const before = await contactTraces(ID.cPriv);
    const tenantBefore = await traceCounts();
    const res = await ocr(ID.staffWrite, `${P}Probe Private\n${MAIL.priv}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('contact_email_taken');
    expect(res.body.details).toEqual({ existingContactId: null });
    expect(JSON.stringify(res.body)).not.toContain(ID.cPriv);
    await settle();
    expect(await contactTraces(ID.cPriv)).toEqual(before);
    expect(await traceCounts()).toEqual(tenantBefore);
    expect(await contactIdsWithEmail(MAIL.priv)).toEqual([ID.cPriv]);

    expect((await detail(ID.staffWrite, ID.cPriv)).status).toBe(404);
  });

  it('STAFF with crm_edit owned importing the email of a TEAM contact it can open but not edit gets 409 naming that contact; the holder is untouched, and the same member\'s GET of it answers 200', async () => {
    await settle();
    const before = await contactTraces(ID.cTeamOwnerOnly);
    const tenantBefore = await traceCounts();
    const res = await ocr(ID.staffOwned, `${P}Probe Team\n${MAIL.teamOwnerOnly}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('contact_email_taken');
    expect(res.body.details).toEqual({ existingContactId: ID.cTeamOwnerOnly });
    await settle();
    expect(await contactTraces(ID.cTeamOwnerOnly)).toEqual(before);
    expect(await traceCounts()).toEqual(tenantBefore);

    expect((await detail(ID.staffOwned, ID.cTeamOwnerOnly)).status).toBe(200);
  });
});

describe('an import row that matches an existing contact merges into it only when the importing member may edit that contact', () => {
  it("NEGATIVE CONTROL: STAFF (view all, edit any) importing a CSV whose rows match a TEAM contact and the owner's PRIVATE contact: the TEAM contact is merged, the PRIVATE one is left exactly as it was and its row FAILED without naming it", async () => {
    await settle();
    const privBefore = await contactTraces(ID.cPriv);
    const res = await csvFile(ID.staffWrite, csv([
      { first: `${P}Ignored`, last: 'Merged', email: MAIL.teamAny, company: `${P}TeamCo` },
      { first: `${P}Ignored`, last: 'Leaked', email: MAIL.priv, company: `${P}PrivCo` },
    ]));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ businessId: ID.bizA, status: 'FAILED', totalRows: 2, processedRows: 1 });
    expect(JSON.stringify(res.body)).not.toContain(ID.cPriv);
    await settle();

    // Merged: the empty fields are filled, the existing name is kept.
    expect(await rawContact(ID.cTeamAny)).toMatchObject({
      first_name: `${P}cTeamAny`, last_name: 'Merged', company_name: `${P}TeamCo`, deleted_at: null,
    });
    // Not merged, and nothing written against it.
    expect(await contactTraces(ID.cPriv)).toEqual(privBefore);
    expect(await contactIdsWithEmail(MAIL.priv)).toEqual([ID.cPriv]);

    const rows = await importRows(res.body.id);
    expect(rows).toHaveLength(2);
    const merged = rows.find((r) => r.raw_data.email === MAIL.teamAny)!;
    const refused = rows.find((r) => r.raw_data.email === MAIL.priv)!;
    expect(merged).toMatchObject({ status: 'CREATED', contact_id: ID.cTeamAny });
    expect(refused).toMatchObject({ status: 'FAILED', contact_id: null });
    expect(refused.error).toMatch(/already exists/i);
    expect(refused.error).not.toContain(ID.cPriv);
  });

  it("NEGATIVE CONTROL: STAFF with crm_edit owned importing a CSV whose rows match its own contact and the owner's TEAM contact: its own contact is merged, the owner's is left exactly as it was and its row FAILED", async () => {
    await settle();
    const otherBefore = await contactTraces(ID.cTeamOwnerOnly);
    const res = await csvFile(ID.staffOwned, csv([
      { first: `${P}Ignored`, last: 'Mine', email: MAIL.mine, company: `${P}MineCo` },
      { first: `${P}Ignored`, last: 'NotMine', email: MAIL.teamOwnerOnly, company: `${P}NotMineCo` },
    ]));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'FAILED', totalRows: 2, processedRows: 1 });
    await settle();

    expect(await rawContact(ID.cMine)).toMatchObject({ last_name: 'Mine', company_name: `${P}MineCo`, owner_id: ID.staffOwned });
    expect(await contactTraces(ID.cTeamOwnerOnly)).toEqual(otherBefore);

    const rows = await importRows(res.body.id);
    expect(rows.find((r) => r.raw_data.email === MAIL.mine)).toMatchObject({ status: 'CREATED', contact_id: ID.cMine });
    expect(rows.find((r) => r.raw_data.email === MAIL.teamOwnerOnly)).toMatchObject({ status: 'FAILED', contact_id: null });
  });
});

describe('positive control: an OWNER import still works through every route', () => {
  it('POST import/image/ocr by the owner answers 201 and creates the contact, its media row and its events', async () => {
    const email = `${P}ocr-owner@test.local`;
    const res = await ocr(ID.owner, `${P}Ocr Owner\n${email}`);
    expect(res.status).toBe(201);
    expect(res.body.contact).toMatchObject({ businessId: ID.bizA, firstName: `${P}Ocr`, lastName: 'Owner', email, source: 'ocr' });
    expect(res.body.media).toMatchObject({ contactId: res.body.contact.id, type: 'business_card' });
    await settle();
    const traces = await contactTraces(res.body.contact.id);
    expect(traces).toMatchObject({ media: 1, events: 2 });
    expect(traces.row).toMatchObject({ email_normalized: email, deleted_at: null });
  });

  it('POST import/file (csv) by the owner answers 201 COMPLETED: new rows are created and a row matching a PRIVATE contact the owner may edit is merged into it', async () => {
    const res = await csvFile(ID.owner, csv([
      { first: `${P}FileOwnerA`, email: `${P}file-owner-a@test.local` },
      { first: `${P}FileOwnerB`, email: `${P}file-owner-b@test.local` },
      { first: `${P}Ignored`, last: 'OwnerMerge', email: MAIL.privOwnerMerge, company: `${P}OwnerCo` },
    ]));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'COMPLETED', totalRows: 3, processedRows: 3 });
    expect(await contactIdsWithEmail(`${P}file-owner-a@test.local`)).toHaveLength(1);
    expect(await contactIdsWithEmail(`${P}file-owner-b@test.local`)).toHaveLength(1);
    expect(await rawContact(ID.cPrivOwnerMerge)).toMatchObject({
      visibility: 'PRIVATE', last_name: 'OwnerMerge', company_name: `${P}OwnerCo`,
    });
  });

  describe('import/link (global fetch stood in for two fixed URLs)', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;
    const served: Record<string, string> = {
      [LINK_URL_OWNER]: csv([
        { first: `${P}LinkOwnerA`, email: `${P}link-owner-a@test.local` },
        { first: `${P}LinkOwnerB`, email: `${P}link-owner-b@test.local` },
      ]),
    };

    beforeAll(() => {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
        const url = typeof input === 'string' ? input : String(input?.href ?? input?.url);
        if (url in served) return new Response(served[url], { status: 200, headers: { 'content-type': 'text/csv' } });
        throw new Error(`unexpected outbound fetch in a test: ${url}`);
      }) as any);
    });

    afterAll(() => fetchSpy.mockRestore());

    it('POST import/link by the owner answers 201 COMPLETED and creates a contact per row', async () => {
      const res = await link(ID.owner, LINK_URL_OWNER);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'COMPLETED', totalRows: 2, processedRows: 2 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(await contactIdsWithEmail(`${P}link-owner-a@test.local`)).toHaveLength(1);
      expect(await contactIdsWithEmail(`${P}link-owner-b@test.local`)).toHaveLength(1);
    });
  });

  it('POST import/scan by the owner answers 201 and creates the extracted contact', async () => {
    trackVision.mockClear();
    const res = await scan(ID.owner);
    expect(res.status).toBe(201);
    expect(trackVision).toHaveBeenCalledTimes(1);
    expect(res.body.contact).toMatchObject({ businessId: ID.bizA, email: MAIL.scan, source: 'scan' });
    expect(await contactIdsWithEmail(MAIL.scan)).toEqual([res.body.contact.id]);
  });
});

describe('SYSTEM CONTEXT: findOrCreateContact takes the actor as an explicit argument; callers that pass none keep their behaviour', () => {
  it('REGRESSION CONTROL: the public booking call shape (bookings.service.ts, no actor) still merges into a PRIVATE contact by email and creates a new contact, tenant-scoped only', async () => {
    const merged = await crmService.findOrCreateContact(ID.bizA, {
      firstName: `${P}Booker`, lastName: 'Guest', email: MAIL.privSystem, phone: null,
      source: 'storefront', sourceDetail: 'public-booking',
    });
    expect(merged.id).toBe(ID.cPrivSystem);
    expect(await rawContact(ID.cPrivSystem)).toMatchObject({ visibility: 'PRIVATE', last_name: 'Guest' });

    const email = `${P}booker-new@test.local`;
    const created = await crmService.findOrCreateContact(ID.bizA, {
      firstName: `${P}NewBooker`, lastName: 'Guest', email, phone: null,
      source: 'storefront', sourceDetail: 'public-booking',
    });
    expect(created).toMatchObject({ businessId: ID.bizA, email, source: 'storefront', sourceDetail: 'public-booking' });
    expect(await contactIdsWithEmail(email)).toEqual([created.id]);
  });

  it('NEGATIVE CONTROL: findOrCreateContact(businessId, input, actor) applies that actor: crm_edit none is refused 403 with nothing written, and a PRIVATE holder the actor cannot open is neither merged nor named', async () => {
    await settle();
    const tenantBefore = await traceCounts();
    const email = `${P}service-denied@test.local`;
    await expect(
      crmService.findOrCreateContact(ID.bizA, { firstName: `${P}Svc`, email, source: 'import' }, ID.staffNoEdit),
    ).rejects.toMatchObject({ status: 403 });
    await settle();
    expect(await traceCounts()).toEqual(tenantBefore);

    const privBefore = await contactTraces(ID.cPrivSystem);
    const err = await crmService
      .findOrCreateContact(ID.bizA, { firstName: `${P}Svc`, lastName: 'Probe', email: MAIL.privSystem, source: 'import' }, ID.staffWrite)
      .then(() => null, (e: any) => e);
    expect(err).not.toBeNull();
    expect(err.status).toBe(409);
    expect(err.getResponse()).toMatchObject({ code: 'contact_email_taken', existingContactId: null });
    await settle();
    expect(await contactTraces(ID.cPrivSystem)).toEqual(privBefore);
    expect(await traceCounts()).toEqual(tenantBefore);
  });
});
