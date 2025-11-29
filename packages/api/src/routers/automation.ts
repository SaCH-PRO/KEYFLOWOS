import { protectedProcedure, router } from '../trpc';
import { z } from 'zod';

export const automationRouter = router({
  health: protectedProcedure.query(({ ctx }) => ({
    status: 'ok',
    module: 'automation',
    user: ctx.user,
  })),
  listPlaybooks: protectedProcedure
    .input(z.object({ businessId: z.string() }))
    .query(({ input }) => ({
      businessId: input.businessId,
      playbooks: [],
    })),
});
