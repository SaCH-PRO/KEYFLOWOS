/**
 * V1-85 (FU-MARKETPLACE-PAID-PAYMENT-ROW, P120; D-249 / D-75 / D-14) — real
 * Postgres integration proof for:
 *
 *   1. Marketplace order writer (`CommerceIntegrationService.handleOrderPaid` /
 *      `createRevenueRecord`): creates the `PAID` invoice and **exactly one**
 *      own-tenant `SUCCESSFUL` `Payment` row inside a single `$transaction`,
 *      with matching `currency`, `amount`, derived `method` (fallback `'manual'`
 *      when absent), skips zero-amount payment rows, is idempotent on sequential
 *      and concurrent replays, and respects tenant boundaries.
 *   2. Operator backfill script (`apps/server/scripts/backfill-paid-invoice-payment-rows.ts`):
 *      dry-run by default (reports per-business counts and writes 0 rows),
 *      business-scoped `--apply` creates exactly one own-tenant `SUCCESSFUL`
 *      `Payment` row per rowless `PAID` invoice (`deletedAt: null`, `total > 0`),
 *      preserves `paidAt ?? createdAt`, ignores foreign-tenant `SUCCESSFUL` rows
 *      (D-75), skips already-paid-with-row / non-PAID / soft-deleted / zero-total
 *      invoices, and is 100% idempotent on re-run.
 *   3. Revenue truth (`readInvoiceMoney`, `CommerceStatsService.getCommerceStats`,
 *      `ReportsService.generateReport`): revenue figures before vs after backfill
 *      are identical, and backfilled + newly written marketplace `PAID` invoices
 *      satisfy `balanceOfStoredRows(...).isFullyPaid === true` without relying on
 *      the D-249 rowless fallback.
 *
 * Fixtures: prefix `v85m_` (registered in `test/helpers/fixture-prefixes.json`);
 * cleaned up via raw SQL with `sqlLikePrefix(P)` in `beforeAll` and `afterAll`.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v85m_';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  ownerC: `${P}ownerC`,
  ownerD: `${P}ownerD`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizC: `${P}bizC`,
  bizD: `${P}bizD`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
  contactC: `${P}contactC`,
  contactD: `${P}contactD`,
  productA: `${P}productA`,
};

let db: any;
let prismaService: any;
let integration: any;
let statsService: any;
let reportsService: any;
let readInvoiceMoneyFn: any;
let balanceOfStoredRowsFn: any;

interface BackfillModule {
  runBackfillPaidInvoicePaymentRows: (
    prisma: any,
    opts?: { apply?: boolean; businessId?: string; businessIds?: readonly string[] },
  ) => Promise<{
    apply: boolean;
    businessId: string | null;
    invoicesScanned: number;
    rowlessInvoicesFound: number;
    wouldWrite: number;
    written: number;
    alreadyPresent: number;
    failed: number;
    failedCodes: string[];
    byBusiness: Record<
      string,
      {
        businessId: string;
        rowlessPaidInvoices: number;
        wouldWrite: number;
        written: number;
        alreadyPresent: number;
        failed: number;
      }
    >;
  }>;
  main: (
    argv: string[],
    deps?: { db?: any; log?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void },
  ) => Promise<number>;
  backfillProviderPaymentId: (businessId: string, invoiceId: string) => string;
}

async function loadBackfillModule(): Promise<BackfillModule> {
  const modPath = '../scripts/backfill-paid-invoice-payment-rows';
  return import(modPath) as Promise<BackfillModule>;
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM credit_notes WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}) OR provider_payment_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM notifications WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_order_items WHERE order_id IN (SELECT id FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabelOf(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), 1).toLocaleDateString('en-TT', {
    year: 'numeric',
    month: 'short',
  });
}

function lastMonthNoon(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 15, 12, 0, 0, 0);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { CommerceIntegrationService } = await import('../src/modules/marketplace/commerce-integration.service');
  const { CommerceStatsService, readInvoiceMoney } = await import('../src/modules/commerce/commerce-stats.service');
  const { balanceOfStoredRows } = await import('../src/modules/commerce/invoice-workflow.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { ReceivablesService } = await import('../src/modules/finance/receivables.service');
  const { LedgerReportingService } = await import('../src/modules/reports/ledger-reporting.service');
  const { ReportsService } = await import('../src/modules/reports/reports.service');

  readInvoiceMoneyFn = readInvoiceMoney;
  balanceOfStoredRowsFn = balanceOfStoredRows;

  prismaService = new PrismaService();
  const crmStub = {
    findOrCreateContact: async (businessId: string, input: { email?: string | null }) => {
      if (input.email) {
        const existing = await db.contact.findFirst({
          where: { businessId, emailNormalized: input.email.toLowerCase(), deletedAt: null },
          select: { id: true },
        });
        if (existing) return existing;
      }
      return { id: businessId === ID.bizA ? ID.contactA : ID.contactB };
    },
    logContactEvent: async () => undefined,
    addTask: async () => undefined,
  };
  const expensesStub = { createExpense: async () => ({ id: `${P}exp_stub` }) };
  const emailStub = { send: async () => undefined };

  integration = new CommerceIntegrationService(prismaService, crmStub as any, expensesStub as any, emailStub as any);
  statsService = new CommerceStatsService(prismaService);

  const coaSeeder = new ChartOfAccountsSeederService(prismaService);
  const ledgerBalance = new LedgerBalanceService(prismaService);
  const receivables = new ReceivablesService(prismaService, coaSeeder);
  const ledgerReporting = new LedgerReportingService(prismaService, ledgerBalance, receivables);
  const aiUsageStub = {
    callAi: async () => ({ content: 'Executive narrative stub', usage: {} }),
  };
  reportsService = new ReportsService(prismaService, aiUsageStub as any, ledgerReporting);

  await cleanup();

  for (const [userId, bizId, contactId, slugSuffix] of [
    [ID.ownerA, ID.bizA, ID.contactA, 'a'],
    [ID.ownerB, ID.bizB, ID.contactB, 'b'],
    [ID.ownerC, ID.bizC, ID.contactC, 'c'],
    [ID.ownerD, ID.bizD, ID.contactD, 'd'],
  ] as const) {
    await db.user.create({
      data: {
        id: userId,
        email: `${P}owner_${slugSuffix}@example.test`,
        name: `Owner ${slugSuffix.toUpperCase()}`,
      },
    });
    await db.business.create({
      data: {
        id: bizId,
        name: `V85M Biz ${slugSuffix.toUpperCase()}`,
        slug: `${P}biz-${slugSuffix}`,
        ownerId: userId,
        currency: 'TTD',
        accountingBasis: 'CASH',
      },
    });
    await db.membership.create({
      data: { userId, businessId: bizId, role: 'OWNER' },
    });
    await db.contact.create({
      data: {
        id: contactId,
        businessId: bizId,
        firstName: 'Customer',
        lastName: slugSuffix.toUpperCase(),
        email: `${P}customer_${slugSuffix}@example.test`,
        emailNormalized: `${P}customer_${slugSuffix}@example.test`,
      },
    });
  }

  await db.product.create({
    data: {
      id: ID.productA,
      businessId: ID.bizA,
      name: 'V85M Marketplace Widget',
      price: 122.75,
      currency: 'USD',
      category: 'PHYSICAL',
      isActive: true,
    },
  });
});

afterAll(async () => {
  await cleanup();
});

describe('P120 / V1-85 FU-MARKETPLACE-PAID-PAYMENT-ROW (D-249 / D-75 / D-14)', () => {
  let primaryOrder: any;
  let primaryInvoiceId: string;

  it('MP-01: marketplace STANDARD PAID order creates PAID invoice + exactly 1 own-tenant SUCCESSFUL Payment row in one transaction (with method derivation, fallback, zero-total skip, and rollback atomicity)', async () => {
    primaryOrder = await db.marketplaceOrder.create({
      data: {
        id: `${P}ord_01`,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-01`,
        type: 'STANDARD',
        status: 'paid',
        paymentStatus: 'PAID',
        paymentMethod: 'BANK_TRANSFER',
        paymentRef: `${P}ext_ref_01`,
        customerName: 'Customer A',
        customerEmail: `${P}customer_a@example.test`,
        subtotal: 245.5,
        taxAmount: 0,
        discountAmount: 0,
        total: 245.5,
        currency: 'USD',
        items: {
          create: [
            {
              productId: ID.productA,
              name: 'V85M Marketplace Widget',
              quantity: 2,
              unitPrice: 122.75,
              total: 245.5,
              currency: 'USD',
            },
          ],
        },
      },
      include: { items: true },
    });

    await integration.handleOrderPaid({ order: primaryOrder, businessId: ID.bizA });

    const invoices = await db.invoice.findMany({
      where: { businessId: ID.bizA, invoiceNumber: `INV-ORD-${primaryOrder.orderNumber}` },
    });
    expect(invoices).toHaveLength(1);
    const inv = invoices[0];
    primaryInvoiceId = inv.id;
    expect(inv.status).toBe('PAID');
    expect(Number(inv.total)).toBe(245.5);
    expect(inv.currency).toBe('USD');
    expect(inv.paidAt).toBeInstanceOf(Date);

    const payments = await db.payment.findMany({
      where: { invoiceId: inv.id },
    });
    expect(payments, 'PAID marketplace invoice must have exactly 1 Payment row').toHaveLength(1);
    expect(payments[0]).toMatchObject({
      businessId: ID.bizA,
      invoiceId: inv.id,
      status: 'SUCCESSFUL',
      amount: 245.5,
      currency: 'USD',
      method: 'bank_transfer',
    });
    expect(payments[0].providerPaymentId).toContain(ID.bizA);
    expect(payments[0].providerPaymentId).toContain(primaryOrder.id);
    expect(Math.abs(new Date(payments[0].createdAt).getTime() - new Date(inv.paidAt).getTime())).toBeLessThan(1000);

    // Fallback when paymentMethod is absent: derives 'manual' cleanly
    const noMethodOrder = await db.marketplaceOrder.create({
      data: {
        id: `${P}ord_nomethod`,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-NOMETHOD`,
        type: 'STANDARD',
        status: 'paid',
        paymentStatus: 'PAID',
        paymentMethod: null,
        customerName: 'Customer A',
        customerEmail: `${P}customer_a@example.test`,
        subtotal: 80,
        total: 80,
        currency: 'TTD',
        items: {
          create: [
            {
              productId: ID.productA,
              name: 'V85M TTD Item',
              quantity: 1,
              unitPrice: 80,
              total: 80,
              currency: 'TTD',
            },
          ],
        },
      },
      include: { items: true },
    });

    await integration.handleOrderPaid({ order: noMethodOrder, businessId: ID.bizA });
    const noMethodInv = await db.invoice.findFirst({
      where: { businessId: ID.bizA, invoiceNumber: `INV-ORD-${noMethodOrder.orderNumber}` },
    });
    expect(noMethodInv).toBeTruthy();
    const noMethodPayments = await db.payment.findMany({ where: { invoiceId: noMethodInv.id } });
    expect(noMethodPayments).toHaveLength(1);
    expect(noMethodPayments[0]).toMatchObject({
      businessId: ID.bizA,
      status: 'SUCCESSFUL',
      amount: 80,
      currency: 'TTD',
      method: 'manual',
    });

    // Zero-amount PAID order: invoice is created, zero-amount Payment row is skipped
    const zeroOrder = await db.marketplaceOrder.create({
      data: {
        id: `${P}ord_zero`,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-ZERO`,
        type: 'STANDARD',
        status: 'paid',
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        customerName: 'Customer A',
        customerEmail: `${P}customer_a@example.test`,
        subtotal: 0,
        total: 0,
        currency: 'TTD',
      },
      include: { items: true },
    });

    await integration.handleOrderPaid({ order: zeroOrder, businessId: ID.bizA });
    const zeroInv = await db.invoice.findFirst({
      where: { businessId: ID.bizA, invoiceNumber: `INV-ORD-${zeroOrder.orderNumber}` },
    });
    expect(zeroInv).toBeTruthy();
    expect(await db.payment.count({ where: { invoiceId: zeroInv.id } })).toBe(0);

    // Atomicity: if payment.create fails inside $transaction, the PAID invoice rolls back too
    const atomicOrder = await db.marketplaceOrder.create({
      data: {
        id: `${P}ord_atomic`,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-ATOMIC`,
        type: 'STANDARD',
        status: 'paid',
        paymentStatus: 'PAID',
        paymentMethod: 'CARD',
        customerName: 'Customer A',
        customerEmail: `${P}customer_a@example.test`,
        subtotal: 199,
        total: 199,
        currency: 'TTD',
      },
      include: { items: true },
    });

    const realPrisma = integration.prisma;
    const origTx = realPrisma.client.$transaction.bind(realPrisma.client);
    const wrappedClient = new Proxy(realPrisma.client, {
      get(cTarget, cProp) {
        if (cProp === '$transaction') {
          return async (fn: any, opts?: any) => {
            if (typeof fn !== 'function') return origTx(fn, opts);
            return origTx(async (tx: any) => {
              const proxiedTx = new Proxy(tx, {
                get(target, prop) {
                  if (prop === 'payment') {
                    return new Proxy(target.payment, {
                      get(pTarget, pProp) {
                        if (pProp === 'create') {
                          return () => Promise.reject(new Error('simulated payment insert failure'));
                        }
                        const val = Reflect.get(pTarget, pProp);
                        return typeof val === 'function' ? val.bind(pTarget) : val;
                      },
                    });
                  }
                  const val = Reflect.get(target, prop);
                  return typeof val === 'function' ? val.bind(target) : val;
                },
              });
              return fn(proxiedTx);
            }, opts);
          };
        }
        const val = Reflect.get(cTarget, cProp, cTarget);
        return typeof val === 'function' ? val.bind(cTarget) : val;
      },
    });
    integration.prisma = { client: wrappedClient };

    try {
      await integration.handleOrderPaid({ order: atomicOrder, businessId: ID.bizA });
    } finally {
      integration.prisma = realPrisma;
    }

    const atomicInvoices = await db.invoice.findMany({
      where: { businessId: ID.bizA, invoiceNumber: `INV-ORD-${atomicOrder.orderNumber}` },
    });
    expect(atomicInvoices, 'failed payment insert must roll back the PAID invoice inside $transaction').toHaveLength(0);
  });

  it('MP-02: replaying or concurrently delivering store_order.paid is idempotent (exactly 1 invoice, 1 payment row)', async () => {
    // Sequential replays of primaryOrder
    await integration.handleOrderPaid({ order: primaryOrder, businessId: ID.bizA });
    await integration.handleOrderPaid({ order: primaryOrder, businessId: ID.bizA });

    const invoices = await db.invoice.findMany({
      where: { businessId: ID.bizA, invoiceNumber: `INV-ORD-${primaryOrder.orderNumber}` },
    });
    expect(invoices).toHaveLength(1);

    const payments = await db.payment.findMany({
      where: { businessId: ID.bizA, invoiceId: primaryInvoiceId },
    });
    expect(payments, 'replayed event must not create duplicate payment rows').toHaveLength(1);

    // Concurrent 3x replay on a brand-new STANDARD PAID order
    const raceOrder = await db.marketplaceOrder.create({
      data: {
        id: `${P}ord_race`,
        businessId: ID.bizA,
        orderNumber: `${P}ORD-RACE`,
        type: 'STANDARD',
        status: 'paid',
        paymentStatus: 'PAID',
        paymentMethod: 'CARD',
        customerName: 'Customer A',
        customerEmail: `${P}customer_a@example.test`,
        subtotal: 310,
        total: 310,
        currency: 'TTD',
      },
      include: { items: true },
    });

    await Promise.all([
      integration.handleOrderPaid({ order: raceOrder, businessId: ID.bizA }),
      integration.handleOrderPaid({ order: raceOrder, businessId: ID.bizA }),
      integration.handleOrderPaid({ order: raceOrder, businessId: ID.bizA }),
    ]);

    const raceInvoices = await db.invoice.findMany({
      where: { businessId: ID.bizA, invoiceNumber: `INV-ORD-${raceOrder.orderNumber}` },
    });
    expect(raceInvoices).toHaveLength(1);

    const racePayments = await db.payment.findMany({
      where: { businessId: ID.bizA, invoiceId: raceInvoices[0].id },
    });
    expect(racePayments, 'concurrent paid events must produce exactly 1 payment row').toHaveLength(1);
    expect(racePayments[0].amount).toBe(310);
    expect(racePayments[0].method).toBe('card');
  });

  it('MP-03: cross-tenant paid event naming bizB for bizA order writes 0 invoices and 0 payments into bizB', async () => {
    const beforeInvoicesB = await db.invoice.count({ where: { businessId: ID.bizB } });
    const beforePaymentsB = await db.payment.count({ where: { businessId: ID.bizB } });

    await integration.handleOrderPaid({ order: primaryOrder, businessId: ID.bizB });

    expect(await db.invoice.count({ where: { businessId: ID.bizB } })).toBe(beforeInvoicesB);
    expect(await db.payment.count({ where: { businessId: ID.bizB } })).toBe(beforePaymentsB);
  });

  // Shared fixtures for MP-04 / MP-05 / MP-06
  const NOW = new Date();
  const LAST_MONTH = lastMonthNoon();
  const C_INV = {
    rowlessNow: `${P}inv_c_rowless_now`,
    rowlessLastMonthUsd: `${P}inv_c_rowless_lm_usd`,
    rowlessFailedPending: `${P}inv_c_rowless_fp`,
    rowlessForeignPaid: `${P}inv_c_rowless_foreign`,
    alreadyPaid: `${P}inv_c_already_paid`,
    draft: `${P}inv_c_draft`,
    sent: `${P}inv_c_sent`,
    pending: `${P}inv_c_pending`,
    voidInv: `${P}inv_c_void`,
    softDeletedPaid: `${P}inv_c_deleted_paid`,
    zeroPaid: `${P}inv_c_zero_paid`,
    bizDRowless: `${P}inv_d_rowless`,
  };

  let statsBeforeC: any;
  let reportBeforeC: any;

  async function seedBackfillFixtures() {
    const mkInv = (
      id: string,
      businessId: string,
      contactId: string,
      status: string,
      total: number,
      extra: Record<string, unknown> = {},
    ) =>
      db.invoice.create({
        data: {
          id,
          businessId,
          contactId,
          invoiceNumber: `${id.toUpperCase()}`,
          status,
          subtotal: total,
          total,
          currency: 'TTD',
          issueDate: NOW,
          items: { create: [{ description: `Line for ${id}`, quantity: 1, unitPrice: total, total }] },
          ...extra,
        },
      });

    // bizC eligible rowless PAID invoices (4 total):
    await mkInv(C_INV.rowlessNow, ID.bizC, ID.contactC, 'PAID', 320, { paidAt: NOW });
    await mkInv(C_INV.rowlessLastMonthUsd, ID.bizC, ID.contactC, 'PAID', 175.25, {
      currency: 'USD',
      paidAt: LAST_MONTH,
      issueDate: LAST_MONTH,
    });
    await mkInv(C_INV.rowlessFailedPending, ID.bizC, ID.contactC, 'PAID', 90, { paidAt: NOW });
    await db.payment.createMany({
      data: [
        {
          id: `${P}pay_fp_pending`,
          businessId: ID.bizC,
          invoiceId: C_INV.rowlessFailedPending,
          amount: 90,
          currency: 'TTD',
          status: 'PENDING',
          provider: 'manual',
          method: 'cash',
          providerPaymentId: `${P}pp_fp_pending`,
        },
        {
          id: `${P}pay_fp_failed`,
          businessId: ID.bizC,
          invoiceId: C_INV.rowlessFailedPending,
          amount: 90,
          currency: 'TTD',
          status: 'FAILED',
          provider: 'manual',
          method: 'card',
          providerPaymentId: `${P}pp_fp_failed`,
        },
      ],
    });

    // D-75: foreign-tenant SUCCESSFUL payment on bizC's PAID invoice must NOT hide it
    await mkInv(C_INV.rowlessForeignPaid, ID.bizC, ID.contactC, 'PAID', 140, { paidAt: NOW });
    await db.payment.create({
      data: {
        id: `${P}pay_foreign_d_on_c`,
        businessId: ID.bizD,
        invoiceId: C_INV.rowlessForeignPaid,
        amount: 140,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'manual',
        method: 'cash',
        providerPaymentId: `${P}pp_foreign_d_on_c`,
        createdAt: NOW,
      },
    });

    // bizC PAID invoice that ALREADY has an own-tenant SUCCESSFUL row (must NOT be touched):
    await mkInv(C_INV.alreadyPaid, ID.bizC, ID.contactC, 'PAID', 500, { paidAt: NOW });
    await db.payment.create({
      data: {
        id: `${P}pay_already_paid`,
        businessId: ID.bizC,
        invoiceId: C_INV.alreadyPaid,
        amount: 500,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_already_paid`,
        createdAt: NOW,
      },
    });

    // bizC ineligible invoices: DRAFT, SENT, PENDING, VOID, soft-deleted PAID, zero-total PAID
    await mkInv(C_INV.draft, ID.bizC, ID.contactC, 'DRAFT', 100);
    await mkInv(C_INV.sent, ID.bizC, ID.contactC, 'SENT', 200);
    await mkInv(C_INV.pending, ID.bizC, ID.contactC, 'PENDING', 150);
    await mkInv(C_INV.voidInv, ID.bizC, ID.contactC, 'VOID', 75);
    await mkInv(C_INV.softDeletedPaid, ID.bizC, ID.contactC, 'PAID', 600, { paidAt: NOW, deletedAt: NOW });
    await mkInv(C_INV.zeroPaid, ID.bizC, ID.contactC, 'PAID', 0, { paidAt: NOW });

    // bizD rowless PAID invoice (1 total):
    await mkInv(C_INV.bizDRowless, ID.bizD, ID.contactD, 'PAID', 410, {
      paidAt: LAST_MONTH,
      issueDate: LAST_MONTH,
    });
  }

  it('MP-04: backfill script dry-run (default) reports accurate per-business counts and writes ZERO rows', async () => {
    await seedBackfillFixtures();

    statsService.invalidateCache(ID.bizC);
    statsBeforeC = await statsService.getCommerceStats(ID.bizC);
    reportBeforeC = await reportsService.generateReport(ID.bizC, 'executive');

    const paymentsBefore = await db.payment.count({
      where: { businessId: { in: [ID.bizC, ID.bizD] } },
    });

    const backfill = await loadBackfillModule();
    // Default (apply omitted) -> dry-run
    const dryRun = await backfill.runBackfillPaidInvoicePaymentRows(db, {
      businessIds: [ID.bizC, ID.bizD],
    });

    expect(dryRun.apply).toBe(false);
    expect(dryRun.rowlessInvoicesFound).toBe(5);
    expect(dryRun.wouldWrite).toBe(5);
    expect(dryRun.written).toBe(0);
    expect(dryRun.failed).toBe(0);
    expect(dryRun.byBusiness[ID.bizC]).toMatchObject({
      businessId: ID.bizC,
      rowlessPaidInvoices: 4,
      wouldWrite: 4,
      written: 0,
    });
    expect(dryRun.byBusiness[ID.bizD]).toMatchObject({
      businessId: ID.bizD,
      rowlessPaidInvoices: 1,
      wouldWrite: 1,
      written: 0,
    });

    const paymentsAfterDryRun = await db.payment.count({
      where: { businessId: { in: [ID.bizC, ID.bizD] } },
    });
    expect(paymentsAfterDryRun, 'dry-run must write 0 Payment rows').toBe(paymentsBefore);

    // CLI dry-run scoped to bizC
    const logs: string[] = [];
    const errors: string[] = [];
    const exitCode = await backfill.main([`--business-id=${ID.bizC}`], {
      db,
      log: (...args) => logs.push(args.map(String).join(' ')),
      error: (...args) => errors.push(args.map(String).join(' ')),
    });
    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(logs.join('\n')).toMatch(/DRY RUN/);
    expect(logs.join('\n')).toContain(ID.bizC);
    expect(await db.payment.count({ where: { businessId: { in: [ID.bizC, ID.bizD] } } })).toBe(paymentsBefore);

    // CLI unknown flag returns exit code 2 and writes nothing
    const badErrors: string[] = [];
    const badCode = await backfill.main(['--unknown-flag'], {
      db,
      log: () => undefined,
      error: (...args) => badErrors.push(args.map(String).join(' ')),
    });
    expect(badCode).toBe(2);
    expect(badErrors.length).toBeGreaterThan(0);
  });

  it('MP-05: business-scoped --apply backfills only eligible rowless PAID invoices (D-75 aware, preserves paidAt/currency), leaves other tenants untouched, and is 100% idempotent on re-run', async () => {
    const backfill = await loadBackfillModule();

    // Apply scoped strictly to bizC
    const applyC = await backfill.runBackfillPaidInvoicePaymentRows(db, {
      apply: true,
      businessId: ID.bizC,
    });

    expect(applyC.apply).toBe(true);
    expect(applyC.businessId).toBe(ID.bizC);
    expect(applyC.rowlessInvoicesFound).toBe(4);
    expect(applyC.written).toBe(4);
    expect(applyC.failed).toBe(0);
    expect(applyC.byBusiness[ID.bizC]).toMatchObject({
      businessId: ID.bizC,
      rowlessPaidInvoices: 4,
      written: 4,
      failed: 0,
    });
    expect(applyC.byBusiness[ID.bizD]).toBeUndefined();

    // bizD must NOT have been touched by bizC-scoped apply
    expect(
      await db.payment.count({ where: { businessId: ID.bizD, invoiceId: C_INV.bizDRowless, status: 'SUCCESSFUL' } }),
      'bizD rowless PAID invoice must remain untouched during bizC-scoped apply',
    ).toBe(0);

    // Verify all 4 backfilled invoices in bizC
    for (const [invoiceId, expectedAmount, expectedCurrency, expectedDate] of [
      [C_INV.rowlessNow, 320, 'TTD', NOW],
      [C_INV.rowlessLastMonthUsd, 175.25, 'USD', LAST_MONTH],
      [C_INV.rowlessFailedPending, 90, 'TTD', NOW],
      [C_INV.rowlessForeignPaid, 140, 'TTD', NOW],
    ] as const) {
      const ownSuccessful = await db.payment.findMany({
        where: { businessId: ID.bizC, invoiceId, status: 'SUCCESSFUL' },
      });
      expect(ownSuccessful, `invoice ${invoiceId} must have exactly 1 own-tenant SUCCESSFUL payment`).toHaveLength(1);
      expect(ownSuccessful[0]).toMatchObject({
        businessId: ID.bizC,
        invoiceId,
        amount: expectedAmount,
        currency: expectedCurrency,
        status: 'SUCCESSFUL',
        providerPaymentId: backfill.backfillProviderPaymentId(ID.bizC, invoiceId),
      });
      expect(Math.abs(new Date(ownSuccessful[0].createdAt).getTime() - expectedDate.getTime())).toBeLessThan(1000);
    }

    // Invoice that already had an own-tenant SUCCESSFUL payment must remain untouched
    const alreadyPaidRows = await db.payment.findMany({
      where: { businessId: ID.bizC, invoiceId: C_INV.alreadyPaid },
    });
    expect(alreadyPaidRows).toHaveLength(1);
    expect(alreadyPaidRows[0].id).toBe(`${P}pay_already_paid`);

    // Ineligible invoices (DRAFT, SENT, PENDING, VOID, soft-deleted PAID, zero-total PAID) have 0 payment rows
    for (const skippedId of [
      C_INV.draft,
      C_INV.sent,
      C_INV.pending,
      C_INV.voidInv,
      C_INV.softDeletedPaid,
      C_INV.zeroPaid,
    ]) {
      expect(
        await db.payment.count({ where: { invoiceId: skippedId } }),
        `ineligible invoice ${skippedId} must not be backfilled`,
      ).toBe(0);
    }

    // 2nd --apply run on bizC: 100% idempotent (0 additional rows)
    const countAfterFirstApply = await db.payment.count({ where: { businessId: ID.bizC } });
    const applyC2 = await backfill.runBackfillPaidInvoicePaymentRows(db, {
      apply: true,
      businessId: ID.bizC,
    });
    expect(applyC2.rowlessInvoicesFound).toBe(0);
    expect(applyC2.written).toBe(0);
    expect(applyC2.failed).toBe(0);
    expect(await db.payment.count({ where: { businessId: ID.bizC } })).toBe(countAfterFirstApply);

    // CLI --apply scoped to bizD backfills bizD's 1 rowless PAID invoice and preserves LAST_MONTH paidAt
    const logsD: string[] = [];
    const exitD = await backfill.main(['--apply', `--business-id=${ID.bizD}`], {
      db,
      log: (...args) => logsD.push(args.map(String).join(' ')),
      error: () => undefined,
    });
    expect(exitD).toBe(0);
    expect(logsD.join('\n')).toMatch(/APPLY/);
    const bizDPayments = await db.payment.findMany({
      where: { businessId: ID.bizD, invoiceId: C_INV.bizDRowless, status: 'SUCCESSFUL' },
    });
    expect(bizDPayments).toHaveLength(1);
    expect(bizDPayments[0].amount).toBe(410);
    expect(monthKeyOf(new Date(bizDPayments[0].createdAt))).toBe(monthKeyOf(LAST_MONTH));

    // Re-running CLI --apply on bizD is idempotent
    const exitD2 = await backfill.main(['--apply', `--business-id=${ID.bizD}`], {
      db,
      log: () => undefined,
      error: () => undefined,
    });
    expect(exitD2).toBe(0);
    expect(await db.payment.count({ where: { businessId: ID.bizD, invoiceId: C_INV.bizDRowless } })).toBe(1);
  });

  it('MP-06: revenue truth (readInvoiceMoney, CommerceStatsService, ReportsService) is identical before vs after backfill and no longer relies on D-249 fallback', async () => {
    statsService.invalidateCache(ID.bizC);
    const statsAfterC = await statsService.getCommerceStats(ID.bizC);
    const reportAfterC = await reportsService.generateReport(ID.bizC, 'executive');

    // TTD revenue: 320 + 90 + 140 + 500 = 1050 (unchanged before vs after backfill)
    expect(statsBeforeC.totalRevenue).toBe(1050);
    expect(statsAfterC.totalRevenue).toBe(statsBeforeC.totalRevenue);
    expect(statsAfterC.monthlyPaid).toBe(statsBeforeC.monthlyPaid);
    expect(statsAfterC.outstandingAmount).toBe(statsBeforeC.outstandingAmount);

    // USD revenue: 175.25 in LAST_MONTH (unchanged before vs after backfill)
    expect(statsBeforeC.byCurrency.USD.totalRevenue).toBe(175.25);
    expect(statsAfterC.byCurrency.USD.totalRevenue).toBe(statsBeforeC.byCurrency.USD.totalRevenue);
    const lmLabel = monthLabelOf(LAST_MONTH);
    const usdBeforeLm = statsBeforeC.byCurrency.USD.revenueByMonth.find((m: any) => m.month === lmLabel);
    const usdAfterLm = statsAfterC.byCurrency.USD.revenueByMonth.find((m: any) => m.month === lmLabel);
    expect(usdBeforeLm?.revenue).toBe(175.25);
    expect(usdAfterLm?.revenue).toBe(usdBeforeLm?.revenue);

    // ReportsService executive summary figures identical before vs after backfill
    expect(reportAfterC.metrics.revenue.total).toBe(reportBeforeC.metrics.revenue.total);
    expect(reportAfterC.metrics.revenue.outstanding).toBe(reportBeforeC.metrics.revenue.outstanding);

    // Every non-zero live PAID invoice in bizC now settles strictly from its own-tenant Payment rows (no D-249 fallback!)
    const moneyRowsC = await readInvoiceMoneyFn(db, ID.bizC);
    for (const id of [
      C_INV.rowlessNow,
      C_INV.rowlessLastMonthUsd,
      C_INV.rowlessFailedPending,
      C_INV.rowlessForeignPaid,
      C_INV.alreadyPaid,
    ]) {
      const m = moneyRowsC.find((r: any) => r.id === id);
      expect(m, `readInvoiceMoney entry for ${id}`).toBeTruthy();
      const ownRows = await db.payment.findMany({
        where: { businessId: ID.bizC, invoiceId: id },
        select: { amount: true, status: true },
      });
      const bal = balanceOfStoredRowsFn(m.total, ownRows, m.currency);
      expect(bal.isFullyPaid, `invoice ${id} must settle from own-tenant Payment rows without D-249 fallback`).toBe(true);
      expect(bal.net).toBe(m.total);
      expect(m.cash).toHaveLength(1);
      expect(m.cash[0].amount).toBe(m.total);
    }

    // Newly written marketplace PAID invoice (MP-01) also settles purely from its own Payment row without D-249 fallback
    const moneyRowsA = await readInvoiceMoneyFn(db, ID.bizA);
    const primaryMoney = moneyRowsA.find((r: any) => r.id === primaryInvoiceId);
    expect(primaryMoney).toBeTruthy();
    const ownRowsA = await db.payment.findMany({
      where: { businessId: ID.bizA, invoiceId: primaryInvoiceId },
      select: { amount: true, status: true },
    });
    const primaryBal = balanceOfStoredRowsFn(primaryMoney.total, ownRowsA, primaryMoney.currency);
    expect(primaryBal.isFullyPaid).toBe(true);
    expect(primaryBal.net).toBe(245.5);
    expect(primaryMoney.cash).toHaveLength(1);
    expect(primaryMoney.cash[0].amount).toBe(245.5);
  });
});
