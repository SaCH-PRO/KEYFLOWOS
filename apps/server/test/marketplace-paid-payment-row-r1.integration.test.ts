/**
 * V1-85 (FU-MARKETPLACE-PAID-PAYMENT-ROW, P120 R1) — real Postgres regression
 * proofs for dual independent R1 review findings:
 *
 *   - R1-SEC-01 / R1-COR-01: pre-V1-29 positive REFUNDED rows (`status = 'REFUNDED'
 *     AND amount > 0`) on PAID invoices are skipped (revenue stays 0), while
 *     negative REFUNDED rows (`amount < 0`) on rowless PAID invoices remain
 *     eligible and backfill preserves net revenue (D-250 / MT-15).
 *   - R1-COR-02: soft-deleted businesses (`businesses.deleted_at IS NOT NULL`)
 *     are excluded from both dry-run and `--apply`.
 *   - R1-SEC-02: fail-closed `resolveBusinessScope` (empty/blank ids throw;
 *     `businessIds: []` matches 0 rows and never widens to all tenants).
 *   - R1-SEC-03 / R1-COR-04: Postgres float8 `Infinity` / `NaN` and sub-cent
 *     `0.004` PAID invoices are skipped safely; D-13 `roundMoney` and upper-case
 *     currency normalization apply consistently in both writer and backfill.
 *   - R1-COR-03: pre-existing `providerPaymentId` pre-check in
 *     `createRevenueRecord` prevents committing a rowless PAID invoice.
 *   - R1-SEC-04 / R1-SEC-05: closed `stored.status` (CANCELLED/REFUNDED/VOID/
 *     VOIDED) is skipped; `paymentMethod` and `paymentRef` are derived strictly
 *     from `stored` (punctuation-only `'---'` falls back to `'manual'`).
 *   - R1-COR-05: CLI `parseArgs` supports `--dry-run`, rejects `--dry-run` +
 *     `--apply`, supports `--business` alias, and accumulates repeatable
 *     business scope flags.
 *   - `paidAt: null` fallback uses `invoice.createdAt` for `Payment.createdAt`.
 *
 * Fixtures: prefix `v85n_` (registered in `test/helpers/fixture-prefixes.json`);
 * cleaned up via raw SQL with `sqlLikePrefix(P)` in `beforeAll` and `afterAll`.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import {
  backfillProviderPaymentId,
  main as runBackfillCli,
  parseArgs,
  resolveBusinessScope,
  runBackfillPaidInvoicePaymentRows,
} from '../scripts/backfill-paid-invoice-payment-rows';

vi.setConfig({ testTimeout: 60_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v85n_';

const ID = {
  ownerLive: `${P}owner_live`,
  ownerDeleted: `${P}owner_deleted`,
  ownerPeer: `${P}owner_peer`,
  bizLive: `${P}biz_live`,
  bizDeleted: `${P}biz_deleted`,
  bizPeer: `${P}biz_peer`,
  contactLive: `${P}contact_live`,
  contactDeleted: `${P}contact_deleted`,
  contactPeer: `${P}contact_peer`,
};

let db: any;
let prismaService: any;
let integration: any;
let statsService: any;
let readInvoiceMoneyFn: any;
let marketplaceOrderProviderPaymentIdFn: (businessId: string, orderId: string) => string;

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
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { CommerceIntegrationService, marketplaceOrderProviderPaymentId } = await import(
    '../src/modules/marketplace/commerce-integration.service'
  );
  const { CommerceStatsService, readInvoiceMoney } = await import('../src/modules/commerce/commerce-stats.service');

  marketplaceOrderProviderPaymentIdFn = marketplaceOrderProviderPaymentId;
  readInvoiceMoneyFn = readInvoiceMoney;

  prismaService = new PrismaService();
  const crmStub = {
    findOrCreateContact: async (businessId: string) => ({
      id: businessId === ID.bizLive ? ID.contactLive : ID.contactPeer,
    }),
    logContactEvent: async () => undefined,
    addTask: async () => undefined,
  };
  const expensesStub = { createExpense: async () => ({ id: `${P}exp_stub` }) };
  const emailStub = { send: async () => undefined };

  integration = new CommerceIntegrationService(prismaService, crmStub as any, expensesStub as any, emailStub as any);
  statsService = new CommerceStatsService(prismaService);

  await cleanup();

  const now = new Date();
  for (const [userId, bizId, contactId, tag, deletedAt] of [
    [ID.ownerLive, ID.bizLive, ID.contactLive, 'live', null],
    [ID.ownerDeleted, ID.bizDeleted, ID.contactDeleted, 'deleted', now],
    [ID.ownerPeer, ID.bizPeer, ID.contactPeer, 'peer', null],
  ] as const) {
    await db.user.create({
      data: {
        id: userId,
        email: `${P}owner_${tag}@example.test`,
        name: `Owner ${tag}`,
      },
    });
    await db.business.create({
      data: {
        id: bizId,
        name: `V85N Biz ${tag}`,
        slug: `${P}biz-${tag}`,
        ownerId: userId,
        currency: 'TTD',
        accountingBasis: 'CASH',
        deletedAt,
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
        lastName: tag,
        email: `${P}cust_${tag}@example.test`,
        emailNormalized: `${P}cust_${tag}@example.test`,
      },
    });
  }
});

afterAll(async () => {
  await cleanup();
});

describe('P120 R1 review regressions (FU-MARKETPLACE-PAID-PAYMENT-ROW)', () => {
  it('R1-01 & R1-02: legacy positive REFUNDED row is skipped (revenue stays 0), while negative REFUNDED row on rowless PAID invoice is backfilled (net revenue stays 400)', async () => {
    const now = new Date();
    const invPosRefund = `${P}inv_pos_refund`;
    const invNegRefund = `${P}inv_neg_refund`;

    await db.invoice.create({
      data: {
        id: invPosRefund,
        businessId: ID.bizLive,
        contactId: ID.contactLive,
        invoiceNumber: `${P}INV-POS-REF`,
        status: 'PAID',
        subtotal: 100,
        total: 100,
        currency: 'TTD',
        issueDate: now,
        paidAt: now,
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_pos_refund`,
        businessId: ID.bizLive,
        invoiceId: invPosRefund,
        amount: 100,
        currency: 'TTD',
        status: 'REFUNDED',
        provider: 'manual',
        method: 'cash',
        providerPaymentId: `${P}pp_pos_refund`,
        createdAt: now,
      },
    });

    await db.invoice.create({
      data: {
        id: invNegRefund,
        businessId: ID.bizLive,
        contactId: ID.contactLive,
        invoiceNumber: `${P}INV-NEG-REF`,
        status: 'PAID',
        subtotal: 500,
        total: 500,
        currency: 'TTD',
        issueDate: now,
        paidAt: now,
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_neg_refund`,
        businessId: ID.bizLive,
        invoiceId: invNegRefund,
        amount: -100,
        currency: 'TTD',
        status: 'REFUNDED',
        provider: 'manual',
        method: 'cash',
        providerPaymentId: `${P}pp_neg_refund`,
        createdAt: now,
      },
    });

    statsService.invalidateCache(ID.bizLive);
    const statsBefore = await statsService.getCommerceStats(ID.bizLive);
    expect(statsBefore.totalRevenue).toBe(400);

    const dry = await runBackfillPaidInvoicePaymentRows(db, { businessId: ID.bizLive });
    expect(dry.rowlessInvoicesFound).toBe(1);
    expect(dry.wouldWrite).toBe(1);

    const applied = await runBackfillPaidInvoicePaymentRows(db, { apply: true, businessId: ID.bizLive });
    expect(applied.written).toBe(1);
    expect(applied.failed).toBe(0);

    // Positive REFUNDED invoice MUST still have 0 SUCCESSFUL payments and 0 cash
    expect(
      await db.payment.count({ where: { businessId: ID.bizLive, invoiceId: invPosRefund, status: 'SUCCESSFUL' } }),
    ).toBe(0);

    // Negative REFUNDED invoice MUST now have 1 SUCCESSFUL +500 payment alongside -100 REFUNDED
    const negSuccessful = await db.payment.findMany({
      where: { businessId: ID.bizLive, invoiceId: invNegRefund, status: 'SUCCESSFUL' },
    });
    expect(negSuccessful).toHaveLength(1);
    expect(negSuccessful[0].amount).toBe(500);
    expect(negSuccessful[0].providerPaymentId).toBe(backfillProviderPaymentId(ID.bizLive, invNegRefund));

    // Net revenue is unchanged: 0 (pos refund) + 400 (500 - 100) = 400
    statsService.invalidateCache(ID.bizLive);
    const statsAfter = await statsService.getCommerceStats(ID.bizLive);
    expect(statsAfter.totalRevenue).toBe(400);

    const moneyRows = await readInvoiceMoneyFn(db, ID.bizLive);
    const posMoney = moneyRows.find((r: any) => r.id === invPosRefund);
    expect(posMoney.cash).toEqual([]);
  });

  it('R1-03: soft-deleted business with live rowless PAID invoice is excluded from dry-run and --apply', async () => {
    const now = new Date();
    const invDeletedBiz = `${P}inv_del_biz`;

    await db.invoice.create({
      data: {
        id: invDeletedBiz,
        businessId: ID.bizDeleted,
        contactId: ID.contactDeleted,
        invoiceNumber: `${P}INV-DEL-BIZ`,
        status: 'PAID',
        subtotal: 250,
        total: 250,
        currency: 'TTD',
        issueDate: now,
        paidAt: now,
      },
    });

    const dry = await runBackfillPaidInvoicePaymentRows(db, { businessId: ID.bizDeleted });
    expect(dry.invoicesScanned).toBe(0);
    expect(dry.rowlessInvoicesFound).toBe(0);
    expect(dry.wouldWrite).toBe(0);

    const applied = await runBackfillPaidInvoicePaymentRows(db, { apply: true, businessId: ID.bizDeleted });
    expect(applied.invoicesScanned).toBe(0);
    expect(applied.rowlessInvoicesFound).toBe(0);
    expect(applied.written).toBe(0);
    expect(await db.payment.count({ where: { invoiceId: invDeletedBiz } })).toBe(0);
  });

  it('R1-04: fail-closed resolveBusinessScope rejects blank ids and empty businessIds never widens to other tenants', async () => {
    expect(() => resolveBusinessScope({ businessId: '' })).toThrow();
    expect(() => resolveBusinessScope({ businessId: '   ' })).toThrow();
    expect(() => resolveBusinessScope({ businessIds: [''] })).toThrow();
    expect(() => resolveBusinessScope({ businessIds: [ID.bizPeer, '   '] })).toThrow();
    expect(resolveBusinessScope({ businessIds: [] })).toEqual([]);
    expect(resolveBusinessScope({})).toBeNull();

    // Seed a live rowless PAID invoice in bizPeer
    const invPeer = `${P}inv_peer_scope`;
    await db.invoice.create({
      data: {
        id: invPeer,
        businessId: ID.bizPeer,
        contactId: ID.contactPeer,
        invoiceNumber: `${P}INV-PEER-SCOPE`,
        status: 'PAID',
        subtotal: 75,
        total: 75,
        currency: 'TTD',
        issueDate: new Date(),
        paidAt: new Date(),
      },
    });

    await expect(runBackfillPaidInvoicePaymentRows(db, { businessId: '' })).rejects.toThrow();
    await expect(runBackfillPaidInvoicePaymentRows(db, { businessId: '  ' })).rejects.toThrow();
    await expect(runBackfillPaidInvoicePaymentRows(db, { businessIds: [''] })).rejects.toThrow();

    // Empty businessIds array must match 0 rows and NEVER touch bizPeer!
    const emptyResult = await runBackfillPaidInvoicePaymentRows(db, { apply: true, businessIds: [] });
    expect(emptyResult.invoicesScanned).toBe(0);
    expect(emptyResult.rowlessInvoicesFound).toBe(0);
    expect(emptyResult.written).toBe(0);
    expect(await db.payment.count({ where: { invoiceId: invPeer } })).toBe(0);
  });

  it('R1-05 & R1-06: Infinity/NaN/sub-cent PAID invoices are skipped safely; rounding, uppercase currency, and paidAt=null createdAt fallback work', async () => {
    const invInf = `${P}inv_inf`;
    const invNan = `${P}inv_nan`;
    const invSubCent = `${P}inv_subcent`;
    const invNullPaidAt = `${P}inv_null_paid_at`;
    const customCreatedAt = new Date('2025-07-14T09:30:00.000Z');

    // Insert Infinity and NaN directly into Postgres float8 via raw SQL
    await db.$executeRawUnsafe(
      `INSERT INTO invoices (id, invoice_number, status, subtotal, total, currency, issue_date, paid_at, business_id, contact_id, created_at, updated_at)
       VALUES
         ($1, $2, 'PAID'::"InvoiceStatus", 0, 'Infinity'::float8, 'TTD', NOW(), NOW(), $5, $6, NOW(), NOW()),
         ($3, $4, 'PAID'::"InvoiceStatus", 0, 'NaN'::float8, 'TTD', NOW(), NOW(), $5, $6, NOW(), NOW())`,
      invInf,
      `${P}INV-INF`,
      invNan,
      `${P}INV-NAN`,
      ID.bizLive,
      ID.contactLive,
    );

    await db.invoice.create({
      data: {
        id: invSubCent,
        businessId: ID.bizLive,
        contactId: ID.contactLive,
        invoiceNumber: `${P}INV-SUBCENT`,
        status: 'PAID',
        subtotal: 0.004,
        total: 0.004,
        currency: 'TTD',
        issueDate: new Date(),
        paidAt: new Date(),
      },
    });

    await db.invoice.create({
      data: {
        id: invNullPaidAt,
        businessId: ID.bizLive,
        contactId: ID.contactLive,
        invoiceNumber: `${P}INV-NULL-PAIDAT`,
        status: 'PAID',
        subtotal: 1.005,
        total: 1.005,
        currency: ' usd ',
        issueDate: customCreatedAt,
        paidAt: null,
        createdAt: customCreatedAt,
      },
    });

    const dry = await runBackfillPaidInvoicePaymentRows(db, { businessId: ID.bizLive });
    expect(dry.rowlessInvoicesFound).toBe(1);
    expect(dry.wouldWrite).toBe(1);

    const applied = await runBackfillPaidInvoicePaymentRows(db, { apply: true, businessId: ID.bizLive });
    expect(applied.written).toBe(1);
    expect(applied.failed).toBe(0);

    // Infinity, NaN, and sub-cent 0.004 must have 0 Payment rows
    expect(await db.payment.count({ where: { invoiceId: { in: [invInf, invNan, invSubCent] } } })).toBe(0);

    // paidAt: null invoice gets D-13 rounded 1.01, normalized 'USD', and createdAt === invoice.createdAt
    const backfilled = await db.payment.findMany({ where: { invoiceId: invNullPaidAt } });
    expect(backfilled).toHaveLength(1);
    expect(backfilled[0]).toMatchObject({
      businessId: ID.bizLive,
      amount: 1.01,
      currency: 'USD',
      status: 'SUCCESSFUL',
    });
    expect(new Date(backfilled[0].createdAt).toISOString()).toBe(customCreatedAt.toISOString());
  });

  it('R1-07: CLI parseArgs supports --dry-run, rejects --dry-run + --apply, supports --business alias and repeatable scoping', async () => {
    const dryParsed = parseArgs(['--dry-run']);
    expect(dryParsed.error).toBeUndefined();
    expect(dryParsed).toMatchObject({ apply: false, dryRun: true, businessIds: [] });

    expect(parseArgs(['--dry-run', '--apply']).error).toMatch(/--dry-run/);

    const multiParsed = parseArgs(['--business', ID.bizLive, `--business=${ID.bizPeer}`, `--business-id=${ID.bizLive}`]);
    expect(multiParsed.error).toBeUndefined();
    expect(multiParsed).toMatchObject({
      apply: false,
      businessIds: [ID.bizLive, ID.bizPeer],
    });

    // CLI rejects --dry-run --apply with exit 2
    const errs: string[] = [];
    expect(
      await runBackfillCli(['--dry-run', '--apply', `--business=${ID.bizPeer}`], {
        db,
        log: () => undefined,
        error: (...args) => errs.push(args.map(String).join(' ')),
      }),
    ).toBe(2);
    expect(errs.join('\n')).toMatch(/--dry-run/);

    // CLI --dry-run with repeatable --business & --business-id exits 0 and writes nothing
    const logs: string[] = [];
    const paymentsBefore = await db.payment.count({ where: { businessId: ID.bizPeer } });
    expect(
      await runBackfillCli(['--dry-run', `--business=${ID.bizLive}`, '--business-id', ID.bizPeer], {
        db,
        log: (...args) => logs.push(args.map(String).join(' ')),
        error: () => undefined,
      }),
    ).toBe(0);
    expect(logs.join('\n')).toMatch(/DRY RUN/);
    expect(logs.join('\n')).toContain(ID.bizPeer);
    expect(await db.payment.count({ where: { businessId: ID.bizPeer } })).toBe(paymentsBefore);

    // CLI --apply with repeatable flags backfills bizPeer's rowless invoice
    expect(
      await runBackfillCli(['--apply', `--business=${ID.bizLive}`, `--business=${ID.bizPeer}`], {
        db,
        log: () => undefined,
        error: () => undefined,
      }),
    ).toBe(0);
    expect(
      await db.payment.count({ where: { businessId: ID.bizPeer, invoiceId: `${P}inv_peer_scope`, status: 'SUCCESSFUL' } }),
    ).toBe(1);
  });

  it('R1-08: createRevenueRecord pre-checks providerPaymentId before creating invoice, skips closed statuses, uses stored paymentMethod/ref with punctuation fallback, rounds amounts, and normalizes currency', async () => {
    // 1. Pre-existing providerPaymentId prevents creating a rowless PAID invoice
    const ordPreKey = await db.marketplaceOrder.create({
      data: {
        id: `${P}ord_prekey`,
        businessId: ID.bizLive,
        orderNumber: `${P}ORD-PREKEY`,
        type: 'STANDARD',
        status: 'paid',
        paymentStatus: 'PAID',
        paymentMethod: 'CARD',
        customerName: 'Customer live',
        customerEmail: `${P}cust_live@example.test`,
        subtotal: 150,
        total: 150,
        currency: 'TTD',
      },
      include: { items: true },
    });

    const decoyInvoice = await db.invoice.create({
      data: {
        id: `${P}inv_decoy`,
        businessId: ID.bizLive,
        contactId: ID.contactLive,
        invoiceNumber: `${P}INV-DECOY`,
        status: 'PAID',
        subtotal: 150,
        total: 150,
        currency: 'TTD',
        issueDate: new Date(),
        paidAt: new Date(),
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_prekey`,
        businessId: ID.bizLive,
        invoiceId: decoyInvoice.id,
        amount: 150,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'marketplace',
        method: 'card',
        providerPaymentId: marketplaceOrderProviderPaymentIdFn(ID.bizLive, ordPreKey.id),
      },
    });

    await integration.handleOrderPaid({ order: ordPreKey, businessId: ID.bizLive });
    expect(
      await db.invoice.count({ where: { businessId: ID.bizLive, invoiceNumber: `INV-ORD-${ordPreKey.orderNumber}` } }),
      'pre-existing providerPaymentId must prevent creating a rowless PAID invoice',
    ).toBe(0);

    // 2. Closed stored.status (CANCELLED, REFUNDED, VOID, VOIDED) skipped even if paymentStatus is PAID
    for (const closedStatus of ['CANCELLED', 'REFUNDED', 'VOID', 'VOIDED']) {
      const ordClosed = await db.marketplaceOrder.create({
        data: {
          id: `${P}ord_${closedStatus.toLowerCase()}`,
          businessId: ID.bizLive,
          orderNumber: `${P}ORD-${closedStatus}`,
          type: 'STANDARD',
          status: closedStatus,
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
          customerName: 'Customer live',
          customerEmail: `${P}cust_live@example.test`,
          subtotal: 99,
          total: 99,
          currency: 'TTD',
        },
        include: { items: true },
      });
      await integration.handleOrderPaid({ order: ordClosed, businessId: ID.bizLive });
      expect(
        await db.invoice.count({ where: { businessId: ID.bizLive, invoiceNumber: `INV-ORD-${ordClosed.orderNumber}` } }),
        `closed order status ${closedStatus} must not create an invoice`,
      ).toBe(0);
    }

    // 3. Stored paymentMethod '---' -> 'manual', untrusted payload method/ref ignored, currency uppercased, 1.005 rounded to 1.01
    const ordSanitize = await db.marketplaceOrder.create({
      data: {
        id: `${P}ord_sanitize`,
        businessId: ID.bizLive,
        orderNumber: `${P}ORD-SANITIZE`,
        type: 'STANDARD',
        status: 'paid',
        paymentStatus: 'PAID',
        paymentMethod: '---',
        paymentRef: null,
        customerName: 'Customer live',
        customerEmail: `${P}cust_live@example.test`,
        subtotal: 1.005,
        total: 1.005,
        currency: ' usd ',
      },
      include: { items: true },
    });

    // Inject spoofed paymentMethod & paymentRef in event payload — must be ignored in favor of stored!
    await integration.handleOrderPaid({
      order: { ...ordSanitize, paymentMethod: 'spoofed_method', paymentRef: 'spoofed_ref' },
      businessId: ID.bizLive,
    });

    const sanitizedInv = await db.invoice.findFirst({
      where: { businessId: ID.bizLive, invoiceNumber: `INV-ORD-${ordSanitize.orderNumber}` },
    });
    expect(sanitizedInv).toBeTruthy();
    expect(Number(sanitizedInv.total)).toBe(1.01);
    expect(sanitizedInv.currency).toBe('USD');

    const sanitizedPayments = await db.payment.findMany({ where: { invoiceId: sanitizedInv.id } });
    expect(sanitizedPayments).toHaveLength(1);
    expect(sanitizedPayments[0]).toMatchObject({
      businessId: ID.bizLive,
      amount: 1.01,
      currency: 'USD',
      method: 'manual',
      reference: null,
      status: 'SUCCESSFUL',
    });

    // 4. Negative stored total refused (0 invoices created)
    const ordNeg = await db.marketplaceOrder.create({
      data: {
        id: `${P}ord_neg`,
        businessId: ID.bizLive,
        orderNumber: `${P}ORD-NEG`,
        type: 'STANDARD',
        status: 'paid',
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        customerName: 'Customer live',
        customerEmail: `${P}cust_live@example.test`,
        subtotal: -50,
        total: -50,
        currency: 'TTD',
      },
      include: { items: true },
    });
    await integration.handleOrderPaid({ order: ordNeg, businessId: ID.bizLive });
    expect(
      await db.invoice.count({ where: { businessId: ID.bizLive, invoiceNumber: `INV-ORD-${ordNeg.orderNumber}` } }),
    ).toBe(0);
  });
});
