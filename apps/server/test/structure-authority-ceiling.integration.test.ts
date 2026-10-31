/**
 * V1-21-AUTH-JOBROLE-CEILING — JobRole permissions are vocabulary-validated and
 * capped by their author, and an assignment's permission sync cannot raise a
 * membership above the assigner's own authority (CF-27; identity-boundary
 * CR-1). REAL database.
 *
 * RED-BEFORE (the V1-07 head, 2fe40de6): the structure routes are gated on
 * team:write only, and StructureService wrote what it was given:
 *   - POST .../job-roles stored any permissions map and any tier: a default
 *     ADMIN (team:write, tier 3) authored { team: 'admin' } at tier 4 (201);
 *   - POST/PATCH .../assignments copied the named JobRole's permissions and
 *     defaultApprovalTier onto the membership (structure.service.ts
 *     createAssignment / updateAssignment), the caller's own included, so the
 *     same ADMIN raised itself to team:admin at tier 4 — past the team:admin
 *     gate of the identity role and permissions routes (CR-1);
 *   - ending or deleting an assignment left the copy in place, an explicit
 *     scope map no position backs (the authority inventory's
 *     copy_from_deleted_or_ended_position).
 *
 * REQUIRED (GREEN-AFTER): above the caller's own authority the write is
 * refused with 403 and nothing changes; a key or level outside the canonical
 * vocabulary is 400; a self-assignment never exceeds the caller's own ceiling;
 * ending or deleting a position recomputes the copy from the member's
 * remaining active positions (role defaults when none remain), bounded the same
 * way; a cross-tenant membershipId is 404; the inventory's stale-copy count
 * for these tenants does not grow. The OWNER and a SUPER_ADMIN are not bounded
 * (the identity routes' K2 rule).
 *
 * HOW THE APP IS COMPOSED (the contacts-visibility model): a real Nest app with
 * the real StructureController, StructureService, PrismaService, AuthGuard,
 * BusinessGuard and ModuleScopeGuard against the database at DATABASE_URL. The
 * one stand-in is identity attachment: a test middleware reads `x-test-user`,
 * loads that seeded User row and attaches `{ id, email, role }` exactly as
 * AuthMiddleware does after token verification. The production global
 * ValidationPipe needs tsc-emitted parameter types, which vitest's esbuild
 * transform does not emit, so the 400 cases here prove the SERVICE refuses the
 * payload; the DTO decorators are the outer layer in the built server.
 *
 * FIXTURES: every row has the `v21a_` prefix (registered in
 * test/helpers/fixture-prefixes.json) and is hard-deleted with
 * LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No $transaction wrapping.
 * The cases run in file order and later cases build on earlier ones (noted
 * where they do).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v21a_';
const ID = {
  owner: `${P}owner`,         // OWNER of bizA (ownerId + OWNER membership)
  admin: `${P}admin`,         // ADMIN of bizA, role defaults (team: write, tier 3) — the CR-1 actor
  adminSelf: `${P}adminSelf`, // ADMIN of bizA, role defaults — self-assignment cases (its map changes)
  adminR: `${P}adminR`,       // ADMIN of bizA restricted by the OWNER: { crm: read, team: write }, tier 0
  adminE: `${P}adminE`,       // ADMIN of bizA, role defaults; the OWNER gives it a restricted position (E04)
  staff: `${P}staff`,         // STAFF of bizA, role defaults — assignment target
  staffLow: `${P}staffLow`,   // STAFF of bizA, explicit { crm: read }, tier 0 — within adminR's authority
  staffE: `${P}staffE`,       // STAFF of bizA — one position, ended (E01)
  staffE2: `${P}staffE2`,     // STAFF of bizA — two positions, one ended (E02)
  staffDel: `${P}staffDel`,   // STAFF of bizA — one position, deleted (E03)
  ownerB: `${P}ownerB`,       // OWNER of bizB
  staffB: `${P}staffB`,       // STAFF of bizB — the cross-tenant target (A06)
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  unitA: `${P}unitA`,
  unitB: `${P}unitB`,
  // Job roles in bizA, seeded as rows (the OWNER authored them).
  roleHigh: `${P}role_high`,         // every canonical module admin, tier 4
  roleLow: `${P}role_low`,           // { crm: read }, tier 0
  roleTeamLow: `${P}role_teamlow`,   // { crm: read, team: write }, tier 0
  roleAdminish: `${P}role_adminish`, // { crm: admin, team: write }, tier 3 — within a default ADMIN
  roleOther: `${P}role_other`,       // { crm: write }, tier 1
  roleLegacy: `${P}role_legacy`,     // { finance: write, crm: read } — KEY tool-family keys, pre-validation row
  roleEdit: `${P}role_edit`,         // { crm: read }, tier 0 — the PATCH target (J05), assigned to nobody
};
const m = (who: string) => `${P}m_${who.slice(P.length)}`;
const USERS = [
  ID.owner, ID.admin, ID.adminSelf, ID.adminR, ID.adminE, ID.staff, ID.staffLow, ID.staffE, ID.staffE2, ID.staffDel,
  ID.ownerB, ID.staffB,
];
const emailOf = (id: string) => `${id}@v21a.test.local`;
const REFUSED_GRANT = 'You cannot grant more authority than your own';
const REFUSED_TARGET = 'You cannot change a member whose authority exceeds your own';
const REFUSED_ROLE = 'You cannot change a job role whose authority exceeds your own';
/** Inventory classes that are not a stale copy. */
const NOT_STALE = new Set(['copy_matches_live_jobrole', 'no_copied_authority']);

