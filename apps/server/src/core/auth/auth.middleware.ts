import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { SupabaseAuthService } from './supabase-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  KEYFLOW_DEV_BYPASS_TOKEN,
  KEYFLOW_DEV_USER_EMAIL,
  KEYFLOW_DEV_USER_ID,
  KEYFLOW_DEV_USER_ROLE,
  isDevAuthBypassEnabled,
} from './keyflow-dev-auth';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);
  private supabaseAuthInstance: SupabaseAuthService | null = null;
  private static bypassAnnounced = false;

  constructor(
    @Inject(SupabaseAuthService) private readonly supabaseAuth: SupabaseAuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {
    if (isDevAuthBypassEnabled() && !AuthMiddleware.bypassAnnounced) {
      AuthMiddleware.bypassAnnounced = true;
      this.logger.warn(
        `[KEYFLOW_DEV_AUTH_BYPASS] Dev auth bypass is ENABLED — every unauthenticated request will be treated as the "${KEYFLOW_DEV_USER_EMAIL}" SUPER_ADMIN profile. NEVER enable this in production.`,
      );
    }
  }

  private getSupabaseAuth(): SupabaseAuthService {
    if (this.supabaseAuth) return this.supabaseAuth;
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

    this.logger.debug(`Auth header: ${header ? `${String(header).slice(0, 12)}...` : 'none'}`);

    const bypassEnabled = isDevAuthBypassEnabled();

    // Dev bypass: accept the sentinel token as the dev profile up-front so we
    // skip Supabase verification entirely. Real tokens are still verified below.
    if (bypassEnabled && token === KEYFLOW_DEV_BYPASS_TOKEN) {
      (req as any).user = {
        id: KEYFLOW_DEV_USER_ID,
        email: KEYFLOW_DEV_USER_EMAIL,
        role: KEYFLOW_DEV_USER_ROLE,
      };
      this.logger.debug('Attached keyflowdev profile from sentinel dev token');
      next();
      return;
    }

    // Reject the sentinel token outright when the bypass flag is not on.
    if (!bypassEnabled && token === KEYFLOW_DEV_BYPASS_TOKEN) {
      this.logger.warn('Dev sentinel token presented but KEYFLOW_DEV_AUTH_BYPASS is off — ignoring');
      next();
      return;
    }

    try {
      const supabaseAuth = this.getSupabaseAuth();
      const user = await supabaseAuth.getUserFromToken(token);
      if (user?.id) {
        (req as any).user = await this.attachRole(user.id, user.email);
        this.logger.debug(
          `Attached user from supabase: id=${user.id} email=${user.email ?? 'n/a'}`,
        );
      } else if (token) {
        this.logger.warn('Token provided but Supabase verification failed — rejecting');
      }
    } catch (err) {
      this.logger.debug(`AuthMiddleware error: ${(err as Error).message}`);
    }

    // Final dev-bypass fallback: any unauthenticated request becomes the dev
    // profile. This is what makes the entire app usable with no login screen.
    if (bypassEnabled && !(req as any).user) {
      (req as any).user = {
        id: KEYFLOW_DEV_USER_ID,
        email: KEYFLOW_DEV_USER_EMAIL,
        role: KEYFLOW_DEV_USER_ROLE,
      };
      this.logger.debug('Attached keyflowdev profile via dev bypass fallback');
    }

    next();
  }

  private async attachRole(userId: string, email?: string | null) {
    let role = 'USER';
    try {
      if (this.prisma?.client) {
        const dbUser = await this.prisma.client.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });
        if (dbUser?.role) {
          role = dbUser.role;
        }
      }
    } catch (lookupErr) {
      this.logger.debug(`Role lookup failed: ${(lookupErr as Error).message}`);
    }
    return { id: userId, email, role };
  }
}
