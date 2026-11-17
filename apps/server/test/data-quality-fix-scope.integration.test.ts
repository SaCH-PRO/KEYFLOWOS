/**
 * FU-DATAQUALITY-MASS-ASSIGN (V1-71; journeys C and J; rulings D-11, D-221) — a contact
 * data-quality fix writes only the fields it fixes, and only on a contact the member may open.
 * Against a REAL database, through the HTTP routes.
 *
 * Before (found by WA-E164-SERVER's review repair; pre-existing):
 *  - POST .../data-quality/issues/:issueId/apply with the 'fill_fields' action passed
 *    override.values from the request body straight into contact.update, so any member with crm
 *    write could set any column of the contact: businessId (moving the contact to another
 *    tenant), ownerId, visibility, deletedAt, phoneNormalized (around the identity rules), or a
 *    Prisma operation object ({ set: ... }) in place of a value. The request could also name the
 *    action itself (override.action), so an issue of one kind wrote fields another kind fixes
 *    (a stale-data issue writing the email).
 *  - apply, bulk-apply and dismiss looked the issue up by id in the business and checked crm
 *    write only: a 'my book' STAFF member acted by issue id on contacts outside their book, a
 *    view-all STAFF on another member's PRIVATE contact, and an issue of a soft-deleted contact
 *    still wrote the deleted row.
 *  - a fix that wrote the contact recorded no ContactAuditEntry (owner ruling D-25: every
 *    contact write records one).
 *
 * Now:
 *  - each issue kind fills only the fields it fixes: invalid_email the email (replace_email),
 *    invalid_phone the number it flags (replace_phone for the phone), missing_required the
 *    fields it lists among email, phone and companyName (fill_fields), stale_data and
 *    suspected_duplicate none (mark_verified, merge). An action the issue's kind does not offer,
 *    and any other key, is refused 400 with nothing written and the issue left open;
 *  - the values a fill writes are checked as the contact PATCH DTO checks them and written by
 *    the contact PATCH's own write (CrmService.updateContact): trimmed and sanitised, the email
 *    normalised and its identity unique answered as 409 contact_email_taken, the phone stored
 *    in E.164 under the business's country and a number another live contact holds answered as
 *    409 contact_phone_taken, the member's edit scope applied, the change audited;
 *  - apply, bulk-apply and dismiss find the issue only on a live contact the member may open
 *    (visibilityClause, as GET contacts/:contactId): any other issue answers exactly as an
 *    unknown issue id does (404 'Issue not found'; bulk-apply's per-issue error), and is left
 *    as it was. Apply writes the contact, so it also keeps the contact PATCH's edit scope (a
 *    member with crm_edit 'owned' fixes the contacts they own or that are shared with them; a
 *    member with crm_edit 'none' fixes none: 403);
 *  - every fix that writes the contact records one ContactAuditEntry ('updated', the member as
 *    USER actor) in the write's own transaction.
 *
 * Nothing on the HTTP or persistence path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, PlanLimitGuard, ValidationPipe,
 * GlobalHttpExceptionFilter, CrmController, CrmService, CrmStatsService, EntityResolutionService,
 * CrmDataQualityService and ContactAuditService are real against DATABASE_URL. Identity
 * attachment reads `x-test-user` and loads that seeded user row as AuthMiddleware would after
 * token verification; the timeline's side channels, caches and flow are recorders, the plan
 * limit allows, and the scan's duplicate pass and email MX lookup are never reached (no case
 * here runs a scan), so no request leaves the process.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v71n_` prefix (rows written through the
 * API are deleted by business id) and is hard-deleted by raw SQL (sqlLikePrefix) in beforeAll
 * and afterAll. Cases tagged RED-BEFORE fail on the packet's source base (int/v1-base 6e199113
 * with pkt/V1-WA-E164-SERVER 4b366f7e merged); CONTROL cases pass before and after.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71n_';
const ID = {
  owner: `${P}owner`,         // OWNER of bizA
  ownerB: `${P}ownerB`,       // OWNER of bizB, the other tenant
  staffAll: `${P}stAll`,      // STAFF of bizA, crm 'write' (view all, edit any)
  staffBook: `${P}stBook`,    // STAFF of bizA, 'my book' (crm_view owned, crm_edit owned)
  staffEdOwn: `${P}stEdOwn`,  // STAFF of bizA, view all but crm_edit owned
  staffNoEd: `${P}stNoEd`,    // STAFF of bizA, crm 'write' but crm_edit none
  bizA: `${P}bizA`,           // Business.country unset: Trinidad and Tobago
  bizB: `${P}bizB`,
};

/** One contact per case (an applied fix resolves its issue, so no case can share one). */
const C = {
  // missing_required ['companyName'] (VENDOR with an email): the mass-assignment cases
  mBiz: `${P}c_mBiz`,
  mOwner: `${P}c_mOwner`,
  mVis: `${P}c_mVis`,
  mDel: `${P}c_mDel`,
  mKey: `${P}c_mKey`,
  mMixed: `${P}c_mMixed`,
  mOther: `${P}c_mOther`,
  mOp: `${P}c_mOp`,
  mLegit: `${P}c_mLegit`,
  mBulk: `${P}c_mBulk`,
  // missing_required ['email'] (VENDOR with a company)
  eBad: `${P}c_eBad`,
  eTaken: `${P}c_eTaken`,
  eHolder: `${P}c_eHolder`,
  // missing_required ['phone'] (CLIENT with an email)
  pTaken: `${P}c_pTaken`,
  pHolder: `${P}c_pHolder`,
  pLegit: `${P}c_pLegit`,
  // stale_data issues fixed with another kind's action
  sFill: `${P}c_sFill`,
  sEmail: `${P}c_sEmail`,
  // the other actions, applied as recommended
  rEmail: `${P}c_rEmail`,
  rTaken: `${P}c_rTaken`,     // invalid_email whose recommended correction another contact holds
  rHolder: `${P}c_rHolder`,
  rBad: `${P}c_rBad`,         // invalid_email with no suggestion (edit_email)
  rPhone: `${P}c_rPhone`,
  vStale: `${P}c_vStale`,
  // visibility and edit scope
  hBook: `${P}c_hBook`,       // TEAM, owned by the OWNER: outside staffBook's book
  own: `${P}c_own`,           // TEAM, owned by staffBook
  hPriv: `${P}c_hPriv`,       // PRIVATE, owned by the OWNER: hidden from staffAll
  edTeam: `${P}c_edTeam`,     // TEAM, owned by the OWNER: visible to staffEdOwn, not theirs to edit
  gone: `${P}c_gone`,         // soft-deleted, with an open issue left behind
  // the queue's reads: list, wizard, stats (review repairs SEC-DQ-1, COR-DQMA-1, COR-DQMA-2)
  lHeld: `${P}c_lHeld`,       // TEAM, owned by the OWNER: outside staffBook's book; a searchable email
  lMine: `${P}c_lMine`,       // TEAM, owned by staffBook
  lShared: `${P}c_lShared`,   // TEAM, owned by the OWNER, shared with staffBook
  dDel: `${P}c_dDel`,         // TEAM, deleted in a case through DELETE contacts/:contactId
  mgP: `${P}c_mgP`,           // suspected duplicates of each other, merged in a case through
  mgD: `${P}c_mgD`,           //   POST contacts/:mgP/merge/:mgD, as their issues recommend
  // bulk-apply with ids that are not text (review repair SEC-DQ-2)
  bOwn: `${P}c_bOwn`,         // TEAM, owned by staffBook
  // POST contacts/:contactId/data-quality/mark-verified (review repair SEC-DQ-3)
  mvNoEd: `${P}c_mvNoEd`,     // TEAM, owned by the OWNER
};
/** The open issue seeded for contact `c` is `${c}_i`. */
const issueOf = (contactId: string) => `${contactId}_i`;

