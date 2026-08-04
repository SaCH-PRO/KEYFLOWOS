/**
 * Cross-tenant privilege escalation, reachable with two legitimate API calls.
 *
 * POST /structure/businesses/:businessId/assignments runs behind AuthGuard,
 * BusinessGuard and ModuleScopeGuard('team','write'), and CreateAssignmentDto
 * validates every field. Both of those check something real, which is what made
 * the hole invisible: the guards prove the CALLER belongs to :businessId, and
 * the DTO proves the ids are STRINGS. Nothing proved the ids belong to the
 * business.
 *
 * createAssignment ends with:
 *
 *   membership.update({ where: { id: dto.membershipId }, data: {
 *     permissionScopes:  jobRole.permissions,
 *     maxApprovalTier:   jobRole.defaultApprovalTier } })
 *
 * — a write to a caller-named membership, carrying a caller-named job role's
 * permissions. The exploit needs no privileged access anywhere:
 *
 *   1. In a business you own, create a JobRole with defaultApprovalTier 4 and
 *      whatever permissions you like. Entirely legitimate; it is your org.
 *   2. POST an assignment naming that jobRoleId and the membershipId of your
 *      own low-privilege account in someone else's business.
 *
 * Your membership there is now tier 4 with your chosen scopes. The same call
 * rewrites any OTHER user's membership just as happily.
 *
 * This is the shape recorded in memory as "decorating a DTO can open a
 * cross-tenant write" — the validation layer makes the endpoint look guarded
 * while the only check that matters is absent.
 */
import { describe, it, expect, vi } from 'vitest';
import { StructureService } from './structure.service';

const A = 'biz_attacker';
const B = 'biz_victim';

/** Ids that exist, and the business each belongs to. */
const MEMBERSHIPS = [
  { id: 'mem_attacker_a', businessId: A, userId: 'user_mal' },
  { id: 'mem_attacker_b', businessId: B, userId: 'user_mal' },
];
const JOB_ROLES = [
  { id: 'role_tier4_a', businessId: A },
  { id: 'role_normal_b', businessId: B },
];
const ORG_UNITS = [
  { id: 'unit_a', businessId: A },
  { id: 'unit_b', businessId: B },
];
const ASSIGNMENTS = [
  { id: 'asg_a', businessId: A, membershipId: 'mem_attacker_a' },
  { id: 'asg_b', businessId: B, membershipId: 'mem_attacker_b' },
];

function makeService() {
  const membershipUpdates: any[] = [];
  const created: any[] = [];

  const scoped = <T extends { id: string; businessId: string }>(rows: T[]) => ({
    findFirst: vi.fn(async ({ where }: any) =>
      rows.find((r) => r.id === where.id && r.businessId === where.businessId) ?? null,
    ),
  });

  const prisma = {
    client: {
      membership: {
        ...scoped(MEMBERSHIPS),
        update: vi.fn(async (args: any) => {
          membershipUpdates.push(args);
          return {};
        }),
      },
      jobRole: scoped(JOB_ROLES),
      orgUnit: scoped(ORG_UNITS),
      orgAssignment: {
        ...scoped(ASSIGNMENTS),
        create: vi.fn(async (args: any) => {
          created.push(args);
          return {
            id: 'asg_new',
            ...args.data,
            jobRole: { permissions: { everything: 'admin' }, defaultApprovalTier: 4 },
          };
        }),
      },
    },
  };

  return { service: new StructureService(prisma as never), membershipUpdates, created };
}

/** The attack, verbatim: caller is in A, membership named is in B. */
const CROSS_TENANT = {
  membershipId: 'mem_attacker_b',
  userId: 'user_mal',
  orgUnitId: 'unit_a',
  jobRoleId: 'role_tier4_a',
};

describe('an assignment cannot name another business\'s membership', () => {
  it('rejects the escalation instead of performing it', async () => {
    const { service } = makeService();

    await expect(service.createAssignment(A, CROSS_TENANT as never)).rejects.toThrow(
      /Membership not found/,
    );
  });

  it('writes no permissions when it rejects', async () => {
    // The assertion that matters. Throwing after the membership.update would
    // return an error to the attacker and leave the escalation in place.
    const { service, membershipUpdates } = makeService();

    await service.createAssignment(A, CROSS_TENANT as never).catch(() => undefined);

    expect(membershipUpdates).toEqual([]);
  });

  it('creates no assignment row either', async () => {
    const { service, created } = makeService();

    await service.createAssignment(A, CROSS_TENANT as never).catch(() => undefined);

    expect(created).toEqual([]);
  });
});

describe('every other id in the body is checked too', () => {
  it('rejects a job role from another business', async () => {
    // The job role supplies the permissions that get written, so an unchecked
    // jobRoleId is an escalation route on its own — against your own membership,
    // with someone else's tier.
    const { service } = makeService();

    await expect(
      service.createAssignment(B, {
        membershipId: 'mem_attacker_b',
        userId: 'user_mal',
        orgUnitId: 'unit_b',
        jobRoleId: 'role_tier4_a',
      } as never),
    ).rejects.toThrow(/Job role not found/);
  });

  it('rejects an org unit from another business', async () => {
    const { service } = makeService();

    await expect(
      service.createAssignment(B, {
        membershipId: 'mem_attacker_b',
        userId: 'user_mal',
        orgUnitId: 'unit_a',
      } as never),
    ).rejects.toThrow(/Org unit not found/);
  });

  it('rejects a reporting line from another business', async () => {
    const { service } = makeService();

    await expect(
      service.createAssignment(B, {
        membershipId: 'mem_attacker_b',
        userId: 'user_mal',
        orgUnitId: 'unit_b',
        reportsToId: 'asg_a',
      } as never),
    ).rejects.toThrow(/Reporting line not found/);
  });

  it('rejects a userId that does not match the membership', async () => {
    // OrgAssignment.userId is denormalised "for quick lookups", so a mismatch
    // silently files one person's assignment under another — and every read
    // keyed on userId then answers with it.
    const { service } = makeService();

    await expect(
      service.createAssignment(B, {
        membershipId: 'mem_attacker_b',
        userId: 'user_someone_else',
        orgUnitId: 'unit_b',
      } as never),
    ).rejects.toThrow(/does not belong to that membership/);
  });
});

describe('the legitimate case still works', () => {
  it('accepts an assignment whose ids all belong to the business', async () => {
    // A tenant check that rejects everything is not a fix.
    const { service, membershipUpdates } = makeService();

    const result = await service.createAssignment(B, {
      membershipId: 'mem_attacker_b',
      userId: 'user_mal',
      orgUnitId: 'unit_b',
      jobRoleId: 'role_normal_b',
    } as never);

    expect(result.id).toBe('asg_new');
    expect(membershipUpdates).toHaveLength(1);
    expect(membershipUpdates[0].where.id).toBe('mem_attacker_b');
  });

  it('still syncs the job role permissions it was asked to', async () => {
    const { service, membershipUpdates } = makeService();

    await service.createAssignment(B, {
      membershipId: 'mem_attacker_b',
      userId: 'user_mal',
      orgUnitId: 'unit_b',
      jobRoleId: 'role_normal_b',
    } as never);

    expect(membershipUpdates[0].data).toMatchObject({ maxApprovalTier: 4 });
  });
});
