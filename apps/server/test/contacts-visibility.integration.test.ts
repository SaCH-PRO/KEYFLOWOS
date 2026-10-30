/**
 * KF-PRODUCT-CONTACTS-PILOT-001 — contact DETAIL record-level visibility (REAL database).
 *
 * The contacts LIST AND's `visibilityClause(access, actorUserId)` onto its query
 * (crm.service.ts listContacts). The contact DETAIL route resolved the row by
 * `{ id, businessId, deletedAt: null }` alone (crm-stats.service.ts assertContact),
 * so a member whose list hid another person's PRIVATE record, or a "my book"
 * member whose list hid every record they do not own, could still fetch it — with
 * its notes, tasks, invoices and bookings — by copying or guessing the id. The
 * dossier route reused the same call. Cross-tenant access was never open: the
 * businessId predicate and BusinessGuard still applied. This is within-tenant.
 *
 * Nothing on the authorization boundary is mocked: real PrismaService over the
 * real PostgreSQL, real AuthGuard, real BusinessGuard, real ModuleScopeGuard and
 * the real CrmStatsService (resolveCrmAccess + visibilityClause). The request
 * identity is set by a test middleware from a test-only header, which is the
 * same place the production auth middleware puts it; the guards then run for
 * real. Only collaborators that never touch the boundary are stubbed: the
 * timeline service, the Redis-backed cache, the rate limiter (so that a test
 * cannot trip a 120/min window), and the controller's unrelated services.
 *
 * Conventions follow tenant-membership-boundary.integration.test.ts: DATABASE_URL
 * from the repo-root .env or the environment (CI), `ctv_`-prefixed synthetic
 * identities, raw-SQL cleanup by prefix in afterAll and before seeding.
 *
 * Expected on the unmodified detail route (negative control): the cases named
 * "fails closed" below return 200 with the record and its note body. After the
 * correction they return 404 with no record fields, identical to a nonexistent id.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { CrmController } from '../src/modules/crm/crm.controller';
import { CrmService } from '../src/modules/crm/crm.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { ModuleScopeGuard } from '../src/core/auth/module-scope.guard';
import { CrmRateLimitGuard } from '../src/modules/crm/guards/rate-limit.guard';
import { PlanLimitGuard } from '../src/modules/subscriptions/plan-limit.guard';
import { FeatureFlagGuard } from '../src/modules/crm/guards/feature-flag.guard';
import { TeamAuditInterceptor } from '../src/core/interceptors/team-audit.interceptor';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { CrmTimelineService } from '../src/modules/crm/crm-timeline.service';
import { CrmStatsService } from '../src/modules/crm/crm-stats.service';
import { CrmCacheService } from '../src/modules/crm/crm-cache.service';
import { CrmImportService } from '../src/modules/crm/crm-import.service';
import { CrmPlaybookService } from '../src/modules/crm/crm-playbook.service';
import { CrmFlowService } from '../src/modules/crm/crm-flow.service';
import { CrmActionsService } from '../src/modules/crm/crm-actions.service';
import { CrmRevenueService } from '../src/modules/crm/crm-revenue.service';
import { CrmJourneyService } from '../src/modules/crm/crm-journey.service';
import { CrmDuplicateDetectionService } from '../src/modules/crm/crm-duplicate-detection.service';
import { CrmDataQualityService } from '../src/modules/crm/crm-data-quality.service';
import { CrmSavedViewsService } from '../src/modules/crm/crm-saved-views.service';
import { CrmRelationshipHealthService } from '../src/modules/crm/crm-relationship-health.service';
import { CrmCommunicationService } from '../src/modules/crm/crm-communication.service';
import { BestChannelService } from '../src/modules/crm/best-channel.service';
import { ConversationAiService } from '../src/modules/crm/conversation-ai.service';
import { CrmNetworkService } from '../src/modules/crm/crm-network.service';
import { ContactInsightService } from '../src/modules/crm/contact-insight.service';
import { resolveCrmAccess, visibilityClause } from '../src/modules/crm/crm-permissions.helper';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'ctv_'; // unique prefix for every seeded row (safe cleanup)
const SENSITIVE_NOTE = `${P}SENSITIVE_NOTE_BODY_must_never_leak`;

const ID = {
  // users
  ownerA: `${P}ownerA`,
  adminA: `${P}adminA`,
  staffAll: `${P}staffAll`,     // STAFF, crm:read, crm_view default ('all')
  staffBook: `${P}staffBook`,   // STAFF, crm:read, crm_view:'owned'  ("my book")
  staffOther: `${P}staffOther`, // STAFF, crm:read; owns the TEAM and PRIVATE records
  readOnly: `${P}readOnly`,     // STAFF, crm:read, crm_edit:'none'
  noMember: `${P}noMember`,     // a user with no membership in business A
  superAdmin: `${P}superAdmin`, // role SUPER_ADMIN
  ownerB: `${P}ownerB`,
  // businesses
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  // contacts (all in bizA unless noted)
  cTeam: `${P}cTeam`,                   // owner staffOther, TEAM
  cPrivate: `${P}cPrivate`,             // owner staffOther, PRIVATE  (+ sensitive note)
  cPrivateShared: `${P}cPrivateShared`, // owner staffOther, PRIVATE, explicitly shared to staffBook
  cBook: `${P}cBook`,                   // owner staffBook, TEAM
  cDeleted: `${P}cDeleted`,             // owner staffOther, TEAM, soft-deleted
  cB: `${P}cB`,                         // bizB, owner ownerB, TEAM
  nope: `${P}does_not_exist`,
};

const USER_ROLE: Record<string, string> = { [ID.superAdmin]: 'SUPER_ADMIN' };

let db: any;
let app: INestApplication;
let prismaService: PrismaService;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension) by prefix.
  for (const sql of [
    `DELETE FROM contact_notes WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contact_shares WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contact_events WHERE business_id LIKE '${P}%'`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contacts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM memberships WHERE business_id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function get(asUser: string, url: string) {
  return request(app.getHttpServer()).get(url).set('x-ctv-user', asUser);
}

const detailUrl = (biz: string, contact: string) => `/crm/businesses/${biz}/contacts/${contact}`;
const dossierUrl = (biz: string, contact: string) => `/crm/businesses/${biz}/contacts/${contact}/dossier`;

/** The LIST predicate, evaluated on the real DB for one actor: the ids that listContacts would return. */
async function visibleIdsForList(actorUserId: string): Promise<Set<string>> {
  const access = await resolveCrmAccess(prismaService, ID.bizA, actorUserId);
  const vis = visibilityClause(access, actorUserId);
  const rows = await db.contact.findMany({
    where: { businessId: ID.bizA, deletedAt: null, ...(vis ? { AND: [vis] } : {}) },
    select: { id: true },
  });
  return new Set(rows.map((r: { id: string }) => r.id));
}

