/**
 * Standalone CLI entrypoint for the calendar backfill.
 *
 *   pnpm --filter server exec tsx src/modules/calendar/backfill.cli.ts [businessId]
 *
 * Bootstraps a Nest application context, resolves CalendarBackfillService
 * via DI, and runs the projection against the configured DATABASE_URL.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { CalendarBackfillService } from './backfill';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const svc = app.get(CalendarBackfillService);
    const businessId = process.argv[2];
    const stats = await svc.run(businessId ? { businessId } : {});
     
    console.log(JSON.stringify(stats, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
   
  console.error('calendar backfill failed', err);
  process.exit(1);
});
