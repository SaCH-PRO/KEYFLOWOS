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
 * Review repairs (R0-13b-CT-IMPORT-ACTOR review):
 *   - CR-1 / ST-3 OWNED REACH: a member whose reach is limited to owned
 *     contacts (crm_edit 'owned', or crm_view 'owned') owns the contacts an
 *     import creates, so re-importing a card, a duplicate CSV or link row, or a
 *     name-only card merges into it instead of a 409 or a duplicate, and a
 *     'my book' member can open what it imported. Members who may edit every
 *     contact they see leave the owner unset, as before.
 *   - ST-2 AUDIT ACTOR: an import records the importing member as the actor, as
 *     POST /contacts does: contact.created, contact.imported and
 *     contact.imported_from_media events, the created audit entry, and an
 *     'updated' audit entry for a merge. System-context calls are unchanged.
 *   - CR-2 LINK ROWS: import/link settles each row on its own, as import/file
 *     does: a refused row is FAILED with its error, the rest of the file is
 *     imported, and the rows are linked to their contacts.
 *   - ST-4 RECORDS: GET imports/:importId/records lists a row linked to a
 *     contact only to a member who may open that contact.
 *   - ST-1 (POST google/import) was outside this packet's write set; it was
 *     kept as an it.todo hand-off at the end of the file.
 *
 * W7-GOOGLE-IMPORT-SCOPE (review finding ST-1, the it.todo hand-off made
 * live): CrmGoogleController and a real CrmGoogleService are mounted beside
 * CrmController. POST google/import needs crm write (as the CSV import does
 * since R0-13) and CrmGoogleService.importGoogleContacts takes the importing
 * member as the actor: a member who may not create contacts is refused before
 * Google is called, and every person goes through findOrCreateContact with
 * that actor (the edit and visibility door W6-CONNECT-TAG-MERGE applies to a
 * sync's existing contacts), so it is merged only into a contact the member
 * may edit and every contact write records the member. GET google/auth-url,
 * which starts the Google import the OAuth callback completes, needs crm
 * write too. The People API is global fetch stood in for one fixed URL (any
 * other URL throws, so no provider traffic leaves the process).
 *
 * W7-GOOGLE-IMPORT-SCOPE review repairs (SEC-GIS-1, SEC-GIS-2, SEC-GIS-3,
 * CR-W7G-1): the web UI imports through GET google/auth-url and then the public
 * GET crm/google/callback, not POST google/import. The signed OAuth state now
 * carries the CRM flow tag and the member it was issued to; the callback
 * refuses any other state signed with GOOGLE_STATE_SECRET (a bookings calendar
 * or Drive state, or one naming no member), accepts a state once, re-checks the
 * member when it lands, and imports as that member through the same door and
 * audit actor as POST google/import. GET google/auth-url is issued only to a
 * member the import admits (crm_edit 'none' is refused). The harness sets fake
 * GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_STATE_SECRET and
 * GOOGLE_REDIRECT_URI values for this file (restored in afterAll), and the
 * Google token endpoint is stood in beside the People API (one fixed URL each).
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
 * request leaves the process). Since W4-IMPORT-SSRF-PIN (ST-38c-2) import/link
 * resolves the link's host before it fetches; the resolver (node:dns promises
 * lookup) is stood in for the one link host, k13b-import.example.test, as a
 * public address, and throws for any other name, so no lookup leaves the
 * process either.
 *
 * The import routes are rate limited to 5 calls a minute per client IP,
 * handler and business. The app trusts the proxy header as app-bootstrap.ts
 * does, and every request carries its own x-forwarded-for address, so the real
 * guard runs on every request without capping how many cases a handler has.
 *
 * Requires DATABASE_URL. Every seeded row carries the `k13b_` prefix (rows
 * created through the API are deleted by their business id) and is
 * hard-deleted by raw SQL in beforeAll and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { promises as dnsPromises } from 'node:dns';
import { createHmac } from 'node:crypto';
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
  staffBook: `${P}staffBook`,     // STAFF, crm: write, crm_view: owned, crm_edit: owned ('my book')
  // tenant
  bizA: `${P}bizA`,
  // contacts
  cPriv: `${P}cPriv`,                     // PRIVATE, owned by owner: no STAFF member here can open it
  cTeamAny: `${P}cTeamAny`,               // TEAM, owned by owner: staffWrite may edit it
  cTeamOwnerOnly: `${P}cTeamOwnerOnly`,   // TEAM, owned by owner: staffOwned may open it, not edit it
  cMine: `${P}cMine`,                     // TEAM, owned by staffOwned
  cPrivOwnerMerge: `${P}cPrivOwnerMerge`, // PRIVATE, owned by owner: the owner's own import merges into it
  cPrivSystem: `${P}cPrivSystem`,         // PRIVATE, owned by owner: a system-context call merges into it
  cTeamAudit: `${P}cTeamAudit`,           // TEAM, owned by owner: staffWrite's import merges into it (audit actor)
  cPrivRecords: `${P}cPrivRecords`,       // PRIVATE, owned by owner: the owner's import merges into it (records listing)
};

const MAIL = {
  priv: `${P}priv@test.local`,
  teamAny: `${P}team-any@test.local`,
  teamOwnerOnly: `${P}team-owner-only@test.local`,
  mine: `${P}mine@test.local`,
  privOwnerMerge: `${P}priv-owner-merge@test.local`,
  privSystem: `${P}priv-system@test.local`,
  scan: `${P}scan@test.local`,
  teamAudit: `${P}team-audit@test.local`,
  privRecords: `${P}priv-records@test.local`,
};

const LINK_URL_DENIED = 'https://k13b-import.example.test/denied.csv';
const LINK_URL_OWNER = 'https://k13b-import.example.test/owner.csv';

/**
 * W7-GOOGLE-IMPORT-SCOPE review repairs: obviously fake Google OAuth settings,
 * so GET google/auth-url mints a real signed state and the callback verifies
 * it. CrmGoogleService reads the client settings when it is constructed, so
 * they are set before the testing module compiles and restored in afterAll.
 */
const GOOGLE_ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: 'k13b-fake-client-id',
  GOOGLE_CLIENT_SECRET: 'k13b-fake-client-secret-not-real',
  GOOGLE_STATE_SECRET: 'k13b-fake-state-secret-not-real',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/crm/google/callback',
};
const savedGoogleEnv: Record<string, string | undefined> = {};

let db: any;
let app: any;
let crmService: any;

/** A fresh client address per request: each gets its own rate-limit bucket. */
let ipN = 0;
const nextIp = () => `10.13.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`;

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
    .set('x-forwarded-for', nextIp())
    .send({ ocrText });
}

function csvFile(actor: string, content: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/import/file`)
    .query({ type: 'csv' })
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .attach('file', Buffer.from(content, 'utf8'), { filename: `${P}contacts.csv`, contentType: 'text/csv' });
}

function link(actor: string, url: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/import/link`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ url });
}

