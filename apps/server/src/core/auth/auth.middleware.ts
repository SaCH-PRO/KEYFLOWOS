import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { SupabaseAuthService } from './supabase-auth.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);
  private supabaseAuthInstance: SupabaseAuthService | null = null;
  private static readonly SESSION_COOKIE = 'kf_session';

  constructor(
    @Inject(SupabaseAuthService) private readonly supabaseAuth: SupabaseAuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private getSupabaseAuth(): SupabaseAuthService {
    if (this.supabaseAuth) return this.supabaseAuth;
    if (!this.supabaseAuthInstance) {
      this.supabaseAuthInstance = new SupabaseAuthService();
    }
    return this.supabaseAuthInstance;
  }

  private readSessionCookie(rawCookie?: string): string | undefined {
    if (!rawCookie) return undefined;
    const pairs = rawCookie.split(';');
    for (const pair of pairs) {
      const [name, ...rest] = pair.trim().split('=');
      if (name === AuthMiddleware.SESSION_COOKIE) {
        const value = rest.join('=').trim();
        if (!value) return undefined;
        try {
          return decodeURIComponent(value);
        } catch {
          return value;
        }
      }
    }
    return undefined;
  }

  async use(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers['authorization'];
    const headerToken =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.replace('Bearer ', '').trim()
        : undefined;
    const cookieToken = this.readSessionCookie(req.headers.cookie);
    const token = headerToken || cookieToken;

    this.logger.debug(`Auth header: ${header ? `${String(header).slice(0, 12)}...` : 'none'}`);

    try {
      const supabaseAuth = this.getSupabaseAuth();
      const user = await supabaseAuth.getUserFromToken(token);
      if (user?.id) {
        (req as any).authToken = token;
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
