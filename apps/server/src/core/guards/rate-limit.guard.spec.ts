/**
 * The rate limiter must fail closed FROM THE READ, not by luck of ordering.
 *
 * rate-limit.guard.ts documents "if Redis is unavailable, fail closed" and
 * throws ServiceUnavailableException. For a long time that handler could only
 * be reached one way, and not the way the comment implied.
 *
 * `pipeline.exec()` RESOLVES when its commands fail. It returns [error, value]
 * pairs and reports failures in slot 0. The guard destructured past that slot:
 *
 *   const [, [, count]] = await pipeline.exec()
 *
 * so during an outage `count` was `undefined`, `undefined >= limit` was false,
 * and the limit check passed silently. The request was still refused — because
 * the zadd afterwards rejected — so the guard LOOKED correct end to end while
 * being correct by accident. Reorder those two statements, or early-return
 * after a passing count check, and it fails OPEN: unlimited requests during
 * precisely the outage the policy exists for.
 *
 * These tests drive the guard with a Redis double whose pipeline behaves the
 * way a real one does when the server is unreachable — verified by probing
 * ioredis 5.10.1 against a dead port, which resolves to [[Error], [Error]].
 * The shape is copied from that measurement rather than imagined, because a
 * fixture describing a shape the client cannot produce is worse than no test:
 * it asserts that the broken thing is correct. That is how the sibling context
 * service's defect survived, and it is not repeated here.
 */
import { describe, it, expect, vi } from 'vitest';
import { ServiceUnavailableException, HttpException } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

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

function makeContext() {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip: '1.2.3.4', params: {}, route: { path: '/t' } }),
    }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as never;
}

function makeGuard(redis: ReturnType<typeof makeRedis>) {
  const reflector = { get: () => ({ limit: 5, windowMs: 60_000 }) } as never;
  return new RateLimitGuard(reflector, redis as never);
}

describe('the rate limiter fails closed when its store is unavailable', () => {
  it('refuses the request when the pipeline reports command errors', async () => {
    const guard = makeGuard(makeRedis({ failing: true }));

    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('refuses on the READ, before any write is attempted', async () => {
    // The assertion that pins the defect. If the guard only fails because zadd
    // rejects, then zadd was called — and the policy depends on statement order
    // rather than on error handling. It must never get that far.
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
});

describe('it still rate limits when the store is healthy', () => {
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
});
