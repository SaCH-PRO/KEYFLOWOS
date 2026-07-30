import { AppContext } from '../trpc';

export async function assertBusinessAccess(ctx: AppContext, businessId: string) {
  if (!ctx.user?.id) {
    throw new Error('Unauthorized');
  }
  const business = await ctx.db.business.findFirst({
    where: {
      id: businessId,
      OR: [
        { ownerId: ctx.user.id },
        { members: { some: { userId: ctx.user.id } } },
      ],
    },
  });
  if (!business) {
    throw new Error('Forbidden');
  }
  return business;
}

/**
 * Assert the caller may act on the current business context in one of `allowedRoles`.
 *
 * The effective role is resolved from the database, never from `ctx.business.role`.
 * That field is populated by guards upstream, and treating it as authoritative would
 * make role enforcement only as trustworthy as whatever set it. The business owner is
 * always treated as OWNER regardless of any Membership row.
 *
 * @param allowedRoles Membership roles permitted here, e.g. ['OWNER', 'ADMIN'].
 *                     Membership.role is one of OWNER | ADMIN | STAFF.
 * @throws Unauthorized when unauthenticated, Forbidden when the caller has no access
 *         to the business or holds a role outside `allowedRoles`.
 */
export async function assertBusinessRole(
  ctx: AppContext,
  allowedRoles: string[],
): Promise<{ businessId: string; userId: string; role: string }> {
  const userId = ctx.user?.id;
  if (!userId) {
    throw new Error('Unauthorized');
  }

  const businessId = ctx.business?.id;
  if (!businessId) {
    throw new Error('Forbidden');
  }

  const business = await ctx.db.business.findFirst({
    where: {
      id: businessId,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    select: {
      id: true,
      ownerId: true,
      members: { where: { userId }, select: { role: true }, take: 1 },
    },
  });

  if (!business) {
    throw new Error('Forbidden');
  }

  const role = business.ownerId === userId ? 'OWNER' : business.members[0]?.role;
  if (!role || !allowedRoles.includes(role)) {
    throw new Error('Forbidden');
  }

  return { businessId: business.id, userId, role };
}
