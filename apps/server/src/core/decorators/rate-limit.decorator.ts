import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'RATE_LIMIT';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export const RateLimit = (limit: number, windowMs = 60_000) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowMs } as RateLimitOptions);
