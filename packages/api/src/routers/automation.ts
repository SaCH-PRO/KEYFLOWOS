import { publicProcedure, router } from '../trpc';
import { z } from 'zod';

export const automationRouter = router({
  health: publicProcedure.query(() => ({ status: 'ok', module: 'automation' })),
  listPlaybooks: publicProcedure
    .input(z.object({ businessId: z.string() }))
    .query(({ input }) => ({
      businessId: input.businessId,
      playbooks: [],
    })),
});
