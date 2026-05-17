import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from './redis.module';
import type IORedis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: IORedis) {}

  async onModuleDestroy() {
    this.logger.log('Disconnecting Redis client...');
    await this.redis.quit().catch((err: unknown) => {
      this.logger.warn(`Redis quit error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
}
