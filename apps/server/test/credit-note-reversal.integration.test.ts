/**
 * V1-44-DM-CREDIT-NOTE — a credit note reverses through the ledger door and
 * the invoice's credited states belong to the workflow (REAL database, REAL
 * credit-note routes behind the real AuthGuard / BusinessGuard / global
 * TenantInterceptor, REAL CreditNoteService, InvoiceWorkflowService,
 * RevenuePostingService and PostingService).
 *
 * CF-42 (docs/reconstruction/BUILD-MAP-001.md): the only P0-4 reversal
 * primitive was unreachable and its void left its consequences active. At the
 * V1-42 head, CreditNoteService.apply looked the invoice's recognition up by
 * sourceType 'INVOICE' (credit-note.service.ts:111,124) while every posting of
 * an invoice says 'Invoice' (RevenuePostingService.onInvoiceFinalized), so
 * applying a note to an issued ACCRUAL invoice answered 400 "Could not find
 * original invoice ledger entries"; and void flipped the note to VOID with no
 * reversal, leaving the invoice FULLY_CREDITED / PARTIALLY_CREDITED and the
 * receivable reduced. apply also wrote Invoice.status itself, around the
 * workflow (the last bypass but one on invoice-status-writers.spec.ts).
 *
 * Owner ruling D-28 (2026-11-02): FULLY_CREDITED and PARTIALLY_CREDITED are
 * real invoice states, driven by credit notes that post to the ledger. No enum
 * migration (the stop rule does not trigger).
 *
 *   CN-01 RED-BEFORE + LEDGER apply 40 to a SENT 100 ACCRUAL invoice -> 201: one REVERSAL of kind
 *         credit_note_applied (externalRef 'CREDIT_NOTE:<id>:credit_note_applied', Dr REVENUE 40 /
 *         Cr AR 40, in the invoice's currency); the note APPLIED and linked to it; the invoice
 *         PARTIALLY_CREDITED; credited 40 + receivable 60 = 100; trial balance balanced
 *   CN-02 + LEDGER a second note of 60 -> FULLY_CREDITED; credited 100 + receivable 0 = 100
 *   CN-03 RED-BEFORE + LEDGER void the APPLIED 60 -> 201: one offsetting transaction through
 *         PostingService.reverse (reversalOfId, ':reversal', entries mirrored, the note's posting
 *         REVERSED); the invoice FULLY_CREDITED -> PARTIALLY_CREDITED; credited 40 + receivable 60
 *   CN-04 + LEDGER void the last APPLIED note -> the invoice back to SENT (no payment); receivable 100
 *   CN-04b RED-BEFORE an APPLIED note with no posting (the rows the V1-28 suites seed) voided -> the
 *         invoice converges FULLY_CREDITED -> SENT; nothing to reverse, nothing posted (base: the
 *         note flipped to VOID and the invoice stayed FULLY_CREDITED)
 *   CN-05 void a DRAFT note -> 201, VOID, nothing posted, the invoice untouched
 *   CN-06 + LEDGER a PAID invoice part-credited (D-28 PARTIALLY_CREDITED, as V1-28 reads it) and the
 *         note voided -> PAID again with its paidAt; no invoice.* event either way (no second
 *         invoice.paid: no receipt, no COGS)
 *   CN-07 apply to a VOID invoice -> 409 from the workflow's table; nothing written
 *   CN-08 apply twice in sequence -> the second 400; two concurrent applies -> one 201; one posting
 *   CN-09 a draft raised by PATCH past what is left to credit -> apply 400; nothing written
 *   CN-10 control: a CASH-basis invoice has no recognition to reverse -> 400, nothing written (as at
 *         the base; the cash-basis credit policy is not decided by this packet)
 *   CN-11 another tenant's note on this tenant's routes -> 404; untouched
 *   CN-12 RED-BEFORE credit-note.service.ts writes no Invoice.status: every credited move is
 *         InvoiceWorkflowService.reconcileFromCredits (the static ratchet is
 *         src/modules/commerce/invoice-status-writers.spec.ts)
 *
 * V1-44 review repairs:
 *   CN-13 SEC-V44-1 / SEC-V44-4 apply needs a member holding revenue:write: a STAFF member
 *         (revenue:read) and a revenue:none member -> 403 on the route; 'system', 'user',
 *         'key_ai', no actor and a non-member -> 403 on the service; nothing read or written.
 *         A member granted revenue:write applies, and the posting names that member
 *   CN-14 SEC-V44-2 a DELETE that read DRAFT and then waited on an apply's row lock does not
 *         delete the APPLIED note (400): the note, its posting and its void survive
 *   CN-15 SEC-V44-5 (service) a void that names its member records that member on the reversal
 *   CN-16 CR-V44-1 a PARTIALLY_CREDITED invoice collects what its credits leave owing (the
 *         payment, its posting and the receivable to 0 commit; the status stays credited);
 *         money beyond it, the credit-unaware total mark-paid records, and any payment on a
 *         FULLY_CREDITED invoice -> 409 with nothing written
 *   it.todo: the credit-unaware share / pay-link / mark-paid readers in commerce.service.ts
 *         and payments.service.ts (CR-V44-1 reader half)
 *
 * V1-44b-CREDIT-NOTE-ROUTES-AND-INTAKE (the V1-44 review halves outside its write set):
 *   CN-17 SEC-V44-1 (route half, D-57, D-46) every credit-note write (create, PATCH, apply, void,
 *         DELETE) needs revenue:write and every read (list, detail) revenue:read: a STAFF member
 *         (revenue:read) is refused the writes 403, a revenue:none member everything 403, a
 *         non-member SUPER_ADMIN everything 403; a refused call writes nothing. A member granted
 *         revenue:write does all of it
 *   CN-18 SEC-V44-5 (route half) POST /:id/void names the member: the reversal's createdById
 *   CN-19 SEC-V44-3 two concurrent approvals of one Drive-intake plan credit the invoice once (the
 *         approval is a compare-and-set claim: exactly one runs); a re-run of the same plan (the
 *         intake put back to reviewing) answers the step's own note: one note, one apply, one
 *         REVERSAL; credited + remaining = total
 *   CN-20 SEC-V44-4 the intake applies as the approving member (approverActorId, as its payment
 *         step): the ingestion auto-execute ('system') and the data-inbox fallback ('user') post
 *         nothing (the note stays DRAFT, no posting names a placeholder)
 *   CN-21 SEC-V44-6 a note whose invoice belongs to another business cannot move that invoice:
 *         void refused 400 with nothing written (the invoice lock and lookup carry businessId)
 *   CN-22 CR-V44-3 a credit smaller than one cent per revenue split posts no zero or negative leg:
 *         0.01 on a 50/50 SERVICE/PRODUCT invoice applies (201), balanced
 *   CN-23 CR-V44-4 an invoice the AI undo returned to DRAFT with two notes applied: each note is
 *         voided (201), its posting reversed, the invoice left DRAFT (a credit note never moves a
 *         DRAFT or VOID invoice)
 *   (CR-V44-2, outside this write set: now CN-29 below)
 *
 * V1-44b review repairs:
 *   CN-20 (amended by SEC-V44b-R2) the placeholders are refused 403 BEFORE the claim: no note,
 *         no posting, the intake stays 'reviewing' and a member with revenue:write then runs it
 *   CN-24 SEC-V44b-R1 / CRR-V44b-1 (route half) POST credit-notes refuses a 'CN-DRIVE-' number
 *         (any case, padded) 400 with nothing written, so no member pre-creates a plan step's note;
 *         the owner's approval then credits exactly the plan's amount, in the owner's name
 *   CN-25 SEC-V44b-R1 / CRR-V44b-1 a note carrying the step's number for another amount (a DRAFT a
 *         failed run left, or an APPLIED one from the plan before a re-sync) is not adopted: the
 *         re-planned step is refused 409, nothing applied or posted, nothing reported as credited
 *   CN-26 SEC-V44b-R2 a member with revenue:read (or none) approving a credit plan is refused 403
 *         before the claim: no note, the intake stays 'reviewing', the owner then runs it
 *   CN-27 SEC-V44b-R1 (apply half) apply with expectedAmount refuses 409 a note PATCHed since it
 *         was read, with nothing written; at the note's amount it applies
 *   CN-28 SEC-V44b-R3 the reads (list, detail, and the PATCH and DELETE answers) never disclose
 *         another tenant's invoice through a note's invoiceId: `invoice: null`
 *
 * W3-CREDIT-RECONCILE-BIND (the two V1-44b todos in invoice-workflow.service.ts):
 *   CN-29 CR-V44-2 (D-14, D-78) reconcileFromCredits clears paidAt whenever the status it writes
 *         is not PAID and the payment rows no longer settle the invoice: a PAID invoice credited,
 *         refunded and then its note voided returns to SENT or PARTIALLY_PAID with no paidAt; one
 *         credited in full after its money went back holds none either. A PAID invoice
 *         part-credited with its payment in place keeps it (CN-06), and a return to PAID keeps it
 *         or, with none, stamps it
 *   CN-30 SEC-V44-6 (function half) reconcileFromCredits takes the businessId and reads and locks
 *         the invoice by { id, businessId }: another business's invoice is refused 404 and left
 *         as it is; its own business reconciles it; the call holds the row lock itself
 *
 * W3-CREDIT-RECONCILE-BIND review repairs:
 *   CN-31 W3CRB-ST-1 CR-V44-2 a credit move (apply or void) that leaves a credited invoice in its
 *         credited status still clears a paidAt nothing settles, so one money position (credited 50
 *         of 100, the 100 refunded) ends with paidAt null whatever the path; with its payment in
 *         place a second partial note keeps the paidAt (CN-06)
 *   it.todo CRB-CR-1 the refund half of CR-V44-2: a refund that unsettles a credited invoice writes
 *         nothing (reconcileCreditedFromPayments, outside this write set), so the paidAt stays until
 *         the next credit move
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * TenantInterceptor, FinanceController (credit-note routes), CreditNoteService,
 * InvoiceWorkflowService, RevenuePostingService, PostingService,
 * AccountingPeriodService and ChartOfAccountsSeederService read and write real
 * rows; the production GlobalHttpExceptionFilter is installed. Identity
 * attachment is the one stand-in (`x-v44a-user`, as the Supabase-verifying
 * AuthMiddleware would). EventEmitter2 is a recorder; TimelineService and
 * ExpensePostingService (COGS: no product lines here) are stubs off the
 * ledger path; every other FinanceController collaborator is an empty stub.
 *
 * Fixtures: prefix `v44a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency
 * order in beforeAll and afterAll; no $transaction wrapping of the cases.
 */
