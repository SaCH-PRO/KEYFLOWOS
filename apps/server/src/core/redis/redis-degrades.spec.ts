/**
 * The Redis client must be able to FAIL, not just to retry.
 *
 * One option in redis.module.ts decides whether this application can survive
 * its cache being down, and it is a single line that looks like tuning.
 *
 * With `maxRetriesPerRequest: null` and a retryStrategy that always returns a
 * number, ioredis reconnects forever: close() never runs, so the offline
 * command queue is never flushed with an error (event_handler.js:187-215). A
 * command issued while Redis is unreachable then NEVER SETTLES — it neither
 * resolves nor rejects.
 *
 * A promise that never settles is worse than one that rejects, because every
 * piece of error handling in the codebase is written for a rejection. Two were
 * measured, both correct and both unreachable:
 *
 *   temporal-flow-memory.queue.service.ts:34  await this.redis.ping() in
 *     onModuleInit, wrapped in a try/catch that logs "worker disabled" and
 *     returns. The await never came back, so every provider after it in the
 *     module graph waited behind it and the server never started. Measured:
 *     no startup line in 100s; 5.1s once commands could reject.
 *
 *   rate-limit.guard.ts:45-50  documents "if Redis is unavailable, fail closed"
 *     and throws ServiceUnavailableException. pipeline.exec() never rejected,
 *     so a guarded REQUEST hung instead. Measured against a dead Redis:
 *     POST /api/admin/auth/login now returns 503 in 0.11s.
 *
 * Neither guard was missing. Neither had been reached.
 *
 * WHY A SPEC AND NOT A COMMENT
 * ----------------------------
 * `enableOfflineQueue: false` reads like a performance knob. Someone will
 * eventually remove it to "let commands buffer across a restart" — which is a
 * reasonable thing to want and is exactly how this returns. Nothing else would
 * notice: every test mocks Redis, the app boots fine whenever Redis is up, and
 * the failure only appears on a box where it is down.
 *
 * This asserts the options themselves. It needs no Redis and no network, so it
 * runs everywhere and costs nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'redis.module.ts'), 'utf8');

describe('a Redis outage degrades the app rather than stopping it', () => {
  it('disables the offline queue, so commands reject instead of hanging forever', () => {
    expect(
      /enableOfflineQueue:\s*false/.test(source),
      'Without this, a command issued while Redis is down never settles. The ' +
        'server then cannot boot (temporal-flow-memory.queue.service.ts:34 awaits ' +
        'ping in onModuleInit) and rate-limited requests hang instead of failing ' +
        'closed. Both were measured. If you are re-enabling buffering across ' +
        'restarts, bound it — do not simply delete this.',
    ).toBe(true);
  });

  it('does not apply it conditionally', () => {
    // The obvious scoping is `REDIS_URL unset ? disable : keep`, so a configured
    // Redis keeps buffering. Measured: that leaves the worse case broken — with
    // REDIS_URL SET and nothing listening, boot still never completed in 90s.
    // An unset variable is CI. A configured Redis that is down is production
    // during an incident.
    const line = source.split('\n').find((l) => l.includes('enableOfflineQueue')) ?? '';
    expect(
      /\?|&&|\|\||\.\.\./.test(line),
      `enableOfflineQueue is being set conditionally: ${line.trim()}`,
    ).toBe(false);
  });

  it('still satisfies BullMQ, which requires maxRetriesPerRequest to be null', () => {
    // bullmq redis-connection.js:44,78 checks this and nothing else — it never
    // reads enableOfflineQueue. Changing it to a number to make commands give up
    // would break the queues instead.
    expect(/maxRetriesPerRequest:\s*null/.test(source)).toBe(true);
  });

  it('registers an error listener, so a reconnect storm cannot kill the process', () => {
    // ioredis emits 'error' on every failed reconnect. With no listener Node can
    // treat it as an unhandled error event and exit — which would reintroduce at
    // runtime the outage-kills-the-server behaviour just removed from boot.
    expect(/\.on\(\s*['"]error['"]/.test(source)).toBe(true);
  });

  it('connects lazily, so construction alone cannot block startup', () => {
    // Not sufficient on its own — measured, ping() was still pending at 20s with
    // only this — but it is why nothing opens a socket during DI.
    expect(/lazyConnect:\s*true/.test(source)).toBe(true);
  });
});
