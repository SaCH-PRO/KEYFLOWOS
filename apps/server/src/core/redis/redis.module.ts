import { Module, Global } from '@nestjs/common';
import IORedis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
        return new IORedis(url, {
          maxRetriesPerRequest: null,
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
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
