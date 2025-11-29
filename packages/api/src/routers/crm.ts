import { protectedProcedure, router } from '../trpc';
import { z } from 'zod';
import { assertBusinessAccess } from '../lib/access';

export const crmRouter = router({
  health: protectedProcedure.query(({ ctx }) => ({
    status: 'ok',
    module: 'crm',
    user: ctx.user,
  })),
  listContacts: protectedProcedure
    .input(z.object({ businessId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      return ctx.db.contact.findMany({
        where: { businessId: input.businessId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          status: true,
          source: true,
          tags: true,
          custom: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }),
  contactDetail: protectedProcedure
    .input(z.object({ businessId: z.string(), contactId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const contact = await ctx.db.contact.findFirst({
        where: { id: input.contactId, businessId: input.businessId, deletedAt: null },
      });
      const [events, notes, tasks] = await Promise.all([
        ctx.db.contactEvent.findMany({
          where: { businessId: input.businessId, contactId: input.contactId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        ctx.db.contactNote.findMany({
          where: { businessId: input.businessId, contactId: input.contactId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        ctx.db.contactTask.findMany({
          where: { businessId: input.businessId, contactId: input.contactId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      ]);
      return { contact, events, notes, tasks };
    }),
  createContact: protectedProcedure
    .input(
      z.object({
        businessId: z.string(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        status: z.string().optional(),
        source: z.string().optional(),
        tags: z.array(z.string()).optional(),
        custom: z.record(z.any()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      return ctx.db.contact.create({
        data: {
          businessId: input.businessId,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          status: input.status ?? undefined,
          source: input.source ?? null,
          tags: input.tags ?? [],
          custom: input.custom ?? {},
        },
      });
    }),
  addNote: protectedProcedure
    .input(
      z.object({
        businessId: z.string(),
        contactId: z.string(),
        body: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      return ctx.db.contactNote.create({
        data: {
          businessId: input.businessId,
          contactId: input.contactId,
          body: input.body,
        },
      });
    }),
  addTask: protectedProcedure
    .input(
      z.object({
        businessId: z.string(),
        contactId: z.string(),
        title: z.string().min(1),
        dueDate: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      return ctx.db.contactTask.create({
        data: {
          businessId: input.businessId,
          contactId: input.contactId,
          title: input.title,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
        },
      });
    }),
});