// Every address carries the fixture prefix (fixture-prefix-registry: a literal written to an `email` key
// embeds it).
const OTHER_EMAIL = `${P}mina.holder@test.local`;
const CORRECTED_HELD = `${P}tomas@gmail.com`;
const HELD_PHONE_E164 = '+18687123601';
/** lHeld's email and phone: what would tell staffBook of a contact outside their book. */
const HIDDEN_EMAIL = `${P}held.hidden@test.local`;
const HIDDEN_PHONE = '+18687123699';

let db: any;
let app: any;

/** A fresh client address per request: each gets its own rate-limit bucket. */
let ipN = 0;
const nextIp = () => `10.71.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension). A contact this file's bug
  // moved to bizB keeps its v71n_ id, so contacts also go by id.
  for (const sql of [
    `DELETE FROM contact_data_issues WHERE business_id LIKE ${sqlLikePrefix(P)} OR contact_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE contact_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM merge_operations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

// ---- requests ---------------------------------------------------------------

function apply(actor: string, issueId: string, override?: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/data-quality/issues/${issueId}/apply`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send(override === undefined ? {} : { override });
}

function dismiss(actor: string, issueId: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/data-quality/issues/${issueId}/dismiss`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({});
}

function bulkApply(actor: string, issueIds: unknown[]) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/data-quality/bulk-apply`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ issueIds });
}

/** GET /crm/businesses/bizA/data-quality/<routePath> as `actor`. */
function getDq(actor: string, routePath: string) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${ID.bizA}/data-quality/${routePath}`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp());
}

