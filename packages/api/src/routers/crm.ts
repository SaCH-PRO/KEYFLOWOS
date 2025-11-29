import { publicProcedure, router } from '../trpc';
import { z } from 'zod';

export const crmRouter = router({
  health: publicProcedure.query(() => ({ status: 'ok', module: 'crm' })),
  listContacts: publicProcedure
    .input(z.object({ businessId: z.string().optional() }).optional())
    .query(() => ({
      contacts: [],
    })),
});
