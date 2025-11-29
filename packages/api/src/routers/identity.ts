import { protectedProcedure, router } from '../trpc';
import { z } from 'zod';

export const identityRouter = router({
  health: protectedProcedure.query(({ ctx }) => ({
    status: 'ok',
    module: 'identity',
    user: ctx.user,
  })),
  listBusinesses: protectedProcedure.query(({ ctx }) => {
    const ownerId = ctx.user?.id;
    return ctx.db.business.findMany({
      where: { ownerId: ownerId ?? undefined, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }),
  createBusiness: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(({ input, ctx }) =>
      ctx.db.business.create({
        data: { name: input.name, ownerId: ctx.user?.id ?? '' },
      }),
    ),
});
