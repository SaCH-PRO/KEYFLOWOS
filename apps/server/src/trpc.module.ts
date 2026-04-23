import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as trpcExpress from '@trpc/server/adapters/express';
import { appRouter, type AppContext } from '@keyflow/api';
import { db } from '@keyflow/db';
import { DiagnosticsService } from './modules/diagnostics/diagnostics.service';
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module';

@Module({ imports: [DiagnosticsModule] })
export class TrpcModule implements NestModule {
  constructor(
    private readonly events: EventEmitter2,
    private readonly diagnosticsService: DiagnosticsService,
  ) {}

  configure(consumer: MiddlewareConsumer) {
    const diagnostics = this.diagnosticsService;
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
              diagnostics,
            };
          },
        }),
      )
      .forRoutes({ path: '/trpc', method: RequestMethod.ALL });
  }
}
