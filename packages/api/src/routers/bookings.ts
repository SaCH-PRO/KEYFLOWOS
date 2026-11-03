import { protectedProcedure, router, type AppContext } from '../trpc';
import { TRPCError, type AnyRouter } from '@trpc/server';
import { z } from 'zod';
import { assertBusinessAccess } from '../lib/access';

type Db = AppContext['db'];
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

/**
 * V1-27 (M41, M06): createBooking wrote straight to booking.create, with no
 * overlap check, so an occupied staff slot got a second live booking through
 * /trpc that the in-app and public creates refuse. It now takes the slot the
 * way the server's BookingsService.claimSlot does (V1-16): the calendar's
 * advisory transaction lock, keyed `booking-slot:<business>:<staff, else
 * service>`, then the overlap guard read again inside that transaction, then
 * the write. Same key, so a claim here and a claim on the server serialize on
 * one calendar; same rule, buffer and messages (assertSlotFree in
 * apps/server/src/modules/bookings/bookings.service.ts), so a refusal reads
 * the same whichever door it came through. This package cannot import the
 * server's guard, hence the copy; apps/server/test/booking-slot-writers.
 * integration.test.ts pins the parity.
 */
const SLOT_LOCK_NAMESPACE = 'booking-slot:';
const SLOT_CLAIM_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

type SlotClaim = {
  businessId: string;
  serviceId: string;
  staffId: string;
  start: Date;
  end: Date;
  bufferMins: number | null;
};

async function assertSlotFree(tx: Pick<Tx, 'booking'>, slot: SlotClaim): Promise<void> {
  const bufferMins = slot.bufferMins ?? 0;
  const bufferMs = bufferMins * 60000;
  const clash = await tx.booking.findFirst({
    where: {
      businessId: slot.businessId,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      deletedAt: null,
      startTime: { lt: new Date(slot.end.getTime() + bufferMs) },
      endTime: { gt: new Date(slot.start.getTime() - bufferMs) },
      // With a staff member, that person is the resource being consumed.
      ...(slot.staffId ? { staffId: slot.staffId } : { serviceId: slot.serviceId }),
    },
    select: { id: true },
  });
  if (clash) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        bufferMins > 0
          ? `This time slot is unavailable due to a ${bufferMins}-minute buffer between appointments.`
          : 'That time slot has already been booked. Please choose another.',
    });
  }
}

export const bookingsRouter: AnyRouter = router({
  health: protectedProcedure.query(({ ctx }) => ({
    status: 'ok',
    module: 'bookings',
    user: ctx.user,
  })),
  listBookings: protectedProcedure
    .input(z.object({ businessId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      return ctx.db.booking.findMany({
        where: { businessId: input.businessId, deletedAt: null },
        orderBy: { startTime: 'desc' },
      });
    }),
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
      await assertBusinessAccess(ctx, input.businessId);
      // The in-app create's rules before the claim, with its messages: a
      // window that does not move forward cannot be checked for overlap, and
      // the buffer is the booked service's, in this business.
      if (!(input.endTime.getTime() > input.startTime.getTime())) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'The end time must be after the start time.' });
      }
      const service = await ctx.db.service.findFirst({
        where: { id: input.serviceId, businessId: input.businessId, deletedAt: null },
        select: { bufferMins: true },
      });
      if (!service) throw new TRPCError({ code: 'NOT_FOUND', message: 'Service not found' });

      const slot: SlotClaim = {
        businessId: input.businessId,
        serviceId: input.serviceId,
        staffId: input.staffId,
        start: input.startTime,
        end: input.endTime,
        bufferMins: service.bufferMins,
      };
      const key = `${SLOT_LOCK_NAMESPACE}${slot.businessId}:${slot.staffId || slot.serviceId}`;
      const db: Db = ctx.db;
      const booking = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        await assertSlotFree(tx, slot);
        return tx.booking.create({
          data: {
            businessId: input.businessId,
            contactId: input.contactId,
            serviceId: input.serviceId,
            staffId: input.staffId,
            startTime: input.startTime,
            endTime: input.endTime,
          },
        });
      }, SLOT_CLAIM_TX_OPTIONS);
      ctx.eventBus.emit('booking.created', { bookingId: booking.id, businessId: booking.businessId });
      return booking;
    }),
});
