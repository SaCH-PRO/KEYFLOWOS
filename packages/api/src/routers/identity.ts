import { publicProcedure, router } from '../trpc';
import { z } from 'zod';

export const identityRouter = router({
  health: publicProcedure.query(() => ({ status: 'ok', module: 'identity' })),
  createBusiness: publicProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(({ input }) => ({
      message: 'stub-create-business',
      data: { id: 'biz_123', name: input.name },
    })),
});
