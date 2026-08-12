import { protectedProcedure, router } from '../trpc';
import type { AnyRouter } from '@trpc/server';
import { z } from 'zod';
import { assertBusinessAccess } from '../lib/access';

export const socialRouter: AnyRouter = router({
  health: protectedProcedure.query(({ ctx }) => ({
    status: 'ok',
    module: 'social',
    user: ctx.user,
  })),
  /**
   * `protectedProcedure` establishes that the caller is SOMEBODY, not that they
   * are entitled to this business. Without the assert below, any authenticated
   * user could name any businessId and receive that business's social tokens.
   *
   * Two things that would normally catch this do not apply on /trpc: the router
   * is mounted as Express middleware, so the APP_INTERCEPTOR that populates the
   * tenant AsyncLocalStorage never runs, and SocialConnection is not in
   * BUSINESS_ID_MODELS, so the Prisma extension would not scope it even if it
   * did. The access check here is the only thing standing in the way.
   *
   * `select` is explicit because token-encryption.ts decrypts socialConnection
   * on findMany: returning the row would hand back the live OAuth access and
   * refresh tokens in plaintext. Nothing needs them to render a connection list.
   */
  listConnections: protectedProcedure
    .input(z.object({ businessId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      return ctx.db.socialConnection.findMany({
        where: { businessId: input.businessId },
        select: {
          id: true,
          platform: true,
          platformId: true,
          accountName: true,
          profilePicture: true,
          scopes: true,
          status: true,
          expiresAt: true,
          businessId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }),
});
