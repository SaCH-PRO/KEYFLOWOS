import { publicProcedure, router } from '../trpc';
import { z } from 'zod';

export const siteRouter = router({
  health: publicProcedure.query(() => ({ status: 'ok', module: 'site' })),
  getSite: publicProcedure
    .input(z.object({ businessId: z.string() }))
    .query(({ input }) => ({
      businessId: input.businessId,
      site: null,
    })),
});
