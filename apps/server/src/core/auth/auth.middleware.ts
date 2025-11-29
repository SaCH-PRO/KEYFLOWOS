import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { SupabaseAuthService } from './supabase-auth.service';
import { PrismaService } from '../prisma/prisma.service';

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
      if (user) {
        let role = 'USER';
        try {
          const dbUser = await this.prisma.client.user.findUnique({
            where: { id: user.id },
            select: { role: true },
          });
          if (dbUser?.role) {
            role = dbUser.role;
          }
        } catch (lookupErr) {
          this.logger.debug(`Role lookup failed: ${(lookupErr as Error).message}`);
        }

        (req as any).user = { id: user.id, email: user.email, role };
      }
    } catch (err) {
      this.logger.debug(`AuthMiddleware error: ${(err as Error).message}`);
    }

    next();
  }
}