function expectNoRecordLeak(body: any) {
  expect(body?.contact).toBeUndefined();
  expect(body?.notes).toBeUndefined();
  expect(body?.tasks).toBeUndefined();
  expect(body?.meta).toBeUndefined();
  expect(JSON.stringify(body ?? {})).not.toContain(SENSITIVE_NOTE);
  expect(JSON.stringify(body ?? {})).not.toContain('PRIVATE');
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  await cleanup(); // in case a prior run aborted

  for (const [id, role] of [
    [ID.ownerA, 'USER'], [ID.adminA, 'USER'], [ID.staffAll, 'USER'], [ID.staffBook, 'USER'],
    [ID.staffOther, 'USER'], [ID.readOnly, 'USER'], [ID.noMember, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'], [ID.ownerB, 'USER'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@test.local`, role } });
  }

  await db.business.create({ data: { id: ID.bizA, name: 'CTV Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'CTV Biz B', ownerId: ID.ownerB } });

  const m = (userId: string, businessId: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}_${businessId.slice(P.length)}`, userId, businessId, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.ownerA, ID.bizA, 'OWNER');
  await m(ID.adminA, ID.bizA, 'ADMIN');
  await m(ID.staffAll, ID.bizA, 'STAFF', { crm: 'read' });
  await m(ID.staffBook, ID.bizA, 'STAFF', { crm: 'read', crm_view: 'owned' });
  await m(ID.staffOther, ID.bizA, 'STAFF', { crm: 'read' });
  await m(ID.readOnly, ID.bizA, 'STAFF', { crm: 'read', crm_edit: 'none', crm_view: 'all' });
  await m(ID.ownerB, ID.bizB, 'OWNER');

  const c = (id: string, businessId: string, ownerId: string, visibility: 'TEAM' | 'PRIVATE' | 'SHARED') =>
    db.contact.create({ data: { id, businessId, ownerId, visibility, firstName: 'CTV', lastName: id.slice(P.length) } });
  await c(ID.cTeam, ID.bizA, ID.staffOther, 'TEAM');
  await c(ID.cPrivate, ID.bizA, ID.staffOther, 'PRIVATE');
  await c(ID.cPrivateShared, ID.bizA, ID.staffOther, 'PRIVATE');
  await c(ID.cBook, ID.bizA, ID.staffBook, 'TEAM');
  await c(ID.cDeleted, ID.bizA, ID.staffOther, 'TEAM');
  await c(ID.cB, ID.bizB, ID.ownerB, 'TEAM');

  // Sensitive linked child row on the forbidden record.
  await db.contactNote.create({ data: { businessId: ID.bizA, contactId: ID.cPrivate, authorId: ID.staffOther, body: SENSITIVE_NOTE } });
  // Explicit share: staffBook may see cPrivateShared even though it is PRIVATE and not theirs.
  await db.contactShare.create({ data: { businessId: ID.bizA, contactId: ID.cPrivateShared, userId: ID.staffBook, createdBy: ID.staffOther } });
  // Soft-delete via raw SQL so the soft-delete extension cannot reinterpret it.
  await db.$executeRawUnsafe(`UPDATE contacts SET deleted_at = now() WHERE id = '${ID.cDeleted}'`);

  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController],
    providers: [
      // REAL on the boundary
      PrismaService,
      BusinessGuard,
      ModuleScopeGuard,
      AuthGuard,
      CrmStatsService,
      // Guards/interceptors that other routes declare; instantiated by Nest at init.
      FeatureFlagGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      // Stubs OFF the boundary
      { provide: CrmTimelineService, useValue: {} },
      { provide: CrmCacheService, useValue: { get: async () => null, set: async () => undefined, invalidate: async () => undefined } },
      { provide: SubscriptionsService, useValue: { checkLimit: vi.fn().mockResolvedValue({ allowed: true, current: 0, limit: 1000, upgradeTo: 'PRO' }) } },
      { provide: CrmService, useValue: {} },
      { provide: CrmImportService, useValue: {} },
      { provide: CrmPlaybookService, useValue: {} },
      { provide: CrmFlowService, useValue: {} },
      { provide: CrmActionsService, useValue: {} },
      { provide: CrmRevenueService, useValue: {} },
      {
        provide: CrmJourneyService,
        useValue: {
          getContactCrossJourney: vi.fn().mockResolvedValue({ summary: 'stub', timeline: [] }),
          generateAiInsight: vi.fn().mockResolvedValue(null),
          getContactHealthMetrics: vi.fn().mockResolvedValue({}),
        },
      },
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
  })
    .overrideGuard(CrmRateLimitGuard)
    .useValue({ canActivate: () => true })
    .compile();

  app = moduleRef.createNestApplication();
  // Request identity from a test-only header. The REAL AuthGuard, BusinessGuard and
  // ModuleScopeGuard then run against the REAL membership rows.
  app.use((req: any, _res: any, next: any) => {
    const id = req.headers['x-ctv-user'];
    if (typeof id === 'string' && id.startsWith(P)) {
      req.user = { id, role: USER_ROLE[id] ?? 'USER' };
    }
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prismaService = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('GET contact detail — permitted readers (positive controls)', () => {
  it('OWNER reads another member\'s PRIVATE record, including its note', async () => {
    const res = await get(ID.ownerA, detailUrl(ID.bizA, ID.cPrivate)).expect(200);
    expect(res.body.contact.id).toBe(ID.cPrivate);
    expect(res.body.notes.map((n: any) => n.body)).toContain(SENSITIVE_NOTE);
  });

  it('ADMIN reads another member\'s PRIVATE record', async () => {
    const res = await get(ID.adminA, detailUrl(ID.bizA, ID.cPrivate)).expect(200);
    expect(res.body.contact.id).toBe(ID.cPrivate);
  });

  it('SUPER_ADMIN reads another member\'s PRIVATE record', async () => {
    const res = await get(ID.superAdmin, detailUrl(ID.bizA, ID.cPrivate)).expect(200);
    expect(res.body.contact.id).toBe(ID.cPrivate);
  });

  it('STAFF view-all reads another member\'s TEAM record', async () => {
    const res = await get(ID.staffAll, detailUrl(ID.bizA, ID.cTeam)).expect(200);
    expect(res.body.contact.id).toBe(ID.cTeam);
    expect(res.body.contact.businessId).toBe(ID.bizA);
  });

  it('STAFF "my book" reads a record they own', async () => {
    const res = await get(ID.staffBook, detailUrl(ID.bizA, ID.cBook)).expect(200);
    expect(res.body.contact.id).toBe(ID.cBook);
  });

  it('STAFF "my book" reads a PRIVATE record explicitly shared with them', async () => {
    const res = await get(ID.staffBook, detailUrl(ID.bizA, ID.cPrivateShared)).expect(200);
    expect(res.body.contact.id).toBe(ID.cPrivateShared);
  });

  it('the owner of a PRIVATE record reads it', async () => {
    const res = await get(ID.staffOther, detailUrl(ID.bizA, ID.cPrivate)).expect(200);
    expect(res.body.contact.id).toBe(ID.cPrivate);
  });

  it('a read-only member (crm_edit none) still reads a TEAM record', async () => {
    const res = await get(ID.readOnly, detailUrl(ID.bizA, ID.cTeam)).expect(200);
    expect(res.body.contact.id).toBe(ID.cTeam);
  });
});

describe('GET contact detail — fails closed on records the LIST would hide (the defect)', () => {
  it('STAFF view-all is denied another member\'s PRIVATE record: 404, no record fields, no note body', async () => {
    const res = await get(ID.staffAll, detailUrl(ID.bizA, ID.cPrivate)).expect(404);
    expectNoRecordLeak(res.body);
    expect(await visibleIdsForList(ID.staffAll)).not.toContain(ID.cPrivate);
  });

  it('STAFF "my book" is denied another member\'s TEAM record', async () => {
    const res = await get(ID.staffBook, detailUrl(ID.bizA, ID.cTeam)).expect(404);
    expectNoRecordLeak(res.body);
    expect(await visibleIdsForList(ID.staffBook)).not.toContain(ID.cTeam);
  });

  it('STAFF "my book" is denied another member\'s unshared PRIVATE record', async () => {
    const res = await get(ID.staffBook, detailUrl(ID.bizA, ID.cPrivate)).expect(404);
    expectNoRecordLeak(res.body);
    expect(await visibleIdsForList(ID.staffBook)).not.toContain(ID.cPrivate);
  });

  it('a read-only member is denied another member\'s PRIVATE record', async () => {
    const res = await get(ID.readOnly, detailUrl(ID.bizA, ID.cPrivate)).expect(404);
    expectNoRecordLeak(res.body);
  });

  it('the dossier route is denied for the same record (it reuses contactDetail)', async () => {
    const res = await get(ID.staffBook, dossierUrl(ID.bizA, ID.cPrivate)).expect(404);
    expectNoRecordLeak(res.body);
  });

  it('a forbidden record and a nonexistent id are indistinguishable (no existence disclosure)', async () => {
    const forbidden = await get(ID.staffBook, detailUrl(ID.bizA, ID.cPrivate)).expect(404);
    const missing = await get(ID.staffBook, detailUrl(ID.bizA, ID.nope)).expect(404);
    expect(forbidden.body).toEqual(missing.body);
  });
});

describe('GET contact detail — boundaries that were already closed stay closed', () => {
  it('a user with no membership in the business is refused before any record lookup (403)', async () => {
    const res = await get(ID.noMember, detailUrl(ID.bizA, ID.cTeam)).expect(403);
    expectNoRecordLeak(res.body);
  });

  it('another tenant\'s OWNER is refused on business A\'s path (403)', async () => {
    const res = await get(ID.ownerB, detailUrl(ID.bizA, ID.cTeam)).expect(403);
    expectNoRecordLeak(res.body);
  });

  it('another tenant\'s OWNER cannot reach business A\'s record by id through business B\'s path (404)', async () => {
    const res = await get(ID.ownerB, detailUrl(ID.bizB, ID.cTeam)).expect(404);
    expectNoRecordLeak(res.body);
  });

  it('an unauthenticated request is refused (401)', async () => {
    await request(app.getHttpServer()).get(detailUrl(ID.bizA, ID.cTeam)).expect(401);
  });

  it('a soft-deleted record is not served, even to the OWNER (404)', async () => {
    const res = await get(ID.ownerA, detailUrl(ID.bizA, ID.cDeleted)).expect(404);
    expectNoRecordLeak(res.body);
  });
});

describe('LIST predicate and DETAIL outcome agree for every actor and record (consistency)', () => {
  const liveContacts = () => [ID.cTeam, ID.cPrivate, ID.cPrivateShared, ID.cBook];
  for (const actor of [ID.ownerA, ID.adminA, ID.staffAll, ID.staffBook, ID.staffOther, ID.readOnly]) {
    it(`${actor.slice(P.length)}: detail is 200 exactly for the ids the list predicate returns`, async () => {
      const visible = await visibleIdsForList(actor);
      for (const contactId of liveContacts()) {
        const res = await get(actor, detailUrl(ID.bizA, contactId));
        const expected = visible.has(contactId) ? 200 : 404;
        expect({ contactId, status: res.status }).toEqual({ contactId, status: expected });
      }
      expect(visible.has(ID.cDeleted)).toBe(false);
      expect(visible.has(ID.cB)).toBe(false);
    });
  }
});
