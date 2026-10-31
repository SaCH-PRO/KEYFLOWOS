/**
 * R0-D1-COA-SEED-RACE — chart-of-accounts seeding under concurrency (REAL database).
 *
 * Journey harness D1 (release0-journey.integration.test.ts, step 4): the FIRST
 * manual payment on a fresh tenant answered 500. RevenuePostingService
 * .onPaymentRecorded resolved the deposit and credit accounts with Promise.all
 * -> two concurrent ChartOfAccountsSeederService.getBySystemKey -> two
 * concurrent ensureDefaults -> chartOfAccount.upsert collided on the
 * (business_id, system_key) unique index with P2002. The posting threw inside
 * CommerceService.recordPayment's transaction, so the Payment row rolled back
 * while the winning seed committed outside it; the retry then succeeded and
 * the user saw a 500 on the first payment they ever recorded.
 *
 * What is REAL here: PrismaService over the shared `@keyflow/db` client (with
 * its soft-delete, default-take and tenant-isolation extensions),
 * ChartOfAccountsSeederService, PostingService and RevenuePostingService
 * against the database at DATABASE_URL. The payment case drives
 * onPaymentRecorded inside `prisma.client.$transaction` exactly the way
 * commerce.service.ts recordPayment does (Payment row created in the tx, the
 * posting handed the tx client). The only stand-in is TimelineService: the
 * posting records a best-effort timeline event it already `.catch`es, which
 * is not the claim under test. The HTTP 201 form of the same claim stays in
 * the journey harness, whose D1 case the integrator flips.
 *
 * Every row has the `fcs_` prefix and is hard-deleted by raw SQL in
 * beforeAll and afterAll. No $transaction wrapping of the cases themselves:
 * the seeder writes with the plain client on purpose (its seed must commit
 * even when the caller's transaction rolls back), so the test observes
 * committed state only.
 *
 * Requires DATABASE_URL with migrations applied.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'fcs_';
const ID = {
  owner: `${P}owner`,
  bizRace: `${P}bizRace`,   // one seeder, two concurrent getBySystemKey (the posting shape)
  bizCross: `${P}bizCross`, // two seeder instances (two server replicas), one business
  bizPay: `${P}bizPay`,     // first manual payment on a fresh tenant
  bizIdem: `${P}bizIdem`,   // repeated ensureDefaults after a concurrent seed
  contact: `${P}contact`,
  invoice: `${P}invoice`,
};

let db: any;
let prisma: any;
let SYSTEM_COA: Array<{ systemKey: string; parentSystemKey?: string }>;
let ChartOfAccountsSeederService: any;
let PostingService: any;
let RevenuePostingService: any;

async function cleanup() {
  const biz = `(SELECT id FROM businesses WHERE id LIKE '${P}%')`;
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id IN ${biz}`,
    `DELETE FROM financial_transactions WHERE business_id IN ${biz}`,
    `DELETE FROM payments WHERE business_id IN ${biz}`,
    `DELETE FROM invoices WHERE business_id IN ${biz}`,
    `DELETE FROM contacts WHERE business_id IN ${biz}`,
    `DELETE FROM expense_categories WHERE business_id IN ${biz}`,
    `DELETE FROM chart_of_accounts WHERE business_id IN ${biz}`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** The committed chart of accounts of a business, keyed by systemKey. */
async function coaOf(businessId: string) {
  const rows: Array<{ id: string; systemKey: string | null; parentId: string | null; isSystem: boolean }> =
    await db.chartOfAccount.findMany({
      where: { businessId },
      select: { id: true, systemKey: true, parentId: true, isSystem: true },
    });
  return { rows, byKey: new Map(rows.map((r) => [r.systemKey, r] as const)) };
}