function scan(actor: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/import/scan`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .attach('image', Buffer.from(`${P}not-really-a-jpeg`, 'utf8'), { filename: `${P}card.jpg`, contentType: 'image/jpeg' });
}

function postContact(actor: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/contacts`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send(body);
}

function detail(actor: string, contactId: string) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${ID.bizA}/contacts/${contactId}`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp());
}

function records(actor: string, importId: string) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${ID.bizA}/imports/${importId}/records`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp());
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
  for (const [key, value] of Object.entries(GOOGLE_ENV)) {
    savedGoogleEnv[key] = process.env[key];
    process.env[key] = value;
  }
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
  // W7-GOOGLE-IMPORT-SCOPE: the Google contact import routes, real.
  const { CrmGoogleController } = await import('../src/modules/crm/crm-google.controller');
  const { CrmGoogleService } = await import('../src/modules/crm/crm-google.service');

  // ---- the real HTTP path (wired before any row is seeded, so a wiring
  // fault is reported as itself and not as a seeding failure) -------------
  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController, CrmGoogleController],
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
      CrmGoogleService,
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
  // As app-bootstrap.ts: the client address comes from the proxy header.
  app.getHttpAdapter().getInstance().set('trust proxy', true);
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
  for (const id of [ID.owner, ID.staffNoEdit, ID.staffWrite, ID.staffOwned, ID.staffBook]) {
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
  await m(ID.staffBook, 'STAFF', { crm: 'write', crm_view: 'owned', crm_edit: 'owned' });

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
  await c(ID.cTeamAudit, MAIL.teamAudit, 'TEAM', ID.owner);
  await c(ID.cPrivRecords, MAIL.privRecords, 'PRIVATE', ID.owner);
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  for (const [key, value] of Object.entries(savedGoogleEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// W4-IMPORT-SSRF-PIN (ST-38c-2): the link host resolves to a public address
// (the import then fetches through a dispatcher pinned to it, which the global
// fetch stand-ins below ignore); any other lookup throws.
let lookupSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  lookupSpy = vi.spyOn(dnsPromises, 'lookup').mockImplementation((async (hostname: string, options?: { all?: boolean }) => {
    if (hostname !== 'k13b-import.example.test') throw new Error(`unexpected outbound lookup in a test: ${hostname}`);
    const answer = { address: '93.184.215.14', family: 4 };
    return options?.all ? [answer] : answer;
  }) as any);
});
afterAll(() => lookupSpy?.mockRestore());

describe('fixture sanity (real rows)', () => {
  it('seeded one tenant with an owner, four STAFF members and eight live contacts, and no import traces', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(5);
    expect(await traceCounts()).toEqual({
      contacts: 8, live: 8, contactEvents: 0, audits: 0, imports: 0, importRows: 0, media: 0,
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

// ---- review repairs -----------------------------------------------------------

describe('a member whose CRM reach is limited to owned contacts owns what an import creates, so re-importing merges instead of colliding (review repair CR-1, ST-3)', () => {
  it('STAFF with crm_edit owned: import/image/ocr of the same new card twice answers 201 both times with the same contact, owned by that member', async () => {
    const email = `${P}reimport-owned@test.local`;
    const text = `${P}Re Owned\n${email}`;
    const first = await ocr(ID.staffOwned, text);
    expect(first.status).toBe(201);
    expect(first.body.contact).toMatchObject({ email, ownerId: ID.staffOwned });
    const second = await ocr(ID.staffOwned, text);
    expect(second.status).toBe(201);
    expect(second.body.contact.id).toBe(first.body.contact.id);
    expect(await contactIdsWithEmail(email)).toEqual([first.body.contact.id]);
    expect(await rawContact(first.body.contact.id)).toMatchObject({ owner_id: ID.staffOwned, visibility: 'TEAM', deleted_at: null });
  });

  it('STAFF with crm_edit owned: a CSV with two rows of the same new email answers 201 COMPLETED 2/2; one contact, owned by that member, with both rows linked to it', async () => {
    const email = `${P}twice-owned@test.local`;
    const res = await csvFile(ID.staffOwned, csv([
      { first: `${P}Twice`, email },
      { first: `${P}Twice`, last: 'Again', email, company: `${P}TwiceCo` },
    ]));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'COMPLETED', totalRows: 2, processedRows: 2 });
    const ids = await contactIdsWithEmail(email);
    expect(ids).toHaveLength(1);
    expect(await rawContact(ids[0])).toMatchObject({ owner_id: ID.staffOwned, last_name: 'Again', company_name: `${P}TwiceCo` });
    const rows = await importRows(res.body.id);
    expect(rows.map((r) => [r.status, r.contact_id])).toEqual([['CREATED', ids[0]], ['CREATED', ids[0]]]);
  });

  it("STAFF 'my book' (crm_view owned, crm_edit owned): a card it imports is owned by it, its GET of that contact answers 200, and importing the card again merges into it", async () => {
    const email = `${P}book@test.local`;
    const text = `${P}Book Import\n${email}`;
    const first = await ocr(ID.staffBook, text);
    expect(first.status).toBe(201);
    expect(first.body.contact).toMatchObject({ email, ownerId: ID.staffBook });
    expect((await detail(ID.staffBook, first.body.contact.id)).status).toBe(200);
    const second = await ocr(ID.staffBook, text);
    expect(second.status).toBe(201);
    expect(second.body.contact.id).toBe(first.body.contact.id);
    expect(await contactIdsWithEmail(email)).toEqual([first.body.contact.id]);
  });

  it('STAFF with crm_edit owned: a name-only card imported twice within five minutes resolves to one contact', async () => {
    const first = await ocr(ID.staffOwned, `${P}NameOnly Card`);
    expect(first.status).toBe(201);
    const second = await ocr(ID.staffOwned, `${P}NameOnly Card`);
    expect(second.status).toBe(201);
    expect(second.body.contact.id).toBe(first.body.contact.id);
    const rows: Array<{ id: string }> = await db.$queryRawUnsafe(
      'SELECT id FROM contacts WHERE business_id = $1 AND first_name = $2', ID.bizA, `${P}NameOnly`,
    );
    expect(rows.map((r) => r.id)).toEqual([first.body.contact.id]);
  });

  it('positive control: STAFF who may edit every contact it sees (view all, edit any) leaves an imported contact without an owner, as before, and re-importing it merges into it', async () => {
    const email = `${P}reimport-any@test.local`;
    const text = `${P}Re Any\n${email}`;
    const first = await ocr(ID.staffWrite, text);
    expect(first.status).toBe(201);
    expect(first.body.contact).toMatchObject({ email, ownerId: null });
    const second = await ocr(ID.staffWrite, text);
    expect(second.status).toBe(201);
    expect(second.body.contact.id).toBe(first.body.contact.id);
  });
});

describe('an import records the importing member as the actor, as POST /contacts does (review repair ST-2)', () => {
  const events = (contactId: string): Promise<Array<{ type: string; actor_type: string | null; actor_id: string | null }>> =>
    db.$queryRawUnsafe('SELECT type, actor_type, actor_id FROM contact_events WHERE contact_id = $1 ORDER BY created_at', contactId);
  const audits = (contactId: string): Promise<Array<{ action: string; actor: any; changed_fields: string[] }>> =>
    db.$queryRawUnsafe('SELECT action, actor, changed_fields FROM contact_audit_entries WHERE contact_id = $1 ORDER BY created_at', contactId);

  it('a contact a STAFF member creates through import/image/ocr: its contact.created and contact.imported_from_media events and its created audit entry name that member', async () => {
    const email = `${P}audit-ocr@test.local`;
    const res = await ocr(ID.staffWrite, `${P}Audit Ocr\n${email}`);
    expect(res.status).toBe(201);
    await settle();
    const id = res.body.contact.id;
    const rows = await events(id);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      { type: 'contact.created', actor_type: 'USER', actor_id: ID.staffWrite },
      { type: 'contact.imported_from_media', actor_type: 'USER', actor_id: ID.staffWrite },
    ]));
    const entries = await audits(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'created', actor: { type: 'USER', id: ID.staffWrite } });
  });

  it("a STAFF CSV row merged into the owner's TEAM contact writes an 'updated' audit entry naming the member with the fields it filled, and its contact.imported event names the member", async () => {
    await settle();
    expect(await audits(ID.cTeamAudit)).toEqual([]);
    const res = await csvFile(ID.staffWrite, csv([
      { first: `${P}Ignored`, last: 'AuditMerged', email: MAIL.teamAudit, company: `${P}AuditCo` },
    ]));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'COMPLETED', totalRows: 1, processedRows: 1 });
    await settle();
    expect(await rawContact(ID.cTeamAudit)).toMatchObject({ last_name: 'AuditMerged', company_name: `${P}AuditCo`, owner_id: ID.owner });
    const entries = await audits(ID.cTeamAudit);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'updated', actor: { type: 'USER', id: ID.staffWrite } });
    expect(entries[0].changed_fields).toEqual(expect.arrayContaining(['lastName', 'companyName']));
    expect(await events(ID.cTeamAudit)).toEqual([{ type: 'contact.imported', actor_type: 'USER', actor_id: ID.staffWrite }]);
  });

  it('regression control: findOrCreateContact with no actor (system context) attributes no member: the contact.created event has no actor, the created audit entry names SYSTEM, and a merge writes no audit entry', async () => {
    const email = `${P}system-audit@test.local`;
    const input = { firstName: `${P}SysAudit`, lastName: 'Guest', email, phone: null, source: 'storefront', sourceDetail: 'public-booking' };
    const created = await crmService.findOrCreateContact(ID.bizA, input);
    expect(created.ownerId).toBeNull();
    await settle();
    expect(await events(created.id)).toEqual([{ type: 'contact.created', actor_type: null, actor_id: null }]);
    expect(await audits(created.id)).toMatchObject([{ action: 'created', actor: { type: 'SYSTEM' } }]);

    const merged = await crmService.findOrCreateContact(ID.bizA, { ...input, companyName: `${P}SysCo` });
    expect(merged.id).toBe(created.id);
    await settle();
    expect(await rawContact(created.id)).toMatchObject({ company_name: `${P}SysCo` });
    expect(await audits(created.id)).toHaveLength(1);
  });
});

