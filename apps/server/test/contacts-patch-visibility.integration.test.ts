/**
 * R0-13c-CT-PATCH-VISIBILITY — PATCH /crm/businesses/:businessId/contacts/:contactId
 * honours record visibility and business membership, against a REAL database.
 *
 * Handed off by the R0-03-CT-AUDIT-ACTOR review (ST-A high severity, ST-B
 * should-fix), each reproduced on a real database:
 *   - ST-A: GET detail applies the caller's CRM visibility (resolveCrmAccess +
 *     visibilityClause, the PR #190 semantics), so a STAFF member with the
 *     default crm 'write' scope (editScope 'any', viewAll) gets 404 for another
 *     member's PRIVATE contact. PATCH did not: CrmService.updateContact checked
 *     only editScope none/owned and read the row with the tenant predicate
 *     alone, so PATCH {} answered 200 with the full row (email, phone,
 *     notesInternal) and PATCH {jobTitle} edited it. A 'my book' member (crm_view
 *     owned) could edit any TEAM contact the same way, a crm_reassign member
 *     could take another member's PRIVATE contact by PATCHing ownerId to
 *     themself, and a crm_edit 'owned' member got 403 for an invisible contact
 *     but 404 for an unknown id (an existence oracle).
 *   - ST-B: a PATCH that changes ownerId did not check that the new owner is a
 *     member of the business. The owner could write another tenant's user, a
 *     crm_reassign member an id that is no user at all, and the owner '' into
 *     owner_id, and the 'reassigned' audit entry named the outsider, where
 *     POST /contacts/bulk/reassign and POST /contacts refuse them with 400.
 *
 * The contract proven here: a contact the caller cannot see answers PATCH with
 * a 404 byte-identical to an unknown id (timestamp and the echoed path aside),
 * with nothing written and no field of the row in the body, whatever the body
 * asks for; a visible contact the caller may not edit keeps today's 403; a
 * changed ownerId is accepted only when it names a member of the path
 * business, otherwise 400 with the message bulk reassign gives and nothing
 * written; resending the current owner is not a change. Positive controls: the
 * owner and STAFF members edit their own, shared and TEAM contacts, and a
 * reassignment to a real member works.
 *
 * Review repairs (the cases at the end of the file): resending the current
 * owner is decided on the row locked in the PATCH transaction, so it cannot
 * undo a reassignment committing concurrently (ST-R1); DELETE and bulk DELETE
 * apply the same visibility clause, so a contact the caller cannot see answers
 * a single DELETE like an unknown id and is skipped by a bulk one (ST-R2).
 *
 * Nothing on the HTTP or persistence path is mocked: PrismaService, the user,
 * business, membership, contact and share rows, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, PlanLimitGuard, TeamAuditInterceptor,
 * the global ValidationPipe and GlobalHttpExceptionFilter, CrmController,
 * CrmService, CrmStatsService, CrmTimelineService and ContactAuditService are
 * all real against DATABASE_URL. The stand-ins: identity attachment (a test
 * middleware reads `x-test-user` and attaches the seeded user row as
 * AuthMiddleware would), the timeline service's side channels, the caches and
 * the plan limit (a stub that allows). The app trusts the proxy header as
 * app-bootstrap.ts does and every request carries its own x-forwarded-for
 * address, so the real rate-limit guard runs without capping the case count.
 *
 * Requires DATABASE_URL. Every seeded row carries the `k13c_` prefix and is
 * hard-deleted by raw SQL in beforeAll and afterAll. No $transaction wrapping.
 * Cases tagged NEGATIVE CONTROL are the pre-fix failing controls. The case list
 * is bound by scripts/proof-admission/manifests/contacts-patch-visibility.json
 * (allowAdditionalCases false).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k13c_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA
  staff: `${P}staff`, // STAFF of bizA, crm: write (viewAll, edit any, no reassign)
  staffB: `${P}staffB`, // STAFF of bizA, crm: write; owns the PRIVATE contacts
  reassigner: `${P}reassigner`, // STAFF of bizA, crm: write + crm_reassign 'true'
  editOwned: `${P}editOwned`, // STAFF of bizA, crm: write + crm_edit 'owned'
  myBook: `${P}myBook`, // STAFF of bizA, crm: write + crm_view 'owned'
  outsider: `${P}outsider`, // OWNER of bizB, no membership in bizA
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};
const UNKNOWN_CONTACT = `${P}c_unknown`;
const NOT_A_USER = `${P}not-a-user-at-all`;
const DEPARTED = `${P}departed`; // a legacy owner_id naming nobody in bizA
const SENSITIVE_NOTES = 'k13c-sensitive-internal-notes-5d1e';
const SENSITIVE_PHONE = '+15550131313';
const MEMBER_MESSAGE = 'newOwnerId must belong to a member of this business';

let db: any;
let app: any;
let crm: any; // the real CrmService

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension).
  for (const sql of [
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

let ipSeq = 0;
/** A distinct client address per request, so the real per-IP rate limit never caps the suite. */
function nextIp() {
  ipSeq += 1;
  return `10.13.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
}

function patch(actor: string, contactId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(`/crm/businesses/${ID.bizA}/contacts/${contactId}`)
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

function del(actor: string, contactId: string) {
  return request(app.getHttpServer())
    .delete(`/crm/businesses/${ID.bizA}/contacts/${contactId}`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp());
}

function bulkDelete(actor: string, contactIds: string[]) {
  return request(app.getHttpServer())
    .delete(`/crm/businesses/${ID.bizA}/contacts/bulk`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ contactIds });
}

function bulkReassign(actor: string, contactIds: string[], newOwnerId: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/contacts/bulk/reassign`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ contactIds, newOwnerId });
}

