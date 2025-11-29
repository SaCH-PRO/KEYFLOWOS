import { protectedProcedure, router } from '../trpc';
import { z } from 'zod';

export const bookingsRouter = router({
  health: protectedProcedure.query(({ ctx }) => ({
    status: 'ok',
    module: 'bookings',
    user: ctx.user,
  })),
  listBookings: protectedProcedure
    .input(z.object({ businessId: z.string() }))
    .query(({ input, ctx }) =>
      ctx.db.booking.findMany({
        where: { businessId: input.businessId, deletedAt: null },
        orderBy: { startTime: 'desc' },
      }),
    ),
  createBooking: protectedProcedure
    .input(
      z.object({
        businessId: z.string(),
        contactId: z.string(),
        serviceId: z.string(),
        staffId: z.string(),
        startTime: z.coerce.date(),
        endTime: z.coerce.date(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const booking = await ctx.db.booking.create({
        data: {
          businessId: input.businessId,
          contactId: input.contactId,
          serviceId: input.serviceId,
          staffId: input.staffId,
          startTime: input.startTime,
          endTime: input.endTime,
        },
      });
      ctx.eventBus.emit('booking.created', { bookingId: booking.id, businessId: booking.businessId });
      return booking;
    }),
});
