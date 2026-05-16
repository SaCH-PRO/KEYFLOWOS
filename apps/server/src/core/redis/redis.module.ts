import { Module, Global } from '@nestjs/common';
import IORedis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
        return new IORedis(url, {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
