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
});
