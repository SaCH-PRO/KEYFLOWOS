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
 * R0-13d-CT-BULK-ENRICH-VISIBILITY (the cases after the review repairs): the
 * two remaining member-facing contact write paths apply the same clause.
 * Bulk update (CrmService.bulkUpdateContacts, behind PATCH contacts/bulk)
 * checked only the edit scope, so a crm 'write' member (edit 'any') changed
 * another member's PRIVATE contact and a 'my book' member any TEAM one, and
 * the count revealed them; now a hidden id is skipped exactly like a missing
 * one. Enrichment (POST contacts/:id/enrich, ContactEnrichmentService)
 * mirrored only the edit scope, so a hidden contact answered 201 no_match (an
 * unknown id 404) and its email and name went to the paid provider; now it
 * takes the edit decision from CrmService.assertCanEditContact, the check
 * PATCH applies (R0-13c review ST-R3 / CR-1), and a hidden contact answers 404
 * byte-identical to an unknown id with no provider call and nothing stamped.
 * CR-3: a PATCH naming a non-member owner says 'ownerId must belong to a
 * member of this business' (the field the PATCH body has), and POST /contacts
 * uses the same membership helper.
 * PATCH contacts/bulk was declared after PATCH contacts/:contactId in
 * crm.controller.ts and answered by it (M15), so the R0-13d bulk cases drive
 * the real CrmService exactly as CrmController.bulkUpdateContacts forwards a
 * member's request, and one HTTP case proves the route answers a hidden id like
 * an unknown one whichever handler it reaches.
 *
 * R0-13e-ROUTE-SHADOWING (the last cases): the literal routes are declared
 * before their parameterised siblings, so PATCH contacts/bulk reaches
 * bulkUpdateContacts over HTTP (a hidden id skipped like a missing one) and GET
 * contacts/unread-counts reaches unreadCounts; route-shadowing.spec.ts keeps
 * every controller in that order. Its review repairs (the cases after them):
 * unread-counts keeps only the live contacts the caller can see (ST-1/CR-1),
 * and the bulk body is BulkUpdateContactsDto with UpdateContactDto's rules, so
 * the global ValidationPipe refuses what single PATCH refuses and a malformed
 * id or tag is a 400, not a 500 (ST-2/CR-2/CR-3). vitest's esbuild emits no
 * decorator metadata, so the suite applies the bulk handler's parameter types
 * tsc emits (one case reads them from crm.controller.ts).
 *
 * Nothing on the HTTP or persistence path is mocked: PrismaService, the user,
 * business, membership, contact and share rows, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, PlanLimitGuard, TeamAuditInterceptor,
 * the global ValidationPipe and GlobalHttpExceptionFilter, CrmController,
 * ContactEnrichmentController, CrmService, ContactEnrichmentService,
 * CrmStatsService, CrmTimelineService, CrmCommunicationService and
 * ContactAuditService are all real against DATABASE_URL. The stand-ins:
 * identity attachment (a test middleware reads `x-test-user` and attaches the
 * seeded user row as AuthMiddleware would), the timeline service's side
 * channels, the caches, the plan limit (a stub that allows), the WhatsApp
 * service (no case sends anything) and the enrichment provider (a recording
 * stub in place of ApolloEnrichmentProvider: no real provider is ever called). The app trusts
 * the proxy header as app-bootstrap.ts does and every request carries its own
 * x-forwarded-for address, so the real rate-limit guard runs without capping
 * the case count.
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
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
/** POST /contacts/bulk/reassign's refusal of a non-member owner. */
const MEMBER_MESSAGE = 'newOwnerId must belong to a member of this business';
/** The same refusal from PATCH and POST /contacts, naming the field their body has (CR-3). */
const OWNER_MEMBER_MESSAGE = 'ownerId must belong to a member of this business';
const BULK_REFUSAL = 'You cannot edit any of the selected contacts';

/**
 * The enrichment provider stand-in, injected in place of ApolloEnrichmentProvider:
 * it records every lookup it is asked for and answers the outcome a case sets.
 */
const enrichmentProvider = {
  key: 'k13d-stub',
  enabled: true,
  outcome: { status: 'no_match' } as { status: 'no_match' } | { status: 'match'; result: Record<string, unknown> },
  lookups: [] as Array<Record<string, unknown>>,
  async enrich(query: Record<string, unknown>) {
    enrichmentProvider.lookups.push(query);
    return enrichmentProvider.outcome;
  },
};

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

