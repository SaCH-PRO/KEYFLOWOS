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
};

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
    `DELETE FROM memberships WHERE id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
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