async function okDq(actor: string, routePath: string) {
  const res = await getDq(actor, routePath);
  expect(res.status, `${actor} GET data-quality/${routePath}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
  return res.body;
}

function markVerified(actor: string, contactId: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/contacts/${contactId}/data-quality/mark-verified`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({});
}

function deleteContact(actor: string, contactId: string) {
  return request(app.getHttpServer())
    .delete(`/crm/businesses/${ID.bizA}/contacts/${contactId}`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp());
}

function mergeContacts(actor: string, primaryId: string, duplicateId: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/contacts/${primaryId}/merge/${duplicateId}`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({});
}

const idsOf = (items: Array<{ id: string }>) => items.map((item) => item.id).sort();

/**
 * The test's own statement of the rule GET contacts/:contactId applies (CrmStatsService.contactDetail:
 * the business, deletedAt null, visibilityClause), over raw SQL: the OWNER opens every live contact;
 * a view-all STAFF its TEAM and SHARED rows, its own and the ones shared with it (never another
 * member's PRIVATE row); a 'my book' STAFF its own and the ones shared with it.
 */
const OPENS_SQL = {
  owner: 'TRUE',
  viewAll: `(c.visibility IN ('TEAM', 'SHARED') OR c.owner_id = $2 OR EXISTS (SELECT 1 FROM contact_shares s WHERE s.contact_id = c.id AND s.user_id = $2))`,
  myBook: `(c.owner_id = $2 OR EXISTS (SELECT 1 FROM contact_shares s WHERE s.contact_id = c.id AND s.user_id = $2))`,
} as const;

/** The open issues of bizA on the live contacts `userId` may open, by OPENS_SQL[rule]. */
async function openIssuesFor(rule: keyof typeof OPENS_SQL, userId: string): Promise<Array<{ id: string; kind: string }>> {
  const rows: Array<{ id: string; kind: string }> = await db.$queryRawUnsafe(
    `SELECT i.id, i.kind FROM contact_data_issues i JOIN contacts c ON c.id = i.contact_id
      WHERE i.business_id = $1 AND i.status = 'open' AND c.business_id = $1 AND c.deleted_at IS NULL
        AND ${OPENS_SQL[rule]} AND $2::text IS NOT NULL
      ORDER BY i.id`,
    ID.bizA, userId,
  );
  // Sorted as idsOf sorts (code units), not by the database's collation.
  return rows.map((r) => ({ id: r.id, kind: r.kind })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function countByKind(issues: Array<{ kind: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of issues) counts[issue.kind] = (counts[issue.kind] ?? 0) + 1;
  return counts;
}

const NO_ISSUES = { invalid_email: 0, invalid_phone: 0, missing_required: 0, stale_data: 0, suspected_duplicate: 0 };

// ---- reads ------------------------------------------------------------------

/** A contact as the table holds it, soft-deleted or not (raw SQL bypasses the soft-delete extension). */
async function row(contactId: string): Promise<Record<string, any> | null> {
  const rows: Array<Record<string, any>> = await db.$queryRawUnsafe(
    `SELECT business_id, owner_id, visibility, deleted_at, first_name, company_name, email, email_normalized,
            phone, phone_normalized, last_verified_at
       FROM contacts WHERE id = $1`,
    contactId,
  );
  return rows[0] ?? null;
}

async function issueRow(issueId: string): Promise<Record<string, any> | null> {
  return db.contactDataIssue.findUnique({
    where: { id: issueId },
    select: { id: true, status: true, resolvedAt: true, resolvedBy: true, businessId: true, contactId: true },
  });
}

async function audits(contactId: string): Promise<Array<Record<string, any>>> {
  return db.contactAuditEntry.findMany({ where: { contactId }, orderBy: { createdAt: 'asc' } });
}

/** The 400 a refused fix answers. */
function expectBadRequest(res: { status: number; body: any }) {
  expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(400);
  expect(res.body.statusCode).toBe(400);
  expect(res.body.code).toBe('BAD_REQUEST');
}

/** The answer a request gets for an issue id this business does not have (status, code, message). */
let unknownAnswer: { status: number; code: string; message: unknown; error: unknown };
function answerOf(res: { status: number; body: any }) {
  return { status: res.status, code: res.body?.code, message: res.body?.message, error: res.body?.error };
}

/** The row and issue a refused fix must leave exactly as they were. */
async function snapshot(contactId: string) {
  return { contact: await row(contactId), issue: await issueRow(issueOf(contactId)), audits: (await audits(contactId)).length };
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
      ContactAuditService,
      EntityResolutionService,
      CrmDataQualityService,
      // The scan's duplicate pass: never reached (no case here runs a scan).
      { provide: CrmDuplicateDetectionService, useValue: {} },
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      // Side channels off the contact write; the claims here are the rows.
      { provide: CrmTimelineService, useValue: { logEvent: async () => undefined, logContactEvent: async () => undefined } },
      { provide: CrmCacheService, useValue: { invalidate: async () => undefined } },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmImportService, useValue: {} },
      { provide: CrmListsService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      { provide: CrmPlaybookService, useValue: {} },
      { provide: CrmActionsService, useValue: {} },
      { provide: CrmRevenueService, useValue: {} },
      { provide: CrmJourneyService, useValue: {} },
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

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenants, memberships ----------------------------------
  for (const suffix of ['owner', 'ownerB', 'stAll', 'stBook', 'stEdOwn', 'stNoEd']) {
    await db.user.create({ data: { id: `${P}${suffix}`, email: `${P}${suffix}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V71N Roti Shop', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V71N Elsewhere', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  for (const [id, userId, permissionScopes] of [
    [`${P}m_stAll`, ID.staffAll, { crm: 'write' }],
    [`${P}m_stBook`, ID.staffBook, { crm: 'write', crm_view: 'owned', crm_edit: 'owned' }],
    [`${P}m_stEdOwn`, ID.staffEdOwn, { crm: 'write', crm_view: 'all', crm_edit: 'owned' }],
    [`${P}m_stNoEd`, ID.staffNoEd, { crm: 'write', crm_edit: 'none' }],
  ] as const) {
    await db.membership.create({ data: { id, userId, businessId: ID.bizA, role: 'STAFF', permissionScopes } });
  }

  // ---- contacts and their open issues, as the scan writes them -----------
  const contact = (id: string, data: Record<string, unknown>) =>
    db.contact.create({ data: { id, businessId: ID.bizA, lastName: `${P}seed`, ownerId: ID.owner, visibility: 'TEAM', ...data } });
  const issue = (contactId: string, data: Record<string, unknown>) =>
    db.contactDataIssue.create({ data: { id: issueOf(contactId), businessId: ID.bizA, contactId, status: 'open', ...data } });
  const missingCompany = { kind: 'missing_required', severity: 'medium', field: 'companyName', message: 'Missing required field: companyName.', recommendedFix: { action: 'fill_fields', fields: ['companyName'] } };
  const missingEmail = { kind: 'missing_required', severity: 'medium', field: 'email', message: 'Missing required field: email.', recommendedFix: { action: 'fill_fields', fields: ['email'] } };
  const missingPhone = { kind: 'missing_required', severity: 'medium', field: 'phone', message: 'Missing required field: phone.', recommendedFix: { action: 'fill_fields', fields: ['phone'] } };
  const stale = { kind: 'stale_data', severity: 'low', field: null, message: 'No verified contact in over 180 days.', recommendedFix: { action: 'mark_verified' } };

  // VENDOR with an email and no company: missing_required ['companyName'].
  for (const [id, firstName] of [
    [C.mBiz, 'Bea'], [C.mOwner, 'Omar'], [C.mVis, 'Vic'], [C.mDel, 'Dee'], [C.mKey, 'Kay'],
    [C.mMixed, 'Max'], [C.mOther, 'Otto'], [C.mOp, 'Opal'], [C.mLegit, 'Lia'], [C.mBulk, 'Bo'],
  ] as const) {
    const email = `${P}${firstName.toLowerCase()}@test.local`;
    await contact(id, { firstName, relationshipType: 'VENDOR', email, emailNormalized: email });
    await issue(id, missingCompany);
  }
  // VENDOR with a company and no email: missing_required ['email'].
  for (const [id, firstName] of [[C.eBad, 'Ena'], [C.eTaken, 'Eli']] as const) {
    await contact(id, { firstName, relationshipType: 'VENDOR', companyName: `${firstName} Supplies` });
    await issue(id, missingEmail);
  }
  await contact(C.eHolder, { firstName: 'Mina', email: OTHER_EMAIL, emailNormalized: OTHER_EMAIL });
  // CLIENT with an email and no phone: missing_required ['phone'].
  for (const [id, firstName] of [[C.pTaken, 'Pat'], [C.pLegit, 'Pia']] as const) {
    const email = `${P}${firstName.toLowerCase()}@test.local`;
    await contact(id, { firstName, relationshipType: 'CLIENT', email, emailNormalized: email });
    await issue(id, missingPhone);
  }
  await contact(C.pHolder, { firstName: 'Hal', phone: HELD_PHONE_E164, phoneNormalized: HELD_PHONE_E164 });
  // Stale contacts, for the actions another kind offers.
  for (const [id, firstName] of [[C.sFill, 'Sal'], [C.sEmail, 'Sue']] as const) {
    const email = `${P}${firstName.toLowerCase()}@test.local`;
    await contact(id, { firstName, email, emailNormalized: email, companyName: `${firstName} Co` });
    await issue(id, stale);
  }
  // The other actions, as recommended.
  await contact(C.rEmail, { firstName: 'Rita', email: `${P}rita@gmial.com`, emailNormalized: `${P}rita@gmial.com` });
  await issue(C.rEmail, {
    kind: 'invalid_email', severity: 'high', field: 'email', message: 'Email address is not in a valid format.',
    recommendedFix: { action: 'replace_email', value: `${P}rita@gmail.com` },
  });
  await contact(C.rHolder, { firstName: 'Tomas', email: CORRECTED_HELD, emailNormalized: CORRECTED_HELD });
  await contact(C.rTaken, { firstName: 'Tom', email: `${P}tomas@gmial.com`, emailNormalized: `${P}tomas@gmial.com` });
  await issue(C.rTaken, {
    kind: 'invalid_email', severity: 'high', field: 'email', message: 'Email address is not in a valid format.',
    recommendedFix: { action: 'replace_email', value: CORRECTED_HELD },
  });
  await contact(C.rBad, { firstName: 'Ron', email: `${P}ron@nowhere`, emailNormalized: `${P}ron@nowhere` });
  await issue(C.rBad, {
    kind: 'invalid_email', severity: 'high', field: 'email', message: 'Email address is not in a valid format.',
    recommendedFix: { action: 'edit_email' },
  });
  await contact(C.rPhone, { firstName: 'Ravi', phone: '868-712-3610', phoneNormalized: '8687123610' });
  await issue(C.rPhone, {
    kind: 'invalid_phone', severity: 'low', field: 'phone', message: 'Phone number can be reformatted to E.164.',
    recommendedFix: { action: 'replace_phone', value: '+18687123610' },
  });
  await contact(C.vStale, { firstName: 'Val' });
  await issue(C.vStale, stale);
  // Visibility and edit scope.
  await contact(C.hBook, { firstName: 'Hana' });
  await issue(C.hBook, stale);
  await contact(C.own, { firstName: 'Ola', ownerId: ID.staffBook });
  await issue(C.own, stale);
  await contact(C.hPriv, { firstName: 'Priya', visibility: 'PRIVATE', relationshipType: 'VENDOR', email: `${P}priya@test.local`, emailNormalized: `${P}priya@test.local` });
  await issue(C.hPriv, missingCompany);
  await contact(C.edTeam, { firstName: 'Ted' });
  await issue(C.edTeam, stale);
  await contact(C.gone, { firstName: 'Gus', deletedAt: new Date('2026-11-01T00:00:00Z') });
  await issue(C.gone, stale);
  // The queue's reads (review repairs SEC-DQ-1, COR-DQMA-1, COR-DQMA-2).
  await contact(C.lHeld, { firstName: 'Hidden', email: HIDDEN_EMAIL, emailNormalized: HIDDEN_EMAIL, phone: HIDDEN_PHONE, phoneNormalized: HIDDEN_PHONE });
  await issue(C.lHeld, stale);
  await contact(C.lMine, { firstName: 'Mia', ownerId: ID.staffBook });
  await issue(C.lMine, stale);
  await contact(C.lShared, { firstName: 'Sid' });
  await issue(C.lShared, stale);
  await db.contactShare.create({ data: { id: `${P}share_lShared`, businessId: ID.bizA, contactId: C.lShared, userId: ID.staffBook, createdBy: ID.owner } });
  await contact(C.dDel, { firstName: 'Del' });
  await issue(C.dDel, stale);
  // The scan maps both sides of a suspected pair, each recommending the merge of the duplicate into the primary.
  await contact(C.mgP, { firstName: 'Gia', email: `${P}gia@test.local`, emailNormalized: `${P}gia@test.local` });
  await contact(C.mgD, { firstName: 'Gia', email: `${P}gia.two@test.local`, emailNormalized: `${P}gia.two@test.local` });
  for (const id of [C.mgP, C.mgD]) {
    await issue(id, {
      kind: 'suspected_duplicate', severity: 'medium', field: null, message: 'Possible duplicate of another contact (same name).',
      recommendedFix: { action: 'merge', primaryId: C.mgP, duplicateId: C.mgD, confidence: 0.92 },
    });
  }
  // Bulk-apply with ids that are not text (SEC-DQ-2); mark-verified under the edit rule (SEC-DQ-3).
  await contact(C.bOwn, { firstName: 'Bree', ownerId: ID.staffBook });
  await issue(C.bOwn, stale);
  await contact(C.mvNoEd, { firstName: 'Vera' });
  await issue(C.mvNoEd, stale);

  // The answer for an issue id this business does not have, which a hidden one must match.
  unknownAnswer = answerOf(await apply(ID.staffBook, `${P}no_such_issue`));
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

// -----------------------------------------------------------------------------

describe('fill_fields writes only the fields the issue fixes (mass assignment)', () => {
  it('CONTROL: an issue id the business does not have answers 404 Issue not found', () => {
    expect(unknownAnswer).toEqual({ status: 404, code: 'NOT_FOUND', message: 'Issue not found', error: 'Not Found' });
  });

  it.each([
    ['businessId: the other tenant (moving the contact out of the business)', C.mBiz, { businessId: ID.bizB }],
    ['ownerId', C.mOwner, { ownerId: ID.staffAll }],
    ['visibility', C.mVis, { visibility: 'PRIVATE' }],
    ['deletedAt', C.mDel, { deletedAt: '2026-11-15T00:00:00.000Z' }],
    ['phoneNormalized (around the identity rules)', C.mKey, { phoneNormalized: '+18687120001' }],
    ['a fillable field together with businessId', C.mMixed, { companyName: 'Mixed Ltd', businessId: ID.bizB }],
    ['firstName (a field the issue does not list)', C.mOther, { firstName: 'Changed' }],
    ["a Prisma operation object in place of the value ({ set: ... })", C.mOp, { companyName: { set: 'Op Ltd' } }],
  ])('RED-BEFORE: a crm-write STAFF filling %s is refused 400; nothing is written and the issue stays open', async (_label, contactId, values) => {
    const before = await snapshot(contactId);
    expect(before.contact).toMatchObject({ business_id: ID.bizA, deleted_at: null, company_name: null });
    const res = await apply(ID.staffAll, issueOf(contactId), { action: 'fill_fields', values });
    expectBadRequest(res);
    expect(await snapshot(contactId)).toEqual(before);
    expect(before.issue).toMatchObject({ status: 'open', resolvedAt: null, resolvedBy: null });
  });

  it("RED-BEFORE: an email that is not an email is refused 400 as the contact PATCH DTO refuses it; nothing is written", async () => {
    const before = await snapshot(C.eBad);
    const res = await apply(ID.staffAll, issueOf(C.eBad), { action: 'fill_fields', values: { email: `${P}not-an-email` } });
    expectBadRequest(res);
    expect(await snapshot(C.eBad)).toEqual(before);
  });

  it('RED-BEFORE: an email another live contact holds answers 409 contact_email_taken (the PATCH identity rule), not a database error; nothing is written', async () => {
    const before = await snapshot(C.eTaken);
    const res = await apply(ID.staffAll, issueOf(C.eTaken), { action: 'fill_fields', values: { email: OTHER_EMAIL.toUpperCase() } });
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(409);
    expect(res.body.code).toBe('contact_email_taken');
    expect(res.body.details).toEqual({ existingContactId: C.eHolder });
    expect(await snapshot(C.eTaken)).toEqual(before);
  });

  it("RED-BEFORE: a phone another live contact holds in E.164, typed the local way ('712-3601'), answers 409 contact_phone_taken; nothing is written", async () => {
    const before = await snapshot(C.pTaken);
    const res = await apply(ID.staffAll, issueOf(C.pTaken), { action: 'fill_fields', values: { phone: '712-3601' } });
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(409);
    expect(res.body.code).toBe('contact_phone_taken');
    expect(res.body.details).toEqual({ existingContactId: C.pHolder });
    expect(await snapshot(C.pTaken)).toEqual(before);
  });

  it('RED-BEFORE: the recommended email correction, when another live contact holds it, answers 409 contact_email_taken (not a database error); nothing is written and the issue stays open', async () => {
    const before = await snapshot(C.rTaken);
    const res = await apply(ID.owner, issueOf(C.rTaken));
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(409);
    expect(res.body.code).toBe('contact_email_taken');
    expect(res.body.details).toEqual({ existingContactId: C.rHolder });
    expect(await snapshot(C.rTaken)).toEqual(before);
  });

  it("RED-BEFORE: an email correction typed by the member that is not an email ('nope') is refused 400 as the contact PATCH DTO refuses it; nothing is written", async () => {
    const before = await snapshot(C.rBad);
    const res = await apply(ID.staffAll, issueOf(C.rBad), { action: 'replace_email', value: 'nope' });
    expectBadRequest(res);
    expect(await snapshot(C.rBad)).toEqual(before);
  });

  it("RED-BEFORE: a fill on a stale-data issue (whose fix writes no field) is refused 400; the contact keeps its company", async () => {
    const before = await snapshot(C.sFill);
    const res = await apply(ID.staffAll, issueOf(C.sFill), { action: 'fill_fields', values: { companyName: 'Hijack Ltd' } });
    expectBadRequest(res);
    expect(await snapshot(C.sFill)).toEqual(before);
  });

  it("RED-BEFORE: an email replacement named on a stale-data issue (another kind's action) is refused 400; the email is unchanged", async () => {
    const before = await snapshot(C.sEmail);
    const res = await apply(ID.staffAll, issueOf(C.sEmail), { action: 'replace_email', value: `${P}someone.else@test.local` });
    expectBadRequest(res);
    expect(await snapshot(C.sEmail)).toEqual(before);
  });

  it("CONTROL: bulk-apply cannot reach a fill either: a missing-company issue without values reports the plain refusal and writes nothing", async () => {
    const before = await snapshot(C.mBulk);
    const res = await bulkApply(ID.staffAll, [issueOf(C.mBulk)]);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    expect(res.body).toMatchObject({ applied: 0, failed: 1 });
    expect(res.body.results).toEqual([{ issueId: issueOf(C.mBulk), ok: false, error: 'No field values provided' }]);
    expect(await snapshot(C.mBulk)).toEqual(before);
  });
});

describe('legitimate fixes still apply, through the contact write, and are audited', () => {
  it("RED-BEFORE: filling the missing company stores it trimmed, resolves the issue and records one 'updated' ContactAuditEntry naming the member", async () => {
    const res = await apply(ID.staffAll, issueOf(C.mLegit), { action: 'fill_fields', values: { companyName: '  Acme Trading  ' } });
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    expect(res.body).toEqual({ issueId: issueOf(C.mLegit), status: 'resolved', applied: true });
    expect(await row(C.mLegit)).toMatchObject({ business_id: ID.bizA, owner_id: ID.owner, visibility: 'TEAM', deleted_at: null, company_name: 'Acme Trading' });
    expect(await issueRow(issueOf(C.mLegit))).toMatchObject({ status: 'resolved', resolvedBy: ID.staffAll });
    const entries = await audits(C.mLegit);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ businessId: ID.bizA, action: 'updated', actor: { type: 'USER', id: ID.staffAll } });
    expect(entries[0].changedFields).toContain('companyName');
    expect(entries[0].changedFields).not.toContain('businessId');
  });

  it("RED-BEFORE: filling the missing phone typed the local way ('712-3602') stores it in E.164 with its key, as the contact PATCH stores it, and is audited", async () => {
    const res = await apply(ID.staffAll, issueOf(C.pLegit), { action: 'fill_fields', values: { phone: '712-3602' } });
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    expect(res.body).toMatchObject({ status: 'resolved', applied: true });
    expect(await row(C.pLegit)).toMatchObject({ phone: '+18687123602', phone_normalized: '+18687123602' });
    const entries = await audits(C.pLegit);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'updated', actor: { type: 'USER', id: ID.staffAll } });
  });

  it("RED-BEFORE: the recommended email correction ('rita@gmial.com' to 'rita@gmail.com') applies, stamps the verification and is audited", async () => {
    const res = await apply(ID.owner, issueOf(C.rEmail));
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    expect(res.body).toMatchObject({ status: 'resolved', applied: true });
    const stored = await row(C.rEmail);
    expect(stored).toMatchObject({ email: `${P}rita@gmail.com`, email_normalized: `${P}rita@gmail.com` });
    expect(stored?.last_verified_at).toBeTruthy();
    const entries = await audits(C.rEmail);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'updated', actor: { type: 'USER', id: ID.owner } });
    expect(entries[0].changedFields).toContain('email');
  });

  it("RED-BEFORE: the recommended phone reformat ('868-712-3610' to '+18687123610') applies and is audited", async () => {
    const res = await apply(ID.owner, issueOf(C.rPhone));
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    expect(await row(C.rPhone)).toMatchObject({ phone: '+18687123610', phone_normalized: '+18687123610' });
    const entries = await audits(C.rPhone);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'updated', actor: { type: 'USER', id: ID.owner } });
    expect(entries[0].changedFields).toContain('phone');
  });

  it('RED-BEFORE: marking a stale contact verified applies and is audited', async () => {
    const res = await apply(ID.staffAll, issueOf(C.vStale));
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    expect((await row(C.vStale))?.last_verified_at).toBeTruthy();
    const entries = await audits(C.vStale);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'updated', actor: { type: 'USER', id: ID.staffAll } });
    expect(entries[0].changedFields).toContain('lastVerifiedAt');
  });
});

