import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../core/redis/redis.module';

@Injectable()
export class CrmCacheService {
  private readonly logger = new Logger(CrmCacheService.name);
  private readonly defaultTtlMs = 60_000;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(`Cache read failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlMs = this.defaultTtlMs): Promise<void> {
    try {
      await this.redis.setex(key, Math.ceil(ttlMs / 1000), JSON.stringify(value));
    } catch (err) {
      this.logger.warn(`Cache write failed for ${key}: ${(err as Error).message}`);
    }
  }

  async invalidate(prefix: string): Promise<void> {
    try {
      const keys = await this.redis.keys(`${prefix}:*`);
      if (keys.length > 0) {
        const pipeline = this.redis.pipeline();
        for (const key of keys) {
          pipeline.del(key);
        }
        await pipeline.exec();
      }
    } catch (err) {
      this.logger.warn(`Cache invalidate failed for ${prefix}: ${(err as Error).message}`);
    }
  }
}
