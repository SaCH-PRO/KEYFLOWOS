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
  rPhone: `${P}c_rPhone`,
  vStale: `${P}c_vStale`,
  // visibility and edit scope
  hBook: `${P}c_hBook`,       // TEAM, owned by the OWNER: outside staffBook's book
  own: `${P}c_own`,           // TEAM, owned by staffBook
  hPriv: `${P}c_hPriv`,       // PRIVATE, owned by the OWNER: hidden from staffAll
  edTeam: `${P}c_edTeam`,     // TEAM, owned by the OWNER: visible to staffEdOwn, not theirs to edit
  gone: `${P}c_gone`,         // soft-deleted, with an open issue left behind
};
/** The open issue seeded for contact `c` is `${c}_i`. */
const issueOf = (contactId: string) => `${contactId}_i`;

const OTHER_EMAIL = 'mina.holder@v71n.test';
const HELD_PHONE_E164 = '+18687123601';

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

function bulkApply(actor: string, issueIds: string[]) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/data-quality/bulk-apply`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ issueIds });
}

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
  for (const id of [ID.owner, ID.ownerB, ID.staffAll, ID.staffBook, ID.staffEdOwn, ID.staffNoEd]) {
    await db.user.create({ data: { id, email: `${id}@test.local`, role: 'USER' } });
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
    const email = `${firstName.toLowerCase()}@v71n.test`;
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
    const email = `${firstName.toLowerCase()}@v71n.test`;
    await contact(id, { firstName, relationshipType: 'CLIENT', email, emailNormalized: email });
    await issue(id, missingPhone);
  }
  await contact(C.pHolder, { firstName: 'Hal', phone: HELD_PHONE_E164, phoneNormalized: HELD_PHONE_E164 });
  // Stale contacts, for the actions another kind offers.
  for (const [id, firstName] of [[C.sFill, 'Sal'], [C.sEmail, 'Sue']] as const) {
    const email = `${firstName.toLowerCase()}@v71n.test`;
    await contact(id, { firstName, email, emailNormalized: email, companyName: `${firstName} Co` });
    await issue(id, stale);
  }
  // The other actions, as recommended.
  await contact(C.rEmail, { firstName: 'Rita', email: 'rita@gmial.com', emailNormalized: 'rita@gmial.com' });
  await issue(C.rEmail, {
    kind: 'invalid_email', severity: 'high', field: 'email', message: 'Email address is not in a valid format.',
    recommendedFix: { action: 'replace_email', value: 'rita@gmail.com' },
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
  await contact(C.hPriv, { firstName: 'Priya', visibility: 'PRIVATE', relationshipType: 'VENDOR', email: 'priya@v71n.test', emailNormalized: 'priya@v71n.test' });
  await issue(C.hPriv, missingCompany);
  await contact(C.edTeam, { firstName: 'Ted' });
  await issue(C.edTeam, stale);
  await contact(C.gone, { firstName: 'Gus', deletedAt: new Date('2026-11-01T00:00:00Z') });
  await issue(C.gone, stale);

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
    const res = await apply(ID.staffAll, issueOf(C.eBad), { action: 'fill_fields', values: { email: 'not-an-email' } });
    expectBadRequest(res);
    expect(await snapshot(C.eBad)).toEqual(before);
  });

  it('RED-BEFORE: an email another live contact holds answers 409 contact_email_taken (the PATCH identity rule), not a database error; nothing is written', async () => {
    const before = await snapshot(C.eTaken);
    const res = await apply(ID.staffAll, issueOf(C.eTaken), { action: 'fill_fields', values: { email: ` ${OTHER_EMAIL.toUpperCase()} ` } });
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

  it("RED-BEFORE: a fill on a stale-data issue (whose fix writes no field) is refused 400; the contact keeps its company", async () => {
    const before = await snapshot(C.sFill);
    const res = await apply(ID.staffAll, issueOf(C.sFill), { action: 'fill_fields', values: { companyName: 'Hijack Ltd' } });
    expectBadRequest(res);
    expect(await snapshot(C.sFill)).toEqual(before);
  });

  it("RED-BEFORE: an email replacement named on a stale-data issue (another kind's action) is refused 400; the email is unchanged", async () => {
    const before = await snapshot(C.sEmail);
    const res = await apply(ID.staffAll, issueOf(C.sEmail), { action: 'replace_email', value: 'someone.else@v71n.test' });
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
    expect(stored).toMatchObject({ email: 'rita@gmail.com', email_normalized: 'rita@gmail.com' });
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
