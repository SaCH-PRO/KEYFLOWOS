import { protectedProcedure, router } from '../trpc';
import type { AnyRouter } from '@trpc/server';
import { z } from 'zod';
import { assertBusinessAccess } from '../lib/access';
import type { db as DbClient } from '@keyflow/db';

type PrismaTx = Parameters<Parameters<typeof DbClient['$transaction']>[0]>[0];

const EVENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'] as const;
const ATTENDEE_STATUSES = ['REGISTERED', 'CANCELLED', 'CHECKED_IN', 'REFUNDED'] as const;

const eventIdInput = z.object({ businessId: z.string(), eventId: z.string() });
const ticketTypeIdInput = eventIdInput.extend({ ticketTypeId: z.string() });
const attendeeIdInput = eventIdInput.extend({ attendeeId: z.string() });

const createEventSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  timezone: z.string().max(100).optional(),
  location: z.string().max(1000).optional(),
  isPublished: z.boolean().optional(),
  coverImageUrl: z.string().max(1000).optional(),
  status: z.enum(EVENT_STATUSES).optional(),
});

const updateEventSchema = createEventSchema.partial();

const eventListQuerySchema = z.object({
  businessId: z.string(),
  status: z.enum(EVENT_STATUSES).optional(),
  search: z.string().optional(),
  skip: z.coerce.number().int().min(0).optional(),
  take: z.coerce.number().int().min(1).optional(),
});

const createTicketTypeSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  price: z.coerce.number().min(0),
  currency: z.string().max(3).optional(),
  quantity: z.coerce.number().int().min(0).optional(),
  salesStartAt: z.coerce.date().optional(),
  salesEndAt: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
});

const updateTicketTypeSchema = createTicketTypeSchema.partial();

const createAttendeeSchema = z.object({
  ticketTypeId: z.string().optional(),
  email: z.string().email().max(255),
  name: z.string().max(255).optional(),
  phone: z.string().max(100).optional(),
  status: z.enum(ATTENDEE_STATUSES).optional(),
  paymentId: z.string().max(255).optional(),
  checkedInAt: z.coerce.date().optional(),
});

const updateAttendeeSchema = createAttendeeSchema.partial();

