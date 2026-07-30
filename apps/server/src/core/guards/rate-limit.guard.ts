import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Redis } from 'ioredis';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';
import { REDIS_CLIENT } from '../redis/redis.constants';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.reflector) return true;

    const opts = this.reflector.get<RateLimitOptions>(RATE_LIMIT_KEY, context.getHandler());
    if (!opts) return true;

    const req = context.switchToHttp().getRequest();
    const businessId = req.params?.businessId ?? 'global';
    const ip = req.ip ?? req.connection?.remoteAddress ?? 'unknown';
    const handler = context.getHandler().name;

    const key = `rate_limit:${ip}:${businessId}:${handler}`;
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    try {
      const pipeline = this.redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zcard(key);
      const [, [, count]] = await pipeline.exec() as [unknown, [null, number]];

      if (count >= opts.limit) {
        throw new HttpException(
          'Rate limit exceeded. Please slow down and try again shortly.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await this.redis.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`);
      await this.redis.pexpire(key, opts.windowMs);
    } catch (err: any) {
      // If Redis is unavailable, fail open (allow request) rather than hard-deny
      // every legitimate user. Log loudly so ops knows the guard is degraded.
      if (err instanceof HttpException) throw err;
      console.error('[RateLimitGuard] Redis error — failing open:', (err as Error).message);
    }

    return true;
  }
}
