/**
 * KF-PRODUCT-CONTACTS-PILOT-001 — contact detail row-level visibility (REAL database).
 *
 * Proves the within-tenant defect named by CG-DIR-PRODUCT-CONTACTS-VISIBILITY-001
 * and its fix: GET /crm/businesses/:businessId/contacts/:contactId reached
 * CrmStatsService.contactDetail without the caller's identity, so a member who
 * passes the business/module guards could open another member's PRIVATE (or,
 * under crm_view=owned, any unowned) contact with its notes, events and tasks,
 * while the list route hid the same row. The detail path must apply the same
 * effective visibility as the list path (resolveCrmAccess + visibilityClause)
 * before any child row is read, and must answer like an absent row.
 *
 * Nothing on the authorization boundary is mocked: PrismaService, the user,
 * business, membership, contact and share rows, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, CrmStatsService and CrmService
 * (listContacts) are all real against the database at DATABASE_URL. The only
 * stand-in is identity attachment: a test middleware reads `x-test-user`, loads
 * that seeded user row and attaches `{ id, email, role }` exactly as the
 * Supabase-verifying AuthMiddleware would after token verification, which is
 * the one step that needs an external provider. Everything after that point is
 * the production code path.
 *
 * Requires DATABASE_URL. CI supplies pgvector/pgvector:pg16 + db:deploy, the
 * same fixture the other real-database suites here use. Every seeded row has
 * the `tcv_` prefix and is hard-deleted in beforeAll and afterAll.
 *
 * The case tagged NEGATIVE CONTROL is the pre-fix failing control: on the
 * directive's source main (b1948d27) it returns 200 with the private row.
 *
 * R0-01-CT-RECONCILE adds the ADMIN dossier control. The superseded
 * working-tree variant (6a5c0c3f) ran the journey collaborators in Promise.all
 * beside the detail lookup, so a denied dossier still answered 404 after the
 * collaborators had read the contact's related data. The ADMIN case pins the
 * accepted order (PR #190, b8565e04): the visible detail is awaited first, and
 * a denied dossier is byte-identical to an absent id with no collaborator call.
 * The case list is bound by scripts/proof-admission/manifests/contacts-visibility.json.
 * That manifest sets allowAdditionalCases false: a change that adds, renames or
 * removes a case here must make the same change to its requiredCases, or the
 * report is rejected (KF_PROOF_UNEXPECTED_CASE / KF_PROOF_REQUIRED_CASE_MISSING).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// The V1-08 negative controls send every sibling read for several actors (dozens
// of HTTP round trips per case); under the full parallel run the default 5s
// budget times out with no assertion failing. Assertions unchanged.
vi.setConfig({ testTimeout: 30_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'tcv_';
const ID = {
  // identities
  owner: `${P}owner`,          // OWNER of bizA
  admin: `${P}admin`,          // ADMIN of bizA, no explicit scopes
  staffAll: `${P}staffAll`,    // STAFF of bizA, crm: read (view-all default)
  staffOwned: `${P}staffOwned`, // STAFF of bizA, crm: read + crm_view: owned
  staffNoCrm: `${P}staffNoCrm`, // STAFF of bizA, crm: none
  other: `${P}other`,          // OWNER of bizB only
  nomember: `${P}nomember`,    // no membership anywhere
  superAdmin: `${P}super`,     // role SUPER_ADMIN, no membership
  // tenants
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  // contacts in bizA
  cTeamOwner: `${P}cTeamOwner`,            // TEAM, owned by owner
  cTeamStaffAll: `${P}cTeamStaffAll`,      // TEAM, owned by staffAll (another member's TEAM)
  cTeamUnowned: `${P}cTeamUnowned`,        // TEAM, no owner
  cSharedVis: `${P}cSharedVis`,            // visibility SHARED, owned by owner
  cPrivOwner: `${P}cPrivOwner`,            // PRIVATE, owned by owner, with sensitive child rows
  cPrivStaffAll: `${P}cPrivStaffAll`,      // PRIVATE, owned by staffAll
  cPrivStaffOwned: `${P}cPrivStaffOwned`,  // PRIVATE, owned by staffOwned
  cPrivSharedToOwned: `${P}cPrivSharedOwned`, // PRIVATE, owned by owner, ContactShare -> staffOwned
  cPrivSharedToAdmin: `${P}cPrivSharedAdmin`, // PRIVATE, owned by owner, ContactShare -> admin
  cDeleted: `${P}cDeleted`,                // TEAM, soft-deleted
  // contact in bizB
  cB: `${P}cB`,
  // child rows of cPrivOwner
  note: `${P}note`,
  event: `${P}event`,
  task: `${P}task`,
};

const SENSITIVE_NOTE = 'tcv-sensitive-note-body-4f3a9c';
const SENSITIVE_EVENT_TYPE = 'tcv.sensitive.event';
const SENSITIVE_TASK = 'tcv-sensitive-task-title-7b21e0';

const CHILD_MODELS = ['contactEvent', 'contactNote', 'contactTask', 'invoice', 'booking', 'contactCustomFieldValue'];

let db: any;
let app: any;
let statsRecorder: any;           // CrmStatsService over a model-access recorder
let touched: string[] = [];       // prisma models touched through the recorder

// The dossier route's collaborators (CrmJourneyService). They are not the
// authorization boundary; the claim under test is that a denied dossier never
// invokes them, so they are recorders, not the real service (whose AI insight
// would also be provider traffic).
let journeyCalls: string[] = [];
const journeyRecorder = {
  getContactCrossJourney: async (_businessId: string, contactId: string) => {
    journeyCalls.push(`cross:${contactId}`);
    return { summary: 'tcv-journey-summary', timeline: [] };
  },
  generateAiInsight: async (_businessId: string, contactId: string) => {
    journeyCalls.push(`insight:${contactId}`);
    return null;
  },
  getContactHealthMetrics: async (_businessId: string, contactId: string) => {
    journeyCalls.push(`health:${contactId}`);
    return { score: 0 };
  },
};

const bizAContacts = [
  ID.cTeamOwner, ID.cTeamStaffAll, ID.cTeamUnowned, ID.cSharedVis, ID.cPrivOwner,
  ID.cPrivStaffAll, ID.cPrivStaffOwned, ID.cPrivSharedToOwned, ID.cPrivSharedToAdmin,
];

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension) by prefix.
  for (const sql of [
    // V1-08 sibling-read child rows (and any playbook a sibling read created).
    `DELETE FROM contact_relationships WHERE from_contact_id LIKE '${P}%' OR to_contact_id LIKE '${P}%'`,
    `DELETE FROM contact_data_issues WHERE contact_id LIKE '${P}%'`,
    `DELETE FROM contact_channel_stats WHERE contact_id LIKE '${P}%'`,
    `DELETE FROM contact_playbooks WHERE contact_id LIKE '${P}%'`,
    `DELETE FROM contact_shares WHERE contact_id LIKE '${P}%'`,
    `DELETE FROM contact_notes WHERE contact_id LIKE '${P}%'`,
    `DELETE FROM contact_events WHERE contact_id LIKE '${P}%'`,
    `DELETE FROM contact_tasks WHERE contact_id LIKE '${P}%'`,
    // V1-08 review ST-2: rows a relationship write would leave on the tcv_
    // tenants under generated ids (POST refer creates a contact and logs on it).
    `DELETE FROM contact_relationships WHERE business_id IN ('${ID.bizA}', '${ID.bizB}')`,
    `DELETE FROM contact_events WHERE business_id IN ('${ID.bizA}', '${ID.bizB}')`,
    `DELETE FROM contacts WHERE business_id IN ('${ID.bizA}', '${ID.bizB}')`,
    `DELETE FROM contacts WHERE id LIKE '${P}%'`,
    `DELETE FROM memberships WHERE id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function detail(actor: string | null, contactId: string, businessId = ID.bizA) {
  const req = request(app.getHttpServer()).get(`/crm/businesses/${businessId}/contacts/${contactId}`);
  return actor ? req.set('x-test-user', actor) : req;
}

function list(actor: string, businessId = ID.bizA) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${businessId}/contacts?take=100`)
    .set('x-test-user', actor);
}

function dossier(actor: string | null, contactId: string, businessId = ID.bizA) {
  const req = request(app.getHttpServer()).get(`/crm/businesses/${businessId}/contacts/${contactId}/dossier`);
  return actor ? req.set('x-test-user', actor) : req;
}

/** A denied response must carry no record and none of the sensitive child data. */
function expectNoDisclosure(body: unknown) {
  const text = JSON.stringify(body ?? {});
  expect(text).not.toContain(SENSITIVE_NOTE);
  expect(text).not.toContain(SENSITIVE_EVENT_TYPE);
  expect(text).not.toContain(SENSITIVE_TASK);
  for (const key of ['contact', 'events', 'notes', 'tasks', 'invoices', 'bookings', 'customFieldValues']) {
    expect(body).not.toHaveProperty(key);
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
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
      // CrmStatsService.contactDetail and CrmService.listContacts read Prisma
      // only; every other dependency is a stub the detail and list routes
      // never call.
      { provide: CrmTimelineService, useValue: {} },
      { provide: CrmCacheService, useValue: {} },
      { provide: EventEmitter2, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmListsService, useValue: {} },
      { provide: CrmFlowService, useValue: {} },
      { provide: EntityResolutionService, useValue: {} },
      { provide: ContactAuditService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      { provide: CrmImportService, useValue: {} },
      { provide: CrmPlaybookService, useValue: {} },
      { provide: CrmActionsService, useValue: {} },
      { provide: CrmRevenueService, useValue: {} },
      { provide: CrmJourneyService, useValue: journeyRecorder },
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
  // Identity attachment only. The real AuthMiddleware attaches
  // `{ id, email, role }` from the User row after Supabase verifies the token;
  // this does the same from a header, for seeded tcv_ users only. No guard is
  // overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();

  // ---- the service over a model-access recorder --------------------------
  // Same real client; the proxy only records which Prisma models the service
  // touches, so "no child row is read before the row-level check" is observed
  // rather than argued.
  const recordingClient = new Proxy(db, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') touched.push(prop);
      return Reflect.get(target, prop, receiver);
    },
  });
  statsRecorder = new CrmStatsService({ client: recordingClient } as any, {} as any, {} as any);

  await cleanup(); // in case a prior run aborted

  // ---- identities -------------------------------------------------------
  for (const [id, role] of [
    [ID.owner, 'USER'], [ID.admin, 'USER'], [ID.staffAll, 'USER'], [ID.staffOwned, 'USER'],
    [ID.staffNoCrm, 'USER'], [ID.other, 'USER'], [ID.nomember, 'USER'], [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@test.local`, role } });
  }

  // ---- tenants ----------------------------------------------------------
  await db.business.create({ data: { id: ID.bizA, name: 'TCV Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'TCV Biz B', ownerId: ID.other } });

  // ---- real memberships -------------------------------------------------
  const m = async (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}_${biz.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.admin, ID.bizA, 'ADMIN');
  await m(ID.staffAll, ID.bizA, 'STAFF', { crm: 'read' });
  await m(ID.staffOwned, ID.bizA, 'STAFF', { crm: 'read', crm_view: 'owned' });
  await m(ID.staffNoCrm, ID.bizA, 'STAFF', { crm: 'none' });
  await m(ID.other, ID.bizB, 'OWNER');

  // ---- contacts ---------------------------------------------------------
  const c = async (id: string, biz: string, visibility: string, ownerId: string | null, extra: Record<string, unknown> = {}) =>
    db.contact.create({ data: { id, businessId: biz, firstName: id, visibility, ownerId, ...extra } });
  await c(ID.cTeamOwner, ID.bizA, 'TEAM', ID.owner);
  await c(ID.cTeamStaffAll, ID.bizA, 'TEAM', ID.staffAll);
  await c(ID.cTeamUnowned, ID.bizA, 'TEAM', null);
  await c(ID.cSharedVis, ID.bizA, 'SHARED', ID.owner);
  await c(ID.cPrivOwner, ID.bizA, 'PRIVATE', ID.owner);
  await c(ID.cPrivStaffAll, ID.bizA, 'PRIVATE', ID.staffAll);
  await c(ID.cPrivStaffOwned, ID.bizA, 'PRIVATE', ID.staffOwned);
  await c(ID.cPrivSharedToOwned, ID.bizA, 'PRIVATE', ID.owner);
  await c(ID.cPrivSharedToAdmin, ID.bizA, 'PRIVATE', ID.owner);
  await c(ID.cDeleted, ID.bizA, 'TEAM', ID.owner, { deletedAt: new Date() });
  await c(ID.cB, ID.bizB, 'TEAM', ID.other);

  // ---- explicit shares --------------------------------------------------
  await db.contactShare.create({ data: { id: `${P}share_owned`, businessId: ID.bizA, contactId: ID.cPrivSharedToOwned, userId: ID.staffOwned, createdBy: ID.owner } });
  await db.contactShare.create({ data: { id: `${P}share_admin`, businessId: ID.bizA, contactId: ID.cPrivSharedToAdmin, userId: ID.admin, createdBy: ID.owner } });

  // ---- sensitive child rows on the foreign PRIVATE contact --------------
  await db.contactNote.create({ data: { id: ID.note, businessId: ID.bizA, contactId: ID.cPrivOwner, body: SENSITIVE_NOTE, authorId: ID.owner } });
  await db.contactEvent.create({ data: { id: ID.event, businessId: ID.bizA, contactId: ID.cPrivOwner, type: SENSITIVE_EVENT_TYPE, data: { marker: SENSITIVE_EVENT_TYPE } } });
  await db.contactTask.create({ data: { id: ID.task, businessId: ID.bizA, contactId: ID.cPrivOwner, title: SENSITIVE_TASK } });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it('seeded the memberships, contacts, shares and child rows', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(5);
    expect(await db.contactShare.count({ where: { businessId: ID.bizA } })).toBe(2);
    expect(await db.contactNote.count({ where: { contactId: ID.cPrivOwner } })).toBe(1);
    expect(await db.contactEvent.count({ where: { contactId: ID.cPrivOwner } })).toBe(1);
    expect(await db.contactTask.count({ where: { contactId: ID.cPrivOwner } })).toBe(1);
    // The soft-deleted row exists in the table (raw SQL is under the extension).
    const rows = await db.$queryRawUnsafe(`SELECT id, deleted_at FROM contacts WHERE id = '${ID.cDeleted}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_at).not.toBeNull();
  });
});

