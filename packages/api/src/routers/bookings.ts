import { publicProcedure, router } from '../trpc';
import { z } from 'zod';

export const bookingsRouter = router({
  health: publicProcedure.query(() => ({ status: 'ok', module: 'bookings' })),
  listBookings: publicProcedure
    .input(z.object({ businessId: z.string() }))
    .query(({ input }) => ({
      businessId: input.businessId,
      bookings: [],
    })),
});
