import { protectedProcedure, router } from '../trpc';
import { z } from 'zod';

export const commerceRouter = router({
  health: protectedProcedure.query(({ ctx }) => ({
    status: 'ok',
    module: 'commerce',
    user: ctx.user,
  })),
  listProducts: protectedProcedure
    .input(z.object({ businessId: z.string() }))
    .query(({ input, ctx }) =>
      ctx.db.product.findMany({
        where: { businessId: input.businessId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
    ),
  createProduct: protectedProcedure
    .input(
      z.object({
        businessId: z.string(),
        name: z.string().min(1),
        price: z.number().positive(),
        currency: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      ctx.db.product.create({
        data: {
          businessId: input.businessId,
          name: input.name,
          price: input.price,
          currency: input.currency ?? 'TTD',
          description: input.description ?? null,
        },
      }),
    ),
  markInvoicePaid: protectedProcedure
    .input(z.object({ invoiceId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const invoice = await ctx.db.invoice.update({
        where: { id: input.invoiceId },
        data: { status: 'PAID', paidAt: new Date() },
      });
      ctx.eventBus.emit('invoice.paid', { invoiceId: input.invoiceId, businessId: invoice.businessId });
      return invoice;
    }),
});
