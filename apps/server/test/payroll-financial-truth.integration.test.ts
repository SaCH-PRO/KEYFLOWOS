/**
 * PR195-PORT: payroll, ledger, cash, safe-to-spend and KEY treasury sight
 * (REAL PostgreSQL, REAL PostingService, AccountingPeriodService and
 * CashPositionService). Owner PR #195 (feat/product-financial-truth-and-key-sight)
 * ported onto the head's money rules.
 *
 * The PR's suite of the same name asserted its own cash model
 * (FinancialAccount.currentBalance moved by every posting, exchange-rate
 * conversion of cash, bills, payroll and deals). The head rules otherwise and
 * the head rules win: cash is the ledger cash position and currentBalance is an
 * opening snapshot nothing moves (V1-34, CF-41); one currency per business, and
 * an amount in another currency is named apart, never converted (D-13, V1-37c).
 * Its payroll -> ledger -> cash -> safe-to-spend -> KEY chain is kept, asserted
 * on those rules:
 *
 *   PFT-01  generate (DRAFT) reserves the run in safe-to-spend; approve; mark
 *           paid from a bank account: the run is PAID and ONE balanced EXPENSE
 *           posting exists (Dr Payroll & Contractors 6400 / Cr Bank), keyed
 *           PayrollRun:<id>:paid, dated paidAt, naming the member; the ledger
 *           cash falls by the gross, currentBalance does not move, the reserve
 *           is released, and KEY's next standing-context read (no forced
 *           refresh) shows it
 *   PFT-02  idempotent: a second mark-paid (double click, KEY retry) and two
 *           concurrent mark-paids of one APPROVED run post exactly once
 *   PFT-03  closed period (V1-15): a PAID run with no posting (paid before
 *           payroll posted, PAID dated in a CLOSED month) is refused 409 and
 *           nothing changes; once the month is reopened it posts once, dated
 *           its paidAt
 *   PFT-04  atomic: a posting the door refuses after the APPROVED -> PAID claim
 *           (a run in a currency D-13 does not support) leaves the run APPROVED
 *           with no paidAt and nothing posted
 *   PFT-05  tenant: another business's payment account, an account linked to
 *           another business's chart row, and this business's run asked for by
 *           another business are all refused; nothing changes
 *   PFT-06  KEY sight: the owner's standing context carries cash, bills,
 *           committed payroll, pipeline and tickets; a member without revenue
 *           read sees no cash, bills or payroll; one without crm read no
 *           pipeline; a non-member none; the shared snapshot none
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v98p_';
const ID = {
  owner: `${P}owner`,
  staffNoRevenue: `${P}staffNoRev`,
  staffNoCrm: `${P}staffNoCrm`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  orgUnitA: `${P}orgUnitA`,
  assignA: `${P}assignA`,
  faBankMain: `${P}faBankMain`,
  faCashPetty: `${P}faCashPetty`,
  faCard: `${P}faCard`,
  faPlanted: `${P}faPlanted`,
  faOtherBiz: `${P}faOtherBiz`,
  runLegacyPaid: `${P}runLegacyPaid`,
  runJmd: `${P}runJmd`,
  runRace: `${P}runRace`,
  runTenant: `${P}runTenant`,
  periodMarch: `${P}periodMarch`,
  contact1: `${P}contact1`,
  stage1: `${P}stage1`,
  deal1: `${P}deal1`,
  ticket1: `${P}ticket1`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let coaSeeder: any;
let payroll: any;
let safeToSpend: any;
let cashPosition: any;
let graph: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `UPDATE financial_transactions SET reversal_of_id = NULL WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payroll_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payroll_runs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM pay_rates WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_assignments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_units WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM support_tickets WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM deals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM deal_stages WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM expense_categories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* a table absent on this schema has nothing of ours */
    }
  }
}

async function postingsOf(runId: string) {
  return db.financialTransaction.findMany({
    where: { sourceType: 'PayrollRun', sourceId: runId },
    include: { entries: { include: { account: { select: { systemKey: true, code: true, businessId: true } } } } },
  });
}