/** Exactly one full set of system accounts, parent links applied. */
function expectOneFullSet(coa: Awaited<ReturnType<typeof coaOf>>) {
  expect(coa.rows).toHaveLength(SYSTEM_COA.length);
  expect(coa.byKey.size).toBe(SYSTEM_COA.length);
  for (const seed of SYSTEM_COA) {
    const row = coa.byKey.get(seed.systemKey);
    expect(row, `system account ${seed.systemKey} missing`).toBeTruthy();
    expect(row!.isSystem).toBe(true);
    if (seed.parentSystemKey) {
      expect(row!.parentId, `${seed.systemKey} parent link`).toBe(coa.byKey.get(seed.parentSystemKey)!.id);
    } else {
      expect(row!.parentId).toBeNull();
    }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const seederMod = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const postingMod = await import('../src/modules/finance/posting.service');
  const revenueMod = await import('../src/modules/finance/revenue-posting.service');
  ChartOfAccountsSeederService = seederMod.ChartOfAccountsSeederService;
  SYSTEM_COA = seederMod.SYSTEM_COA;
  PostingService = postingMod.PostingService;
  RevenuePostingService = revenueMod.RevenuePostingService;
  prisma = new PrismaService();

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${ID.owner}@test.local`, role: 'USER' } });
  for (const id of [ID.bizRace, ID.bizCross, ID.bizPay, ID.bizIdem]) {
    await db.business.create({ data: { id, name: id, ownerId: ID.owner } });
  }
  await db.contact.create({ data: { id: ID.contact, businessId: ID.bizPay, firstName: 'Fcs', visibility: 'TEAM' } });
  await db.invoice.create({
    data: {
      id: ID.invoice,
      invoiceNumber: `${P}INV-0001`,
      status: 'SENT',
      subtotal: 250,
      total: 250,
      currency: 'TTD',
      sentAt: new Date(),
      businessId: ID.bizPay,
      contactId: ID.contact,
    },
  });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it('every business under test is fresh: no chart of accounts yet', async () => {
    for (const id of [ID.bizRace, ID.bizCross, ID.bizPay, ID.bizIdem]) {
      expect(await db.chartOfAccount.count({ where: { businessId: id } }), id).toBe(0);
    }
    expect(await db.payment.count({ where: { businessId: ID.bizPay } })).toBe(0);
  });
});

describe('concurrent first-run seeding of one business', () => {
  it('two concurrent getBySystemKey() calls on a fresh business both resolve and exactly one full set of system accounts exists', async () => {
    const seeder = new ChartOfAccountsSeederService(prisma);

    // The exact shape RevenuePostingService.onPaymentRecorded had: deposit
    // and credit accounts resolved at the same time on a never-seeded tenant.
    const [cash, revenue] = await Promise.all([
      seeder.getBySystemKey(ID.bizRace, 'CASH'),
      seeder.getBySystemKey(ID.bizRace, 'REVENUE'),
    ]);

    expect(cash?.systemKey).toBe('CASH');
    expect(cash?.businessId).toBe(ID.bizRace);
    expect(revenue?.systemKey).toBe('REVENUE');
    expect(revenue?.businessId).toBe(ID.bizRace);
    expectOneFullSet(await coaOf(ID.bizRace));
  }, 30_000);

  it('two seeder instances (two server replicas) seeding the same fresh business concurrently both resolve: the unique-index P2002 is absorbed by a re-read, never thrown', async () => {
    // Two instances have separate in-process state; only the database's
    // (business_id, system_key) unique index stands between them, so this is
    // the cross-process collision the seeder must treat as "already seeded".
    const replicaA = new ChartOfAccountsSeederService(prisma);
    const replicaB = new ChartOfAccountsSeederService(prisma);

    await expect(
      Promise.all([replicaA.ensureDefaults(ID.bizCross), replicaB.ensureDefaults(ID.bizCross)]),
    ).resolves.toBeTruthy();

    expectOneFullSet(await coaOf(ID.bizCross));
  }, 30_000);

  it('ensureDefaults() stays idempotent after a concurrent seed: a third call changes nothing', async () => {
    const seeder = new ChartOfAccountsSeederService(prisma);
    await Promise.all([seeder.ensureDefaults(ID.bizIdem), seeder.ensureDefaults(ID.bizIdem)]);
    const before = await coaOf(ID.bizIdem);
    expectOneFullSet(before);

    await seeder.ensureDefaults(ID.bizIdem);

    const after = await coaOf(ID.bizIdem);
    expect(after.rows.map((r) => r.id).sort()).toEqual(before.rows.map((r) => r.id).sort());
    expect(after.rows.map((r) => `${r.systemKey}:${r.parentId}`).sort())
      .toEqual(before.rows.map((r) => `${r.systemKey}:${r.parentId}`).sort());
  }, 30_000);
});

describe('first manual payment on a fresh tenant (the commerce.service recordPayment transaction shape)', () => {
  it('is recorded on the FIRST call: the Payment row commits and one balanced ledger transaction exists', async () => {
    expect(await db.chartOfAccount.count({ where: { businessId: ID.bizPay } })).toBe(0);
    const seeder = new ChartOfAccountsSeederService(prisma);
    const posting = new PostingService(prisma);
    const timeline = { recordEvent: async () => null }; // best-effort side effect, .catch'ed by the posting
    const revenuePosting = new RevenuePostingService(prisma, posting, seeder, timeline);

    // Same transaction boundary as CommerceService.recordPayment: the Payment
    // row and the deposit-side posting commit together or not at all.
    const payment = await prisma.client.$transaction(async (tx: any) => {
      const created = await tx.payment.create({
        data: {
          amount: 100,
          currency: 'TTD',
          status: 'SUCCESSFUL',
          provider: 'cash',
          method: 'cash',
          providerPaymentId: `manual_${P}${Date.now()}`,
          reference: `${P}ref-001`,
          notes: 'cash at counter',
          businessId: ID.bizPay,
          invoiceId: ID.invoice,
        },
      });
      await revenuePosting.onPaymentRecorded(created.id, { tx });
      return created;
    });

    // Committed Payment row (fresh read, outside the transaction).
    const row = await db.payment.findUnique({ where: { id: payment.id } });
    expect(row).toMatchObject({
      businessId: ID.bizPay,
      invoiceId: ID.invoice,
      amount: 100,
      currency: 'TTD',
      status: 'SUCCESSFUL',
      provider: 'cash',
      method: 'cash',
      reference: `${P}ref-001`,
    });
    expect(await db.payment.count({ where: { invoiceId: ID.invoice } })).toBe(1);

    // One balanced ledger transaction for the payment.
    const externalRef = `Payment:${payment.id}:payment_recorded`;
    const txns = await db.financialTransaction.findMany({
      where: { businessId: ID.bizPay, externalRef },
      include: { entries: { include: { account: true } } },
    });
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ type: 'INCOME', status: 'POSTED', sourceType: 'Payment', sourceId: payment.id, contactId: ID.contact });
    expect(Number(txns[0].amount)).toBe(100);
    const debits = txns[0].entries.reduce((s: number, e: any) => s + Number(e.debit), 0);
    const credits = txns[0].entries.reduce((s: number, e: any) => s + Number(e.credit), 0);
    expect(debits).toBe(100);
    expect(credits).toBe(100);
    const business = await db.business.findUnique({ where: { id: ID.bizPay }, select: { accountingBasis: true } });
    const keys = txns[0].entries.map((e: any) => `${e.account.systemKey}:${Number(e.debit) > 0 ? 'D' : 'C'}`).sort();
    expect(keys).toEqual(business.accountingBasis === 'ACCRUAL' ? ['ACCOUNTS_RECEIVABLE:C', 'CASH:D'] : ['CASH:D', 'REVENUE:C']);
    for (const e of txns[0].entries) expect(e.account.businessId).toBe(ID.bizPay);

    // The lazy seed that the posting triggered left exactly one full set.
    expectOneFullSet(await coaOf(ID.bizPay));
  }, 30_000);
});