function create(actor: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/contacts`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send(body);
}

function bulkUpdateHttp(actor: string, contactIds: string[], body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(`/crm/businesses/${ID.bizA}/contacts/bulk`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send({ contactIds, ...body });
}

/**
 * CrmService.bulkUpdateContacts called exactly as CrmController.bulkUpdateContacts
 * forwards a member's PATCH contacts/bulk (the body fields plus actorUserId =
 * req.user.id), settled: the result, or the refusal's status and body.
 */
async function bulkUpdate(actor: string, contactIds: string[], body: Record<string, unknown>) {
  try {
    return { result: await crm.bulkUpdateContacts({ businessId: ID.bizA, contactIds, ...body, actorUserId: actor }) };
  } catch (err: any) {
    return { refused: { status: err?.status, response: err?.getResponse?.() ?? String(err) } };
  }
}

function enrich(actor: string, contactId: string, body: Record<string, unknown> = {}) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${ID.bizA}/contacts/${contactId}/enrich`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp())
    .send(body);
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
  const { CrmController, BulkUpdateContactsDto } = await import('../src/modules/crm/crm.controller');
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
  const { WhatsAppService } = await import('../src/modules/whatsapp/whatsapp.service');
  const { BestChannelService } = await import('../src/modules/crm/best-channel.service');
  const { ConversationAiService } = await import('../src/modules/crm/conversation-ai.service');
  const { CrmNetworkService } = await import('../src/modules/crm/crm-network.service');
  const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');
  const { ContactEnrichmentController } = await import('../src/modules/crm/enrichment/contact-enrichment.controller');
  const { ContactEnrichmentService } = await import('../src/modules/crm/enrichment/contact-enrichment.service');
  const { ApolloEnrichmentProvider } = await import('../src/modules/crm/enrichment/apollo-enrichment.provider');

  // The constructor parameter types tsc emits for the enrichment controller and
  // service (emitDecoratorMetadata, the production build), which vitest's
  // esbuild transform does not: without them Nest injects nothing into the
  // parameters that carry no @Inject. Copied from the two constructors.
  Reflect.defineMetadata('design:paramtypes', [ContactEnrichmentService], ContactEnrichmentController);
  Reflect.defineMetadata('design:paramtypes', [PrismaService, CrmService, ApolloEnrichmentProvider], ContactEnrichmentService);
  // The same for the PATCH contacts/bulk handler's parameters, so the global
  // ValidationPipe validates the body against BulkUpdateContactsDto as it does
  // in the production build (an R0-13e review repair case reads this list from
  // what tsc emits for crm.controller.ts). The other handlers keep no
  // parameter types here, so their bodies pass the pipe unchecked as before.
  Reflect.defineMetadata('design:paramtypes', [String, BulkUpdateContactsDto, Object], CrmController.prototype, 'bulkUpdateContacts');

  // ---- the real HTTP path (wired before any row is seeded) ----------------
  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController, ContactEnrichmentController],
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
      ContactEnrichmentService,
      // The paid provider is never called: a recording stub answers instead.
      { provide: ApolloEnrichmentProvider, useValue: enrichmentProvider },
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
      // Real: GET contacts/unread-counts reaches unreadCounts (R0-13e). It
      // never sends anything; the WhatsApp service it holds for replies is a
      // stand-in no case reaches.
      CrmCommunicationService,
      { provide: WhatsAppService, useValue: {} },
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

  it("NEGATIVE CONTROL: the owner PATCHing ownerId to another tenant's user answers 400 'ownerId must belong to a member of this business' (the bulk reassign refusal, naming the field PATCH has) and writes nothing", async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.owner });
    await expectNothingWritten(contact.id, async () => {
      const res = await patch(ID.owner, contact.id, { ownerId: ID.outsider });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(OWNER_MEMBER_MESSAGE);
      expect(res.text).not.toContain(String(contact.email));
    });
    expect((await rawRow(contact.id)).owner_id).toBe(ID.owner);
  });

  it('NEGATIVE CONTROL: a crm_reassign STAFF member PATCHing ownerId to an id that is no user at all answers 400 and writes nothing', async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    await expectNothingWritten(contact.id, async () => {
      const res = await patch(ID.reassigner, contact.id, { ownerId: NOT_A_USER });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(OWNER_MEMBER_MESSAGE);
    });
    expect((await rawRow(contact.id)).owner_id).toBe(ID.staffB);
  });

  it("NEGATIVE CONTROL: the owner PATCHing ownerId to '' answers 400 and writes nothing", async () => {
    for (const ownerId of [ID.owner, null]) {
      const contact = await seedContact({ visibility: 'TEAM', ownerId });
      await expectNothingWritten(contact.id, async () => {
        const res = await patch(ID.owner, contact.id, { ownerId: '' });
        expect(res.status, `owner ${ownerId}`).toBe(400);
        expect(res.body.message, `owner ${ownerId}`).toBe(OWNER_MEMBER_MESSAGE);
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
        .rejects.toMatchObject({ status: 400, message: OWNER_MEMBER_MESSAGE });
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

  it("POST /contacts naming another tenant's user, or an id that is no user, as the owner is refused by the same membership check: 400 'ownerId must belong to a member of this business' and no contact is created (CR-3)", async () => {
    await settle();
    const tracesBefore = await traceCounts();
    const contactsBefore = await db.contact.count({ where: { businessId: ID.bizA } });
    for (const ownerId of [ID.outsider, NOT_A_USER]) {
      const res = await create(ID.owner, { firstName: `${P}CreateOwner`, ownerId });
      expect(res.status, ownerId).toBe(400);
      expect(res.body.message, ownerId).toBe(OWNER_MEMBER_MESSAGE);
    }
    await settle();
    expect(await db.contact.count({ where: { businessId: ID.bizA } })).toBe(contactsBefore);
    expect(await traceCounts()).toEqual(tracesBefore);
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

// ---------------------------------------------------------------------------
// R0-13d-CT-BULK-ENRICH-VISIBILITY: bulk update and enrichment, the remaining
// member-facing contact write paths, apply the GET visibility clause. Cases
// tagged NEGATIVE CONTROL fail on the unmodified source (the R0-13c base).
// ---------------------------------------------------------------------------

const BULK_TAG = `${P}bulk-tag`;
/**
 * One body per write path of bulkUpdateContacts: the updateMany path and the
 * per-row tags path. The priority is a CONTACT_PRIORITIES value: PATCH
 * contacts/bulk validates its body with UpdateContactDto's rules since the
 * R0-13e review repairs, and refuses the lowercase 'high' the R0-13d cases
 * used, as single PATCH always has.
 */
const BULK_BODIES: Array<Record<string, unknown>> = [
  { status: 'CLIENT', priority: 'HIGH', favorite: true },
  { addTags: [BULK_TAG] },
];

/** True when `row` (a rawRow) carries what `body` (one of BULK_BODIES) writes. */
function bulkApplied(row: Record<string, any>, body: Record<string, unknown>) {
  return body.addTags
    ? Array.isArray(row.tags) && row.tags.includes(BULK_TAG)
    : row.status === 'CLIENT' && row.priority === 'HIGH' && row.favorite === true;
}

describe('ST-A: bulk update applies the GET visibility clause: a contact the caller cannot see is skipped like a missing id', () => {
  it("NEGATIVE CONTROL: a crm 'write' STAFF member's bulk update naming only another member's PRIVATE contact is refused exactly as for an unknown id and writes nothing, for a field update and for added tags", async () => {
    for (const body of BULK_BODIES) {
      const label = JSON.stringify(body);
      const contact = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
      expect((await detail(ID.staff, contact.id)).status).toBe(404);
      await expectNothingWritten(contact.id, async () => {
        const hidden = await bulkUpdate(ID.staff, [contact.id], body);
        const absent = await bulkUpdate(ID.staff, [UNKNOWN_CONTACT], body);
        expect(hidden, label).toEqual(absent);
        expect(absent.refused, label).toMatchObject({ status: 403, response: { message: BULK_REFUSAL } });
        expect(JSON.stringify(hidden), label).not.toContain(contact.id);
      });
    }
  });

  it("NEGATIVE CONTROL: next to a visible TEAM contact in one call only the TEAM contact is updated, the count is the one an unknown id in the hidden id's place gives, and the hidden contact gets no event or audit entry, for a field update and for added tags", async () => {
    for (const body of BULK_BODIES) {
      const label = JSON.stringify(body);
      const hidden = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
      const teamA = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
      const teamB = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
      await settle();
      const hiddenBefore = await rawRow(hidden.id);

      const withHidden = await bulkUpdate(ID.staff, [teamA.id, hidden.id], body);
      const withUnknown = await bulkUpdate(ID.staff, [teamB.id, UNKNOWN_CONTACT], body);
      expect(withHidden, label).toEqual({ result: { updated: 1 } });
      expect(withUnknown, label).toEqual(withHidden);

      await settle();
      expect(await rawRow(hidden.id), label).toEqual(hiddenBefore);
      expect(await db.contactEvent.count({ where: { contactId: hidden.id } }), label).toBe(0);
      expect(await db.contactAuditEntry.count({ where: { contactId: hidden.id } }), label).toBe(0);
      for (const team of [teamA, teamB]) {
        expect(bulkApplied(await rawRow(team.id), body), `${label} ${team.id}`).toBe(true);
        expect(await db.contactEvent.count({ where: { contactId: team.id, type: 'bulk.updated' } }), `${label} ${team.id}`).toBe(1);
        expect(await auditEntries(team.id, 'bulk_updated'), `${label} ${team.id}`).toHaveLength(1);
      }
    }
  });

  it("NEGATIVE CONTROL: a 'my book' member (crm_view owned) bulk-updating another member's TEAM contact, which GET answers 404, is refused exactly as for an unknown id and writes nothing", async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    expect((await detail(ID.myBook, contact.id)).status).toBe(404);
    await expectNothingWritten(contact.id, async () => {
      for (const body of BULK_BODIES) {
        const hidden = await bulkUpdate(ID.myBook, [contact.id], body);
        expect(hidden, JSON.stringify(body)).toEqual(await bulkUpdate(ID.myBook, [UNKNOWN_CONTACT], body));
        expect(hidden.refused, JSON.stringify(body)).toMatchObject({ status: 403, response: { message: BULK_REFUSAL } });
      }
    });
  });

  it("a visible contact the member may not edit stays refused as before: a crm_edit 'owned' member bulk-updating another member's TEAM contact gets 403, nothing written", async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    expect((await detail(ID.editOwned, contact.id)).status).toBe(200);
    await expectNothingWritten(contact.id, async () => {
      for (const body of BULK_BODIES) {
        const res = await bulkUpdate(ID.editOwned, [contact.id], body);
        expect(res.refused, JSON.stringify(body)).toMatchObject({ status: 403, response: { message: BULK_REFUSAL } });
      }
    });
  });

  it("positive control: the owner bulk-updates another member's PRIVATE contact, a crm 'write' STAFF member their own PRIVATE contact, a PRIVATE contact shared with them and another member's TEAM contact in one call, and a crm_edit 'owned' member a contact they own (each persisted, with one bulk.updated event per call)", async () => {
    const [fields, tags] = BULK_BODIES;
    const priv = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    expect(await bulkUpdate(ID.owner, [priv.id], fields)).toEqual({ result: { updated: 1 } });
    expect(bulkApplied(await rawRow(priv.id), fields)).toBe(true);

    const own = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staff });
    const shared = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB, shareWith: [ID.staff] });
    const team = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    expect(await bulkUpdate(ID.staff, [own.id, shared.id, team.id], tags)).toEqual({ result: { updated: 3 } });
    expect(await bulkUpdate(ID.staff, [own.id, shared.id, team.id], fields)).toEqual({ result: { updated: 3 } });
    for (const contact of [own, shared, team]) {
      const row = await rawRow(contact.id);
      expect(bulkApplied(row, tags) && bulkApplied(row, fields), contact.id).toBe(true);
      expect(await db.contactEvent.count({ where: { contactId: contact.id, type: 'bulk.updated' } }), contact.id).toBe(2);
    }

    const owned = await seedContact({ visibility: 'TEAM', ownerId: ID.editOwned });
    expect(await bulkUpdate(ID.editOwned, [owned.id], fields)).toEqual({ result: { updated: 1 } });
    expect(bulkApplied(await rawRow(owned.id), fields)).toBe(true);
    expect(await db.contactEvent.count({ where: { contactId: owned.id, type: 'bulk.updated' } })).toBe(1);
  });

  it("over HTTP, PATCH contacts/bulk naming another member's PRIVATE contact answers byte-identical to the same request naming an unknown id, alone and next to a visible TEAM contact, and the hidden contact is not written, whichever handler the route reaches (M15: PATCH contacts/:contactId before R0-13e, bulkUpdateContacts since R0-13e reordered the routes)", async () => {
    const hidden = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    const team = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    await settle();
    const hiddenBefore = await rawRow(hidden.id);
    for (const body of BULK_BODIES) {
      for (const others of [[], [team.id]]) {
        const label = `${JSON.stringify(body)} next to [${others}]`;
        const withHidden = await bulkUpdateHttp(ID.staff, [...others, hidden.id], body);
        const withUnknown = await bulkUpdateHttp(ID.staff, [...others, UNKNOWN_CONTACT], body);
        expect(withHidden.status, label).toBe(withUnknown.status);
        expect(normalisedError(withHidden, hidden.id), label).toBe(normalisedError(withUnknown, UNKNOWN_CONTACT));
        expect(withHidden.headers['content-type'], label).toBe(withUnknown.headers['content-type']);
        for (const secret of [hidden.id, hidden.email, hidden.phone, hidden.notesInternal]) {
          expect(withHidden.text, label).not.toContain(String(secret));
        }
      }
    }
    await settle();
    expect(await rawRow(hidden.id)).toEqual(hiddenBefore);
    expect(await db.contactEvent.count({ where: { contactId: hidden.id } })).toBe(0);
    expect(await db.contactAuditEntry.count({ where: { contactId: hidden.id } })).toBe(0);
  });
});

describe('ST-A: enrichment applies the GET visibility clause before the provider call: a contact the caller cannot see answers like an unknown id', () => {
  const MATCH = { status: 'match' as const, result: { jobTitle: `${P}Enriched title`, city: `${P}Lookup City` } };

  beforeEach(() => {
    enrichmentProvider.outcome = { status: 'no_match' };
    enrichmentProvider.lookups = [];
  });

  /** expectRefusedLikeUnknown for POST enrich, plus: the provider was asked nothing at all. */
  async function expectEnrichRefusedLikeUnknown(
    actor: string,
    contact: { id: string; email: string | null; phone: string | null; notesInternal: string | null },
    body: Record<string, unknown> = {},
  ) {
    await expectRefusedLikeUnknown((contactId) => enrich(actor, contactId, body), contact);
    expect(enrichmentProvider.lookups).toEqual([]);
  }

  it("NEGATIVE CONTROL: POST enrich by a crm 'write' STAFF member on another member's PRIVATE contact answers 404 byte-identical to an unknown id, asks the provider nothing and stamps nothing, where the provider would answer no match", async () => {
    const contact = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    expect((await detail(ID.staff, contact.id)).status).toBe(404);
    await expectNothingWritten(contact.id, () => expectEnrichRefusedLikeUnknown(ID.staff, contact));
    expect((await rawRow(contact.id)).custom ?? {}).not.toHaveProperty('enrichment');
  });

  it("NEGATIVE CONTROL: the same request with force, where the provider would match, answers 404 like an unknown id: the contact's email and name never reach the provider and nothing is written", async () => {
    enrichmentProvider.outcome = MATCH;
    const contact = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    await expectNothingWritten(contact.id, () => expectEnrichRefusedLikeUnknown(ID.staff, contact, { force: true }));
    expect(JSON.stringify(enrichmentProvider.lookups)).not.toContain(String(contact.email));
    expect((await rawRow(contact.id)).job_title).toBeNull();
  });

  it("NEGATIVE CONTROL: a 'my book' member (crm_view owned) gets 404 like an unknown id on enrich for another member's TEAM contact, as on GET, with no provider call", async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    expect((await detail(ID.myBook, contact.id)).status).toBe(404);
    await expectNothingWritten(contact.id, () => expectEnrichRefusedLikeUnknown(ID.myBook, contact));
  });

  it("NEGATIVE CONTROL: a member whose crm_edit is 'owned' gets 404 like an unknown id, not the edit-scope 403, on enrich for another member's PRIVATE contact, with no provider call", async () => {
    const contact = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    await expectNothingWritten(contact.id, () => expectEnrichRefusedLikeUnknown(ID.editOwned, contact));
  });

  it("a visible contact the member may not edit keeps today's 403: crm_edit 'owned' enriching another member's TEAM contact, no provider call, nothing written", async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    expect((await detail(ID.editOwned, contact.id)).status).toBe(200);
    await expectNothingWritten(contact.id, async () => {
      const res = await enrich(ID.editOwned, contact.id, { force: true });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You can only edit contacts you own');
      expect(res.text).not.toContain(String(contact.email));
    });
    expect(enrichmentProvider.lookups).toEqual([]);
  });

  it("positive control: the owner enriches another member's PRIVATE contact (a match fills the blank fields, recorded as updated by the owner) and a crm 'write' STAFF member enriches their own PRIVATE contact and another member's TEAM contact (a miss is stamped); each lookup carries that contact's own email and name", async () => {
    enrichmentProvider.outcome = MATCH;
    const priv = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    const byOwner = await enrich(ID.owner, priv.id, { force: true });
    expect(byOwner.status).toBe(201);
    expect(byOwner.body).toEqual({ status: 'enriched', provider: enrichmentProvider.key, filled: ['jobTitle', 'city'] });
    expect(enrichmentProvider.lookups).toEqual([expect.objectContaining({ email: priv.email, firstName: priv.firstName })]);
    expect(await rawRow(priv.id)).toMatchObject({ job_title: MATCH.result.jobTitle, city: MATCH.result.city });
    const audits = await auditEntries(priv.id, 'updated');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toEqual({ type: 'USER', id: ID.owner });

    enrichmentProvider.outcome = { status: 'no_match' };
    const own = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staff });
    const team = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    for (const contact of [own, team]) {
      enrichmentProvider.lookups = [];
      const res = await enrich(ID.staff, contact.id);
      expect(res.status, contact.id).toBe(201);
      expect(res.body, contact.id).toEqual({ status: 'no_match', provider: enrichmentProvider.key, filled: [] });
      expect(enrichmentProvider.lookups, contact.id).toEqual([expect.objectContaining({ email: contact.email, firstName: contact.firstName })]);
      expect((await rawRow(contact.id)).custom, contact.id).toMatchObject({ enrichment: { provider: enrichmentProvider.key, filled: [] } });
    }
  });
});

