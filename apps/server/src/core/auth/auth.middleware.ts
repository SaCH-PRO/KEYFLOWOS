import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { SupabaseAuthService } from './supabase-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  getDefaultDevProfile,
  getDevProfileByKey,
  getDevProfileByToken,
  isDevAuthBypassEnabled,
  isDevBypassToken,
  KeyflowDevProfile,
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
      const def = getDefaultDevProfile();
      this.logger.warn(
        `[KEYFLOW_DEV_AUTH_BYPASS] Dev auth bypass is ENABLED — unauthenticated requests default to "${def.email}" (${def.userRole}). Switch profiles via ?as=<key> or sentinel token. NEVER enable this in production.`,
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

  private attachProfile(req: Request, profile: KeyflowDevProfile, source: string) {
    (req as any).user = {
      id: profile.userId,
      email: profile.email,
      role: profile.userRole,
    };
    this.logger.debug(`Attached dev profile "${profile.key}" (${profile.userRole}) via ${source}`);
  }

  private resolveAsOverride(req: Request): KeyflowDevProfile | undefined {
    const raw =
      (typeof req.query?.as === 'string' && req.query.as) ||
      (typeof req.headers['x-keyflow-dev-as'] === 'string' && (req.headers['x-keyflow-dev-as'] as string)) ||
      undefined;
    if (!raw) return undefined;
    const profile = getDevProfileByKey(raw);
    if (!profile) {
      this.logger.warn(`?as=${raw} did not match any seeded dev profile — ignoring`);
    }
    return profile;
  }

  async use(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.replace('Bearer ', '').trim()
        : undefined;

    this.logger.debug(`Auth header: ${header ? `${String(header).slice(0, 12)}...` : 'none'}`);

    const bypassEnabled = isDevAuthBypassEnabled();

    // Dev bypass: an explicit ?as=<key> override (when bypass is on) wins,
    // followed by sentinel token lookup. Real Supabase tokens are still
    // verified below.
    if (bypassEnabled) {
      const override = this.resolveAsOverride(req);
      if (override) {
        this.attachProfile(req, override, '?as= override');
        next();
        return;
      }

      const tokenProfile = getDevProfileByToken(token);
      if (tokenProfile) {
        this.attachProfile(req, tokenProfile, 'sentinel dev token');
        next();
        return;
      }
    }

    // Reject any sentinel token outright when the bypass flag is not on.
    if (!bypassEnabled && isDevBypassToken(token)) {
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

    // Final dev-bypass fallback: any unauthenticated request becomes the
    // default dev profile. This is what makes the entire app usable with no
    // login screen.
    if (bypassEnabled && !(req as any).user) {
      this.attachProfile(req, getDefaultDevProfile(), 'dev bypass fallback');
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