const checkInSchema = z.object({
  checkedInBy: z.string().max(255).optional(),
  notes: z.string().max(1000).optional(),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type EventListQuery = z.infer<typeof eventListQuerySchema>;
export type CreateTicketTypeInput = z.infer<typeof createTicketTypeSchema>;
export type UpdateTicketTypeInput = z.infer<typeof updateTicketTypeSchema>;
export type CreateAttendeeInput = z.infer<typeof createAttendeeSchema>;
export type UpdateAttendeeInput = z.infer<typeof updateAttendeeSchema>;
export type CheckInInput = z.infer<typeof checkInSchema>;

export const eventsRouter: AnyRouter = router({
  // Events
  listEvents: protectedProcedure
    .input(eventListQuerySchema)
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const { status, search, skip = 0, take = 100 } = input;
      const where = {
        businessId: input.businessId,
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { description: { contains: search, mode: 'insensitive' as const } },
                { location: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        ctx.db.event.findMany({
          where,
          orderBy: { startsAt: 'desc' },
          skip,
          take,
          include: {
            _count: { select: { ticketTypes: true, attendees: true, checkIns: true } },
          },
        }),
        ctx.db.event.count({ where }),
      ]);
      return { items, total, skip, take };
    }),

  getEvent: protectedProcedure
    .input(eventIdInput)
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      return ctx.db.event.findFirst({
        where: { id: input.eventId, businessId: input.businessId },
        include: {
          ticketTypes: { orderBy: { createdAt: 'asc' } },
          _count: { select: { attendees: true, checkIns: true } },
        },
      });
    }),

  createEvent: protectedProcedure
    .input(createEventSchema.extend({ businessId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const { businessId, ...data } = input;
      if (data.endsAt && data.endsAt <= data.startsAt) {
        throw new Error('endsAt must be after startsAt');
      }
      return ctx.db.event.create({
        data: {
          businessId,
          name: data.name,
          description: data.description ?? null,
          startsAt: data.startsAt,
          endsAt: data.endsAt ?? null,
          timezone: data.timezone ?? 'UTC',
          location: data.location ?? null,
          isPublished: data.isPublished ?? false,
          coverImageUrl: data.coverImageUrl ?? null,
          status: data.status ?? 'DRAFT',
        },
        include: { ticketTypes: true },
      });
    }),

  updateEvent: protectedProcedure
    .input(updateEventSchema.extend(eventIdInput.shape))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const { businessId, eventId, ...data } = input;
      const existing = await ctx.db.event.findFirst({
        where: { id: eventId, businessId },
      });
      if (!existing) throw new Error('Event not found');
      const startsAt = data.startsAt ?? existing.startsAt;
      const endsAt = data.endsAt !== undefined ? data.endsAt : existing.endsAt;
      if (endsAt && endsAt <= startsAt) {
        throw new Error('endsAt must be after startsAt');
      }
      return ctx.db.event.update({
        where: { id: eventId },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.startsAt !== undefined && { startsAt: data.startsAt }),
          ...(data.endsAt !== undefined && { endsAt: data.endsAt }),
          ...(data.timezone !== undefined && { timezone: data.timezone }),
          ...(data.location !== undefined && { location: data.location }),
          ...(data.isPublished !== undefined && { isPublished: data.isPublished }),
          ...(data.coverImageUrl !== undefined && { coverImageUrl: data.coverImageUrl }),
          ...(data.status !== undefined && { status: data.status }),
        },
        include: { ticketTypes: true },
      });
    }),

  deleteEvent: protectedProcedure
    .input(eventIdInput)
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      await ctx.db.event.deleteMany({
        where: { id: input.eventId, businessId: input.businessId },
      });
      return { deleted: true };
    }),

  // Ticket types
  listTicketTypes: protectedProcedure
    .input(eventIdInput)
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      return ctx.db.eventTicketType.findMany({
        where: { eventId: input.eventId },
        orderBy: { createdAt: 'asc' },
        include: { _count: { select: { attendees: true } } },
      });
    }),

  createTicketType: protectedProcedure
    .input(createTicketTypeSchema.extend(eventIdInput.shape))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const { businessId, eventId, ...data } = input;
      const event = await ctx.db.event.findFirst({
        where: { id: eventId, businessId },
        select: { id: true },
      });
      if (!event) throw new Error('Event not found');
      if (data.salesStartAt && data.salesEndAt && data.salesEndAt <= data.salesStartAt) {
        throw new Error('salesEndAt must be after salesStartAt');
      }
      return ctx.db.eventTicketType.create({
        data: {
          eventId,
          name: data.name,
          description: data.description ?? null,
          price: data.price,
          currency: data.currency ?? 'USD',
          quantity: data.quantity ?? null,
          salesStartAt: data.salesStartAt ?? null,
          salesEndAt: data.salesEndAt ?? null,
          isActive: data.isActive ?? true,
        },
      });
    }),

  updateTicketType: protectedProcedure
    .input(updateTicketTypeSchema.extend(ticketTypeIdInput.shape))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const { businessId, eventId, ticketTypeId, ...data } = input;
      const event = await ctx.db.event.findFirst({
        where: { id: eventId, businessId },
        select: { id: true },
      });
      if (!event) throw new Error('Event not found');
      const existing = await ctx.db.eventTicketType.findFirst({
        where: { id: ticketTypeId, eventId },
      });
      if (!existing) throw new Error('Ticket type not found');
      const salesStartAt = data.salesStartAt !== undefined ? data.salesStartAt : existing.salesStartAt;
      const salesEndAt = data.salesEndAt !== undefined ? data.salesEndAt : existing.salesEndAt;
      if (salesStartAt && salesEndAt && salesEndAt <= salesStartAt) {
        throw new Error('salesEndAt must be after salesStartAt');
      }
      if (data.quantity !== undefined && data.quantity < existing.quantitySold) {
        throw new Error(`Quantity cannot be less than already sold tickets (${existing.quantitySold})`);
      }
      return ctx.db.eventTicketType.update({
        where: { id: ticketTypeId },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.price !== undefined && { price: data.price }),
          ...(data.currency !== undefined && { currency: data.currency }),
          ...(data.quantity !== undefined && { quantity: data.quantity }),
          ...(data.salesStartAt !== undefined && { salesStartAt: data.salesStartAt }),
          ...(data.salesEndAt !== undefined && { salesEndAt: data.salesEndAt }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
      });
    }),

  deleteTicketType: protectedProcedure
    .input(ticketTypeIdInput)
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const { businessId, eventId, ticketTypeId } = input;
      const event = await ctx.db.event.findFirst({
        where: { id: eventId, businessId },
        select: { id: true },
      });
      if (!event) throw new Error('Event not found');
      const existing = await ctx.db.eventTicketType.findFirst({
        where: { id: ticketTypeId, eventId },
        include: { _count: { select: { attendees: true } } },
      });
      if (!existing) throw new Error('Ticket type not found');
      if (existing._count.attendees > 0) {
        throw new Error('Cannot delete ticket type with registered attendees');
      }
      await ctx.db.eventTicketType.delete({ where: { id: ticketTypeId } });
      return { deleted: true };
    }),

  // Attendees
  listAttendees: protectedProcedure
    .input(eventIdInput)
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      return ctx.db.eventAttendee.findMany({
        where: { eventId: input.eventId },
        orderBy: { createdAt: 'desc' },
        include: { ticketType: true },
      });
    }),

  createAttendee: protectedProcedure
    .input(createAttendeeSchema.extend(eventIdInput.shape))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const { businessId, eventId, ...data } = input;
      const event = await ctx.db.event.findFirst({
        where: { id: eventId, businessId },
        select: { id: true, status: true },
      });
      if (!event) throw new Error('Event not found');
      if (event.status === 'CANCELLED') throw new Error('Cannot register attendees for a cancelled event');

      let ticketType: { id: string; quantity: number | null; quantitySold: number } | null = null;
      if (data.ticketTypeId) {
        const tt = await ctx.db.eventTicketType.findFirst({
          where: { id: data.ticketTypeId, eventId, isActive: true },
        });
        if (!tt) throw new Error('Ticket type not found');
        const now = new Date();
        if (tt.salesStartAt && now < tt.salesStartAt) throw new Error('Ticket sales have not started yet');
        if (tt.salesEndAt && now > tt.salesEndAt) throw new Error('Ticket sales have ended');
        if (tt.quantity !== null && tt.quantitySold >= tt.quantity) throw new Error('Ticket type is sold out');
        ticketType = tt;
      }

      const attendee = await ctx.db.$transaction(async (tx: PrismaTx) => {
        if (ticketType) {
          await tx.eventTicketType.update({
            where: { id: ticketType.id },
            data: { quantitySold: { increment: 1 } },
          });
        }
        return tx.eventAttendee.create({
          data: {
            eventId,
            businessId,
            ticketTypeId: ticketType?.id ?? null,
            email: data.email,
            name: data.name ?? null,
            phone: data.phone ?? null,
            status: data.status ?? 'REGISTERED',
            paymentId: data.paymentId ?? null,
            checkedInAt: data.checkedInAt ?? null,
          },
          include: { ticketType: true },
        });
      });

      return attendee;
    }),

  updateAttendee: protectedProcedure
    .input(updateAttendeeSchema.extend(attendeeIdInput.shape))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const { businessId, eventId, attendeeId, ...data } = input;
      const event = await ctx.db.event.findFirst({
        where: { id: eventId, businessId },
        select: { id: true },
      });
      if (!event) throw new Error('Event not found');
      const existing = await ctx.db.eventAttendee.findFirst({
        where: { id: attendeeId, eventId },
      });
      if (!existing) throw new Error('Attendee not found');
      return ctx.db.eventAttendee.update({
        where: { id: attendeeId },
        data: {
          ...(data.ticketTypeId !== undefined && { ticketTypeId: data.ticketTypeId }),
          ...(data.email !== undefined && { email: data.email }),
          ...(data.name !== undefined && { name: data.name }),
          ...(data.phone !== undefined && { phone: data.phone }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.paymentId !== undefined && { paymentId: data.paymentId }),
          ...(data.checkedInAt !== undefined && { checkedInAt: data.checkedInAt }),
        },
        include: { ticketType: true },
      });
    }),

  deleteAttendee: protectedProcedure
    .input(attendeeIdInput)
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const { businessId, eventId, attendeeId } = input;
      const event = await ctx.db.event.findFirst({
        where: { id: eventId, businessId },
        select: { id: true },
      });
      if (!event) throw new Error('Event not found');
      const existing = await ctx.db.eventAttendee.findFirst({
        where: { id: attendeeId, eventId },
        include: { checkIns: true },
      });
      if (!existing) throw new Error('Attendee not found');
      await ctx.db.$transaction([
        ctx.db.eventCheckIn.deleteMany({ where: { attendeeId } }),
        ctx.db.eventAttendee.delete({ where: { id: attendeeId } }),
        ...(existing.ticketTypeId
          ? [
              ctx.db.eventTicketType.update({
                where: { id: existing.ticketTypeId },
                data: { quantitySold: { decrement: 1 } },
              }),
            ]
          : []),
      ]);
      return { deleted: true };
    }),

  // Check-ins
  checkIn: protectedProcedure
    .input(checkInSchema.extend(attendeeIdInput.shape))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const { businessId, eventId, attendeeId, ...data } = input;
      const event = await ctx.db.event.findFirst({
        where: { id: eventId, businessId },
        select: { id: true },
      });
      if (!event) throw new Error('Event not found');
      const attendee = await ctx.db.eventAttendee.findFirst({
        where: { id: attendeeId, eventId },
        include: { checkIns: true },
      });
      if (!attendee) throw new Error('Attendee not found');
      if (attendee.status === 'CANCELLED') throw new Error('Cannot check in a cancelled attendee');
      if (attendee.checkIns.length > 0) throw new Error('Attendee is already checked in');
      const [checkIn] = await ctx.db.$transaction([
        ctx.db.eventCheckIn.create({
          data: {
            eventId,
            attendeeId,
            checkedInBy: data.checkedInBy ?? null,
            notes: data.notes ?? null,
          },
        }),
        ctx.db.eventAttendee.update({
          where: { id: attendeeId },
          data: { status: 'CHECKED_IN', checkedInAt: new Date() },
        }),
      ]);
      return checkIn;
    }),

  undoCheckIn: protectedProcedure
    .input(attendeeIdInput)
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const { businessId, eventId, attendeeId } = input;
      const event = await ctx.db.event.findFirst({
        where: { id: eventId, businessId },
        select: { id: true },
      });
      if (!event) throw new Error('Event not found');
      const attendee = await ctx.db.eventAttendee.findFirst({
        where: { id: attendeeId, eventId },
        include: { checkIns: true },
      });
      if (!attendee) throw new Error('Attendee not found');
      if (attendee.checkIns.length === 0) throw new Error('Attendee is not checked in');
      await ctx.db.$transaction([
        ctx.db.eventCheckIn.deleteMany({ where: { eventId, attendeeId } }),
        ctx.db.eventAttendee.update({
          where: { id: attendeeId },
          data: { status: 'REGISTERED', checkedInAt: null },
        }),
      ]);
      return { undone: true };
    }),
});