describe('import/link settles each row on its own: a refused row is FAILED and the rest of the file is imported (review repair CR-2)', () => {
  const LINK_URL_MIXED = 'https://k13b-import.example.test/mixed.csv';
  const LINK_URL_TWICE = 'https://k13b-import.example.test/twice.csv';
  const MIX_A = `${P}link-mix-a@test.local`;
  const MIX_C = `${P}link-mix-c@test.local`;
  const TWICE = `${P}link-twice@test.local`;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const served: Record<string, string> = {
    [LINK_URL_MIXED]: csv([
      { first: `${P}LinkMixA`, email: MIX_A },
      { first: `${P}LinkMixPriv`, last: 'Leaked', email: MAIL.priv, company: `${P}LeakCo` },
      { first: `${P}LinkMixC`, email: MIX_C },
    ]),
    [LINK_URL_TWICE]: csv([
      { first: `${P}LinkTwice`, email: TWICE },
      { first: `${P}LinkTwice`, last: 'Again', email: TWICE },
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

  it("NEGATIVE CONTROL: STAFF (view all, edit any) importing a link whose middle row matches the owner's PRIVATE contact: 201, the import FAILED with 2 of 3 rows processed, the other two rows created and linked, the refused row FAILED without naming the holder, and the holder untouched", async () => {
    await settle();
    const privBefore = await contactTraces(ID.cPriv);
    const res = await link(ID.staffWrite, LINK_URL_MIXED);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ businessId: ID.bizA, status: 'FAILED', totalRows: 3, processedRows: 2 });
    expect(JSON.stringify(res.body)).not.toContain(ID.cPriv);
    await settle();

    const a = await contactIdsWithEmail(MIX_A);
    const c = await contactIdsWithEmail(MIX_C);
    expect(a).toHaveLength(1);
    expect(c).toHaveLength(1);
    expect(await contactTraces(ID.cPriv)).toEqual(privBefore);
    expect(await contactIdsWithEmail(MAIL.priv)).toEqual([ID.cPriv]);

    const rows = await importRows(res.body.id);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.raw_data.email === MIX_A)).toMatchObject({ status: 'CREATED', contact_id: a[0] });
    expect(rows.find((r) => r.raw_data.email === MIX_C)).toMatchObject({ status: 'CREATED', contact_id: c[0] });
    const refused = rows.find((r) => r.raw_data.email === MAIL.priv)!;
    expect(refused).toMatchObject({ status: 'FAILED', contact_id: null });
    expect(refused.error).toMatch(/already exists/i);
    expect(refused.error).not.toContain(ID.cPriv);
  });

  it('STAFF with crm_edit owned importing a link with two rows of the same new email: 201 COMPLETED 2/2, one contact owned by that member, both rows linked to it', async () => {
    const res = await link(ID.staffOwned, LINK_URL_TWICE);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'COMPLETED', totalRows: 2, processedRows: 2 });
    const ids = await contactIdsWithEmail(TWICE);
    expect(ids).toHaveLength(1);
    expect(await rawContact(ids[0])).toMatchObject({ owner_id: ID.staffOwned, last_name: 'Again' });
    const rows = await importRows(res.body.id);
    expect(rows.map((r) => [r.status, r.contact_id])).toEqual([['CREATED', ids[0]], ['CREATED', ids[0]]]);
  });
});

