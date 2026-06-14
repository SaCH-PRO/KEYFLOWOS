import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from './redis.constants';
import type IORedis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: IORedis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds != null) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting Redis client...');
    await this.redis.quit().catch((err: unknown) => {
      this.logger.warn(`Redis quit error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
}
