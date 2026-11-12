import type { Business } from '@prisma/client';
import { AppContext } from '../trpc';

/**
 * The return type is annotated rather than inferred.
 *
 * `ctx.db` is a PrismaClient with several chained `$extends`, so the inferred
 * result of findFirst can only be named by pointing at
 * `packages/db/node_modules/@prisma/client/runtime/library` — a path that does
 * not exist for consumers of this package. tsc rejects that with TS2742
 * ("cannot be named without a reference to ... This is likely not portable"),
 * which broke `pnpm --filter @keyflow/api build` and therefore any deployment
 * that builds the workspace.
 *
 * `Business` is the model type and is what callers actually use.
 *
 * Owner ruling D-104 (W11-TRPC-MEMBERSHIP): Membership is the single rule for
 * business access. The caller is admitted when they hold a Membership of this
 * business, in any role; an owner recorded only as Business.ownerId, with no
 * Membership row, is refused, as BusinessGuard refuses them on REST. The former
 * `ownerId` arm admitted exactly that owner. no-owner-arm.spec.ts keeps it out.
 */
export async function assertBusinessAccess(
  ctx: AppContext,
  businessId: string,
): Promise<Business> {
  if (!ctx.user?.id) {
    throw new Error('Unauthorized');
  }
  const business = await ctx.db.business.findFirst({
    where: { id: businessId, members: { some: { userId: ctx.user.id } } },
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
 * make role enforcement only as trustworthy as whatever set it.
 *
 * The role is the caller's Membership role and nothing else (owner rulings D-104,
 * D-116, D-125; W11-TRPC-MEMBERSHIP). The owner is whoever holds an OWNER
 * Membership of this business, so a co-owner (OWNER Membership, not
 * Business.ownerId) resolves OWNER; a recorded owner holding only ADMIN or STAFF
 * resolves that role; a recorded owner with no Membership is Forbidden.
 * Business.ownerId grants nothing on its own and is neither filtered on nor
 * selected here.
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
    where: { id: businessId, members: { some: { userId } } },
    select: {
      id: true,
      members: { where: { userId }, select: { role: true }, take: 1 },
    },
  });

  if (!business) {
    throw new Error('Forbidden');
  }

  // D-116/D-125: the membership role, never a role inferred from Business.ownerId.
  const role = business.members[0]?.role;
  if (!role || !allowedRoles.includes(role)) {
    throw new Error('Forbidden');
  }

  return { businessId: business.id, userId, role };
}