describe('GET imports/:importId/records lists a row linked to a contact only to a member who may open that contact (review repair ST-4)', () => {
  it("NEGATIVE CONTROL: the owner's CSV row merged into the owner's PRIVATE contact is listed to the owner and to no STAFF member; its row linked to a new TEAM contact is listed to a view-all member and not to a 'my book' member", async () => {
    const teamEmail = `${P}records-team@test.local`;
    const imp = await csvFile(ID.owner, csv([
      { first: `${P}Ignored`, last: 'Secret', email: MAIL.privRecords, company: `${P}SecretCo` },
      { first: `${P}RecordsTeam`, email: teamEmail },
    ]));
    expect(imp.status).toBe(201);
    expect(imp.body).toMatchObject({ status: 'COMPLETED', totalRows: 2, processedRows: 2 });
    expect(await rawContact(ID.cPrivRecords)).toMatchObject({ visibility: 'PRIVATE', last_name: 'Secret' });
    const [teamId] = await contactIdsWithEmail(teamEmail);

    const byOwner = await records(ID.owner, imp.body.id);
    expect(byOwner.status).toBe(200);
    expect(byOwner.body.map((r: any) => r.contactId).sort()).toEqual([ID.cPrivRecords, teamId].sort());

    const byViewAll = await records(ID.staffWrite, imp.body.id);
    expect(byViewAll.status).toBe(200);
    expect(byViewAll.body.map((r: any) => r.contactId)).toEqual([teamId]);
    for (const leak of [ID.cPrivRecords, MAIL.privRecords, `${P}SecretCo`]) {
      expect(JSON.stringify(byViewAll.body)).not.toContain(leak);
    }

    const byBook = await records(ID.staffBook, imp.body.id);
    expect(byBook.status).toBe(200);
    expect(byBook.body).toEqual([]);
  });

  it('positive control: a member sees every row of its own import, the created row linked to its contact and the refused row (FAILED, linked to no contact)', async () => {
    const ownEmail = `${P}records-own@test.local`;
    const imp = await csvFile(ID.staffWrite, csv([
      { first: `${P}RecordsOwn`, email: ownEmail },
      { first: `${P}Ignored`, last: 'Refused', email: MAIL.priv },
    ]));
    expect(imp.status).toBe(201);
    expect(imp.body).toMatchObject({ status: 'FAILED', totalRows: 2, processedRows: 1 });
    const [ownId] = await contactIdsWithEmail(ownEmail);

    const res = await records(ID.staffWrite, imp.body.id);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.find((r: any) => r.status === 'CREATED')).toMatchObject({ contactId: ownId });
    expect(res.body.find((r: any) => r.status === 'FAILED')).toMatchObject({ contactId: null });
    expect(JSON.stringify(res.body)).not.toContain(ID.cPriv);
  });
});

// ---- W7-GOOGLE-IMPORT-SCOPE (review finding ST-1) ------------------------------