describe('apply, bulk-apply and dismiss act only on contacts the member may open', () => {
  it("RED-BEFORE: a 'my book' STAFF applying a fix to a contact outside their book gets the unknown issue's answer; nothing is written", async () => {
    const before = await snapshot(C.hBook);
    const res = await apply(ID.staffBook, issueOf(C.hBook));
    expect(answerOf(res)).toEqual(unknownAnswer);
    expect(await snapshot(C.hBook)).toEqual(before);
    expect(before.issue).toMatchObject({ status: 'open' });
  });

  it("RED-BEFORE: a 'my book' STAFF dismissing that issue gets the unknown issue's answer; the issue stays open", async () => {
    const before = await snapshot(C.hBook);
    const res = await dismiss(ID.staffBook, issueOf(C.hBook));
    expect(answerOf(res)).toEqual(unknownAnswer);
    expect(await snapshot(C.hBook)).toEqual(before);
  });

  it("RED-BEFORE: a 'my book' STAFF bulk-applying it is told exactly what an unknown issue id is told; nothing is written", async () => {
    const before = await snapshot(C.hBook);
    const unknownId = `${P}no_such_issue_2`;
    const res = await bulkApply(ID.staffBook, [issueOf(C.hBook), unknownId]);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    expect(res.body).toMatchObject({ applied: 0, failed: 2 });
    expect(res.body.results).toEqual([
      { issueId: issueOf(C.hBook), ok: false, error: 'Issue not found' },
      { issueId: unknownId, ok: false, error: 'Issue not found' },
    ]);
    expect(await snapshot(C.hBook)).toEqual(before);
  });

  it("CONTROL: the 'my book' STAFF fixes a contact in their book (owned by them)", async () => {
    const res = await apply(ID.staffBook, issueOf(C.own));
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    expect(res.body).toMatchObject({ status: 'resolved', applied: true });
    expect((await row(C.own))?.last_verified_at).toBeTruthy();
  });

  it("RED-BEFORE: a view-all STAFF cannot fill, bulk-apply or dismiss on another member's PRIVATE contact: the unknown issue's answer, nothing written", async () => {
    const before = await snapshot(C.hPriv);
    expect(answerOf(await apply(ID.staffAll, issueOf(C.hPriv), { action: 'fill_fields', values: { companyName: 'Peek Ltd' } }))).toEqual(unknownAnswer);
    const bulk = await bulkApply(ID.staffAll, [issueOf(C.hPriv)]);
    expect(bulk.body.results).toEqual([{ issueId: issueOf(C.hPriv), ok: false, error: 'Issue not found' }]);
    expect(answerOf(await dismiss(ID.staffAll, issueOf(C.hPriv)))).toEqual(unknownAnswer);
    expect(await snapshot(C.hPriv)).toEqual(before);
  });

  it("RED-BEFORE: a fix to a soft-deleted contact's leftover issue gets the unknown issue's answer (no member may open it); the deleted row is not written", async () => {
    const before = await snapshot(C.gone);
    expect(answerOf(await apply(ID.owner, issueOf(C.gone)))).toEqual(unknownAnswer);
    expect(await snapshot(C.gone)).toEqual(before);
  });

  it("RED-BEFORE: a STAFF who may see every contact but edit only their own (crm_edit 'owned') cannot fix another member's contact: 403 as the contact PATCH answers; nothing written", async () => {
    const before = await snapshot(C.edTeam);
    const res = await apply(ID.staffEdOwn, issueOf(C.edTeam));
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(403);
    expect(res.body.message).toBe('You can only edit contacts you own');
    expect(await snapshot(C.edTeam)).toEqual(before);
  });

  it("RED-BEFORE: a STAFF with crm_edit 'none' fixes no contact: 403 as the contact PATCH answers; nothing written", async () => {
    const before = await snapshot(C.edTeam);
    const res = await apply(ID.staffNoEd, issueOf(C.edTeam));
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(403);
    expect(res.body.message).toBe('You do not have permission to edit contacts');
    expect(await snapshot(C.edTeam)).toEqual(before);
  });

  it('CONTROL: the OWNER may fix that contact', async () => {
    const res = await apply(ID.owner, issueOf(C.edTeam));
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    expect(res.body).toMatchObject({ issueId: issueOf(C.edTeam), status: 'resolved' });
  });

  it('RED-BEFORE: after every case above, no contact this file seeded has left bizA for the other tenant', async () => {
    const moved: Array<{ id: string }> = await db.$queryRawUnsafe(
      `SELECT id FROM contacts WHERE id LIKE ${sqlLikePrefix(P)} AND business_id <> $1 ORDER BY id`, ID.bizA,
    );
    expect(moved).toEqual([]);
  });
});