async function runRow(id: string) {
  return db.payrollRun.findUnique({ where: { id } });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { CashPositionService } = await import('../src/modules/finance/cash-position.service');
  const { SafeToSpendService } = await import('../src/modules/finance/safe-to-spend.service');
  const { PayrollService } = await import('../src/modules/payroll/payroll.service');
  const { BusinessGraphService } = await import('../src/modules/ai/business-graph.service');

  const prisma = new PrismaService();
  coaSeeder = new ChartOfAccountsSeederService(prisma);
  const periods = new AccountingPeriodService(prisma);
  const posting = new PostingService(prisma, periods);
  const expensePosting = new ExpensePostingService(prisma, posting, coaSeeder);
  cashPosition = new CashPositionService(prisma);
  safeToSpend = new SafeToSpendService(prisma, coaSeeder, cashPosition);
  payroll = new PayrollService(prisma, expensePosting);
  graph = new BusinessGraphService(prisma, cashPosition);

  await cleanup();

  for (const [id, email] of [
    [ID.owner, `${P}owner@t.local`],
    [ID.staffNoRevenue, `${P}staff-norev@t.local`],
    [ID.staffNoCrm, `${P}staff-nocrm@t.local`],
    [ID.ownerB, `${P}ownerb@t.local`],
  ]) {
    await db.user.create({ data: { id, email, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'PR195 Port A', slug: `${P}biz-a`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'PR195 Port B', slug: `${P}biz-b`, ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({
    data: {
      id: `${P}m_norev`,
      userId: ID.staffNoRevenue,
      businessId: ID.bizA,
      role: 'STAFF',
      permissionScopes: { crm: 'read', operations: 'read', revenue: 'none' },
    },
  });
  await db.membership.create({
    data: {
      id: `${P}m_nocrm`,
      userId: ID.staffNoCrm,
      businessId: ID.bizA,
      role: 'STAFF',
      permissionScopes: { crm: 'none', operations: 'none', revenue: 'read' },
    },
  });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  await coaSeeder.ensureDefaults(ID.bizA);
  await coaSeeder.ensureDefaults(ID.bizB);
  const bankA = await coaSeeder.getBySystemKey(ID.bizA, 'BANK');
  const cashA = await coaSeeder.getBySystemKey(ID.bizA, 'CASH');
  const cardA = await coaSeeder.getBySystemKey(ID.bizA, 'CREDIT_CARD');
  const bankB = await coaSeeder.getBySystemKey(ID.bizB, 'BANK');

  const fa = (id: string, businessId: string, chartOfAccountId: string, type: string, openingBalance: number) =>
    db.financialAccount.create({
      data: {
        id,
        businessId,
        chartOfAccountId,
        name: id,
        type,
        currency: 'TTD',
        openingBalance,
        currentBalance: openingBalance,
        isDefault: false,
        isActive: true,
      },
    });
  await fa(ID.faBankMain, ID.bizA, bankA.id, 'BANK', 30_000);
  await fa(ID.faCashPetty, ID.bizA, cashA.id, 'CASH', 5_000);
  await fa(ID.faCard, ID.bizA, cardA.id, 'CREDIT_CARD', 0);
  // A planted row: this business's account linked to another business's bank chart row.
  await fa(ID.faPlanted, ID.bizA, bankB.id, 'BANK', 0);
  await fa(ID.faOtherBiz, ID.bizB, bankB.id, 'BANK', 10_000);

  await db.orgUnit.create({ data: { id: ID.orgUnitA, businessId: ID.bizA, name: 'Engineering', type: 'DEPARTMENT' } });
  await db.orgAssignment.create({
    data: { id: ID.assignA, businessId: ID.bizA, orgUnitId: ID.orgUnitA, isContactOnly: true, contactName: 'Maya Singh' },
  });
  await payroll.setRate(ID.bizA, { assignmentId: ID.assignA, amount: 8_000, currency: 'TTD', periodType: 'monthly' });

  await db.contact.create({ data: { id: ID.contact1, businessId: ID.bizA, displayName: 'Acme Ltd', status: 'CLIENT' } });
  await db.dealStage.create({ data: { id: ID.stage1, businessId: ID.bizA, name: 'PR195 Open', slug: `${P}open` } });
  await db.deal.create({
    data: { id: ID.deal1, businessId: ID.bizA, contactId: ID.contact1, stageId: ID.stage1, title: 'Retainer', value: 12_000, currency: 'TTD', status: 'OPEN' },
  });
  await db.supportTicket.create({ data: { id: ID.ticket1, businessId: ID.bizA, title: 'Login help', status: 'OPEN' } });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
});

describe('PR195-PORT payroll -> ledger -> cash -> safe-to-spend -> KEY (real PostgreSQL)', () => {
  let augustRunId: string;

  it('PFT-01 one balanced, attributed posting; ledger cash falls; currentBalance does not; the reserve is released; KEY sees it at once', async () => {
    const before = await cashPosition.getCashPosition(ID.bizA);
    expect(before.cashBalance).toBe(35_000); // the two openings, bridged until posted (V1-34)

    // Prime KEY's cache before the run exists.
    const primed = await graph.getSnapshotForViewer(ID.bizA, ID.owner);
    expect(primed.treasury.committedPayrollAmount).toBe(0);

    const draft = await payroll.generateRun(ID.bizA, new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T00:00:00Z'), { notes: 'August' });
    augustRunId = draft.id;
    expect(draft.status).toBe('DRAFT');
    expect(Number(draft.totalGross)).toBe(8_000);

    const draftSafe = await safeToSpend.calculate(ID.bizA);
    expect(draftSafe.payrollReserved).toBe(8_000);
    expect(draftSafe.explanation).toContain('Payroll reserved: TTD 8000.00 (1 committed run)');
    // 35,000 - 3,500 buffer - 8,000 payroll
    expect(draftSafe.safeToSpend).toBe(23_500);

    // No forced refresh: the payroll change reached KEY's next read.
    const draftSight = await graph.getSnapshotForViewer(ID.bizA, ID.owner);
    expect(draftSight.treasury.committedPayrollAmount).toBe(8_000);
    expect(draftSight.treasury.committedPayrollRuns).toBe(1);

    await payroll.approveRun(ID.bizA, draft.id, ID.owner);
    const paid = await payroll.markRunPaid(ID.bizA, draft.id, { paymentAccountId: ID.faBankMain, actorId: ID.owner });
    expect(paid.status).toBe('PAID');
    const row = await runRow(draft.id);
    expect(row.status).toBe('PAID');
    expect(row.paidAt).toBeInstanceOf(Date);

    const postings = await postingsOf(draft.id);
    expect(postings).toHaveLength(1);
    const [txn] = postings;
    expect(txn).toMatchObject({
      businessId: ID.bizA,
      type: 'EXPENSE',
      status: 'POSTED',
      externalRef: `PayrollRun:${draft.id}:paid`,
      currency: 'TTD',
      createdById: ID.owner,
    });
    expect(new Date(txn.date).getTime()).toBe(new Date(row.paidAt).getTime());
    expect(Number(txn.amount)).toBe(8_000);
    const dr = txn.entries.filter((e: any) => Number(e.debit) > 0);
    const cr = txn.entries.filter((e: any) => Number(e.credit) > 0);
    expect(dr.map((e: any) => [e.account.systemKey, e.account.code, Number(e.debit)])).toEqual([['EXPENSE_PAYROLL', '6400', 8_000]]);
    expect(cr.map((e: any) => [e.account.systemKey, Number(e.credit)])).toEqual([['BANK', 8_000]]);
    for (const e of txn.entries) expect(e.account.businessId).toBe(ID.bizA);

    const after = await cashPosition.getCashPosition(ID.bizA);
    expect(after.cashBalance).toBe(27_000);
    const bank = await db.financialAccount.findUnique({ where: { id: ID.faBankMain } });
    expect(Number(bank.currentBalance)).toBe(30_000); // V1-34: an opening snapshot, not moved

    const paidSafe = await safeToSpend.calculate(ID.bizA);
    expect(paidSafe.cashBalance).toBe(27_000);
    expect(paidSafe.payrollReserved).toBe(0);
    expect(paidSafe.explanation).toContain('Payroll reserved: TTD 0.00 (no unpaid runs)');

    const paidSight = await graph.getSnapshotForViewer(ID.bizA, ID.owner);
    expect(paidSight.treasury.cashBalance).toBe(27_000);
    expect(paidSight.treasury.committedPayrollAmount).toBe(0);
  });

  it('PFT-02 a second mark-paid, and two concurrent ones, post exactly once', async () => {
    const again = await payroll.markRunPaid(ID.bizA, augustRunId, { paymentMethod: 'bank_transfer', actorId: ID.owner });
    expect(again.status).toBe('PAID');
    expect(await postingsOf(augustRunId)).toHaveLength(1);

    await db.payrollRun.create({
      data: {
        id: ID.runRace,
        businessId: ID.bizA,
        periodStart: new Date('2026-09-01T00:00:00Z'),
        periodEnd: new Date('2026-09-30T00:00:00Z'),
        status: 'APPROVED',
        totalGross: 1_250,
        currency: 'TTD',
        itemCount: 0,
      },
    });
    const results = await Promise.allSettled([
      payroll.markRunPaid(ID.bizA, ID.runRace, { paymentMethod: 'cash', actorId: ID.owner }),
      payroll.markRunPaid(ID.bizA, ID.runRace, { paymentMethod: 'cash', actorId: ID.owner }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const race = await postingsOf(ID.runRace);
    expect(race).toHaveLength(1);
    expect(race[0].entries.find((e: any) => Number(e.credit) > 0).account.systemKey).toBe('CASH');
    expect((await runRow(ID.runRace)).status).toBe('PAID');
  });

  it('PFT-03 a PAID run dated in a CLOSED month is refused 409 and nothing changes; reopened, it posts once, dated its paidAt', async () => {
    const paidAt = new Date('2026-03-20T15:00:00Z');
    await db.payrollRun.create({
      data: {
        id: ID.runLegacyPaid,
        businessId: ID.bizA,
        periodStart: new Date('2026-03-01T00:00:00Z'),
        periodEnd: new Date('2026-03-31T00:00:00Z'),
        status: 'PAID',
        paidAt,
        totalGross: 2_000,
        currency: 'TTD',
        itemCount: 0,
      },
    });
    await db.accountingPeriod.create({
      data: {
        id: ID.periodMarch,
        businessId: ID.bizA,
        year: 2026,
        month: 3,
        startDate: new Date('2026-03-01T00:00:00Z'),
        endDate: new Date('2026-03-31T23:59:59.999Z'),
        status: 'CLOSED',
        closedAt: new Date('2026-04-02T00:00:00Z'),
      },
    });
    const cashBefore = (await cashPosition.getCashPosition(ID.bizA)).cashBalance;

    await expect(payroll.markRunPaid(ID.bizA, ID.runLegacyPaid, { paymentMethod: 'bank_transfer', actorId: ID.owner }))
      .rejects.toMatchObject({ status: 409 });
    expect(await postingsOf(ID.runLegacyPaid)).toHaveLength(0);
    const unchanged = await runRow(ID.runLegacyPaid);
    expect(unchanged.status).toBe('PAID');
    expect(unchanged.paidAt.getTime()).toBe(paidAt.getTime());
    expect((await cashPosition.getCashPosition(ID.bizA)).cashBalance).toBe(cashBefore);

    await db.accountingPeriod.update({ where: { id: ID.periodMarch }, data: { status: 'OPEN', closedAt: null } });
    await payroll.markRunPaid(ID.bizA, ID.runLegacyPaid, { paymentMethod: 'bank_transfer', actorId: ID.owner });
    const posted = await postingsOf(ID.runLegacyPaid);
    expect(posted).toHaveLength(1);
    expect(new Date(posted[0].date).getTime()).toBe(paidAt.getTime());
    expect((await cashPosition.getCashPosition(ID.bizA)).cashBalance).toBe(cashBefore - 2_000);
  });

  it('PFT-04 a posting the door refuses after the claim leaves the run APPROVED, unpaid, unposted', async () => {
    await db.payrollRun.create({
      data: {
        id: ID.runJmd,
        businessId: ID.bizA,
        periodStart: new Date('2026-10-01T00:00:00Z'),
        periodEnd: new Date('2026-10-31T00:00:00Z'),
        status: 'APPROVED',
        totalGross: 1_000,
        currency: 'JMD',
        itemCount: 0,
      },
    });
    await expect(payroll.markRunPaid(ID.bizA, ID.runJmd, { paymentMethod: 'cash', actorId: ID.owner }))
      .rejects.toMatchObject({ status: 400 });
    const row = await runRow(ID.runJmd);
    expect(row.status).toBe('APPROVED');
    expect(row.paidAt).toBeNull();
    expect(await postingsOf(ID.runJmd)).toHaveLength(0);
  });

  it('PFT-05 tenant: foreign account, account on a foreign chart row, run asked for by another business: refused, nothing changes', async () => {
    await db.payrollRun.create({
      data: {
        id: ID.runTenant,
        businessId: ID.bizA,
        periodStart: new Date('2026-11-01T00:00:00Z'),
        periodEnd: new Date('2026-11-30T00:00:00Z'),
        status: 'APPROVED',
        totalGross: 900,
        currency: 'TTD',
        itemCount: 0,
      },
    });
    await expect(payroll.markRunPaid(ID.bizA, ID.runTenant, { paymentAccountId: ID.faOtherBiz, actorId: ID.owner }))
      .rejects.toThrow(/not found in this business/);
    await expect(payroll.markRunPaid(ID.bizA, ID.runTenant, { paymentAccountId: ID.faPlanted, actorId: ID.owner }))
      .rejects.toMatchObject({ status: 400 });
    await expect(payroll.markRunPaid(ID.bizA, ID.runTenant, { paymentAccountId: ID.faCard, actorId: ID.owner }))
      .rejects.toMatchObject({ status: 400 });
    await expect(payroll.markRunPaid(ID.bizB, ID.runTenant, { paymentAccountId: ID.faOtherBiz, actorId: ID.ownerB }))
      .rejects.toMatchObject({ status: 404 });

    const row = await runRow(ID.runTenant);
    expect(row.status).toBe('APPROVED');
    expect(row.paidAt).toBeNull();
    expect(await postingsOf(ID.runTenant)).toHaveLength(0);
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizB } })).toBe(0);
  });

  it('PFT-06 KEY sight follows the REST read rules; the shared snapshot carries none', async () => {
    const owner = await graph.getSnapshotForViewer(ID.bizA, ID.owner, true);
    // Still committed: PFT-04's JMD run (refused, APPROVED) and PFT-05's TTD run (APPROVED).
    expect(owner.treasury).toMatchObject({
      currency: 'TTD',
      cashBasis: 'ledger',
      committedPayrollRuns: 2,
      committedPayrollAmount: 900,
      otherCurrencies: [{ currency: 'JMD', cash: 0, unpaidBills: 0, committedPayroll: 1_000 }],
    });
    expect(owner.pipeline).toMatchObject({ openDealCount: 1, openPipelineValue: 12_000 });
    expect(owner.support).toEqual({ openTicketCount: 1 });
    const ownerContext = graph.buildContextString(owner);
    expect(ownerContext).toMatch(/Cash & Obligations: TTD [\d,]+\.\d\d cash \(ledger\)/);
    expect(ownerContext).toContain('TTD 900.00 committed payroll (2 runs); held apart, not converted: JMD 1,000.00 committed payroll');
    expect(ownerContext).toContain('Pipeline: 1 open deal (TTD 12,000.00)');
    expect(ownerContext).toContain('Support: 1 open ticket');

    const noRevenue = await graph.getSnapshotForViewer(ID.bizA, ID.staffNoRevenue);
    expect(noRevenue.treasury).toBeUndefined();
    expect(noRevenue.pipeline).toBeDefined();
    expect(noRevenue.support).toBeDefined();
    const noRevenueContext = graph.buildContextString(noRevenue);
    expect(noRevenueContext).not.toMatch(/Cash & Obligations|committed payroll|ledger cash/);

    const noCrm = await graph.getSnapshotForViewer(ID.bizA, ID.staffNoCrm);
    expect(noCrm.treasury).toBeDefined();
    expect(noCrm.pipeline).toBeUndefined();
    expect(noCrm.support).toBeUndefined();

    const outsider = await graph.getSnapshotForViewer(ID.bizA, ID.ownerB);
    expect(outsider.treasury).toBeUndefined();
    expect(outsider.pipeline).toBeUndefined();
    expect(outsider.support).toBeUndefined();

    const shared = await graph.getSnapshot(ID.bizA);
    expect(shared.treasury).toBeUndefined();
    expect(shared.pipeline).toBeUndefined();
    expect(shared.support).toBeUndefined();
    expect(graph.buildContextString(shared)).not.toMatch(/Cash & Obligations|Pipeline:|Support:/);
  });
});
