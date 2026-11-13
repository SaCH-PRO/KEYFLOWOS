/**
 * PR195-BOOKS-DOORS (review finding SEC-P195JS-1, a class that exists on main too): every door that
 * writes the Books needs a module write, not membership alone. REAL database.
 *
 * PR195-JOURNAL-SCOPE gated POST journal-entries and the recurring templates at revenue write, but the
 * review reproduced the same post through three other doors: a STAFF member with no revenue scope
 * imported a statement line, created a bank rule naming OWNER_EQUITY and applied it, and an ADJUSTMENT
 * of 99,999 (DR CASH / CR OWNER_EQUITY) authored by that member appeared in the OWNER's General
 * Journal. Every other Books write on FinanceController was the same door (membership only, through
 * ensureAccess), and so was MarketplaceController's purchase-order advance, whose receipt posts the
 * stock purchase.
 *
 * The rule (books-write-scope.spec.ts states it): a Books write (accounts and their opening balance,
 * bank rules and their apply, statement import and its profile, auto-match, match, unmatch, ignore,
 * reconciliations, tax-liability recompute and file, fixed assets and their depreciation and disposal,
 * accounting periods and their close and reopen) needs revenue write (D-57: the Books' module, no new
 * key); a payment out that is an expense by nature (tax-liability pay, a purchase order's advance)
 * needs expenses write; ModuleScopeGuard refuses below it with 403 before the handler; a platform
 * SUPER_ADMIN who is not a member is refused by the membership check every such route keeps (D-46). The
 * recurring template reads need revenue read (D-57, SEC-P195JS-2).
 *
 *   BWS-01  RED-BEFORE  the review's chain: a revenue:read member's import, bank rule and apply are each
 *                       refused 403; no statement line, rule or posting is written
 *   BWS-02  RED-BEFORE  each Books door: a member without revenue write is refused 403 with the guard's
 *                       words and the business's Books are byte-identical (every Books table, by raw SQL)
 *   BWS-03  CONTROL     each Books door: a non-member SUPER_ADMIN is refused 403 'No access to this
 *                       business' (D-46) and nothing is written
 *   BWS-04  RED-BEFORE  each Books door: a member with revenue write (the OWNER for the period gate,
 *                       which is OWNER or ADMIN, D-50) succeeds and the Books change
 *   BWS-05  RED-BEFORE  tax-liability pay (and its alias): revenue write alone is refused 'expenses
 *                       requires write access'; expenses write pays and posts the TAX transaction
 *   BWS-06  RED-BEFORE  the purchase-order advance and PATCH: expenses read refused, expenses write moves
 *                       it (the receipt posts the purchase), a non-member SUPER_ADMIN refused (D-46)
 *   BWS-07  RED-BEFORE  an ADMIN whose explicit revenue scope is 'none' (D-114) is refused the period close
 *   BWS-08  RED-BEFORE  GET recurring-journal-entries and :id: revenue none (STAFF, and a D-114 ADMIN) 403;
 *                       revenue read 200; a non-member SUPER_ADMIN 403
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * CrmRateLimitGuard, TenantInterceptor, FinanceController, MarketplaceController and every service the
 * doors call (PostingService, AccountingPeriodService, BankRuleService, BankImportService,
 * BankMatchingService, ReconciliationService, TaxLiabilityService, FixedAssetService,
 * FinanceAccountsService, RecurringJournalEntryService, MarketplaceService, FulfillmentRoutingService,
 * ExpensePostingService, the chart seeders) run against DATABASE_URL. Stand-ins: identity attachment
 * (a test middleware reads `x-v98b-user`, loads that seeded user row and attaches `{ id, email, role }`,
 * as the Supabase-verifying AuthMiddleware does); FinanceController's and MarketplaceController's
 * collaborators off these routes; TransactionalEmailService (records nothing).
 *
 * Fixtures: prefix `v98b_` (registered in test/helpers/fixture-prefixes.json); hard-deleted by raw SQL
 * (patterns built by sqlLikePrefix) in dependency order in beforeAll and afterAll; no $transaction
 * wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

vi.setConfig({ testTimeout: 30_000 });

const P = 'v98b_';
const HEADER = 'x-v98b-user';

const ID = {
  owner: `${P}owner`, // OWNER, role defaults
  revRead: `${P}revRead`, // STAFF { revenue: 'read', expenses: 'read' }
  revWrite: `${P}revWrite`, // STAFF { revenue: 'write', expenses: 'read' }
  expWrite: `${P}expWrite`, // STAFF { revenue: 'read', expenses: 'write' }
  crmOnly: `${P}crmOnly`, // STAFF { crm: 'read' }: revenue none
  adminRevNone: `${P}adminRevNone`, // ADMIN { crm, operations, expenses admin; revenue 'none' } (D-114)
  superAdmin: `${P}super`, // platform SUPER_ADMIN, no Membership
  biz: `${P}biz`,
};

const REV_WRITE_READ = 'Insufficient permissions: revenue requires write access (you have read)';
const REV_WRITE_NONE = 'Insufficient permissions: revenue requires write access (you have none)';
const REV_READ_NONE = 'Insufficient permissions: revenue requires read access (you have none)';
const EXP_WRITE_READ = 'Insufficient permissions: expenses requires write access (you have read)';
const NOT_MEMBER = 'No access to this business';

let db: any;
let app: any;
let posting: any;
/** System chart rows of the business. */
const COA: Record<string, string> = {};
/** The business's BANK FinancialAccount most doors work on. */
let bankAccountId = '';

