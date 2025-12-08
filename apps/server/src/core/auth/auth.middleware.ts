import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { SupabaseAuthService } from './supabase-auth.service';
import { PrismaService } from '../prisma/prisma.service';

type DecodedJwt = {
  sub?: string;
  user_id?: string;
  email?: string;
  role?: string;
};

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);

  constructor(
    private readonly supabaseAuth: SupabaseAuthService,
    private readonly prisma: PrismaService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers['authorization'];
    const token = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.replace('Bearer ', '').trim()
      : undefined;

    try {
      const user = await this.supabaseAuth.getUserFromToken(token);
      if (user?.id) {
        (req as any).user = await this.attachRole(user.id, user.email);
      } else if (token) {
        // Fallback: decode JWT locally to avoid blocking when Supabase is unavailable.
        const decoded = this.decodeJwt(token);
        const fallbackId = decoded?.sub || decoded?.user_id;
        if (fallbackId) {
          (req as any).user = await this.attachRole(fallbackId, decoded?.email);
        }
      }
    } catch (err) {
      this.logger.debug(`AuthMiddleware error: ${(err as Error).message}`);
    }

    next();
  }

  private decodeJwt(token: string): DecodedJwt | null {
    try {
      const [, payload] = token.split('.');
      if (!payload) return null;
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = Buffer.from(normalized, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }

  private async attachRole(userId: string, email?: string | null) {
    let role = 'USER';
    try {
      const dbUser = await this.prisma.client.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (dbUser?.role) {
        role = dbUser.role;
      }
    } catch (lookupErr) {
      this.logger.debug(`Role lookup failed: ${(lookupErr as Error).message}`);
    }
    return { id: userId, email, role };
  }
}
