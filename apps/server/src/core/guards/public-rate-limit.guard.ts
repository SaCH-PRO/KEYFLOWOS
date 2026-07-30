import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

export const PUBLIC_RATE_LIMIT_KEY = 'PUBLIC_RATE_LIMIT';

export interface PublicRateLimitOptions {
  limit: number;
  windowMs: number;
}

export const PublicRateLimit = (limit: number, windowMs = 60_000) =>
  SetMetadata(PUBLIC_RATE_LIMIT_KEY, { limit, windowMs } as PublicRateLimitOptions);

@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.reflector) return true;

    const opts = this.reflector.get<PublicRateLimitOptions>(PUBLIC_RATE_LIMIT_KEY, context.getHandler());
    if (!opts) return true;

    const req = context.switchToHttp().getRequest();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const handler = context.getHandler().name;
    const route = req.route?.path ?? req.url ?? '';

    const key = `pub_rate_limit:${ip}:${handler}:${route}`;
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    try {
      const pipeline = this.redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zcard(key);
      const [, [, count]] = await pipeline.exec() as [unknown, [null, number]];

      if (count >= opts.limit) {
        throw new HttpException(
          'Too many requests. Please try again shortly.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await this.redis.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`);
      await this.redis.pexpire(key, opts.windowMs);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      console.error('[PublicRateLimitGuard] Redis error — failing open:', (err as Error).message);
    }

    return true;
  }
}
