/**
 * FIN3 — Backfill historical Expense / PurchaseOrder rows into the
 * ledger. Idempotent: every posting goes through PostingService which
 * dedupes on `(sourceType, sourceId, kind)`, so repeated runs are safe.
 *
 * Usage:
 *   pnpm --filter server exec tsx ../../scripts/finance-backfill-expenses.ts <businessId>
 *   tsx scripts/finance-backfill-expenses.ts <businessId> [--dry-run]
 *
 * Behaviour:
 *   - Expense status=PAID, never a bill -> Dr Op Expense / Cr Cash|Bank|Card
 *   - Expense status=BILL  -> Dr Op Expense / Cr AP
 *   - Expense status=PAID, originally a bill -> Dr Op Expense / Cr AP
 *                                              + Dr AP / Cr Cash
 *   - PurchaseOrder.status=RECEIVED -> Dr Inventory / Cr (Cash|AP)
 *
 * Skips rows that already have a posted FinancialTransaction with the
 * matching external_ref. The "originally a bill" check looks for a
 * pre-existing `FinancialTransaction` with `kind='bill_created'` for the
 * expense (durable marker), falling back to `dueDate != null` so the
 * script remains correct on databases predating that posting.
 */

import { db } from '@keyflow/db';
import { PostingService } from '../apps/server/src/modules/finance/posting.service';
import { ChartOfAccountsSeederService } from '../apps/server/src/modules/finance/chart-of-accounts-seeder.service';
import { ExpensePostingService } from '../apps/server/src/modules/finance/expense-posting.service';
import { PrismaService } from '../apps/server/src/core/prisma/prisma.service';

async function main() {
  const businessId = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!businessId) {
    console.error('Usage: tsx scripts/finance-backfill-expenses.ts <businessId> [--dry-run]');
    process.exit(1);
  }

  // PrismaService.client is `db` from @keyflow/db; instantiating it is
  // enough for runtime use from a script (no Nest lifecycle hooks fire).
  const prisma = new PrismaService();

  const posting = new PostingService(prisma);
  const coa = new ChartOfAccountsSeederService(prisma);
  const expensePosting = new ExpensePostingService(prisma, posting, coa);

  console.log(`[backfill] business=${businessId} dryRun=${dryRun}`);

  // Make sure the COA + category links exist before posting.
  await coa.ensureDefaults(businessId);

  const expenses = await db.expense.findMany({
    where: { businessId, deletedAt: null },
    orderBy: { date: 'asc' },
  });
  console.log(`[backfill] found ${expenses.length} expenses`);

  let postedPaid = 0;
  let postedBillCreated = 0;
  let postedBillPaid = 0;
  let skipped = 0;

  // Pre-load the set of expenses that already have a `bill_created`
  // posting — this is the durable marker that distinguishes a paid bill
  // (status flips BILL → PAID on payment, dropping its old status) from
  // an expense that was paid on the spot.
  const billCreatedRows = await db.financialTransaction.findMany({
    where: {
      businessId,
      sourceType: 'Expense',
      sourceId: { in: expenses.map((e) => e.id) },
      // PostingService stores `${sourceType}:${sourceId}:${kind}` in
      // externalRef; matching the suffix avoids needing a `kind` column.
      externalRef: { endsWith: ':bill_created' },
    },
    select: { sourceId: true },
  });
  const wasBilled = new Set(billCreatedRows.map((r) => r.sourceId).filter((s): s is string => !!s));

  for (const e of expenses) {
    if (e.amount <= 0) {
      skipped += 1;
      continue;
    }
    if (dryRun) continue;

    // Treat as "originally a bill" when there's a prior bill_created
    // posting (durable) OR the row still carries a dueDate (proxy for
    // historical rows posted before bill_created was wired up — bills
    // always set dueDate, plain expenses never do).
    const originallyBill = wasBilled.has(e.id) || e.dueDate != null;

    if (e.status === 'BILL' || originallyBill) {
      const r1 = await expensePosting.onBillCreated({
        id: e.id,
        businessId: e.businessId,
        amount: e.amount,
        currency: e.currency,
        date: e.date,
        categoryId: e.categoryId,
        description: e.description,
        contactId: e.contactId,
        vendor: e.vendor,
      });
      if (r1 && !r1.alreadyPosted) postedBillCreated += 1;

      if (e.paidAt || e.status === 'PAID') {
        const r2 = await expensePosting.onBillPaid({
          id: e.id,
          businessId: e.businessId,
          amount: e.amount,
          currency: e.currency,
          paidAt: e.paidAt ?? e.date,
          paymentMethod: e.paymentMethod,
          description: e.description,
          contactId: e.contactId,
          vendor: e.vendor,
        });
        if (r2 && !r2.alreadyPosted) postedBillPaid += 1;
      }
    } else if (e.status === 'PAID') {
      const r = await expensePosting.onExpensePaid({
        id: e.id,
        businessId: e.businessId,
        amount: e.amount,
        currency: e.currency,
        date: e.date,
        categoryId: e.categoryId,
        paymentMethod: e.paymentMethod,
        description: e.description,
        contactId: e.contactId,
        vendor: e.vendor,
      });
      if (r && !r.alreadyPosted) postedPaid += 1;
    }
  }

  const pos = await db.purchaseOrder.findMany({
    where: { businessId, status: 'RECEIVED' },
    select: {
      id: true,
      businessId: true,
      total: true,
      currency: true,
      receivedAt: true,
      paymentStatus: true,
      supplierName: true,
      poNumber: true,
    },
  });
  console.log(`[backfill] found ${pos.length} received POs`);

  let postedPo = 0;
  for (const po of pos) {
    if (po.total <= 0) continue;
    if (dryRun) continue;
    const r = await expensePosting.onPurchaseOrderReceived({
      id: po.id,
      businessId: po.businessId,
      total: po.total,
      currency: po.currency,
      receivedAt: po.receivedAt ?? new Date(),
      paymentStatus: po.paymentStatus,
      paymentMethod: po.paymentStatus === 'PAID' ? 'bank_transfer' : null,
      supplierName: po.supplierName,
      poNumber: po.poNumber,
    });
    if (r && !r.alreadyPosted) postedPo += 1;
  }

  console.log(
    `[backfill] done — postedPaid=${postedPaid} postedBillCreated=${postedBillCreated} postedBillPaid=${postedBillPaid} postedPo=${postedPo} skipped=${skipped}`,
  );
  await db.$disconnect();
}

main().catch((err) => {
  console.error('[backfill] FATAL', err);
  process.exit(1);
});
