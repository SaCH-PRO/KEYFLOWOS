import { router } from './trpc';

// Import routers here
// import { identityRouter } from './routers/identity';

export const appRouter = router({
  // identity: identityRouter,
});

export type AppRouter = typeof appRouter;