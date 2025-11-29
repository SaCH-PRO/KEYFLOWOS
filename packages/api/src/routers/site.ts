import { protectedProcedure, router } from '../trpc';
import { z } from 'zod';

export const siteRouter = router({
  health: protectedProcedure.query(({ ctx }) => ({
    status: 'ok',
    module: 'site',
    user: ctx.user,
  })),
  getSite: protectedProcedure
    .input(z.object({ businessId: z.string() }))
    .query(({ input, ctx }) =>
      ctx.db.site.findFirst({
        where: { businessId: input.businessId, deletedAt: null },
      }),
    ),
});
