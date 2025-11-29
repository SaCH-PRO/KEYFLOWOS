import { publicProcedure, router } from '../trpc';
import { z } from 'zod';

export const commerceRouter = router({
  health: publicProcedure.query(() => ({ status: 'ok', module: 'commerce' })),
  listProducts: publicProcedure
    .input(z.object({ businessId: z.string() }))
    .query(({ input }) => ({
      businessId: input.businessId,
      products: [],
    })),
});