// ---------------------------------------------------------------------------
// R0-13d review repairs. ST-1: every caller of bulkUpdateContacts, the owner
// and a system call with no actor (the KEY flow-orchestrator
// 'update_status_with_confirmation' tool) included, writes only live rows of
// the path tenant, so another tenant's id is skipped like an unknown one: the
// same count, no event or audit entry under either tenant, and an unknown id no
// longer fails the contact_events foreign key after an audit entry was written.
// ST-2: a member's bulk update is recorded as theirs (USER), not SYSTEM.
// ---------------------------------------------------------------------------

/**
 * CrmService.bulkUpdateContacts called as the KEY flow-orchestrator
 * 'update_status_with_confirmation' tool calls it: no actorUserId, no audit
 * context. Settled like bulkUpdate.
 */
async function systemBulkUpdate(contactIds: string[], body: Record<string, unknown>) {
  try {
    return { result: await crm.bulkUpdateContacts({ businessId: ID.bizA, contactIds, ...body }) };
  } catch (err: any) {
    return { refused: { status: err?.status, response: err?.getResponse?.() ?? String(err) } };
  }
}

let foreignSeq = 0;
/** A live contact of the other tenant (bizB), seeded directly. */
async function seedForeignContact() {
  foreignSeq += 1;
  const id = `${P}c_bizB_${foreignSeq}`;
  const email = `${P}bizB-${foreignSeq}@test.local`;
  return db.contact.create({
    data: { id, businessId: ID.bizB, firstName: `${P}Foreign${foreignSeq}`, email, emailNormalized: email, visibility: 'TEAM', ownerId: ID.outsider },
  });
}