import 'reflect-metadata';
import path from 'path';
import { readFileSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v44a_';
const HEADER = 'x-v44a-user';
const TOTAL = 100;

const ID = {
  owner: `${P}owner`,
  ownerF: `${P}ownerF`,
  staff: `${P}staff`, // STAFF, role defaults (revenue:read)
  norev: `${P}norev`, // STAFF, an explicit scope map with revenue:none
  writer: `${P}writer`, // STAFF, an explicit scope map granting revenue:write
  admin: `${P}admin`, // a platform SUPER_ADMIN with no Membership anywhere (D-46)
  biz: `${P}biz`, // ACCRUAL, the tenant under test
  bizCash: `${P}bizCash`, // CASH basis
  bizF: `${P}bizF`, // a foreign tenant
  contact: `${P}contact`,
  contactCash: `${P}contactCash`,
  contactF: `${P}contactF`,
};

type Emitted = { name: string; payload: any };
const emitted: Emitted[] = [];
const recorder = {
  emit: (name: string, payload: unknown) => {
    emitted.push({ name, payload });
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

let db: any;
let app: any;
let workflow: any;
let revenuePosting: any;
let creditNotes: any;
let prismaService: any;
let DriveIntakeOrchestratorClass: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM credit_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM drive_intake_files WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_approval_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}

function api(method: 'get' | 'post' | 'patch' | 'delete', route: string, businessId = ID.biz, actor = ID.owner) {
  return agent()[method](`/finance/businesses/${businessId}/credit-notes${route}`).set(HEADER, actor);
}

/** Rounded to cents; never negative zero (a fully credited revenue nets to 0, not -0). */
const money = (n: number) => Math.round(n * 100) / 100 || 0;

let invoiceSeq = 0;

/**
 * A 100.00 invoice moved to `status` the way the product moves it: issued by
 * the workflow (an ACCRUAL issue posts the receivable, sourceType 'Invoice'),
 * paid by a SUCCESSFUL payment row posted by RevenuePostingService and
 * reconciled by the workflow.
 */
async function seedInvoice(
  key: string,
  status: 'SENT' | 'PAID' | 'VOID',
  opts: { businessId?: string; contactId?: string } = {},
): Promise<string> {
  const businessId = opts.businessId ?? ID.biz;
  const id = `${P}inv_${key}`;
  invoiceSeq += 1;
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: `${P}INV-${String(invoiceSeq).padStart(3, '0')}`,
      businessId,
      contactId: opts.contactId ?? ID.contact,
      status: 'DRAFT',
      subtotal: TOTAL,
      total: TOTAL,
      currency: 'TTD',
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      items: { create: [{ description: `v44a ${key}`, quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
    },
  });
  await workflow.transition(id, 'SENT', { sentAt: new Date() });
  if (status === 'VOID') await workflow.transition(id, 'VOID');
  if (status === 'PAID') {
    const paymentId = `${id}_pay`;
    await db.payment.create({
      data: {
        id: paymentId,
        amount: TOTAL,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_${key}`,
        businessId,
        invoiceId: id,
      },
    });
    await revenuePosting.onPaymentRecorded(paymentId);
    await workflow.reconcileFromPayments(id);
  }
  emitted.length = 0;
  return id;
}

let noteSeq = 0;
async function createNote(invoiceId: string, amount: number, businessId = ID.biz, actor = ID.owner): Promise<any> {
  noteSeq += 1;
  const res = await api('post', '', businessId, actor).send({
    invoiceId,
    creditNoteNumber: `${P}CN-${String(noteSeq).padStart(3, '0')}`,
    amount,
    reason: 'v44a adjustment',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

const applyNote = (id: string, businessId = ID.biz, actor = ID.owner) => api('post', `/${id}/apply`, businessId, actor).send({});
const voidNote = (id: string, businessId = ID.biz, actor = ID.owner) => api('post', `/${id}/void`, businessId, actor).send({});

async function invoiceRow(id: string): Promise<any> {
  return db.invoice.findUnique({ where: { id } });
}

async function noteRow(id: string): Promise<any> {
  return db.creditNote.findUnique({ where: { id } });
}

/** Every posting sourced by one credit note, oldest first, with its entries and their accounts. */
async function notePostings(noteId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { sourceType: 'CREDIT_NOTE', sourceId: noteId },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/** Net debit - credit per chart system key over a set of postings. */
function netBySystemKey(txns: any[]): Record<string, number> {
  const net: Record<string, number> = {};
  for (const t of txns) {
    for (const e of t.entries) {
      const k = e.account?.systemKey ?? e.accountId;
      net[k] = money((net[k] ?? 0) + Number(e.debit) - Number(e.credit));
    }
  }
  return net;
}

/**
 * The invoice as the ledger states it: every posting sourced by the invoice,
 * its payments and its credit notes. `receivable` is its AR net; `credited`
 * the APPLIED credit notes on it.
 */
async function ledgerOf(invoiceId: string): Promise<{ receivable: number; revenue: number; credited: number }> {
  const inv = await invoiceRow(invoiceId);
  const payments = await db.payment.findMany({ where: { invoiceId }, select: { id: true } });
  const notes = await db.creditNote.findMany({ where: { invoiceId }, select: { id: true, status: true, amount: true } });
  const txns = await db.financialTransaction.findMany({
    where: {
      businessId: inv.businessId,
      OR: [
        { sourceType: 'Invoice', sourceId: invoiceId },
        { sourceType: 'Payment', sourceId: { in: payments.map((p: any) => p.id) } },
        { sourceType: 'CREDIT_NOTE', sourceId: { in: notes.map((n: any) => n.id) } },
      ],
    },
    include: { entries: { include: { account: { select: { systemKey: true } } } } },
  });
  const net = netBySystemKey(txns);
  const credited = money(notes.filter((n: any) => n.status === 'APPLIED').reduce((s: number, n: any) => s + Number(n.amount), 0));
  return { receivable: net.ACCOUNTS_RECEIVABLE ?? 0, revenue: money(-(net.REVENUE ?? 0)), credited };
}

/** Every posting of one business is balanced, and so is the business per currency (its trial balance). */
async function expectBalanced(businessId: string) {
  const perCurrency: Array<{ currency: string; debit: string; credit: string }> = await db.$queryRawUnsafe(
    `SELECT currency, SUM(debit)::text AS debit, SUM(credit)::text AS credit FROM ledger_entries WHERE business_id = $1 GROUP BY currency`,
    businessId,
  );
  expect(perCurrency.length, `${businessId} has ledger rows`).toBeGreaterThan(0);
  for (const r of perCurrency) expect(Number(r.debit), `${businessId} ${r.currency} trial balance: debits = credits`).toBe(Number(r.credit));
  const unbalanced = await db.$queryRawUnsafe(
    `SELECT transaction_id FROM ledger_entries WHERE business_id = $1 GROUP BY transaction_id HAVING SUM(debit) <> SUM(credit)`,
    businessId,
  );
  expect(unbalanced, `${businessId}: every posting balanced`).toEqual([]);
}

async function ledgerCounts(businessId: string): Promise<{ txns: number; entries: number }> {
  return {
    txns: await db.financialTransaction.count({ where: { businessId } }),
    entries: await db.ledgerEntry.count({ where: { businessId } }),
  };
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  DriveIntakeOrchestratorClass = (await import('../src/modules/commerce/drive-intake-orchestrator.service')).DriveIntakeOrchestrator;
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { CreditNoteService } = await import('../src/modules/finance/credit-note.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');

  const real: any[] = [
    CreditNoteService,
    PostingService,
    AccountingPeriodService,
    ChartOfAccountsSeederService,
    RevenuePostingService,
    InvoiceWorkflowService,
  ];
  // FinanceController's other collaborators: empty stubs off the credit-note path.
  const collaborators = await Promise.all([
    import('../src/modules/finance/receivables.service').then((m) => m.ReceivablesService),
    import('../src/modules/finance/ledger-balance.service').then((m) => m.LedgerBalanceService),
    import('../src/modules/finance/finance-overview.service').then((m) => m.FinanceOverviewService),
    import('../src/modules/finance/finance-accounts.service').then((m) => m.FinanceAccountsService),
    import('../src/modules/finance/finance-coa.service').then((m) => m.FinanceCoaService),
    import('../src/modules/finance/finance-tax-rate.service').then((m) => m.FinanceTaxRateService),
    import('../src/modules/finance/finance-settings.service').then((m) => m.FinanceSettingsService),
    import('../src/modules/finance/bank-import.service').then((m) => m.BankImportService),
    import('../src/modules/finance/statement-source.service').then((m) => m.StatementSourceService),
    import('../src/modules/finance/bank-matching.service').then((m) => m.BankMatchingService),
    import('../src/modules/finance/bank-rule.service').then((m) => m.BankRuleService),
    import('../src/modules/finance/recurring-journal-entry.service').then((m) => m.RecurringJournalEntryService),
    import('../src/modules/finance/reconciliation.service').then((m) => m.ReconciliationService),
    import('../src/modules/finance/tax-liability.service').then((m) => m.TaxLiabilityService),
    import('../src/modules/finance/accountant-export.service').then((m) => m.AccountantExportService),
    import('../src/modules/finance/finance-intelligence.service').then((m) => m.FinanceIntelligenceService),
    import('../src/modules/finance/accountant-export-email.service').then((m) => m.AccountantExportEmailService),
    import('../src/modules/finance/safe-to-spend.service').then((m) => m.SafeToSpendService),
    import('../src/modules/finance/cashflow-forecast.service').then((m) => m.CashflowForecastService),
    import('../src/modules/finance/money-moves.service').then((m) => m.MoneyMovesService),
    import('../src/modules/finance/cash-reserve.service').then((m) => m.CashReserveService),
    import('../src/modules/finance/bank-connection.service').then((m) => m.BankConnectionService),
    import('../src/modules/finance/exchange-rate.service').then((m) => m.ExchangeRateService),
    import('../src/modules/finance/fixed-asset.service').then((m) => m.FixedAssetService),
  ]);

  const moduleRef = await Test.createTestingModule({
    controllers: [FinanceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      ...real,
      ...collaborators.filter((token) => !real.includes(token)).map((token) => ({ provide: token, useValue: {} })),
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: EventEmitter2, useValue: recorder },
    ],
  }).compile();
  workflow = moduleRef.get(InvoiceWorkflowService);
  revenuePosting = moduleRef.get(RevenuePostingService);
  creditNotes = moduleRef.get(CreditNoteService);
  prismaService = moduleRef.get(PrismaService);
  const coa = moduleRef.get(ChartOfAccountsSeederService);

  app = moduleRef.createNestApplication();
  // Identity attachment only. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerF, email: `${P}ownerF@test.local`, role: 'USER' } });
  for (const [tag, biz, owner, basis, contact] of [
    ['accrual', ID.biz, ID.owner, 'ACCRUAL', ID.contact],
    ['cash', ID.bizCash, ID.owner, 'CASH', ID.contactCash],
    ['foreign', ID.bizF, ID.ownerF, 'ACCRUAL', ID.contactF],
  ] as const) {
    await db.business.create({
      data: { id: biz, name: `V44A ${tag}`, slug: `${P}slug-${tag}`, ownerId: owner, currency: 'TTD', accountingBasis: basis },
    });
    await db.membership.create({ data: { id: `${biz}_m`, userId: owner, businessId: biz, role: 'OWNER' } });
    await db.contact.create({ data: { id: contact, businessId: biz, firstName: 'V44a', lastName: 'Customer', email: `${P}customer-${tag}@test.local` } });
    await coa.ensureDefaults(biz);
  }
  // V1-44 review (SEC-V44-1): members of the ACCRUAL tenant below OWNER.
  const { defaultScopesForRole } = await import('../src/core/authority/module-vocabulary');
  for (const [user, scopes] of [
    [ID.staff, null],
    [ID.norev, { ...defaultScopesForRole('STAFF'), revenue: 'none' }],
    [ID.writer, { ...defaultScopesForRole('STAFF'), revenue: 'write' }],
  ] as const) {
    await db.user.create({ data: { id: user, email: `${P}${user.slice(P.length)}@test.local`, role: 'USER' } });
    await db.membership.create({
      data: { id: `${user}_m`, userId: user, businessId: ID.biz, role: 'STAFF', ...(scopes ? { permissionScopes: scopes } : {}) },
    });
  }
  // V1-44b (D-46): a platform SUPER_ADMIN with no Membership in any tenant.
  await db.user.create({ data: { id: ID.admin, email: `${P}admin@test.local`, role: 'SUPER_ADMIN' } });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

beforeEach(() => {
  emitted.length = 0;
});

describe('fixture sanity (real rows)', () => {
  it('an issued ACCRUAL invoice carries its recognition under sourceType Invoice (what apply must find)', async () => {
    const inv = await seedInvoice('sanity', 'SENT');
    const recognition = await db.financialTransaction.findMany({ where: { sourceType: 'Invoice', sourceId: inv } });
    expect(recognition.map((t: any) => t.externalRef)).toEqual([`Invoice:${inv}:invoice_finalized`]);
    expect(await db.financialTransaction.count({ where: { sourceType: 'INVOICE' } }), "nothing posts sourceType 'INVOICE'").toBe(0);
    expect(await ledgerOf(inv)).toEqual({ receivable: TOTAL, revenue: TOTAL, credited: 0 });
  });
});

describe('CF-42: apply reverses through the ledger door; void converges; the credited states belong to the workflow (D-28)', () => {
  let inv: string;
  let cn40: any;
  let cn60: any;

  it('CN-01 RED-BEFORE + LEDGER: apply 40 to a SENT 100 ACCRUAL invoice -> one REVERSAL of kind credit_note_applied; PARTIALLY_CREDITED; credited + receivable = total', async () => {
    inv = await seedInvoice('main', 'SENT');
    cn40 = await createNote(inv, 40);
    expect(cn40.status).toBe('DRAFT');

    const res = await applyNote(cn40.id);
    // RED-BEFORE (V1-42 head): 400 "Could not find original invoice ledger entries to reverse":
    // apply searched sourceType 'INVOICE' (credit-note.service.ts:111,124).
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const postings = await notePostings(cn40.id);
    expect(postings, 'one posting sourced by the note').toHaveLength(1);
    const [p] = postings;
    expect(p.type).toBe('REVERSAL');
    expect(p.status).toBe('POSTED');
    expect(p.externalRef).toBe(`CREDIT_NOTE:${cn40.id}:credit_note_applied`);
    expect(Number(p.amount)).toBe(40);
    expect(p.currency).toBe('TTD');
    expect(netBySystemKey(postings)).toEqual({ REVENUE: 40, ACCOUNTS_RECEIVABLE: -40 });
    expect(res.body.transactionId).toBe(p.id);

    const note = await noteRow(cn40.id);
    expect(note.status).toBe('APPLIED');
    expect(note.appliedAt).not.toBeNull();
    expect(note.reversalTransactionId).toBe(p.id);

    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_CREDITED');
    const ledger = await ledgerOf(inv);
    expect(ledger).toEqual({ receivable: 60, revenue: 60, credited: 40 });
    expect(money(ledger.credited + ledger.receivable), 'credited + remaining = invoice total').toBe(TOTAL);
    expect(emitted.filter((e) => e.name.startsWith('invoice.')), 'a credit move emits no invoice event').toEqual([]);
    await expectBalanced(ID.biz);
  });

  it('CN-02 + LEDGER: a second note of 60 -> FULLY_CREDITED; credited 100 + receivable 0 = total', async () => {
    cn60 = await createNote(inv, 60);
    const res = await applyNote(cn60.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    expect((await invoiceRow(inv)).status).toBe('FULLY_CREDITED');
    expect(netBySystemKey(await notePostings(cn60.id))).toEqual({ REVENUE: 60, ACCOUNTS_RECEIVABLE: -60 });
    const ledger = await ledgerOf(inv);
    expect(ledger).toEqual({ receivable: 0, revenue: 0, credited: TOTAL });
    expect(money(ledger.credited + ledger.receivable)).toBe(TOTAL);
    await expectBalanced(ID.biz);
  });

  it('CN-03 RED-BEFORE + LEDGER: void the APPLIED 60 -> one offsetting transaction through the door; FULLY_CREDITED -> PARTIALLY_CREDITED', async () => {
    const res = await voidNote(cn60.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const note = await noteRow(cn60.id);
    expect(note.status).toBe('VOID');
    expect(note.voidedAt).not.toBeNull();

    // RED-BEFORE (V1-42 head): the void flipped the note's status and posted nothing.
    const postings = await notePostings(cn60.id);
    expect(postings, 'the application and its reversal').toHaveLength(2);
    const original = postings.find((t: any) => t.reversalOfId === null);
    const reversal = postings.find((t: any) => t.reversalOfId !== null);
    expect(original.status, 'the application is marked REVERSED').toBe('REVERSED');
    expect(reversal.reversalOfId).toBe(original.id);
    expect(reversal.type).toBe('REVERSAL');
    expect(reversal.status).toBe('POSTED');
    expect(reversal.externalRef).toBe(`${original.externalRef}:reversal`);
    expect(netBySystemKey([reversal])).toEqual({ REVENUE: -60, ACCOUNTS_RECEIVABLE: 60 });
    expect(netBySystemKey(postings), 'the note nets to nothing').toEqual({ REVENUE: 0, ACCOUNTS_RECEIVABLE: 0 });

    // RED-BEFORE: the invoice stayed FULLY_CREDITED with only 40 credited.
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_CREDITED');
    const ledger = await ledgerOf(inv);
    expect(ledger).toEqual({ receivable: 60, revenue: 60, credited: 40 });
    expect(money(ledger.credited + ledger.receivable)).toBe(TOTAL);
    expect(emitted.filter((e) => e.name.startsWith('invoice.'))).toEqual([]);
    await expectBalanced(ID.biz);
  });

  it('CN-04 + LEDGER: void the last APPLIED note -> the invoice back to SENT (nothing paid); the receivable is the full total again', async () => {
    const res = await voidNote(cn40.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await noteRow(cn40.id)).status).toBe('VOID');
    expect(await notePostings(cn40.id)).toHaveLength(2);

    expect((await invoiceRow(inv)).status).toBe('SENT');
    expect(await ledgerOf(inv)).toEqual({ receivable: TOTAL, revenue: TOTAL, credited: 0 });
    // A voided note cannot be voided or applied again.
    expect((await voidNote(cn40.id)).status).toBe(400);
    expect((await applyNote(cn40.id)).status).toBe(400);
    expect(await notePostings(cn40.id)).toHaveLength(2);
    await expectBalanced(ID.biz);
  });

  it('CN-04b RED-BEFORE: void an APPLIED note left with no posting (the rows V1-28 suites seed, as apply left them) -> the invoice status converges (FULLY_CREDITED -> SENT); nothing to reverse, nothing posted', async () => {
    const legacyInv = await seedInvoice('legacy', 'SENT');
    const noteId = `${P}cn_legacy`;
    await db.creditNote.create({
      data: { id: noteId, businessId: ID.biz, invoiceId: legacyInv, creditNoteNumber: `${P}CN-LEGACY`, status: 'APPLIED', amount: TOTAL, appliedAt: new Date() },
    });
    await db.invoice.update({ where: { id: legacyInv }, data: { status: 'FULLY_CREDITED' } });
    const before = await ledgerCounts(ID.biz);

    const res = await voidNote(noteId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await noteRow(noteId)).status).toBe('VOID');
    // RED-BEFORE (V1-42 head): the note flipped to VOID and the invoice stayed FULLY_CREDITED.
    expect((await invoiceRow(legacyInv)).status).toBe('SENT');
    expect(await notePostings(noteId)).toEqual([]);
    expect(await ledgerCounts(ID.biz)).toEqual(before);
    expect(await ledgerOf(legacyInv)).toEqual({ receivable: TOTAL, revenue: TOTAL, credited: 0 });
  });

  it('CN-05: void a DRAFT note -> 201, VOID; nothing posted; the invoice untouched', async () => {
    const draftInv = await seedInvoice('draftvoid', 'SENT');
    const note = await createNote(draftInv, 25);
    const before = await ledgerCounts(ID.biz);

    const res = await voidNote(note.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await noteRow(note.id)).status).toBe('VOID');
    expect(await notePostings(note.id)).toEqual([]);
    expect(await ledgerCounts(ID.biz)).toEqual(before);
    expect((await invoiceRow(draftInv)).status).toBe('SENT');
    expect(await ledgerOf(draftInv)).toEqual({ receivable: TOTAL, revenue: TOTAL, credited: 0 });
  });

  it('CN-06 + LEDGER: a PAID invoice part-credited is PARTIALLY_CREDITED (D-28, as V1-28 reads it); voiding the note restores PAID with its paidAt; no invoice event', async () => {
    const paidInv = await seedInvoice('paid', 'PAID');
    const paidBefore = await invoiceRow(paidInv);
    expect(paidBefore.status).toBe('PAID');
    expect(paidBefore.paidAt).not.toBeNull();
    expect(await ledgerOf(paidInv)).toEqual({ receivable: 0, revenue: TOTAL, credited: 0 });

    const note = await createNote(paidInv, 30);
    const applied = await applyNote(note.id);
    expect(applied.status, JSON.stringify(applied.body)).toBe(201);
    expect((await invoiceRow(paidInv)).status).toBe('PARTIALLY_CREDITED');
    // The customer paid 100 and is credited 30: the receivable is a credit of 30 owed back.
    expect(await ledgerOf(paidInv)).toEqual({ receivable: -30, revenue: 70, credited: 30 });
    await expectBalanced(ID.biz);

    const voided = await voidNote(note.id);
    expect(voided.status, JSON.stringify(voided.body)).toBe(201);
    const after = await invoiceRow(paidInv);
    expect(after.status).toBe('PAID');
    expect(after.paidAt?.toISOString()).toBe(paidBefore.paidAt.toISOString());
    expect(await ledgerOf(paidInv)).toEqual({ receivable: 0, revenue: TOTAL, credited: 0 });
    expect(emitted.filter((e) => e.name.startsWith('invoice.')), 'no second invoice.paid (no receipt, no COGS)').toEqual([]);
    await expectBalanced(ID.biz);
  });

  it('CN-07: apply to a VOID invoice -> 409 from the workflow; nothing written', async () => {
    const voidInv = await seedInvoice('void', 'VOID');
    const note = await createNote(voidInv, 10);
    const before = await ledgerCounts(ID.biz);

    const res = await applyNote(note.id);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect((await noteRow(note.id)).status).toBe('DRAFT');
    expect((await noteRow(note.id)).reversalTransactionId).toBeNull();
    expect(await notePostings(note.id)).toEqual([]);
    expect(await ledgerCounts(ID.biz)).toEqual(before);
    expect((await invoiceRow(voidInv)).status).toBe('VOID');
  });

  it('CN-08: apply twice in sequence -> the second is refused; two concurrent applies -> exactly one 201; one posting each note', async () => {
    const seqInv = await seedInvoice('seq', 'SENT');
    const note = await createNote(seqInv, 20);
    expect((await applyNote(note.id)).status).toBe(201);
    expect((await applyNote(note.id)).status).toBe(400);
    expect(await notePostings(note.id)).toHaveLength(1);
    expect(await ledgerOf(seqInv)).toEqual({ receivable: 80, revenue: 80, credited: 20 });

    const raceInv = await seedInvoice('race', 'SENT');
    const raced = await createNote(raceInv, 20);
    const results = await Promise.all([applyNote(raced.id), applyNote(raced.id)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201), JSON.stringify(results.map((r) => r.body))).toHaveLength(1);
    expect(statuses.filter((s) => s !== 201).every((s) => s === 400 || s === 409), JSON.stringify(statuses)).toBe(true);
    expect(await notePostings(raced.id)).toHaveLength(1);
    expect((await invoiceRow(raceInv)).status).toBe('PARTIALLY_CREDITED');
    expect(await ledgerOf(raceInv)).toEqual({ receivable: 80, revenue: 80, credited: 20 });
    await expectBalanced(ID.biz);
  });

  it('CN-09: a draft raised by PATCH past what is left to credit -> apply 400; nothing written', async () => {
    const overInv = await seedInvoice('over', 'SENT');
    const a = await createNote(overInv, 60);
    const b = await createNote(overInv, 40);
    const patched = await api('patch', `/${b.id}`).send({ amount: 50 });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect((await applyNote(a.id)).status).toBe(201);
    const before = await ledgerCounts(ID.biz);

    const res = await applyNote(b.id);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect((await noteRow(b.id)).status).toBe('DRAFT');
    expect(await notePostings(b.id)).toEqual([]);
    expect(await ledgerCounts(ID.biz)).toEqual(before);
    expect((await invoiceRow(overInv)).status).toBe('PARTIALLY_CREDITED');
    expect(await ledgerOf(overInv)).toEqual({ receivable: 40, revenue: 40, credited: 60 });
  });

  it('CN-10 control: a CASH-basis invoice has no recognition to reverse -> 400; nothing written', async () => {
    const cashInv = await seedInvoice('cash', 'SENT', { businessId: ID.bizCash, contactId: ID.contactCash });
    const note = await createNote(cashInv, 10, ID.bizCash);
    const before = await ledgerCounts(ID.bizCash);

    const res = await applyNote(note.id, ID.bizCash);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect((await noteRow(note.id)).status).toBe('DRAFT');
    expect(await ledgerCounts(ID.bizCash)).toEqual(before);
    expect((await invoiceRow(cashInv)).status).toBe('SENT');
  });

  it("CN-11: another tenant's note on this tenant's routes -> 404; untouched", async () => {
    const foreignInv = await seedInvoice('foreign', 'SENT', { businessId: ID.bizF, contactId: ID.contactF });
    const foreignNote = await createNote(foreignInv, 10, ID.bizF, ID.ownerF);

    expect((await applyNote(foreignNote.id)).status).toBe(404);
    expect((await voidNote(foreignNote.id)).status).toBe(404);
    expect((await noteRow(foreignNote.id)).status).toBe('DRAFT');
    expect(await notePostings(foreignNote.id)).toEqual([]);
    expect((await invoiceRow(foreignInv)).status).toBe('SENT');
  });
});

describe('statuses owned by the workflow', () => {
  it('CN-12 RED-BEFORE: credit-note.service.ts writes no Invoice.status (no invoice update, nested invoice write or raw UPDATE invoices)', () => {
    const src = readFileSync(path.resolve(__dirname, '../src/modules/finance/credit-note.service.ts'), 'utf8');
    // RED-BEFORE (V1-42 head): `await tx.invoice.update({ ... status: ... })` in apply (credit-note.service.ts:200).
    expect(src).not.toMatch(/\.invoice\s*\.\s*(update|updateMany|upsert)\s*\(/);
    expect(src).not.toMatch(/\binvoices?\s*:\s*\{\s*(update|updateMany|upsert)\b/);
    expect(src).not.toMatch(/\bupdate\s+"?invoices"?\s+set\b/i);
    expect(src, 'the credited moves go through the workflow').toMatch(/reconcileFromCredits\(/);
  });
});

/**
 * V1-44 review repairs. The packet made apply reach the ledger, which turned
 * five latent gaps into live ones; these pin the repairs inside the write set
 * (credit-note.service.ts, invoice-workflow.service.ts) and keep the halves
 * outside it as it.todo.
 */
describe('V1-44 review: who may apply, the DRAFT-only delete, the void actor, collecting what a credit leaves owing', () => {
  it('CN-13 SEC-V44-1 / SEC-V44-4: apply needs a member with revenue:write; revenue:read, revenue:none, placeholders, no actor and a non-member are refused 403 and nothing is written', async () => {
    const inv = await seedInvoice('authz', 'SENT');
    const note = await createNote(inv, TOTAL);
    const before = await ledgerCounts(ID.biz);

    // RED-BEFORE (packet head): both 201, the invoice FULLY_CREDITED and its receivable written off
    // by members the invoice status door refuses (revenue requires write).
    for (const who of [ID.staff, ID.norev]) {
      const res = await applyNote(note.id, ID.biz, who);
      expect(res.status, `${who}: ${JSON.stringify(res.body)}`).toBe(403);
    }
    // RED-BEFORE: 'system' (the ingestion auto-execute) posted with createdById 'system'.
    for (const userId of ['system', 'user', 'key_ai', undefined, null, ID.ownerF]) {
      await expect(creditNotes.apply(ID.biz, note.id, { userId }), String(userId)).rejects.toMatchObject({ status: 403 });
    }
    await expect(creditNotes.apply(ID.biz, note.id), 'no opts').rejects.toMatchObject({ status: 403 });

    expect((await noteRow(note.id)).status).toBe('DRAFT');
    expect(await notePostings(note.id)).toEqual([]);
    expect(await ledgerCounts(ID.biz)).toEqual(before);
    expect((await invoiceRow(inv)).status).toBe('SENT');
    expect(await ledgerOf(inv)).toEqual({ receivable: TOTAL, revenue: TOTAL, credited: 0 });

    // A member granted revenue:write applies; the posting names that member.
    const res = await applyNote(note.id, ID.biz, ID.writer);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [posting] = await notePostings(note.id);
    expect(posting.createdById).toBe(ID.writer);
    expect((await invoiceRow(inv)).status).toBe('FULLY_CREDITED');
    await expectBalanced(ID.biz);
  });

  it('CN-14 SEC-V44-2: a DELETE that read DRAFT and then waited on an apply holding the note row does not delete the APPLIED note (400); its posting stays and it can still be voided', async () => {
    const inv = await seedInvoice('delrace', 'SENT');
    const note = await createNote(inv, 30);

    /** Backends of this database waiting on a lock in a statement on credit_notes. */
    const lockWaiters = async (): Promise<number> => {
      const rows: Array<{ n: number }> = await db.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND position('credit_notes' in query) > 0`,
      );
      return rows[0]?.n ?? 0;
    };
    const until = async (n: number) => {
      const deadline = Date.now() + 15_000;
      while ((await lockWaiters()) < n) {
        if (Date.now() > deadline) throw new Error(`fewer than ${n} credit_notes lock waiters after 15s`);
        await new Promise((r) => setTimeout(r, 25));
      }
    };

    // Hold the note's row so the interleaving is forced, not timed: apply claims it first
    // (DRAFT -> APPLIED, uncommitted), the DELETE has already read DRAFT and queues behind it.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held!: () => void;
    const heldP = new Promise<void>((r) => (held = r));
    const holder = db.$transaction(
      async (tx: any) => {
        await tx.$queryRawUnsafe(`SELECT id FROM credit_notes WHERE id = $1 FOR UPDATE`, note.id);
        held();
        await gate;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    await heldP;
    const applyP = applyNote(note.id).then((r) => r);
    await until(1);
    const deleteP = api('delete', `/${note.id}`).then((r) => r);
    await until(2);
    release();
    await holder;
    const [applied, deleted] = await Promise.all([applyP, deleteP]);

    expect(applied.status, JSON.stringify(applied.body)).toBe(201);
    // RED-BEFORE (packet head): 200, the APPLIED row deleted under its posting; void then 404.
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(400);
    const row = await noteRow(note.id);
    expect(row?.status).toBe('APPLIED');
    expect(await notePostings(note.id)).toHaveLength(1);
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_CREDITED');

    expect((await voidNote(note.id)).status).toBe(201);
    expect((await invoiceRow(inv)).status).toBe('SENT');
    expect(await ledgerOf(inv)).toEqual({ receivable: TOTAL, revenue: TOTAL, credited: 0 });

    // A DRAFT note is still deleted.
    const draft = await createNote(inv, 10);
    const gone = await api('delete', `/${draft.id}`);
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
    expect(await noteRow(draft.id)).toBeNull();
    await expectBalanced(ID.biz);
  });

  it('CN-15 SEC-V44-5 (service half): a void that names its member records that member on the reversal', async () => {
    const inv = await seedInvoice('voidactor', 'SENT');
    const note = await createNote(inv, 40);
    expect((await applyNote(note.id, ID.biz, ID.writer)).status).toBe(201);
    await creditNotes.void(ID.biz, note.id, { userId: ID.writer });
    const postings = await notePostings(note.id);
    const reversal = postings.find((t: any) => t.reversalOfId !== null);
    expect(reversal?.createdById).toBe(ID.writer);
    expect((await invoiceRow(inv)).status).toBe('SENT');
  });

  /** A SUCCESSFUL payment as CommerceService.recordPayment writes it: row, posting and reconcile in one transaction under the invoice lock. */
  async function pay(invoiceId: string, amount: number, key: string) {
    const id = `${invoiceId}_${key}`;
    return db.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe(`SELECT id FROM invoices WHERE id = $1 FOR NO KEY UPDATE`, invoiceId);
      await tx.payment.create({
        data: { id, amount, currency: 'TTD', status: 'SUCCESSFUL', provider: 'cash', method: 'cash', providerPaymentId: `${P}pp_${key}`, businessId: ID.biz, invoiceId },
      });
      await revenuePosting.onPaymentRecorded(id, { tx, createdById: ID.owner });
      return workflow.reconcileFromPayments(invoiceId, { tx, eventBuffer: [] });
    });
  }

  it('CN-16 CR-V44-1: a PARTIALLY_CREDITED invoice collects what its credits leave owing; beyond it, and on a FULLY_CREDITED invoice, a payment is refused 409 with nothing written', async () => {
    const inv = await seedInvoice('collect', 'SENT');
    const note = await createNote(inv, 40);
    expect((await applyNote(note.id)).status).toBe(201);
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_CREDITED');

    // RED-BEFORE (packet head): 409 "Illegal invoice status transition: PARTIALLY_CREDITED -> PARTIALLY_PAID", rolled back.
    await expect(pay(inv, 60, 'collect_60')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    expect(await db.payment.count({ where: { invoiceId: inv } })).toBe(1);
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_CREDITED');
    expect(await ledgerOf(inv)).toEqual({ receivable: 0, revenue: 60, credited: 40 });
    await expectBalanced(ID.biz);

    // Nothing is left owing: one more cent is refused, and nothing is written.
    const before = await ledgerCounts(ID.biz);
    await expect(pay(inv, 0.01, 'collect_cent')).rejects.toMatchObject({ status: 409 });
    expect(await db.payment.count({ where: { invoiceId: inv } })).toBe(1);
    expect(await ledgerCounts(ID.biz)).toEqual(before);

    // What mark-paid records today (the whole total; it does not net credits) is refused, not over-collected.
    const inv2 = await seedInvoice('collect_markpaid', 'SENT');
    const note2 = await createNote(inv2, 40);
    expect((await applyNote(note2.id)).status).toBe(201);
    const before2 = await ledgerCounts(ID.biz);
    await expect(pay(inv2, TOTAL, 'collect_total')).rejects.toMatchObject({ status: 409 });
    expect(await db.payment.count({ where: { invoiceId: inv2 } })).toBe(0);
    expect(await ledgerCounts(ID.biz)).toEqual(before2);
    expect(await ledgerOf(inv2)).toEqual({ receivable: 60, revenue: 60, credited: 40 });

    // A FULLY_CREDITED invoice owes nothing.
    const inv3 = await seedInvoice('collect_full', 'SENT');
    const note3 = await createNote(inv3, TOTAL);
    expect((await applyNote(note3.id)).status).toBe(201);
    await expect(pay(inv3, 10, 'collect_full')).rejects.toMatchObject({ status: 409 });
    expect(await db.payment.count({ where: { invoiceId: inv3 } })).toBe(0);
    expect((await invoiceRow(inv3)).status).toBe('FULLY_CREDITED');
  });

  // Outside the V1-44 and V1-44b write sets (the route halves moved to CN-17..CN-19 below):
  it.todo(
    'CR-V44-1 (reader half): the share surfaces, the token pay link and mark-paid net the APPLIED credit notes (commerce.service.ts markPaidRemaining / public views / INTENT_PAYABLE_STATUSES, payments.service.ts payLinkInvoice); until then PARTIALLY_CREDITED stays out of SHAREABLE_INVOICE_STATUSES and mark-paid is refused 409 (CN-16) rather than collecting the credited part again',
  );
});

/**
 * V1-44b-CREDIT-NOTE-ROUTES-AND-INTAKE: the V1-44 review halves that lived
 * outside V1-44's write set (finance.controller.ts credit-note routes,
 * drive-intake-orchestrator.service.ts) and the credit-note.service.ts nits
 * still live at this head.
 */
describe('V1-44b: the credit-note routes carry the revenue scope, void names its actor, the Drive-intake credit step cannot apply twice', () => {
  it('CN-17 SEC-V44-1 (route half, D-57, D-46): writes need revenue:write, reads revenue:read; revenue:read, revenue:none and a non-member SUPER_ADMIN are refused 403 and a refused call writes nothing; revenue:write does it all', async () => {
    const inv = await seedInvoice('routes', 'SENT');
    const draft = await createNote(inv, 10);
    const applied = await createNote(inv, 20);
    expect((await applyNote(applied.id)).status).toBe(201);

    const snapshot = async () => ({
      notes: await db.creditNote.findMany({
        where: { businessId: ID.biz },
        orderBy: { id: 'asc' },
        select: { id: true, status: true, amount: true, reason: true, reversalTransactionId: true },
      }),
      ledger: await ledgerCounts(ID.biz),
      invoice: (await invoiceRow(inv)).status,
    });
    const before = await snapshot();
    expect(before.invoice).toBe('PARTIALLY_CREDITED');

    const writesAs = (who: string): Array<[string, () => Promise<any>]> => [
      ['POST credit-notes', () => api('post', '', ID.biz, who).send({ invoiceId: inv, creditNoteNumber: `${P}CN-R-${who.slice(P.length)}`, amount: 5 })],
      ['PATCH /:id', () => api('patch', `/${draft.id}`, ID.biz, who).send({ amount: 7, reason: 'edited' })],
      ['POST /:id/apply', () => api('post', `/${draft.id}/apply`, ID.biz, who).send({})],
      ['POST /:id/void', () => api('post', `/${applied.id}/void`, ID.biz, who).send({})],
      ['DELETE /:id', () => api('delete', `/${draft.id}`, ID.biz, who)],
    ];

    // RED-BEFORE (V1-44 head): the STAFF member (revenue:read) and the revenue:none member got
    // 201 on create, 200 on PATCH, 201 on void and 200 on DELETE (only apply was refused, CN-13).
    for (const who of [ID.staff, ID.norev, ID.admin]) {
      for (const [label, call] of writesAs(who)) {
        const res = await call();
        expect(res.status, `${who} ${label}: ${JSON.stringify(res.body)}`).toBe(403);
      }
    }
    // RED-BEFORE: the revenue:none member read the list and the detail (invoice total, status, contactId).
    for (const who of [ID.norev, ID.admin]) {
      for (const route of ['', `/${draft.id}`]) {
        const res = await api('get', route, ID.biz, who);
        expect(res.status, `${who} GET credit-notes${route}: ${JSON.stringify(res.body)}`).toBe(403);
      }
    }
    expect(await snapshot(), 'a refused call writes nothing').toEqual(before);

    // revenue:read reads.
    const listed = await api('get', '', ID.biz, ID.staff);
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect(listed.body.items.map((n: any) => n.id)).toEqual(expect.arrayContaining([draft.id, applied.id]));
    expect((await api('get', `/${draft.id}`, ID.biz, ID.staff)).status).toBe(200);

    // revenue:write does every write.
    const created = await api('post', '', ID.biz, ID.writer).send({ invoiceId: inv, creditNoteNumber: `${P}CN-R-writer`, amount: 5 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const patched = await api('patch', `/${draft.id}`, ID.biz, ID.writer).send({ amount: 7 });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(Number((await noteRow(draft.id)).amount)).toBe(7);
    expect((await api('get', `/${draft.id}`, ID.biz, ID.writer)).status).toBe(200);
    expect((await api('post', `/${applied.id}/void`, ID.biz, ID.writer).send({})).status).toBe(201);
    expect((await api('delete', `/${draft.id}`, ID.biz, ID.writer)).status).toBe(200);
    expect(await noteRow(draft.id)).toBeNull();
    expect((await api('post', `/${created.body.id}/apply`, ID.biz, ID.writer).send({})).status).toBe(201);
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_CREDITED');
    const ledger = await ledgerOf(inv);
    expect(ledger).toEqual({ receivable: 95, revenue: 95, credited: 5 });
    expect(money(ledger.credited + ledger.receivable), 'credited + remaining = invoice total').toBe(TOTAL);
    await expectBalanced(ID.biz);
  });

  it('CN-18 SEC-V44-5 (route half): POST /:id/void names the member on the reversal', async () => {
    const inv = await seedInvoice('voidroute', 'SENT');
    const note = await createNote(inv, 40, ID.biz, ID.writer);
    expect((await applyNote(note.id, ID.biz, ID.writer)).status).toBe(201);
    const res = await voidNote(note.id, ID.biz, ID.writer);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const postings = await notePostings(note.id);
    const original = postings.find((t: any) => t.reversalOfId === null);
    const reversal = postings.find((t: any) => t.reversalOfId !== null);
    expect(original?.createdById).toBe(ID.writer);
    // RED-BEFORE (V1-44 head): null: the route called creditNotes.void(businessId, id) with no actor.
    expect(reversal?.createdById).toBe(ID.writer);
    expect((await invoiceRow(inv)).status).toBe('SENT');
    expect(await ledgerOf(inv)).toEqual({ receivable: TOTAL, revenue: TOTAL, credited: 0 });
    await expectBalanced(ID.biz);
  });

  /** The Drive-intake orchestrator with the REAL CreditNoteService and InvoiceWorkflowService; its other collaborators are stubs off the credit path. */
  function orchestrator() {
    return new DriveIntakeOrchestratorClass(
      prismaService,
      {} as any, // CrmService: these plans carry no contact (no follow-up task)
      {} as any, // CrmCommunicationService: no send_notification step
      {} as any, // TransactionalEmailService
      { resolveApproval: async () => null } as any, // AiOversightService: no approval item is seeded
      {} as any, // CommerceService: no create_invoice step
      workflow,
      creditNotes,
      {} as any, // TaskAssignmentService
      {} as any, // PaymentEvidenceService: no record_payment step
    );
  }

  /** A Drive intake file in 'reviewing' whose plan is one apply_credit_note step against `invoiceId`. */
  async function seedIntake(key: string, invoiceId: string, amount: number): Promise<string> {
    const id = `${P}intake_${key}`;
    await db.driveIntakeFile.create({
      data: {
        id,
        businessId: ID.biz,
        driveFileId: `${P}drive_${key}`,
        name: `v44a ${key}.pdf`,
        mimeType: 'application/pdf',
        modifiedTime: new Date(),
        status: 'reviewing',
        documentType: 'credit_note',
        proposedActions: {
          intakeFileId: id,
          documentType: 'credit_note',
          originalInvoiceId: invoiceId,
          summary: `v44a ${key}`,
          actions: [{ type: 'apply_credit_note', payload: { invoiceId, amount, reason: `v44a ${key}` } }],
        },
      },
    });
    return id;
  }

  it("CN-19 SEC-V44-3: two concurrent approvals of one Drive-intake plan credit the invoice once; a re-run answers the step's own note (one note, one apply, one REVERSAL)", async () => {
    const inv = await seedInvoice('intake', 'SENT');
    const intake = await seedIntake('race', inv, 50);
    const orch = orchestrator();

    const first = orch.executePlan(ID.biz, intake, ID.writer);
    await new Promise((r) => setTimeout(r, 5));
    const second = orch.executePlan(ID.biz, intake, ID.writer);
    const settled = await Promise.allSettled([first, second]);
    const ok = (s: PromiseSettledResult<any>) => s.status === 'fulfilled' && s.value?.success === true;
    // RED-BEFORE (V1-44 head): both runs read 'reviewing', each created CN-<Date.now()> of 50 and
    // applied it: two APPLIED notes, FULLY_CREDITED, the receivable written off.
    expect(settled.filter(ok), JSON.stringify(settled)).toHaveLength(1);
    const refused = settled.find((s) => !ok(s));
    expect(refused?.status, JSON.stringify(refused)).toBe('rejected');
    expect((refused as PromiseRejectedResult).reason).toMatchObject({ status: 400 });

    const notes = await db.creditNote.findMany({ where: { invoiceId: inv } });
    expect(notes, 'one note for the one plan step').toHaveLength(1);
    expect(notes[0].status).toBe('APPLIED');
    const postings = await notePostings(notes[0].id);
    expect(postings, 'one REVERSAL').toHaveLength(1);
    expect(postings[0].type).toBe('REVERSAL');
    expect(postings[0].createdById, 'the approving member').toBe(ID.writer);
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_CREDITED');
    const ledger = await ledgerOf(inv);
    expect(ledger).toEqual({ receivable: 50, revenue: 50, credited: 50 });
    expect(money(ledger.credited + ledger.receivable), 'credited + remaining = invoice total').toBe(TOTAL);
    expect((await db.driveIntakeFile.findUnique({ where: { id: intake } })).status).toBe('approved');

    // The same plan run again (the intake put back to reviewing, as a crash before the flip left
    // it at the base): the step answers its own note, applies nothing, posts nothing.
    await db.driveIntakeFile.update({ where: { id: intake }, data: { status: 'reviewing' } });
    const before = await ledgerCounts(ID.biz);
    const rerun = await orch.executePlan(ID.biz, intake, ID.writer);
    expect(rerun.success, JSON.stringify(rerun)).toBe(true);
    expect(rerun.results).toEqual([{ action: 'apply_credit_note', success: true, entityId: notes[0].id }]);
    // RED-BEFORE: a second CN-<Date.now()> of 50 created and applied.
    expect(await db.creditNote.count({ where: { invoiceId: inv } })).toBe(1);
    expect(await notePostings(notes[0].id)).toHaveLength(1);
    expect(await ledgerCounts(ID.biz)).toEqual(before);
    expect(await ledgerOf(inv)).toEqual({ receivable: 50, revenue: 50, credited: 50 });
    await expectBalanced(ID.biz);
  });

  it("CN-20 SEC-V44-4: the intake applies as the approving member: the ingestion auto-execute ('system') and the data-inbox fallback ('user') post nothing and name no placeholder", async () => {
    const orch = orchestrator();
    for (const placeholder of ['system', 'user']) {
      const inv = await seedInvoice(`intake_${placeholder}`, 'SENT');
      const intake = await seedIntake(placeholder, inv, 30);
      const before = await ledgerCounts(ID.biz);
      // V1-44b review (SEC-V44b-R2): refused before the claim (V1-44b head: success:false after
      // the claim, a DRAFT step note left behind and the intake 'error', approvable by no one).
      await expect(orch.executePlan(ID.biz, intake, placeholder)).rejects.toMatchObject({ status: 403 });
      expect(await db.creditNote.findMany({ where: { invoiceId: inv } }), 'no note created').toEqual([]);
      expect(await ledgerCounts(ID.biz)).toEqual(before);
      expect(await db.financialTransaction.count({ where: { createdById: placeholder } })).toBe(0);
      expect((await invoiceRow(inv)).status).toBe('SENT');
      expect((await db.driveIntakeFile.findUnique({ where: { id: intake } })).status, 'the claim is not used up').toBe('reviewing');
      // A member with revenue:write then approves the same plan.
      const res = await orch.executePlan(ID.biz, intake, ID.writer);
      expect(res.success, JSON.stringify(res)).toBe(true);
      const [note] = await db.creditNote.findMany({ where: { invoiceId: inv } });
      expect(note.status).toBe('APPLIED');
      expect((await notePostings(note.id)).map((t: any) => t.createdById)).toEqual([ID.writer]);
    }
  });

  it('CN-21 SEC-V44-6: a note whose invoice belongs to another business cannot move it: void refused 400, nothing written in either tenant', async () => {
    const foreignInv = await seedInvoice('xtenant', 'SENT', { businessId: ID.bizF, contactId: ID.contactF });
    await db.invoice.update({ where: { id: foreignInv }, data: { status: 'FULLY_CREDITED' } });
    // An inconsistent row (legacy or seeded data; create() cannot make one): A's note, B's invoice.
    const noteId = `${P}cn_xtenant`;
    await db.creditNote.create({
      data: { id: noteId, businessId: ID.biz, invoiceId: foreignInv, creditNoteNumber: `${P}CN-XTENANT`, status: 'APPLIED', amount: TOTAL, appliedAt: new Date() },
    });
    const before = { a: await ledgerCounts(ID.biz), b: await ledgerCounts(ID.bizF) };

    const res = await voidNote(noteId);
    // RED-BEFORE (V1-44 head): 201 and B's invoice moved FULLY_CREDITED -> SENT by A's route.
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect((await invoiceRow(foreignInv)).status).toBe('FULLY_CREDITED');
    expect((await noteRow(noteId)).status).toBe('APPLIED');
    expect({ a: await ledgerCounts(ID.biz), b: await ledgerCounts(ID.bizF) }).toEqual(before);
  });

  it('CN-22 CR-V44-3: a credit too small to reach every revenue split posts no zero or negative leg: 0.01 on a 50/50 SERVICE/PRODUCT invoice applies, balanced', async () => {
    const id = `${P}inv_split`;
    for (const [key, category] of [['svc', 'SERVICE'], ['prd', 'PRODUCT']] as const) {
      await db.product.create({ data: { id: `${P}prod_${key}`, businessId: ID.biz, name: `v44a ${category}`, price: 50, category } });
    }
    invoiceSeq += 1;
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `${P}INV-${String(invoiceSeq).padStart(3, '0')}`,
        businessId: ID.biz,
        contactId: ID.contact,
        status: 'DRAFT',
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        items: {
          create: [
            { description: 'v44a service', quantity: 1, unitPrice: 50, total: 50, productId: `${P}prod_svc` },
            { description: 'v44a product', quantity: 1, unitPrice: 50, total: 50, productId: `${P}prod_prd` },
          ],
        },
      },
    });
    await workflow.transition(id, 'SENT', { sentAt: new Date() });
    const recognition = await db.financialTransaction.findMany({
      where: { sourceType: 'Invoice', sourceId: id },
      include: { entries: { include: { account: { select: { systemKey: true } } } } },
    });
    expect(netBySystemKey(recognition), 'two revenue splits of 50').toEqual({ ACCOUNTS_RECEIVABLE: 100, REVENUE_SERVICE: -50, REVENUE_PRODUCT: -50 });

    const note = await createNote(id, 0.01);
    const res = await applyNote(note.id);
    // RED-BEFORE (V1-44 head): 400 'Entry 1: must have a non-zero debit or credit' (the first share
    // rounded up to 0.01 left the last one 0).
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const postings = await notePostings(note.id);
    expect(postings).toHaveLength(1);
    for (const e of postings[0].entries) {
      expect(Number(e.debit) >= 0 && Number(e.credit) >= 0, 'no negative leg').toBe(true);
      expect(Number(e.debit) + Number(e.credit), 'no zero leg').toBeGreaterThan(0);
    }
    const net = netBySystemKey(postings);
    expect(net.ACCOUNTS_RECEIVABLE).toBe(-0.01);
    expect(money((net.REVENUE_SERVICE ?? 0) + (net.REVENUE_PRODUCT ?? 0))).toBe(0.01);
    expect((await invoiceRow(id)).status).toBe('PARTIALLY_CREDITED');
    await expectBalanced(ID.biz);
  });

  it('CN-23 CR-V44-4: an invoice the AI undo returned to DRAFT with two notes applied: each note voids (201), its posting reversed, the invoice left DRAFT', async () => {
    const inv = await seedInvoice('undo', 'SENT');
    const a = await createNote(inv, 20);
    const b = await createNote(inv, 30);
    expect((await applyNote(a.id)).status).toBe(201);
    expect((await applyNote(b.id)).status).toBe(201);
    await workflow.returnToDraftOnUndo(inv);
    expect((await invoiceRow(inv)).status).toBe('DRAFT');

    for (const note of [a, b]) {
      const res = await voidNote(note.id);
      // RED-BEFORE (V1-44 head): 409 'Illegal invoice status transition for a credit note: DRAFT -> PARTIALLY_CREDITED'.
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect((await noteRow(note.id)).status).toBe('VOID');
      const postings = await notePostings(note.id);
      expect(postings).toHaveLength(2);
      expect(netBySystemKey(postings), 'the note nets to nothing').toEqual({ REVENUE: 0, ACCOUNTS_RECEIVABLE: 0 });
      expect((await invoiceRow(inv)).status, 'a credit note never moves a DRAFT invoice').toBe('DRAFT');
    }
    expect(await ledgerOf(inv)).toEqual({ receivable: TOTAL, revenue: TOTAL, credited: 0 });
    await expectBalanced(ID.biz);
  });

  /** What a Drive re-sync does to the SAME DriveIntakeFile row: back to 'reviewing' with a new plan (connector-intelligence upsert, then buildPlan). */
  async function replan(intake: string, invoiceId: string, amount: number) {
    await db.driveIntakeFile.update({
      where: { id: intake },
      data: {
        status: 'reviewing',
        errorMessage: null,
        processedAt: null,
        proposedActions: {
          intakeFileId: intake,
          documentType: 'credit_note',
          originalInvoiceId: invoiceId,
          summary: 'v44a re-synced',
          actions: [{ type: 'apply_credit_note', payload: { invoiceId, amount, reason: 'v44a re-synced' } }],
        },
      },
    });
  }

  it("CN-24 SEC-V44b-R1 / CRR-V44b-1 (route half): no member mints a plan step's number; the owner's approval credits exactly the plan's amount", async () => {
    const inv = await seedInvoice('squat', 'SENT');
    const intake = await seedIntake('squat', inv, 30);
    const step = `CN-DRIVE-${intake}-0`;
    const before = { notes: await db.creditNote.count({ where: { businessId: ID.biz } }), ledger: await ledgerCounts(ID.biz) };
    for (const creditNoteNumber of [step, step.toLowerCase(), `  ${step}`, 'CN-DRIVE-anything']) {
      const res = await api('post', '', ID.biz, ID.writer).send({ invoiceId: inv, creditNoteNumber, amount: 100, reason: 'squat' });
      // RED-BEFORE (V1-44b head): 201; the owner's approval of 30 then applied this 100 in the owner's name.
      expect(res.status, `${JSON.stringify(creditNoteNumber)}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    expect({ notes: await db.creditNote.count({ where: { businessId: ID.biz } }), ledger: await ledgerCounts(ID.biz) }).toEqual(before);

    const res = await orchestrator().executePlan(ID.biz, intake, ID.owner);
    expect(res.success, JSON.stringify(res)).toBe(true);
    const notes = await db.creditNote.findMany({ where: { invoiceId: inv } });
    expect(notes.map((n: any) => [n.creditNoteNumber, n.status, Number(n.amount)])).toEqual([[step, 'APPLIED', 30]]);
    const postings = await notePostings(notes[0].id);
    expect(postings.map((t: any) => [Number(t.amount), t.createdById])).toEqual([[30, ID.owner]]);
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_CREDITED');
    expect(await ledgerOf(inv)).toEqual({ receivable: 70, revenue: 70, credited: 30 });
    await expectBalanced(ID.biz);
  });

  it('CN-25 SEC-V44b-R1 / CRR-V44b-1: a step note of another amount (a stale DRAFT, or the APPLIED note of the plan before a re-sync) is refused 409: nothing applied, posted or reported credited', async () => {
    const orch = orchestrator();

    // (a) A DRAFT of 80 a failed run left under the step's number; the re-synced plan credits 30.
    const invA = await seedInvoice('stale', 'SENT');
    const intakeA = await seedIntake('stale', invA, 80);
    const stale = await creditNotes.create(ID.biz, { invoiceId: invA, creditNoteNumber: `CN-DRIVE-${intakeA}-0`, amount: 80, reason: 'v44a stale' });
    await replan(intakeA, invA, 30);
    const beforeA = await ledgerCounts(ID.biz);
    const resA = await orch.executePlan(ID.biz, intakeA, ID.writer);
    // RED-BEFORE (V1-44b head): success:true with the stale note's id; one posting of 80 named v44a_writer.
    expect(resA.success, JSON.stringify(resA)).toBe(false);
    expect(resA.results).toEqual([]);
    const rowA = await db.driveIntakeFile.findUnique({ where: { id: intakeA } });
    expect(rowA.status).toBe('error');
    expect(rowA.errorMessage).toMatch(/credits 80, not the 30/);
    expect((await noteRow(stale.id)).status).toBe('DRAFT');
    expect(await notePostings(stale.id)).toEqual([]);
    expect(await ledgerCounts(ID.biz)).toEqual(beforeA);
    expect((await invoiceRow(invA)).status).toBe('SENT');

    // (b) The plan of 80 ran (APPLIED); the file is re-synced with a corrected 30.
    const invB = await seedInvoice('resync', 'SENT');
    const intakeB = await seedIntake('resync', invB, 80);
    expect((await orch.executePlan(ID.biz, intakeB, ID.writer)).success).toBe(true);
    await replan(intakeB, invB, 30);
    const beforeB = await ledgerCounts(ID.biz);
    const resB = await orch.executePlan(ID.biz, intakeB, ID.owner);
    // RED-BEFORE (V1-44b head): success:true with the old note's id; the 30 credit reported done, nothing credited.
    expect(resB.success, JSON.stringify(resB)).toBe(false);
    expect(resB.results).toEqual([]);
    expect((await db.driveIntakeFile.findUnique({ where: { id: intakeB } })).errorMessage).toMatch(/credits 80, not the 30/);
    expect(await ledgerCounts(ID.biz)).toEqual(beforeB);
    expect(await ledgerOf(invB)).toEqual({ receivable: 20, revenue: 20, credited: 80 });

    // Control: a re-sync that keeps the amount is the same step: answered, nothing posted again.
    await replan(intakeB, invB, 80);
    const again = await orch.executePlan(ID.biz, intakeB, ID.owner);
    expect(again.success, JSON.stringify(again)).toBe(true);
    expect(await ledgerCounts(ID.biz)).toEqual(beforeB);
    await expectBalanced(ID.biz);
  });

  it('CN-26 SEC-V44b-R2: a member who may not apply a credit note (revenue:read, revenue:none) approving a credit plan is refused 403 before the claim; the owner then runs it', async () => {
    const inv = await seedInvoice('staffplan', 'SENT');
    const intake = await seedIntake('staffplan', inv, 30);
    const orch = orchestrator();
    const before = await ledgerCounts(ID.biz);
    for (const who of [ID.staff, ID.norev]) {
      // RED-BEFORE (V1-44b head): success:false after the claim, the DRAFT note CN-DRIVE-<intake>-0
      // created and the intake 'error': the owner's approval was then refused 400.
      await expect(orch.executePlan(ID.biz, intake, who)).rejects.toMatchObject({ status: 403 });
      expect(await db.creditNote.findMany({ where: { invoiceId: inv } })).toEqual([]);
      expect((await db.driveIntakeFile.findUnique({ where: { id: intake } })).status).toBe('reviewing');
    }
    expect(await ledgerCounts(ID.biz)).toEqual(before);

    const res = await orch.executePlan(ID.biz, intake, ID.owner);
    expect(res.success, JSON.stringify(res)).toBe(true);
    const [note] = await db.creditNote.findMany({ where: { invoiceId: inv } });
    expect([note.status, Number(note.amount)]).toEqual(['APPLIED', 30]);
    expect((await notePostings(note.id)).map((t: any) => t.createdById)).toEqual([ID.owner]);
    expect((await db.driveIntakeFile.findUnique({ where: { id: intake } })).status).toBe('approved');
    await expectBalanced(ID.biz);
  });

  it('CN-27 SEC-V44b-R1 (apply half): apply with the approved amount refuses 409 a note PATCHed since it was read; nothing written. At the note amount it applies', async () => {
    const inv = await seedInvoice('expected', 'SENT');
    const note = await createNote(inv, 40, ID.biz, ID.writer);
    expect((await api('patch', `/${note.id}`, ID.biz, ID.writer).send({ amount: 45 })).status).toBe(200);
    const before = await ledgerCounts(ID.biz);
    await expect(creditNotes.apply(ID.biz, note.id, { userId: ID.writer, expectedAmount: 40 })).rejects.toMatchObject({ status: 409 });
    expect((await noteRow(note.id)).status, 'the claim rolled back').toBe('DRAFT');
    expect(await ledgerCounts(ID.biz)).toEqual(before);
    expect((await invoiceRow(inv)).status).toBe('SENT');

    const applied = await creditNotes.apply(ID.biz, note.id, { userId: ID.writer, expectedAmount: 45 });
    expect(applied.creditNote.status).toBe('APPLIED');
    expect(await ledgerOf(inv)).toEqual({ receivable: 55, revenue: 55, credited: 45 });
    await expectBalanced(ID.biz);
  });

  it("CN-28 SEC-V44b-R3: a note whose invoiceId names another tenant's invoice discloses nothing of it on the reads (list, detail) or the PATCH and DELETE answers", async () => {
    const foreignInv = await seedInvoice('xread', 'SENT', { businessId: ID.bizF, contactId: ID.contactF });
    const foreign = await invoiceRow(foreignInv);
    const own = await createNote(await seedInvoice('ownread', 'SENT'), 10);
    const noteId = `${P}cn_xread`;
    await db.creditNote.create({ data: { id: noteId, businessId: ID.biz, invoiceId: foreignInv, creditNoteNumber: `${P}CN-XREAD`, status: 'DRAFT', amount: 1 } });
    const leaks = (body: unknown) => {
      const text = JSON.stringify(body);
      return [foreign.invoiceNumber, ID.contactF].filter((needle) => text.includes(needle));
    };

    const list = await api('get', '', ID.biz, ID.staff);
    expect(list.status).toBe(200);
    // RED-BEFORE (V1-44b head): invoice {invoiceNumber: B's, contactId: v44a_contactF, total: 100, status: 'SENT'}.
    expect(list.body.items.find((n: any) => n.id === noteId)?.invoice).toBeNull();
    expect(leaks(list.body)).toEqual([]);
    expect(list.body.items.find((n: any) => n.id === own.id)?.invoice, "the business's own invoice still reads").toMatchObject({ status: 'SENT', contactId: ID.contact });

    const one = await api('get', `/${noteId}`, ID.biz, ID.staff);
    expect(one.status).toBe(200);
    expect(one.body.invoice).toBeNull();
    expect(leaks(one.body)).toEqual([]);
    expect((await api('get', `/${own.id}`, ID.biz, ID.staff)).body.invoice).toMatchObject({ status: 'SENT' });

    const patched = await api('patch', `/${noteId}`, ID.biz, ID.writer).send({ reason: 'v44a xread' });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.invoice).toBeNull();
    expect(leaks(patched.body)).toEqual([]);
    const ownPatched = await api('patch', `/${own.id}`, ID.biz, ID.writer).send({ reason: 'v44a own' });
    expect(ownPatched.body.invoice).toEqual({ invoiceNumber: (await invoiceRow(own.invoiceId)).invoiceNumber });

    const deleted = await api('delete', `/${noteId}`, ID.biz, ID.writer);
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect(leaks(deleted.body)).toEqual([]);
    expect((await invoiceRow(foreignInv)).status, "B's invoice untouched").toBe('SENT');
  });

  // W3-CREDIT-RECONCILE-BIND: the two V1-44b todos (invoice-workflow.service.ts, outside the V1-44b write set).

  /**
   * A refund as the refund doors write it (D-14): a negative REFUNDED row
   * linked to the invoice's seeded payment, its posting, and the reconcile
   * under 'keep', in one transaction under the invoice lock.
   */
  async function refundPayment(invoiceId: string, amount: number, key: string) {
    const paymentId = `${invoiceId}_pay`;
    const id = `${invoiceId}_${key}`;
    return db.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe(`SELECT id FROM invoices WHERE id = $1 FOR NO KEY UPDATE`, invoiceId);
      const original = await tx.payment.findUnique({ where: { id: paymentId } });
      await tx.payment.create({
        data: {
          id,
          amount: -amount,
          currency: 'TTD',
          status: 'REFUNDED',
          provider: 'cash',
          method: 'cash',
          providerPaymentId: `${id}_pp`,
          reference: original.providerPaymentId,
          businessId: ID.biz,
          invoiceId,
        },
      });
      await revenuePosting.onPaymentRefunded(paymentId, { tx, createdById: ID.owner, refund: { paymentId: id, amount } });
      return workflow.reconcileFromPayments(invoiceId, { tx, eventBuffer: [], onIllegalTransition: 'keep' });
    });
  }

  it('CN-29 CR-V44-2 (D-14, D-78): reconcileFromCredits clears paidAt once the status it writes is not PAID and the payment rows no longer settle the invoice; a PAID invoice part-credited with its payment in place keeps it, and a return to PAID keeps or stamps it', async () => {
    // (a) Paid, part-credited, refunded in full, the note voided: SENT, owed afresh, no paidAt.
    const a = await seedInvoice('rc_sent', 'PAID');
    const paidAtA = (await invoiceRow(a)).paidAt;
    expect(paidAtA).not.toBeNull();
    const noteA = await createNote(a, 30);
    expect((await applyNote(noteA.id)).status).toBe(201);
    expect(await invoiceRow(a), 'part-credited with its payment in place: paidAt kept (CN-06)').toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: paidAtA });
    await expect(refundPayment(a, TOTAL, 'rf_all')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    expect((await voidNote(noteA.id)).status).toBe(201);
    // RED-BEFORE (W3 base ca12b6f5): SENT, still carrying the paidAt of the payment that went back.
    expect(await invoiceRow(a), 'reopened to SENT: no paidAt (D-14)').toMatchObject({ status: 'SENT', paidAt: null });

    // (b) Paid, part-credited, half refunded, the note voided: PARTIALLY_PAID, no paidAt.
    const b = await seedInvoice('rc_part', 'PAID');
    const noteB = await createNote(b, 30);
    expect((await applyNote(noteB.id)).status).toBe(201);
    await expect(refundPayment(b, 50, 'rf_half')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    expect((await voidNote(noteB.id)).status).toBe(201);
    // RED-BEFORE (W3 base ca12b6f5): PARTIALLY_PAID with the stale paidAt.
    expect(await invoiceRow(b), 'reopened to PARTIALLY_PAID: no paidAt (D-14)').toMatchObject({ status: 'PARTIALLY_PAID', paidAt: null });

    // (c) D-78: a credited status is not PAID. Once the money went back, crediting the rest leaves no paidAt either.
    const c = await seedInvoice('rc_full', 'PAID');
    const noteC30 = await createNote(c, 30);
    expect((await applyNote(noteC30.id)).status).toBe(201);
    await expect(refundPayment(c, TOTAL, 'rf_all')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    const noteC70 = await createNote(c, 70);
    expect((await applyNote(noteC70.id)).status).toBe(201);
    // RED-BEFORE (W3 base ca12b6f5): FULLY_CREDITED with the paidAt of the refunded payment.
    expect(await invoiceRow(c), 'FULLY_CREDITED, nothing received net: no paidAt').toMatchObject({ status: 'FULLY_CREDITED', paidAt: null });
    expect((await voidNote(noteC70.id)).status).toBe(201);
    expect(await invoiceRow(c)).toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });
    expect((await voidNote(noteC30.id)).status).toBe(201);
    expect(await invoiceRow(c)).toMatchObject({ status: 'SENT', paidAt: null });

    // (d) Control: a return to PAID stamps a paidAt the row lacks (a legacy FULLY_CREDITED row, as CN-04b seeds).
    const d = await seedInvoice('rc_legacy', 'PAID');
    const legacyNote = `${P}cn_rc_legacy`;
    await db.creditNote.create({
      data: { id: legacyNote, businessId: ID.biz, invoiceId: d, creditNoteNumber: `${P}CN-RC-LEGACY`, status: 'APPLIED', amount: TOTAL, appliedAt: new Date() },
    });
    await db.invoice.update({ where: { id: d }, data: { status: 'FULLY_CREDITED', paidAt: null } });
    expect((await voidNote(legacyNote)).status).toBe(201);
    const back = await invoiceRow(d);
    expect(back.status).toBe('PAID');
    expect(back.paidAt, 'a return to PAID with none stamps it').not.toBeNull();
    expect(emitted.filter((e) => e.name.startsWith('invoice.')), 'a credit move emits no invoice event').toEqual([]);
    await expectBalanced(ID.biz);
  });

  it("CN-30 SEC-V44-6 (function half): reconcileFromCredits takes the businessId and reads and locks the invoice by { id, businessId }: another business's invoice is refused 404 and left as it is; the call holds the row lock itself", async () => {
    const foreignInv = await seedInvoice('rc_xtenant', 'SENT', { businessId: ID.bizF, contactId: ID.contactF });
    // B's invoice in a credited state with no APPLIED note of its own: any reconcile would move it to SENT.
    await db.invoice.update({ where: { id: foreignInv }, data: { status: 'FULLY_CREDITED' } });
    const reconcileAs = (businessId: string, invoiceId: string) =>
      db.$transaction((tx: any) => workflow.reconcileFromCredits(invoiceId, { tx, businessId }));

    // RED-BEFORE (W3 base ca12b6f5): resolved { status: 'SENT', changed: true }, B's invoice moved for A.
    await expect(reconcileAs(ID.biz, foreignInv)).rejects.toMatchObject({ status: 404 });
    expect((await invoiceRow(foreignInv)).status, "B's invoice untouched").toBe('FULLY_CREDITED');
    // Its own business reconciles it (no APPLIED note, nothing paid: SENT).
    await expect(reconcileAs(ID.bizF, foreignInv)).resolves.toEqual({ status: 'SENT', changed: true });
    expect((await invoiceRow(foreignInv)).status).toBe('SENT');

    // The lock is its own: a reconcile that moves nothing still holds the row until its transaction ends.
    const own = await seedInvoice('rc_lock', 'SENT');
    const note = await createNote(own, 40);
    expect((await applyNote(note.id)).status).toBe(201);
    await db.$transaction(async (tx: any) => {
      await expect(workflow.reconcileFromCredits(own, { tx, businessId: ID.biz })).resolves.toEqual({ status: 'PARTIALLY_CREDITED', changed: false });
      await expect(
        db.$queryRawUnsafe(`SELECT id FROM invoices WHERE id = $1 FOR NO KEY UPDATE NOWAIT`, own),
        'the row is locked by the reconcile',
      ).rejects.toThrow(/55P03|could not obtain lock/);
    });
  });

  it('CN-31 W3CRB-ST-1 CR-V44-2 (D-14, D-78): a credit move that leaves a credited invoice in its credited status still clears a paidAt nothing settles, so one money position ends with one paidAt whatever the path; with its payment in place the paidAt is kept', async () => {
    // Path A: paid, part-credited 30, refunded in full, then credited 20 more: PARTIALLY_CREDITED -> PARTIALLY_CREDITED.
    const a = await seedInvoice('rc_same_a', 'PAID');
    const noteA30 = await createNote(a, 30);
    expect((await applyNote(noteA30.id)).status).toBe(201);
    await expect(refundPayment(a, TOTAL, 'rf_all')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    const noteA20 = await createNote(a, 20);
    expect((await applyNote(noteA20.id)).status).toBe(201);
    // RED-BEFORE (pkt/W3-CREDIT-RECONCILE-BIND f38160e9): the status did not move, so the early return kept the refunded payment's paidAt.
    expect(await invoiceRow(a), 'apply, status unchanged, nothing settles: no paidAt').toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });

    // Path B: the same money position (credited 50 of 100, the 100 refunded) reached through FULLY_CREDITED.
    const b = await seedInvoice('rc_same_b', 'PAID');
    const noteB30 = await createNote(b, 30);
    expect((await applyNote(noteB30.id)).status).toBe(201);
    await expect(refundPayment(b, TOTAL, 'rf_all')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    const noteB70 = await createNote(b, 70);
    expect((await applyNote(noteB70.id)).status).toBe(201);
    expect((await voidNote(noteB70.id)).status).toBe(201);
    const noteB20 = await createNote(b, 20);
    expect((await applyNote(noteB20.id)).status).toBe(201);
    const rowA = await invoiceRow(a);
    const rowB = await invoiceRow(b);
    expect(rowB, 'path B').toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });
    expect({ status: rowA.status, paidAt: rowA.paidAt }, 'one money position, one paidAt').toEqual({ status: rowB.status, paidAt: rowB.paidAt });

    // A void that leaves the invoice PARTIALLY_CREDITED clears it the same way.
    const c = await seedInvoice('rc_same_c', 'PAID');
    const noteC30 = await createNote(c, 30);
    expect((await applyNote(noteC30.id)).status).toBe(201);
    const noteC20 = await createNote(c, 20);
    expect((await applyNote(noteC20.id)).status).toBe(201);
    await expect(refundPayment(c, TOTAL, 'rf_all')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    expect((await voidNote(noteC20.id)).status).toBe(201);
    // RED-BEFORE (pkt/W3-CREDIT-RECONCILE-BIND f38160e9): PARTIALLY_CREDITED with the refunded payment's paidAt.
    expect(await invoiceRow(c), 'void, status unchanged, nothing settles: no paidAt').toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });

    // Control (CN-06): the payment still settles the total, so a second partial note keeps the paidAt.
    const d = await seedInvoice('rc_same_kept', 'PAID');
    const paidAtD = (await invoiceRow(d)).paidAt;
    const noteD30 = await createNote(d, 30);
    expect((await applyNote(noteD30.id)).status).toBe(201);
    const noteD20 = await createNote(d, 20);
    expect((await applyNote(noteD20.id)).status).toBe(201);
    expect(await invoiceRow(d), 'settled by its payment: paidAt kept').toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: paidAtD });
    expect(emitted.filter((e) => e.name.startsWith('invoice.')), 'a credit move emits no invoice event').toEqual([]);
    await expectBalanced(ID.biz);
  });

  // CRB-CR-1: the refund door's half of CR-V44-2, outside this write set (invoice-workflow.service.ts, reconcileFromCredits only).
  it.todo(
    'CRB-CR-1 CR-V44-2 (D-14, D-78), refund half: a refund that unsettles a credited invoice clears its paidAt (a PAID invoice part-credited 30, then refunded in full, stays PARTIALLY_CREDITED and keeps the refunded payment\'s paidAt until a later apply or void, CN-31). reconcileCreditedFromPayments (invoice-workflow.service.ts) writes nothing; outside the W3-CREDIT-RECONCILE-BIND write set (reconcileFromCredits only)',
  );
});
