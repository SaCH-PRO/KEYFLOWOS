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
