/* eslint-disable no-console */
/**
 * scripts/finance-backfill-revenue.ts — FIN2 one-shot backfill.
 *
 * Walks every historical Invoice / Payment for the target business(es) in
 * createdAt order and replays the FIN2 posting recipes through the same
 * RevenuePostingService used at write time. Idempotent: posting is keyed
 * by (sourceType, sourceId, kind), so re-running is a no-op for rows
 * already recognised.
 *
 * Usage:
 *   pnpm tsx scripts/finance-backfill-revenue.ts                # all businesses
 *   pnpm tsx scripts/finance-backfill-revenue.ts <businessId>   # one business
 *   DRY_RUN=1 pnpm tsx scripts/finance-backfill-revenue.ts ...  # report only
 *
 * Designed to run against a quiet window (no live writes) to avoid racing
 * the on-line wiring; the externalRef dedupe makes a race safe but the
 * progress numbers below assume serial execution.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../apps/server/src/app.module';
import { PrismaService } from '../apps/server/src/core/prisma/prisma.service';
import { RevenuePostingService } from '../apps/server/src/modules/finance/revenue-posting.service';
import { ChartOfAccountsSeederService } from '../apps/server/src/modules/finance/chart-of-accounts-seeder.service';
import { FinancialAccountSeederService } from '../apps/server/src/modules/finance/financial-account-seeder.service';

interface Counts {
  invoicesPosted: number;
  invoicesSkipped: number;
  invoicesReversed: number;
  paymentsPosted: number;
  paymentsSkipped: number;
  paymentsReversed: number;
  errors: number;
}

async function backfillBusiness(
  businessId: string,
  prisma: PrismaService,
  posting: RevenuePostingService,
  coa: ChartOfAccountsSeederService,
  fa: FinancialAccountSeederService,
  dryRun: boolean,
  logger: Logger,
): Promise<Counts> {
  const counts: Counts = {
    invoicesPosted: 0,
    invoicesSkipped: 0,
    invoicesReversed: 0,
    paymentsPosted: 0,
    paymentsSkipped: 0,
    paymentsReversed: 0,
    errors: 0,
  };

  // Make sure the system COA + default financial accounts exist before we
  // try to post — otherwise the very first call will fail with a missing
  // systemKey and abort the whole run.
  await coa.ensureDefaults(businessId);
  await fa.ensureDefaults(businessId);

  const invoices = await prisma.client.invoice.findMany({
    where: { businessId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, status: true, total: true, invoiceNumber: true },
  });
  for (const inv of invoices) {
    try {
      if (inv.status === 'DRAFT') {
        counts.invoicesSkipped++;
        continue;
      }
      if (inv.status === 'VOID') {
        if (!dryRun) {
          await posting.onInvoiceFinalized(inv.id);
          await posting.onInvoiceVoided(inv.id);
        }
        counts.invoicesReversed++;
        continue;
      }
      if (!dryRun) await posting.onInvoiceFinalized(inv.id);
      counts.invoicesPosted++;
    } catch (err) {
      counts.errors++;
      logger.error(
        `[${businessId}] invoice ${inv.invoiceNumber}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const payments = await prisma.client.payment.findMany({
    where: { businessId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      provider: true,
      providerPaymentId: true,
      reference: true,
      invoiceId: true,
    },
  });
  for (const p of payments) {
    try {
      if (p.status === 'SUCCESSFUL') {
        if (!dryRun) await posting.onPaymentRecorded(p.id);
        counts.paymentsPosted++;
      } else if (p.status === 'REFUNDED') {
        // Resolve the original SUCCESSFUL payment this refund row applies
        // to so we reverse its ledger posting (refund rows themselves
        // don't have a "payment_recorded" txn to look up). Most refunds
        // carry the original provider id in `reference`; fall back to a
        // best-effort lookup by invoice id.
        const lookupIds = [p.reference].filter((v): v is string => !!v);
        const original = await prisma.client.payment.findFirst({
          where: {
            businessId,
            invoiceId: p.invoiceId,
            status: 'SUCCESSFUL',
            ...(lookupIds.length > 0
              ? {
                  OR: [
                    { providerPaymentId: { in: lookupIds } },
                    { reference: { in: lookupIds } },
                  ],
                }
              : {}),
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, providerPaymentId: true },
        });
        if (!original) {
          counts.errors++;
          logger.warn(
            `[${businessId}] refund ${p.providerPaymentId}: no SUCCESSFUL original payment found (invoiceId=${p.invoiceId}); skipping`,
          );
          continue;
        }
        if (!dryRun) {
          // Make sure the original is posted (idempotent), then reverse it.
          await posting.onPaymentRecorded(original.id);
          await posting.onPaymentRefunded(original.id);
        }
        counts.paymentsReversed++;
      } else {
        counts.paymentsSkipped++;
      }
    } catch (err) {
      counts.errors++;
      logger.error(
        `[${businessId}] payment ${p.providerPaymentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return counts;
}

async function main() {
  const dryRun = process.env.DRY_RUN === '1';
  const targetBusinessId = process.argv[2];
  const logger = new Logger('FIN2-Backfill');
  logger.log(`Starting FIN2 revenue backfill (dryRun=${dryRun})`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const prisma = app.get(PrismaService);
    const posting = app.get(RevenuePostingService);
    const coa = app.get(ChartOfAccountsSeederService);
    const fa = app.get(FinancialAccountSeederService);

    const businesses = targetBusinessId
      ? [{ id: targetBusinessId }]
      : await prisma.client.business.findMany({ select: { id: true } });

    logger.log(`Target businesses: ${businesses.length}`);
    const total: Counts = {
      invoicesPosted: 0,
      invoicesSkipped: 0,
      invoicesReversed: 0,
      paymentsPosted: 0,
      paymentsSkipped: 0,
      paymentsReversed: 0,
      errors: 0,
    };
    for (const b of businesses) {
      const c = await backfillBusiness(b.id, prisma, posting, coa, fa, dryRun, logger);
      logger.log(
        `[${b.id}] inv posted=${c.invoicesPosted} reversed=${c.invoicesReversed} skipped=${c.invoicesSkipped} ` +
          `pay posted=${c.paymentsPosted} reversed=${c.paymentsReversed} skipped=${c.paymentsSkipped} ` +
          `errors=${c.errors}`,
      );
      for (const k of Object.keys(total) as Array<keyof Counts>) total[k] += c[k];
    }
    logger.log(`DONE — totals: ${JSON.stringify(total)}`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
