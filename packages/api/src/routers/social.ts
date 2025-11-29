import { publicProcedure, router } from '../trpc';
import { z } from 'zod';

export const socialRouter = router({
  health: publicProcedure.query(() => ({ status: 'ok', module: 'social' })),
  listConnections: publicProcedure
    .input(z.object({ businessId: z.string() }))
    .query(({ input }) => ({
      businessId: input.businessId,
      connections: [],
    })),
});