let seq = 0;
/** A live bizA contact seeded directly (no route traffic), carrying sensitive fields. */
async function seedContact(opts: { visibility: 'PRIVATE' | 'TEAM' | 'SHARED'; ownerId: string | null; shareWith?: string[] }) {
  seq += 1;
  const id = `${P}c_${seq}`;
  const email = `${P}secret-${seq}@test.local`;
  const contact = await db.contact.create({
    data: {
      id,
      businessId: ID.bizA,
      firstName: `${P}Secret${seq}`,
      lastName: 'Holder',
      email,
      emailNormalized: email,
      phone: `${SENSITIVE_PHONE}${seq}`,
      notesInternal: `${SENSITIVE_NOTES}-${seq}`,
      visibility: opts.visibility,
      ownerId: opts.ownerId,
    },
  });
  for (const userId of opts.shareWith ?? []) {
    await db.contactShare.create({
      data: { id: `${P}share_${seq}_${userId.slice(P.length)}`, businessId: ID.bizA, contactId: id, userId, createdBy: ID.owner },
    });
  }
  return contact;
}

/**
 * The raw row, every column (updated_at included, the tsvector as text), read
 * past the soft-delete extension: "nothing written" compares it whole.
 */
async function rawRow(contactId: string): Promise<Record<string, unknown>> {
  const rows: Array<{ row: string }> = await db.$queryRawUnsafe(
    'SELECT to_jsonb(c)::text AS row FROM contacts c WHERE c.id = $1', contactId,
  );
  return JSON.parse(rows[0].row);
}

/** Every durable trace a contact PATCH writes for the tenant. */
async function traceCounts() {
  const [contactEvents, audits, teamLogs] = await Promise.all([
    db.contactEvent.count({ where: { businessId: ID.bizA } }),
    db.contactAuditEntry.count({ where: { businessId: ID.bizA } }),
    db.teamActivityLog.count({ where: { businessId: ID.bizA } }),
  ]);
  return { contactEvents, audits, teamLogs };
}

