import { initTRPC, type ProcedureBuilder } from '@trpc/server';
import type { db as DbClient } from '@keyflow/db';

export type EventBus = {
  emit: (event: string, payload: any) => void;
};

export type DiagnosticsRunner = {
  runFullDiagnostics: () => Promise<any>;
  checkInfrastructure: () => Promise<any>;
  checkModules: () => Promise<any>;
  checkIntegrations: () => Promise<any>;
  checkCrossModuleFlows: () => Promise<any>;
  checkEnvVars: () => Promise<any>;
  runSingleCheck: (checkName: string) => Promise<any>;
};

// This context is created by NestJS and passed to your resolvers
export type AppContext = {
  db: typeof DbClient;
  eventBus: EventBus;
  diagnostics?: DiagnosticsRunner;
  // Auth context (populated by guards)
  user?: { id: string; email: string; role?: string };
  business?: { id: string; role: string };
};

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

export const protectedProcedure: ProcedureBuilder<any> = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new Error('Unauthorized');
  }
  return next({ ctx });
});

export const superAdminProcedure: ProcedureBuilder<any> = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || ctx.user.role !== 'SUPER_ADMIN') {
    throw new Error('Forbidden');
  }
  return next({ ctx });
});
