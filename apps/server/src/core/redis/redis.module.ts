import { Module, Global, Logger } from '@nestjs/common';
import IORedis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';

/**
 * Redis, connected lazily, because it must never decide whether the API starts.
 *
 * WHAT WENT WRONG
 * ---------------
 * `new IORedis(url)` connects EAGERLY, and this factory combined that with
 * `maxRetriesPerRequest: null` and a retryStrategy that always returns a delay —
 * so it retried forever and the process never finished booting. Measured
 * against a Redis that is not listening: no startup line in 100 seconds. With
 * one reachable: 11 seconds.
 *
 * The trigger was the default below. `process.env.REDIS_URL ?? '…localhost:6379'`
 * uses nullish coalescing, so an ABSENT variable becomes a fabricated URL
 * pointing at a Redis that may not exist, converting "not configured, skip it"
 * into "configured and unreachable, retry forever". env.ts:66 declares
 * REDIS_URL optional and :168 warns "BullMQ background jobs will fail to
 * start" — the documented contract is degradation, and this line quietly
 * revoked it.
 *
 * It hid well. Locally REDIS_URL is set, and docker-compose runs a Redis on
 * exactly that default, so the fallback is always correct on a developer
 * machine. It only bites where nothing is listening — CI, or a box where Redis
 * is down.
 *
 * IT WAS NOT THE EAGER CONNECT, AND lazyConnect ALONE DID NOT FIX IT
 * ------------------------------------------------------------------
 * That was the first diagnosis and it was wrong. With lazyConnect added, boot
 * still never completed in 90 seconds against a dead Redis, because the socket
 * was merely deferred to the first command — and the first command is the one
 * that hangs.
 *
 * The real mechanism is below, at enableOfflineQueue. In short: a command
 * issued while Redis is unreachable never settles at all, so
 * `await this.redis.ping()` in TemporalFlowMemoryQueueService.onModuleInit
 * (temporal-flow-memory.queue.service.ts:34) parks forever, and every provider
 * after it in the graph waits behind that one await. Its try/catch was already
 * written to disable the worker and continue; it had simply never been reached.
 *
 * WHY THIS MATTERS MORE THAN CI
 * ----------------------------
 * If Redis is down, the API CANNOT RESTART. Not "background jobs stop" — the
 * whole server fails to come up, during exactly the incident when you are
 * trying to bring it back.
 *
 * The default URL is KEPT. It is right for local development and matches
 * docker-compose; the defect was never the value.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const logger = new Logger('RedisModule');
        const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
        if (!process.env.REDIS_URL) {
          logger.warn(
            `REDIS_URL not set — defaulting to ${url}. Queues and caches will be unavailable if nothing is listening there, but the API will still start.`,
          );
        }

        const client = new IORedis(url, {
          // BullMQ requires this to be null and checks nothing else
          // (bullmq redis-connection.js:44,78), so it stays.
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          // Defers the socket to first use. Necessary but NOT sufficient on its
          // own — measured, ping() was still pending at 20s with only this.
          lazyConnect: true,
          // THE LINE THAT ACTUALLY UNBLOCKS BOOT.
          //
          // With maxRetriesPerRequest: null and a retryStrategy that always
          // returns a number, both of ioredis's give-up paths are disabled: it
          // reconnects forever, so close() never runs, so the command queue is
          // never flushed with an error (ioredis event_handler.js:187-215).
          // A command issued while Redis is unreachable therefore sits in the
          // offline queue and its promise NEVER SETTLES — neither resolving nor
          // rejecting.
          //
          // That is what hung the boot. temporal-flow-memory.queue.service.ts:34
          // does `await this.redis.ping()` in onModuleInit and wraps it in a
          // try/catch that logs "Redis unavailable; worker disabled" and
          // returns — textbook degradation, and unreachable, because the await
          // never came back. Every provider after it in the module graph waited
          // behind that one line.
          //
          // Measured against a dead port: default options -> still pending at
          // 15s; with this -> rejects immediately with "Stream isn't writeable".
          //
          // APPLIED UNCONDITIONALLY, after measuring both ways.
          //
          // The tempting version scopes this to "REDIS_URL unset", on the
          // reasoning that a configured Redis is meant to be there and
          // buffering across a brief restart is desirable. Measured, that
          // version leaves the worse case broken: with REDIS_URL SET and
          // nothing listening, boot still never completed in 90s.
          //
          // And that is the case that matters. An unset variable is a CI or a
          // fresh checkout. A configured Redis that is down is production
          // during an incident — the moment you are trying to restart the API
          // and it refuses to come up because its cache is missing.
          //
          // Unconditional, boot completes in 6.7s and prints "Redis
          // unavailable; temporal flow memory worker disabled" — the
          // degradation the code was already written for, executing for the
          // first time.
          //
          // The cost is real and accepted: during an outage commands reject
          // rather than buffering silently until reconnect. That is the point.
          // Every call site here already wraps Redis work in try/catch built
          // for a rejection; none of them were built for a promise that never
          // settles, because nobody writes code for that.
          enableOfflineQueue: false,
          retryStrategy: (times: number) => {
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
          reconnectOnError: (err: Error) => {
            const targetErrors = ['READONLY', 'ECONNREFUSED', 'ETIMEDOUT'];
            return targetErrors.some((e) => err.message.includes(e));
          },
        });

        // ioredis emits 'error' on every failed reconnect. Without a listener,
        // Node treats it as an unhandled error event and can take the process
        // down — which would reintroduce, at runtime, exactly the failure this
        // module was just stopped from causing at boot.
        //
        // Logged once per minute at most: a Redis that is down produces an
        // error every retry, and thousands of identical lines bury whatever
        // else is being diagnosed at the time.
        let lastLoggedAt = 0;
        client.on('error', (err: Error) => {
          const now = Date.now();
          if (now - lastLoggedAt < 60_000) return;
          lastLoggedAt = now;
          logger.warn(`Redis unavailable (${url}): ${err.message}. Retrying in the background.`);
        });

        return client;
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
