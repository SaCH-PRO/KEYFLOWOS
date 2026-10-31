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
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

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
    `DELETE FROM contact_shares WHERE contact_id LIKE '${P}%'`,
    `DELETE FROM contact_notes WHERE contact_id LIKE '${P}%'`,
    `DELETE FROM contact_events WHERE contact_id LIKE '${P}%'`,
    `DELETE FROM contact_tasks WHERE contact_id LIKE '${P}%'`,
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
