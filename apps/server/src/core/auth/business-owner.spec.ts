/**
 * W11-OWNER-HELPER-D11 — the one owner rule (owner rulings D-11, D-104, D-116,
 * D-125): the owner of a business is a member holding an OWNER membership of
 * that business. A co-owner holding OWNER is the owner; Business.ownerId grants
 * nothing on its own, so the rule never reads the Business row.
 *
 * isBusinessOwnerMember(db, businessId, userId) is the helper every D-11 owner
 * check calls (src/core/config/d11-owner-writes.spec.ts, D11W-04, pins that);
 * the SUPER_ADMIN bypass stays at each call site. These cases pin the helper
 * on a fake client: the real-database half is the D-11 suites
 * (test/owner-role-profile, owner-role-connections, d11-sibling-writes,
 * d11-genesis-templates, d11-finance-settings, whatsapp-config-authority,
 * identity-business-config), which run every caller through its HTTP route.
 */
import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { assertBusinessOwnerMember, isBusinessOwnerMember, BYOK_OWNER_ONLY } from './business-owner';

const BIZ = 'biz_route';
const OTHER = 'biz_other';

/**
 * A client holding memberships keyed `<userId>@<businessId>`. `business` is a
 * delegate the helper must never touch: every method throws, and each is a spy.
 */
function makeDb(memberships: Record<string, string>) {
  const refuse = () => vi.fn(async () => { throw new Error('the owner rule read the Business row'); });
  const db = {
    membership: {
      findUnique: vi.fn(async (args: { where: { userId_businessId: { userId: string; businessId: string } }; select?: unknown }) => {
        const { userId, businessId } = args.where.userId_businessId;
        const role = memberships[`${userId}@${businessId}`];
        return role ? { role } : null;
      }),
    },
    business: { findFirst: refuse(), findUnique: refuse(), findMany: refuse(), count: refuse() },
  };
  return db;
}

describe('isBusinessOwnerMember: an OWNER membership of the named business, read from the membership row alone (D-11, D-104, D-116, D-125)', () => {
  it('[BOM-01] an OWNER membership of the business is the owner', async () => {
    const db = makeDb({ [`owner@${BIZ}`]: 'OWNER' });
    await expect(isBusinessOwnerMember(db as never, BIZ, 'owner')).resolves.toBe(true);
  });

  it('[BOM-02] a co-owner (an OWNER membership, not the recorded owner) is the owner: the rule has no Business.ownerId arm', async () => {
    const db = makeDb({ [`co_owner@${BIZ}`]: 'OWNER' });
    await expect(isBusinessOwnerMember(db as never, BIZ, 'co_owner')).resolves.toBe(true);
    for (const fn of Object.values(db.business)) expect(fn).not.toHaveBeenCalled();
  });

  it('[BOM-03] ADMIN, STAFF and no membership are not the owner, whatever else is recorded about them', async () => {
    const db = makeDb({ [`admin@${BIZ}`]: 'ADMIN', [`staff@${BIZ}`]: 'STAFF', [`stranger@${OTHER}`]: 'OWNER' });
    await expect(isBusinessOwnerMember(db as never, BIZ, 'admin')).resolves.toBe(false);
    await expect(isBusinessOwnerMember(db as never, BIZ, 'staff')).resolves.toBe(false);
    await expect(isBusinessOwnerMember(db as never, BIZ, 'nobody')).resolves.toBe(false);
  });

  it('[BOM-04] an empty or missing userId is not the owner, and nothing is read for it', async () => {
    const db = makeDb({ [`@${BIZ}`]: 'OWNER' });
    for (const userId of ['', undefined, null]) {
      await expect(isBusinessOwnerMember(db as never, BIZ, userId as never), String(userId)).resolves.toBe(false);
    }
    expect(db.membership.findUnique).not.toHaveBeenCalled();
  });

  it('[BOM-05] the Business row is never read: no business delegate method is called, for an owner or anyone else', async () => {
    const db = makeDb({ [`owner@${BIZ}`]: 'OWNER', [`staff@${BIZ}`]: 'STAFF' });
    for (const userId of ['owner', 'staff', 'nobody', '']) await isBusinessOwnerMember(db as never, BIZ, userId);
    for (const [name, fn] of Object.entries(db.business)) expect(fn, `business.${name}`).not.toHaveBeenCalled();
    // A client without a business delegate at all (a narrowed transaction client) works too.
    const narrow = { membership: db.membership };
    await expect(isBusinessOwnerMember(narrow as never, BIZ, 'owner')).resolves.toBe(true);
  });

  it("[BOM-06] the compound key carries the route's business: owning another business does not make a member the owner of this one", async () => {
    const db = makeDb({ [`staff_owner@${OTHER}`]: 'OWNER', [`staff_owner@${BIZ}`]: 'STAFF' });
    await expect(isBusinessOwnerMember(db as never, BIZ, 'staff_owner')).resolves.toBe(false);
    await expect(isBusinessOwnerMember(db as never, OTHER, 'staff_owner')).resolves.toBe(true);
    expect(db.membership.findUnique).toHaveBeenNthCalledWith(1, {
      where: { userId_businessId: { userId: 'staff_owner', businessId: BIZ } },
      select: { role: true },
    });
    expect(db.membership.findUnique).toHaveBeenNthCalledWith(2, {
      where: { userId_businessId: { userId: 'staff_owner', businessId: OTHER } },
      select: { role: true },
    });
  });

  it('[BOM-07] the helper grants no platform bypass: a SUPER_ADMIN is the owner only through an OWNER membership (the bypass stays at each call site)', async () => {
    const db = makeDb({});
    // The helper takes a user id, not an actor, so a platform role cannot reach it.
    expect(isBusinessOwnerMember.length).toBe(3);
    await expect(isBusinessOwnerMember(db as never, BIZ, 'platform_admin')).resolves.toBe(false);
  });
});

