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
      });
    }),
  createContact: protectedProcedure
    .input(
      z.object({
        businessId: z.string(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
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
        },
      });
    }),
});