describe('W7-GOOGLE-IMPORT-SCOPE (review finding ST-1): the Google contact import needs crm write and records the importing member as the actor', () => {
  const G = {
    staffRead: `${P}staffRead`,               // STAFF, crm: read (no crm write)
    cPrivGoogle: `${P}cPrivGoogle`,           // PRIVATE, owned by owner: no STAFF member here may write it
    cTeamGoogle: `${P}cTeamGoogle`,           // TEAM, owned by owner: staffWrite may edit it
    cPrivGoogleOwner: `${P}cPrivGoogleOwner`, // PRIVATE, owned by owner: the owner's own Google import merges into it
    // W7-GOOGLE-IMPORT-SCOPE review repairs (the OAuth callback):
    staffLowered: `${P}staffLowered`,         // STAFF, crm: write; lowered after its auth URLs are issued
    cTeamCallback: `${P}cTeamCallback`,       // TEAM, owned by owner: staffWrite's callback import merges into it
  };
  const GMAIL = {
    priv: `${P}priv-google@test.local`,
    team: `${P}team-google@test.local`,
    privOwner: `${P}priv-google-owner@test.local`,
    readNew: `${P}google-read-new@test.local`,
    noEditNew: `${P}google-noedit-new@test.local`,
    staffNew: `${P}google-staff-new@test.local`,
    ownerNew: `${P}google-owner-new@test.local`,
    teamCallback: `${P}team-google-callback@test.local`,
    foreignNew: `${P}google-foreign-new@test.local`,
    callbackNew: `${P}google-callback-new@test.local`,
    replayFirst: `${P}google-replay-first@test.local`,
    replaySecond: `${P}google-replay-second@test.local`,
    loweredNew: `${P}google-lowered-new@test.local`,
    w8OwnerNew: `${P}google-w8-owner-new@test.local`,
    w8RefusedNew: `${P}google-w8-refused-new@test.local`,
  };
  // Obviously fake access tokens: the People API stand-in serves one list per token.
  const TOKEN = {
    read: 'k13b-fake-google-token-read',
    noEdit: 'k13b-fake-google-token-noedit',
    staff: 'k13b-fake-google-token-staff',
    owner: 'k13b-fake-google-token-owner',
    foreign: 'k13b-fake-google-token-foreign',
    callback: 'k13b-fake-google-token-callback',
    replayFirst: 'k13b-fake-google-token-replay-first',
    replaySecond: 'k13b-fake-google-token-replay-second',
    lowered: 'k13b-fake-google-token-lowered',
    // W8-GOOGLE-CONSENT-OWNER (D-99): the owner's consent completed through the callback.
    w8Owner: 'k13b-fake-google-token-w8-owner',
    w8Refused: 'k13b-fake-google-token-w8-refused',
  };
  // Obviously fake authorization codes: the token endpoint stand-in trades each
  // for the access token of the same name.
  const CODE = {
    foreign: 'k13b-fake-google-code-foreign',
    callback: 'k13b-fake-google-code-callback',
    replayFirst: 'k13b-fake-google-code-replay-first',
    replaySecond: 'k13b-fake-google-code-replay-second',
    lowered: 'k13b-fake-google-code-lowered',
    w8Owner: 'k13b-fake-google-code-w8-owner',
    w8Refused: 'k13b-fake-google-code-w8-refused',
  };
  const ACCESS_FOR_CODE: Record<string, string> = Object.fromEntries(
    Object.entries(CODE).map(([name, code]) => [code, (TOKEN as Record<string, string>)[name]]),
  );
  const PEOPLE_URL = 'https://people.googleapis.com/v1/people/me/connections?';
  const TOKEN_URL = 'https://oauth2.googleapis.com/token';
  const person = (ref: string, given: string, family: string, email: string, org?: string) => ({
    resourceName: `people/${ref}`,
    names: [{ givenName: given, familyName: family }],
    emailAddresses: [{ value: email }],
    ...(org ? { organizations: [{ name: org }] } : {}),
  });
  const PEOPLE: Record<string, unknown[]> = {
    [TOKEN.read]: [
      person('k13bRead1', `${P}Ignored`, 'Leaked', GMAIL.priv, `${P}LeakCo`),
      person('k13bRead2', `${P}GoogleRead`, 'New', GMAIL.readNew),
    ],
    [TOKEN.noEdit]: [
      person('k13bNoEdit1', `${P}Ignored`, 'Leaked', GMAIL.priv, `${P}LeakCo`),
      person('k13bNoEdit2', `${P}GoogleNoEdit`, 'New', GMAIL.noEditNew),
    ],
    [TOKEN.staff]: [
      person('k13bStaff1', `${P}Ignored`, 'Leaked', GMAIL.priv, `${P}LeakCo`),
      person('k13bStaff2', `${P}Ignored`, 'GoogleMerged', GMAIL.team, `${P}GoogleCo`),
      person('k13bStaff3', `${P}GoogleStaff`, 'New', GMAIL.staffNew),
    ],
    [TOKEN.owner]: [
      person('k13bOwner1', `${P}Ignored`, 'OwnerMerged', GMAIL.privOwner, `${P}OwnerCo`),
      person('k13bOwner2', `${P}GoogleOwner`, 'New', GMAIL.ownerNew),
    ],
    [TOKEN.foreign]: [
      person('k13bForeign1', `${P}Ignored`, 'ForeignLeaked', GMAIL.priv, `${P}ForeignLeakCo`),
      person('k13bForeign2', `${P}GoogleForeign`, 'New', GMAIL.foreignNew),
    ],
    [TOKEN.callback]: [
      person('k13bCallback1', `${P}Ignored`, 'CallbackLeaked', GMAIL.priv, `${P}CallbackLeakCo`),
      person('k13bCallback2', `${P}Ignored`, 'CallbackMerged', GMAIL.teamCallback, `${P}CallbackCo`),
      person('k13bCallback3', `${P}GoogleCallback`, 'New', GMAIL.callbackNew),
    ],
    [TOKEN.replayFirst]: [person('k13bReplay1', `${P}GoogleReplay`, 'First', GMAIL.replayFirst)],
    [TOKEN.replaySecond]: [person('k13bReplay2', `${P}GoogleReplay`, 'Second', GMAIL.replaySecond)],
    [TOKEN.lowered]: [
      person('k13bLowered1', `${P}Ignored`, 'LoweredLeaked', GMAIL.priv, `${P}LoweredLeakCo`),
      person('k13bLowered2', `${P}GoogleLowered`, 'New', GMAIL.loweredNew),
    ],
    [TOKEN.w8Owner]: [person('k13bW8Owner1', `${P}GoogleW8Owner`, 'New', GMAIL.w8OwnerNew)],
    [TOKEN.w8Refused]: [
      person('k13bW8Refused1', `${P}Ignored`, 'W8Leaked', GMAIL.priv, `${P}W8LeakCo`),
      person('k13bW8Refused2', `${P}GoogleW8Refused`, 'New', GMAIL.w8RefusedNew),
    ],
  };

  const events = (contactId: string): Promise<Array<{ type: string; actor_type: string | null; actor_id: string | null }>> =>
    db.$queryRawUnsafe('SELECT type, actor_type, actor_id FROM contact_events WHERE contact_id = $1 ORDER BY created_at', contactId);
  const audits = (contactId: string): Promise<Array<{ action: string; actor: any; changed_fields: string[] }>> =>
    db.$queryRawUnsafe('SELECT action, actor, changed_fields FROM contact_audit_entries WHERE contact_id = $1 ORDER BY created_at', contactId);

  function googleImport(actor: string | null, accessToken: string) {
    const req = request(app.getHttpServer())
      .post(`/crm/businesses/${ID.bizA}/google/import`)
      .set('x-forwarded-for', nextIp());
    if (actor) req.set('x-test-user', actor);
    return req.send({ accessToken });
  }

  function googleAuthUrl(actor: string) {
    return request(app.getHttpServer())
      .get(`/crm/businesses/${ID.bizA}/google/auth-url`)
      .set('x-test-user', actor)
      .set('x-forwarded-for', nextIp());
  }

  /** The public OAuth callback, as the web proxy calls it: no session, no member header. */
  function googleCallback(state: string, code: string) {
    return request(app.getHttpServer())
      .get('/crm/google/callback')
      .query({ code, state })
      .set('x-forwarded-for', nextIp());
  }

  /** The state of an auth URL GET google/auth-url answered for `actor` (200). */
  async function issuedState(actor: string): Promise<string> {
    const res = await googleAuthUrl(actor);
    expect(res.status).toBe(200);
    const state = new URL(res.body.url).searchParams.get('state');
    expect(typeof state).toBe('string');
    return state as string;
  }

  /** A state's signed payload, read as the web proxy reads it (base64(payload.hmac)). */
  function statePayload(state: string): Record<string, unknown> {
    const decoded = Buffer.from(state, 'base64').toString('utf-8');
    return JSON.parse(decoded.substring(0, decoded.lastIndexOf('.')));
  }

  /** A state signed with the harness's GOOGLE_STATE_SECRET, in the format every Google flow uses. */
  function signedWithSharedSecret(payload: Record<string, unknown>): string {
    const json = JSON.stringify(payload);
    const signature = createHmac('sha256', GOOGLE_ENV.GOOGLE_STATE_SECRET).update(json).digest('hex');
    return Buffer.from(`${json}.${signature}`).toString('base64');
  }

  /**
   * W8-GOOGLE-CONSENT-OWNER (owner ruling D-99): a verified CRM-flow state
   * naming `memberId`, in the shape GET google/auth-url minted for any crm
   * write member before D-99 (flow, business, member, a fresh nonce, a
   * 10-minute expiry). Since D-99 the route issues one to the business owner
   * only, so the callback cases that import as (or refuse) another member sign
   * that member's state with the shared secret.
   */
  let memberNonce = 0;
  function memberState(memberId: string): string {
    return signedWithSharedSecret({
      flow: 'crm-google-contacts', businessId: ID.bizA, memberId,
      nonce: `k13b-fake-nonce-member-${++memberNonce}`, exp: Date.now() + 10 * 60_000,
    });
  }

  const tokenCalls = () => fetchSpy.mock.calls.filter(([input]: any[]) => String(input) === TOKEN_URL).length;

  /**
   * A refused callback: the redirect names `error`, Google is never called (no
   * code exchange, no People API), nothing is written for the tenant, and the
   * owner's PRIVATE contact the Google data matches is left exactly as it was.
   */
  async function expectCallbackRefused(state: string, code: string, error: string) {
    await settle();
    const before = await traceCounts();
    const privBefore = await contactTraces(G.cPrivGoogle);
    fetchSpy.mockClear();
    const res = await googleCallback(state, code);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/app/crm/contacts?google_error=${error}`);
    expect(fetchSpy).not.toHaveBeenCalled();
    await settle();
    expect(await traceCounts()).toEqual(before);
    expect(await contactTraces(G.cPrivGoogle)).toEqual(privBefore);
  }

  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    // A crm read-only member and three Google-matched contacts, seeded here so
    // the suite's fixture sanity case keeps its counts.
    await db.user.create({ data: { id: G.staffRead, email: `${P}staffRead@test.local`, role: 'USER' } });
    await db.membership.create({
      data: { id: `${P}m_staffRead`, userId: G.staffRead, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'read' } },
    });
    const c = async (id: string, email: string, visibility: string) =>
      db.contact.create({
        data: { id, businessId: ID.bizA, firstName: `${P}${id.slice(P.length)}`, email, emailNormalized: email, visibility, ownerId: ID.owner },
      });
    await c(G.cPrivGoogle, GMAIL.priv, 'PRIVATE');
    await c(G.cTeamGoogle, GMAIL.team, 'TEAM');
    await c(G.cPrivGoogleOwner, GMAIL.privOwner, 'PRIVATE');
    await c(G.cTeamCallback, GMAIL.teamCallback, 'TEAM');
    // A crm write member (view all, edit any) whose scope map the callback
    // cases lower after its auth URLs are issued.
    await db.user.create({ data: { id: G.staffLowered, email: `${P}staffLowered@test.local`, role: 'USER' } });
    await db.membership.create({
      data: { id: `${P}m_staffLowered`, userId: G.staffLowered, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write' } },
    });

    // The People API, stood in: one fixed URL, a list per fake token; and the
    // Google token endpoint (the OAuth callback's code exchange), one fixed
    // URL trading a fake code for the fake token of the same name. Any other
    // outbound fetch throws, so no provider traffic leaves the process.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : String(input?.href ?? input?.url);
      if (url === TOKEN_URL) {
        const code = new URLSearchParams(String(init?.body ?? '')).get('code') ?? '';
        if (code in ACCESS_FOR_CODE) {
          return new Response(JSON.stringify({ access_token: ACCESS_FOR_CODE[code], token_type: 'Bearer' }), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('{"error":"invalid_grant"}', { status: 400 });
      }
      if (url.startsWith(PEOPLE_URL)) {
        const token = String(init?.headers?.Authorization ?? '').replace(/^Bearer /, '');
        if (token in PEOPLE) {
          return new Response(JSON.stringify({ connections: PEOPLE[token] }), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('{"error":"unauthenticated"}', { status: 401 });
      }
      throw new Error(`unexpected outbound fetch in a test: ${url}`);
    }) as any);
  });

  afterAll(() => fetchSpy?.mockRestore());

  it("W7-GOOGLE-IMPORT-SCOPE NEGATIVE CONTROL: a crm read-only STAFF member's POST google/import answers 403 (crm requires write) before Google is called, writes nothing, and leaves the owner's PRIVATE contact its Google data matches exactly as it was; an unauthenticated call answers 401 alike", async () => {
    await settle();
    const privBefore = await contactTraces(G.cPrivGoogle);
    fetchSpy.mockClear();
    const res = await expectRefusedWithNothingWritten(() => googleImport(G.staffRead, TOKEN.read), 403);
    expect(String(res.body.message)).toMatch(/crm requires write/i);
    await expectRefusedWithNothingWritten(() => googleImport(null, TOKEN.read), 401);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await contactTraces(G.cPrivGoogle)).toEqual(privBefore);
    expect(await rawContact(G.cPrivGoogle)).toMatchObject({ visibility: 'PRIVATE', last_name: null, company_name: null });
    expect(await contactIdsWithEmail(GMAIL.readNew)).toEqual([]);
  });

  it('W7-GOOGLE-IMPORT-SCOPE NEGATIVE CONTROL: STAFF with crm write but crm_edit none is refused 403 (no permission to create contacts) before Google is called, as the CSV import is since R0-13, and nothing is written', async () => {
    await settle();
    const privBefore = await contactTraces(G.cPrivGoogle);
    fetchSpy.mockClear();
    const res = await expectRefusedWithNothingWritten(() => googleImport(ID.staffNoEdit, TOKEN.noEdit), 403);
    expect(String(res.body.message)).toMatch(/permission to create contacts/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await contactTraces(G.cPrivGoogle)).toEqual(privBefore);
    expect(await contactIdsWithEmail(GMAIL.noEditNew)).toEqual([]);
  });

  it("W7-GOOGLE-IMPORT-SCOPE: STAFF (view all, edit any) importing from Google: the person matching the owner's PRIVATE contact is skipped and that contact is left exactly as it was; the person matching the owner's TEAM contact is merged with an 'updated' audit entry naming the member; a new person is created with its contact.created event and created audit entry naming the member", async () => {
    await settle();
    const privBefore = await contactTraces(G.cPrivGoogle);
    expect(await audits(G.cTeamGoogle)).toEqual([]);
    const res = await googleImport(ID.staffWrite, TOKEN.staff);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ totalFetched: 3, imported: 2, skipped: 1 });
    await settle();

    // The PRIVATE holder: neither merged nor duplicated.
    expect(await contactTraces(G.cPrivGoogle)).toEqual(privBefore);
    expect(await contactIdsWithEmail(GMAIL.priv)).toEqual([G.cPrivGoogle]);

    // The TEAM contact the member may edit: merged, and the audit names the member.
    expect(await rawContact(G.cTeamGoogle)).toMatchObject({
      visibility: 'TEAM', owner_id: ID.owner, last_name: 'GoogleMerged', company_name: `${P}GoogleCo`,
    });
    const merged = await audits(G.cTeamGoogle);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ action: 'updated', actor: { type: 'USER', id: ID.staffWrite } });
    expect(merged[0].changed_fields).toEqual(expect.arrayContaining(['lastName', 'companyName']));

    // The new person: created, and its event and audit entry name the member.
    const ids = await contactIdsWithEmail(GMAIL.staffNew);
    expect(ids).toHaveLength(1);
    expect(await rawContact(ids[0])).toMatchObject({ source: 'google_contacts', source_detail: 'people/k13bStaff3', deleted_at: null });
    expect(await events(ids[0])).toEqual([{ type: 'contact.created', actor_type: 'USER', actor_id: ID.staffWrite }]);
    expect(await audits(ids[0])).toMatchObject([{ action: 'created', actor: { type: 'USER', id: ID.staffWrite } }]);
  });

  it("W7-GOOGLE-IMPORT-SCOPE positive control: the owner's Google import still merges into the owner's own PRIVATE contact and creates a new one, and both writes record the owner as the actor", async () => {
    const res = await googleImport(ID.owner, TOKEN.owner);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ totalFetched: 2, imported: 2, skipped: 0 });
    await settle();

    expect(await rawContact(G.cPrivGoogleOwner)).toMatchObject({
      visibility: 'PRIVATE', owner_id: ID.owner, last_name: 'OwnerMerged', company_name: `${P}OwnerCo`,
    });
    expect(await audits(G.cPrivGoogleOwner)).toMatchObject([{ action: 'updated', actor: { type: 'USER', id: ID.owner } }]);

    const ids = await contactIdsWithEmail(GMAIL.ownerNew);
    expect(ids).toHaveLength(1);
    expect(await events(ids[0])).toEqual([{ type: 'contact.created', actor_type: 'USER', actor_id: ID.owner }]);
    expect(await audits(ids[0])).toMatchObject([{ action: 'created', actor: { type: 'USER', id: ID.owner } }]);
  });

  it('W7-GOOGLE-IMPORT-SCOPE: GET google/auth-url, which starts the Google contact import the OAuth callback completes, needs crm write too: a crm read-only STAFF member gets 403 (crm requires write); a crm write member passes the scope gate, and since owner ruling D-99 (W8-GOOGLE-CONSENT-OWNER) the handler then admits only the business owner: the crm write STAFF member gets 403 GOOGLE_CONNECT_OWNER_ONLY and the owner gets the URL', async () => {
    const denied = await googleAuthUrl(G.staffRead);
    expect(denied.status).toBe(403);
    expect(String(denied.body.message)).toMatch(/crm requires write/i);

    // Past the gate the handler runs, and D-99 refuses a member who is not the
    // business owner (not the scope gate's refusal).
    const member = await googleAuthUrl(ID.staffWrite);
    expect(member.status).toBe(403);
    expect(member.body.code).toBe('GOOGLE_CONNECT_OWNER_ONLY');
    expect(String(member.body.message)).not.toMatch(/crm requires write/i);
    expect(member.body).not.toHaveProperty('url');

    // The harness configures a (fake) Google client, so the owner gets 200 with
    // the auth URL (without one it would answer 400 'Google OAuth not configured').
    const allowed = await googleAuthUrl(ID.owner);
    expect([200, 400]).toContain(allowed.status);
    if (allowed.status === 400) expect(String(allowed.body.message)).toMatch(/Google OAuth not configured/i);
    expect(allowed.status).toBe(200);
  });

  // ---- review repairs: the OAuth callback the web UI imports through ----------

  it('W7-GOOGLE-IMPORT-SCOPE review repair SEC-GIS-2 NEGATIVE CONTROL: STAFF with crm write but crm_edit none is refused 403 on GET google/auth-url (no permission to create contacts), as on POST google/import, so it is never issued a state', async () => {
    const res = await googleAuthUrl(ID.staffNoEdit);
    expect(res.status).toBe(403);
    expect(String(res.body.message)).toMatch(/permission to create contacts/i);
    expect(res.body).not.toHaveProperty('url');
  });

  it("W7-GOOGLE-IMPORT-SCOPE review repair SEC-GIS-1 NEGATIVE CONTROL: GET crm/google/callback refuses every state signed with the shared GOOGLE_STATE_SECRET that the CRM auth-url did not mint (a bookings calendar state any member can get, a Drive state, and a CRM-flow state naming no member): each redirects google_error=invalid_state before Google is called, writes nothing, and leaves the owner's PRIVATE contact exactly as it was", async () => {
    const { CalendarService } = await import('../src/modules/bookings/calendar.service');
    const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
    const calendarState = new URL(new CalendarService({} as any).getAuthUrl(ID.bizA)).searchParams.get('state') as string;
    const driveState = new URL(new GoogleDriveService({} as any).getAuthUrl(ID.bizA)).searchParams.get('state') as string;
    expect(statePayload(calendarState)).toMatchObject({ businessId: ID.bizA });
    expect(statePayload(driveState)).toMatchObject({ businessId: ID.bizA, flow: 'drive' });
    const noMember = signedWithSharedSecret({
      flow: 'crm-google-contacts', businessId: ID.bizA, nonce: 'k13b-fake-nonce-no-member', exp: Date.now() + 60_000,
    });

    for (const state of [calendarState, driveState, noMember]) {
      await expectCallbackRefused(state, CODE.foreign, 'invalid_state');
    }
    expect(await rawContact(G.cPrivGoogle)).toMatchObject({ visibility: 'PRIVATE', owner_id: ID.owner, last_name: null, company_name: null });
    expect(await contactIdsWithEmail(GMAIL.foreignNew)).toEqual([]);
  });

  it("W7-GOOGLE-IMPORT-SCOPE review repair CR-W7G-1: the OAuth callback imports as the member its state names (STAFF view all, edit any): a verified state naming that member and the CRM flow (as GET google/auth-url minted it before owner ruling D-99; since W8-GOOGLE-CONSENT-OWNER the route issues one to the owner only); the callback redirects google_success imported=2; the person matching the owner's PRIVATE contact is skipped and that contact left exactly as it was; the TEAM contact is merged with an 'updated' audit entry naming the member; the new contact's contact.created event and created audit entry name the member", async () => {
    // D-99 (W8-GOOGLE-CONSENT-OWNER): the route refuses this member a URL, so its state is signed here.
    expect((await googleAuthUrl(ID.staffWrite)).status).toBe(403);
    const state = memberState(ID.staffWrite);
    expect(statePayload(state)).toMatchObject({ flow: 'crm-google-contacts', businessId: ID.bizA, memberId: ID.staffWrite });

    await settle();
    const privBefore = await contactTraces(G.cPrivGoogle);
    expect(await audits(G.cTeamCallback)).toEqual([]);
    fetchSpy.mockClear();
    const res = await googleCallback(state, CODE.callback);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/app/crm/contacts?google_success=true&imported=2');
    expect(tokenCalls()).toBe(1);
    await settle();

    // The PRIVATE holder: neither merged nor duplicated.
    expect(await contactTraces(G.cPrivGoogle)).toEqual(privBefore);
    expect(await contactIdsWithEmail(GMAIL.priv)).toEqual([G.cPrivGoogle]);

    // The TEAM contact the member may edit: merged, and the audit names the member.
    expect(await rawContact(G.cTeamCallback)).toMatchObject({
      visibility: 'TEAM', owner_id: ID.owner, last_name: 'CallbackMerged', company_name: `${P}CallbackCo`,
    });
    const merged = await audits(G.cTeamCallback);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ action: 'updated', actor: { type: 'USER', id: ID.staffWrite } });

    // The new person: created, and its event and audit entry name the member.
    const ids = await contactIdsWithEmail(GMAIL.callbackNew);
    expect(ids).toHaveLength(1);
    expect(await rawContact(ids[0])).toMatchObject({ source: 'google_contacts', source_detail: 'people/k13bCallback3', deleted_at: null });
    expect(await events(ids[0])).toEqual([{ type: 'contact.created', actor_type: 'USER', actor_id: ID.staffWrite }]);
    expect(await audits(ids[0])).toMatchObject([{ action: 'created', actor: { type: 'USER', id: ID.staffWrite } }]);
  });

  it('W7-GOOGLE-IMPORT-SCOPE review repair SEC-GIS-3 NEGATIVE CONTROL: a state is good for one callback: the first callback imports (google_success imported=1); replaying the same state with another authorization code redirects google_error=invalid_state before Google is called, and nothing is written', async () => {
    // Since owner ruling D-99 (W8-GOOGLE-CONSENT-OWNER) the route issues a state to the owner only.
    const state = await issuedState(ID.owner);
    const first = await googleCallback(state, CODE.replayFirst);
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe('/app/crm/contacts?google_success=true&imported=1');
    await settle();
    expect(await contactIdsWithEmail(GMAIL.replayFirst)).toHaveLength(1);

    await expectCallbackRefused(state, CODE.replaySecond, 'invalid_state');
    expect(await contactIdsWithEmail(GMAIL.replaySecond)).toEqual([]);
  });

  it("W7-GOOGLE-IMPORT-SCOPE review repair SEC-GIS-2 NEGATIVE CONTROL: the callback re-checks the member its state names when it lands: after its states were issued, a member lowered to crm_edit none, then to crm read, then removed from the business is refused (google_error=forbidden) before Google is called each time, nothing is written, and the owner's PRIVATE contact is left exactly as it was", async () => {
    // Since owner ruling D-99 (W8-GOOGLE-CONSENT-OWNER) the route issues a
    // state to the owner only, so this member's states are signed here.
    const states = [memberState(G.staffLowered), memberState(G.staffLowered), memberState(G.staffLowered)];
    const lower = (permissionScopes: Record<string, string>) =>
      db.membership.update({ where: { id: `${P}m_staffLowered` }, data: { permissionScopes } });

    await lower({ crm: 'write', crm_edit: 'none' });
    await expectCallbackRefused(states[0], CODE.lowered, 'forbidden');

    await lower({ crm: 'read' });
    await expectCallbackRefused(states[1], CODE.lowered, 'forbidden');

    await db.membership.delete({ where: { id: `${P}m_staffLowered` } });
    await expectCallbackRefused(states[2], CODE.lowered, 'forbidden');

    expect(await rawContact(G.cPrivGoogle)).toMatchObject({ visibility: 'PRIVATE', owner_id: ID.owner, last_name: null, company_name: null });
    expect(await contactIdsWithEmail(GMAIL.loweredNew)).toEqual([]);
  });

  // W8-GOOGLE-CONSENT-OWNER (owner ruling D-99): every Google connection of a
  // business, Contacts included, is started only by the business owner (the
  // Gmail rule's shape: an OWNER membership or Business.ownerId, with the
  // SUPER_ADMIN bypass). GET google/auth-url keeps its crm write gate and its
  // create-contacts check (W7, in that order) and then refuses anyone else 403
  // GOOGLE_CONNECT_OWNER_ONLY, so the state it signs names an owner. The import
  // itself stays under the CRM write door W7 applied to POST google/import: the
  // public callback imports as the member the verified state names, re-checked
  // when it lands (assertCanImport), with that member's visibility and edit
  // scope and as the audit actor.
  describe('W8-GOOGLE-CONSENT-OWNER (owner ruling D-99): starting the Google contact import is the business owner\'s; the callback imports as the member its verified state names, under the CRM write door', () => {
    const W = {
      admin: `${P}w8Admin`,     // ADMIN, role defaults (crm admin): passes the crm gate, not the owner
      coOwner: `${P}w8CoOwner`, // OWNER membership, not Business.ownerId
    };

    beforeAll(async () => {
      for (const id of [W.admin, W.coOwner]) {
        await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
      }
      await db.membership.create({ data: { id: `${P}m_w8Admin`, userId: W.admin, businessId: ID.bizA, role: 'ADMIN' } });
      await db.membership.create({ data: { id: `${P}m_w8CoOwner`, userId: W.coOwner, businessId: ID.bizA, role: 'OWNER' } });
    });

    it('[V94D-C01] RED-BEFORE (D-99): GET /crm/businesses/:b/google/auth-url answers a crm write STAFF member (view all, edit any) and an ADMIN (role defaults, crm admin), both past the crm write gate and allowed to create contacts, 403 GOOGLE_CONNECT_OWNER_ONLY with no URL; the owner and a co-owner by OWNER membership get the URL, its signed state naming them, the business and the CRM flow', async () => {
      for (const member of [ID.staffWrite, W.admin]) {
        const res = await googleAuthUrl(member);
        expect(res.status, `${member} ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body.code).toBe('GOOGLE_CONNECT_OWNER_ONLY');
        expect(JSON.stringify(res.body)).not.toContain('accounts.google.com');
      }
      for (const owner of [ID.owner, W.coOwner]) {
        expect(statePayload(await issuedState(owner))).toMatchObject({ flow: 'crm-google-contacts', businessId: ID.bizA, memberId: owner });
      }
    });

    it("[V94D-C02] control (D-99; W7-GOOGLE-IMPORT-SCOPE residual): the owner's consent completes through GET crm/google/callback and imports as the owner: google_success imported=1, one Google token exchange, and the new contact's contact.created event and created audit entry name the owner", async () => {
      const state = await issuedState(ID.owner);
      fetchSpy.mockClear();
      const res = await googleCallback(state, CODE.w8Owner);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/app/crm/contacts?google_success=true&imported=1');
      expect(tokenCalls()).toBe(1);
      await settle();
      const ids = await contactIdsWithEmail(GMAIL.w8OwnerNew);
      expect(ids).toHaveLength(1);
      expect(await rawContact(ids[0])).toMatchObject({ source: 'google_contacts', source_detail: 'people/k13bW8Owner1', deleted_at: null });
      expect(await events(ids[0])).toEqual([{ type: 'contact.created', actor_type: 'USER', actor_id: ID.owner }]);
      expect(await audits(ids[0])).toMatchObject([{ action: 'created', actor: { type: 'USER', id: ID.owner } }]);
    });

    it("[V94D-C03] NEGATIVE CONTROL (W7-GOOGLE-IMPORT-SCOPE residual, under D-99): GET crm/google/callback refuses a verified state naming a member without crm write (crm read), or with crm write but no permission to create contacts (crm_edit none): google_error=forbidden before Google is called, nothing written, and the owner's PRIVATE contact the Google data matches left exactly as it was", async () => {
      for (const member of [G.staffRead, ID.staffNoEdit]) {
        await expectCallbackRefused(memberState(member), CODE.w8Refused, 'forbidden');
      }
      expect(await rawContact(G.cPrivGoogle)).toMatchObject({ visibility: 'PRIVATE', owner_id: ID.owner, last_name: null, company_name: null });
      expect(await contactIdsWithEmail(GMAIL.w8RefusedNew)).toEqual([]);
    });
  });
});
