import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { SupabaseAuthService } from './supabase-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { verifyAdminToken } from './admin-token.util';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

/**
 * Server-side authentication gate for every inbound request.
 *
 * Behaviour:
 *   - Extract `Authorization: Bearer <token>` if present.
 *   - Verify the token with Supabase (`supabase.auth.getUser(token)`).
 *   - On success, attach `req.user = { id, email, role }` (role read from
 *     our Prisma `User` row, not from the JWT, so role changes take effect
 *     immediately).
 *   - On any failure / missing token, leave `req.user` unset. Downstream
 *     guards/controllers decide whether the route requires authentication
 *     and respond with 401 accordingly.
 *
 * No dev bypass exists. The previous `KEYFLOW_DEV_AUTH_BYPASS` escape hatch
 * was removed entirely (Tier 2 auth hardening); see `apps/server/src/main.ts`
 * for the boot-time guard that hard-fails if that env var is still set.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);
  private supabaseAuthInstance: SupabaseAuthService | null = null;

  constructor(
    @Inject(SupabaseAuthService) private readonly supabaseAuth: SupabaseAuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private getSupabaseAuth(): SupabaseAuthService {
    if (this.supabaseAuth) return this.supabaseAuth;
    // Defensive fallback: NestJS DI sometimes loses constructor metadata
    // under tsx/esbuild. Construct directly as a last resort so middleware
    // doesn't silently no-op.
    if (!this.supabaseAuthInstance) {
      this.supabaseAuthInstance = new SupabaseAuthService();
    }
    return this.supabaseAuthInstance;
  }

  async use(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.replace('Bearer ', '').trim()
        : undefined;

    if (!token) {
      next();
      return;
    }

    try {
      const user = await this.getSupabaseAuth().getUserFromToken(token);
      if (user?.id) {
        const localUser = await this.resolveLocalUser(user.id);
        if (!localUser) {
          this.logger.warn(
            { userId: user.id },
            'Token valid but local user is deleted, banned, or revoked — rejecting',
          );
          next();
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express request augmentation; unified user contract elsewhere
        (req as any).user = { id: user.id, email: user.email, role: localUser.role };
        this.logger.debug(
          { userId: user.id },
          'Attached user from supabase',
        );
      } else {
        // Fallback: try admin local-auth token (HMAC-JWT signed with ADMIN_JWT_SECRET)
        const adminUser = await verifyAdminToken(token, this.redis);
        if (adminUser) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (req as any).user = adminUser;
          this.logger.debug(
            { userId: adminUser.id },
            'Attached user from admin token',
          );
        } else {
          this.logger.warn('Bearer token provided but verification failed');
        }
      }
    } catch (err: any) {
      this.logger.debug(`AuthMiddleware error: ${(err as Error).message}`);
    }

    next();
  }

  private async resolveLocalUser(userId: string) {
    if (!this.prisma?.client) {
      return null;
    }

    try {
      const dbUser = await this.prisma.client.user.findUnique({
        where: { id: userId },
        select: { role: true, deletedAt: true, bannedAt: true },
      });

      if (!dbUser || dbUser.deletedAt || dbUser.bannedAt) {
        return null;
      }

      const revoked = await this.redis.get(`auth:revoked:user:${userId}`);
      if (revoked) {
        return null;
      }

      return dbUser;
    } catch (lookupErr) {
      this.logger.debug(`Local user lookup failed: ${(lookupErr as Error).message}`);
      return null;
    }
  }
}
