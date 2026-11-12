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
 * REVIEW REPAIRS (the V21-F*, E06 cases; each RED-BEFORE at the packet head
 * edd354e4, and A03/E01-E03 extended):
 *   - F1: a JobRole on a contact-only position is a grant too (reply approval
 *     reads jobRole.defaultApprovalTier, KEY's staff channel reads its
 *     permissions), so it is bounded on POST and PATCH;
 *   - F2: a position above the requester (its holder or its role) keeps its
 *     phone, email, channel, reply approval, role, end and row (403);
 *   - F3: rewriting a membership's copy needs team:admin as the identity routes'
 *     role and permissions changes do; a default ADMIN (team:write) is refused
 *     even within its ceiling, a team:admin ADMIN (adminT, adminTS) is bounded;
 *   - F4: deleting a JobRole is bounded as editing it is, and its holders'
 *     copies are recomputed; F5: each copy written logs 'permissions_updated';
 *   - CR-V21-03 (E06): ending a position recomputes only a copy that is still
 *     that position's.
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
  adminT: `${P}adminT`,       // ADMIN of bizA, ADMIN defaults with team: admin, tier 3 — bounded, may rewrite members (F3)
  adminTS: `${P}adminTS`,     // ADMIN of bizA, as adminT — the team:admin self-assignment (A03)
  staff: `${P}staff`,         // STAFF of bizA, role defaults — assignment target
  staffLow: `${P}staffLow`,   // STAFF of bizA, explicit { crm: read }, tier 0 — within adminR's authority
  staffE: `${P}staffE`,       // STAFF of bizA — one position, ended (E01)
  staffE2: `${P}staffE2`,     // STAFF of bizA — two positions, one ended (E02)
  staffDel: `${P}staffDel`,   // STAFF of bizA — one position, deleted (E03)
  staffJ: `${P}staffJ`,       // STAFF of bizA — holds a job role that is then deleted (F4)
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
  ID.owner, ID.admin, ID.adminSelf, ID.adminR, ID.adminE, ID.adminT, ID.adminTS, ID.staff, ID.staffLow, ID.staffE,
  ID.staffE2, ID.staffDel, ID.staffJ, ID.ownerB, ID.staffB,
];
const emailOf = (id: string) => `${id}@v21a.test.local`;
const REFUSED_GRANT = 'You cannot grant more authority than your own';
const REFUSED_TARGET = 'You cannot change a member whose authority exceeds your own';
const REFUSED_ROLE = 'You cannot change a job role whose authority exceeds your own';
const REFUSED_POSITION = 'You cannot change a position whose authority exceeds your own';
/** IdentityService.assertTeamAdmin's refusal, verbatim (review F3). */
const REFUSED_TEAM_ADMIN = 'Changing a role or permissions requires team admin access';
/** Contact phones for the contact-only cases (normalizePhone keeps digits and '+'). */
const phone = (n: number) => `+1555021${String(n).padStart(4, '0')}`;
/** Inventory classes that are not a stale copy. */
const NOT_STALE = new Set(['copy_matches_live_jobrole', 'no_copied_authority']);

let db: any;
let app: any;
let ROLE_DEFAULT_SCOPES: Record<string, Record<string, string>>;
let inventory: any;
let staleBaseline = -1;

