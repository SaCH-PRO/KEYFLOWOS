/**
 * Phase 2D-A — Business & membership cross-tenant boundary (REAL database).
 *
 * Exercises the REAL BusinessGuard and REAL IdentityService team methods
 * against the local PostgreSQL. Nothing on the isolation boundary is mocked:
 * Prisma, membership rows, the guard, and DB constraints are all real. Only
 * IdentityService's unrelated BlueprintService dependency is stubbed (it is
 * never touched by the team code paths under test).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// Pure module (no Nest, no I/O): the canonical role-default tables the team methods write.
import { ROLE_DEFAULT_SCOPES, DEFAULT_APPROVAL_TIERS } from '../src/core/authority/module-vocabulary';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 't2d_'; // unique prefix for all seeded rows (safe cleanup)
const ID = {
  userA: `${P}userA`,
  userB: `${P}userB`,
  userStaffA: `${P}userStaffA`,
  userStaffB: `${P}userStaffB`,
  userSA: `${P}userSA`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  mA_owner: `${P}mA_owner`,
  mA_staff: `${P}mA_staff`,
  mB_owner: `${P}mB_owner`,
  mB_staff: `${P}mB_staff`,
  // V1-07-AUTH-INVITE-CEILING (CF-26 / ST-F4) fixtures, all in bizA.
  userAdminA: `${P}userAdminA`,       // ADMIN of bizA as an invite writes one: ADMIN defaults (team: write), tier 3
  userTeamAdminA: `${P}userTeamAdminA`, // STAFF of bizA granted { crm: read, team: admin }, tier 0
  userTargetA: `${P}userTargetA`,     // STAFF of bizA, { crm: read }, tier 0 — within userTeamAdminA's authority
  userExisting: `${P}userExisting`,   // User row only, no membership anywhere: an existing account being invited
  mA_admin: `${P}mA_admin`,
  mA_teamAdmin: `${P}mA_teamAdmin`,
  mA_target: `${P}mA_target`,
};

/** Emails embed the prefix (users.email is globally unique), so cleanup can find invite-created rows. */
const inviteEmail = (tag: string) => `${P}inv_${tag}@test.local`;

let db: any;
let identity: any;
let guard: any;