/** The ContactAuditEntry write is fire-and-forget (DEC-CONTACTS-002): wait for it to land. */
async function auditEntries(contactId: string, action: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await db.contactAuditEntry.findMany({
      where: { businessId: ID.bizA, contactId, action },
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length > 0 || Date.now() > deadline) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Let any fire-and-forget write a request might have started reach the database. */
const settle = () => new Promise((r) => setTimeout(r, 300));

/** The error body with the two per-request fields (timestamp, echoed path) normalised. */
function normalisedError(res: { text: string }, contactId: string) {
  return res.text
    .replace(/"timestamp":"[^"]*"/, '"timestamp":"<t>"')
    .split(contactId).join('<contactId>');
}

/**
 * A refused PATCH on a contact the caller cannot see: 404, the same bytes as an
 * unknown id, and nothing of the row in the body.
 */
async function expectAnswersLikeUnknown(
  actor: string,
  contact: { id: string; email: string | null; phone: string | null; notesInternal: string | null },
  body: Record<string, unknown>,
) {
  await expectRefusedLikeUnknown((contactId) => patch(actor, contactId, body), contact);
}

/** The same contract for any single-contact request `send` (PATCH, DELETE). */
async function expectRefusedLikeUnknown(
  send: (contactId: string) => Promise<{ status: number; body: any; text: string; headers: Record<string, string> }>,
  contact: { id: string; email: string | null; phone: string | null; notesInternal: string | null },
) {
  const forbidden = await send(contact.id);
  const absent = await send(UNKNOWN_CONTACT);
  expect(forbidden.status).toBe(404);
  expect(absent.status).toBe(404);
  expect(forbidden.body).toMatchObject({ statusCode: 404, message: 'Contact not found', error: 'Not Found' });
  expect(normalisedError(forbidden, contact.id)).toBe(normalisedError(absent, UNKNOWN_CONTACT));
  expect(forbidden.headers['content-type']).toBe(absent.headers['content-type']);
  for (const key of ['id', 'email', 'phone', 'notesInternal', 'firstName', 'ownerId', 'visibility']) {
    expect(forbidden.body).not.toHaveProperty(key);
  }
  for (const secret of [contact.email, contact.phone, contact.notesInternal]) {
    expect(forbidden.text).not.toContain(String(secret));
  }
}

/** Run `act` and assert it changed neither the contact row nor any trace of the tenant. */
async function expectNothingWritten(contactId: string, act: () => Promise<void>) {
  await settle(); // an earlier case's fire-and-forget writes land before the snapshot
  const rowBefore = await rawRow(contactId);
  const tracesBefore = await traceCounts();
  await act();
  await settle();
  expect(await rawRow(contactId)).toEqual(rowBefore);
  expect(await traceCounts()).toEqual(tracesBefore);
  expect(await db.contactEvent.count({ where: { contactId } })).toBe(0);
  expect(await db.contactAuditEntry.count({ where: { contactId } })).toBe(0);
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

  // ---- the real HTTP path (wired before any row is seeded) ----------------
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
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      // CrmTimelineService's side channels; the ContactEvent row itself is the
      // real write inside the contact transaction.
      { provide: TimelineService, useValue: { recordEvent: async () => undefined } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: CrmCacheService, useValue: { invalidate: async () => undefined } },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmListsService, useValue: {} },
      { provide: EntityResolutionService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      { provide: CrmImportService, useValue: {} },
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
  // Identity attachment only, for seeded k13c_ users. No guard is overridden.
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
  crm = app.get(CrmService);

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenants, memberships -----------------------------------
  const users: Array<[string, string]> = [
    [ID.owner, `${P}owner@test.local`],
    [ID.staff, `${P}staff@test.local`],
    [ID.staffB, `${P}staffB@test.local`],
    [ID.reassigner, `${P}reassigner@test.local`],
    [ID.editOwned, `${P}editOwned@test.local`],
    [ID.myBook, `${P}myBook@test.local`],
    [ID.outsider, `${P}outsider@test.local`],
  ];
  for (const [id, email] of users) {
    await db.user.create({ data: { id, email, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'K13C Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'K13C Biz B', ownerId: ID.outsider } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_staff`, userId: ID.staff, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write' } } });
  await db.membership.create({ data: { id: `${P}m_staffB`, userId: ID.staffB, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write' } } });
  await db.membership.create({
    data: { id: `${P}m_reassigner`, userId: ID.reassigner, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write', crm_reassign: 'true' } },
  });
  await db.membership.create({
    data: { id: `${P}m_editOwned`, userId: ID.editOwned, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write', crm_edit: 'owned' } },
  });
  await db.membership.create({
    data: { id: `${P}m_myBook`, userId: ID.myBook, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write', crm_view: 'owned' } },
  });
  await db.membership.create({ data: { id: `${P}m_outsider_bizB`, userId: ID.outsider, businessId: ID.bizB, role: 'OWNER' } });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it("seeded two tenants and six bizA members; the crm 'write' STAFF member gets 404 on GET for another member's PRIVATE contact and 200 for their TEAM one", async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(6);
    expect(await db.membership.count({ where: { businessId: ID.bizB } })).toBe(1);
    expect(await db.membership.count({ where: { businessId: ID.bizA, userId: ID.outsider } })).toBe(0);

    const priv = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    const team = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    expect((await detail(ID.staff, priv.id)).status).toBe(404);
    const visible = await detail(ID.staff, team.id);
    expect(visible.status).toBe(200);
    expect(visible.body.contact.id).toBe(team.id);
    expect((await detail(ID.staffB, priv.id)).status).toBe(200);
  });
});

describe('ST-A: PATCH applies the GET visibility clause: a contact the caller cannot see answers like an unknown id', () => {
  it("NEGATIVE CONTROL: PATCH {} by a crm 'write' STAFF member on another member's PRIVATE contact answers 404 byte-identical to an unknown id, echoes no field and writes nothing", async () => {
    const contact = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    await expectNothingWritten(contact.id, () => expectAnswersLikeUnknown(ID.staff, contact, {}));
  });

  it('NEGATIVE CONTROL: PATCH {jobTitle} by the same member answers 404 like an unknown id; the row, events and audit entries are unchanged', async () => {
    const contact = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    await expectNothingWritten(contact.id, () => expectAnswersLikeUnknown(ID.staff, contact, { jobTitle: `${P}Hijacked` }));
    expect((await rawRow(contact.id)).job_title).toBeNull();
  });

  it('NEGATIVE CONTROL: a reassignment bundled into the PATCH answers 404, not the reassign 403, for a member without crm_reassign, and the owner is unchanged', async () => {
    const contact = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    await expectNothingWritten(contact.id, () => expectAnswersLikeUnknown(ID.staff, contact, { ownerId: ID.staff, jobTitle: `${P}Bundled` }));
    expect((await rawRow(contact.id)).owner_id).toBe(ID.staffB);
  });

  it("NEGATIVE CONTROL: a STAFF member granted crm_reassign cannot take another member's PRIVATE contact by PATCHing ownerId to themself (404 like an unknown id, owner unchanged)", async () => {
    const contact = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    await expectNothingWritten(contact.id, () => expectAnswersLikeUnknown(ID.reassigner, contact, { ownerId: ID.reassigner }));
    expect((await rawRow(contact.id)).owner_id).toBe(ID.staffB);
  });

  it("NEGATIVE CONTROL: a 'my book' member (crm_view owned) gets 404 like an unknown id on PATCH for another member's TEAM contact, as on GET", async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    expect((await detail(ID.myBook, contact.id)).status).toBe(404);
    await expectNothingWritten(contact.id, () => expectAnswersLikeUnknown(ID.myBook, contact, { jobTitle: `${P}Hijacked` }));
  });

  it("NEGATIVE CONTROL: a member whose crm_edit is 'owned' gets 404 like an unknown id, not the edit-scope 403, on PATCH for another member's PRIVATE contact", async () => {
    const contact = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    await expectNothingWritten(contact.id, () => expectAnswersLikeUnknown(ID.editOwned, contact, { jobTitle: `${P}Hijacked` }));
  });

  it("a visible contact the member may not edit keeps today's 403: crm_edit 'owned' on another member's TEAM contact, nothing written", async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    expect((await detail(ID.editOwned, contact.id)).status).toBe(200);
    await expectNothingWritten(contact.id, async () => {
      const res = await patch(ID.editOwned, contact.id, { jobTitle: `${P}Refused` });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You can only edit contacts you own');
      expect(res.text).not.toContain(String(contact.email));
    });
  });

  it("positive control: the business owner edits another member's PRIVATE contact (200, recorded as updated by the owner)", async () => {
    const contact = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    const res = await patch(ID.owner, contact.id, { jobTitle: 'Owner edit' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: contact.id, jobTitle: 'Owner edit', ownerId: ID.staffB });
    const audits = await auditEntries(contact.id, 'updated');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'USER', id: ID.owner });
  });

  it("positive control: a crm 'write' STAFF member edits their own PRIVATE contact, a PRIVATE contact shared with them and another member's TEAM contact (200 each, persisted)", async () => {
    const own = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staff });
    const shared = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB, shareWith: [ID.staff] });
    const team = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    for (const contact of [own, shared, team]) {
      const res = await patch(ID.staff, contact.id, { jobTitle: 'Staff edit' });
      expect(res.status, contact.id).toBe(200);
      expect(res.body).toMatchObject({ id: contact.id, jobTitle: 'Staff edit' });
      expect((await rawRow(contact.id)).job_title, contact.id).toBe('Staff edit');
      const audits = await auditEntries(contact.id, 'updated');
      expect(audits, contact.id).toHaveLength(1);
      expect(audits[0].actor, contact.id).toEqual({ type: 'USER', id: ID.staff });
    }
  });

  it("positive control: a crm_edit 'owned' member edits a contact they own, and a 'my book' member edits a PRIVATE contact shared with them", async () => {
    const owned = await seedContact({ visibility: 'TEAM', ownerId: ID.editOwned });
    const byOwned = await patch(ID.editOwned, owned.id, { jobTitle: 'Owned edit' });
    expect(byOwned.status).toBe(200);
    expect((await rawRow(owned.id)).job_title).toBe('Owned edit');

    const shared = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB, shareWith: [ID.myBook] });
    const byMyBook = await patch(ID.myBook, shared.id, { jobTitle: 'My book edit' });
    expect(byMyBook.status).toBe(200);
    expect((await rawRow(shared.id)).job_title).toBe('My book edit');
  });
});