let db: any;
let app: any;
let ROLE_DEFAULT_SCOPES: Record<string, Record<string, string>>;
let inventory: any;
let staleBaseline = -1;

async function cleanup() {
  for (const sql of [
    `DELETE FROM org_assignments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM job_roles WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_units WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
}

/** A row exactly as Postgres stores it, so "unchanged" means byte-identical. */
async function rowText(table: 'memberships' | 'job_roles' | 'org_assignments', id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe(`SELECT row_to_json(t)::text AS j FROM ${table} t WHERE t.id = $1`, id);
  expect(rows.length, `${table} ${id} exists`).toBe(1);
  return rows[0].j as string;
}

function call(actor: string, method: 'get' | 'post' | 'patch' | 'delete', route: string, body?: unknown) {
  let req = request(app.getHttpServer())[method](`/structure/businesses/${route}`).set('x-test-user', actor);
  if (body !== undefined) req = req.send(body as object);
  return req;
}
const jobRoles = (biz = ID.bizA) => `${biz}/job-roles`;
const jobRole = (id: string, biz = ID.bizA) => `${biz}/job-roles/${id}`;
const assignments = (biz = ID.bizA) => `${biz}/assignments`;
const assignment = (id: string, biz = ID.bizA) => `${biz}/assignments/${id}`;

/** POST an assignment of `role` onto `who`'s bizA membership. */
function assign(actor: string, who: string, role: string, extra: Record<string, unknown> = {}) {
  return call(actor, 'post', assignments(), { membershipId: m(who), userId: who, orgUnitId: ID.unitA, jobRoleId: role, ...extra });
}

async function membership(who: string) {
  return db.membership.findUnique({ where: { id: m(who) } });
}

/** Stale-copy findings (any class but a live match or no copy) for this suite's tenants. */
async function staleCount(): Promise<number> {
  const findings = await inventory.classifyStaleCopies();
  return findings.filter((f: any) => (f.businessId === ID.bizA || f.businessId === ID.bizB) && !NOT_STALE.has(f.classification)).length;
}

async function classificationOf(who: string): Promise<string | undefined> {
  const findings = await inventory.classifyStaleCopies();
  return findings.find((f: any) => f.membershipId === m(who))?.classification;
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { StructureController } = await import('../src/modules/structure/structure.controller');
  const { StructureService } = await import('../src/modules/structure/structure.service');
  const { AuthorityInventoryService } = await import('../src/core/authority/authority-inventory.service');
  ({ ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary'));

  const moduleRef = await Test.createTestingModule({
    controllers: [StructureController],
    providers: [
      PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
      // StructureService takes PrismaService by its parameter type, which only
      // tsc-emitted metadata names; the real service is built over the real one.
      { provide: StructureService, useFactory: (prisma: unknown) => new StructureService(prisma as never), inject: [PrismaService] },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, as AuthMiddleware attaches it from the User row.
  // No guard is overridden.
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
  inventory = new AuthorityInventoryService(db);

  await cleanup(); // in case a prior run aborted

  for (const id of USERS) {
    await db.user.create({ data: { id, email: emailOf(id), name: id, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: `${P}bizA-name`, ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: `${P}bizB-name`, ownerId: ID.ownerB } });
  const rows: Array<{ who: string; businessId: string; role: string; permissionScopes?: Record<string, string>; maxApprovalTier?: number }> = [
    { who: ID.owner, businessId: ID.bizA, role: 'OWNER' },
    { who: ID.admin, businessId: ID.bizA, role: 'ADMIN' },
    { who: ID.adminSelf, businessId: ID.bizA, role: 'ADMIN' },
    { who: ID.adminR, businessId: ID.bizA, role: 'ADMIN', permissionScopes: { crm: 'read', team: 'write' }, maxApprovalTier: 0 },
    { who: ID.adminE, businessId: ID.bizA, role: 'ADMIN' },
    { who: ID.staff, businessId: ID.bizA, role: 'STAFF' },
    { who: ID.staffLow, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'read' }, maxApprovalTier: 0 },
    { who: ID.staffE, businessId: ID.bizA, role: 'STAFF' },
    { who: ID.staffE2, businessId: ID.bizA, role: 'STAFF' },
    { who: ID.staffDel, businessId: ID.bizA, role: 'STAFF' },
    { who: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    { who: ID.staffB, businessId: ID.bizB, role: 'STAFF' },
  ];
  for (const r of rows) {
    await db.membership.create({
      data: {
        id: m(r.who), userId: r.who, businessId: r.businessId, role: r.role,
        ...(r.permissionScopes ? { permissionScopes: r.permissionScopes } : {}),
        ...(r.maxApprovalTier !== undefined ? { maxApprovalTier: r.maxApprovalTier } : {}),
      },
    });
  }
  await db.orgUnit.create({ data: { id: ID.unitA, businessId: ID.bizA, name: `${P}unitA` } });
  await db.orgUnit.create({ data: { id: ID.unitB, businessId: ID.bizB, name: `${P}unitB` } });
  const roles: Array<[string, Record<string, string>, number]> = [
    [ID.roleHigh, { ...ROLE_DEFAULT_SCOPES.OWNER }, 4],
    [ID.roleLow, { crm: 'read' }, 0],
    [ID.roleTeamLow, { crm: 'read', team: 'write' }, 0],
    [ID.roleAdminish, { crm: 'admin', team: 'write' }, 3],
    [ID.roleOther, { crm: 'write' }, 1],
    [ID.roleLegacy, { finance: 'write', crm: 'read' }, 0],
    [ID.roleEdit, { crm: 'read' }, 0],
  ];
  for (const [id, permissions, tier] of roles) {
    await db.jobRole.create({ data: { id, businessId: ID.bizA, name: id, permissions, defaultApprovalTier: tier } });
  }
  staleBaseline = await staleCount();
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('V1-21 fixture sanity (real rows)', () => {
  it('[V21-X01] two tenants, twelve users, twelve memberships, seven job roles, no assignments; the restricted fixtures are stale-copy findings already', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(2);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(12);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(12);
    expect(await db.jobRole.count({ where: { businessId: ID.bizA } })).toBe(7);
    expect(await db.orgAssignment.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } })).toBe(0);
    // adminR and staffLow carry an explicit map with no position behind it.
    expect(staleBaseline).toBe(2);
    // The default ADMIN passes the structure routes' team:write gate (the route is reachable).
    const list = await call(ID.admin, 'get', jobRoles());
    expect(list.status, JSON.stringify(list.body)).toBe(200);
  });
});

describe('V1-21 JobRole authoring is capped by the author (POST/PATCH .../job-roles)', () => {
  it('[V21-J01] RED-BEFORE: a default ADMIN (team:write, tier 3) authors { team: admin } at tier 4 -> 403, no job role is created', async () => {
    const name = `${P}j01_escalate`;
    const res = await call(ID.admin, 'post', jobRoles(), { name, permissions: { team: 'admin' }, defaultApprovalTier: 4 });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain(REFUSED_GRANT);
    expect(await db.jobRole.count({ where: { businessId: ID.bizA, name } })).toBe(0);
  });

  it('[V21-J02] each dimension alone is refused: a module level, the tier, a CRM sub-permission above the author', async () => {
    const name = `${P}j02_refused`;
    const cases: Array<[string, Record<string, unknown>]> = [
      [ID.admin, { permissions: { team: 'admin' }, defaultApprovalTier: 0 }],   // team above write
      [ID.admin, { permissions: { crm: 'read' }, defaultApprovalTier: 4 }],     // tier above 3
      [ID.adminR, { permissions: { revenue: 'read' }, defaultApprovalTier: 0 }], // revenue above none
      [ID.adminR, { permissions: { crm: 'write' }, defaultApprovalTier: 0 }],   // crm above read
      [ID.adminR, { permissions: { crm: 'read' }, defaultApprovalTier: 1 }],    // tier above 0
      [ID.adminR, { permissions: { crm: 'read', crm_reassign: 'true' }, defaultApprovalTier: 0 }], // reassign, which crm:read lacks
    ];
    for (const [actor, body] of cases) {
      const res = await call(actor, 'post', jobRoles(), { name, ...body });
      expect(res.status, `${actor} ${JSON.stringify(body)} -> ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toContain(REFUSED_GRANT);
    }
    expect(await db.jobRole.count({ where: { businessId: ID.bizA, name } })).toBe(0);
  });

  it('[V21-J03] RED-BEFORE: a key or level outside the canonical vocabulary, or a tier outside 0..4, is 400 for every author, the OWNER included', async () => {
    const name = `${P}j03_invalid`;
    const payloads: Array<Record<string, unknown>> = [
      { permissions: { finance: 'write' } },          // a KEY tool-family key, not a module
      { permissions: { crm: 'owner' } },              // not a level
      { permissions: { crm: 'read', crm_view: 'everything' } }, // not a crm_view value
      { permissions: { crm: 2 } },                    // not a string
      { permissions: ['crm'] },                       // not a map
      { permissions: 'admin' },                       // not a map
      { permissions: { crm: 'read' }, defaultApprovalTier: 5 },
      { permissions: { crm: 'read' }, defaultApprovalTier: -1 },
      { permissions: { crm: 'read' }, defaultApprovalTier: 2.5 },
    ];
    for (const actor of [ID.owner, ID.admin]) {
      for (const body of payloads) {
        const res = await call(actor, 'post', jobRoles(), { name, ...body });
        expect(res.status, `${actor} ${JSON.stringify(body)} -> ${JSON.stringify(res.body)}`).toBe(400);
      }
    }
    expect(await db.jobRole.count({ where: { businessId: ID.bizA, name } })).toBe(0);
  });

  it('[V21-J04] positive controls: the ADMIN authors within its own authority, the OWNER authors at tier 4 (201, stored as asked)', async () => {
    const within = await call(ID.admin, 'post', jobRoles(), {
      name: `${P}j04_within`, permissions: { crm: 'admin', team: 'write', crm_view: 'all' }, defaultApprovalTier: 3,
    });
    expect(within.status, JSON.stringify(within.body)).toBe(201);
    expect(within.body).toMatchObject({ permissions: { crm: 'admin', team: 'write', crm_view: 'all' }, defaultApprovalTier: 3 });
    const top = await call(ID.owner, 'post', jobRoles(), {
      name: `${P}j04_owner`, permissions: { ...ROLE_DEFAULT_SCOPES.OWNER }, defaultApprovalTier: 4,
    });
    expect(top.status, JSON.stringify(top.body)).toBe(201);
    expect(top.body).toMatchObject({ permissions: ROLE_DEFAULT_SCOPES.OWNER, defaultApprovalTier: 4 });
  });

  it('[V21-J05] PATCH: raising a role above the editor is 403, editing a role above the editor is 403, a bad key is 400 — each row byte-identical; a within-authority or cosmetic edit is 200', async () => {
    const editBefore = await rowText('job_roles', ID.roleEdit);
    for (const body of [{ permissions: { team: 'admin' } }, { defaultApprovalTier: 4 }]) {
      const res = await call(ID.admin, 'patch', jobRole(ID.roleEdit), body);
      expect(res.status, `${JSON.stringify(body)} -> ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toContain(REFUSED_GRANT);
    }
    const bad = await call(ID.admin, 'patch', jobRole(ID.roleEdit), { permissions: { finance: 'write' } });
    expect(bad.status, JSON.stringify(bad.body)).toBe(400);
    expect(await rowText('job_roles', ID.roleEdit)).toBe(editBefore);

    // roleHigh is above a default ADMIN: lowering it is a rewrite of authority the ADMIN does not hold.
    const highBefore = await rowText('job_roles', ID.roleHigh);
    const lower = await call(ID.admin, 'patch', jobRole(ID.roleHigh), { defaultApprovalTier: 0 });
    expect(lower.status, JSON.stringify(lower.body)).toBe(403);
    expect(JSON.stringify(lower.body)).toContain(REFUSED_ROLE);
    expect(await rowText('job_roles', ID.roleHigh)).toBe(highBefore);

    // A cosmetic edit grants nothing and is not bounded.
    const color = await call(ID.admin, 'patch', jobRole(ID.roleHigh), { color: '#123456' });
    expect(color.status, JSON.stringify(color.body)).toBe(200);
    expect((await db.jobRole.findUnique({ where: { id: ID.roleHigh } })).color).toBe('#123456');

    const created = await db.jobRole.findFirst({ where: { businessId: ID.bizA, name: `${P}j04_within` } });
    const within = await call(ID.admin, 'patch', jobRole(created.id), { permissions: { crm: 'write' }, defaultApprovalTier: 2 });
    expect(within.status, JSON.stringify(within.body)).toBe(200);
    expect(within.body).toMatchObject({ permissions: { crm: 'write' }, defaultApprovalTier: 2 });
  });
});

describe('V1-21 an assignment cannot sync a JobRole above the assigner (POST/PATCH .../assignments)', () => {
  it('[V21-A01] RED-BEFORE (CR-1): a default ADMIN self-assigns the OWNER-authored tier-4 role -> 403, its membership byte-identical, no assignment row', async () => {
    const before = await rowText('memberships', m(ID.adminSelf));
    const res = await assign(ID.adminSelf, ID.adminSelf, ID.roleHigh);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain(REFUSED_GRANT);
    expect(await rowText('memberships', m(ID.adminSelf))).toBe(before);
    expect(await db.orgAssignment.count({ where: { membershipId: m(ID.adminSelf) } })).toBe(0);
  });

  it('[V21-A02] RED-BEFORE: the same ADMIN assigns the tier-4 role to a STAFF member -> 403, the STAFF membership byte-identical', async () => {
    const before = await rowText('memberships', m(ID.staff));
    const res = await assign(ID.admin, ID.staff, ID.roleHigh);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain(REFUSED_GRANT);
    expect(await rowText('memberships', m(ID.staff))).toBe(before);
    expect(await db.orgAssignment.count({ where: { membershipId: m(ID.staff) } })).toBe(0);
  });

  it('[V21-A03] a self-assignment within the ceiling is 201 and leaves the ADMIN at or below what it held; the tier-4 role is still refused afterwards', async () => {
    const res = await assign(ID.adminSelf, ID.adminSelf, ID.roleAdminish);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await membership(ID.adminSelf);
    expect(row.permissionScopes).toEqual({ crm: 'admin', team: 'write' });
    expect(row.maxApprovalTier).toBe(3);
    expect(row.role).toBe('ADMIN');

    const before = await rowText('memberships', m(ID.adminSelf));
    const again = await assign(ID.adminSelf, ID.adminSelf, ID.roleHigh, { isPrimary: false });
    expect(again.status, JSON.stringify(again.body)).toBe(403);
    expect(await rowText('memberships', m(ID.adminSelf))).toBe(before);
  });

  it('[V21-A04] a restricted ADMIN ({ crm: read, team: write }, tier 0) cannot rewrite a member above itself (STAFF defaults) -> 403, unchanged', async () => {
    const before = await rowText('memberships', m(ID.staff));
    const res = await assign(ID.adminR, ID.staff, ID.roleLow);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain(REFUSED_TARGET);
    expect(await rowText('memberships', m(ID.staff))).toBe(before);
  });

  it('[V21-A05] positive control: the restricted ADMIN assigns { crm: read }, tier 0 to a member within its authority -> 201, copied as asked', async () => {
    const res = await assign(ID.adminR, ID.staffLow, ID.roleLow);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await membership(ID.staffLow);
    expect(row.permissionScopes).toEqual({ crm: 'read' });
    expect(row.maxApprovalTier).toBe(0);
  });

  it('[V21-A06] a membershipId from another tenant is 404 (ownership before the ceiling, even with the tier-4 role) and that membership is byte-identical', async () => {
    const before = await rowText('memberships', m(ID.staffB));
    for (const role of [ID.roleLow, ID.roleHigh]) {
      const res = await call(ID.admin, 'post', assignments(), {
        membershipId: m(ID.staffB), userId: ID.staffB, orgUnitId: ID.unitA, jobRoleId: role,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(JSON.stringify(res.body)).toContain('Membership not found');
    }
    expect(await rowText('memberships', m(ID.staffB))).toBe(before);
    expect(await db.orgAssignment.count({ where: { membershipId: m(ID.staffB) } })).toBe(0);
  });

  it('[V21-A07] a stored job role outside the vocabulary (KEY tool-family keys) is not copied onto a membership: 400 for the OWNER too, nothing created', async () => {
    const before = await rowText('memberships', m(ID.staff));
    const res = await assign(ID.owner, ID.staff, ID.roleLegacy);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(await rowText('memberships', m(ID.staff))).toBe(before);
    expect(await db.orgAssignment.count({ where: { membershipId: m(ID.staff) } })).toBe(0);
  });

  it('[V21-A08] positive control: the OWNER assigns the tier-4 role (201, copied); a default ADMIN then cannot rewrite that member (403 on PATCH)', async () => {
    const res = await assign(ID.owner, ID.staff, ID.roleHigh);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await membership(ID.staff);
    expect(row.permissionScopes).toEqual(ROLE_DEFAULT_SCOPES.OWNER);
    expect(row.maxApprovalTier).toBe(4);

    const before = await rowText('memberships', m(ID.staff));
    const lower = await call(ID.admin, 'patch', assignment(res.body.id), { jobRoleId: ID.roleLow });
    expect(lower.status, JSON.stringify(lower.body)).toBe(403);
    expect(JSON.stringify(lower.body)).toContain(REFUSED_TARGET);
    expect(await rowText('memberships', m(ID.staff))).toBe(before);
    expect((await db.orgAssignment.findUnique({ where: { id: res.body.id } })).jobRoleId).toBe(ID.roleHigh);
  });

  it('[V21-A09] RED-BEFORE: PATCH an existing assignment (A05) to the tier-4 role -> 403, membership and assignment byte-identical', async () => {
    const a = await db.orgAssignment.findFirst({ where: { membershipId: m(ID.staffLow) } });
    const memberBefore = await rowText('memberships', m(ID.staffLow));
    const assignmentBefore = await rowText('org_assignments', a.id);
    const res = await call(ID.admin, 'patch', assignment(a.id), { jobRoleId: ID.roleHigh });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain(REFUSED_GRANT);
    expect(await rowText('memberships', m(ID.staffLow))).toBe(memberBefore);
    expect(await rowText('org_assignments', a.id)).toBe(assignmentBefore);
  });
});

describe('V1-21 ending or deleting a position recomputes the copied scopes', () => {
  it('[V21-E01] RED-BEFORE: ending a STAFF member\'s only position returns it to role defaults (no copied map), not the stale copy', async () => {
    const res = await assign(ID.owner, ID.staffE, ID.roleLow);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await membership(ID.staffE)).permissionScopes).toEqual({ crm: 'read' });

    const end = await call(ID.admin, 'patch', assignment(res.body.id), { endedAt: new Date().toISOString() });
    expect(end.status, JSON.stringify(end.body)).toBe(200);
    expect(end.body.endedAt).toBeTruthy();
    const row = await membership(ID.staffE);
    expect(row.permissionScopes).toBeNull();
    expect(row.maxApprovalTier).toBe(0);
    expect(await classificationOf(ID.staffE)).toBe('no_copied_authority');
  });

  it('[V21-E02] RED-BEFORE: ending one of two positions re-copies the remaining active one', async () => {
    const primary = await assign(ID.owner, ID.staffE2, ID.roleOther, { isPrimary: true });
    expect(primary.status, JSON.stringify(primary.body)).toBe(201);
    const second = await assign(ID.owner, ID.staffE2, ID.roleLow, { isPrimary: false });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect((await membership(ID.staffE2)).permissionScopes).toEqual({ crm: 'read' }); // the last sync wins

    const end = await call(ID.admin, 'patch', assignment(second.body.id), { endedAt: new Date().toISOString() });
    expect(end.status, JSON.stringify(end.body)).toBe(200);
    const row = await membership(ID.staffE2);
    expect(row.permissionScopes).toEqual({ crm: 'write' });
    expect(row.maxApprovalTier).toBe(1);
    expect(await classificationOf(ID.staffE2)).toBe('copy_matches_live_jobrole');
  });

  it('[V21-E03] RED-BEFORE: deleting a position recomputes as ending does', async () => {
    const res = await assign(ID.owner, ID.staffDel, ID.roleLow);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const del = await call(ID.admin, 'delete', assignment(res.body.id));
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    const row = await membership(ID.staffDel);
    expect(row.permissionScopes).toBeNull();
    expect(row.maxApprovalTier).toBe(0);
    expect(await db.orgAssignment.count({ where: { membershipId: m(ID.staffDel) } })).toBe(0);
  });

  it('[V21-E04] a restricted member cannot lift its own restriction by ending or deleting its position (403, nothing changes); the OWNER can (200, role defaults)', async () => {
    const res = await assign(ID.owner, ID.adminE, ID.roleTeamLow);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await membership(ID.adminE)).permissionScopes).toEqual({ crm: 'read', team: 'write' });

    const memberBefore = await rowText('memberships', m(ID.adminE));
    const assignmentBefore = await rowText('org_assignments', res.body.id);
    const end = await call(ID.adminE, 'patch', assignment(res.body.id), { endedAt: new Date().toISOString() });
    expect(end.status, JSON.stringify(end.body)).toBe(403);
    expect(JSON.stringify(end.body)).toContain(REFUSED_GRANT);
    const del = await call(ID.adminE, 'delete', assignment(res.body.id));
    expect(del.status, JSON.stringify(del.body)).toBe(403);
    expect(await rowText('memberships', m(ID.adminE))).toBe(memberBefore);
    expect(await rowText('org_assignments', res.body.id)).toBe(assignmentBefore);

    const ownerEnd = await call(ID.owner, 'patch', assignment(res.body.id), { endedAt: new Date().toISOString() });
    expect(ownerEnd.status, JSON.stringify(ownerEnd.body)).toBe(200);
    const row = await membership(ID.adminE);
    expect(row.permissionScopes).toBeNull();
    expect(row.maxApprovalTier).toBe(0); // with no map, the ADMIN role default tier (3) applies
  });

  it('[V21-E05] RED-BEFORE: the authority inventory\'s stale-copy count for these tenants did not grow over the suite', async () => {
    expect(staleBaseline).toBeGreaterThanOrEqual(0);
    expect(await staleCount()).toBeLessThanOrEqual(staleBaseline);
  });
});