describe("R0-13d review repairs: bulk update writes only the path tenant's rows for every caller and records the member who made it", () => {
  const CALLERS: Array<[string, (ids: string[], body: Record<string, unknown>) => Promise<any>]> = [
    ['owner', (ids, body) => bulkUpdate(ID.owner, ids, body)],
    ['system (no actor)', (ids, body) => systemBulkUpdate(ids, body)],
  ];

  it("NEGATIVE CONTROL: the owner's and a system (no actor) bulk update naming another tenant's contact skip it exactly like an unknown id: the same count alone and next to a TEAM contact, the foreign row unchanged, and no event or audit entry for the foreign or the unknown id under either tenant, for a field update and for added tags (ST-1)", async () => {
    for (const [who, send] of CALLERS) {
      for (const body of BULK_BODIES) {
        const label = `${who} ${JSON.stringify(body)}`;
        const foreign = await seedForeignContact();
        const teamA = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
        const teamB = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
        await settle();
        const foreignBefore = await rawRow(foreign.id);

        const alone = await send([foreign.id], body);
        expect(alone, label).toEqual(await send([UNKNOWN_CONTACT], body));
        expect(alone, label).toEqual({ result: { updated: 0 } });

        const withForeign = await send([teamA.id, foreign.id], body);
        const withUnknown = await send([teamB.id, UNKNOWN_CONTACT], body);
        expect(withForeign, label).toEqual({ result: { updated: 1 } });
        expect(withUnknown, label).toEqual(withForeign);

        await settle();
        expect(await rawRow(foreign.id), label).toEqual(foreignBefore);
        for (const id of [foreign.id, UNKNOWN_CONTACT]) {
          expect(await db.contactEvent.count({ where: { contactId: id } }), `${label} ${id}`).toBe(0);
          expect(await db.contactAuditEntry.count({ where: { contactId: id } }), `${label} ${id}`).toBe(0);
        }
        for (const team of [teamA, teamB]) {
          expect(bulkApplied(await rawRow(team.id), body), `${label} ${team.id}`).toBe(true);
          expect(await db.contactEvent.count({ where: { contactId: team.id, type: 'bulk.updated' } }), `${label} ${team.id}`).toBe(1);
          expect(await auditEntries(team.id, 'bulk_updated'), `${label} ${team.id}`).toHaveLength(1);
        }
      }
    }
  });

  it("NEGATIVE CONTROL: a member's bulk update is recorded as theirs: each bulk_updated audit entry names them as USER and each bulk.updated event carries actorType USER and their id, for a crm 'write' STAFF member and the owner, for a field update and for added tags; a system call (no actor) stays SYSTEM with no user on the event (ST-2)", async () => {
    for (const body of BULK_BODIES) {
      const label = JSON.stringify(body);
      for (const actor of [ID.staff, ID.owner]) {
        const team = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
        expect(await bulkUpdate(actor, [team.id], body), `${label} ${actor}`).toEqual({ result: { updated: 1 } });
        const audits = await auditEntries(team.id, 'bulk_updated');
        expect(audits, `${label} ${actor}`).toHaveLength(1);
        expect(audits[0].actor, `${label} ${actor}`).toEqual({ type: 'USER', id: actor });
        const events = await db.contactEvent.findMany({ where: { contactId: team.id, type: 'bulk.updated' } });
        expect(events, `${label} ${actor}`).toHaveLength(1);
        expect(events[0], `${label} ${actor}`).toMatchObject({ businessId: ID.bizA, actorType: 'USER', actorId: actor });
      }

      const team = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
      expect(await systemBulkUpdate([team.id], body), label).toEqual({ result: { updated: 1 } });
      const audits = await auditEntries(team.id, 'bulk_updated');
      expect(audits, label).toHaveLength(1);
      expect(audits[0].actor, label).toEqual({ type: 'SYSTEM' });
      const events = await db.contactEvent.findMany({ where: { contactId: team.id, type: 'bulk.updated' } });
      expect(events, label).toHaveLength(1);
      expect(events[0].actorId, label).toBeNull();
      expect(events[0].actorType, label).not.toBe('USER');
    }
  });
});

