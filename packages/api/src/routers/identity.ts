import { protectedProcedure, router } from '../trpc';
import { TRPCError } from '@trpc/server';
import type { AnyRouter } from '@trpc/server';
import { z } from 'zod';

export const identityRouter: AnyRouter = router({
  health: protectedProcedure.query(({ ctx }) => ({
    status: 'ok',
    module: 'identity',
    user: ctx.user,
  })),
  /**
   * Membership-first workspace discovery.
   *
   * KF-EXEC-TENANT-001. Mirrors `IdentityService.listBusinesses`: Membership is
   * the ordinary relationship and leads the predicate, `ownerId` remains as a
   * compatibility arm so pre-existing legitimate owners stay discoverable until
   * the founding-Membership backfill has run everywhere. Filtering on `ownerId`
   * alone hid every business a user belonged to but did not own.
   */
  listBusinesses: protectedProcedure.query(({ ctx }) => {
    const userId = ctx.user?.id;
    if (!userId) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Authenticated user id is required to list businesses',
      });
    }
    return ctx.db.business.findMany({
      where: {
        deletedAt: null,
        OR: [
          { members: { some: { userId } } },
          { ownerId: userId },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }),
  createBusiness: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      // KF-EXEC-TENANT-001: reject before mutation, never invent an owner.
      //
      // This previously wrote `ownerId: ctx.user?.id ?? ''`. `protectedProcedure`
      // only asserts that `ctx.user` is truthy, and `ctx.user` is bridged from
      // `req.user` typed as `any`, so a user object carrying no id persisted a
      // Business owned by the empty string — a row whose owner resolves to no
      // User at all. There is no foreign key on Business.ownerId to catch it.
      const ownerId = ctx.user?.id;
      if (!ownerId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Authenticated user id is required to create a business',
        });
      }

      // Same founding postcondition as the REST constructor: the Business and
      // its one founding OWNER Membership land together or not at all.
      //
      // A nested relation write rather than an explicit transaction. Prisma runs
      // a nested create in one implicit transaction, so atomicity is identical,
      // and Prisma derives the foreign key itself instead of this procedure
      // reading the new row back and passing its id to a second statement. That
      // is also why `trpc.module.spec.ts` has nothing to check here: this
      // procedure never handles a caller-supplied tenant identifier at all.
      return ctx.db.business.create({
        data: {
          name: input.name,
          ownerId,
          members: { create: { userId: ownerId, role: 'OWNER' } },
        },
      });
    }),
});
