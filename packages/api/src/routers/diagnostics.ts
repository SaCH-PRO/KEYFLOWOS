import { router, superAdminProcedure } from '../trpc';
import { z } from 'zod';

export const diagnosticsRouter = router({
  runFull: superAdminProcedure.mutation(async ({ ctx }) => {
    if (!ctx.diagnostics) {
      throw new Error('Diagnostics service not available');
    }
    return ctx.diagnostics.runFullDiagnostics();
  }),

  infrastructure: superAdminProcedure.query(async ({ ctx }) => {
    if (!ctx.diagnostics) {
      throw new Error('Diagnostics service not available');
    }
    return ctx.diagnostics.checkInfrastructure();
  }),

  modules: superAdminProcedure.query(async ({ ctx }) => {
    if (!ctx.diagnostics) {
      throw new Error('Diagnostics service not available');
    }
    return ctx.diagnostics.checkModules();
  }),

  integrations: superAdminProcedure.query(async ({ ctx }) => {
    if (!ctx.diagnostics) {
      throw new Error('Diagnostics service not available');
    }
    return ctx.diagnostics.checkIntegrations();
  }),

  crossModule: superAdminProcedure.query(async ({ ctx }) => {
    if (!ctx.diagnostics) {
      throw new Error('Diagnostics service not available');
    }
    return ctx.diagnostics.checkCrossModuleFlows();
  }),

  envVars: superAdminProcedure.query(async ({ ctx }) => {
    if (!ctx.diagnostics) {
      throw new Error('Diagnostics service not available');
    }
    return ctx.diagnostics.checkEnvVars();
  }),

  runCheck: superAdminProcedure
    .input(z.object({ checkName: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.diagnostics) {
        throw new Error('Diagnostics service not available');
      }
      return ctx.diagnostics.runSingleCheck(input.checkName);
    }),

  runCategory: superAdminProcedure
    .input(z.object({ category: z.enum(['infrastructure', 'modules', 'integrations', 'crossModule', 'envVars']) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.diagnostics) {
        throw new Error('Diagnostics service not available');
      }
      switch (input.category) {
        case 'infrastructure': return ctx.diagnostics.checkInfrastructure();
        case 'modules': return ctx.diagnostics.checkModules();
        case 'integrations': return ctx.diagnostics.checkIntegrations();
        case 'crossModule': return ctx.diagnostics.checkCrossModuleFlows();
        case 'envVars': return ctx.diagnostics.checkEnvVars();
      }
    }),
});