// ---------------------------------------------------------------------------
// R0-13e-ROUTE-SHADOWING (M15): crm.controller.ts declared PATCH contacts/bulk
// after PATCH contacts/:contactId and GET contacts/unread-counts after GET
// contacts/:contactId, so Express answered both literal routes with the
// parameterised handler (contact 'bulk', contact 'unread-counts': 404) and the
// web's bulk edit had never worked over HTTP. With the literal routes declared
// first, these requests reach bulkUpdateContacts and unreadCounts, and the
// R0-13d bulk semantics hold over HTTP: a hidden id is skipped exactly like a
// missing one. src/core/config/route-shadowing.spec.ts keeps the order.
// Cases tagged NEGATIVE CONTROL fail on the unmodified controller.
// ---------------------------------------------------------------------------

describe('R0-13e: PATCH contacts/bulk and GET contacts/unread-counts reach their own handlers over HTTP, not the :contactId sibling', () => {
  it("NEGATIVE CONTROL: the owner's PATCH contacts/bulk naming two visible contacts updates both and answers bulkUpdateContacts' { updated: 2 }, recorded as the owner's bulk update, for a field update and for added tags", async () => {
    for (const body of BULK_BODIES) {
      const label = JSON.stringify(body);
      const priv = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
      const team = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
      const res = await bulkUpdateHttp(ID.owner, [priv.id, team.id], body);
      expect(res.status, `${label} ${res.text}`).toBe(200);
      expect(res.body, label).toEqual({ updated: 2 });
      for (const contact of [priv, team]) {
        expect(bulkApplied(await rawRow(contact.id), body), `${label} ${contact.id}`).toBe(true);
        const events = await db.contactEvent.findMany({ where: { contactId: contact.id, type: 'bulk.updated' } });
        expect(events, `${label} ${contact.id}`).toHaveLength(1);
        expect(events[0], `${label} ${contact.id}`).toMatchObject({ businessId: ID.bizA, actorType: 'USER', actorId: ID.owner });
        const audits = await auditEntries(contact.id, 'bulk_updated');
        expect(audits, `${label} ${contact.id}`).toHaveLength(1);
        expect(audits[0].actor, `${label} ${contact.id}`).toEqual({ type: 'USER', id: ID.owner });
      }
    }
  });

  it("NEGATIVE CONTROL: over HTTP a crm 'write' STAFF member's PATCH contacts/bulk skips another member's PRIVATE contact exactly like a missing id: next to a visible TEAM contact 200 { updated: 1 }, the answer an unknown id in its place gets, and alone bulkUpdateContacts' 403 refusal, byte-identical to an unknown id; the hidden contact gets no write, event or audit entry", async () => {
    for (const body of BULK_BODIES) {
      const label = JSON.stringify(body);
      const hidden = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
      const teamA = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
      const teamB = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
      expect((await detail(ID.staff, hidden.id)).status, label).toBe(404);
      await settle();
      const hiddenBefore = await rawRow(hidden.id);

      const withHidden = await bulkUpdateHttp(ID.staff, [teamA.id, hidden.id], body);
      const withUnknown = await bulkUpdateHttp(ID.staff, [teamB.id, UNKNOWN_CONTACT], body);
      expect(withHidden.status, `${label} ${withHidden.text}`).toBe(200);
      expect(withHidden.body, label).toEqual({ updated: 1 });
      expect(withUnknown.status, label).toBe(200);
      expect(withUnknown.text, label).toBe(withHidden.text);

      const alone = await bulkUpdateHttp(ID.staff, [hidden.id], body);
      const absent = await bulkUpdateHttp(ID.staff, [UNKNOWN_CONTACT], body);
      expect(alone.status, `${label} ${alone.text}`).toBe(403);
      expect(alone.body, label).toMatchObject({ statusCode: 403, message: BULK_REFUSAL });
      expect(absent.status, label).toBe(403);
      expect(normalisedError(alone, hidden.id), label).toBe(normalisedError(absent, UNKNOWN_CONTACT));
      expect(alone.headers['content-type'], label).toBe(absent.headers['content-type']);
      for (const res of [withHidden, alone]) {
        for (const secret of [hidden.id, hidden.email, hidden.phone, hidden.notesInternal]) {
          expect(res.text, label).not.toContain(String(secret));
        }
      }

      await settle();
      expect(await rawRow(hidden.id), label).toEqual(hiddenBefore);
      expect(await db.contactEvent.count({ where: { contactId: hidden.id } }), label).toBe(0);
      expect(await db.contactAuditEntry.count({ where: { contactId: hidden.id } }), label).toBe(0);
      for (const team of [teamA, teamB]) {
        expect(bulkApplied(await rawRow(team.id), body), `${label} ${team.id}`).toBe(true);
        expect(await db.contactEvent.count({ where: { contactId: team.id, type: 'bulk.updated' } }), `${label} ${team.id}`).toBe(1);
      }
    }
  });

  it("NEGATIVE CONTROL: GET contacts/unread-counts answers unreadCounts' { counts } (a contact with an inbound form submission counts 1), not the contact detail 404 for contact 'unread-counts'", async () => {
    const contact = await seedContact({ visibility: 'TEAM', ownerId: ID.owner });
    await db.contactEvent.create({
      data: { id: `${P}ev_form_${contact.id.slice(P.length)}`, businessId: ID.bizA, contactId: contact.id, type: 'form.submitted', data: {} },
    });
    const res = await request(app.getHttpServer())
      .get(`/crm/businesses/${ID.bizA}/contacts/unread-counts`)
      .set('x-test-user', ID.owner)
      .set('x-forwarded-for', nextIp());
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ counts: { [contact.id]: 1 } });
  });
});

