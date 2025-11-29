import { router } from './trpc';
import { identityRouter } from './routers/identity';
import { crmRouter } from './routers/crm';
import { commerceRouter } from './routers/commerce';
import { bookingsRouter } from './routers/bookings';
import { socialRouter } from './routers/social';
import { automationRouter } from './routers/automation';
import { siteRouter } from './routers/site';

export const appRouter = router({
  identity: identityRouter,
  crm: crmRouter,
  commerce: commerceRouter,
  bookings: bookingsRouter,
  social: socialRouter,
  automation: automationRouter,
  site: siteRouter,
});

export type AppRouter = typeof appRouter;
export type { AppContext } from './trpc';