describe('ST-B: a PATCH that changes ownerId must name a member of this business', () => {
  it('bulk reassign already refuses a non-member owner with 400 (the reference refusal PATCH must match)', async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.owner });
    await expectNothingWritten(contact.id, async () => {
      const res = await bulkReassign(ID.owner, [contact.id], ID.outsider);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(MEMBER_MESSAGE);
    });
  });

  it("NEGATIVE CONTROL: the owner PATCHing ownerId to another tenant's user answers 400 with the bulk reassign message and writes nothing", async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.owner });
    await expectNothingWritten(contact.id, async () => {
      const res = await patch(ID.owner, contact.id, { ownerId: ID.outsider });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(MEMBER_MESSAGE);
      expect(res.text).not.toContain(String(contact.email));
    });
    expect((await rawRow(contact.id)).owner_id).toBe(ID.owner);
  });

  it('NEGATIVE CONTROL: a crm_reassign STAFF member PATCHing ownerId to an id that is no user at all answers 400 and writes nothing', async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    await expectNothingWritten(contact.id, async () => {
      const res = await patch(ID.reassigner, contact.id, { ownerId: NOT_A_USER });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(MEMBER_MESSAGE);
    });
    expect((await rawRow(contact.id)).owner_id).toBe(ID.staffB);
  });

  it("NEGATIVE CONTROL: the owner PATCHing ownerId to '' answers 400 and writes nothing", async () => {
    for (const ownerId of [ID.owner, null]) {
      const contact = await seedContact({ visibility: 'TEAM', ownerId });
      await expectNothingWritten(contact.id, async () => {
        const res = await patch(ID.owner, contact.id, { ownerId: '' });
        expect(res.status, `owner ${ownerId}`).toBe(400);
        expect(res.body.message, `owner ${ownerId}`).toBe(MEMBER_MESSAGE);
      });
      expect((await rawRow(contact.id)).owner_id, `owner ${ownerId}`).toBe(ownerId);
    }
  });

  it('NEGATIVE CONTROL: a non-member owner bundled with an ordinary edit is refused whole (400, no partial write, no reassigned entry naming the outsider)', async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.owner });
    await expectNothingWritten(contact.id, async () => {
      const res = await patch(ID.reassigner, contact.id, { ownerId: ID.outsider, jobTitle: `${P}Bundled` });
      expect(res.status).toBe(400);
    });
    expect(await rawRow(contact.id)).toMatchObject({ owner_id: ID.owner, job_title: null });
    expect(await db.contactAuditEntry.count({ where: { contactId: contact.id, action: 'reassigned' } })).toBe(0);
  });

  it('NEGATIVE CONTROL: a system-context updateContact (no actor) naming a non-member owner is refused the same way and writes nothing', async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.owner });
    await expectNothingWritten(contact.id, async () => {
      await expect(crm.updateContact({ businessId: ID.bizA, contactId: contact.id, ownerId: ID.outsider }))
        .rejects.toMatchObject({ status: 400, message: MEMBER_MESSAGE });
    });
  });

  it('positive control: the owner reassigns a contact to a member through PATCH (200, the reassigned audit entry names the owner and the new member)', async () => {
    const contact = await seedContact({ visibility: 'PRIVATE', ownerId: ID.owner });
    const res = await patch(ID.owner, contact.id, { ownerId: ID.staffB });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: contact.id, ownerId: ID.staffB });
    expect((await rawRow(contact.id)).owner_id).toBe(ID.staffB);
    const audits = await auditEntries(contact.id, 'reassigned');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'USER', id: ID.owner });
    expect(audits[0].reason).toContain(ID.staffB);
  });

  it('positive control: a crm_reassign STAFF member reassigns a visible TEAM contact to another member, and to themself, through PATCH', async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.owner });
    const toOther = await patch(ID.reassigner, contact.id, { ownerId: ID.staffB });
    expect(toOther.status).toBe(200);
    expect((await rawRow(contact.id)).owner_id).toBe(ID.staffB);
    const toSelf = await patch(ID.reassigner, contact.id, { ownerId: ID.reassigner });
    expect(toSelf.status).toBe(200);
    expect((await rawRow(contact.id)).owner_id).toBe(ID.reassigner);
    const audits = await auditEntries(contact.id, 'reassigned');
    expect(audits.length).toBeGreaterThanOrEqual(1);
    for (const entry of audits) expect(entry.actor).toEqual({ type: 'USER', id: ID.reassigner });
  });

  it('resending the current owner is not a reassignment: 200 even when that owner is not a member, and only the edited field changes', async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: DEPARTED });
    const res = await patch(ID.owner, contact.id, { ownerId: DEPARTED, jobTitle: 'Kept owner' });
    expect(res.status).toBe(200);
    expect(await rawRow(contact.id)).toMatchObject({ owner_id: DEPARTED, job_title: 'Kept owner' });
    const updated = await auditEntries(contact.id, 'updated');
    expect(updated).toHaveLength(1);
    await settle();
    expect(await db.contactAuditEntry.count({ where: { contactId: contact.id, action: 'reassigned' } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Review repairs (R0-13c-CT-PATCH-VISIBILITY review ST-R1, ST-R2), each
// reproduced against the real database. Cases tagged NEGATIVE CONTROL fail on
// the reviewed head 45ede9cf.
// ---------------------------------------------------------------------------

/** Poll `probe` until it holds, or fail with `what` after `timeoutMs`. */
async function waitUntil(what: string, probe: () => Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await probe())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('ST-B: resending the current owner is decided on the locked row, so it cannot undo a concurrent reassignment', () => {
  it('NEGATIVE CONTROL: a member without crm_reassign who resends the stale owner while a reassignment commits is refused 403 like the same request sent afterwards; the new owner stays and nothing else is written', async () => {
    // DEPARTED names nobody in bizA, so restoring it would also bypass the membership check.
    const contact = await seedContact({ visibility: 'TEAM', ownerId: DEPARTED });
    const body = { ownerId: DEPARTED, jobTitle: `${P}Stale form` };
    await settle();
    const tracesBefore = await traceCounts();

    // A legitimate reassignment DEPARTED -> staffB holds the row lock and commits
    // only once the PATCH is blocked behind it, so the PATCH has necessarily
    // started its transaction while owner_id still read DEPARTED to everyone else.
    let patched: any;
    let patchDone: Promise<void> | undefined;
    await db.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe('UPDATE contacts SET owner_id = $1 WHERE id = $2', ID.staffB, contact.id);
      const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
      patchDone = patch(ID.staff, contact.id, body).then((res) => { patched = res; });
      await waitUntil("the PATCH waits on the reassignment's row lock", async () => {
        const rows: Array<{ n: number }> = await db.$queryRawUnsafe(
          'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', pid,
        );
        return rows[0].n > 0;
      });
    }, { timeout: 15_000, maxWait: 5_000 });
    await patchDone;

    expect(patched.status).toBe(403);
    expect(patched.body.message).toBe('You do not have permission to reassign contacts');
    await settle();
    expect(await rawRow(contact.id)).toMatchObject({ owner_id: ID.staffB, job_title: null });
    expect(await traceCounts()).toEqual(tracesBefore);
    expect(await db.contactAuditEntry.count({ where: { contactId: contact.id } })).toBe(0);

    // The control: the same request sent after the reassignment, with no race.
    const sequential = await patch(ID.staff, contact.id, body);
    expect(sequential.status).toBe(403);
    expect(sequential.body.message).toBe(patched.body.message);
    expect(await rawRow(contact.id)).toMatchObject({ owner_id: ID.staffB, job_title: null });
  }, 30_000);
});

describe('ST-A: DELETE applies the GET visibility clause: a contact the caller cannot see answers like an unknown id', () => {
  // An ADMIN-role member with no scope overrides: full CRM access, but not the
  // business owner, so another member's PRIVATE contact is hidden from it on GET.
  const ADMIN = `${P}admin`;
  beforeAll(async () => {
    await db.user.create({ data: { id: ADMIN, email: `${P}admin@test.local`, role: 'USER' } });
    await db.membership.create({ data: { id: `${P}m_admin`, userId: ADMIN, businessId: ID.bizA, role: 'ADMIN' } });
  });

  it("NEGATIVE CONTROL: DELETE by a crm 'write' STAFF member on another member's PRIVATE contact answers 404 byte-identical to an unknown id, not the delete-scope 403, and writes nothing", async () => {
    const contact = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    await expectNothingWritten(contact.id, () => expectRefusedLikeUnknown((id) => del(ID.staff, id), contact));
  });

  it("NEGATIVE CONTROL: an ADMIN-role member who gets 404 on GET for another member's PRIVATE contact gets 404 on DELETE like an unknown id, and the contact stays live", async () => {
    const contact = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    expect((await detail(ADMIN, contact.id)).status).toBe(404);
    await expectNothingWritten(contact.id, () => expectRefusedLikeUnknown((id) => del(ADMIN, id), contact));
    expect((await rawRow(contact.id)).deleted_at).toBeNull();
  });

  it("NEGATIVE CONTROL: an ADMIN-role member's bulk delete naming another member's PRIVATE contact deletes nothing and answers exactly as for an unknown id; next to a visible TEAM id in one call, only the TEAM contact is deleted", async () => {
    const contact = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    await expectNothingWritten(contact.id, async () => {
      const hidden = await bulkDelete(ADMIN, [contact.id]);
      const absent = await bulkDelete(ADMIN, [UNKNOWN_CONTACT]);
      expect(hidden.status).toBe(200);
      expect(hidden.body).toEqual({ deleted: 0 });
      expect(hidden.text).toBe(absent.text);
    });
    expect((await rawRow(contact.id)).deleted_at).toBeNull();

    const team = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    const mixed = await bulkDelete(ADMIN, [team.id, contact.id]);
    expect(mixed.status).toBe(200);
    expect(mixed.body).toEqual({ deleted: 1 });
    expect((await rawRow(team.id)).deleted_at).not.toBeNull();
    expect((await rawRow(contact.id)).deleted_at).toBeNull();
    await settle();
    expect(await db.contactEvent.count({ where: { contactId: contact.id } })).toBe(0);
    expect(await db.contactAuditEntry.count({ where: { contactId: contact.id } })).toBe(0);
  });

  it("a visible contact the member may not delete keeps today's 403: a crm 'write' STAFF member (delete owned) on another member's TEAM contact, nothing written", async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    expect((await detail(ID.staff, contact.id)).status).toBe(200);
    await expectNothingWritten(contact.id, async () => {
      const res = await del(ID.staff, contact.id);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You can only delete contacts you own');
    });
  });

  it("positive control: the owner deletes another member's PRIVATE contact, an ADMIN-role member deletes another member's TEAM contact (single and bulk) and a crm 'write' STAFF member deletes their own PRIVATE contact", async () => {
    const byOwner = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    const byAdmin = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    const byStaff = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staff });
    for (const [actor, contact] of [[ID.owner, byOwner], [ADMIN, byAdmin], [ID.staff, byStaff]] as const) {
      const res = await del(actor, contact.id);
      expect(res.status, `${actor} ${contact.id}`).toBe(200);
      expect((await rawRow(contact.id)).deleted_at, contact.id).not.toBeNull();
      const audits = await auditEntries(contact.id, 'deleted');
      expect(audits, contact.id).toHaveLength(1);
      expect(audits[0].actor, contact.id).toEqual({ type: 'USER', id: actor });
    }

    const team = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    const bulk = await bulkDelete(ADMIN, [team.id]);
    expect(bulk.status).toBe(200);
    expect(bulk.body).toEqual({ deleted: 1 });
    expect((await rawRow(team.id)).deleted_at).not.toBeNull();
    const bulkAudits = await auditEntries(team.id, 'bulk_deleted');
    expect(bulkAudits).toHaveLength(1);
    expect(bulkAudits[0].actor).toEqual({ type: 'USER', id: ADMIN });
  });
});