describe('GET contact detail through the real guard path', () => {
  it('rejects a request with no identity (401) before any lookup', async () => {
    const res = await detail(null, ID.cTeamOwner);
    expect(res.status).toBe(401);
    expectNoDisclosure(res.body);
  });

  it('rejects a user with no membership (403)', async () => {
    const res = await detail(ID.nomember, ID.cTeamOwner);
    expect(res.status).toBe(403);
    expectNoDisclosure(res.body);
  });

  it('rejects a member of another tenant on this tenant path (403), and the reverse', async () => {
    const res = await detail(ID.other, ID.cTeamOwner);
    expect(res.status).toBe(403);
    expectNoDisclosure(res.body);
    const reverse = await detail(ID.owner, ID.cB, ID.bizB);
    expect(reverse.status).toBe(403);
    expectNoDisclosure(reverse.body);
  });

  it("rejects a member whose CRM module scope is none (403) even for the member's own tenant", async () => {
    const res = await detail(ID.staffNoCrm, ID.cTeamOwner);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Insufficient permissions/);
    expectNoDisclosure(res.body);
  });

  it("another tenant's contact id under this tenant path is not found (404) for the owner", async () => {
    const res = await detail(ID.owner, ID.cB);
    expect(res.status).toBe(404);
    expectNoDisclosure(res.body);
  });

  it('positive control: the other tenant opens its own contact on its own path (200)', async () => {
    const res = await detail(ID.other, ID.cB, ID.bizB);
    expect(res.status).toBe(200);
    expect(res.body.contact.id).toBe(ID.cB);
  });

  it('a soft-deleted contact is not found for anyone, owner included (404)', async () => {
    for (const actor of [ID.owner, ID.superAdmin, ID.admin, ID.staffAll]) {
      const res = await detail(actor, ID.cDeleted);
      expect(res.status, `actor ${actor}`).toBe(404);
      expectNoDisclosure(res.body);
    }
  });

  it('OWNER and SUPER_ADMIN open every live contact of the tenant, PRIVATE included, with child rows', async () => {
    for (const actor of [ID.owner, ID.superAdmin]) {
      for (const contactId of bizAContacts) {
        const res = await detail(actor, contactId);
        expect(res.status, `actor ${actor} contact ${contactId}`).toBe(200);
        expect(res.body.contact.id).toBe(contactId);
      }
      const priv = await detail(actor, ID.cPrivOwner);
      // The denial cases below are not vacuous: the permitted actor does get
      // the sensitive child rows back.
      expect(priv.body.notes.map((n: any) => n.body)).toEqual([SENSITIVE_NOTE]);
      expect(priv.body.events.map((e: any) => e.type)).toEqual([SENSITIVE_EVENT_TYPE]);
      expect(priv.body.tasks.map((t: any) => t.title)).toEqual([SENSITIVE_TASK]);
    }
  });

  it('ADMIN (view-all) opens TEAM, SHARED, and explicitly shared PRIVATE rows, but not other members\' PRIVATE rows', async () => {
    for (const contactId of [ID.cTeamOwner, ID.cTeamStaffAll, ID.cTeamUnowned, ID.cSharedVis, ID.cPrivSharedToAdmin]) {
      const res = await detail(ID.admin, contactId);
      expect(res.status, `contact ${contactId}`).toBe(200);
      expect(res.body.contact.id).toBe(contactId);
    }
    for (const contactId of [ID.cPrivOwner, ID.cPrivStaffAll, ID.cPrivStaffOwned, ID.cPrivSharedToOwned]) {
      const res = await detail(ID.admin, contactId);
      expect(res.status, `contact ${contactId}`).toBe(404);
      expectNoDisclosure(res.body);
    }
  });

  it("STAFF with read-only view-all opens another member's TEAM, SHARED and their own PRIVATE rows", async () => {
    for (const contactId of [ID.cTeamOwner, ID.cTeamStaffAll, ID.cTeamUnowned, ID.cSharedVis, ID.cPrivStaffAll]) {
      const res = await detail(ID.staffAll, contactId);
      expect(res.status, `contact ${contactId}`).toBe(200);
      expect(res.body.contact.id).toBe(contactId);
    }
  });

  it("NEGATIVE CONTROL (pre-fix FAIL expected): STAFF view-all cannot open another member's PRIVATE contact, and nothing of it is disclosed", async () => {
    const res = await detail(ID.staffAll, ID.cPrivOwner);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Contact not found');
    expectNoDisclosure(res.body);
  });

  it('STAFF view-all is also denied the PRIVATE rows shared to someone else or owned by someone else', async () => {
    for (const contactId of [ID.cPrivSharedToOwned, ID.cPrivSharedToAdmin, ID.cPrivStaffOwned]) {
      const res = await detail(ID.staffAll, contactId);
      expect(res.status, `contact ${contactId}`).toBe(404);
      expectNoDisclosure(res.body);
    }
  });

  it('STAFF with crm_view=owned opens only owned and explicitly shared rows; another member\'s TEAM row is not found', async () => {
    for (const contactId of [ID.cPrivStaffOwned, ID.cPrivSharedToOwned]) {
      const res = await detail(ID.staffOwned, contactId);
      expect(res.status, `contact ${contactId}`).toBe(200);
      expect(res.body.contact.id).toBe(contactId);
    }
    for (const contactId of [ID.cTeamOwner, ID.cTeamStaffAll, ID.cTeamUnowned, ID.cSharedVis, ID.cPrivOwner, ID.cPrivStaffAll, ID.cPrivSharedToAdmin]) {
      const res = await detail(ID.staffOwned, contactId);
      expect(res.status, `contact ${contactId}`).toBe(404);
      expectNoDisclosure(res.body);
    }
  });

  it('a forbidden row and an absent row answer identically (no existence oracle)', async () => {
    const forbidden = await detail(ID.staffOwned, ID.cPrivOwner);
    const absent = await detail(ID.staffOwned, `${P}does-not-exist`);
    expect(forbidden.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(forbidden.body).toEqual(absent.body);
  });

  it('detail and list agree for every actor: a contact opens if and only if it is listed', async () => {
    // OWNER and SUPER_ADMIN opened all nine above; their list must show all nine.
    for (const actor of [ID.owner, ID.superAdmin]) {
      const listed = await list(actor);
      expect(listed.status, `list for ${actor}`).toBe(200);
      const ids = new Set((listed.body.contacts as Array<{ id: string }>).map((x) => x.id));
      expect(ids.has(ID.cDeleted)).toBe(false);
      for (const contactId of bizAContacts) expect(ids.has(contactId), `actor ${actor} list ${contactId}`).toBe(true);
    }
    // The scoped actors: measured detail against the real list, row by row.
    for (const actor of [ID.admin, ID.staffAll, ID.staffOwned]) {
      const listed = await list(actor);
      expect(listed.status, `list for ${actor}`).toBe(200);
      const ids = new Set((listed.body.contacts as Array<{ id: string }>).map((x) => x.id));
      expect(ids.has(ID.cDeleted)).toBe(false);
      for (const contactId of bizAContacts) {
        const res = await detail(actor, contactId);
        const opens = res.status === 200;
        expect(opens, `actor ${actor} contact ${contactId}: detail ${res.status}, listed ${ids.has(contactId)}`).toBe(ids.has(contactId));
      }
    }
  });

  it('denied reads mutate nothing: the private row and its child rows are unchanged', async () => {
    const before = await db.contact.findUnique({ where: { id: ID.cPrivOwner }, select: { updatedAt: true, ownerId: true, visibility: true } });
    await detail(ID.staffAll, ID.cPrivOwner);
    await detail(ID.staffOwned, ID.cPrivOwner);
    await detail(ID.admin, ID.cPrivOwner);
    const after = await db.contact.findUnique({ where: { id: ID.cPrivOwner }, select: { updatedAt: true, ownerId: true, visibility: true } });
    expect(after).toEqual(before);
    expect(await db.contactNote.count({ where: { contactId: ID.cPrivOwner } })).toBe(1);
    expect(await db.contactEvent.count({ where: { contactId: ID.cPrivOwner } })).toBe(1);
    expect(await db.contactTask.count({ where: { contactId: ID.cPrivOwner } })).toBe(1);
    expect(await db.contactShare.count({ where: { businessId: ID.bizA } })).toBe(2);
  });
});

