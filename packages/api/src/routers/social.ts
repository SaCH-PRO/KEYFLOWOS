import { protectedProcedure, router } from '../trpc';
import type { AnyRouter } from '@trpc/server';
import { z } from 'zod';

export const socialRouter: AnyRouter = router({
  health: protectedProcedure.query(({ ctx }) => ({
    status: 'ok',
    module: 'social',
    user: ctx.user,
  })),
  listConnections: protectedProcedure
    .input(z.object({ businessId: z.string() }))
    .query(({ input, ctx }) =>
      ctx.db.socialConnection.findMany({
        where: { businessId: input.businessId },
      }),
    ),
});
