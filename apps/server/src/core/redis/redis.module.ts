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
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          retryStrategy: (times: number) => {
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
          reconnectOnError: (err: Error) => {
            const targetErrors = ['READONLY', 'ECONNREFUSED', 'ETIMEDOUT'];
            return targetErrors.some((e) => err.message.includes(e));
          },
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