// ---------------------------------------------------------------------------
// R0-13e review repairs. Declaring the literal routes first made two handlers
// reachable that had answered only the detail 404 before, and both needed the
// checks their :contactId siblings already apply:
//   - ST-1 / CR-1: CrmCommunicationService.unreadCounts counts every contact of
//     the tenant with inbound activity, so GET contacts/unread-counts handed a
//     member the ids of contacts GET answers 404 (another member's PRIVATE
//     contact, a TEAM contact outside a 'my book' scope, a deleted contact).
//     The handler now keeps only the live contacts the caller can see.
//   - ST-2 / CR-2 / CR-3: the bulk body was an inline type, which tsc emits as
//     Object, so the global ValidationPipe passed it through: a status,
//     priority or relationshipType single PATCH refuses was stored, and a
//     non-string id or tag reached Prisma (500). The body is
//     BulkUpdateContactsDto now, with UpdateContactDto's rules.
// Cases tagged NEGATIVE CONTROL fail on the R0-13e head before these repairs.
// ---------------------------------------------------------------------------

function unreadCounts(actor: string) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${ID.bizA}/contacts/unread-counts`)
    .set('x-test-user', actor)
    .set('x-forwarded-for', nextIp());
}

/** A form.submitted ContactEvent on `contactId`: one inbound item unreadCounts counts. */
async function seedFormSubmission(contactId: string) {
  await db.contactEvent.create({
    data: { id: `${P}ev_form_${contactId.slice(P.length)}`, businessId: ID.bizA, contactId, type: 'form.submitted', data: {} },
  });
}

/** What the global ValidationPipe answers for `body` against `metatype`: the 400 messages, or null when it passes. */
async function pipeMessages(metatype: any, body: Record<string, unknown>): Promise<string[] | null> {
  const { ValidationPipe } = await import('@nestjs/common');
  try {
    await new ValidationPipe({ whitelist: true, transform: true }).transform({ ...body }, { type: 'body', metatype });
    return null;
  } catch (err: any) {
    return err.getResponse().message;
  }
}

describe('R0-13e review repairs: the routes the reorder made reachable apply the checks their :contactId siblings apply', () => {
  it("NEGATIVE CONTROL: GET contacts/unread-counts counts only the live contacts the caller can see: another member's PRIVATE contact, a TEAM contact outside a 'my book' scope and a deleted contact, each with an inbound form submission and each 404 on GET, are left out exactly like a contact with no inbound activity, for a crm 'write' STAFF member and a 'my book' member; the owner's counts keep every live contact and leave out the deleted one (ST-1, CR-1)", async () => {
    const priv = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB });
    const team = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    const deleted = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    const mine = await seedContact({ visibility: 'TEAM', ownerId: ID.myBook });
    const shared = await seedContact({ visibility: 'PRIVATE', ownerId: ID.staffB, shareWith: [ID.staff, ID.myBook] });
    const quiet = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB }); // no inbound activity
    for (const contact of [priv, team, deleted, mine, shared]) await seedFormSubmission(contact.id);
    await db.$executeRawUnsafe('UPDATE contacts SET deleted_at = now() WHERE id = $1', deleted.id);

    const expected: Array<[string, string, { visible: string[]; hidden: string[] }]> = [
      ['staff', ID.staff, { visible: [team.id, mine.id, shared.id], hidden: [priv.id, deleted.id] }],
      ['myBook', ID.myBook, { visible: [mine.id, shared.id], hidden: [priv.id, team.id, deleted.id] }],
      ['owner', ID.owner, { visible: [priv.id, team.id, mine.id, shared.id], hidden: [deleted.id] }],
    ];
    for (const [who, actor, { visible, hidden }] of expected) {
      const res = await unreadCounts(actor);
      expect(res.status, `${who} ${res.text}`).toBe(200);
      const counts: Record<string, number> = res.body.counts;
      for (const id of visible) {
        expect(counts[id], `${who} ${id}`).toBe(1);
        expect((await detail(actor, id)).status, `${who} GET ${id}`).toBe(200);
      }
      for (const id of hidden) {
        // GET answers this id 404, and the counts carry it exactly as they
        // carry the contact with no inbound activity: not at all.
        expect((await detail(actor, id)).status, `${who} GET ${id}`).toBe(404);
        expect(counts, `${who} ${id}`).not.toHaveProperty(id);
        expect(res.text, `${who} ${id}`).not.toContain(id);
      }
      expect(counts, `${who} quiet`).not.toHaveProperty(quiet.id);
      // No key of the answer names a contact GET hides from this caller,
      // whichever case seeded it.
      for (const id of Object.keys(counts)) {
        expect((await detail(actor, id)).status, `${who} counted ${id}`).toBe(200);
      }
    }
  });

  it("NEGATIVE CONTROL: PATCH contacts/bulk validates its body with UpdateContactDto's rules: tsc emits BulkUpdateContactsDto as the body's parameter type (the type this suite applies), and a status, priority or relationshipType single PATCH refuses (an unknown value, a 50,000-character status) answers 400 with the messages UpdateContactDto gives, for the owner and a crm 'write' STAFF member, and writes nothing (ST-2, CR-2)", async () => {
    const ts = await import('typescript');
    const { readFileSync } = await import('node:fs');
    const { CrmController, BulkUpdateContactsDto } = await import('../src/modules/crm/crm.controller');
    const { UpdateContactDto } = await import('../src/modules/crm/dto/update-contact.dto');

    // The parameter types the production build emits for the handler, read
    // from crm.controller.ts as tsc compiles it (emitDecoratorMetadata).
    const source = readFileSync(path.resolve(__dirname, '../src/modules/crm/crm.controller.ts'), 'utf8');
    const emitted = ts.transpileModule(source, {
      compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const end = emitted.indexOf('], CrmController.prototype, "bulkUpdateContacts", null)');
    expect(end).toBeGreaterThan(0);
    const decorators = emitted.slice(emitted.lastIndexOf('__decorate([', end), end);
    expect(decorators.match(/design:paramtypes", \[([^\]]*)\]/)?.[1]).toBe('String, BulkUpdateContactsDto, Object');
    expect(typeof BulkUpdateContactsDto).toBe('function');
    expect(Reflect.getMetadata('design:paramtypes', CrmController.prototype, 'bulkUpdateContacts')).toEqual([String, BulkUpdateContactsDto, Object]);

    const team = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    const refused: Array<Record<string, unknown>> = [
      { status: 'NOT_A_STATUS' },
      { status: `NOT_A_STATUS_${'X'.repeat(50_000)}` },
      { priority: 'ultra' },
      { priority: 'high' },
      { relationshipType: 'nonsense' },
      { status: 'NOT_A_STATUS', priority: 'ultra', relationshipType: 'nonsense' },
    ];
    await expectNothingWritten(team.id, async () => {
      for (const body of refused) {
        // The messages single PATCH's UpdateContactDto gives for the same fields.
        const single = await pipeMessages(UpdateContactDto, body);
        expect(single, JSON.stringify(body).slice(0, 80)).not.toBeNull();
        for (const actor of [ID.owner, ID.staff]) {
          const label = `${actor} ${JSON.stringify(body).slice(0, 80)}`;
          const res = await bulkUpdateHttp(actor, [team.id], body);
          expect(res.status, `${label} ${res.text.slice(0, 300)}`).toBe(400);
          expect(res.body, label).toMatchObject({ statusCode: 400 });
          expect([...res.body.message].sort(), label).toEqual([...(single as string[])].sort());
        }
      }
    });
    const row = await rawRow(team.id);
    expect(row.status).toBe('LEAD');
    expect(row.priority).toBeNull();
    expect(row.relationship_type).toBeNull();
  });

  it("NEGATIVE CONTROL: a malformed PATCH contacts/bulk body answers 400, not a Prisma validation 500: a non-string contact id, a non-string tag, a non-string relationshipType and a non-array contactIds, for the owner, and nothing is written (CR-3)", async () => {
    const team = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    const malformed: Array<Record<string, unknown>> = [
      { contactIds: [123], status: 'CLIENT' },
      { contactIds: [team.id, { id: team.id }], status: 'CLIENT' },
      { contactIds: [team.id], addTags: [1] },
      { contactIds: [team.id], relationshipType: 5 },
      { contactIds: team.id, status: 'CLIENT' },
    ];
    await expectNothingWritten(team.id, async () => {
      for (const body of malformed) {
        const label = JSON.stringify(body);
        const res = await request(app.getHttpServer())
          .patch(`/crm/businesses/${ID.bizA}/contacts/bulk`)
          .set('x-test-user', ID.owner)
          .set('x-forwarded-for', nextIp())
          .send(body);
        expect(res.status, `${label} ${res.text}`).toBe(400);
        expect(res.body, label).toMatchObject({ statusCode: 400 });
        expect(res.text, label).not.toContain('Prisma');
      }
    });
  });

  it("positive control: the web's bulk bodies pass the DTO: a valid status, priority and relationshipType are written, null clears priority and relationshipType (the web's clear action), favorite applies, and added tags are merged, each answering { updated: 1 }", async () => {
    const team = await seedContact({ visibility: 'TEAM', ownerId: ID.staffB });
    const steps: Array<[Record<string, unknown>, (row: Record<string, any>) => boolean]> = [
      [{ status: 'PROSPECT', priority: 'URGENT', relationshipType: 'PARTNER' }, (r) => r.status === 'PROSPECT' && r.priority === 'URGENT' && r.relationship_type === 'PARTNER'],
      [{ priority: null, relationshipType: null }, (r) => r.priority === null && r.relationship_type === null && r.status === 'PROSPECT'],
      [{ favorite: true }, (r) => r.favorite === true],
      [{ addTags: [BULK_TAG] }, (r) => Array.isArray(r.tags) && r.tags.includes(BULK_TAG)],
    ];
    for (const [body, applied] of steps) {
      const label = JSON.stringify(body);
      const res = await bulkUpdateHttp(ID.staff, [team.id], body);
      expect(res.status, `${label} ${res.text}`).toBe(200);
      expect(res.body, label).toEqual({ updated: 1 });
      expect(applied(await rawRow(team.id)), label).toBe(true);
    }
  });
});
