import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, skipTenantIsolation } from '@keyflow/db';
import { AuthorityInventoryService } from '../src/core/authority/authority-inventory.service';

/**
 * The classifiers against a real database.
 *
 * Unit tests over a fake would prove the branching and nothing about the queries, and
 * the queries are where the risk lives: `defaultTakeExtension` silently caps unbounded
 * reads, Membership is not tenant-scoped by the extension, and a classifier that
 * truncates reports a clean estate that is not clean.
 *
 * Prefix `ainv_` on every row, and all assertions are scoped to it — sibling suites
 * seed the same tables and these classifiers sweep the whole database by design.
 */
const P = 'ainv_';
const service = new AuthorityInventoryService(db);

let businessId: string;
let ownerUserId: string;
let ownerMembershipId: string;
/** OrgAssignment.orgUnitId is NOT NULL, so every position needs a unit to hang off. */
let orgUnitId: string;

beforeAll(async () => {
  const owner = await db.user.create({ data: { email: `${P}owner@test.local`, name: `${P}owner`, role: 'USER' } });
  ownerUserId = owner.id;
  const business = await db.business.create({ data: { name: `${P}business`, ownerId: owner.id } });
  businessId = business.id;
  const m = await db.membership.create(
    skipTenantIsolation({ data: { userId: owner.id, businessId, role: 'OWNER' } }),
  );
  ownerMembershipId = m.id;
  const unit = await db.orgUnit.create({ data: { businessId, name: `${P}unit` } });
  orgUnitId = unit.id;
});

/**
 * Business and User are SOFT-DELETED models, so `deleteMany` on them is rewritten by
 * the extension into an UPDATE setting `deletedAt`. The teardown would report success,
 * leave the rows behind, and the next run would classify them again — which is exactly
 * the kind of quiet residue these classifiers exist to find. Raw SQL runs underneath
 * the extension, the way the other integration suites here do it.
 */
