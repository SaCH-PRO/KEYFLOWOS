import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const PUBLIC_RATE_LIMIT_KEY = 'PUBLIC_RATE_LIMIT';

export interface PublicRateLimitOptions {
  limit: number;
  windowMs: number;
}

export const PublicRateLimit = (limit: number, windowMs = 60_000) =>
  SetMetadata(PUBLIC_RATE_LIMIT_KEY, { limit, windowMs } as PublicRateLimitOptions);

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
export class PublicRateLimitGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.reflector) return true;

    const opts = this.reflector.get<PublicRateLimitOptions>(PUBLIC_RATE_LIMIT_KEY, context.getHandler());
    if (!opts) return true;

    const req = context.switchToHttp().getRequest();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const handler = context.getHandler().name;
    const route = req.route?.path ?? req.url ?? '';

    const key = `pub:${ip}:${handler}:${route}`;
    const now = Date.now();

    cleanup(now);

    const timestamps = (buckets.get(key) ?? []).filter((t) => now - t < opts.windowMs);

    if (timestamps.length >= opts.limit) {
      throw new HttpException(
        'Too many requests. Please try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    timestamps.push(now);
    buckets.set(key, timestamps);

    return true;
  }
}
