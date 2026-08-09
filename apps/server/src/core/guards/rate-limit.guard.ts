import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
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

      // pipeline.exec() RESOLVES even when every command in it failed. It
      // returns [error, value] pairs and reports per-command failures in slot
      // 0 rather than rejecting — measured against a dead Redis, it resolves to
      // [[Error], [Error]].
      //
      // This used to destructure straight past that error slot:
      //
      //   const [, [, count]] = await pipeline.exec() as [unknown, [null, number]]
      //
      // During an outage that made `count` undefined, and `undefined >= limit`
      // is false, so the limit check SILENTLY PASSED. The request was still
      // refused — but by the zadd below rejecting, not by anything here, and
      // not by the catch the comment at the bottom describes.
      //
      // The guard was therefore correct by accident. Reordering these lines, or
      // adding an early return after a passing count check, would have made it
      // fail OPEN — unlimited requests during exactly the outage the fail-closed
      // policy exists for. The error was always available; it just was not read.
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
          'Rate limit exceeded. Please slow down and try again shortly.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await this.redis.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`);
      await this.redis.pexpire(key, opts.windowMs);
    } catch (err: any) {
      // If Redis is unavailable, fail closed. Allowing unlimited requests when
      // the rate-limit store is down defeats the purpose of the guard and can
      // be exploited to bypass protections.
      //
      // This is now reachable from the read as well as the write. It was not:
      // pipeline.exec() resolves rather than rejects during an outage, so the
      // only thing that ever landed here was the zadd below failing. That made
      // the policy depend on statement order instead of on this handler.
      if (err instanceof HttpException) throw err;
      console.error('[RateLimitGuard] Redis error — failing closed:', (err as Error).message);
      throw new ServiceUnavailableException('Rate limiting temporarily unavailable');
    }

    return true;
  }
}