describe('assertBusinessOwnerMember (the BYOK owner rule, SWEEP-P0-FOLLOWUP byokkeys) answers as before, on the one owner rule', () => {
  const prismaOf = (db: ReturnType<typeof makeDb>) => ({ client: db }) as never;

  it('[BOM-08] no actor is 401; a SUPER_ADMIN passes with no read; the OWNER membership passes; ADMIN, STAFF and no membership are 403 with the refusal given; the Business row is never read', async () => {
    const db = makeDb({ [`owner@${BIZ}`]: 'OWNER', [`admin@${BIZ}`]: 'ADMIN', [`staff@${BIZ}`]: 'STAFF', [`staff@${OTHER}`]: 'OWNER' });
    await expect(assertBusinessOwnerMember(prismaOf(db), BIZ, undefined, BYOK_OWNER_ONLY)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(assertBusinessOwnerMember(prismaOf(db), BIZ, { role: 'USER' }, BYOK_OWNER_ONLY)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(assertBusinessOwnerMember(prismaOf(db), BIZ, { id: 'platform', role: 'SUPER_ADMIN' }, BYOK_OWNER_ONLY)).resolves.toBeUndefined();
    expect(db.membership.findUnique).not.toHaveBeenCalled();
    await expect(assertBusinessOwnerMember(prismaOf(db), BIZ, { id: 'owner', role: 'USER' }, BYOK_OWNER_ONLY)).resolves.toBeUndefined();
    for (const id of ['admin', 'staff', 'nobody']) {
      const err = await assertBusinessOwnerMember(prismaOf(db), BIZ, { id, role: 'USER' }, BYOK_OWNER_ONLY).then(() => null, (e) => e);
      expect(err, id).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse(), id).toEqual(BYOK_OWNER_ONLY);
    }
    for (const [name, fn] of Object.entries(db.business)) expect(fn, `business.${name}`).not.toHaveBeenCalled();
  });
});