// ---- review repairs SEC-DQ-1 and COR-DQMA-2 (owner rulings D-63, D-133) -----------------------
describe('the data-quality queue lists, counts and offers only the issues of contacts the member may open (review SEC-DQ-1, COR-DQMA-2)', () => {
  it("RED-BEFORE: a 'my book' STAFF's GET .../data-quality/issues lists, totals and counts by kind only the open issues of the live contacts in their book (owned by them or shared with them); a contact outside it is not named", async () => {
    const served = await okDq(ID.staffBook, 'issues?limit=200');
    const expected = await openIssuesFor('myBook', ID.staffBook);
    expect(idsOf(served.items)).toEqual(expected.map((i) => i.id));
    expect(served.total).toBe(expected.length);
    expect(served.byKind).toEqual(countByKind(expected));
    expect(idsOf(served.items)).toEqual(expect.arrayContaining([issueOf(C.lMine), issueOf(C.lShared), issueOf(C.bOwn)]));
    for (const hidden of [C.lHeld, C.hBook, C.hPriv, C.mvNoEd]) expect(idsOf(served.items), hidden).not.toContain(issueOf(hidden));
    const text = JSON.stringify(served);
    for (const mark of [C.lHeld, HIDDEN_EMAIL, HIDDEN_PHONE]) expect(text.includes(mark), `names ${mark}`).toBe(false);
  });

  it("RED-BEFORE: the list's search finds no contact outside the member's book (a hidden email answers as an absent one); the OWNER's same search finds it", async () => {
    const hidden = await okDq(ID.staffBook, 'issues?search=held.hidden');
    expect({ total: hidden.total, items: hidden.items }).toEqual({ total: 0, items: [] });
    const absent = await okDq(ID.staffBook, `issues?search=${P}no.such.address`);
    expect({ total: absent.total, items: absent.items }).toEqual({ total: 0, items: [] });
    // Control: the OWNER may open lHeld, so the OWNER's search finds it.
    const owner = await okDq(ID.owner, 'issues?search=held.hidden');
    expect(owner.total).toBe(1);
    expect(idsOf(owner.items)).toEqual([issueOf(C.lHeld)]);
  });

  it("RED-BEFORE: a view-all STAFF's list and counts leave out another member's PRIVATE contact (its issue, its email); the TEAM contacts they do not own are listed", async () => {
    const served = await okDq(ID.staffAll, 'issues?limit=200');
    const expected = await openIssuesFor('viewAll', ID.staffAll);
    expect(idsOf(served.items)).toEqual(expected.map((i) => i.id));
    expect(served.total).toBe(expected.length);
    expect(served.byKind).toEqual(countByKind(expected));
    expect(idsOf(served.items)).not.toContain(issueOf(C.hPriv));
    expect(idsOf(served.items)).toEqual(expect.arrayContaining([issueOf(C.hBook), issueOf(C.lHeld)]));
    expect(JSON.stringify(served).includes(`${P}priya@test.local`), "names hPriv's email").toBe(false);
  });

  it("RED-BEFORE: the fix wizard (GET .../data-quality/wizard) offers a 'my book' STAFF and a view-all STAFF only the open issues of the contacts they may open", async () => {
    for (const [actor, rule] of [[ID.staffBook, 'myBook'], [ID.staffAll, 'viewAll']] as const) {
      const served = await okDq(actor, 'wizard?limit=100');
      const expected = await openIssuesFor(rule, actor);
      expect(expected.length, `${actor}: fewer open issues than the wizard's page`).toBeLessThan(100);
      expect(idsOf(served.items), actor).toEqual(expected.map((i) => i.id));
    }
    const book = await okDq(ID.staffBook, 'wizard?limit=100');
    expect(JSON.stringify(book).includes(HIDDEN_EMAIL), "staffBook's wizard names lHeld's email").toBe(false);
  });

  it("CONTROL: every issue the list shows a 'my book' STAFF is one they may act on: dismissing one of them answers 201 dismissed", async () => {
    const served = await okDq(ID.staffBook, 'issues?limit=200');
    expect(idsOf(served.items)).toContain(issueOf(C.lShared));
    const res = await dismiss(ID.staffBook, issueOf(C.lShared));
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    expect(res.body).toEqual({ issueId: issueOf(C.lShared), status: 'dismissed' });
  });
});

