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
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ServiceUnavailableException, HttpException } from '@nestjs/common';
import { PublicRateLimitGuard, publicRateLimitNamespace } from './public-rate-limit.guard';

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

/**
 * R0-00-WT-ISOLATION: the key carries an optional namespace.
 *
 * At c2f6f46d the guard keyed `pub_rate_limit:${ip}:${handler}:${route}` with
 * nothing that identifies the caller's test run. Every suite that counts or
 * resets limits therefore shared one key space: revenue-authorization deleted
 * every `pub_rate_limit:*` key in its teardown, and two suites in one
 * `vitest run` (file parallelism is on) or two worktrees on one Redis index
 * reset or exhausted each other's windows.
 *
 * With RATE_LIMIT_KEY_NAMESPACE set, the key is
 * `pub_rate_limit:<ns>:<ip>:<handler>:<route>`. With it unset (or empty) the key
 * must stay byte-identical to the old one, so production behaviour does not move.
 */
describe('the public rate-limit key carries an optional namespace (R0-00)', () => {
  /** A Redis double that records the key of every command and counts per key. */
  function makeRecordingRedis() {
    const counts = new Map<string, number>();
    const keys: string[] = [];
    return {
      keys,
      counts,
      pipeline: () => {
        const queued: Array<() => [null, number]> = [];
        const p = {
          zremrangebyscore: (key: string) => {
            keys.push(key);
            queued.push(() => [null, 0]);
            return p;
          },
          zcard: (key: string) => {
            keys.push(key);
            queued.push(() => [null, counts.get(key) ?? 0]);
            return p;
          },
          exec: async () => queued.map((q) => q()),
        };
        return p;
      },
      zadd: async (key: string) => {
        keys.push(key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return 1;
      },
      pexpire: async (key: string) => {
        keys.push(key);
        return 1;
      },
    };
  }

  function guardWith(redis: ReturnType<typeof makeRecordingRedis>, limit = 5) {
    const reflector = { get: () => ({ limit, windowMs: 60_000 }) } as never;
    return new PublicRateLimitGuard(reflector, redis as never);
  }

  const saved = process.env.RATE_LIMIT_KEY_NAMESPACE;
  const savedNodeEnv = process.env.NODE_ENV;
  function setNamespace(value: string | undefined) {
    if (value === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
    else process.env.RATE_LIMIT_KEY_NAMESPACE = value;
  }
  function setNodeEnv(value: string | undefined) {
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
  }
  // The namespace is a test-only knob (review SEC-R000-3): every case below
  // runs as NODE_ENV=test unless it says otherwise.
  beforeEach(() => setNodeEnv('test'));
  afterEach(() => {
    setNamespace(saved);
    setNodeEnv(savedNodeEnv);
  });

  it('with the namespace unset, the key is byte-identical to the pre-namespace key', async () => {
    setNamespace(undefined);
    const redis = makeRecordingRedis();

    await expect(guardWith(redis).canActivate(makeContext())).resolves.toBe(true);
    expect([...new Set(redis.keys)]).toEqual(['pub_rate_limit:1.2.3.4:handler:/public/t']);
  });

  it('an empty namespace is treated as unset', async () => {
    setNamespace('');
    const redis = makeRecordingRedis();

    await expect(guardWith(redis).canActivate(makeContext())).resolves.toBe(true);
    expect([...new Set(redis.keys)]).toEqual(['pub_rate_limit:1.2.3.4:handler:/public/t']);
  });

  it('with RATE_LIMIT_KEY_NAMESPACE set, every command of the request uses pub_rate_limit:<ns>:<ip>:<handler>:<route>', async () => {
    setNamespace('k00a_');
    const redis = makeRecordingRedis();

    await expect(guardWith(redis).canActivate(makeContext())).resolves.toBe(true);
    // zremrangebyscore, zcard, zadd and pexpire: four commands, one key.
    expect(redis.keys).toHaveLength(4);
    expect([...new Set(redis.keys)]).toEqual(['pub_rate_limit:k00a_:1.2.3.4:handler:/public/t']);
  });

  it('the namespace is read per request, so a suite may set it after the app is built', async () => {
    setNamespace(undefined);
    const redis = makeRecordingRedis();
    const guard = guardWith(redis);
    setNamespace('k00b_');

    await guard.canActivate(makeContext());
    expect([...new Set(redis.keys)]).toEqual(['pub_rate_limit:k00b_:1.2.3.4:handler:/public/t']);
  });

  it('two namespaces on one Redis count independently: one at its limit does not throttle the other', async () => {
    // The interference this packet removes. One store, one IP, one route; only
    // the namespace differs.
    const redis = makeRecordingRedis();
    const guard = guardWith(redis, 2);

    setNamespace('k00a_');
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    const third = await guard.canActivate(makeContext()).catch((e) => e);
    expect(third).toBeInstanceOf(HttpException);
    expect((third as HttpException).getStatus()).toBe(429);

    setNamespace('k00b_');
    await expect(
      guard.canActivate(makeContext()),
      "a second suite on the same Redis index was throttled by the first suite's window",
    ).resolves.toBe(true);
  });

  it('outside NODE_ENV=test the namespace is ignored: the key is byte-identical to the pre-namespace key (SEC-R000-3)', async () => {
    // This guard covers the unauthenticated surface. A namespace honoured on a
    // deployed instance would reset every public window when set, and multiply
    // the effective limit by the number of distinct namespaces.
    for (const nodeEnv of ['production', 'development', undefined]) {
      setNodeEnv(nodeEnv);
      setNamespace('k00a_');
      const redis = makeRecordingRedis();

      await expect(guardWith(redis).canActivate(makeContext())).resolves.toBe(true);
      expect([...new Set(redis.keys)], `NODE_ENV=${nodeEnv}`).toEqual(['pub_rate_limit:1.2.3.4:handler:/public/t']);
    }
  });

  it('NEGATIVE CONTROL: in production, switching the namespace does not open a fresh window', async () => {
    setNodeEnv('production');
    const redis = makeRecordingRedis();
    const guard = guardWith(redis, 2);

    setNamespace('instance-a');
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);

    setNamespace('instance-b');
    const third = await guard.canActivate(makeContext()).catch((e) => e);
    expect(third, 'a per-instance namespace multiplied the public limit').toBeInstanceOf(HttpException);
    expect((third as HttpException).getStatus()).toBe(429);
  });

  it('publicRateLimitNamespace() reads the variable only under NODE_ENV=test', () => {
    setNamespace('  k00c_  ');
    expect(publicRateLimitNamespace()).toBe('k00c_');
    setNamespace('   ');
    expect(publicRateLimitNamespace()).toBeUndefined();
    setNamespace('k00c_');
    setNodeEnv('production');
    expect(publicRateLimitNamespace()).toBeUndefined();
  });
});
