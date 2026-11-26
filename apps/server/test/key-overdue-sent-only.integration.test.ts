/**
 * V1-81 / P113 (FU-KEY-OVERDUE-SENT-ONLY; owner rulings D-260, D-256):
 * KEY's overdue invoice list (`finance.listOverdueInvoices`) and reminder draft
 * tool (`finance.createInvoiceReminderDraft`) MUST use ONLY invoices that were
 * actually sent to the customer (`SENT`, `OVERDUE`, `PARTIALLY_PAID`,
 * `PARTIALLY_CREDITED`) and are past due with a positive remaining balance,
 * while EVERY owed total — including `ReceivablesService.getAging` — MUST KEEP
 * `PENDING` invoices under D-256.
 *
 * REAL Postgres via PrismaService + REAL ReceivablesService + REAL
 * ChartOfAccountsSeederService + REAL KeyToolRegistryService.
 *
 * Fixtures: prefix `v81o_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted via raw SQL (`sqlLikePrefix`) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env if DATABASE_URL is not already provided by the shell.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v81o_';

const ID = {
  ownerA: `${P}owner_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  contactA: `${P}contact_a`,
  contactB: `${P}contact_b`,
  invPending: `${P}inv_pending`,
  invSent: `${P}inv_sent`,
  invOverdue: `${P}inv_overdue`,
  invPartPaid: `${P}inv_part_paid`,
  invPartCred: `${P}inv_part_cred`,
  invSentFuture: `${P}inv_sent_future`,
  invDraft: `${P}inv_draft`,
  invPaid: `${P}inv_paid`,
  invVoid: `${P}inv_void`,
  invDeleted: `${P}inv_deleted`,
  invBizB: `${P}inv_biz_b`,
  payPart: `${P}pay_part`,
  cnPart: `${P}cn_part`,
};

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000 - 3_600_000);
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000 + 3_600_000);

let prisma: any;
let receivables: any;
let toolRegistry: any;

async function cleanup() {
  const db = prisma.client;
  for (const sql of [
    `DELETE FROM "credit_notes" WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "payments" WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "invoices" WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "contacts" WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "memberships" WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "businesses" WHERE id LIKE ${sqlLikePrefix(P)} OR slug LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM "users" WHERE id LIKE ${sqlLikePrefix(P)} OR email LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

beforeAll(async () => {
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ReceivablesService } = await import('../src/modules/finance/receivables.service');
  const { KeyToolRegistryService } = await import('../src/modules/ai/key-tool-registry.service');

  prisma = new PrismaService();

  const coaSeeder = new ChartOfAccountsSeederService(prisma);
  receivables = new ReceivablesService(prisma, coaSeeder);
  const auditLogStub = { logToolExecution: async () => undefined };

  toolRegistry = new KeyToolRegistryService(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    receivables,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    auditLogStub as any,
  );

  await cleanup();

  const db = prisma.client;

  await db.user.create({
    data: { id: ID.ownerA, email: `${P}owner_a@test.local`, name: 'Owner A', role: 'USER' },
  });
  await db.user.create({
    data: { id: ID.ownerB, email: `${P}owner_b@test.local`, name: 'Owner B', role: 'USER' },
  });

  await db.business.create({
    data: {
      id: ID.bizA,
      name: 'V81O Biz A',
      slug: `${P}biz-a`,
      currency: 'TTD',
      accountingBasis: 'CASH',
      ownerId: ID.ownerA,
    },
  });
  await db.business.create({
    data: {
      id: ID.bizB,
      name: 'V81O Biz B',
      slug: `${P}biz-b`,
      currency: 'TTD',
      accountingBasis: 'CASH',
      ownerId: ID.ownerB,
    },
  });

  await db.contact.create({
    data: {
      id: ID.contactA,
      businessId: ID.bizA,
      firstName: 'Nadia',
      lastName: 'Charles',
      email: `${P}nadia@test.local`,
    },
  });
  await db.contact.create({
    data: {
      id: ID.contactB,
      businessId: ID.bizB,
      firstName: 'Devon',
      lastName: 'Ali',
      email: `${P}devon@test.local`,
    },
  });

  // 1. Past-due PENDING (never sent — counts in A/R aging per D-256, excluded from KEY overdue/reminders per D-260)
  await db.invoice.create({
    data: {
      id: ID.invPending,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: `${P}INV-PEND`,
      status: 'PENDING',
      subtotal: 700,
      total: 700,
      currency: 'TTD',
      issueDate: daysAgo(24),
      dueDate: daysAgo(14),
    },
  });

  // 2. Past-due SENT (500 remaining, 10 days overdue)
  await db.invoice.create({
    data: {
      id: ID.invSent,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: `${P}INV-SENT`,
      status: 'SENT',
      subtotal: 500,
      total: 500,
      currency: 'TTD',
      issueDate: daysAgo(20),
      dueDate: daysAgo(10),
    },
  });

  // 3. Past-due OVERDUE (800 remaining, 20 days overdue)
  await db.invoice.create({
    data: {
      id: ID.invOverdue,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: `${P}INV-OVER`,
      status: 'OVERDUE',
      subtotal: 800,
      total: 800,
      currency: 'TTD',
      issueDate: daysAgo(30),
      dueDate: daysAgo(20),
    },
  });

  // 4. Past-due PARTIALLY_PAID (1000 total - 400 payment = 600 remaining, 15 days overdue)
  await db.invoice.create({
    data: {
      id: ID.invPartPaid,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: `${P}INV-PPAID`,
      status: 'PARTIALLY_PAID',
      subtotal: 1000,
      total: 1000,
      currency: 'TTD',
      issueDate: daysAgo(25),
      dueDate: daysAgo(15),
    },
  });
  await db.payment.create({
    data: {
      id: ID.payPart,
      businessId: ID.bizA,
      invoiceId: ID.invPartPaid,
      amount: 400,
      currency: 'TTD',
      status: 'SUCCESSFUL',
      provider: 'cash',
      method: 'cash',
      providerPaymentId: `${P}pp_part`,
    },
  });

  // 5. Past-due PARTIALLY_CREDITED (1000 total - 250 applied credit note = 750 remaining, 12 days overdue)
  await db.invoice.create({
    data: {
      id: ID.invPartCred,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: `${P}INV-PCRED`,
      status: 'PARTIALLY_CREDITED',
      subtotal: 1000,
      total: 1000,
      currency: 'TTD',
      issueDate: daysAgo(22),
      dueDate: daysAgo(12),
    },
  });
  await db.creditNote.create({
    data: {
      id: ID.cnPart,
      businessId: ID.bizA,
      invoiceId: ID.invPartCred,
      creditNoteNumber: `${P}CN-PART`,
      status: 'APPLIED',
      amount: 250,
      appliedAt: daysAgo(13),
    },
  });

  // 6. Non-overdue SENT (due in the future — not overdue)
  await db.invoice.create({
    data: {
      id: ID.invSentFuture,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: `${P}INV-FUT`,
      status: 'SENT',
      subtotal: 300,
      total: 300,
      currency: 'TTD',
      issueDate: daysAgo(2),
      dueDate: daysFromNow(10),
    },
  });

  // 7. Past-due DRAFT (never sent)
  await db.invoice.create({
    data: {
      id: ID.invDraft,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: `${P}INV-DRAFT`,
      status: 'DRAFT',
      subtotal: 400,
      total: 400,
      currency: 'TTD',
      issueDate: daysAgo(20),
      dueDate: daysAgo(10),
    },
  });

  // 8. Past-due PAID (settled)
  await db.invoice.create({
    data: {
      id: ID.invPaid,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: `${P}INV-PAID`,
      status: 'PAID',
      subtotal: 450,
      total: 450,
      currency: 'TTD',
      issueDate: daysAgo(20),
      dueDate: daysAgo(10),
      paidAt: daysAgo(2),
    },
  });

  // 9. Past-due VOID (cancelled)
  await db.invoice.create({
    data: {
      id: ID.invVoid,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: `${P}INV-VOID`,
      status: 'VOID',
      subtotal: 350,
      total: 350,
      currency: 'TTD',
      issueDate: daysAgo(20),
      dueDate: daysAgo(10),
    },
  });

  // 10. Soft-deleted past-due OVERDUE invoice
  await db.invoice.create({
    data: {
      id: ID.invDeleted,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: `${P}INV-DEL`,
      status: 'OVERDUE',
      subtotal: 600,
      total: 600,
      currency: 'TTD',
      issueDate: daysAgo(28),
      dueDate: daysAgo(18),
      deletedAt: daysAgo(1),
    },
  });

  // 11. Another tenant's past-due SENT invoice (cross-tenant isolation)
  await db.invoice.create({
    data: {
      id: ID.invBizB,
      businessId: ID.bizB,
      contactId: ID.contactB,
      invoiceNumber: `${P}INV-BIZB`,
      status: 'SENT',
      subtotal: 900,
      total: 900,
      currency: 'TTD',
      issueDate: daysAgo(26),
      dueDate: daysAgo(16),
    },
  });
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await cleanup();
    await prisma.client.$disconnect();
  }
}, 30_000);

describe('P113 (FU-KEY-OVERDUE-SENT-ONLY, D-260 / D-256)', () => {
  it('KO-01: listOverdueInvoices returns ONLY past-due sent open invoices (SENT, OVERDUE, PARTIALLY_PAID, PARTIALLY_CREDITED) and excludes PENDING, future SENT, DRAFT, PAID, VOID, soft-deleted, and cross-tenant rows', async () => {
    const res = await toolRegistry.executeTool(
      'finance.listOverdueInvoices',
      { limit: 20 },
      { businessId: ID.bizA, userId: ID.ownerA, autonomyLevel: 4 },
    );

    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();

    const ids = res.data.invoices.map((inv: any) => inv.id);
    // Ordered most overdue first: OVERDUE (20d) -> PARTIALLY_PAID (15d) -> PARTIALLY_CREDITED (12d) -> SENT (10d)
    expect(ids).toEqual([ID.invOverdue, ID.invPartPaid, ID.invPartCred, ID.invSent]);

    // Explicitly excluded
    expect(ids).not.toContain(ID.invPending);
    expect(ids).not.toContain(ID.invSentFuture);
    expect(ids).not.toContain(ID.invDraft);
    expect(ids).not.toContain(ID.invPaid);
    expect(ids).not.toContain(ID.invVoid);
    expect(ids).not.toContain(ID.invDeleted);
    expect(ids).not.toContain(ID.invBizB);

    // Remaining balance totals: 800 + 600 + 750 + 500 = 2650 (PENDING 700 MUST NOT be in total!)
    expect(res.data.total).toBe(2650);

    const byId = new Map<string, any>(res.data.invoices.map((i: any) => [i.id, i]));
    expect(byId.get(ID.invOverdue)).toMatchObject({
      id: ID.invOverdue,
      total: 800,
      currency: 'TTD',
      contactName: 'Nadia Charles',
      daysOverdue: 20,
    });
    expect(byId.get(ID.invPartPaid)).toMatchObject({
      id: ID.invPartPaid,
      total: 600,
      currency: 'TTD',
      contactName: 'Nadia Charles',
      daysOverdue: 15,
    });
    expect(byId.get(ID.invPartCred)).toMatchObject({
      id: ID.invPartCred,
      total: 750,
      currency: 'TTD',
      contactName: 'Nadia Charles',
      daysOverdue: 12,
    });
    expect(byId.get(ID.invSent)).toMatchObject({
      id: ID.invSent,
      total: 500,
      currency: 'TTD',
      contactName: 'Nadia Charles',
      daysOverdue: 10,
    });
  });

  it('KO-02: listOverdueInvoices honors limit while preserving full sent-overdue total', async () => {
    const res = await toolRegistry.executeTool(
      'finance.listOverdueInvoices',
      { limit: 2 },
      { businessId: ID.bizA, userId: ID.ownerA, autonomyLevel: 4 },
    );

    expect(res.success).toBe(true);
    expect(res.data.invoices.map((inv: any) => inv.id)).toEqual([ID.invOverdue, ID.invPartPaid]);
    expect(res.data.total).toBe(2650);
  });

  it('KO-03: createInvoiceReminderDraft refuses past-due PENDING (never-sent) invoice cleanly without drafting', async () => {
    const listRes = await toolRegistry.executeTool(
      'finance.listOverdueInvoices',
      { limit: 20 },
      { businessId: ID.bizA, userId: ID.ownerA, autonomyLevel: 4 },
    );
    expect(listRes.success).toBe(true);
    expect(listRes.data.invoices.some((i: any) => i.id === ID.invPending)).toBe(false);

    const draftRes = await toolRegistry.executeTool(
      'finance.createInvoiceReminderDraft',
      { invoiceId: ID.invPending, tone: 'friendly' },
      { businessId: ID.bizA, userId: ID.ownerA, autonomyLevel: 4 },
    );

    expect(draftRes.success).toBe(false);
    expect(draftRes.data).toBeUndefined();
    expect(draftRes.error).toBeTruthy();
    expect(draftRes.error).toMatch(/PENDING|sent/i);
  });

  it('KO-04: createInvoiceReminderDraft drafts reminders for all four sent overdue statuses (SENT, OVERDUE, PARTIALLY_PAID, PARTIALLY_CREDITED) with remaining amounts and days overdue', async () => {
    const cases: Array<{ id: string; num: string; expectedAmount: string; expectedDays: number; tone: 'friendly' | 'firm' | 'urgent' }> = [
      { id: ID.invSent, num: `${P}INV-SENT`, expectedAmount: '500', expectedDays: 10, tone: 'friendly' },
      { id: ID.invOverdue, num: `${P}INV-OVER`, expectedAmount: '800', expectedDays: 20, tone: 'urgent' },
      { id: ID.invPartPaid, num: `${P}INV-PPAID`, expectedAmount: '600', expectedDays: 15, tone: 'firm' },
      { id: ID.invPartCred, num: `${P}INV-PCRED`, expectedAmount: '750', expectedDays: 12, tone: 'friendly' },
    ];

    for (const c of cases) {
      const res = await toolRegistry.executeTool(
        'finance.createInvoiceReminderDraft',
        { invoiceId: c.id, tone: c.tone },
        { businessId: ID.bizA, userId: ID.ownerA, autonomyLevel: 4 },
      );

      expect(res.success, `expected reminder draft to succeed for ${c.id}: ${res.error ?? ''}`).toBe(true);
      expect(res.data?.invoiceId).toBe(c.id);
      expect(res.data?.draft).toContain('Nadia');
      expect(res.data?.draft).toContain(c.num);
      expect(res.data?.draft).toContain(`TTD ${c.expectedAmount}`);
      expect(res.data?.draft).toContain(`${c.expectedDays} days overdue`);
    }
  });

  it('KO-05: createInvoiceReminderDraft refuses non-overdue SENT (due in future), DRAFT, PAID, VOID, and soft-deleted invoices', async () => {
    const refusedCases: Array<{ id: string; label: string; expectNotFound?: boolean }> = [
      { id: ID.invSentFuture, label: 'future SENT' },
      { id: ID.invDraft, label: 'past-due DRAFT' },
      { id: ID.invPaid, label: 'past-due PAID' },
      { id: ID.invVoid, label: 'past-due VOID' },
      { id: ID.invDeleted, label: 'soft-deleted OVERDUE', expectNotFound: true },
    ];

    for (const c of refusedCases) {
      const res = await toolRegistry.executeTool(
        'finance.createInvoiceReminderDraft',
        { invoiceId: c.id, tone: 'friendly' },
        { businessId: ID.bizA, userId: ID.ownerA, autonomyLevel: 4 },
      );

      expect(res.success, `expected refusal for ${c.label}`).toBe(false);
      expect(res.data, `expected no draft data for ${c.label}`).toBeUndefined();
      expect(res.error, `expected error message for ${c.label}`).toBeTruthy();
      if (c.expectNotFound) {
        expect(res.error).toBe('Invoice not found');
      }
    }
  });

  it('KO-06 (D-256 regression guard): ReceivablesService.getAging still includes past-due PENDING in aging totals', async () => {
    const aging = await receivables.getAging(ID.bizA);

    // 700 (PENDING) + 800 (OVERDUE) + 600 (PARTIALLY_PAID) + 750 (PARTIALLY_CREDITED) + 500 (SENT) = 3350
    expect(aging.totalOverdue).toBe(3350);
    // Plus 300 (future SENT) = 3650
    expect(aging.totalOutstanding).toBe(3650);
  });

  it('KO-07 (cross-tenant isolation): bizA cannot list or draft reminders for bizB invoices, and bizB sees only its own', async () => {
    const bizAList = await toolRegistry.executeTool(
      'finance.listOverdueInvoices',
      { limit: 20 },
      { businessId: ID.bizA, userId: ID.ownerA, autonomyLevel: 4 },
    );
    expect(bizAList.success).toBe(true);
    expect(bizAList.data.invoices.some((i: any) => i.id === ID.invBizB)).toBe(false);

    const crossDraft = await toolRegistry.executeTool(
      'finance.createInvoiceReminderDraft',
      { invoiceId: ID.invBizB, tone: 'friendly' },
      { businessId: ID.bizA, userId: ID.ownerA, autonomyLevel: 4 },
    );
    expect(crossDraft.success).toBe(false);
    expect(crossDraft.data).toBeUndefined();
    expect(crossDraft.error).toBe('Invoice not found');

    const bizBList = await toolRegistry.executeTool(
      'finance.listOverdueInvoices',
      { limit: 20 },
      { businessId: ID.bizB, userId: ID.ownerB, autonomyLevel: 4 },
    );
    expect(bizBList.success).toBe(true);
    expect(bizBList.data.invoices.map((i: any) => i.id)).toEqual([ID.invBizB]);
    expect(bizBList.data.total).toBe(900);
  });

  it('KO-08 (R1-SEC-01 / R1-COR-01 / R1-COR-04, D-13 / D-251): mixed-currency books keep top-level total in home currency, separate totalsByCurrency, and normalize currency codes', async () => {
    const db = prisma.client;
    const bizMulti = `${P}biz_multi`;
    const contactMulti = `${P}contact_multi`;
    const invTtd = `${P}inv_multi_ttd`;
    const invUsd = `${P}inv_multi_usd`;
    const invUsdPending = `${P}inv_multi_usd_pend`;

    await db.business.create({
      data: {
        id: bizMulti,
        name: 'V81O Multi Currency',
        slug: `${P}biz-multi`,
        currency: 'ttd',
        accountingBasis: 'CASH',
        ownerId: ID.ownerA,
      },
    });
    await db.contact.create({
      data: {
        id: contactMulti,
        businessId: bizMulti,
        firstName: 'Kendra',
        lastName: 'Joseph',
        email: `${P}kendra@test.local`,
      },
    });
    await db.invoice.createMany({
      data: [
        {
          id: invTtd,
          businessId: bizMulti,
          contactId: contactMulti,
          invoiceNumber: `${P}INV-M-TTD`,
          status: 'SENT',
          subtotal: 250,
          total: 250,
          currency: 'ttd',
          issueDate: daysAgo(15),
          dueDate: daysAgo(5),
        },
        {
          id: invUsd,
          businessId: bizMulti,
          contactId: contactMulti,
          invoiceNumber: `${P}INV-M-USD`,
          status: 'SENT',
          subtotal: 100,
          total: 100,
          currency: 'usd',
          issueDate: daysAgo(18),
          dueDate: daysAgo(8),
        },
        {
          id: invUsdPending,
          businessId: bizMulti,
          contactId: contactMulti,
          invoiceNumber: `${P}INV-M-USDP`,
          status: 'PENDING',
          subtotal: 400,
          total: 400,
          currency: 'USD',
          issueDate: daysAgo(20),
          dueDate: daysAgo(10),
        },
      ],
    });

    const listRes = await toolRegistry.executeTool(
      'finance.listOverdueInvoices',
      { limit: 20 },
      { businessId: bizMulti, userId: ID.ownerA, autonomyLevel: 4 },
    );

    expect(listRes.success).toBe(true);
    expect(listRes.data.currency).toBe('TTD');
    expect(listRes.data.total).toBe(250);
    expect(listRes.data.totalsByCurrency).toEqual({ TTD: 250, USD: 100 });
    expect(listRes.data.invoices.map((i: any) => ({ id: i.id, currency: i.currency }))).toEqual([
      { id: invUsd, currency: 'USD' },
      { id: invTtd, currency: 'TTD' },
    ]);

    const draftUsd = await toolRegistry.executeTool(
      'finance.createInvoiceReminderDraft',
      { invoiceId: invUsd, tone: 'friendly' },
      { businessId: bizMulti, userId: ID.ownerA, autonomyLevel: 4 },
    );
    expect(draftUsd.success).toBe(true);
    expect(draftUsd.data.draft).toContain('USD 100');
  });

  it('KO-09 (R1-SEC-02 / R1-COR-02): empty/missing ctx.businessId is refused and soft-deleted contacts fall back without leaking PII', async () => {
    const emptyCtxDraft = await toolRegistry.executeTool(
      'finance.createInvoiceReminderDraft',
      { invoiceId: ID.invSent, tone: 'friendly' },
      { businessId: '', userId: ID.ownerA, autonomyLevel: 4 },
    );
    expect(emptyCtxDraft.success).toBe(false);
    expect(emptyCtxDraft.data).toBeUndefined();
    expect(emptyCtxDraft.error).toBe('Invoice not found');

    const undefinedCtxDraft = await toolRegistry.executeTool(
      'finance.createInvoiceReminderDraft',
      { invoiceId: ID.invSent, tone: 'friendly' },
      { businessId: undefined as any, userId: ID.ownerA, autonomyLevel: 4 },
    );
    expect(undefinedCtxDraft.success).toBe(false);
    expect(undefinedCtxDraft.data).toBeUndefined();
    expect(undefinedCtxDraft.error).toBe('Invoice not found');

    const emptyCtxList = await toolRegistry.executeTool(
      'finance.listOverdueInvoices',
      { limit: 10 },
      { businessId: '', userId: ID.ownerA, autonomyLevel: 4 },
    );
    expect(emptyCtxList.success).toBe(true);
    expect(emptyCtxList.data).toEqual({ invoices: [], total: 0, currency: 'TTD', totalsByCurrency: {} });

    const db = prisma.client;
    const bizDelContact = `${P}biz_delc`;
    const contactDeleted = `${P}contact_del`;
    const invDelContact = `${P}inv_delc`;

    await db.business.create({
      data: {
        id: bizDelContact,
        name: 'V81O Soft Deleted Contact Biz',
        slug: `${P}biz-delc`,
        currency: 'TTD',
        accountingBasis: 'CASH',
        ownerId: ID.ownerA,
      },
    });
    await db.contact.create({
      data: {
        id: contactDeleted,
        businessId: bizDelContact,
        firstName: 'SecretDeletedName',
        lastName: 'Hidden',
        email: `${P}deleted_contact@test.local`,
        deletedAt: daysAgo(1),
      },
    });
    await db.invoice.create({
      data: {
        id: invDelContact,
        businessId: bizDelContact,
        contactId: contactDeleted,
        invoiceNumber: `${P}INV-DELC`,
        status: 'SENT',
        subtotal: 125,
        total: 125,
        currency: 'TTD',
        issueDate: daysAgo(14),
        dueDate: daysAgo(4),
      },
    });

    const listRes = await toolRegistry.executeTool(
      'finance.listOverdueInvoices',
      { limit: 10 },
      { businessId: bizDelContact, userId: ID.ownerA, autonomyLevel: 4 },
    );
    expect(listRes.success).toBe(true);
    expect(listRes.data.invoices).toHaveLength(1);
    expect(listRes.data.invoices[0].contactName).toBe('Unknown');

    const draftRes = await toolRegistry.executeTool(
      'finance.createInvoiceReminderDraft',
      { invoiceId: invDelContact, tone: 'friendly' },
      { businessId: bizDelContact, userId: ID.ownerA, autonomyLevel: 4 },
    );
    expect(draftRes.success).toBe(true);
    expect(draftRes.data.draft).toContain('Hi there,');
    expect(draftRes.data.draft).not.toContain('SecretDeletedName');
  });

  it('KO-10 (R1-SEC-03): listOverdueInvoices rejects non-positive/non-finite limits and caps large limits at 100', async () => {
    for (const badLimit of [Infinity, -Infinity, -1, 0, 'not-a-number']) {
      const res = await toolRegistry.executeTool(
        'finance.listOverdueInvoices',
        { limit: badLimit },
        { businessId: ID.bizA, userId: ID.ownerA, autonomyLevel: 4 },
      );
      expect(res.success, `expected limit=${String(badLimit)} to be rejected`).toBe(false);
      expect(res.data).toBeUndefined();
      expect(res.error).toMatch(/limit/i);
    }

    const tool = toolRegistry.getTool('finance', 'listOverdueInvoices');
    expect(tool.validateInput({ limit: 500 })).toEqual({ valid: true, parsed: { limit: 100 } });

    const cappedRes = await toolRegistry.executeTool(
      'finance.listOverdueInvoices',
      { limit: 500 },
      { businessId: ID.bizA, userId: ID.ownerA, autonomyLevel: 4 },
    );
    expect(cappedRes.success).toBe(true);
    expect(cappedRes.data.invoices).toHaveLength(4);
  });

  it('KO-11 (R1-SEC-04): createInvoiceReminderDraft allowlists tone and never reads prototype properties like toString', async () => {
    for (const badTone of ['toString', 'constructor', '__proto__', 'aggressive']) {
      const res = await toolRegistry.executeTool(
        'finance.createInvoiceReminderDraft',
        { invoiceId: ID.invSent, tone: badTone },
        { businessId: ID.bizA, userId: ID.ownerA, autonomyLevel: 4 },
      );
      expect(res.success, `expected tone=${badTone} to be rejected`).toBe(false);
      expect(res.data).toBeUndefined();
      expect(res.error).toMatch(/tone/i);
    }

    // Defense-in-depth: direct execute call bypassing validateInput still returns a string, never a function.
    const tool = toolRegistry.getTool('finance', 'createInvoiceReminderDraft');
    const directRes = await tool.execute(
      { businessId: ID.bizA, userId: ID.ownerA, autonomyLevel: 4 },
      { invoiceId: ID.invSent, tone: 'toString' as any },
      { prisma } as any,
    );
    expect(directRes.success).toBe(true);
    expect(typeof directRes.data.draft).toBe('string');
    expect(directRes.data.draft).toContain('Hi Nadia,');
  });

  it('KO-12 (R1-COR-03): OVERDUE invoice with no dueDate (0 daysOverdue) never emits "0 days overdue" in friendly, firm, or urgent drafts', async () => {
    const db = prisma.client;
    const bizZero = `${P}biz_zero`;
    const contactZero = `${P}contact_zero`;
    const invNoDue = `${P}inv_overdue_nodue`;

    await db.business.create({
      data: {
        id: bizZero,
        name: 'V81O Zero Days Biz',
        slug: `${P}biz-zero`,
        currency: 'TTD',
        accountingBasis: 'CASH',
        ownerId: ID.ownerA,
      },
    });
    await db.contact.create({
      data: {
        id: contactZero,
        businessId: bizZero,
        firstName: 'Tasha',
        lastName: 'Singh',
        email: `${P}tasha@test.local`,
      },
    });
    await db.invoice.create({
      data: {
        id: invNoDue,
        businessId: bizZero,
        contactId: contactZero,
        invoiceNumber: `${P}INV-NODUE`,
        status: 'OVERDUE',
        subtotal: 320,
        total: 320,
        currency: 'TTD',
        issueDate: daysAgo(5),
        dueDate: null,
      },
    });

    for (const tone of ['friendly', 'firm', 'urgent'] as const) {
      const res = await toolRegistry.executeTool(
        'finance.createInvoiceReminderDraft',
        { invoiceId: invNoDue, tone },
        { businessId: bizZero, userId: ID.ownerA, autonomyLevel: 4 },
      );
      expect(res.success, `expected ${tone} draft to succeed`).toBe(true);
      expect(res.data.draft).toContain('overdue');
      expect(res.data.draft).not.toContain('0 days overdue');
    }
  });
});