describe('GET contact dossier through the real guard path', () => {
  it('rejects a request with no identity (401) and a member of another tenant (403) before any lookup', async () => {
    journeyCalls = [];
    const anon = await dossier(null, ID.cTeamOwner);
    expect(anon.status).toBe(401);
    const other = await dossier(ID.other, ID.cTeamOwner);
    expect(other.status).toBe(403);
    expectNoDisclosure(anon.body);
    expectNoDisclosure(other.body);
    expect(journeyCalls).toEqual([]);
  });

  it("NEGATIVE CONTROL (pre-fix FAIL expected): STAFF view-all cannot open another member's PRIVATE dossier, nothing is disclosed, and the journey collaborators are never invoked", async () => {
    journeyCalls = [];
    const res = await dossier(ID.staffAll, ID.cPrivOwner);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Contact not found');
    expectNoDisclosure(res.body);
    for (const key of ['meta', 'summary', 'timeline', 'insight', 'health']) {
      expect(res.body).not.toHaveProperty(key);
    }
    expect(journeyCalls).toEqual([]);
  });

  it("NEGATIVE CONTROL (pre-fix FAIL expected): ADMIN with no permission scopes cannot open another member's PRIVATE dossier; it answers byte-identical to an absent id and no collaborator is invoked", async () => {
    // The ADMIN membership carries no permissionScopes (view-all by role), so
    // the only thing between it and these rows is the PRIVATE visibility rule.
    const absentId = `${P}does-not-exist`;
    for (const contactId of [ID.cPrivOwner, ID.cPrivStaffAll, ID.cPrivStaffOwned, ID.cPrivSharedToOwned]) {
      journeyCalls = [];
      const res = await dossier(ID.admin, contactId);
      expect(res.status, `contact ${contactId}`).toBe(404);
      // A denied dossier never starts the journey, AI-insight or health lookups.
      expect(journeyCalls, `contact ${contactId}`).toEqual([]);
      expectNoDisclosure(res.body);
      for (const key of ['meta', 'summary', 'timeline', 'insight', 'health']) {
        expect(res.body, `contact ${contactId}`).not.toHaveProperty(key);
      }

      journeyCalls = [];
      const absent = await dossier(ID.admin, absentId);
      expect(absent.status).toBe(404);
      expect(journeyCalls).toEqual([]);
      // No existence oracle: the forbidden row and the absent id are the same bytes.
      expect(res.text, `contact ${contactId}`).toBe(absent.text);
      expect(res.headers['content-type']).toBe(absent.headers['content-type']);
      expect(res.body).toEqual({ statusCode: 404, message: 'Contact not found', error: 'Not Found' });
    }
  });

  it('positive control: ADMIN with no permission scopes opens the dossier of a TEAM row and of a PRIVATE row shared to them, and each collaborator is consulted exactly once', async () => {
    for (const contactId of [ID.cTeamStaffAll, ID.cPrivSharedToAdmin]) {
      journeyCalls = [];
      const res = await dossier(ID.admin, contactId);
      expect(res.status, `contact ${contactId}`).toBe(200);
      expect(res.body.contact.id).toBe(contactId);
      expect(res.body.summary).toBe('tcv-journey-summary');
      expect([...journeyCalls].sort()).toEqual([`cross:${contactId}`, `health:${contactId}`, `insight:${contactId}`]);
    }
  });

  it("an owned-view STAFF member is denied another member's TEAM dossier without any collaborator call", async () => {
    journeyCalls = [];
    const res = await dossier(ID.staffOwned, ID.cTeamOwner);
    expect(res.status).toBe(404);
    expectNoDisclosure(res.body);
    expect(journeyCalls).toEqual([]);
  });

  it('the owner receives the PRIVATE dossier with its child rows, and each collaborator is consulted exactly once', async () => {
    journeyCalls = [];
    const res = await dossier(ID.owner, ID.cPrivOwner);
    expect(res.status).toBe(200);
    expect(res.body.contact.id).toBe(ID.cPrivOwner);
    expect(res.body.notes.map((n: any) => n.body)).toEqual([SENSITIVE_NOTE]);
    expect(res.body.tasks.map((t: any) => t.title)).toEqual([SENSITIVE_TASK]);
    expect(res.body.summary).toBe('tcv-journey-summary');
    expect([...journeyCalls].sort()).toEqual([`cross:${ID.cPrivOwner}`, `health:${ID.cPrivOwner}`, `insight:${ID.cPrivOwner}`]);
  });

  it('a STAFF member opens their own PRIVATE dossier (positive control for the scoped path)', async () => {
    journeyCalls = [];
    const res = await dossier(ID.staffAll, ID.cPrivStaffAll);
    expect(res.status).toBe(200);
    expect(res.body.contact.id).toBe(ID.cPrivStaffAll);
    expect(journeyCalls).toHaveLength(3);
  });
});

