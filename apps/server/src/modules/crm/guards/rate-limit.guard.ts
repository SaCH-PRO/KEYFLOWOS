import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const RATE_LIMIT_KEY = 'CRM_RATE_LIMIT';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export const CrmRateLimit = (limit: number, windowMs = 60_000) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowMs } as RateLimitOptions);

const buckets = new Map<string, number[]>();

const CLEANUP_INTERVAL = 5 * 60_000;
let lastCleanup = Date.now();

function cleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, timestamps] of buckets) {
    const filtered = timestamps.filter((t) => now - t < 120_000);
    if (filtered.length === 0) {
      buckets.delete(key);
    } else {
      buckets.set(key, filtered);
    }
  }
}

@Injectable()
export class CrmRateLimitGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.reflector) return true;

    const opts = this.reflector.get<RateLimitOptions>(RATE_LIMIT_KEY, context.getHandler());
    if (!opts) return true;

    const req = context.switchToHttp().getRequest();
    const businessId = req.params?.businessId ?? 'global';
    const ip = req.ip ?? req.connection?.remoteAddress ?? 'unknown';
    const handler = context.getHandler().name;

    const key = `${ip}:${businessId}:${handler}`;
    const now = Date.now();

    cleanup(now);

    const timestamps = (buckets.get(key) ?? []).filter((t) => now - t < opts.windowMs);

    if (timestamps.length >= opts.limit) {
      throw new HttpException(
        'Rate limit exceeded. Please slow down and try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    timestamps.push(now);
    buckets.set(key, timestamps);

    return true;
  }
}