async function cleanup() {
  for (const sql of [
    // writeCopy logs each membership rewrite (review F5).
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

/** The 'permissions_updated' rows written for `who`'s membership (review F5). */
async function permissionLogs(who: string, by?: string): Promise<any[]> {
  return db.teamActivityLog.findMany({
    where: { businessId: ID.bizA, module: 'team', action: 'permissions_updated', entityId: m(who), ...(by ? { userId: by } : {}) },
  });
}

/** A contact-only position body, named with the prefix. */
function contactOnly(name: string, phoneNumber: string, jobRoleId: string) {
  return { isContactOnly: true, contactName: `${P}${name}`, contactPhone: phoneNumber, orgUnitId: ID.unitA, jobRoleId, autoApprovalViaReply: true };
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
  const teamAdmin = { ...ROLE_DEFAULT_SCOPES.ADMIN, team: 'admin' };
  const rows: Array<{ who: string; businessId: string; role: string; permissionScopes?: Record<string, string>; maxApprovalTier?: number }> = [
    { who: ID.owner, businessId: ID.bizA, role: 'OWNER' },
    { who: ID.admin, businessId: ID.bizA, role: 'ADMIN' },
    { who: ID.adminSelf, businessId: ID.bizA, role: 'ADMIN' },
    { who: ID.adminR, businessId: ID.bizA, role: 'ADMIN', permissionScopes: { crm: 'read', team: 'write' }, maxApprovalTier: 0 },
    { who: ID.adminE, businessId: ID.bizA, role: 'ADMIN' },
    { who: ID.adminT, businessId: ID.bizA, role: 'ADMIN', permissionScopes: teamAdmin, maxApprovalTier: 3 },
    { who: ID.adminTS, businessId: ID.bizA, role: 'ADMIN', permissionScopes: teamAdmin, maxApprovalTier: 3 },
    { who: ID.staff, businessId: ID.bizA, role: 'STAFF' },
    { who: ID.staffLow, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'read' }, maxApprovalTier: 0 },
    { who: ID.staffE, businessId: ID.bizA, role: 'STAFF' },
    { who: ID.staffE2, businessId: ID.bizA, role: 'STAFF' },
    { who: ID.staffDel, businessId: ID.bizA, role: 'STAFF' },
    { who: ID.staffJ, businessId: ID.bizA, role: 'STAFF' },
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
  it('[V21-X01] two tenants, fifteen users, fifteen memberships, seven job roles, no assignments; the restricted fixtures are stale-copy findings already', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(2);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(15);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(15);
    expect(await db.jobRole.count({ where: { businessId: ID.bizA } })).toBe(7);
    expect(await db.orgAssignment.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } })).toBe(0);
    // adminR, staffLow, adminT and adminTS carry an explicit map with no position behind it.
    expect(staleBaseline).toBe(4);
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

  it('[V21-A03] a self-assignment within the ceiling is 201 for a team:admin ADMIN and leaves it at or below what it held; a default (team:write) ADMIN is refused (review F3); the tier-4 role is still refused afterwards', async () => {
    // team:write: the sync rewrites a membership, which the identity routes gate on team:admin (review F3).
    const selfBefore = await rowText('memberships', m(ID.adminSelf));
    const denied = await assign(ID.adminSelf, ID.adminSelf, ID.roleAdminish);
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    expect(JSON.stringify(denied.body)).toContain(REFUSED_TEAM_ADMIN);
    expect(await rowText('memberships', m(ID.adminSelf))).toBe(selfBefore);
    expect(await db.orgAssignment.count({ where: { membershipId: m(ID.adminSelf) } })).toBe(0);

    const res = await assign(ID.adminTS, ID.adminTS, ID.roleAdminish);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await membership(ID.adminTS);
    expect(row.permissionScopes).toEqual({ crm: 'admin', team: 'write' });
    expect(row.maxApprovalTier).toBe(3);
    expect(row.role).toBe('ADMIN');
    expect(await permissionLogs(ID.adminTS, ID.adminTS)).toHaveLength(1); // review F5

    const before = await rowText('memberships', m(ID.adminTS));
    const again = await assign(ID.adminTS, ID.adminTS, ID.roleHigh, { isPrimary: false });
    expect(again.status, JSON.stringify(again.body)).toBe(403);
    expect(JSON.stringify(again.body)).toContain(REFUSED_GRANT);
    expect(await rowText('memberships', m(ID.adminTS))).toBe(before);
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

describe('V1-21 review repairs: a JobRole on any position is a grant, and a position above the requester stays as it is (F1, F2)', () => {
  it('[V21-F1] RED-BEFORE (review F1): a contact-only position confers its job role, so a bounded member cannot put a role above itself on one (403, no row); within its authority it can, and the OWNER can (201)', async () => {
    const refused: Array<[string, string, string, number]> = [
      [ID.adminR, ID.roleHigh, 'f1_r_high', 1],     // tier 4, every module admin, by a tier-0 member
      [ID.admin, ID.roleHigh, 'f1_a_high', 2],      // tier 4 by a default ADMIN (tier 3)
      [ID.adminR, ID.roleOther, 'f1_r_other', 3],   // { crm: write } tier 1 by { crm: read } tier 0
      [ID.adminR, ID.roleLegacy, 'f1_r_legacy', 4], // KEY tool-family keys, which no membership map bounds
    ];
    for (const [actor, role, name, n] of refused) {
      const res = await call(actor, 'post', assignments(), contactOnly(name, phone(n), role));
      expect(res.status, `${actor} ${role} -> ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toContain(REFUSED_GRANT);
      expect(await db.orgAssignment.count({ where: { businessId: ID.bizA, contactName: `${P}${name}` } })).toBe(0);
    }
    const within = await call(ID.adminR, 'post', assignments(), contactOnly('f1_r_low', phone(11), ID.roleLow));
    expect(within.status, JSON.stringify(within.body)).toBe(201);
    // Bounded, not closed: the OWNER grants the tier-4 role, and the tool-family role, to a contact-only position.
    const high = await call(ID.owner, 'post', assignments(), contactOnly('f1_o_high', phone(12), ID.roleHigh));
    expect(high.status, JSON.stringify(high.body)).toBe(201);
    expect(high.body.jobRole.defaultApprovalTier).toBe(4);
    const legacy = await call(ID.owner, 'post', assignments(), contactOnly('f1_o_legacy', phone(13), ID.roleLegacy));
    expect(legacy.status, JSON.stringify(legacy.body)).toBe(201);
  });

  it('[V21-F1b] RED-BEFORE (review F1, F2): PATCH cannot move a contact-only position to a role above the requester, nor change one whose role is above it (403, byte-identical); a cosmetic edit, or a position within the requester, is 200', async () => {
    const low = await db.orgAssignment.findFirst({ where: { businessId: ID.bizA, contactName: `${P}f1_r_low` } });
    const lowBefore = await rowText('org_assignments', low.id);
    const up = await call(ID.adminR, 'patch', assignment(low.id), { jobRoleId: ID.roleHigh, autoApprovalViaReply: true });
    expect(up.status, JSON.stringify(up.body)).toBe(403);
    expect(JSON.stringify(up.body)).toContain(REFUSED_GRANT);
    expect(await rowText('org_assignments', low.id)).toBe(lowBefore);

    const high = await db.orgAssignment.findFirst({ where: { businessId: ID.bizA, contactName: `${P}f1_o_high` } });
    const highBefore = await rowText('org_assignments', high.id);
    const bodies: Array<Record<string, unknown>> = [
      { contactPhone: phone(14) },
      { contactEmail: `${P}f1b@v21a.test.local` },
      { preferredChannel: 'sms' },
      { autoApprovalViaReply: false },
      { jobRoleId: ID.roleLow },
      { endedAt: new Date().toISOString() },
    ];
    for (const body of bodies) {
      const res = await call(ID.adminR, 'patch', assignment(high.id), body);
      expect(res.status, `${JSON.stringify(body)} -> ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toContain(REFUSED_POSITION);
    }
    const del = await call(ID.adminR, 'delete', assignment(high.id));
    expect(del.status, JSON.stringify(del.body)).toBe(403);
    expect(JSON.stringify(del.body)).toContain(REFUSED_POSITION);
    expect(await rowText('org_assignments', high.id)).toBe(highBefore);

    // A cosmetic edit grants nothing and is not bounded; a position within the requester is its to redirect.
    const cosmetic = await call(ID.adminR, 'patch', assignment(high.id), { contactName: `${P}f1_o_high` });
    expect(cosmetic.status, JSON.stringify(cosmetic.body)).toBe(200);
    const moved = await call(ID.adminR, 'patch', assignment(low.id), { contactPhone: phone(15) });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((await db.orgAssignment.findUnique({ where: { id: low.id } })).contactPhone).toBe(phone(15));
  });

  it('[V21-F2] RED-BEFORE (review F2): the position of a member above the requester keeps its phone, email, channel, reply approval, end and row (403, byte-identical); a cosmetic edit is 200; a member within the requester can be redirected (200)', async () => {
    // A08: the OWNER gave staff the tier-4 role; its membership now exceeds every bounded member here.
    const a = await db.orgAssignment.findFirst({ where: { membershipId: m(ID.staff), jobRoleId: ID.roleHigh } });
    const before = await rowText('org_assignments', a.id);
    const memberBefore = await rowText('memberships', m(ID.staff));
    const bodies: Array<Record<string, unknown>> = [
      { contactPhone: phone(21), autoApprovalViaReply: true },
      { contactPhone: phone(22) },
      { autoApprovalViaReply: true },
      { contactEmail: `${P}f2@v21a.test.local` },
      { preferredChannel: 'sms' },
      { endedAt: new Date().toISOString() },
    ];
    for (const actor of [ID.admin, ID.adminR]) {
      for (const body of bodies) {
        const res = await call(actor, 'patch', assignment(a.id), body);
        expect(res.status, `${actor} ${JSON.stringify(body)} -> ${JSON.stringify(res.body)}`).toBe(403);
        expect(JSON.stringify(res.body)).toContain(REFUSED_TARGET);
      }
      const del = await call(actor, 'delete', assignment(a.id));
      expect(del.status, JSON.stringify(del.body)).toBe(403);
      expect(JSON.stringify(del.body)).toContain(REFUSED_TARGET);
    }
    expect(await rowText('org_assignments', a.id)).toBe(before);
    expect(await rowText('memberships', m(ID.staff))).toBe(memberBefore);

    const cosmetic = await call(ID.admin, 'patch', assignment(a.id), { isPrimary: true });
    expect(cosmetic.status, JSON.stringify(cosmetic.body)).toBe(200);
    // A05: staffLow's position is within adminR's authority, so adminR may point it at a phone.
    const own = await db.orgAssignment.findFirst({ where: { membershipId: m(ID.staffLow), jobRoleId: ID.roleLow } });
    const redirect = await call(ID.adminR, 'patch', assignment(own.id), { contactPhone: phone(23), autoApprovalViaReply: true });
    expect(redirect.status, JSON.stringify(redirect.body)).toBe(200);
    expect(redirect.body).toMatchObject({ contactPhone: phone(23), autoApprovalViaReply: true });
  });
});

describe('V1-21 review repairs: rewriting a member through a position needs team:admin, and every rewrite is logged (F3, F4, F5)', () => {
  it('[V21-F3] RED-BEFORE (review F3): a default ADMIN (team:write) cannot strip a peer ADMIN nor lift the OWNER\'s restriction through an assignment, even within its own ceiling (403, byte-identical, no row, no log)', async () => {
    const empty = await call(ID.owner, 'post', jobRoles(), { name: `${P}f3_empty`, permissions: {}, defaultApprovalTier: 0 });
    expect(empty.status, JSON.stringify(empty.body)).toBe(201);
    const cases: Array<[string, string]> = [
      [ID.adminE, empty.body.id],     // a peer ADMIN (role defaults) stripped to {}: locked out of team
      [ID.staffLow, ID.roleAdminish], // the OWNER's { crm: read } tier-0 restriction lifted to { crm: admin, team: write } tier 3
    ];
    for (const [who, role] of cases) {
      const before = await rowText('memberships', m(who));
      const count = await db.orgAssignment.count({ where: { membershipId: m(who) } });
      const res = await assign(ID.admin, who, role, { isPrimary: false });
      expect(res.status, `${who} -> ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toContain(REFUSED_TEAM_ADMIN);
      expect(await rowText('memberships', m(who))).toBe(before);
      expect(await db.orgAssignment.count({ where: { membershipId: m(who) } })).toBe(count);
      expect(await permissionLogs(who)).toHaveLength(0);
    }
    // The peer still reaches the structure routes.
    const peer = await call(ID.adminE, 'get', jobRoles());
    expect(peer.status, JSON.stringify(peer.body)).toBe(200);
  });

  it('[V21-F4] RED-BEFORE (review F4): deleting a job role is bounded as editing it is (403, row byte-identical); deleting a held one recomputes its holders (team:admin), so no copy is left without a position, and logs it', async () => {
    const highBefore = await rowText('job_roles', ID.roleHigh);
    for (const actor of [ID.adminR, ID.admin]) {
      const res = await call(actor, 'delete', jobRole(ID.roleHigh));
      expect(res.status, `${actor} -> ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toContain(REFUSED_ROLE);
    }
    expect(await rowText('job_roles', ID.roleHigh)).toBe(highBefore);

    const held = await call(ID.owner, 'post', jobRoles(), { name: `${P}f4_held`, permissions: { crm: 'write' }, defaultApprovalTier: 1 });
    expect(held.status, JSON.stringify(held.body)).toBe(201);
    const a = await assign(ID.owner, ID.staffJ, held.body.id);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(await classificationOf(ID.staffJ)).toBe('copy_matches_live_jobrole');

    // Within the default ADMIN's ceiling, but deleting it rewrites staffJ: team:admin (review F3).
    const memberBefore = await rowText('memberships', m(ID.staffJ));
    const denied = await call(ID.admin, 'delete', jobRole(held.body.id));
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    expect(JSON.stringify(denied.body)).toContain(REFUSED_TEAM_ADMIN);
    expect(await db.jobRole.count({ where: { id: held.body.id } })).toBe(1);
    expect(await rowText('memberships', m(ID.staffJ))).toBe(memberBefore);

    const ok = await call(ID.adminT, 'delete', jobRole(held.body.id));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await db.jobRole.count({ where: { id: held.body.id } })).toBe(0);
    const row = await membership(ID.staffJ);
    expect(row.permissionScopes).toBeNull();
    expect(row.maxApprovalTier).toBe(0);
    expect(await classificationOf(ID.staffJ)).toBe('no_copied_authority');
    expect((await db.orgAssignment.findUnique({ where: { id: a.body.id } })).jobRoleId).toBeNull(); // the FK's SetNull
    const logs = await permissionLogs(ID.staffJ, ID.adminT);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ meta: { reason: 'job_role_deleted', jobRoleId: held.body.id } });

    // An unheld role within the requester is its to delete.
    const free = await call(ID.admin, 'delete', jobRole(ID.roleEdit));
    expect(free.status, JSON.stringify(free.body)).toBe(200);
  });
});

describe('V1-21 ending or deleting a position recomputes the copied scopes', () => {
  it('[V21-E01] RED-BEFORE: ending a STAFF member\'s only position returns it to role defaults (no copied map), not the stale copy', async () => {
    const res = await assign(ID.owner, ID.staffE, ID.roleLow);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await membership(ID.staffE)).permissionScopes).toEqual({ crm: 'read' });

    // A default ADMIN (team:write) may not rewrite the member (review F3): 403, nothing changes.
    const memberBefore = await rowText('memberships', m(ID.staffE));
    const assignmentBefore = await rowText('org_assignments', res.body.id);
    const denied = await call(ID.admin, 'patch', assignment(res.body.id), { endedAt: new Date().toISOString() });
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    expect(JSON.stringify(denied.body)).toContain(REFUSED_TEAM_ADMIN);
    expect(await rowText('memberships', m(ID.staffE))).toBe(memberBefore);
    expect(await rowText('org_assignments', res.body.id)).toBe(assignmentBefore);

    const end = await call(ID.adminT, 'patch', assignment(res.body.id), { endedAt: new Date().toISOString() });
    expect(end.status, JSON.stringify(end.body)).toBe(200);
    expect(end.body.endedAt).toBeTruthy();
    const row = await membership(ID.staffE);
    expect(row.permissionScopes).toBeNull();
    expect(row.maxApprovalTier).toBe(0);
    expect(await classificationOf(ID.staffE)).toBe('no_copied_authority');
    // review F5: the rewrite is a 'permissions_updated' row by the requester, as the identity routes write.
    const logs = await permissionLogs(ID.staffE, ID.adminT);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ entityType: 'membership', meta: { reason: 'position_ended', assignmentId: res.body.id, scopes: null, maxApprovalTier: 0 } });
  });

  it('[V21-E02] RED-BEFORE: ending one of two positions re-copies the remaining active one', async () => {
    const primary = await assign(ID.owner, ID.staffE2, ID.roleOther, { isPrimary: true });
    expect(primary.status, JSON.stringify(primary.body)).toBe(201);
    const second = await assign(ID.owner, ID.staffE2, ID.roleLow, { isPrimary: false });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect((await membership(ID.staffE2)).permissionScopes).toEqual({ crm: 'read' }); // the last sync wins

    const memberBefore = await rowText('memberships', m(ID.staffE2));
    const denied = await call(ID.admin, 'patch', assignment(second.body.id), { endedAt: new Date().toISOString() });
    expect(denied.status, JSON.stringify(denied.body)).toBe(403); // review F3
    expect(JSON.stringify(denied.body)).toContain(REFUSED_TEAM_ADMIN);
    expect(await rowText('memberships', m(ID.staffE2))).toBe(memberBefore);

    const end = await call(ID.adminT, 'patch', assignment(second.body.id), { endedAt: new Date().toISOString() });
    expect(end.status, JSON.stringify(end.body)).toBe(200);
    const row = await membership(ID.staffE2);
    expect(row.permissionScopes).toEqual({ crm: 'write' });
    expect(row.maxApprovalTier).toBe(1);
    expect(await classificationOf(ID.staffE2)).toBe('copy_matches_live_jobrole');
  });

  it('[V21-E03] RED-BEFORE: deleting a position recomputes as ending does', async () => {
    const res = await assign(ID.owner, ID.staffDel, ID.roleLow);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const memberBefore = await rowText('memberships', m(ID.staffDel));
    const denied = await call(ID.admin, 'delete', assignment(res.body.id));
    expect(denied.status, JSON.stringify(denied.body)).toBe(403); // review F3
    expect(JSON.stringify(denied.body)).toContain(REFUSED_TEAM_ADMIN);
    expect(await rowText('memberships', m(ID.staffDel))).toBe(memberBefore);
    expect(await db.orgAssignment.count({ where: { membershipId: m(ID.staffDel) } })).toBe(1);

    const del = await call(ID.adminT, 'delete', assignment(res.body.id));
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

// Runs after E05 on purpose: the map it keeps is the identity route's, which the
// inventory reports as an explicit map with no position behind it.
describe('V1-21 review repairs: ending a position recomputes only the copy that is still that position\'s (CR-V21-03)', () => {
  it('[V21-E06] RED-BEFORE (CR-V21-03): a map set after the assignment (as PATCH /identity/.../permissions stores it) is not undone when the position ends: 200, the map kept, nothing logged, and a default ADMIN may end it', async () => {
    const res = await assign(ID.owner, ID.staffE, ID.roleLow);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await db.membership.update({
      where: { id: m(ID.staffE) },
      data: { permissionScopes: { crm: 'read', revenue: 'none', bookings: 'none' }, maxApprovalTier: 0 },
    });
    const before = await rowText('memberships', m(ID.staffE));
    const logsBefore = (await permissionLogs(ID.staffE)).length;

    const end = await call(ID.admin, 'patch', assignment(res.body.id), { endedAt: new Date().toISOString() });
    expect(end.status, JSON.stringify(end.body)).toBe(200);
    expect(end.body.endedAt).toBeTruthy();
    expect(await rowText('memberships', m(ID.staffE))).toBe(before);
    expect((await permissionLogs(ID.staffE)).length).toBe(logsBefore);
  });
});
