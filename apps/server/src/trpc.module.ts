import { MiddlewareConsumer, Module, NestModule, RequestMethod, type Type } from '@nestjs/common';
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bridging Express req augmentation to tRPC context
            const { user, business } = req as { user?: any; business?: any };
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

/**
 * D-68 (owner ruling, 2026-11-03): the tRPC endpoint is unmounted by default.
 *
 * AppModule spreads this into its imports instead of naming TrpcModule, so the
 * module, its providers and its /trpc middleware exist only when TRPC_ENABLED
 * is exactly '1'. Anything else (unset, empty, 'true', '0') leaves /trpc
 * answering the same 404 as an unknown route. The router has no web consumer,
 * runs outside the Nest interceptors that fill the tenant context, and carries
 * known holes (V1-26, packages/api/src/routers/crm.contact-detail.spec.ts), so
 * serving it is an explicit operator choice, never a default.
 *
 * Read when AppModule is evaluated: main.ts loads .env before it imports
 * AppModule, so a TRPC_ENABLED set there is seen.
 */
export function trpcModuleImports(flag: string | undefined = process.env.TRPC_ENABLED): Type[] {
  return flag === '1' ? [TrpcModule] : [];
}
