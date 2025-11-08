import { Module } from '@nestjs/common';
import { TrpcRouterModule } from 'nestjs-trpc';
import { appRouter } from '@keyflow/api';
import { db } from '@keyflow/db';

@Module({
  imports: [
    TrpcRouterModule.forRoot({
      path: '/trpc', // The API path (e.g., http://localhost:3001/trpc)
      router: appRouter,
      createContext: (opts) => {
        // 'opts.req' is the raw Express request
        // This is where we connect our auth guards to the tRPC context
        const { user, business } = (opts.req as any);

        return {
          db,
          user: user, // From JwtAuthGuard (will be added in Module 1)
          business: business, // From BusinessContextMiddleware (will be added in Module 1)
        };
      },
    }),
  ],
})
export class TrpcModule {}