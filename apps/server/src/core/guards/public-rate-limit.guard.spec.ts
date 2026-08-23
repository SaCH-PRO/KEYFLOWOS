/**
 * The PUBLIC rate limiter must fail closed from the read, for the same reason
 * and in the same way as its authenticated sibling.
 *
 * rate-limit.guard.ts had this defect, documented it at length, and fixed it.
 * public-rate-limit.guard.ts kept the original line:
 *
 *   const [, [, count]] = await pipeline.exec() as [unknown, [null, number]]
 *
 * `pipeline.exec()` RESOLVES when its commands fail, returning [error, value]
 * pairs with the failure in slot 0. Destructuring past that slot left `count`
 * undefined during an outage, and `undefined >= limit` is false — so the limit
 * check passed silently and only the zadd afterwards refused the request. The
 * guard was correct by accident, and this is the guard on the UNAUTHENTICATED
 * surface, where failing open is worst.
 *
 * The Redis double below reproduces the outage shape measured against ioredis
 * 5.10.1 on a dead port — [[Error], [Error]] — copied from rate-limit.guard.spec.ts
 * rather than imagined. A fixture describing a shape the client cannot produce
 * would assert that the broken thing is correct.
 */
import { describe, it, expect, vi } from 'vitest';
import { ServiceUnavailableException, HttpException } from '@nestjs/common';
import { PublicRateLimitGuard } from './public-rate-limit.guard';

/** An ioredis double. `failing` reproduces the measured outage behaviour. */
function makeRedis(opts: { failing: boolean; count?: number }) {
  const err = new Error("Stream isn't writeable and enableOfflineQueue options is false");
  return {
    pipeline: () => ({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      // Resolves in BOTH cases — that is the whole point.
      exec: vi.fn().mockResolvedValue(
        opts.failing ? [[err], [err]] : [[null, 0], [null, opts.count ?? 0]],
      ),
    }),
    zadd: opts.failing ? vi.fn().mockRejectedValue(err) : vi.fn().mockResolvedValue(1),
    pexpire: opts.failing ? vi.fn().mockRejectedValue(err) : vi.fn().mockResolvedValue(1),
  };
}

// This guard reads ip from req.socket (not req.connection) and the route from
// req.route.path ?? req.url.
function makeContext() {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        ip: '1.2.3.4',
        socket: { remoteAddress: '1.2.3.4' },
        route: { path: '/public/t' },
        url: '/public/t',
      }),
    }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as never;
}

function makeGuard(redis: ReturnType<typeof makeRedis>) {
  const reflector = { get: () => ({ limit: 5, windowMs: 60_000 }) } as never;
  return new PublicRateLimitGuard(reflector, redis as never);
}

describe('the public rate limiter fails closed when its store is unavailable', () => {
  it('refuses the request when the pipeline reports command errors', async () => {
    const guard = makeGuard(makeRedis({ failing: true }));

    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('refuses on the READ, before any write is attempted', async () => {
    // The assertion that pins the defect. If the guard only fails because zadd
    // rejects, the policy depends on statement order rather than error
    // handling, and reordering would make it fail OPEN.
    const redis = makeRedis({ failing: true });
    const guard = makeGuard(redis);

    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(
      redis.zadd,
      'the guard reached the write, so it is failing closed by accident: the ' +
        'read did not detect the outage and only the zadd rejection refused the ' +
        'request. Reordering these statements would make it fail OPEN.',
    ).not.toHaveBeenCalled();
  });

  it('does not treat a missing count as zero', async () => {
    // `undefined >= 5` is false, so an unread error reads as "well under the
    // limit". This is the exact arithmetic that made the check a no-op.
    const redis = {
      pipeline: () => ({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zcard: vi.fn().mockReturnThis(),
        // No error reported, but no value either — a shape the client can
        // produce and the old destructuring accepted silently.
        exec: vi.fn().mockResolvedValue([[null, 0], [null, undefined]]),
      }),
      zadd: vi.fn().mockResolvedValue(1),
      pexpire: vi.fn().mockResolvedValue(1),
    };

    await expect(makeGuard(redis as never).canActivate(makeContext())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(redis.zadd, 'an unusable count must not be spent as headroom').not.toHaveBeenCalled();
  });

  it('refuses when exec() returns null outright', async () => {
    const redis = {
      pipeline: () => ({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zcard: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(null),
      }),
      zadd: vi.fn().mockResolvedValue(1),
      pexpire: vi.fn().mockResolvedValue(1),
    };

    await expect(makeGuard(redis as never).canActivate(makeContext())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(redis.zadd).not.toHaveBeenCalled();
  });
});

describe('the public rate limiter still limits when the store is healthy', () => {
  it('allows a request under the limit', async () => {
    const redis = makeRedis({ failing: false, count: 2 });

    await expect(makeGuard(redis).canActivate(makeContext())).resolves.toBe(true);
    expect(redis.zadd, 'a permitted request must be recorded').toHaveBeenCalled();
  });

  it('rejects with 429, not 503, once the limit is reached', async () => {
    // The two failure modes must stay distinguishable: 429 is "you did too
    // much", 503 is "we cannot tell". Collapsing them would hide an outage
    // behind what looks like ordinary throttling.
    const redis = makeRedis({ failing: false, count: 5 });

    const err = await makeGuard(redis).canActivate(makeContext()).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err).not.toBeInstanceOf(ServiceUnavailableException);
    expect((err as HttpException).getStatus()).toBe(429);
  });

  it('passes through when no rate-limit metadata is set on the handler', async () => {
    const redis = makeRedis({ failing: false, count: 0 });
    const reflector = { get: () => undefined } as never;
    const guard = new PublicRateLimitGuard(reflector, redis as never);

    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    expect(redis.zadd).not.toHaveBeenCalled();
  });
});