async function cleanup() {
  for (const sql of [
    `DELETE FROM bank_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bank_rules WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM reconciliations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM recurring_journal_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM tax_liabilities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM fixed_assets WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM fulfillment_routes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM purchase_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function attachIdentity(nest: any) {
  nest.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
}

/** Every Books table of the business, row by row, as JSON text (raw SQL): "nothing written" is byte-identical. */
const BOOKS_TABLES = [
  'financial_transactions', 'ledger_entries', 'bank_rules', 'bank_transactions', 'reconciliations', 'fixed_assets',
  'tax_liabilities', 'accounting_periods', 'financial_accounts', 'purchase_orders', 'recurring_journal_entries',
];
async function books(): Promise<string> {
  const out: string[] = [];
  for (const table of BOOKS_TABLES) {
    const [row]: Array<{ j: string }> = await db.$queryRawUnsafe(
      `SELECT COALESCE(json_agg(t ORDER BY t.id), '[]'::json)::text AS j FROM ${table} t WHERE t.business_id = $1`,
      ID.biz,
    );
    out.push(`${table}:${row.j}`);
  }
  return out.join('\n');
}

const http = () => request(app.getHttpServer());
const fin = (rest: string) => `/finance/businesses/${ID.biz}/${rest}`;
const market = (rest: string) => `/marketplace/businesses/${ID.biz}/${rest}`;

let seq = 0;
const uniq = (label: string) => `${P}${label}_${++seq}`;

/** A BANK FinancialAccount on the BANK chart row. */
async function newBankAccount(label: string) {
  const row = await db.financialAccount.create({
    data: { businessId: ID.biz, chartOfAccountId: COA.BANK, name: `v98b ${label}`, type: 'BANK', currency: 'TTD' },
  });
  return row.id as string;
}

/** An UNMATCHED statement line on `accountId`. */
async function newBankLine(accountId: string, description: string, amount = 25, date = new Date(Date.now() - 86_400_000)) {
  const row = await db.bankTransaction.create({
    data: { businessId: ID.biz, accountId, date, description, amount, currency: 'TTD', status: 'UNMATCHED' },
  });
  return row.id as string;
}

/** A POSTED ledger transaction DR BANK / CR OWNER_EQUITY, through the real door. */
async function newBankPosting(amount = 25) {
  const res = await posting.post({
    businessId: ID.biz,
    type: 'ADJUSTMENT',
    date: new Date(Date.now() - 86_400_000),
    amount,
    description: uniq('posting'),
    entries: [
      { accountId: COA.BANK, debit: amount },
      { accountId: COA.OWNER_EQUITY, credit: amount },
    ],
  });
  return res.transactionId as string;
}

async function newRule(pattern: string) {
  const row = await db.bankRule.create({
    data: { businessId: ID.biz, name: `v98b rule ${pattern}`, pattern, matchType: 'contains', accountId: COA.OWNER_EQUITY, isActive: true },
  });
  return row.id as string;
}

let taxMonth = 0;
async function newTaxLiability(status: 'OPEN' | 'FILED', amountDue = 50) {
  taxMonth += 1;
  const periodStart = new Date(Date.UTC(2002, taxMonth - 1, 1));
  const periodEnd = new Date(Date.UTC(2002, taxMonth, 0, 23, 59, 59));
  const row = await db.taxLiability.create({
    data: { businessId: ID.biz, type: 'VAT', periodStart, periodEnd, taxCollected: amountDue, amountDue, status },
  });
  return row.id as string;
}

async function newFixedAsset() {
  const purchaseDate = new Date();
  purchaseDate.setUTCMonth(purchaseDate.getUTCMonth() - 12);
  const row = await db.fixedAsset.create({
    data: {
      businessId: ID.biz, name: uniq('asset'), category: 'equipment', purchaseDate, purchaseCost: 1200, salvageValue: 0,
      usefulLifeMonths: 24, depreciationMethod: 'straight_line', accumulatedDepreciation: 0, netBookValue: 1200,
    },
  });
  return row.id as string;
}

let periodMonth = 0;
async function newPeriod(status: 'OPEN' | 'CLOSED') {
  periodMonth += 1;
  const year = 2001 + Math.floor((periodMonth - 1) / 12);
  const month = ((periodMonth - 1) % 12) + 1;
  const row = await db.accountingPeriod.create({
    data: {
      businessId: ID.biz, year, month,
      startDate: new Date(Date.UTC(year, month - 1, 1)),
      endDate: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
      status,
      ...(status === 'CLOSED' ? { closedAt: new Date(), closedById: ID.owner, lockedTransactionStamp: `lock:${ID.biz}:${year}-${month}` } : {}),
    },
  });
  return { id: row.id as string, year, month };
}

async function newReconciliation() {
  const accountId = await newBankAccount(uniq('recon'));
  const row = await db.reconciliation.create({
    data: {
      businessId: ID.biz, accountId, periodStart: new Date(Date.UTC(2000, 0, 1)), periodEnd: new Date(Date.UTC(2000, 0, 31)),
      statementBalance: 0, systemBalance: 0, difference: 0, status: 'IN_PROGRESS',
    },
  });
  return row.id as string;
}

let poSeq = 0;
async function newPurchaseOrder(status: 'DRAFT' | 'SHIPPED') {
  poSeq += 1;
  const row = await db.purchaseOrder.create({
    data: {
      businessId: ID.biz, poNumber: `${P}PO-${poSeq}`, status, supplierName: 'v98b supplier', items: [],
      subtotal: 40, total: 40, currency: 'TTD', ...(status === 'SHIPPED' ? { shippedAt: new Date() } : {}),
    },
  });
  return row.id as string;
}

type Verb = 'post' | 'patch' | 'delete';
interface Door {
  name: string;
  /** Rows the door acts on, made fresh (never through a gated route). */
  prepare: () => Promise<Record<string, string>>;
  call: (ctx: Record<string, string>) => { verb: Verb; url: string; body?: unknown; attach?: string };
  /** Who succeeds (default revWrite); the period gate is OWNER or ADMIN (D-50). */
  allowed?: string;
  /** Who is refused, and with which words (default revRead, REV_WRITE_READ). */
  refused?: readonly [string, string];
  ok: number;
  /** false when a success may write nothing (a recompute with nothing new). */
  writes?: boolean;
}

function send(as: string, req: ReturnType<Door['call']>) {
  let r = (http() as any)[req.verb](req.url).set(HEADER, as);
  if (req.attach !== undefined) return r.attach('file', Buffer.from(req.attach), 'statement.csv');
  if (req.body !== undefined) r = r.send(req.body);
  return r;
}

const BOOKS_DOORS: Door[] = [
  { name: 'POST accounts (posts the opening balance)', prepare: async () => ({}), ok: 201,
    call: () => ({ verb: 'post', url: fin('accounts'), body: { name: uniq('acct'), type: 'BANK', openingBalance: 100 } }) },
  { name: 'PATCH accounts/:id', prepare: async () => ({ id: await newBankAccount(uniq('patch')) }), ok: 200,
    call: ({ id }) => ({ verb: 'patch', url: fin(`accounts/${id}`), body: { name: uniq('renamed') } }) },
  { name: 'DELETE accounts/:id', prepare: async () => ({ id: await newBankAccount(uniq('archive')) }), ok: 200,
    call: ({ id }) => ({ verb: 'delete', url: fin(`accounts/${id}`) }) },
  { name: 'POST bank-rules', prepare: async () => ({}), ok: 201,
    call: () => ({ verb: 'post', url: fin('bank-rules'), body: { name: uniq('rule'), pattern: uniq('pat'), accountId: COA.OWNER_EQUITY } }) },
  { name: 'PATCH bank-rules/:id', prepare: async () => ({ id: await newRule(uniq('rp')) }), ok: 200,
    call: ({ id }) => ({ verb: 'patch', url: fin(`bank-rules/${id}`), body: { pattern: uniq('rp2') } }) },
  { name: 'DELETE bank-rules/:id', prepare: async () => ({ id: await newRule(uniq('rd')) }), ok: 200,
    call: ({ id }) => ({ verb: 'delete', url: fin(`bank-rules/${id}`) }) },
  { name: 'POST bank-rules/apply (posts)', ok: 201,
    prepare: async () => { const word = uniq('apply'); await newRule(word); return { line: await newBankLine(bankAccountId, `deposit ${word}`) }; },
    call: ({ line }) => ({ verb: 'post', url: fin('bank-rules/apply'), body: { bankTransactionIds: [line] } }) },
  { name: 'POST accounts/:accountId/bank-rules/apply (posts)', ok: 201,
    prepare: async () => { const word = uniq('applyacct'); await newRule(word); const acct = await newBankAccount(word); await newBankLine(acct, `deposit ${word}`); return { acct }; },
    call: ({ acct }) => ({ verb: 'post', url: fin(`accounts/${acct}/bank-rules/apply`), body: {} }) },
  { name: 'POST accounts/:accountId/bank-transactions/import', ok: 201,
    prepare: async () => ({ acct: await newBankAccount(uniq('import')) }),
    call: ({ acct }) => ({ verb: 'post', url: fin(`accounts/${acct}/bank-transactions/import?autoMatch=false`), attach: `Date,Description,Amount\n2026-11-01,${uniq('imported')},12.00\n` }) },
  { name: 'POST accounts/:accountId/import-profile', ok: 201,
    prepare: async () => ({ acct: await newBankAccount(uniq('profile')) }),
    call: ({ acct }) => ({ verb: 'post', url: fin(`accounts/${acct}/import-profile`), body: { date: 'Date', description: 'Narrative', amount: 'Value' } }) },
  { name: 'POST accounts/:accountId/bank-transactions/auto-match (applies the rules, so posts)', ok: 201,
    prepare: async () => { const word = uniq('auto'); await newRule(word); const acct = await newBankAccount(word); await newBankLine(acct, `deposit ${word}`); return { acct }; },
    call: ({ acct }) => ({ verb: 'post', url: fin(`accounts/${acct}/bank-transactions/auto-match`), body: {} }) },
  { name: 'POST bank-transactions/:id/match', ok: 201,
    prepare: async () => ({ line: await newBankLine(bankAccountId, uniq('manual')), tx: await newBankPosting() }),
    call: ({ line, tx }) => ({ verb: 'post', url: fin(`bank-transactions/${line}/match`), body: { transactionId: tx } }) },
  { name: 'POST bank-transactions/:id/unmatch', ok: 201,
    prepare: async () => {
      const tx = await newBankPosting();
      const line = await newBankLine(bankAccountId, uniq('matched'));
      await db.bankTransaction.update({ where: { id: line }, data: { status: 'MATCHED', matchedTransactionId: tx } });
      return { line };
    },
    call: ({ line }) => ({ verb: 'post', url: fin(`bank-transactions/${line}/unmatch`), body: {} }) },
  { name: 'POST bank-transactions/:id/ignore', ok: 201,
    prepare: async () => ({ line: await newBankLine(bankAccountId, uniq('ignore')) }),
    call: ({ line }) => ({ verb: 'post', url: fin(`bank-transactions/${line}/ignore`), body: {} }) },
  { name: 'POST reconciliations', ok: 201,
    prepare: async () => ({ acct: await newBankAccount(uniq('reconnew')) }),
    call: ({ acct }) => ({ verb: 'post', url: fin('reconciliations'), body: { accountId: acct, periodStart: '2000-02-01', periodEnd: '2000-02-29', statementBalance: 0 } }) },
  { name: 'POST reconciliations/:id/complete (locks the period\'s ledger lines)', ok: 201,
    prepare: async () => ({ id: await newReconciliation() }),
    call: ({ id }) => ({ verb: 'post', url: fin(`reconciliations/${id}/complete`), body: {} }) },
  { name: 'POST tax-liabilities/recompute', ok: 201, writes: false, prepare: async () => ({}),
    call: () => ({ verb: 'post', url: fin('tax-liabilities/recompute'), body: {} }) },
  { name: 'POST tax/liabilities/recompute (alias)', ok: 201, writes: false, prepare: async () => ({}),
    call: () => ({ verb: 'post', url: fin('tax/liabilities/recompute'), body: {} }) },
  { name: 'POST tax-liabilities/:id/file', ok: 201, prepare: async () => ({ id: await newTaxLiability('OPEN') }),
    call: ({ id }) => ({ verb: 'post', url: fin(`tax-liabilities/${id}/file`), body: {} }) },
  { name: 'POST tax/liabilities/:id/file (alias)', ok: 201, prepare: async () => ({ id: await newTaxLiability('OPEN') }),
    call: ({ id }) => ({ verb: 'post', url: fin(`tax/liabilities/${id}/file`), body: {} }) },
  { name: 'POST fixed-assets', ok: 201, prepare: async () => ({}),
    call: () => ({ verb: 'post', url: fin('fixed-assets'), body: { name: uniq('asset'), category: 'equipment', purchaseDate: '2026-01-01', purchaseCost: 500, usefulLifeMonths: 10 } }) },
  { name: 'PATCH fixed-assets/:id', ok: 200, prepare: async () => ({ id: await newFixedAsset() }),
    call: ({ id }) => ({ verb: 'patch', url: fin(`fixed-assets/${id}`), body: { name: uniq('asset-renamed') } }) },
  { name: 'POST fixed-assets/:id/depreciate (posts)', ok: 201, prepare: async () => ({ id: await newFixedAsset() }),
    call: ({ id }) => ({ verb: 'post', url: fin(`fixed-assets/${id}/depreciate`), body: {} }) },
  { name: 'POST fixed-assets/:id/dispose (posts)', ok: 201, prepare: async () => ({ id: await newFixedAsset() }),
    call: ({ id }) => ({ verb: 'post', url: fin(`fixed-assets/${id}/dispose`), body: { proceeds: 300 } }) },
  { name: 'DELETE fixed-assets/:id', ok: 200, prepare: async () => ({ id: await newFixedAsset() }),
    call: ({ id }) => ({ verb: 'delete', url: fin(`fixed-assets/${id}`) }) },
  { name: 'POST accounting-periods', ok: 201, allowed: ID.owner, prepare: async () => ({}),
    call: () => { periodMonth += 1; return { verb: 'post', url: fin('accounting-periods'), body: { year: 2001 + Math.floor((periodMonth - 1) / 12), month: ((periodMonth - 1) % 12) + 1 } }; } },
  { name: 'PATCH accounting-periods/:id', ok: 200, allowed: ID.owner,
    prepare: async () => { const p = await newPeriod('OPEN'); periodMonth += 1; return { id: p.id, year: String(2001 + Math.floor((periodMonth - 1) / 12)), month: String(((periodMonth - 1) % 12) + 1) }; },
    call: ({ id, year, month }) => ({ verb: 'patch', url: fin(`accounting-periods/${id}`), body: { year: Number(year), month: Number(month) } }) },
  { name: 'POST accounting-periods/:id/close (stamps the month\'s transactions)', ok: 201, allowed: ID.owner, refused: [ID.adminRevNone, REV_WRITE_NONE],
    prepare: async () => ({ id: (await newPeriod('OPEN')).id }),
    call: ({ id }) => ({ verb: 'post', url: fin(`accounting-periods/${id}/close`), body: {} }) },
  { name: 'POST accounting-periods/:id/reopen', ok: 201, allowed: ID.owner,
    prepare: async () => ({ id: (await newPeriod('CLOSED')).id }),
    call: ({ id }) => ({ verb: 'post', url: fin(`accounting-periods/${id}/reopen`), body: {} }) },
  { name: 'DELETE accounting-periods/:id', ok: 200, allowed: ID.owner,
    prepare: async () => ({ id: (await newPeriod('OPEN')).id }),
    call: ({ id }) => ({ verb: 'delete', url: fin(`accounting-periods/${id}`) }) },
];

const EXPENSE_DOORS: Door[] = [
  { name: 'POST tax-liabilities/:id/pay (posts the TAX payment)', ok: 201, allowed: ID.expWrite, refused: [ID.revWrite, EXP_WRITE_READ],
    prepare: async () => ({ id: await newTaxLiability('FILED') }),
    call: ({ id }) => ({ verb: 'post', url: fin(`tax-liabilities/${id}/pay`), body: {} }) },
  { name: 'POST tax/liabilities/:id/pay (alias)', ok: 201, allowed: ID.expWrite, refused: [ID.revWrite, EXP_WRITE_READ],
    prepare: async () => ({ id: await newTaxLiability('FILED') }),
    call: ({ id }) => ({ verb: 'post', url: fin(`tax/liabilities/${id}/pay`), body: {} }) },
  { name: 'POST marketplace purchase-orders/:poId/advance to RECEIVED (posts the purchase)', ok: 201, allowed: ID.expWrite, refused: [ID.revWrite, EXP_WRITE_READ],
    prepare: async () => ({ id: await newPurchaseOrder('SHIPPED') }),
    call: ({ id }) => ({ verb: 'post', url: market(`purchase-orders/${id}/advance`), body: { status: 'RECEIVED' } }) },
  { name: 'PATCH marketplace purchase-orders/:poId (a status moves it as advance does)', ok: 200, allowed: ID.expWrite, refused: [ID.revWrite, EXP_WRITE_READ],
    prepare: async () => ({ id: await newPurchaseOrder('DRAFT') }),
    call: ({ id }) => ({ verb: 'patch', url: market(`purchase-orders/${id}`), body: { status: 'SUBMITTED' } }) },
];

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitterModule } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { MarketplaceController } = await import('../src/modules/marketplace/marketplace.controller');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { FinancialAccountSeederService } = await import('../src/modules/finance/financial-account-seeder.service');
  const { FinanceAccountsService } = await import('../src/modules/finance/finance-accounts.service');
  const { FinanceAuditService } = await import('../src/modules/finance/finance-audit.service');
  const { BankRuleService } = await import('../src/modules/finance/bank-rule.service');
  const { BankImportService } = await import('../src/modules/finance/bank-import.service');
  const { BankMatchingService } = await import('../src/modules/finance/bank-matching.service');
  const { ReconciliationService } = await import('../src/modules/finance/reconciliation.service');
  const { TaxLiabilityService } = await import('../src/modules/finance/tax-liability.service');
  const { FixedAssetService } = await import('../src/modules/finance/fixed-asset.service');
  const { RecurringJournalEntryService } = await import('../src/modules/finance/recurring-journal-entry.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { MarketplaceService } = await import('../src/modules/marketplace/marketplace.service');
  const { FulfillmentRoutingService } = await import('../src/modules/marketplace/fulfillment-routing.service');
  const { CommerceIntegrationService } = await import('../src/modules/marketplace/commerce-integration.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');

  // FinanceController's collaborators off these routes.
  const stubs = await Promise.all([
    import('../src/modules/finance/receivables.service').then((m) => m.ReceivablesService),
    import('../src/modules/finance/finance-overview.service').then((m) => m.FinanceOverviewService),
    import('../src/modules/finance/finance-coa.service').then((m) => m.FinanceCoaService),
    import('../src/modules/finance/finance-tax-rate.service').then((m) => m.FinanceTaxRateService),
    import('../src/modules/finance/finance-settings.service').then((m) => m.FinanceSettingsService),
    import('../src/modules/finance/statement-source.service').then((m) => m.StatementSourceService),
    import('../src/modules/finance/accountant-export.service').then((m) => m.AccountantExportService),
    import('../src/modules/finance/finance-intelligence.service').then((m) => m.FinanceIntelligenceService),
    import('../src/modules/finance/accountant-export-email.service').then((m) => m.AccountantExportEmailService),
    import('../src/modules/finance/safe-to-spend.service').then((m) => m.SafeToSpendService),
    import('../src/modules/finance/cashflow-forecast.service').then((m) => m.CashflowForecastService),
    import('../src/modules/finance/money-moves.service').then((m) => m.MoneyMovesService),
    import('../src/modules/finance/cash-reserve.service').then((m) => m.CashReserveService),
    import('../src/modules/finance/credit-note.service').then((m) => m.CreditNoteService),
    import('../src/modules/finance/bank-connection.service').then((m) => m.BankConnectionService),
    import('../src/modules/finance/exchange-rate.service').then((m) => m.ExchangeRateService),
    import('../src/core/object-storage').then((m) => m.ObjectStorageService),
  ]);

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
    controllers: [FinanceController, MarketplaceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      // Live: the ledger door and every Books service the doors call.
      PostingService,
      AccountingPeriodService,
      LedgerBalanceService,
      ChartOfAccountsSeederService,
      FinancialAccountSeederService,
      FinanceAccountsService,
      FinanceAuditService,
      BankRuleService,
      BankImportService,
      BankMatchingService,
      ReconciliationService,
      TaxLiabilityService,
      FixedAssetService,
      RecurringJournalEntryService,
      ExpensePostingService,
      MarketplaceService,
      FulfillmentRoutingService,
      { provide: TransactionalEmailService, useValue: { send: async () => null } },
      { provide: CommerceIntegrationService, useValue: {} },
      ...stubs.map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  const coa = moduleRef.get(ChartOfAccountsSeederService);
  posting = moduleRef.get(PostingService);

  app = moduleRef.createNestApplication();
  attachIdentity(app);
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  for (const [id, role] of [
    [ID.owner, 'USER'], [ID.revRead, 'USER'], [ID.revWrite, 'USER'], [ID.expWrite, 'USER'], [ID.crmOnly, 'USER'],
    [ID.adminRevNone, 'USER'], [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V98B Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  const m = (userId: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}`, userId, businessId: ID.biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, 'OWNER');
  await m(ID.revRead, 'STAFF', { revenue: 'read', expenses: 'read' });
  await m(ID.revWrite, 'STAFF', { revenue: 'write', expenses: 'read' });
  await m(ID.expWrite, 'STAFF', { revenue: 'read', expenses: 'write' });
  await m(ID.crmOnly, 'STAFF', { crm: 'read' });
  await m(ID.adminRevNone, 'ADMIN', { crm: 'admin', revenue: 'none', operations: 'admin', expenses: 'admin' });
  await coa.ensureDefaults(ID.biz);
  for (const key of ['BANK', 'CASH', 'OWNER_EQUITY']) COA[key] = (await coa.getBySystemKey(ID.biz, key)).id;
  bankAccountId = await newBankAccount('main');
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('fixture sanity (real rows)', () => {
  it('the business has its OWNER, STAFF and ADMIN members on explicit maps, its chart and a bank account; the SUPER_ADMIN is no member', async () => {
    expect(await db.membership.count({ where: { businessId: ID.biz } })).toBe(6);
    expect(await db.membership.count({ where: { userId: ID.superAdmin } })).toBe(0);
    expect(COA.BANK && COA.CASH && COA.OWNER_EQUITY && bankAccountId).toBeTruthy();
  });
});

describe('BWS-01: the review\'s chain (import a line, write a rule naming OWNER_EQUITY, apply it)', () => {
  it('BWS-01 RED-BEFORE: a revenue:read member is refused each step 403 and no line, rule or posting is written', async () => {
    const acct = await newBankAccount(uniq('chain'));
    const before = await books();
    const imported = await http().post(fin(`accounts/${acct}/bank-transactions/import?autoMatch=false`)).set(HEADER, ID.revRead)
      .attach('file', Buffer.from('Date,Description,Amount\n2026-11-01,zrsx deposit 999,99999.00\n'), 'statement.csv');
    expect(imported.status, JSON.stringify(imported.body)).toBe(403);
    expect(imported.body).toMatchObject({ code: 'FORBIDDEN', message: REV_WRITE_READ });
    const rule = await http().post(fin('bank-rules')).set(HEADER, ID.revRead).send({ name: 'zrsx', pattern: 'zrsx', accountId: COA.OWNER_EQUITY });
    expect(rule.status, JSON.stringify(rule.body)).toBe(403);
    expect(rule.body).toMatchObject({ code: 'FORBIDDEN', message: REV_WRITE_READ });
    const line = await newBankLine(acct, 'zrsx deposit 999', 99999);
    const mid = await books();
    const applied = await http().post(fin('bank-rules/apply')).set(HEADER, ID.revRead).send({ bankTransactionIds: [line] });
    expect(applied.status, JSON.stringify(applied.body)).toBe(403);
    expect(applied.body).toMatchObject({ code: 'FORBIDDEN', message: REV_WRITE_READ });
    expect(await books()).toEqual(mid);
    expect(before).not.toEqual(mid); // only the line this test planted
    expect(await db.financialTransaction.count({ where: { businessId: ID.biz, createdById: ID.revRead } })).toBe(0);
    expect(await db.bankRule.count({ where: { businessId: ID.biz, pattern: 'zrsx' } })).toBe(0);
  });
});

describe('BWS-02..04: every Books door needs revenue write', () => {
  it.each(BOOKS_DOORS.map((d) => [d.name, d] as const))('%s', async (_name, door) => {
    const ctx = await door.prepare();
    const req = door.call(ctx);
    const [refusedAs, refusal] = door.refused ?? [ID.revRead, REV_WRITE_READ];

    // BWS-02 RED-BEFORE: below revenue write, refused before the handler; the Books byte-identical.
    let before = await books();
    const refused = await send(refusedAs, req);
    expect(refused.status, `refused: ${JSON.stringify(refused.body)}`).toBe(403);
    expect(refused.body).toMatchObject({ code: 'FORBIDDEN', message: refusal });
    expect(await books()).toEqual(before);

    // BWS-03 CONTROL (D-46): a non-member SUPER_ADMIN, whom the guard passes, is refused by the membership check.
    before = await books();
    const outsider = await send(ID.superAdmin, req);
    expect(outsider.status, `outsider: ${JSON.stringify(outsider.body)}`).toBe(403);
    expect(outsider.body).toMatchObject({ code: 'FORBIDDEN', message: NOT_MEMBER });
    expect(await books()).toEqual(before);

    // BWS-04: with revenue write (the OWNER for the period gate), the door works and the Books change.
    before = await books();
    const ok = await send(door.allowed ?? ID.revWrite, req);
    expect(ok.status, `allowed: ${JSON.stringify(ok.body)}`).toBe(door.ok);
    if (door.writes !== false) expect(await books()).not.toEqual(before);
  });

  it('BWS-04: the doors that post wrote their postings (opening balance, rule applies, auto-match, depreciation, disposal), each by its member', async () => {
    const byMember = await db.financialTransaction.groupBy({
      by: ['type', 'createdById'],
      where: { businessId: ID.biz, createdById: ID.revWrite },
      _count: { _all: true },
    });
    const types = byMember.map((r: any) => r.type).sort();
    expect(types).toEqual(expect.arrayContaining(['ADJUSTMENT', 'OPENING_BALANCE']));
    expect(await db.financialTransaction.count({ where: { businessId: ID.biz, sourceType: 'FixedAsset' } })).toBeGreaterThanOrEqual(2);
  });
});

describe('BWS-05/06: a payment out that is an expense by nature needs expenses write', () => {
  it.each(EXPENSE_DOORS.map((d) => [d.name, d] as const))('%s', async (_name, door) => {
    const ctx = await door.prepare();
    const req = door.call(ctx);
    const [refusedAs, refusal] = door.refused!;

    let before = await books();
    const refused = await send(refusedAs, req);
    expect(refused.status, `refused: ${JSON.stringify(refused.body)}`).toBe(403);
    expect(refused.body).toMatchObject({ code: 'FORBIDDEN', message: refusal });
    expect(await books()).toEqual(before);

    before = await books();
    const outsider = await send(ID.superAdmin, req);
    expect(outsider.status, `outsider: ${JSON.stringify(outsider.body)}`).toBe(403);
    expect(outsider.body).toMatchObject({ code: 'FORBIDDEN', message: NOT_MEMBER });
    expect(await books()).toEqual(before);

    before = await books();
    const ok = await send(door.allowed!, req);
    expect(ok.status, `allowed: ${JSON.stringify(ok.body)}`).toBe(door.ok);
    expect(await books()).not.toEqual(before);
  });

  it('BWS-05/06: the tax payments posted TAX transactions and the receipt posted the purchase', async () => {
    expect(await db.financialTransaction.count({ where: { businessId: ID.biz, type: 'TAX', sourceType: 'TaxLiability' } })).toBe(2);
    expect(await db.financialTransaction.count({ where: { businessId: ID.biz, sourceType: 'PurchaseOrder' } })).toBe(1);
  });
});

describe('BWS-07: an explicit revenue none binds an ADMIN (D-114)', () => {
  it('BWS-07 RED-BEFORE: a D-114 ADMIN is refused a period close and a bank rule; the Books unchanged', async () => {
    const period = await newPeriod('OPEN');
    const before = await books();
    const close = await http().post(fin(`accounting-periods/${period.id}/close`)).set(HEADER, ID.adminRevNone).send({});
    expect(close.status, JSON.stringify(close.body)).toBe(403);
    expect(close.body).toMatchObject({ message: REV_WRITE_NONE });
    const rule = await http().post(fin('bank-rules')).set(HEADER, ID.adminRevNone).send({ name: 'x', pattern: uniq('adm'), accountId: COA.OWNER_EQUITY });
    expect(rule.status, JSON.stringify(rule.body)).toBe(403);
    expect(await books()).toEqual(before);
  });
});

describe('BWS-08: the recurring template reads need revenue read (D-57, SEC-P195JS-2)', () => {
  it('BWS-08 RED-BEFORE: revenue none (STAFF, and a D-114 ADMIN) is refused the list and a template; revenue read reads them; a non-member SUPER_ADMIN is refused', async () => {
    const template = await db.recurringJournalEntry.create({
      data: {
        businessId: ID.biz, name: uniq('template'), frequency: 'MONTHLY', nextRunDate: new Date(Date.now() + 86_400_000 * 30),
        entries: [{ accountId: COA.CASH, debit: 12 }, { accountId: COA.OWNER_EQUITY, credit: 12 }],
      },
    });
    for (const as of [ID.crmOnly, ID.adminRevNone]) {
      for (const url of [fin('recurring-journal-entries'), fin(`recurring-journal-entries/${template.id}`)]) {
        const res = await http().get(url).set(HEADER, as);
        expect(res.status, `${as} ${url}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: REV_READ_NONE });
        expect(JSON.stringify(res.body)).not.toContain('"debit"');
      }
    }
    for (const url of [fin('recurring-journal-entries'), fin(`recurring-journal-entries/${template.id}`)]) {
      const outsider = await http().get(url).set(HEADER, ID.superAdmin);
      expect(outsider.status, JSON.stringify(outsider.body)).toBe(403);
      expect(outsider.body).toMatchObject({ message: NOT_MEMBER });
    }
    const list = await http().get(fin('recurring-journal-entries')).set(HEADER, ID.revRead);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.items.map((t: any) => t.id)).toContain(template.id);
    const one = await http().get(fin(`recurring-journal-entries/${template.id}`)).set(HEADER, ID.revRead);
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(one.body.id).toBe(template.id);
  });
});
