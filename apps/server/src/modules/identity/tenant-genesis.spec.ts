/**
 * KF-EXEC-TENANT-001 — Membership-First Tenant Genesis, focused proof.
 *
 * These are the cases where the *shape* of the fix is what matters and a real
 * database would not tell you more than a fake does: did the write go inside a
 * transaction, did the Serializable retry actually re-read, does the discovery
 * predicate name Membership at all. The real-database behaviour — that Postgres
 * SSI aborts the losing bootstrap, that the founding Membership survives a
 * rollback — is proved in `apps/server/test/tenant-founding-membership.integration.test.ts`
 * against actual Postgres, because nothing but Postgres can prove it.
 *
 * The negative controls matter as much as the positives here. Three of the
 * assertions below fail against the pre-packet code, and one of them
 * (`ownerId`-only discovery) passed every test in the repository for months
 * while silently hiding workspaces from legitimate members.
 */
import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { FoundingMembershipService } from './founding-membership.service';

// ── helpers ────────────────────────────────────────────────────────────────

/** A tx client that records every write in call order. */
function txRecorder() {
  const calls: string[] = [];
  const tx = {
    business: {
      create: vi.fn(async ({ data }: any) => {
        calls.push('business.create');
        return { id: 'biz-new', ...data };
      }),
      findFirst: vi.fn(async () => {
        calls.push('business.findFirst');
        return null;
      }),
    },
    membership: {
      create: vi.fn(async () => {
        calls.push('membership.create');
        return { id: 'mem-new' };
      }),
      upsert: vi.fn(async () => {
        calls.push('membership.upsert');
        return { id: 'mem-new' };
      }),
    },
  };
  return { tx, calls };
}

function buildIdentity(client: any) {
  return new IdentityService(
    { client } as never,
    {} as never,
    { seedForBusiness: vi.fn(async () => 0) } as never,
  );
}

class WriteConflict extends Error {
  code = 'P2034';
}

// ── C1: explicit IdentityService create ────────────────────────────────────