// ---- review repair COR-DQMA-1 --------------------------------------------------------------
describe('the issues of a contact deleted or merged away leave the queue and its counts (review COR-DQMA-1)', () => {
  it("RED-BEFORE: the OWNER's list, wizard and stats cover the live contacts only: the open issue left on a soft-deleted contact is neither listed, offered, totalled nor counted by kind", async () => {
    const expected = await openIssuesFor('owner', ID.owner);
    const listed = await okDq(ID.owner, 'issues?limit=200');
    expect(idsOf(listed.items)).toEqual(expected.map((i) => i.id));
    expect(idsOf(listed.items)).not.toContain(issueOf(C.gone));
    // Control: the OWNER's list is business-wide over the live contacts (hidden from a member, not from the OWNER).
    expect(idsOf(listed.items)).toEqual(expect.arrayContaining([issueOf(C.hBook), issueOf(C.hPriv), issueOf(C.lHeld)]));
    expect(listed.total).toBe(expected.length);
    expect(listed.byKind).toEqual(countByKind(expected));
    const wizard = await okDq(ID.owner, 'wizard?limit=100');
    expect(expected.length).toBeLessThan(100);
    expect(idsOf(wizard.items)).toEqual(expected.map((i) => i.id));
    const stats = await okDq(ID.owner, 'stats');
    expect(stats.issueCounts).toEqual({ ...NO_ISSUES, ...countByKind(expected) });
  });

  it("RED-BEFORE: once the OWNER deletes a contact (DELETE contacts/:contactId), its open issue leaves the list, the wizard and the stats; dismissing it answers as an unknown issue id, since nothing shows it", async () => {
    const before = await okDq(ID.owner, 'issues?limit=200');
    expect(idsOf(before.items)).toContain(issueOf(C.dDel));
    const staleBefore = (await okDq(ID.owner, 'stats')).issueCounts.stale_data;

    const del = await deleteContact(ID.owner, C.dDel);
    expect(del.status, JSON.stringify(del.body).slice(0, 400)).toBe(200);
    expect((await row(C.dDel))?.deleted_at).toBeTruthy();

    const after = await okDq(ID.owner, 'issues?limit=200');
    expect(idsOf(after.items)).not.toContain(issueOf(C.dDel));
    expect(after.total).toBe(before.total - 1);
    expect(after.byKind.stale_data).toBe(before.byKind.stale_data - 1);
    expect(idsOf((await okDq(ID.owner, 'wizard?limit=100')).items)).not.toContain(issueOf(C.dDel));
    expect((await okDq(ID.owner, 'stats')).issueCounts.stale_data).toBe(staleBefore - 1);
    expect(answerOf(await dismiss(ID.owner, issueOf(C.dDel)))).toEqual(unknownAnswer);
  });

  it("RED-BEFORE: once the OWNER merges a suspected duplicate into its primary (POST contacts/:primaryId/merge/:duplicateId, the fix both issues recommend), the duplicate's issue leaves the queue and the primary's is cleared by applying it: no issue of the pair is left listed or counted", async () => {
    const before = await okDq(ID.owner, 'issues?kinds=suspected_duplicate&limit=200');
    expect(idsOf(before.items)).toEqual(expect.arrayContaining([issueOf(C.mgP), issueOf(C.mgD)]));

    const merged = await mergeContacts(ID.owner, C.mgP, C.mgD);
    expect(merged.status, JSON.stringify(merged.body).slice(0, 400)).toBe(201);
    expect((await row(C.mgD))?.deleted_at).toBeTruthy();

    const afterMerge = await okDq(ID.owner, 'issues?kinds=suspected_duplicate&limit=200');
    expect(idsOf(afterMerge.items)).not.toContain(issueOf(C.mgD));
    expect(idsOf(afterMerge.items)).toContain(issueOf(C.mgP));

    const cleared = await apply(ID.owner, issueOf(C.mgP));
    expect(cleared.status, JSON.stringify(cleared.body).slice(0, 400)).toBe(201);
    expect(cleared.body).toEqual({ issueId: issueOf(C.mgP), status: 'resolved', applied: true });

    const after = await okDq(ID.owner, 'issues?kinds=suspected_duplicate&limit=200');
    for (const id of [C.mgP, C.mgD]) expect(idsOf(after.items)).not.toContain(issueOf(id));
    const expected = await openIssuesFor('owner', ID.owner);
    expect((await okDq(ID.owner, 'stats')).issueCounts.suspected_duplicate).toBe(countByKind(expected).suspected_duplicate ?? 0);
    expect(idsOf((await okDq(ID.owner, 'wizard?limit=100')).items)).not.toContain(issueOf(C.mgD));
  });
});

