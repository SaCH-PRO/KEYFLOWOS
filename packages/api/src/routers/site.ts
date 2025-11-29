import { protectedProcedure, router } from '../trpc';
import { z } from 'zod';
import { assertBusinessAccess } from '../lib/access';

export const siteRouter = router({
  health: protectedProcedure.query(({ ctx }) => ({
    status: 'ok',
    module: 'site',
    user: ctx.user,
  })),
  getSite: protectedProcedure
    .input(z.object({ businessId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      return ctx.db.site.findFirst({
        where: { businessId: input.businessId, deletedAt: null },
      });
    }),
});
