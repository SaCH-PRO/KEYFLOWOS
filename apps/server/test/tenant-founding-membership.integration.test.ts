/**
 * KF-EXEC-TENANT-001 — Membership-First Tenant Genesis, REAL database.
 *
 * The invariants this packet turns on cannot be proved with a fake. Whether two
 * concurrent bootstraps converge is a property of Postgres Serializable
 * Snapshot Isolation, not of application code; whether a half-written
 * constructor leaves an orphan Business is a property of transaction rollback;
 * whether an owner with no Membership is locked out is a property of the real
 * guard reading a real row. So all of it runs against actual PostgreSQL with
 * nothing on the tenant boundary mocked. Only BlueprintService and
 * DefaultTriggersService are stubbed, and neither is touched by the paths under
 * test.
 *
 * Several of these are negative controls: they are written so they would FAIL
 * against the pre-packet code, not merely pass against the new code.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'tgen_'; // unique prefix for all seeded rows (safe cleanup)

let db: any;
let identity: any;
let founding: any;
let moduleScopeGuard: any;

const stubs = () => [{} as any, { seedForBusiness: async () => 0 } as any];

function scopeCtx(user: { id: string; role?: string } | undefined, businessId?: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params: { businessId } }) }),
    getHandler: () => handlerRequiringCrmRead,
  } as any;
}
// A handler carrying @RequireModuleScope('crm','read') metadata.
function handlerRequiringCrmRead() {}

async function cleanup() {
  for (const sql of [
    `DELETE FROM team_activity_logs WHERE business_id LIKE '${P}%'`,
    `DELETE FROM memberships WHERE business_id LIKE '${P}%'`,
    `DELETE FROM memberships WHERE user_id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%' OR owner_id LIKE '${P}%' OR name LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { FoundingMembershipService } = await import(
    '../src/modules/identity/founding-membership.service'
  );
  const { ModuleScopeGuard, MODULE_SCOPE_KEY } = await import('../src/core/auth/module-scope.guard');
  const { Reflector } = await import('@nestjs/core');

  const prisma = new PrismaService();
  identity = new IdentityService(prisma as any, ...stubs());
  founding = new FoundingMembershipService(prisma as any);

  Reflect.defineMetadata(MODULE_SCOPE_KEY, { module: 'crm', minLevel: 'read' }, handlerRequiringCrmRead);
  moduleScopeGuard = new ModuleScopeGuard(prisma as any, new Reflector());

  await cleanup();
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
});

beforeEach(async () => {
  await cleanup();
});

async function seedUser(suffix: string) {
  const id = `${P}u_${suffix}`;
  await db.user.create({ data: { id, email: `${P}${suffix}@test.local`, role: 'USER' } });
  return id;
}

// ── Constructor parity ─────────────────────────────────────────────────────

describe('explicit IdentityService.createBusiness — real DB', () => {
  it('yields exactly one founding OWNER Membership', async () => {
    const owner = await seedUser('c1');

    const business = await identity.createBusiness({ name: `${P}Acme`, ownerId: owner });

    const members = await db.membership.findMany({ where: { businessId: business.id } });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: owner, role: 'OWNER' });
    // ownerId is preserved, not replaced by the Membership.
    const row = await db.business.findUnique({ where: { id: business.id } });
    expect(row.ownerId).toBe(owner);
  });

  it('unlocks the module-scoped routes that a Membership-less owner was refused', async () => {
    // The concrete damage. Before this packet the owner reached BusinessGuard
    // and was then thrown out by ModuleScopeGuard on every @RequireModuleScope
    // route — 437 of them. This asserts the founding Membership actually fixes
    // that, rather than merely existing in the table.
    const owner = await seedUser('c1guard');
    const business = await identity.createBusiness({ name: `${P}Guarded`, ownerId: owner });

    await expect(moduleScopeGuard.canActivate(scopeCtx({ id: owner }, business.id))).resolves.toBe(
      true,
    );
  });

  it('creates NOTHING when the owner does not exist — atomic failure, no orphan', async () => {
    const ghost = `${P}u_ghost_not_a_user`;

    await expect(identity.createBusiness({ name: `${P}Orphan`, ownerId: ghost })).rejects.toThrow();

    // Negative control: pre-packet this wrote a Business with an unresolvable
    // owner and returned 201.
    const leaked = await db.business.findMany({ where: { name: `${P}Orphan` } });
    expect(leaked).toHaveLength(0);
  });

  it('still allows one owner to hold several businesses', async () => {
    // Explicitly required by the packet: explicit create is NOT idempotent and
    // ownerId is NOT unique. A fix that collapsed these into one business would
    // be wrong.
    const owner = await seedUser('c1multi');

    const first = await identity.createBusiness({ name: `${P}First`, ownerId: owner });
    const second = await identity.createBusiness({ name: `${P}Second`, ownerId: owner });

    expect(first.id).not.toBe(second.id);
    for (const b of [first, second]) {
      const members = await db.membership.findMany({ where: { businessId: b.id } });
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('OWNER');
    }
  });
});

// ── Bootstrap idempotency and concurrency ──────────────────────────────────

describe('bootstrap workspace — real DB', () => {
  const ensure = (userId: string, name: string) =>
    (identity as any).ensureBootstrapWorkspace(userId, name);

  it('is idempotent across sequential retries', async () => {
    const user = await seedUser('boot_seq');

    const a = await ensure(user, `${P}Workspace`);
    const b = await ensure(user, `${P}Workspace`);
    const c = await ensure(user, `${P}Workspace`);

    expect(a.isNewBusiness).toBe(true);
    expect(b.isNewBusiness).toBe(false);
    expect(c.isNewBusiness).toBe(false);
    expect(b.business.id).toBe(a.business.id);

    const businesses = await db.business.findMany({ where: { ownerId: user, deletedAt: null } });
    expect(businesses).toHaveLength(1);
    const members = await db.membership.findMany({ where: { businessId: a.business.id } });
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe('OWNER');
  });

  it('converges when several bootstraps race, without ownerId uniqueness', async () => {
    // THE case this packet exists for. Pre-packet, the unsynchronised
    // find-then-create let every concurrent caller create its own Business, and
    // Membership's @@unique([userId, businessId]) could not stop it because the
    // duplicates live on different businesses.
    //
    // Serializable isolation makes the losers abort; the bounded retry re-reads
    // and adopts the winner. The assertion is the postcondition, not the
    // mechanism: one business, one OWNER Membership.
    const user = await seedUser('boot_race');

    const results = await Promise.all(
      Array.from({ length: 6 }, () => ensure(user, `${P}Raced`)),
    );

    const businesses = await db.business.findMany({ where: { ownerId: user, deletedAt: null } });
    expect(businesses).toHaveLength(1);

    const memberships = await db.membership.findMany({ where: { businessId: businesses[0].id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ userId: user, role: 'OWNER' });

    // Every caller must have been handed the same workspace.
    expect(new Set(results.map((r: any) => r.business.id)).size).toBe(1);
    // Exactly one caller may claim it created it.
    expect(results.filter((r: any) => r.isNewBusiness)).toHaveLength(1);
  }, 60_000);

  it('does not adopt a business the user created explicitly after bootstrap', async () => {
    const user = await seedUser('boot_after');
    const bootstrapped = await ensure(user, `${P}Bootstrapped`);
    const explicit = await identity.createBusiness({ name: `${P}Explicit`, ownerId: user });

    const again = await ensure(user, `${P}Bootstrapped`);

    expect(again.business.id).toBe(bootstrapped.business.id);
    expect(again.business.id).not.toBe(explicit.id);
  });
});

// ── Discovery ──────────────────────────────────────────────────────────────

describe('workspace discovery — real DB', () => {
  it('shows owners their workspace and members the workspaces they belong to', async () => {
    const owner = await seedUser('disc_owner');
    const staff = await seedUser('disc_staff');
    const stranger = await seedUser('disc_stranger');

    const business = await identity.createBusiness({ name: `${P}Shared`, ownerId: owner });
    await db.membership.create({
      data: { userId: staff, businessId: business.id, role: 'STAFF' },
    });

    const ownerSees = await identity.listBusinesses(owner);
    const staffSees = await identity.listBusinesses(staff);
    const strangerSees = await identity.listBusinesses(stranger);

    expect(ownerSees.map((b: any) => b.id)).toContain(business.id);
    // Negative control: pre-packet this array was empty.
    expect(staffSees.map((b: any) => b.id)).toContain(business.id);
    expect(strangerSees.map((b: any) => b.id)).not.toContain(business.id);
  });

  it('keeps a legacy owner with no Membership discoverable via the compatibility arm', async () => {
    // The reason ownerId stays in the predicate. This row is what the backfill
    // has not reached yet; discovery must not blank out while it waits.
    const owner = await seedUser('disc_legacy');
    const legacy = await db.business.create({
      data: { id: `${P}b_legacy`, name: `${P}Legacy`, ownerId: owner },
    });

    const seen = await identity.listBusinesses(owner);

    expect(seen.map((b: any) => b.id)).toContain(legacy.id);
  });

  it('excludes soft-deleted workspaces', async () => {
    const owner = await seedUser('disc_deleted');
    const business = await identity.createBusiness({ name: `${P}Gone`, ownerId: owner });
    await db.business.update({ where: { id: business.id }, data: { deletedAt: new Date() } });

    const seen = await identity.listBusinesses(owner);
    expect(seen.map((b: any) => b.id)).not.toContain(business.id);
  });
});

// ── Migration inventory, classification and repair ─────────────────────────

describe('founding-membership inventory and deterministic repair — real DB', () => {
  async function seedAllClasses() {
    const safeOwner = await seedUser('mig_safe');
    const conflictOwner = await seedUser('mig_conflict');
    const rivalOwner = await seedUser('mig_rival');
    const roleOwner = await seedUser('mig_role');
    const exactOwner = await seedUser('mig_exact');
    const otherA = await seedUser('mig_otherA');
    const otherB = await seedUser('mig_otherB');

    // exact match
    const exact = await db.business.create({
      data: { id: `${P}b_exact`, name: `${P}exact`, ownerId: exactOwner },
    });
    await db.membership.create({ data: { userId: exactOwner, businessId: exact.id, role: 'OWNER' } });

    // deterministically repairable: resolvable owner, no membership at all
    const safe = await db.business.create({
      data: { id: `${P}b_safe`, name: `${P}safe`, ownerId: safeOwner },
    });

    // conflicting: someone else holds OWNER
    const conflict = await db.business.create({
      data: { id: `${P}b_conflict`, name: `${P}conflict`, ownerId: conflictOwner },
    });
    await db.membership.create({ data: { userId: otherA, businessId: conflict.id, role: 'OWNER' } });

    // conflicting: owner holds a non-OWNER role
    const role = await db.business.create({
      data: { id: `${P}b_role`, name: `${P}role`, ownerId: roleOwner },
    });
    await db.membership.create({ data: { userId: roleOwner, businessId: role.id, role: 'STAFF' } });

    // ambiguous: two rival OWNERs, neither is ownerId
    const ambiguous = await db.business.create({
      data: { id: `${P}b_ambiguous`, name: `${P}ambiguous`, ownerId: rivalOwner },
    });
    await db.membership.create({ data: { userId: otherA, businessId: ambiguous.id, role: 'OWNER' } });
    await db.membership.create({ data: { userId: otherB, businessId: ambiguous.id, role: 'OWNER' } });

    // unresolvable owner
    const ghost = await db.business.create({
      data: { id: `${P}b_ghost`, name: `${P}ghost`, ownerId: `${P}u_nobody` },
    });

    return { safe, conflict, role, ambiguous, ghost, exact, safeOwner };
  }

  it('detects every class against real rows', async () => {
    const seeded = await seedAllClasses();
    const inventory = await founding.classify();
    const byId = new Map(inventory.rows.map((r: any) => [r.businessId, r.classification]));

    expect(byId.get(seeded.exact.id)).toBe('exact_owner_membership_match');
    expect(byId.get(seeded.safe.id)).toBe('missing_founding_membership_with_resolvable_owner');
    expect(byId.get(seeded.conflict.id)).toBe('conflicting_owner_membership');
    expect(byId.get(seeded.role.id)).toBe('conflicting_owner_membership');
    expect(byId.get(seeded.ambiguous.id)).toBe('otherwise_ambiguous');
    expect(byId.get(seeded.ghost.id)).toBe('ownerId_unresolvable_to_User');
  });

  it('writes nothing in report mode', async () => {
    const seeded = await seedAllClasses();
    const before = await db.membership.count({ where: { businessId: { startsWith: P } } });

    const out = await founding.repairDeterministic();

    expect(out.repaired).toEqual([]);
    expect(await db.membership.count({ where: { businessId: { startsWith: P } } })).toBe(before);
    expect(out.inventory.rows.find((r: any) => r.businessId === seeded.safe.id).classification).toBe(
      'missing_founding_membership_with_resolvable_owner',
    );
  });

  it('repairs only the deterministic class and leaves the rest exactly as found', async () => {
    const seeded = await seedAllClasses();
    const snapshot = async (businessId: string) =>
      (await db.membership.findMany({ where: { businessId }, orderBy: { userId: 'asc' } })).map(
        (m: any) => `${m.userId}:${m.role}`,
      );

    const conflictBefore = await snapshot(seeded.conflict.id);
    const roleBefore = await snapshot(seeded.role.id);
    const ambiguousBefore = await snapshot(seeded.ambiguous.id);
    const ghostBefore = await snapshot(seeded.ghost.id);

    const out = await founding.repairDeterministic({ apply: true });

    // Scoped to this suite's rows on purpose. `classify()` sweeps every business
    // in the database by design, and sibling integration suites seed their own,
    // so asserting an exact global repair list would make this test fail for
    // reasons that have nothing to do with the behaviour under test.
    expect(out.repaired).toContain(seeded.safe.id);
    for (const id of [seeded.conflict.id, seeded.role.id, seeded.ambiguous.id, seeded.ghost.id]) {
      expect(out.repaired).not.toContain(id);
    }
    const repaired = await db.membership.findMany({ where: { businessId: seeded.safe.id } });
    expect(repaired).toHaveLength(1);
    expect(repaired[0]).toMatchObject({ userId: seeded.safeOwner, role: 'OWNER' });

    // Untouched, byte for byte.
    expect(await snapshot(seeded.conflict.id)).toEqual(conflictBefore);
    expect(await snapshot(seeded.role.id)).toEqual(roleBefore);
    expect(await snapshot(seeded.ambiguous.id)).toEqual(ambiguousBefore);
    expect(await snapshot(seeded.ghost.id)).toEqual(ghostBefore);
  });

  it('is safe to run twice', async () => {
    const seeded = await seedAllClasses();
    await founding.repairDeterministic({ apply: true });
    const afterFirst = await db.membership.count({ where: { businessId: { startsWith: P } } });

    const second = await founding.repairDeterministic({ apply: true });

    // Nothing of ours is left in the deterministic class, and the second pass
    // added no row of ours.
    expect(second.repaired).not.toContain(seeded.safe.id);
    expect(await db.membership.count({ where: { businessId: { startsWith: P } } })).toBe(afterFirst);
  });

  it('preserves ownerId and pre-existing Membership history through repair', async () => {
    // The rollback floor: repair adds, it never rewrites. ownerId survives and
    // so does every Membership that was already there, with its original role.
    const seeded = await seedAllClasses();
    const ownersBefore = await db.business.findMany({
      where: { id: { startsWith: P } },
      select: { id: true, ownerId: true },
      orderBy: { id: 'asc' },
    });
    const historyBefore = await db.membership.findMany({
      where: { businessId: { startsWith: P } },
      select: { userId: true, businessId: true, role: true },
      orderBy: [{ businessId: 'asc' }, { userId: 'asc' }],
    });

    await founding.repairDeterministic({ apply: true });

    const ownersAfter = await db.business.findMany({
      where: { id: { startsWith: P } },
      select: { id: true, ownerId: true },
      orderBy: { id: 'asc' },
    });
    const historyAfter = await db.membership.findMany({
      where: { businessId: { startsWith: P } },
      select: { userId: true, businessId: true, role: true },
      orderBy: [{ businessId: 'asc' }, { userId: 'asc' }],
    });

    expect(ownersAfter).toEqual(ownersBefore);
    // Every prior row still present with the same role; only additions allowed.
    for (const row of historyBefore) {
      expect(historyAfter).toContainEqual(row);
    }
    expect(historyAfter.length).toBe(historyBefore.length + 1);
    expect(seeded.safe.id).toBeDefined();
  });
});
