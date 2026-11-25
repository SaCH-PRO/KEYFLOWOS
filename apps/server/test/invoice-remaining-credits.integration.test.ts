/**
 * P65 — V1-95 (FU-INVOICE-REMAINING-CREDITS, Journey E, D-283 follow-up):
 * `CommerceService.getInvoiceForBusiness`
 *
 * The operator invoice detail's `remaining` MUST net own-tenant APPLIED credit
 * notes (matching the public pay view / payment reconcile via `appliedCreditsOf`
 * + `creditAwareBalance`) and read `0` on `VOID` and `FULLY_CREDITED` invoices.
 *
 * Real Postgres (`invoices`, `payments`, `credit_notes`, `contacts`,
 * `businesses`, `users`). Fixtures use prefix `v95c_` and are hard-deleted
 * with `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v95c_';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let commerce: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

async function cleanup() {
  for (const sql of [
    `DELETE FROM credit_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

let invSeq = 0;
async function seedInvoice(status: string, total = 300) {
  invSeq += 1;
  const id = `${P}inv_${invSeq}`;
  return db.invoice.create({
    data: {
      id,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: `${P}INV-${invSeq}`,
      status,
      subtotal: total,
      total,
      currency: 'TTD',
    },
  });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');

  const prismaService = new PrismaService();
  const noop = new Proxy({}, { get: () => vi.fn(async () => undefined) }) as any;
  commerce = new CommerceService(prismaService, noop, noop, noop, noop, noop, noop, noop, noop);

  await cleanup();

  await db.user.create({ data: { id: ID.ownerA, email: `${P}owner-a@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}owner-b@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V95C Biz A', slug: `${P}biz-a`, ownerId: ID.ownerA, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V95C Biz B', slug: `${P}biz-b`, ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_a`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_b`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({
    data: { id: ID.contactA, businessId: ID.bizA, firstName: 'Ria', lastName: 'Persad', email: `${P}ria@test.local` },
  });
});

beforeEach(async () => {
  await db.$executeRawUnsafe(`DELETE FROM credit_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`);
});

afterAll(async () => {
  await cleanup();
});

describe('P65 — V1-95 (FU-INVOICE-REMAINING-CREDITS): CommerceService.getInvoiceForBusiness', () => {
  it('IRC-01 RED-BEFORE: PARTIALLY_CREDITED invoice nets own-tenant APPLIED credit notes and payments/refunds, ignoring DRAFT/VOID and cross-tenant credit notes (D-75)', async () => {
    const inv = await seedInvoice('PARTIALLY_CREDITED', 300);

    // Own-tenant APPLIED credit note of 100 (counts).
    await db.creditNote.create({
      data: {
        id: `${P}cn_applied`,
        businessId: ID.bizA,
        invoiceId: inv.id,
        creditNoteNumber: `${P}CN-1`,
        status: 'APPLIED',
        amount: 100,
      },
    });
    // Own-tenant DRAFT & VOID credit notes (must NOT reduce remaining).
    await db.creditNote.create({
      data: {
        id: `${P}cn_draft`,
        businessId: ID.bizA,
        invoiceId: inv.id,
        creditNoteNumber: `${P}CN-2`,
        status: 'DRAFT',
        amount: 50,
      },
    });
    await db.creditNote.create({
      data: {
        id: `${P}cn_void`,
        businessId: ID.bizA,
        invoiceId: inv.id,
        creditNoteNumber: `${P}CN-3`,
        status: 'VOID',
        amount: 40,
      },
    });
    // Cross-tenant APPLIED credit note planted under bizB (must NOT reduce bizA's remaining, D-75).
    await db.creditNote.create({
      data: {
        id: `${P}cn_foreign`,
        businessId: ID.bizB,
        invoiceId: inv.id,
        creditNoteNumber: `${P}CN-FOREIGN`,
        status: 'APPLIED',
        amount: 200,
      },
    });

    // Without payments: 300 - 100 = 200.
    const noPay = await commerce.getInvoiceForBusiness(inv.id, ID.bizA);
    expect(noPay).toMatchObject({ paidAmount: 0, remaining: 200 });

    // Add SUCCESSFUL payment of 75: 300 - 100 - 75 = 125.
    await db.payment.create({
      data: {
        id: `${P}pay_1`,
        businessId: ID.bizA,
        invoiceId: inv.id,
        amount: 75,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'manual',
        providerPaymentId: `${P}pp_1`,
      },
    });
    const withPay = await commerce.getInvoiceForBusiness(inv.id, ID.bizA);
    expect(withPay).toMatchObject({ paidAmount: 75, remaining: 125 });

    // Add partial REFUNDED row of -25: net paid = 50, remaining = 300 - 100 - 50 = 150.
    await db.payment.create({
      data: {
        id: `${P}pay_ref`,
        businessId: ID.bizA,
        invoiceId: inv.id,
        amount: -25,
        currency: 'TTD',
        status: 'REFUNDED',
        provider: 'manual',
        providerPaymentId: `${P}pp_ref`,
      },
    });
    const withRefund = await commerce.getInvoiceForBusiness(inv.id, ID.bizA);
    expect(withRefund).toMatchObject({ paidAmount: 50, remaining: 150 });
  });

  it('IRC-02 RED-BEFORE: FULLY_CREDITED invoice reads remaining 0 (with or without matching credit-note rows)', async () => {
    const withNotes = await seedInvoice('FULLY_CREDITED', 300);
    await db.creditNote.create({
      data: {
        id: `${P}cn_full`,
        businessId: ID.bizA,
        invoiceId: withNotes.id,
        creditNoteNumber: `${P}CN-FULL`,
        status: 'APPLIED',
        amount: 300,
      },
    });
    const legacyNoRows = await seedInvoice('FULLY_CREDITED', 300);

    expect(await commerce.getInvoiceForBusiness(withNotes.id, ID.bizA)).toMatchObject({
      paidAmount: 0,
      remaining: 0,
    });
    expect(await commerce.getInvoiceForBusiness(legacyNoRows.id, ID.bizA)).toMatchObject({
      paidAmount: 0,
      remaining: 0,
    });
  });

  it('IRC-03 RED-BEFORE: VOID invoice reads remaining 0', async () => {
    const voided = await seedInvoice('VOID', 300);
    expect(await commerce.getInvoiceForBusiness(voided.id, ID.bizA)).toMatchObject({
      paidAmount: 0,
      remaining: 0,
    });
  });

  it('IRC-04: controls — DRAFT/SENT/PARTIALLY_PAID keep payment-derived remaining, and over-credited PARTIALLY_CREDITED clamps at 0', async () => {
    const draft = await seedInvoice('DRAFT', 200);
    const sent = await seedInvoice('SENT', 300);
    const partial = await seedInvoice('PARTIALLY_PAID', 300);
    const overCredited = await seedInvoice('PARTIALLY_CREDITED', 300);

    // Stray DRAFT credit note on SENT must not affect SENT remaining.
    await db.creditNote.create({
      data: {
        id: `${P}cn_sent_draft`,
        businessId: ID.bizA,
        invoiceId: sent.id,
        creditNoteNumber: `${P}CN-SD`,
        status: 'DRAFT',
        amount: 100,
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_part`,
        businessId: ID.bizA,
        invoiceId: partial.id,
        amount: 120,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'manual',
        providerPaymentId: `${P}pp_part`,
      },
    });
    await db.creditNote.create({
      data: {
        id: `${P}cn_over`,
        businessId: ID.bizA,
        invoiceId: overCredited.id,
        creditNoteNumber: `${P}CN-OVER`,
        status: 'APPLIED',
        amount: 250,
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_over`,
        businessId: ID.bizA,
        invoiceId: overCredited.id,
        amount: 100,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'manual',
        providerPaymentId: `${P}pp_over`,
      },
    });

    expect(await commerce.getInvoiceForBusiness(draft.id, ID.bizA)).toMatchObject({ paidAmount: 0, remaining: 200 });
    expect(await commerce.getInvoiceForBusiness(sent.id, ID.bizA)).toMatchObject({ paidAmount: 0, remaining: 300 });
    expect(await commerce.getInvoiceForBusiness(partial.id, ID.bizA)).toMatchObject({ paidAmount: 120, remaining: 180 });
    expect(await commerce.getInvoiceForBusiness(overCredited.id, ID.bizA)).toMatchObject({ paidAmount: 100, remaining: 0 });
  });
});