function ctx(user: { id: string; role?: string } | undefined, businessId?: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params: { businessId } }) }),
  } as any;
}

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension) by prefix.
  for (const sql of [
    `DELETE FROM team_activity_logs WHERE business_id LIKE '${P}%'`,
    // An invite writes a membership and (for a new email) a User with generated ids,
    // so those rows are found by their business and by their prefixed email.
    `DELETE FROM memberships WHERE id LIKE '${P}%' OR business_id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%' OR email LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const prisma = new PrismaService();
  identity = new IdentityService(prisma as any, {} as any); // BlueprintService unused by team paths
  guard = new BusinessGuard(prisma as any);

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.userA, email: `${P}a@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userB, email: `${P}b@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userStaffA, email: `${P}sa@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userStaffB, email: `${P}sb@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userSA, email: `${P}super@test.local`, role: 'SUPER_ADMIN' } });

  await db.business.create({ data: { id: ID.bizA, name: 'Biz A', ownerId: ID.userA } });
  await db.business.create({ data: { id: ID.bizB, name: 'Biz B', ownerId: ID.userB } });

  await db.membership.create({ data: { id: ID.mA_owner, userId: ID.userA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: ID.mA_staff, userId: ID.userStaffA, businessId: ID.bizA, role: 'STAFF' } });
  await db.membership.create({ data: { id: ID.mB_owner, userId: ID.userB, businessId: ID.bizB, role: 'OWNER' } });
  await db.membership.create({ data: { id: ID.mB_staff, userId: ID.userStaffB, businessId: ID.bizB, role: 'STAFF' } });

  // V1-07-AUTH-INVITE-CEILING fixtures.
  for (const id of [ID.userAdminA, ID.userTeamAdminA, ID.userTargetA, ID.userExisting]) {
    await db.user.create({ data: { id, email: `${id}@test.local`, role: 'USER' } });
  }
  await db.membership.create({
    data: { id: ID.mA_admin, userId: ID.userAdminA, businessId: ID.bizA, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN }, maxApprovalTier: 3 },
  });
  await db.membership.create({
    data: { id: ID.mA_teamAdmin, userId: ID.userTeamAdminA, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'read', team: 'admin' }, maxApprovalTier: 0 },
  });
  await db.membership.create({
    data: { id: ID.mA_target, userId: ID.userTargetA, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'read' }, maxApprovalTier: 0 },
  });
}, 60_000);

afterAll(async () => {
  if (db) await cleanup();
});

describe('BusinessGuard — real DB membership boundary', () => {
  it('allows a member to access their own business', async () => {
    await expect(guard.canActivate(ctx({ id: ID.userA }, ID.bizA))).resolves.toBe(true);
  });

  it('DENIES a member of Business A from accessing Business B', async () => {
    await expect(guard.canActivate(ctx({ id: ID.userA }, ID.bizB))).rejects.toThrow();
  });

  it('allows SUPER_ADMIN to access any business (bypass)', async () => {
    await expect(guard.canActivate(ctx({ id: ID.userSA, role: 'SUPER_ADMIN' }, ID.bizB))).resolves.toBe(true);
  });

  it('fails closed on missing businessId', async () => {
    await expect(guard.canActivate(ctx({ id: ID.userA }, undefined))).rejects.toThrow();
  });

  it('fails closed on a nonexistent businessId', async () => {
    await expect(guard.canActivate(ctx({ id: ID.userA }, `${P}nope`))).rejects.toThrow();
  });

  it('fails closed when there is no authenticated user', async () => {
    await expect(guard.canActivate(ctx(undefined, ID.bizA))).rejects.toThrow();
  });
});

describe('IdentityService team methods — real DB cross-tenant attacks', () => {
  it('listTeamMembers returns only the requested business, never Business B members', async () => {
    const membersA = await identity.listTeamMembers(ID.bizA);
    const ids = membersA.map((m: any) => m.id);
    expect(ids).toContain(ID.mA_owner);
    expect(ids).not.toContain(ID.mB_owner);
    expect(ids).not.toContain(ID.mB_staff);
  });

  it('removeTeamMember(A, membershipInB) is rejected and leaves B unchanged', async () => {
    // Owner of A passes BusinessGuard/assertTeamAdmin for A, but targets B's membership id.
    await expect(identity.removeTeamMember(ID.bizA, ID.mB_staff, ID.userA)).rejects.toThrow();
    const still = await db.membership.findUnique({ where: { id: ID.mB_staff } });
    expect(still).not.toBeNull();
    expect(still.businessId).toBe(ID.bizB);
  });

  it('updateMemberRole(A, membershipInB) is rejected and leaves B role unchanged', async () => {
    await expect(identity.updateMemberRole(ID.bizA, ID.mB_staff, 'ADMIN', ID.userA)).rejects.toThrow();
    const still = await db.membership.findUnique({ where: { id: ID.mB_staff } });
    expect(still.role).toBe('STAFF');
  });

  it('updateMemberPermissions(A, membershipInB) is rejected and leaves B unchanged', async () => {
    const before = await db.membership.findUnique({ where: { id: ID.mB_staff } });
    await expect(identity.updateMemberPermissions(ID.bizA, ID.mB_staff, {}, 0, ID.userA)).rejects.toThrow();
    const after = await db.membership.findUnique({ where: { id: ID.mB_staff } });
    expect(after.maxApprovalTier).toBe(before.maxApprovalTier);
  });

  it('positive control: removeTeamMember(A, staffInA) succeeds (proves the method works)', async () => {
    await expect(identity.removeTeamMember(ID.bizA, ID.mA_staff, ID.userA)).resolves.toEqual({ success: true });
    const gone = await db.membership.findUnique({ where: { id: ID.mA_staff } });
    expect(gone).toBeNull();
  });
});

/** The service refused with 403 (ForbiddenException) and this message. */
async function expectForbidden(p: Promise<unknown>, message: string) {
  const err: any = await p.then(
    (v) => { throw new Error(`expected a 403, got a result: ${JSON.stringify(v)}`); },
    (e) => e,
  );
  expect(typeof err?.getStatus, `not an HttpException: ${err}`).toBe('function');
  expect(err.getStatus(), String(err?.message)).toBe(403);
  expect(err.message).toBe(message);
}

/** Every membership in bizA held by an account with this email (none, when the invite was refused). */
async function bizAMembershipsFor(emailAddress: string) {
  return db.membership.findMany({ where: { businessId: ID.bizA, user: { email: emailAddress } } });
}

const CEILING = 'You cannot grant more authority than your own';

/**
 * V1-07-AUTH-INVITE-CEILING (CF-26; ST-F4 in identity-boundary.integration.test.ts).
 *
 * K2 Human Authority: a grant is bounded by the grantor's own authority. The role and
 * permissions writes already were (R0-ID-F1-ROLE-ROUTE-AUTHORITY); the invite took the
 * caller's scopes and maxApprovalTier as given and created the User and Membership, so
 * a team:write member could mint an account above itself. The invite now applies the
 * same ceiling, before any row is written: REFUSED with 403, not clamped (a clamp would
 * silently create a member with less than was asked for).
 */
describe('V1-07-AUTH-INVITE-CEILING — inviteTeamMember is bounded by the inviter’s own authority (real DB)', () => {
  it('an ADMIN (tier 3) invite with maxApprovalTier 4 is refused 403, and no User or Membership is created', async () => {
    const e = inviteEmail('tier4');
    await expectForbidden(
      identity.inviteTeamMember(ID.bizA, e, 'ADMIN', ID.userAdminA, { ...ROLE_DEFAULT_SCOPES.ADMIN }, 4),
      CEILING,
    );
    expect(await db.user.count({ where: { email: e } })).toBe(0);
    expect(await bizAMembershipsFor(e)).toEqual([]);
  });

  it('an ADMIN (team: write) invite with scopes { team: admin } is refused 403, and no User or Membership is created', async () => {
    const e = inviteEmail('teamadmin');
    await expectForbidden(identity.inviteTeamMember(ID.bizA, e, 'STAFF', ID.userAdminA, { team: 'admin' }, 0), CEILING);
    expect(await db.user.count({ where: { email: e } })).toBe(0);
    expect(await bizAMembershipsFor(e)).toEqual([]);
  });

  it('a bounded invite of an EXISTING account is refused before any write: no membership, the User row untouched', async () => {
    const e = `${ID.userExisting}@test.local`;
    const before = await db.user.findUnique({ where: { id: ID.userExisting } });
    await expectForbidden(
      identity.inviteTeamMember(ID.bizA, e, 'ADMIN', ID.userAdminA, { ...ROLE_DEFAULT_SCOPES.OWNER }, 4),
      CEILING,
    );
    expect(await db.membership.count({ where: { userId: ID.userExisting } })).toBe(0);
    expect(await db.user.findUnique({ where: { id: ID.userExisting } })).toEqual(before);
  });

  it('the role defaults count too: a { crm: read, team: admin } tier-0 member cannot invite an ADMIN or a STAFF with role-default scopes', async () => {
    for (const role of ['ADMIN', 'STAFF']) {
      const e = inviteEmail(`default_${role}`);
      await expectForbidden(identity.inviteTeamMember(ID.bizA, e, role, ID.userTeamAdminA), CEILING);
      expect(await db.user.count({ where: { email: e } })).toBe(0);
    }
  });

  it('a refused invite writes no member_invited row', async () => {
    const rows = await db.teamActivityLog.findMany({
      where: { businessId: ID.bizA, action: 'member_invited', userId: { in: [ID.userAdminA, ID.userTeamAdminA] } },
    });
    expect(rows).toEqual([]);
  });

  it('positive control: the OWNER invites at any tier and with any scopes — team:admin at tier 4 is created as asked', async () => {
    const e = inviteEmail('owner_tier4');
    const m = await identity.inviteTeamMember(ID.bizA, e, 'ADMIN', ID.userA, { ...ROLE_DEFAULT_SCOPES.OWNER }, 4);
    const row = await db.membership.findUnique({ where: { id: m.id } });
    expect(row.businessId).toBe(ID.bizA);
    expect(row.role).toBe('ADMIN');
    expect(row.permissionScopes).toEqual(ROLE_DEFAULT_SCOPES.OWNER);
    expect(row.maxApprovalTier).toBe(4);
    expect(await db.user.count({ where: { email: e } })).toBe(1);
  });

  it('positive control: the OWNER invites the existing account the ADMIN could not, with the same payload', async () => {
    const m = await identity.inviteTeamMember(
      ID.bizA, `${ID.userExisting}@test.local`, 'ADMIN', ID.userA, { ...ROLE_DEFAULT_SCOPES.OWNER }, 4,
    );
    expect(m.userId).toBe(ID.userExisting);
    const row = await db.membership.findUnique({ where: { id: m.id } });
    expect(row.permissionScopes).toMatchObject({ team: 'admin' });
    expect(row.maxApprovalTier).toBe(4);
  });

  it('positive control: a bounded inviter invites at its own ceiling — an ADMIN invites an ADMIN with the role defaults (equal, not above)', async () => {
    const e = inviteEmail('admin_equal');
    const m = await identity.inviteTeamMember(ID.bizA, e, 'ADMIN', ID.userAdminA);
    const row = await db.membership.findUnique({ where: { id: m.id } });
    expect(row.permissionScopes).toEqual(ROLE_DEFAULT_SCOPES.ADMIN);
    expect(row.maxApprovalTier).toBe(DEFAULT_APPROVAL_TIERS.ADMIN);
  });

  it('positive control: a { crm: read, team: admin } tier-0 member invites a STAFF within its authority ({ crm: read }, tier 0)', async () => {
    const e = inviteEmail('within');
    const m = await identity.inviteTeamMember(ID.bizA, e, 'STAFF', ID.userTeamAdminA, { crm: 'read' }, 0);
    const row = await db.membership.findUnique({ where: { id: m.id } });
    expect(row.permissionScopes).toEqual({ crm: 'read' });
    expect(row.maxApprovalTier).toBe(0);
  });

  it('updateMemberRole applies the same ceiling: the same member cannot give a member within its authority the ADMIN role defaults — 403, row unchanged', async () => {
    const before = await db.membership.findUnique({ where: { id: ID.mA_target } });
    await expectForbidden(identity.updateMemberRole(ID.bizA, ID.mA_target, 'ADMIN', ID.userTeamAdminA), CEILING);
    const after = await db.membership.findUnique({ where: { id: ID.mA_target } });
    expect(after).toEqual(before);
  });

  it('payload validation is unchanged and runs before the ceiling: an out-of-range tier is still 400, and writes nothing', async () => {
    await expect(
      identity.inviteTeamMember(ID.bizA, inviteEmail('badtier'), 'STAFF', ID.userAdminA, { crm: 'read' }, 9),
    ).rejects.toMatchObject({ message: 'maxApprovalTier must be an integer between 0 and 4' });
    expect(await db.user.count({ where: { email: inviteEmail('badtier') } })).toBe(0);
  });
});
