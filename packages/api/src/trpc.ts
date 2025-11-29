import { initTRPC } from '@trpc/server';
import type { db as DbClient } from '@keyflow/db';

export type EventBus = {
  emit: (event: string, payload: any) => void;
};

// This context is created by NestJS and passed to your resolvers
export type AppContext = {
  db: typeof DbClient;
  eventBus: EventBus;
  // Auth context (populated by guards)
  user?: { id: string; email: string };
  business?: { id: string; role: string };
};

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new Error('Unauthorized');
  }
  return next({ ctx });
});
