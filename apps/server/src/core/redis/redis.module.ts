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
 * THE PART THAT MATTERS MORE THAN CI
 * ----------------------------------
 * A blocking connect means that if Redis is down, the API CANNOT RESTART. Not
 * "background jobs stop" — the whole server fails to come up, during exactly
 * the incident when you are trying to bring it back. lazyConnect turns that
 * into what the docs already promised: the API serves, and the features that
 * need Redis are the ones that suffer.
 *
 * The default URL is KEPT. It is right for local development and matches
 * docker-compose; the defect was never the value, it was connecting eagerly and
 * retrying forever on the way up.
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
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          // The whole fix. Construction no longer opens a socket, so a Redis
          // that is missing or down cannot hold the boot open; the connection
          // is made on first use and retried in the background from there.
          lazyConnect: true,
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
