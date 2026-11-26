/**
 * P119 — V1-84 (FU-CORTEX-INSIGHT-CASH-TRUTH, P1 launch, D-14, D-13/D-251, D-75):
 *
 * Real Postgres integration proof for KeyCortexInsightService money, cash-in,
 * remaining-balance, credit-note, refund, tenant-isolation, and multi-currency truth.
 *
 * Pre-existing Codex P1 findings on #215:
 *   1. analyzeCashFlow summed Invoice.total for PAID invoices whose updatedAt fell
 *      in the current month — editing a 4-month-old paid invoice counted its full total
 *      as new cash this month, and partial payments (PARTIALLY_PAID / PARTIAL) were ignored.
 *   2. analyzeCashFlow (totalOutstanding, upcomingPaymentsDue), analyzeChurnRisk
 *      (outstandingBalance, overdueBalance), and findProfitOpportunities (overdue invoices)
 *      summed Invoice.total instead of the canonical remaining balance (readInvoiceMoney),
 *      ignored PARTIALLY_CREDITED / applied credit notes, and mixed currencies.
 *   3. analyzeCashFlow's 30-day forecast, expenses, analyzeRevenue, and analyzePipeline
 *      lacked soft-deleted parent invoice exclusion, tenant-scoped relation filtering, and
 *      home-currency scoping (D-13/D-251).
 *
 * Fixtures use prefix `v84k_` (registered in test/helpers/fixture-prefixes.json) and are
 * hard-deleted via raw SQL using `sqlLikePrefix(P)` in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { addDays, startOfMonth, subDays, subMonths } from 'date-fns';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v84k_';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizRefund: `${P}bizRefund`,
  bizCredit: `${P}bizCredit`,
  bizIso: `${P}bizIso`,
  bizFx: `${P}bizFx`,
  bizCents: `${P}bizCents`,
  // Contacts
  cPartial: `${P}c_partial`,
  cRefund: `${P}c_refund`,
  cCredit: `${P}c_credit`,
  cIso: `${P}c_iso`,
  cBizB: `${P}c_bizb`,
  cFx: `${P}c_fx`,
  cFxLead: `${P}c_fx_lead`,
  cCents: `${P}c_cents`,
  // Deal stage
  stageFx: `${P}stage_fx`,
  // Invoices
  invOldPaid: `${P}inv_old_paid`,
  invOldRowlessPaid: `${P}inv_old_rowless`,
  invPartPaid: `${P}inv_part_paid`,
  invLegacyPartial: `${P}inv_legacy_partial`,
  invRef: `${P}inv_ref`,
  invCred: `${P}inv_cred`,
  invCredUpcoming: `${P}inv_cred_up`,
  invLive: `${P}inv_iso_live`,
  invDeleted: `${P}inv_iso_del`,
  invBizB: `${P}inv_bizb`,
  invTtd: `${P}inv_fx_ttd`,
  invUsd: `${P}inv_fx_usd`,
  invUsdUpcoming: `${P}inv_fx_usd_up`,
  invCents: `${P}inv_cents`,
  invOrphanRefund: `${P}inv_orphan_ref`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let prismaService: any;
let db: any;
let insightService: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

async function cleanup() {
  if (!db) return;
  for (const sql of [
    `DELETE FROM credit_notes WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM deals WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM deal_stages WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

describe('P119 (V1-84, FU-CORTEX-INSIGHT-CASH-TRUTH): KeyCortexInsightService cash-in & remaining-balance truth', () => {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const fourMonthsAgo = subMonths(monthStart, 4);
  const twoMonthsAgo = subMonths(monthStart, 2);

  beforeAll(async () => {
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { KeyCortexInsightService } = await import('../src/modules/key-cortex/key-cortex-insight.service');

    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    db = prismaService.client;

    const gatewayStub = {
      complete: async () => {
        throw new Error('v84k: model gateway must not be called in cash-truth integration suite');
      },
    };
    const aiUsageStub = { track: async () => undefined };
    const contextStub = { getFullContext: async () => ({}) };

    insightService = new KeyCortexInsightService(
      prismaService,
      gatewayStub as any,
      aiUsageStub as any,
      contextStub as any,
    );

    await cleanup();

    // Users
    for (const id of [ID.ownerA, ID.ownerB]) {
      await db.user.create({
        data: { id, email: `${P}${id.slice(P.length)}@v84k.test.local`, role: 'USER' },
      });
    }

    // Businesses (all TTD home currency)
    const businesses = [
      { id: ID.bizA, name: 'V84K Biz A', ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizB, name: 'V84K Biz B', ownerId: ID.ownerB, currency: 'TTD' },
      { id: ID.bizRefund, name: 'V84K Biz Refund', ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizCredit, name: 'V84K Biz Credit', ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizIso, name: 'V84K Biz Iso', ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizFx, name: 'V84K Biz FX', ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizCents, name: 'V84K Biz Cents', ownerId: ID.ownerA, currency: 'TTD' },
    ];
    for (const b of businesses) {
      await db.business.create({ data: b });
    }

    // Contacts (lastInteractionAt 70d ago so churn score >= 40 and every client appears in analyzeChurnRisk)
    const contacts = [
      { id: ID.cPartial, businessId: ID.bizA, displayName: 'Pat Partial', email: `${P}pat@v84k.test.local`, status: 'CLIENT', lastInteractionAt: subDays(now, 70) },
      { id: ID.cRefund, businessId: ID.bizRefund, displayName: 'Rita Refund', email: `${P}rita@v84k.test.local`, status: 'CLIENT', lastInteractionAt: subDays(now, 70) },
      { id: ID.cCredit, businessId: ID.bizCredit, displayName: 'Carl Credit', email: `${P}carl@v84k.test.local`, status: 'CLIENT', lastInteractionAt: subDays(now, 70) },
      { id: ID.cIso, businessId: ID.bizIso, displayName: 'Iris Isolation', email: `${P}iris@v84k.test.local`, status: 'CLIENT', lastInteractionAt: subDays(now, 70) },
      { id: ID.cBizB, businessId: ID.bizB, displayName: 'Bob OtherTenant', email: `${P}bob@v84k.test.local`, status: 'CLIENT', lastInteractionAt: subDays(now, 70) },
      { id: ID.cFx, businessId: ID.bizFx, displayName: 'Fiona MultiCurrency', email: `${P}fiona@v84k.test.local`, status: 'CLIENT', lastInteractionAt: subDays(now, 70) },
      { id: ID.cFxLead, businessId: ID.bizFx, displayName: 'Liam FxLead', email: `${P}liam@v84k.test.local`, status: 'LEAD', leadScore: 80, lastInteractionAt: subDays(now, 20), pipelineStage: 'qualified' },
      { id: ID.cCents, businessId: ID.bizCents, displayName: 'Celia Cents', email: `${P}celia@v84k.test.local`, status: 'CLIENT', lastInteractionAt: subDays(now, 70) },
    ];
    for (const c of contacts) {
      await db.contact.create({ data: c });
    }

    // ─── Scenario 1 & 2 (bizA): Edited old paid invoices + PARTIALLY_PAID + legacy PARTIAL ───
    await db.invoice.create({
      data: {
        id: ID.invOldPaid,
        businessId: ID.bizA,
        contactId: ID.cPartial,
        invoiceNumber: `${P}INV-OLD-1`,
        status: 'PAID',
        subtotal: 500,
        total: 500,
        currency: 'TTD',
        createdAt: fourMonthsAgo,
        paidAt: fourMonthsAgo,
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_old_paid`,
        businessId: ID.bizA,
        invoiceId: ID.invOldPaid,
        amount: 500,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_old_paid`,
        createdAt: fourMonthsAgo,
      },
    });

    await db.invoice.create({
      data: {
        id: ID.invOldRowlessPaid,
        businessId: ID.bizA,
        contactId: ID.cPartial,
        invoiceNumber: `${P}INV-OLD-2`,
        status: 'PAID',
        subtotal: 300,
        total: 300,
        currency: 'TTD',
        createdAt: fourMonthsAgo,
        paidAt: fourMonthsAgo,
      },
    });

    // Touch updatedAt TODAY on both 4-month-old paid invoices to reproduce Codex P1 finding #1
    await db.$executeRawUnsafe(
      `UPDATE invoices SET notes = 'edited today', updated_at = NOW() WHERE id IN ('${ID.invOldPaid}', '${ID.invOldRowlessPaid}')`,
    );

    // $100 PARTIALLY_PAID overdue invoice with $90 paid today -> $90 cash-in, $10 remaining & overdue
    await db.invoice.create({
      data: {
        id: ID.invPartPaid,
        businessId: ID.bizA,
        contactId: ID.cPartial,
        invoiceNumber: `${P}INV-PART-1`,
        status: 'PARTIALLY_PAID',
        subtotal: 100,
        total: 100,
        currency: 'TTD',
        createdAt: subDays(now, 20),
        dueDate: subDays(now, 10),
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_part_90`,
        businessId: ID.bizA,
        invoiceId: ID.invPartPaid,
        amount: 90,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_part_90`,
        createdAt: now,
      },
    });

    // $200 legacy PARTIAL upcoming invoice with $140 paid 2 months ago -> $0 cash-in this month, $60 remaining & upcoming
    await db.invoice.create({
      data: {
        id: ID.invLegacyPartial,
        businessId: ID.bizA,
        contactId: ID.cPartial,
        invoiceNumber: `${P}INV-PART-2`,
        status: 'PARTIAL',
        subtotal: 200,
        total: 200,
        currency: 'TTD',
        createdAt: twoMonthsAgo,
        dueDate: addDays(now, 5),
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_legacy_140`,
        businessId: ID.bizA,
        invoiceId: ID.invLegacyPartial,
        amount: 140,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_legacy_140`,
        createdAt: twoMonthsAgo,
      },
    });

    // ─── Scenario 3 (bizRefund): D-14 refunds, legacy positive REFUNDED, PENDING, FAILED ───
    await db.invoice.create({
      data: {
        id: ID.invRef,
        businessId: ID.bizRefund,
        contactId: ID.cRefund,
        invoiceNumber: `${P}INV-REF-1`,
        status: 'PARTIALLY_PAID',
        subtotal: 250,
        total: 250,
        currency: 'TTD',
        createdAt: subDays(now, 15),
        dueDate: subDays(now, 5),
      },
    });
    for (const p of [
      { id: `${P}pay_ref_ok`, status: 'SUCCESSFUL', amount: 250 },
      { id: `${P}pay_ref_neg`, status: 'REFUNDED', amount: -100 },
      { id: `${P}pay_ref_legacy_pos`, status: 'REFUNDED', amount: 77 },
      { id: `${P}pay_ref_pending`, status: 'PENDING', amount: 40 },
      { id: `${P}pay_ref_failed`, status: 'FAILED', amount: 80 },
    ]) {
      await db.payment.create({
        data: {
          ...p,
          businessId: ID.bizRefund,
          invoiceId: ID.invRef,
          currency: 'TTD',
          provider: 'cash',
          method: 'cash',
          providerPaymentId: `${P}pp_${p.id.slice(P.length)}`,
          createdAt: now,
        },
      });
    }

    // ─── Scenario 4 (bizCredit): PARTIALLY_CREDITED with APPLIED + DRAFT + VOID + cross-tenant credit notes ───
    await db.invoice.create({
      data: {
        id: ID.invCred,
        businessId: ID.bizCredit,
        contactId: ID.cCredit,
        invoiceNumber: `${P}INV-CRED-1`,
        status: 'PARTIALLY_CREDITED',
        subtotal: 200,
        total: 200,
        currency: 'TTD',
        createdAt: subDays(now, 20),
        dueDate: subDays(now, 10),
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_cred_30`,
        businessId: ID.bizCredit,
        invoiceId: ID.invCred,
        amount: 30,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_cred_30`,
        createdAt: now,
      },
    });
    await db.creditNote.createMany({
      data: [
        { id: `${P}cn_applied`, businessId: ID.bizCredit, invoiceId: ID.invCred, creditNoteNumber: `${P}CN-1`, status: 'APPLIED', amount: 70 },
        { id: `${P}cn_draft`, businessId: ID.bizCredit, invoiceId: ID.invCred, creditNoteNumber: `${P}CN-2`, status: 'DRAFT', amount: 50 },
        { id: `${P}cn_void`, businessId: ID.bizCredit, invoiceId: ID.invCred, creditNoteNumber: `${P}CN-3`, status: 'VOID', amount: 40 },
        { id: `${P}cn_xtenant`, businessId: ID.bizB, invoiceId: ID.invCred, creditNoteNumber: `${P}CN-X1`, status: 'APPLIED', amount: 60 },
      ],
    });

    await db.invoice.create({
      data: {
        id: ID.invCredUpcoming,
        businessId: ID.bizCredit,
        contactId: ID.cCredit,
        invoiceNumber: `${P}INV-CRED-2`,
        status: 'PARTIALLY_CREDITED',
        subtotal: 150,
        total: 150,
        currency: 'TTD',
        createdAt: subDays(now, 5),
        dueDate: addDays(now, 10),
      },
    });
    await db.creditNote.create({
      data: {
        id: `${P}cn_applied_up`,
        businessId: ID.bizCredit,
        invoiceId: ID.invCredUpcoming,
        creditNoteNumber: `${P}CN-4`,
        status: 'APPLIED',
        amount: 50,
      },
    });

    // ─── Scenario 5 (bizIso + bizB): Soft-deleted invoice & D-75 cross-tenant payment isolation ───
    await db.invoice.create({
      data: {
        id: ID.invLive,
        businessId: ID.bizIso,
        contactId: ID.cIso,
        invoiceNumber: `${P}INV-ISO-1`,
        status: 'SENT',
        subtotal: 100,
        total: 100,
        currency: 'TTD',
        createdAt: subDays(now, 15),
        dueDate: subDays(now, 5),
      },
    });
    // Cross-tenant payment (bizB) pointing at bizIso's live invoice -> must NOT count as cash OR reduce remaining
    await db.payment.create({
      data: {
        id: `${P}pay_iso_xtenant`,
        businessId: ID.bizB,
        invoiceId: ID.invLive,
        amount: 80,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_iso_xtenant`,
        createdAt: now,
      },
    });

    // Soft-deleted invoice on bizIso with a SUCCESSFUL payment today -> must NOT count in cash-in or forecast
    await db.invoice.create({
      data: {
        id: ID.invDeleted,
        businessId: ID.bizIso,
        contactId: ID.cIso,
        invoiceNumber: `${P}INV-ISO-DEL`,
        status: 'PAID',
        subtotal: 500,
        total: 500,
        currency: 'TTD',
        createdAt: now,
        paidAt: now,
        deletedAt: now,
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_iso_del`,
        businessId: ID.bizIso,
        invoiceId: ID.invDeleted,
        amount: 500,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_iso_del`,
        createdAt: now,
      },
    });

    // bizB invoice with both a bizB payment AND a rogue payment stamped with bizIso's businessId
    await db.invoice.create({
      data: {
        id: ID.invBizB,
        businessId: ID.bizB,
        contactId: ID.cBizB,
        invoiceNumber: `${P}INV-BIZB-1`,
        status: 'PARTIALLY_PAID',
        subtotal: 900,
        total: 900,
        currency: 'TTD',
        createdAt: subDays(now, 10),
        dueDate: subDays(now, 5),
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_bizb_own`,
        businessId: ID.bizB,
        invoiceId: ID.invBizB,
        amount: 450,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_bizb_own`,
        createdAt: now,
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_bizb_rogue`,
        businessId: ID.bizIso,
        invoiceId: ID.invBizB,
        amount: 900,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_bizb_rogue`,
        createdAt: now,
      },
    });

    // ─── Scenario 6 (bizFx): Multi-currency book (TTD home + USD rows never summed together) ───
    await db.invoice.create({
      data: {
        id: ID.invTtd,
        businessId: ID.bizFx,
        contactId: ID.cFx,
        invoiceNumber: `${P}INV-FX-TTD`,
        status: 'PARTIALLY_PAID',
        subtotal: 100,
        total: 100,
        currency: 'TTD',
        createdAt: now,
        dueDate: subDays(now, 5),
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_fx_ttd`,
        businessId: ID.bizFx,
        invoiceId: ID.invTtd,
        amount: 40,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_fx_ttd`,
        createdAt: now,
      },
    });

    await db.invoice.create({
      data: {
        id: ID.invUsd,
        businessId: ID.bizFx,
        contactId: ID.cFx,
        invoiceNumber: `${P}INV-FX-USD`,
        status: 'PARTIALLY_PAID',
        subtotal: 500,
        total: 500,
        currency: 'USD',
        createdAt: now,
        dueDate: subDays(now, 5),
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_fx_usd`,
        businessId: ID.bizFx,
        invoiceId: ID.invUsd,
        amount: 200,
        currency: 'USD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_fx_usd`,
        createdAt: now,
      },
    });

    await db.invoice.create({
      data: {
        id: ID.invUsdUpcoming,
        businessId: ID.bizFx,
        contactId: ID.cFx,
        invoiceNumber: `${P}INV-FX-USD-UP`,
        status: 'SENT',
        subtotal: 300,
        total: 300,
        currency: 'USD',
        createdAt: now,
        dueDate: addDays(now, 5),
      },
    });

    await db.expense.createMany({
      data: [
        { id: `${P}exp_fx_ttd`, businessId: ID.bizFx, description: 'TTD supplies', amount: 25, currency: 'TTD', status: 'PAID', date: now },
        { id: `${P}exp_fx_usd`, businessId: ID.bizFx, description: 'USD software', amount: 999, currency: 'USD', status: 'PAID', date: now },
      ],
    });

    await db.dealStage.create({
      data: { id: ID.stageFx, businessId: ID.bizFx, name: 'Qualified', slug: `${P}stage_fx_qualified` },
    });
    await db.deal.createMany({
      data: [
        { id: `${P}deal_fx_ttd`, businessId: ID.bizFx, contactId: ID.cFxLead, stageId: ID.stageFx, title: 'TTD Deal', value: 400, currency: 'TTD', status: 'OPEN' },
        { id: `${P}deal_fx_usd`, businessId: ID.bizFx, contactId: ID.cFxLead, stageId: ID.stageFx, title: 'USD Deal', value: 1000, currency: 'USD', status: 'OPEN' },
      ],
    });

    // ─── Scenario 7 (bizCents): Integer-cents precision & orphan-refund owedCap (D-250) ───
    await db.invoice.create({
      data: {
        id: ID.invCents,
        businessId: ID.bizCents,
        contactId: ID.cCents,
        invoiceNumber: `${P}INV-CENTS-1`,
        status: 'PARTIALLY_PAID',
        subtotal: 100,
        total: 100,
        currency: 'TTD',
        createdAt: subDays(now, 10),
        dueDate: subDays(now, 5),
      },
    });
    for (let i = 1; i <= 3; i++) {
      await db.payment.create({
        data: {
          id: `${P}pay_cents_${i}`,
          businessId: ID.bizCents,
          invoiceId: ID.invCents,
          amount: 33.33,
          currency: 'TTD',
          status: 'SUCCESSFUL',
          provider: 'cash',
          method: 'cash',
          providerPaymentId: `${P}pp_cents_${i}`,
          createdAt: now,
        },
      });
    }

    await db.invoice.create({
      data: {
        id: ID.invOrphanRefund,
        businessId: ID.bizCents,
        contactId: ID.cCents,
        invoiceNumber: `${P}INV-ORPHAN-1`,
        status: 'SENT',
        subtotal: 50,
        total: 50,
        currency: 'TTD',
        createdAt: twoMonthsAgo,
        dueDate: subDays(now, 5),
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_orphan_ref`,
        businessId: ID.bizCents,
        invoiceId: ID.invOrphanRefund,
        amount: -20,
        currency: 'TTD',
        status: 'REFUNDED',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_orphan_ref`,
        createdAt: twoMonthsAgo,
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    if (prismaService) {
      await prismaService.onModuleDestroy?.();
    }
  });

  it('CICT-X01: fixture sanity — real Postgres rows including soft-deleted invoice, cross-tenant payment, and multi-currency rows', async () => {
    const countOf = async (sql: string, ...params: unknown[]) =>
      Number(((await db.$queryRawUnsafe(sql, ...params)) as Array<{ n: number | bigint }>)[0].n);

    expect(insightService.constructor.name).toBe('KeyCortexInsightService');
    expect(await countOf('SELECT count(*) AS n FROM invoices WHERE business_id = $1', ID.bizA)).toBe(4);
    expect(await countOf('SELECT count(*) AS n FROM invoices WHERE business_id = $1 AND deleted_at IS NOT NULL', ID.bizIso)).toBe(1);
    expect(await countOf('SELECT count(*) AS n FROM payments WHERE invoice_id = $1 AND business_id = $2', ID.invLive, ID.bizB)).toBe(1);
    expect(await countOf("SELECT count(*) AS n FROM invoices WHERE business_id = $1 AND currency = 'USD'", ID.bizFx)).toBe(2);
  });

  it('CICT-01 (RED-BEFORE, Codex P1 #1): editing 4-month-old paid invoices today does NOT count as cash-in this month; partial payment today DOES count', async () => {
    const cf = await insightService.analyzeCashFlow(ID.bizA);
    // Only the $90 SUCCESSFUL partial payment made today counts (NOT $500 + $300 from edited 4-month-old paid invoices, NOT $140 paid 2 months ago).
    expect(cf.moneyIn).toBe(90);
    expect(cf.forecast.projectedInflow).toBe(90);
  });

  it('CICT-02 (RED-BEFORE, Codex P1 #2): PARTIALLY_PAID and legacy PARTIAL invoices report remaining balance (NOT invoice.total) across cash flow, churn risk, and profit opportunities', async () => {
    const [cf, risks, opps] = await Promise.all([
      insightService.analyzeCashFlow(ID.bizA),
      insightService.analyzeChurnRisk(ID.bizA),
      insightService.findProfitOpportunities(ID.bizA),
    ]);

    // analyzeCashFlow: upcomingPaymentsDue for $200 PARTIAL invoice with $140 paid must report $60 (not $200)
    expect(cf.upcomingPaymentsDue).toEqual([
      expect.objectContaining({ id: ID.invLegacyPartial, amount: 60 }),
    ]);
    // collectionRate = round(90 / (90 + 70) * 100) = 56 (remaining outstanding = 10 + 60 = 70, NOT 100 + 200 = 300)
    expect(cf.collectionRate).toBe(56);

    // analyzeChurnRisk: $10 remaining overdue on invPartPaid + $60 remaining upcoming on invLegacyPartial = $70 outstanding
    const pat = risks.find((r: any) => r.contactId === ID.cPartial);
    expect(pat).toBeDefined();
    expect(pat.outstandingBalance).toBe(70);
    expect(pat.factors).toContain('$10 overdue balance');
    expect(pat.factors.join(' ')).not.toContain('$100 overdue balance');

    // findProfitOpportunities: overdue PARTIALLY_PAID invoice reports $10 remaining (not omitted, not $100)
    const invOpp = opps.find((o: any) => o.id === `inv-${ID.invPartPaid}`);
    expect(invOpp).toBeDefined();
    expect(invOpp.estimatedValue).toBe(10);
    expect(invOpp.sourceData.amount).toBe(10);
    expect(invOpp.title).toContain('$10');
  });

  it('CICT-03 (RED-BEFORE, D-14): refunded payments net out canonically (negative REFUNDED subtracts; legacy positive REFUNDED, PENDING, and FAILED are excluded)', async () => {
    const [cf, risks, opps] = await Promise.all([
      insightService.analyzeCashFlow(ID.bizRefund),
      insightService.analyzeChurnRisk(ID.bizRefund),
      insightService.findProfitOpportunities(ID.bizRefund),
    ]);

    // +250 SUCCESSFUL - 100 REFUNDED = 150 net cash (ignores +77 legacy REFUNDED, +40 PENDING, +80 FAILED)
    expect(cf.moneyIn).toBe(150);
    expect(cf.forecast.projectedInflow).toBe(150);

    // Remaining on $250 invoice after $150 net paid = $100
    const rita = risks.find((r: any) => r.contactId === ID.cRefund);
    expect(rita).toBeDefined();
    expect(rita.outstandingBalance).toBe(100);
    expect(rita.factors).toContain('$100 overdue balance');

    const refOpp = opps.find((o: any) => o.id === `inv-${ID.invRef}`);
    expect(refOpp).toBeDefined();
    expect(refOpp.estimatedValue).toBe(100);
  });

  it('CICT-04 (RED-BEFORE, credit-aware): APPLIED own-tenant credit notes reduce remaining balance on PARTIALLY_CREDITED invoices; DRAFT/VOID/cross-tenant notes are ignored', async () => {
    const [cf, risks, opps] = await Promise.all([
      insightService.analyzeCashFlow(ID.bizCredit),
      insightService.analyzeChurnRisk(ID.bizCredit),
      insightService.findProfitOpportunities(ID.bizCredit),
    ]);

    // invCred: $200 - $70 APPLIED credit - $30 SUCCESSFUL payment = $100 overdue remaining
    // invCredUpcoming: $150 - $50 APPLIED credit = $100 upcoming remaining
    expect(cf.moneyIn).toBe(30);
    expect(cf.upcomingPaymentsDue).toEqual([
      expect.objectContaining({ id: ID.invCredUpcoming, amount: 100 }),
    ]);

    const carl = risks.find((r: any) => r.contactId === ID.cCredit);
    expect(carl).toBeDefined();
    expect(carl.outstandingBalance).toBe(200);
    expect(carl.factors).toContain('$100 overdue balance');

    const credOpp = opps.find((o: any) => o.id === `inv-${ID.invCred}`);
    expect(credOpp).toBeDefined();
    expect(credOpp.estimatedValue).toBe(100);
  });

  it('CICT-05 (RED-BEFORE, D-75 + soft delete): soft-deleted invoices and cross-tenant payments NEVER leak into cash-in, forecast, outstanding, or opportunities', async () => {
    const [cf, risks, opps] = await Promise.all([
      insightService.analyzeCashFlow(ID.bizIso),
      insightService.analyzeChurnRisk(ID.bizIso),
      insightService.findProfitOpportunities(ID.bizIso),
    ]);

    // Soft-deleted $500 paid invoice, bizB's $450 payment, rogue $900 payment on bizB's invoice,
    // and bizB's $80 payment on bizIso's invoice must ALL be excluded from bizIso's cash-in & forecast.
    expect(cf.moneyIn).toBe(0);
    expect(cf.forecast.projectedInflow).toBe(0);
    expect(cf.upcomingPaymentsDue).toEqual([]);

    // Cross-tenant $80 payment on invLive must NOT reduce invLive's $100 remaining balance.
    const iris = risks.find((r: any) => r.contactId === ID.cIso);
    expect(iris).toBeDefined();
    expect(iris.outstandingBalance).toBe(100);

    const isoOverdueOpps = opps.filter((o: any) => o.type === 'overdue_invoice');
    expect(isoOverdueOpps).toHaveLength(1);
    expect(isoOverdueOpps[0]).toMatchObject({
      id: `inv-${ID.invLive}`,
      estimatedValue: 100,
    });
  });

  it('CICT-06 (RED-BEFORE, D-13/D-251 multi-currency hygiene): TTD home book NEVER adds USD invoices, payments, expenses, or deals into TTD figures', async () => {
    const [cf, risks, opps, rev, pipe] = await Promise.all([
      insightService.analyzeCashFlow(ID.bizFx),
      insightService.analyzeChurnRisk(ID.bizFx),
      insightService.findProfitOpportunities(ID.bizFx),
      insightService.analyzeRevenue(ID.bizFx, 'month'),
      insightService.analyzePipeline(ID.bizFx),
    ]);

    // Cash flow: TTD payment 40 (not +USD 200), TTD expense 25 (not +USD 999), no USD upcoming invoice
    expect(cf.moneyIn).toBe(40);
    expect(cf.moneyOut).toBe(25);
    expect(cf.netFlow).toBe(15);
    expect(cf.forecast.projectedInflow).toBe(40);
    expect(cf.upcomingPaymentsDue).toEqual([]);

    // Churn risk: TTD remaining 60 (100 - 40), NOT +USD 300 / +USD 300; recovery = 100 * 0.3 = 30
    const fiona = risks.find((r: any) => r.contactId === ID.cFx);
    expect(fiona).toBeDefined();
    expect(fiona.outstandingBalance).toBe(60);
    expect(fiona.factors).toContain('$60 overdue balance');
    expect(fiona.estimatedRecoveryValue).toBe(30);

    // Profit opportunities: only TTD overdue invoice ($60) and TTD open deal ($400, not +USD 1000)
    const overdueIds = opps.filter((o: any) => o.type === 'overdue_invoice').map((o: any) => o.id);
    expect(overdueIds).toEqual([`inv-${ID.invTtd}`]);
    expect(opps.find((o: any) => o.id === `inv-${ID.invTtd}`).estimatedValue).toBe(60);
    expect(opps.find((o: any) => o.id === `lead-${ID.cFxLead}`).estimatedValue).toBe(400);

    // Revenue & pipeline: home currency TTD only
    expect(rev.totalRevenue).toBe(100);
    expect(rev.invoiceCount).toBe(1);
    expect(pipe.totalPipelineValue).toBe(400);
  });

  it('CICT-07 (RED-BEFORE, V1-22 cents & D-250 owedCap): integer-cents sum (3 x 33.33 = 99.99, 0.01 remaining) and orphan refund caps remaining at invoice total', async () => {
    const [cf, risks] = await Promise.all([
      insightService.analyzeCashFlow(ID.bizCents),
      insightService.analyzeChurnRisk(ID.bizCents),
    ]);

    expect(cf.moneyIn).toBe(99.99);
    const celia = risks.find((r: any) => r.contactId === ID.cCents);
    expect(celia).toBeDefined();
    // 0.01 remaining on invCents + 50.00 capped remaining on invOrphanRefund (NOT 70.00)
    expect(celia.outstandingBalance).toBe(50.01);
  });
});