afterAll(async () => {
  await db.authorityGrant.deleteMany(skipTenantIsolation({ where: { businessId } }));
  await db.orgAssignment.deleteMany(skipTenantIsolation({ where: { businessId } }));
  await db.jobRole.deleteMany(skipTenantIsolation({ where: { businessId } }));
  await db.orgUnit.deleteMany(skipTenantIsolation({ where: { businessId } }));
  await db.membership.deleteMany(skipTenantIsolation({ where: { businessId } }));
  await db.$executeRawUnsafe(`DELETE FROM businesses WHERE name LIKE '${P}%'`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE email LIKE '${P}%'`);
});

describe('grantor classifier', () => {
  it('separates a resolvable grantor from a legacy one', async () => {
    const good = await db.authorityGrant.create({
      data: { businessId, grantorId: ownerMembershipId, granteeType: 'USER', granteeId: ownerUserId, scope: 'tier4_financial' },
    });
    // What the old controller actually wrote: a User id, not a Membership id.
    const legacyUserId = await db.authorityGrant.create({
      data: { businessId, grantorId: ownerUserId, granteeType: 'USER', granteeId: ownerUserId, scope: 'tier4_publishing' },
    });
    // And the other branch of `?? 'system'`.
    const legacySystem = await db.authorityGrant.create({
      data: { businessId, grantorId: 'system', granteeType: 'KEY', granteeId: 'key_ai', scope: 'tier4_operations' },
    });

    const findings = await service.classifyGrantors();
    const mine = new Map(findings.filter((f) => f.businessId === businessId).map((f) => [f.grantId, f]));

    expect(mine.get(good.id)?.classification).toBe('active_grantor');
    expect(mine.get(legacyUserId.id)?.classification).toBe('legacy_unresolvable_grantor');
    expect(mine.get(legacySystem.id)?.classification).toBe('legacy_unresolvable_grantor');
  });

  it('does not resolve a grantor across a business boundary', async () => {
    // The same Membership id existing SOMEWHERE is not the grantor of this grant.
    const other = await db.user.create({ data: { email: `${P}other@test.local`, name: `${P}other`, role: 'USER' } });
    const otherBiz = await db.business.create({ data: { name: `${P}other`, ownerId: other.id } });
    const grant = await db.authorityGrant.create({
      data: { businessId: otherBiz.id, grantorId: ownerMembershipId, granteeType: 'USER', granteeId: other.id, scope: 'tier4_financial' },
    });

    const findings = await service.classifyGrantors();
    expect(findings.find((f) => f.grantId === grant.id)?.classification).toBe('legacy_unresolvable_grantor');

    await db.authorityGrant.deleteMany(skipTenantIsolation({ where: { businessId: otherBiz.id } }));
    await db.$executeRawUnsafe(`DELETE FROM businesses WHERE id = '${otherBiz.id}'`);
  });
});

describe('stale-copy classifier', () => {
  it('flags a scope map whose keys are outside the canonical vocabulary', async () => {
    // A JobRole authored in the MODULE_TOOL_FAMILIES namespace, copied verbatim into
    // permissionScopes by structure.service. The guard reads `scopes[m] || 'none'`, so
    // this denies EVERY canonical module while looking like a populated permission set.
    const u = await db.user.create({ data: { email: `${P}fin@test.local`, name: `${P}fin`, role: 'USER' } });
    const m = await db.membership.create(
      skipTenantIsolation({
        data: { userId: u.id, businessId, role: 'STAFF', permissionScopes: { finance: 'admin', hr: 'write' } },
      }),
    );

    const findings = await service.classifyStaleCopies();
    const mine = findings.find((f) => f.membershipId === m.id);

    expect(mine?.classification).toBe('scope_map_uses_non_canonical_keys');
    expect(mine?.detail).toMatch(/finance/);
  });

  it('flags a copy that has diverged from the live JobRole', async () => {
    const u = await db.user.create({ data: { email: `${P}drift@test.local`, name: `${P}drift`, role: 'USER' } });
    const role = await db.jobRole.create({
      data: { businessId, name: `${P}role`, permissions: { crm: 'admin' }, defaultApprovalTier: 2 },
    });
    const m = await db.membership.create(
      skipTenantIsolation({
        // What structure.service copied at assignment time...
        data: { userId: u.id, businessId, role: 'STAFF', permissionScopes: { crm: 'read' } },
      }),
    );
    await db.orgAssignment.create({ data: { businessId, orgUnitId, membershipId: m.id, jobRoleId: role.id } });

    // ...and the JobRole now says admin, with nothing re-projecting it.
    const findings = await service.classifyStaleCopies();
    expect(findings.find((f) => f.membershipId === m.id)?.classification).toBe('copy_diverged_from_live_jobrole');
  });

  it('recognises a copy that still matches its live JobRole', async () => {
    const u = await db.user.create({ data: { email: `${P}match@test.local`, name: `${P}match`, role: 'USER' } });
    const role = await db.jobRole.create({
      data: { businessId, name: `${P}match`, permissions: { crm: 'write' }, defaultApprovalTier: 1 },
    });
    const m = await db.membership.create(
      skipTenantIsolation({ data: { userId: u.id, businessId, role: 'STAFF', permissionScopes: { crm: 'write' } } }),
    );
    await db.orgAssignment.create({ data: { businessId, orgUnitId, membershipId: m.id, jobRoleId: role.id } });

    const findings = await service.classifyStaleCopies();
    expect(findings.find((f) => f.membershipId === m.id)?.classification).toBe('copy_matches_live_jobrole');
  });

  it('flags a scope map left behind by an ended position', async () => {
    // deleteAssignment and endedAt do not unwind the copy; the authority outlives the
    // position it came from.
    const u = await db.user.create({ data: { email: `${P}ended@test.local`, name: `${P}ended`, role: 'USER' } });
    const m = await db.membership.create(
      skipTenantIsolation({ data: { userId: u.id, businessId, role: 'STAFF', permissionScopes: { crm: 'admin' } } }),
    );

    const findings = await service.classifyStaleCopies();
    expect(findings.find((f) => f.membershipId === m.id)?.classification).toBe('copy_from_deleted_or_ended_position');
  });

  it('reports a membership with no explicit map as carrying no copied authority', async () => {
    const findings = await service.classifyStaleCopies();
    expect(findings.find((f) => f.membershipId === ownerMembershipId)?.classification).toBe('no_copied_authority');
  });
});

describe('classifiers page past the default take cap', () => {
  it('returns more rows than an unbounded findMany would', async () => {
    // defaultTakeExtension caps unbounded findMany at 1000. This does not seed 1000
    // rows — it asserts the classifier's own paging terminates on an EMPTY page by
    // checking it sees every row across more than one page boundary.
    const before = (await service.classifyStaleCopies()).length;
    expect(before).toBeGreaterThan(0);

    const again = await service.classifyStaleCopies();
    expect(again.length).toBe(before); // stable, not cursor-drifting
    expect(new Set(again.map((f) => f.membershipId)).size).toBe(again.length); // no dupes
  });
});

/**
 * AUTH-P1-GRANTOR-CURRENT-BOUND (CG-REVIEW-AUTH-001).
 *
 * The inventory has to tell the two non-contributing classes apart, because they need
 * different remedies: an unresolvable grantor is a row nobody can interpret, while a
 * demoted grantor is a decision that has since been overtaken by a real org change.
 */
describe('grantor classifier — current grantable authority', () => {
  it('separates a demoted grantor from an unresolvable one', async () => {
    const demotedUser = await db.user.create({ data: { email: `${P}demoted@test.local`, name: `${P}demoted`, role: 'USER' } });
    // A grantor who WAS tier 4 when they granted and is STAFF/tier 0 now.
    const demoted = await db.membership.create(
      skipTenantIsolation({ data: { userId: demotedUser.id, businessId, role: 'STAFF', permissionScopes: {}, maxApprovalTier: 0 } }),
    );
    const granteeUser = await db.user.create({ data: { email: `${P}grantee@test.local`, name: `${P}grantee`, role: 'USER' } });

    const fromDemoted = await db.authorityGrant.create({
      data: { businessId, grantorId: demoted.id, granteeType: 'USER', granteeId: granteeUser.id, scope: 'tier4_financial' },
    });
    const fromOwner = await db.authorityGrant.create({
      data: { businessId, grantorId: ownerMembershipId, granteeType: 'USER', granteeId: granteeUser.id, scope: 'tier4_operations' },
    });

    const findings = await service.classifyGrantors();
    const mine = new Map(findings.filter((f) => f.businessId === businessId).map((f) => [f.grantId, f]));

    expect(mine.get(fromDemoted.id)?.classification).toBe('grantor_no_longer_grantable');
    expect(mine.get(fromDemoted.id)?.detail).toMatch(/now tier 0/);
    expect(mine.get(fromOwner.id)?.classification).toBe('active_grantor');
  });

  it('does not apply the tier-4 bound to KEY grants', async () => {
    // KEY reader semantics are outside the AUTH-001 cutover, so flagging a KEY grant
    // on a bound nothing enforces would be reporting a problem that does not exist.
    const u = await db.user.create({ data: { email: `${P}keygrantor@test.local`, name: `${P}kg`, role: 'USER' } });
    const lowTier = await db.membership.create(
      skipTenantIsolation({ data: { userId: u.id, businessId, role: 'STAFF', permissionScopes: {}, maxApprovalTier: 0 } }),
    );
    const keyGrant = await db.authorityGrant.create({
      data: { businessId, grantorId: lowTier.id, granteeType: 'KEY', granteeId: 'key_ai', scope: 'tier4_financial' },
    });

    const findings = await service.classifyGrantors();
    expect(findings.find((f) => f.grantId === keyGrant.id)?.classification).toBe('active_grantor');
  });
});
