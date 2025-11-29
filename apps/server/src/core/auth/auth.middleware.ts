import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { SupabaseAuthService } from './supabase-auth.service';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);

  constructor(private readonly supabaseAuth: SupabaseAuthService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers['authorization'];
    const token = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.replace('Bearer ', '').trim()
      : undefined;

    try {
      const user = await this.supabaseAuth.getUserFromToken(token);
      if (user) {
        (req as any).user = { id: user.id, email: user.email };
      }
    } catch (err) {
      this.logger.debug(`AuthMiddleware error: ${(err as Error).message}`);
    }

    next();
  }
}
