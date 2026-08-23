import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, ServiceUnavailableException, SetMetadata } from '@nestjs/common';
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

      // Identical reasoning to RateLimitGuard, which fixed this first — see the
      // long comment there. pipeline.exec() RESOLVES when its commands fail,
      // returning [error, value] pairs with the failure in slot 0. This used to
      // destructure straight past that slot:
      //
      //   const [, [, count]] = await pipeline.exec() as [unknown, [null, number]]
      //
      // During an outage that left `count` undefined, and `undefined >= limit`
      // is false, so the limit check silently passed. The request was still
      // refused — but by the zadd below rejecting, not by anything here. The
      // policy therefore depended on statement order rather than error
      // handling, and this guard covers the UNAUTHENTICATED surface, where
      // failing open is worst.
      const results = await pipeline.exec();
      if (!results) {
        throw new Error('Redis pipeline returned no result');
      }
      const commandError = results.find(([err]) => err)?.[0];
      if (commandError) {
        throw commandError;
      }
      const count = results[1]?.[1];
      if (typeof count !== 'number') {
        // A non-numeric count means the store did not answer. Treating it as
        // zero is the failure mode this whole comment exists to prevent.
        throw new Error(`Rate-limit count unavailable (received ${typeof count})`);
      }

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
      console.error('[PublicRateLimitGuard] Redis error — failing closed:', (err as Error).message);
      throw new ServiceUnavailableException('Rate limiting temporarily unavailable');
    }

    return true;
  }
}