// ---- review repair SEC-DQ-2 ----------------------------------------------------------------
describe('bulk-apply takes issue ids, nothing else (review SEC-DQ-2)', () => {
  it("RED-BEFORE: an issueIds element that is not text (a filter object such as { endsWith: ... }) is refused 400 and nothing is applied: the member's own contact keeps its stamp, its issue stays open, no audit entry is written", async () => {
    const before = await snapshot(C.bOwn);
    expect(before.issue).toMatchObject({ status: 'open' });
    const res = await bulkApply(ID.staffBook, [{ endsWith: 'c_bOwn_i' }]);
    expectBadRequest(res);
    expect(res.body.message).toBe('issueIds must be a list of issue ids');
    expect(JSON.stringify(res.body).includes('endsWith')).toBe(false);
    expect(await snapshot(C.bOwn)).toEqual(before);
  });

  it('RED-BEFORE: a list mixing a real issue id with a filter object is refused whole (400); the real one is not applied either', async () => {
    const before = await snapshot(C.bOwn);
    const res = await bulkApply(ID.staffBook, [issueOf(C.bOwn), { startsWith: `${P}x_` }]);
    expectBadRequest(res);
    expect(res.body.message).toBe('issueIds must be a list of issue ids');
    expect(await snapshot(C.bOwn)).toEqual(before);
  });

  it("RED-BEFORE: a prefix probe ({ startsWith: ... }) gets the same 400 whether or not an issue id starts with it, so it tells nothing", async () => {
    const hit = await bulkApply(ID.staffBook, [{ startsWith: `${P}c_bOwn` }]);
    const miss = await bulkApply(ID.staffBook, [{ startsWith: `${P}zzz` }]);
    expect(answerOf(hit)).toEqual(answerOf(miss));
    expect(hit.status).toBe(400);
  });

  it("CONTROL: the same member's bulk-apply of the issue's id applies it", async () => {
    const res = await bulkApply(ID.staffBook, [issueOf(C.bOwn)]);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    expect(res.body).toEqual({ results: [{ issueId: issueOf(C.bOwn), ok: true }], applied: 1, failed: 0 });
    expect((await row(C.bOwn))?.last_verified_at).toBeTruthy();
  });
});

