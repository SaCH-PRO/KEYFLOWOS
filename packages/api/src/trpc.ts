import { initTRPC } from '@trpc/server';
import type { db as DbClient } from '@keyflow/db';

// This context is created by NestJS and passed to your resolvers
export type AppContext = {
  db: typeof DbClient;
  // Auth context (populated by guards)
  user?: { id: string; email: string };
  business?: { id: string; role: string };
};

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

// You can create protected procedures here for later use
// export const protectedProcedure = t.procedure.use(...)