describe('IdentityService.createBusiness — founding OWNER Membership', () => {
  it('writes the founding OWNER Membership as a nested relation on the Business', async () => {
    const create = vi.fn(async ({ data }: any) => ({ id: 'biz-new', ...data }));
    const service = buildIdentity({ business: { create } });

    const business = await service.createBusiness({ name: '  Acme  ', ownerId: 'user-1' });

    // Prisma runs a nested create in one implicit transaction, so this IS the
    // atomicity guarantee — there is no second statement that can be skipped.
    expect(create).toHaveBeenCalledWith({
      data: {
        name: 'Acme',
        ownerId: 'user-1',
        members: { create: { userId: 'user-1', role: 'OWNER' } },
      },
    });
    expect(business.id).toBe('biz-new');
  });

  it('never writes a Business without the nested founding Membership', async () => {
    // Negative control. Pre-packet this path wrote the Business alone, and the
    // resulting owner was refused by every @RequireModuleScope route.
    const create = vi.fn(async ({ data }: any) => ({ id: 'biz-new', ...data }));
    const service = buildIdentity({ business: { create } });

    await service.createBusiness({ name: 'Acme', ownerId: 'user-1' });

    const data = create.mock.calls[0][0].data;
    expect(data.members?.create).toBeDefined();
    expect(data.members.create.role).toBe('OWNER');
  });

  it('still refuses a missing ownerId before any write', async () => {
    const create = vi.fn();
    const service = buildIdentity({ business: { create } });

    await expect(service.createBusiness({ name: 'Acme', ownerId: '' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(create).not.toHaveBeenCalled();
  });
});

// ── C2: bootstrap convergence ──────────────────────────────────────────────

describe('IdentityService bootstrap workspace — atomicity and convergence', () => {
  /** Reach the private method the way bootstrapUser does, without the Supabase preamble. */
  const ensure = (service: IdentityService, userId: string, name: string) =>
    (service as unknown as {
      ensureBootstrapWorkspace(u: string, n: string): Promise<{ business: any; isNewBusiness: boolean }>;
    }).ensureBootstrapWorkspace(userId, name);

  it('runs find-or-create and the OWNER upsert in one Serializable transaction', async () => {
    const { tx, calls } = txRecorder();
    const $transaction = vi.fn(async (fn: any, _opts: any) => fn(tx));
    const service = buildIdentity({ $transaction });

    const out = await ensure(service, 'user-1', "Ada's Workspace");

    expect(out.isNewBusiness).toBe(true);
    expect(calls).toEqual(['business.findFirst', 'business.create', 'membership.upsert']);
    // The isolation level is the entire mechanism; assert it explicitly.
    expect($transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
  });

  it('reuses the existing bootstrap Business instead of creating a second one', async () => {
    const { tx, calls } = txRecorder();
    tx.business.findFirst = vi.fn(async () => {
      calls.push('business.findFirst');
      return { id: 'biz-existing', name: 'Existing' };
    });
    const $transaction = vi.fn(async (fn: any) => fn(tx));
    const service = buildIdentity({ $transaction });

    const out = await ensure(service, 'user-1', 'Ignored Name');

    expect(out.isNewBusiness).toBe(false);
    expect(out.business.id).toBe('biz-existing');
    expect(tx.business.create).not.toHaveBeenCalled();
    expect(calls).toEqual(['business.findFirst', 'membership.upsert']);
  });

  it('retries on a write conflict and converges on the winner’s Business', async () => {
    // Attempt 1 loses the Serializable race. Attempt 2 re-reads and finds the
    // business the winning transaction committed. This is the whole point: the
    // loser must converge, not create a duplicate.
    let attempt = 0;
    const $transaction = vi.fn(async (fn: any) => {
      attempt += 1;
      if (attempt === 1) throw new WriteConflict('could not serialize access');
      const { tx } = txRecorder();
      tx.business.findFirst = vi.fn(async () => ({ id: 'biz-winner', name: 'Winner' }));
      return fn(tx);
    });
    const service = buildIdentity({ $transaction });

    const out = await ensure(service, 'user-1', "Ada's Workspace");

    expect($transaction).toHaveBeenCalledTimes(2);
    expect(out.business.id).toBe('biz-winner');
    expect(out.isNewBusiness).toBe(false);
  });

  it('gives up after the bounded retries rather than falling back to a racy write', async () => {
    // Negative control. A "fallback to non-transactional create" would make this
    // test pass by producing a business — and would reintroduce the duplicate the
    // transaction exists to prevent. Exhaustion must surface as a failure.
    const $transaction = vi.fn(async () => {
      throw new WriteConflict('could not serialize access');
    });
    const service = buildIdentity({ $transaction });

    await expect(ensure(service, 'user-1', 'W')).rejects.toBeInstanceOf(WriteConflict);
    expect($transaction).toHaveBeenCalledTimes(6); // 1 initial + 5 retries
  });

  it('does not retry an unrelated error', async () => {
    const $transaction = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const service = buildIdentity({ $transaction });

    await expect(ensure(service, 'user-1', 'W')).rejects.toThrow(/connection refused/);
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});

// ── Discovery ──────────────────────────────────────────────────────────────

describe('IdentityService.listBusinesses — Membership-first discovery', () => {
  it('matches on Membership as well as ownerId', async () => {
    const findMany = vi.fn(async () => []);
    const service = buildIdentity({ business: { findMany } });

    await service.listBusinesses('user-1');

    const where = findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toEqual([
      { members: { some: { userId: 'user-1' } } },
      { ownerId: 'user-1' },
    ]);
  });

  it('no longer filters on ownerId alone', async () => {
    // The pre-packet predicate was `{ ownerId, deletedAt: null }` with no OR at
    // all, which returned an empty list for every non-owner member.
    const findMany = vi.fn(async () => []);
    const service = buildIdentity({ business: { findMany } });

    await service.listBusinesses('user-1');

    const where = findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBeUndefined();
    expect(Array.isArray(where.OR)).toBe(true);
  });

  it('still refuses an empty userId', async () => {
    const findMany = vi.fn();
    const service = buildIdentity({ business: { findMany } });

    await expect(service.listBusinesses('')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findMany).not.toHaveBeenCalled();
  });
});

// ── Migration classification ───────────────────────────────────────────────

describe('FoundingMembershipService.classify', () => {
  function build(businesses: any[], memberships: any[], users: string[]) {
    return new FoundingMembershipService({
      client: {
        business: { findMany: vi.fn(async () => businesses) },
        membership: { findMany: vi.fn(async () => memberships), upsert: vi.fn() },
        user: { findMany: vi.fn(async () => users.map((id) => ({ id }))) },
      },
    } as never);
  }

  const biz = (id: string, ownerId: string) => ({ id, name: `biz ${id}`, ownerId });

  it('classifies an owner holding OWNER as an exact match', async () => {
    const svc = build([biz('b1', 'u1')], [{ businessId: 'b1', userId: 'u1', role: 'OWNER' }], ['u1']);
    const out = await svc.classify();
    expect(out.rows[0].classification).toBe('exact_owner_membership_match');
    expect(out.counts.exact_owner_membership_match).toBe(1);
  });

  it('classifies a resolvable owner with no Membership as deterministically repairable', async () => {
    const svc = build([biz('b1', 'u1')], [], ['u1']);
    const out = await svc.classify();
    expect(out.rows[0].classification).toBe('missing_founding_membership_with_resolvable_owner');
  });

  it('classifies an owner holding a non-OWNER role as conflicting', async () => {
    const svc = build([biz('b1', 'u1')], [{ businessId: 'b1', userId: 'u1', role: 'STAFF' }], ['u1']);
    const out = await svc.classify();
    expect(out.rows[0].classification).toBe('conflicting_owner_membership');
  });

  it('classifies a different single OWNER holder as conflicting, not repairable', async () => {
    const svc = build([biz('b1', 'u1')], [{ businessId: 'b1', userId: 'u2', role: 'OWNER' }], ['u1']);
    const out = await svc.classify();
    expect(out.rows[0].classification).toBe('conflicting_owner_membership');
  });

  it('classifies several rival OWNERs as ambiguous', async () => {
    const svc = build(
      [biz('b1', 'u1')],
      [
        { businessId: 'b1', userId: 'u2', role: 'OWNER' },
        { businessId: 'b1', userId: 'u3', role: 'OWNER' },
      ],
      ['u1'],
    );
    const out = await svc.classify();
    expect(out.rows[0].classification).toBe('otherwise_ambiguous');
  });

  it('classifies an ownerId that names no User, including the empty string', async () => {
    const svc = build([biz('b1', 'ghost'), biz('b2', '')], [], []);
    const out = await svc.classify();
    expect(out.rows.map((r) => r.classification)).toEqual([
      'ownerId_unresolvable_to_User',
      'ownerId_unresolvable_to_User',
    ]);
    expect(out.rows[1].detail).toMatch(/empty/);
  });
});

describe('FoundingMembershipService.repairDeterministic', () => {
  function build(businesses: any[], memberships: any[], users: string[]) {
    const upsert = vi.fn(async () => ({ id: 'm' }));
    const svc = new FoundingMembershipService({
      client: {
        business: { findMany: vi.fn(async () => businesses) },
        membership: { findMany: vi.fn(async () => memberships), upsert },
        user: { findMany: vi.fn(async () => users.map((id) => ({ id }))) },
      },
    } as never);
    return { svc, upsert };
  }

  const rows = () => [
    { id: 'b-safe', name: 'safe', ownerId: 'u1' },
    { id: 'b-conflict', name: 'conflict', ownerId: 'u2' },
    { id: 'b-ghost', name: 'ghost', ownerId: 'nobody' },
  ];
  const members = () => [{ businessId: 'b-conflict', userId: 'other', role: 'OWNER' }];

  it('writes nothing unless apply is set', async () => {
    const { svc, upsert } = build(rows(), members(), ['u1', 'u2']);
    const out = await svc.repairDeterministic();
    expect(upsert).not.toHaveBeenCalled();
    expect(out.repaired).toEqual([]);
    expect(out.reportedForExplicitRepair).toHaveLength(2);
  });

  it('repairs only the deterministic class and never guesses the rest', async () => {
    const { svc, upsert } = build(rows(), members(), ['u1', 'u2']);

    const out = await svc.repairDeterministic({ apply: true });

    expect(out.repaired).toEqual(['b-safe']);
    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0][0] as any;
    expect(args.create).toEqual({ userId: 'u1', businessId: 'b-safe', role: 'OWNER' });
    // Never rewrite a role that already exists — convergence, not correction.
    expect(args.update).toEqual({});
    // The conflicting and unresolvable rows are reported, untouched.
    expect(out.reportedForExplicitRepair.map((r) => r.businessId).sort()).toEqual([
      'b-conflict',
      'b-ghost',
    ]);
    expect(out.failed).toEqual([]);
  });

  it('reports a row whose write fails instead of aborting the batch', async () => {
    // Classification and repair are separate reads. A business can vanish, or
    // its owner can be deleted, in the gap. Over a large estate one such row
    // must not take every later repair down with it.
    const twoSafe = [
      { id: 'b-first', name: 'first', ownerId: 'u1' },
      { id: 'b-second', name: 'second', ownerId: 'u2' },
    ];
    const upsert = vi
      .fn()
      .mockRejectedValueOnce(new Error('FK violation: user was deleted'))
      .mockResolvedValueOnce({ id: 'm' });
    const svc = new FoundingMembershipService({
      client: {
        business: { findMany: vi.fn(async () => twoSafe) },
        membership: { findMany: vi.fn(async () => []), upsert },
        user: { findMany: vi.fn(async () => [{ id: 'u1' }, { id: 'u2' }]) },
      },
    } as never);

    const out = await svc.repairDeterministic({ apply: true });

    expect(out.repaired).toEqual(['b-second']);
    expect(out.failed).toEqual([
      { businessId: 'b-first', reason: 'FK violation: user was deleted' },
    ]);
    expect(upsert).toHaveBeenCalledTimes(2); // it kept going
  });
});