// ---- review repair SEC-DQ-3 (owner ruling D-25) ---------------------------------------------
describe("POST contacts/:contactId/data-quality/mark-verified keeps the contact PATCH's edit rule and is audited (review SEC-DQ-3)", () => {
  it("CONTROL: a 'my book' STAFF marking a contact outside their book verified gets 404 Contact not found (GET detail's rule); nothing is written", async () => {
    const before = await snapshot(C.mvNoEd);
    const res = await markVerified(ID.staffBook, C.mvNoEd);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(404);
    expect(res.body.message).toBe('Contact not found');
    expect(await snapshot(C.mvNoEd)).toEqual(before);
  });

  it("RED-BEFORE: a STAFF with crm_edit 'none' gets 403 as the contact PATCH answers; the stamp, the stale-data issue and the audit trail are unchanged", async () => {
    const before = await snapshot(C.mvNoEd);
    expect(before.contact?.last_verified_at).toBeNull();
    const res = await markVerified(ID.staffNoEd, C.mvNoEd);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(403);
    expect(res.body.message).toBe('You do not have permission to edit contacts');
    expect(await snapshot(C.mvNoEd)).toEqual(before);
  });

  it("RED-BEFORE: a STAFF who may see every contact but edit only their own (crm_edit 'owned') gets 403 'You can only edit contacts you own'; nothing is written", async () => {
    const before = await snapshot(C.mvNoEd);
    const res = await markVerified(ID.staffEdOwn, C.mvNoEd);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(403);
    expect(res.body.message).toBe('You can only edit contacts you own');
    expect(await snapshot(C.mvNoEd)).toEqual(before);
  });

  it("RED-BEFORE: a member who may edit the contact (crm 'write') marks it verified: the stamp is set, its stale-data issue is resolved by that member (not 'user'), and one 'updated' ContactAuditEntry names the member", async () => {
    const res = await markVerified(ID.staffAll, C.mvNoEd);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect((await row(C.mvNoEd))?.last_verified_at).toBeTruthy();
    expect(await issueRow(issueOf(C.mvNoEd))).toMatchObject({ status: 'resolved', resolvedBy: ID.staffAll });
    const entries = await audits(C.mvNoEd);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ businessId: ID.bizA, action: 'updated', actor: { type: 'USER', id: ID.staffAll } });
    expect(entries[0].changedFields).toContain('lastVerifiedAt');
  });
});
