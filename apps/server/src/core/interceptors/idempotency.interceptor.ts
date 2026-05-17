import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  Inject,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { Redis } from 'ioredis';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const LOCK_TTL_SECONDS = 30; // 30 seconds max processing time
const MAX_LOCK_WAIT_MS = 5000; // wait up to 5s for another in-flight request
const LOCK_POLL_MS = 100;

interface CachedResponse {
  statusCode: number;
  body: unknown;
  createdAt: string;
}

/**
 * Idempotency interceptor that deduplicates mutation requests.
 *
 * When a client sends an `Idempotency-Key` header, the interceptor:
 *   1. Checks Redis for a cached response for that key.
 *   2. If cached, returns the cached response immediately.
 *   3. Acquires a short-lived Redis lock to prevent concurrent dupes.
 *   4. Executes the handler, caches the response, and returns it.
 *
 * The key is scoped to the request path + method so a key reused across
 * different endpoints is treated independently.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const rawKey = req.headers[IDEMPOTENCY_KEY_HEADER];

    // Only apply to mutating methods when header is present
    if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
      return next.handle();
    }
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next.handle();
    }

    const key = `idempotency:${req.method}:${req.route?.path ?? req.path}:${rawKey.trim()}`;
    const lockKey = `${key}:lock`;

    // 1. Check cache
    const cached = await this.redis.get(key);
    if (cached) {
      try {
        const parsed: CachedResponse = JSON.parse(cached);
        res.status(parsed.statusCode);
        res.json(parsed.body);
        // Return empty observable so Nest does not continue to the handler
        return new Observable((subscriber) => {
          subscriber.complete();
        });
      } catch {
        // corrupted cache entry, fall through to re-execute
        this.logger.debug(`Idempotency cache corrupted for key ${key}`);
      }
    }

    // 2. Acquire lock (NX = only if not exists)
    const lockAcquired = await this.redis.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS);
    if (lockAcquired !== 'OK') {
      // Another request is processing this key; wait for it to finish
      const waited = await this.waitForLockRelease(key, lockKey);
      if (waited) {
        const cachedAfterWait = await this.redis.get(key);
        if (cachedAfterWait) {
          try {
            const parsed: CachedResponse = JSON.parse(cachedAfterWait);
            res.status(parsed.statusCode);
            res.json(parsed.body);
            return new Observable((subscriber) => {
              subscriber.complete();
            });
          } catch (err) {
            this.logger.warn(`Fall through: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
      // Lock still held or no cached result — proceed with execution
      // (rare race; we will overwrite cache on completion)
    }

    // 3. Execute and cache result
    return next.handle().pipe(
      tap({
        next: async (body) => {
          try {
            const payload: CachedResponse = {
              statusCode: res.statusCode || 200,
              body,
              createdAt: new Date().toISOString(),
            };
            await this.redis.set(key, JSON.stringify(payload), 'EX', IDEMPOTENCY_TTL_SECONDS);
          } catch (err) {
            this.logger.warn(`Non-fatal: idempotency cache write failure should not fail the request: ${err instanceof Error ? err.message : err}`);
          } finally {
            await this.redis.del(lockKey);
          }
        },
        error: async () => {
          // Do not cache errors so the client can retry
          await this.redis.del(lockKey);
        },
      }),
    );
  }

  private async waitForLockRelease(key: string, lockKey: string): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < MAX_LOCK_WAIT_MS) {
      const lock = await this.redis.get(lockKey);
      if (!lock) {
        return true;
      }
      await sleep(LOCK_POLL_MS);
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
