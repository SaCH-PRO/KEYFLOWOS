import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as trpcExpress from '@trpc/server/adapters/express';
import { appRouter, type AppContext } from '@keyflow/api';
import { db } from '@keyflow/db';

@Module({})
export class TrpcModule implements NestModule {
  constructor(private readonly events: EventEmitter2) {}

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        trpcExpress.createExpressMiddleware({
          router: appRouter,
          createContext: ({ req }): AppContext => {
            const { user, business } = req as any;
            return {
              db,
              user,
              business,
              eventBus: this.events,
            };
          },
        }),
      )
      .forRoutes({ path: '/trpc', method: RequestMethod.ALL });
  }
}