describe('CrmStatsService.contactDetail (real database, model-access recorder)', () => {
  const childTouched = () => touched.filter((m) => CHILD_MODELS.includes(m));

  it('system context (no actor) keeps the tenant-only predicate for internal callers', async () => {
    touched = [];
    const result = await statsRecorder.contactDetail({ businessId: ID.bizA, contactId: ID.cPrivOwner });
    expect(result.contact.id).toBe(ID.cPrivOwner);
    expect(new Set(childTouched())).toEqual(new Set(CHILD_MODELS));
  });

  it('a non-member actor is refused by the membership check before any contact or child row is read', async () => {
    touched = [];
    await expect(statsRecorder.contactDetail({ businessId: ID.bizA, contactId: ID.cTeamOwner, actorUserId: ID.nomember }))
      .rejects.toMatchObject({ status: 403 });
    expect(touched).not.toContain('contact');
    expect(childTouched()).toEqual([]);
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): a forbidden PRIVATE row is not found, and no child row is read', async () => {
    touched = [];
    await expect(statsRecorder.contactDetail({ businessId: ID.bizA, contactId: ID.cPrivOwner, actorUserId: ID.staffAll }))
      .rejects.toMatchObject({ status: 404, message: 'Contact not found' });
    expect(touched).toContain('contact');
    expect(childTouched()).toEqual([]);
  });

  it('an absent contact id reads exactly like a forbidden one', async () => {
    const forbidden = await statsRecorder.contactDetail({ businessId: ID.bizA, contactId: ID.cPrivOwner, actorUserId: ID.staffOwned }).catch((e: any) => e);
    const absent = await statsRecorder.contactDetail({ businessId: ID.bizA, contactId: `${P}nope`, actorUserId: ID.staffOwned }).catch((e: any) => e);
    expect(forbidden.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(forbidden.getResponse()).toEqual(absent.getResponse());
  });

  it("another tenant's contact under business A is not found for A's owner", async () => {
    await expect(statsRecorder.contactDetail({ businessId: ID.bizA, contactId: ID.cB, actorUserId: ID.owner }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('a permitted actor loads the row and every child set', async () => {
    touched = [];
    const result = await statsRecorder.contactDetail({ businessId: ID.bizA, contactId: ID.cPrivOwner, actorUserId: ID.owner });
    expect(result.contact.id).toBe(ID.cPrivOwner);
    expect(result.notes.map((n: any) => n.body)).toEqual([SENSITIVE_NOTE]);
    expect(new Set(childTouched())).toEqual(new Set(CHILD_MODELS));
  });
});

// ---------------------------------------------------------------------------
// V1-08-CT-SIBLING-VISIBILITY (M13, PRS-M12): the fourteen contact-scoped
// sibling reads. Each applied the tenant predicate only (e.g.
// CrmTimelineService.assertContact), so a member who passes the guards read
// another member's PRIVATE contact, or under crm_view=owned any unowned one,
// through events, notes, journey and the rest, while GET detail answered 404.
// Here the real services run over a model-access recorder: a refused read must
// answer the detail's 404, byte-identical to an absent id, having read no model
// beyond the guards' and the visibility gate's own lookups.
//
// Review repairs (ST-1, ST-2, ST-3, CR-1): relationships and network answer for
// a contact the member may open but name its neighbours, and the business
// network names every related contact, so each now keeps only the contacts GET
// detail opens for that member; POST relationships and POST refer gate both
// ends, so a member cannot relate (and so read back) a contact hidden from them.
// ---------------------------------------------------------------------------

const SIBLING_READS = [
  'events', 'notes', 'journey', 'cross-journey', 'story', 'revenue-summary', 'health-metrics',
  'relationships', 'network', 'data-quality', 'playbook', 'conversations', 'conversation-context', 'best-channel',
] as const;
type SiblingRead = typeof SIBLING_READS[number];
type SiblingOutcome = { status: number; read: string[]; text: string };
type SiblingOutcomes = Record<SiblingRead, SiblingOutcome>;

// What a sibling read may touch before it knows the caller may open the
// contact: BusinessGuard's business lookup, ModuleScopeGuard's membership
// lookup, and the visibility gate's user, membership and contact lookups.
// Any other model is a child read.
const GATE_MODELS = ['user', 'membership', 'business', 'contact'];
const NOT_FOUND_BODY = { statusCode: 404, message: 'Contact not found', error: 'Not Found' };
const ABSENT_ID = `${P}does-not-exist`;

const SIB = {
  staffWrite: `${P}staffWrite`,   // STAFF of bizA, crm: write, no crm_reassign
  rel: `${P}rel_priv`,            // relationship cPrivOwner -> cTeamOwner
  issue: `${P}dq_priv`,           // open data-quality issue on cPrivOwner
  stat: `${P}chan_priv`,          // channel stat on cPrivOwner
  sharedNote: `${P}note_shared`,  // child rows of cPrivSharedToOwned
  sharedEvent: `${P}event_shared`,
  sharedRel: `${P}rel_shared`,
  sharedIssue: `${P}dq_shared`,
};
const SENSITIVE_REL_NOTE = 'tcv-sensitive-relationship-note-91d2c4';
const SENSITIVE_ISSUE = 'tcv-sensitive-data-issue-0c7e55';
const SHARED_NOTE = 'tcv-shared-note-body-5a1f07';
const SHARED_EVENT_BODY = 'tcv-shared-email-body-62c9d3';
const SHARED_REL_NOTE = 'tcv-shared-relationship-note-3e8b19';
const SHARED_ISSUE = 'tcv-shared-data-issue-d40a6b';

const every = <T>(value: T) => Object.fromEntries(SIBLING_READS.map((r) => [r, value]));
const byRoute = <K extends keyof SiblingOutcome>(o: SiblingOutcomes, key: K) =>
  Object.fromEntries(SIBLING_READS.map((r) => [r, o[r][key]]));

describe('contact-scoped sibling reads through the real guard path (V1-08)', () => {
  let siblingApp: any;
  let siblingTouched: string[] = [];

  function sibling(actor: string | null, contactId: string, route: SiblingRead, businessId = ID.bizA) {
    const req = request(siblingApp.getHttpServer()).get(`/crm/businesses/${businessId}/contacts/${contactId}/${route}`);
    return actor ? req.set('x-test-user', actor) : req;
  }

  /** Every sibling read of `contactId` by `actor`: status, models read beyond the gate, body. */
  async function outcomes(actor: string | null, contactId: string, businessId = ID.bizA): Promise<SiblingOutcomes> {
    const out = {} as SiblingOutcomes;
    for (const route of SIBLING_READS) {
      siblingTouched = [];
      const res = await sibling(actor, contactId, route, businessId);
      const read = [...new Set(siblingTouched.filter((m) => !GATE_MODELS.includes(m)))].sort();
      out[route] = { status: res.status, read, text: res.text };
    }
    return out;
  }

  /** Refused: the detail's 404 on every route, the same bytes as an absent id, no child read. */
  /** The tcv_ contacts a response body names (by quoted id, so no id matches inside another). */
  const namedContacts = (text: string) =>
    [...bizAContacts, ID.cDeleted, ID.cB].filter((id) => text.includes(`"${id}"`));

  /**
   * Whether GET detail opens `contactId` for `actor`: the service that route
   * calls with the session member (CrmStatsService.contactDetail, the real
   * rule), called directly so the review cases stay clear of the detail
   * route's per-handler rate limit, which the cases above already load.
   */
  async function detailOpens(actor: string, contactId: string): Promise<boolean> {
    try {
      await statsRecorder.contactDetail({ businessId: ID.bizA, contactId, actorUserId: actor });
      return true;
    } catch (err: any) {
      if (err?.status === 404) return false;
      throw err;
    }
  }

  /** Every contact `text` names opens on GET detail for `actor`. */
  async function expectNamesOnlyOpenable(actor: string, label: string, text: string) {
    for (const named of namedContacts(text)) {
      expect(await detailOpens(actor, named), `${actor}: ${label} names ${named}`).toBe(true);
    }
  }

  async function expectRefusedEverywhere(actor: string, contactId: string) {
    const refused = await outcomes(actor, contactId);
    const absent = await outcomes(actor, ABSENT_ID);
    expect(byRoute(refused, 'status'), `${actor} on ${contactId}: status`).toEqual(every(404));
    expect(byRoute(refused, 'read'), `${actor} on ${contactId}: models read beyond the gate`).toEqual(every([]));
    expect(byRoute(refused, 'text'), `${actor} on ${contactId}: body vs an absent id`).toEqual(byRoute(absent, 'text'));
    for (const route of SIBLING_READS) {
      expect(JSON.parse(refused[route].text), route).toEqual(NOT_FOUND_BODY);
    }
  }

  beforeAll(async () => {
    const { Test } = await import('@nestjs/testing');
    const { EventEmitter2 } = await import('@nestjs/event-emitter');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
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

    // One recorder under the guards, the visibility gate and every sibling
    // service: the same real client, which only notes the Prisma models a
    // request touches.
    const recordingClient = new Proxy(db, {
      get(target, prop, receiver) {
        if (typeof prop === 'string') siblingTouched.push(prop);
        return Reflect.get(target, prop, receiver);
      },
    });
    const prisma = { client: recordingClient } as any;
    // The sibling services are real; what they are handed besides Prisma is a
    // stub their read paths never call (the timeline writer's collaborators,
    // the reputation and duplicate services, the WhatsApp sender).
    const timeline = new CrmTimelineService(prisma, {} as any, {} as any, {} as any, {} as any);

    const moduleRef = await Test.createTestingModule({
      controllers: [CrmController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        CrmRateLimitGuard,
        FeatureFlagGuard,
        PlanLimitGuard,
        TeamAuditInterceptor,
        CrmService,
        { provide: CrmTimelineService, useValue: timeline },
        { provide: CrmJourneyService, useValue: new CrmJourneyService(prisma) },
        { provide: CrmRevenueService, useValue: new CrmRevenueService(prisma) },
        { provide: CrmNetworkService, useValue: new CrmNetworkService(prisma, timeline, {} as any) },
        { provide: CrmDataQualityService, useValue: new CrmDataQualityService(prisma, {} as any) },
        { provide: CrmPlaybookService, useValue: new CrmPlaybookService(prisma) },
        { provide: CrmCommunicationService, useValue: new CrmCommunicationService(prisma, { on: () => undefined } as any, timeline, {} as any) },
        { provide: BestChannelService, useValue: new BestChannelService(prisma) },
        // Not on any sibling read's path.
        { provide: CrmStatsService, useValue: {} },
        { provide: CrmCacheService, useValue: {} },
        { provide: EventEmitter2, useValue: {} },
        { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
        { provide: CrmListsService, useValue: {} },
        { provide: CrmFlowService, useValue: {} },
        { provide: EntityResolutionService, useValue: {} },
        { provide: ContactAuditService, useValue: {} },
        { provide: ContactCustomFieldValueService, useValue: {} },
        { provide: CrmImportService, useValue: {} },
        { provide: CrmActionsService, useValue: {} },
        { provide: CrmDuplicateDetectionService, useValue: {} },
        { provide: CrmSavedViewsService, useValue: {} },
        { provide: CrmRelationshipHealthService, useValue: {} },
        { provide: ConversationAiService, useValue: {} },
        { provide: ContactInsightService, useValue: {} },
      ],
    }).compile();

    siblingApp = moduleRef.createNestApplication();
    // Identity attachment only, as in the detail suite above; no guard is overridden.
    siblingApp.use(async (req: any, _res: any, next: any) => {
      const header = req.headers['x-test-user'];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    await siblingApp.init();

    // A crm 'write' STAFF member without crm_reassign, for the PATCH ownerId control.
    await db.user.create({ data: { id: SIB.staffWrite, email: `${SIB.staffWrite}@test.local`, role: 'USER' } });
    await db.membership.create({ data: { id: `${P}m_staffWrite_bizA`, userId: SIB.staffWrite, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write' } } });

    // Child rows the sibling reads return, on the owner's PRIVATE contact (which
    // already carries the sensitive note, event and task) ...
    await db.contactRelationship.create({ data: { id: SIB.rel, businessId: ID.bizA, fromContactId: ID.cPrivOwner, toContactId: ID.cTeamOwner, type: 'colleague_of', note: SENSITIVE_REL_NOTE } });
    await db.contactDataIssue.create({ data: { id: SIB.issue, businessId: ID.bizA, contactId: ID.cPrivOwner, kind: 'stale_data', severity: 'high', message: SENSITIVE_ISSUE } });
    await db.contactChannelStat.create({ data: { id: SIB.stat, businessId: ID.bizA, contactId: ID.cPrivOwner, channel: 'email', sentCount: 7, replyCount: 3 } });
    // ... and on the owner's PRIVATE contact explicitly shared with the owned-view STAFF member.
    await db.contactNote.create({ data: { id: SIB.sharedNote, businessId: ID.bizA, contactId: ID.cPrivSharedToOwned, body: SHARED_NOTE, authorId: ID.owner } });
    await db.contactEvent.create({ data: { id: SIB.sharedEvent, businessId: ID.bizA, contactId: ID.cPrivSharedToOwned, type: 'communication.email', data: { body: SHARED_EVENT_BODY } } });
    await db.contactRelationship.create({ data: { id: SIB.sharedRel, businessId: ID.bizA, fromContactId: ID.cPrivSharedToOwned, toContactId: ID.cPrivStaffOwned, type: 'colleague_of', note: SHARED_REL_NOTE } });
    await db.contactDataIssue.create({ data: { id: SIB.sharedIssue, businessId: ID.bizA, contactId: ID.cPrivSharedToOwned, kind: 'stale_data', severity: 'low', message: SHARED_ISSUE } });
  }, 120_000);

  afterAll(async () => {
    if (siblingApp) await siblingApp.close();
  });

  it('fixture sanity: the sibling child rows are seeded on the PRIVATE contacts and the crm write STAFF member has no crm_reassign', async () => {
    expect(await db.contactRelationship.count({ where: { fromContactId: { in: [ID.cPrivOwner, ID.cPrivSharedToOwned] } } })).toBe(2);
    expect(await db.contactDataIssue.count({ where: { contactId: { in: [ID.cPrivOwner, ID.cPrivSharedToOwned] }, status: 'open' } })).toBe(2);
    expect(await db.contactChannelStat.count({ where: { contactId: ID.cPrivOwner } })).toBe(1);
    expect(await db.contactNote.count({ where: { contactId: ID.cPrivSharedToOwned } })).toBe(1);
    expect(await db.contactEvent.count({ where: { contactId: ID.cPrivSharedToOwned } })).toBe(1);
    const m = await db.membership.findUnique({ where: { userId_businessId: { userId: SIB.staffWrite, businessId: ID.bizA } } });
    expect(m.permissionScopes).toEqual({ crm: 'write' });
  });

  it('rejects a request with no identity (401) on every sibling read before any lookup', async () => {
    const anon = await outcomes(null, ID.cPrivOwner);
    expect(byRoute(anon, 'status')).toEqual(every(401));
    expect(byRoute(anon, 'read')).toEqual(every([]));
  });

  it("NEGATIVE CONTROL (pre-fix FAIL expected): an owned-view STAFF member gets 404 on every sibling read of another member's PRIVATE contact, byte-identical to an absent id, and no child model is read", async () => {
    await expectRefusedEverywhere(ID.staffOwned, ID.cPrivOwner);
  });

  it("NEGATIVE CONTROL (pre-fix FAIL expected): a view-all STAFF member and an ADMIN with no permission scopes get 404 on every sibling read of another member's PRIVATE contact, and no child model is read", async () => {
    await expectRefusedEverywhere(ID.staffAll, ID.cPrivOwner);
    await expectRefusedEverywhere(ID.admin, ID.cPrivOwner);
    await expectRefusedEverywhere(ID.staffAll, ID.cPrivSharedToOwned);
  });

  it("NEGATIVE CONTROL (pre-fix FAIL expected): an owned-view STAFF member gets 404 on every sibling read of another member's TEAM contact, as on GET detail", async () => {
    await expectRefusedEverywhere(ID.staffOwned, ID.cTeamOwner);
  });

  it("NEGATIVE CONTROL (pre-fix FAIL expected): a soft-deleted contact and another tenant's contact id are not found on any sibling read, for the owner too", async () => {
    await expectRefusedEverywhere(ID.owner, ID.cDeleted);
    await expectRefusedEverywhere(ID.owner, ID.cB);
  });

  it('NEGATIVE CONTROL (pre-fix FAIL expected): refused sibling reads write nothing: no playbook is created for the hidden contact and its rows are unchanged', async () => {
    const playbooks = () => db.contactPlaybook.count({ where: { contactId: { in: [ID.cPrivOwner, ID.cB] } } });
    const before = await playbooks();
    const contactBefore = await db.contact.findUnique({ where: { id: ID.cPrivOwner }, select: { updatedAt: true, ownerId: true, visibility: true } });
    for (const actor of [ID.staffOwned, ID.staffAll, ID.admin]) {
      expect((await sibling(actor, ID.cPrivOwner, 'playbook')).status, actor).toBe(404);
    }
    expect((await sibling(ID.owner, ID.cB, 'playbook')).status).toBe(404);
    expect(await playbooks()).toBe(before);
    expect(await db.contact.findUnique({ where: { id: ID.cPrivOwner }, select: { updatedAt: true, ownerId: true, visibility: true } })).toEqual(contactBefore);
    expect(await db.contactRelationship.count({ where: { fromContactId: ID.cPrivOwner } })).toBe(1);
    expect(await db.contactDataIssue.count({ where: { contactId: ID.cPrivOwner } })).toBe(1);
    expect(await db.contactNote.count({ where: { contactId: ID.cPrivOwner } })).toBe(1);
    expect(await db.contactEvent.count({ where: { contactId: ID.cPrivOwner } })).toBe(1);
  });

  it('positive control: the owner gets 200 on every sibling read of their PRIVATE contact, with its child rows', async () => {
    const owner = await outcomes(ID.owner, ID.cPrivOwner);
    expect(byRoute(owner, 'status')).toEqual(every(200));
    const markers: Partial<Record<SiblingRead, string>> = {
      events: SENSITIVE_EVENT_TYPE,
      notes: SENSITIVE_NOTE,
      'cross-journey': SENSITIVE_NOTE,
      story: SENSITIVE_NOTE,
      relationships: SENSITIVE_REL_NOTE,
      network: SENSITIVE_REL_NOTE,
      'data-quality': SENSITIVE_ISSUE,
      playbook: ID.cPrivOwner,
      conversations: SENSITIVE_NOTE,
      'conversation-context': SENSITIVE_NOTE,
      'revenue-summary': ID.cPrivOwner,
    };
    for (const [route, marker] of Object.entries(markers)) {
      expect(owner[route as SiblingRead].text, route).toContain(marker);
    }
    expect(JSON.parse(owner['best-channel'].text).perChannel).toEqual([
      expect.objectContaining({ channel: 'email', sentCount: 7, replyCount: 3 }),
    ]);
  });

  it('positive control: an owned-view STAFF member gets 200 on every sibling read of a PRIVATE contact explicitly shared with them, with its child rows', async () => {
    const shared = await outcomes(ID.staffOwned, ID.cPrivSharedToOwned);
    expect(byRoute(shared, 'status')).toEqual(every(200));
    const markers: Partial<Record<SiblingRead, string>> = {
      events: SHARED_EVENT_BODY,
      notes: SHARED_NOTE,
      'cross-journey': SHARED_NOTE,
      story: SHARED_NOTE,
      relationships: SHARED_REL_NOTE,
      network: SHARED_REL_NOTE,
      'data-quality': SHARED_ISSUE,
      playbook: ID.cPrivSharedToOwned,
      conversations: SHARED_EVENT_BODY,
      'conversation-context': SHARED_NOTE,
      'revenue-summary': ID.cPrivSharedToOwned,
    };
    for (const [route, marker] of Object.entries(markers)) {
      expect(shared[route as SiblingRead].text, route).toContain(marker);
    }
  });

  it('sibling reads and detail agree for every scoped actor: each sibling read answers 200 if and only if GET detail opens the contact, and 404 otherwise; relationships and network name no contact GET detail does not open (review ST-1)', async () => {
    for (const actor of [ID.admin, ID.staffAll, ID.staffOwned]) {
      const opens = new Map<string, boolean>();
      for (const contactId of bizAContacts) opens.set(contactId, (await detail(actor, contactId)).status === 200);
      for (const contactId of bizAContacts) {
        const sib = await outcomes(actor, contactId);
        expect(byRoute(sib, 'status'), `actor ${actor} contact ${contactId} (detail opens: ${opens.get(contactId)})`).toEqual(every(opens.get(contactId) ? 200 : 404));
        // Review ST-1: the status alone cannot see a neighbour in a 200 body.
        for (const route of ['relationships', 'network'] as const) {
          for (const named of namedContacts(sib[route].text)) {
            expect(opens.get(named) === true, `actor ${actor}: ${route} of ${contactId} names ${named}`).toBe(true);
          }
        }
      }
    }
  }, 300_000);

  it("PATCH ownerId (regression control, R0-13c ST-B): a crm 'write' STAFF member without crm_reassign is refused 403 on a TEAM contact they can see and 404 like an unknown id on another member's PRIVATE contact; the owner is unchanged", async () => {
    const patch = (contactId: string) => request(app.getHttpServer())
      .patch(`/crm/businesses/${ID.bizA}/contacts/${contactId}`)
      .set('x-test-user', SIB.staffWrite)
      .send({ ownerId: SIB.staffWrite });
    const team = await patch(ID.cTeamOwner);
    expect(team.status).toBe(403);
    expect(team.body.message).toBe('You do not have permission to reassign contacts');
    const priv = await patch(ID.cPrivOwner);
    const absent = await patch(ABSENT_ID);
    expect(priv.status).toBe(404);
    expect(priv.text).toBe(absent.text);
    for (const contactId of [ID.cTeamOwner, ID.cPrivOwner]) {
      expect((await db.contact.findUnique({ where: { id: contactId }, select: { ownerId: true } })).ownerId).toBe(ID.owner);
    }
  });
  it('NEGATIVE CONTROL (review ST-1): relationships and network of a contact the member may open name no neighbour GET detail hides from them (no row, node, edge or note), nor a contact reached only through one; the owner still sees every neighbour', async () => {
    // Two edges for this case only: cPrivOwner -> cTeamUnowned puts the TEAM
    // contact two steps from cTeamOwner through the owner's PRIVATE contact,
    // and cTeamUnowned -> cPrivSharedToOwned gives the shared contact a
    // neighbour the owned-view member cannot open.
    const TMP_MID = `${P}rel_tmp_mid`;
    const TMP_IN = `${P}rel_tmp_in`;
    const TMP_MID_NOTE = 'tcv-temp-relationship-note-a83e10';
    const TMP_IN_NOTE = 'tcv-temp-relationship-note-5bd7c2';
    await db.contactRelationship.create({ data: { id: TMP_MID, businessId: ID.bizA, fromContactId: ID.cPrivOwner, toContactId: ID.cTeamUnowned, type: 'colleague_of', note: TMP_MID_NOTE } });
    await db.contactRelationship.create({ data: { id: TMP_IN, businessId: ID.bizA, fromContactId: ID.cTeamUnowned, toContactId: ID.cPrivSharedToOwned, type: 'colleague_of', note: TMP_IN_NOTE } });
    try {
      const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();
      // View-all STAFF and ADMIN open cTeamOwner and cTeamUnowned, but not the
      // owner's PRIVATE cPrivOwner nor cPrivSharedToOwned (shared with someone else).
      for (const actor of [ID.staffAll, ID.admin]) {
        for (const hidden of [ID.cPrivOwner, ID.cPrivSharedToOwned]) {
          expect(await detailOpens(actor, hidden), `${actor} detail ${hidden}`).toBe(false);
        }
        const rel = await sibling(actor, ID.cTeamOwner, 'relationships');
        const net = await sibling(actor, ID.cTeamOwner, 'network');
        const relUnowned = await sibling(actor, ID.cTeamUnowned, 'relationships');
        const netUnowned = await sibling(actor, ID.cTeamUnowned, 'network');
        for (const res of [rel, net, relUnowned, netUnowned]) expect(res.status, actor).toBe(200);
        expect(rel.body, actor).toEqual({ outgoing: [], incoming: [] });
        expect(relUnowned.body, actor).toEqual({ outgoing: [], incoming: [] });
        // cTeamUnowned opens for them but is reached from cTeamOwner only through cPrivOwner.
        expect(net.body.rootId, actor).toBe(ID.cTeamOwner);
        expect(ids(net.body.nodes), actor).toEqual([ID.cTeamOwner]);
        expect(net.body.edges, actor).toEqual([]);
        // cTeamOwner opens for them but is reached from cTeamUnowned only through cPrivOwner.
        expect(ids(netUnowned.body.nodes), actor).toEqual([ID.cTeamUnowned]);
        expect(netUnowned.body.edges, actor).toEqual([]);
        for (const res of [rel, net, relUnowned, netUnowned]) {
          for (const marker of [ID.cPrivOwner, ID.cPrivSharedToOwned, SENSITIVE_REL_NOTE, TMP_MID_NOTE, TMP_IN_NOTE]) {
            expect(res.text, `${actor}: ${marker}`).not.toContain(marker);
          }
          await expectNamesOnlyOpenable(actor, res.req.path, res.text);
        }
      }

      // The owned-view member opens the PRIVATE contact shared with them and their
      // own cPrivStaffOwned, but not the unowned TEAM cTeamUnowned.
      expect(await detailOpens(ID.staffOwned, ID.cTeamUnowned)).toBe(false);
      const relShared = await sibling(ID.staffOwned, ID.cPrivSharedToOwned, 'relationships');
      const netShared = await sibling(ID.staffOwned, ID.cPrivSharedToOwned, 'network');
      expect(relShared.status).toBe(200);
      expect(relShared.body.outgoing.map((r: any) => r.toContactId)).toEqual([ID.cPrivStaffOwned]);
      expect(relShared.body.incoming).toEqual([]);
      expect(relShared.text).toContain(SHARED_REL_NOTE);
      expect(netShared.status).toBe(200);
      expect(ids(netShared.body.nodes)).toEqual([ID.cPrivSharedToOwned, ID.cPrivStaffOwned].sort());
      expect(netShared.body.edges.map((e: any) => e.id)).toEqual([SIB.sharedRel]);
      for (const res of [relShared, netShared]) {
        for (const marker of [ID.cTeamUnowned, ID.cPrivOwner, ID.cTeamOwner, SENSITIVE_REL_NOTE, TMP_MID_NOTE, TMP_IN_NOTE]) {
          expect(res.text, `staffOwned: ${marker}`).not.toContain(marker);
        }
        await expectNamesOnlyOpenable(ID.staffOwned, res.req.path, res.text);
      }

      // The owner opens every contact: nothing is dropped.
      const ownerRel = await sibling(ID.owner, ID.cTeamOwner, 'relationships');
      expect(ownerRel.body.incoming.map((r: any) => r.fromContactId)).toEqual([ID.cPrivOwner]);
      expect(ownerRel.text).toContain(SENSITIVE_REL_NOTE);
      const ownerNet = await sibling(ID.owner, ID.cTeamOwner, 'network');
      expect(ids(ownerNet.body.nodes)).toEqual([ID.cTeamOwner, ID.cPrivOwner, ID.cTeamUnowned].sort());
      expect(ownerNet.body.edges.map((e: any) => e.id).sort()).toEqual([SIB.rel, TMP_MID].sort());
      expect(ownerNet.text).toContain(SENSITIVE_REL_NOTE);
      expect(ownerNet.text).toContain(TMP_MID_NOTE);
    } finally {
      await db.contactRelationship.deleteMany({ where: { id: { in: [TMP_MID, TMP_IN] } } });
    }
  });

  it('NEGATIVE CONTROL (review ST-3): the business network shows a member only contacts GET detail opens for them, with no edge or note naming one it hides and no contact shown only for such an edge; the owner sees every edge', async () => {
    const graph = (actor: string) =>
      request(siblingApp.getHttpServer()).get(`/crm/businesses/${ID.bizA}/network`).set('x-test-user', actor);
    const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

    // Owned-view STAFF: only the edge between the PRIVATE contact shared with
    // them and their own PRIVATE contact.
    const owned = await graph(ID.staffOwned);
    expect(owned.status).toBe(200);
    expect(owned.body.edges.map((e: any) => e.id)).toEqual([SIB.sharedRel]);
    expect(ids(owned.body.nodes)).toEqual([ID.cPrivSharedToOwned, ID.cPrivStaffOwned].sort());
    expect(owned.text).toContain(SHARED_REL_NOTE);
    for (const marker of [ID.cPrivOwner, ID.cTeamOwner, SENSITIVE_REL_NOTE]) expect(owned.text).not.toContain(marker);
    await expectNamesOnlyOpenable(ID.staffOwned, 'the business network', owned.text);

    // View-all STAFF and ADMIN: every edge has an end hidden from them, and
    // cTeamOwner (which opens for them) is related only to the hidden cPrivOwner.
    for (const actor of [ID.staffAll, ID.admin]) {
      expect(await detailOpens(actor, ID.cTeamOwner), actor).toBe(true);
      const res = await graph(actor);
      expect(res.status, actor).toBe(200);
      expect(res.body, actor).toEqual({ nodes: [], edges: [] });
    }

    // The owner: both edges, both notes, all four contacts.
    const owner = await graph(ID.owner);
    expect(owner.status).toBe(200);
    expect(owner.body.edges.map((e: any) => e.id).sort()).toEqual([SIB.rel, SIB.sharedRel].sort());
    expect(ids(owner.body.nodes)).toEqual([ID.cPrivOwner, ID.cTeamOwner, ID.cPrivSharedToOwned, ID.cPrivStaffOwned].sort());
    expect(owner.text).toContain(SENSITIVE_REL_NOTE);
    expect(owner.text).toContain(SHARED_REL_NOTE);
    await expectNamesOnlyOpenable(ID.owner, 'the business network', owner.text);
  });

  it("NEGATIVE CONTROL (review ST-2): POST relationships and POST refer refuse a contact the member cannot open at either end with GET detail's 404, byte-identical to an absent id, and write nothing; two contacts the member may open are still related (201)", async () => {
    const post = (path: string, body: Record<string, unknown>) =>
      request(siblingApp.getHttpServer())
        .post(`/crm/businesses/${ID.bizA}/contacts/${path}`)
        .set('x-test-user', SIB.staffWrite)
        .send(body);
    // staffWrite (crm 'write', view-all) opens the TEAM contacts but not staffAll's PRIVATE one.
    expect(await detailOpens(SIB.staffWrite, ID.cPrivStaffAll)).toBe(false);
    expect(await detailOpens(SIB.staffWrite, ID.cTeamUnowned)).toBe(true);
    expect(await detailOpens(SIB.staffWrite, ID.cTeamStaffAll)).toBe(true);
    const touchingHidden = () =>
      db.contactRelationship.count({ where: { OR: [{ fromContactId: ID.cPrivStaffAll }, { toContactId: ID.cPrivStaffAll }] } });
    const hiddenRow = () =>
      db.contact.findUnique({ where: { id: ID.cPrivStaffAll }, select: { updatedAt: true, leadScore: true, ownerId: true } });
    const hiddenBefore = await hiddenRow();
    const contactsBefore = await db.contact.count({ where: { businessId: ID.bizA } });
    const eventsBefore = await db.contactEvent.count({ where: { businessId: ID.bizA } });
    const edgesBefore = await db.contactRelationship.count({ where: { businessId: ID.bizA } });

    const cases: Array<{ label: string; refused: [string, Record<string, unknown>]; absent: [string, Record<string, unknown>] }> = [
      {
        label: 'relationships to a hidden contact',
        refused: [`${ID.cTeamUnowned}/relationships`, { toContactId: ID.cPrivStaffAll, type: 'colleague_of' }],
        absent: [`${ID.cTeamUnowned}/relationships`, { toContactId: ABSENT_ID, type: 'colleague_of' }],
      },
      {
        label: 'relationships from a hidden contact',
        refused: [`${ID.cPrivStaffAll}/relationships`, { toContactId: ID.cTeamUnowned, type: 'colleague_of' }],
        absent: [`${ABSENT_ID}/relationships`, { toContactId: ID.cTeamUnowned, type: 'colleague_of' }],
      },
      {
        label: 'refer a hidden contact',
        refused: [`${ID.cTeamUnowned}/refer`, { contactId: ID.cPrivStaffAll }],
        absent: [`${ID.cTeamUnowned}/refer`, { contactId: ABSENT_ID }],
      },
      {
        label: 'refer from a hidden contact (would copy its name into a new contact)',
        refused: [`${ID.cPrivStaffAll}/refer`, { firstName: `${P}refer_probe` }],
        absent: [`${ABSENT_ID}/refer`, { firstName: `${P}refer_probe` }],
      },
    ];
    for (const c of cases) {
      const refused = await post(...c.refused);
      const absent = await post(...c.absent);
      expect(refused.status, c.label).toBe(404);
      expect(JSON.parse(refused.text), c.label).toEqual(NOT_FOUND_BODY);
      expect(refused.text, `${c.label}: vs an absent id`).toBe(absent.text);
    }
    expect(await touchingHidden()).toBe(0);
    expect(await hiddenRow()).toEqual(hiddenBefore);
    expect(await db.contact.count({ where: { businessId: ID.bizA } })).toBe(contactsBefore);
    expect(await db.contactEvent.count({ where: { businessId: ID.bizA } })).toBe(eventsBefore);
    expect(await db.contactRelationship.count({ where: { businessId: ID.bizA } })).toBe(edgesBefore);

    // Positive control: two TEAM contacts the member opens are related, with the inverse edge.
    const pair = { OR: [
      { fromContactId: ID.cTeamUnowned, toContactId: ID.cTeamStaffAll },
      { fromContactId: ID.cTeamStaffAll, toContactId: ID.cTeamUnowned },
    ] };
    try {
      const ok = await post(`${ID.cTeamUnowned}/relationships`, { toContactId: ID.cTeamStaffAll, type: 'colleague_of' });
      expect(ok.status).toBe(201);
      expect(await db.contactRelationship.count({ where: pair })).toBe(2);
    } finally {
      await db.contactRelationship.deleteMany({ where: pair });
    }
  });
});
