/**
 * V1-42-DM-LIFECYCLE-OWNER-CAS — one invoice lifecycle owner (REAL database,
 * REAL routes behind the real AuthGuard / BusinessGuard / ModuleScopeGuard /
 * FeatureFlagGuard, REAL workflow, REAL ledger door).
 *
 * CF-39 (docs/reconstruction/BUILD-MAP-001.md): the invoice lifecycle had
 * several writers outside InvoiceWorkflowService and no compare-and-set on the
 * one inside it, so two writers could both "win" a move and each emit its
 * event and posting. Line numbers below are the V1-37 head (92e17eea).
 *
 *   LC-01 RED-BEFORE two concurrent transition(id, 'OVERDUE') calls that both read SENT: one succeeds,
 *         the other is refused 409; invoice.overdue is emitted once (base: both succeed, two events)
 *   LC-02 RED-BEFORE a repeated transition to the status the invoice already has is a 409 with no event
 *         (the loser of a race that read after the winner committed; base: success and a second event)
 *   LC-02b RED-BEFORE the operator status route answers a request for the status the invoice already
 *         holds idempotently: 200, no write, no second event (the send-email of a DRAFT another send
 *         issued meanwhile relies on it: optional-services-fail-visibly SEC-CMF4-3)
 *   LC-03 RED-BEFORE a writer that moved the invoice while a transition was in flight wins: the
 *         transition that read SENT is refused 409 and does not overwrite PAID with OVERDUE (base: it did)
 *   DL-01 RED-BEFORE DelegationLoop payment recovery moves SENT -> OVERDUE through the workflow and the
 *         event is the nested InvoiceStatusPayload { invoice, businessId, status } every invoice.overdue
 *         listener reads (base: raw update, flat { invoiceId, invoiceNumber, daysPastDue, source }
 *         payload, delegation-loop.service.ts:582-594; the packet cited :555 of an older head)
 *   DL-02 RED-BEFORE the loop read SENT but a payment settled the invoice before its write: it stays
 *         PAID, no invoice.overdue, no reminder task (base: PAID overwritten with OVERDUE)
 *   DL-03 RED-BEFORE the loop read SENT but the overdue scheduler flipped it first: no second
 *         invoice.overdue; the reminder task is still raised (the invoice is overdue)
 *   AI-01 RED-BEFORE + LEDGER POST ai-execute mark_paid goes through recordPayment: one SUCCESSFUL
 *         manual payment recorded by the caller, exactly one payment posting, the receivable nets to
 *         zero, one invoice.paid (base: status PAID with no payment and no posting,
 *         commerce-ai.service.ts:814-821)
 *   AI-02 RED-BEFORE ai-execute answers 403 to a member whose revenue scope is none (and to read):
 *         nothing written (base: 201 and the invoice PAID)
 *   AI-03 RED-BEFORE + LEDGER ai-execute void_invoice on a SENT accrual invoice voids it through the
 *         workflow: the AR recognition is reversed (nets to zero) and invoice.void is emitted once
 *         (base: raw VOID, the receivable left open, commerce-ai.service.ts:825-832)
 *   AI-04 RED-BEFORE ai-execute void_invoice on a PAID invoice -> 409, still PAID (base: VOID over PAID)
 *   AI-05 RED-BEFORE ai-execute mark_paid on a VOID invoice -> 409, no payment (base: PAID over VOID)
 *   UN-01 + LEDGER (review SEC-V42-1) undoing a SENT invoice returns it to DRAFT through the workflow,
 *         non-terminal: no void, no invoice.* event, the AR recognition left posted, so re-issuing it
 *         posts nothing twice (the receivable stays 100, one recognition row). The packet first voided
 *         it with an AR reversal; VOID is terminal and both undo routes (agent.controller.ts,
 *         ai.controller.ts) check no revenue scope and do not bind the undo's tenant to the route's,
 *         so the undo stays non-terminal until a follow-up packet guards them
 *   UN-02 control: undoing a DRAFT soft-deletes it; undoing a PAID invoice still returns it to DRAFT
 *         (pinned by payments-mark-paid MP-16), now through the workflow, with no event
 *   UN-03 RED-BEFORE undoing a VOID invoice is refused 409: VOID is terminal (base: reverted to DRAFT)
 *   UN-04 + LEDGER (review CR-V42-3) undoing an OVERDUE invoice that a payment of 40 touched returns it
 *         to DRAFT: the payment stays SUCCESSFUL, the receivable stays 60, nothing is reversed (the
 *         packet voided it by status alone: the full recognition reversed, the receivable -40)
 *   UN-05 (review SEC-V42-1) through UndoService.undo, the service both undo routes call, a SENT,
 *         PENDING, OVERDUE or FAILED invoice comes back reverted_to_draft, never voided
 *   LC-02c (review CR-V42-2) two overlapping updateInvoiceStatus(SENT) calls on a DRAFT (the
 *         send-email after Gmail accepted the message) both answer SENT; one invoice.sent, one
 *         recognition, one timeline entry (the packet answered the loser 409)
 *   LC-02d (review CR-V42-2) two overlapping markInvoicePaid calls on a zero-balance invoice both
 *         answer PAID; one invoice.paid (the packet answered the loser 409)
 *   PF-01 (review CR-V42-1) PATCH payment-failed on an invoice already FAILED (a second failed
 *         attempt) -> 200, still FAILED, its timeline entry logged, no second invoice.payment_failed
 *         (the packet answered 409 and logged nothing; the base answered 200)
 *   PF-02 (review CR-V42-1 / CR-V42-2) two overlapping markInvoicePaymentFailed calls on a SENT invoice
 *         both answer FAILED; one invoice.payment_failed; both attempts logged
 *   AI-06 (review SEC-V42-2) mark_paid by invoiceNumber binds the invoice with exactly that number,
 *         not another whose number contains it (the packet paid whichever `contains` matched first)
 *   AI-07 (review SEC-V42-2) mark_paid by a partial number that matches more than one invoice is
 *         refused; nothing is paid
 *
 * The static ratchet on every other status writer is
 * apps/server/src/modules/commerce/invoice-status-writers.spec.ts.
 *
 * Interleaving: LC-01 and LC-03 hold the invoice row with SELECT ... FOR UPDATE
 * in a separate transaction, start the calls, wait until Postgres shows each
 * of them waiting on that lock (pg_stat_activity, so each has already read the
 * row), and then release it. Nothing in the server is stubbed for the race.
 *
 * Nothing on the boundary is mocked: PrismaService, the guards,
 * CommerceAiController, CommerceAiService, CommerceService,
 * InvoiceWorkflowService, RevenuePostingService, PostingService and the chart
 * of accounts read and write real rows; the production
 * GlobalHttpExceptionFilter + ValidationPipe are installed. Identity
 * attachment is the one stand-in: a test middleware reads `x-v42a-user`,
 * loads that seeded user row and attaches `{ id, email, role }` exactly as the
 * Supabase-verifying AuthMiddleware would. EventEmitter2 is a recorder; the
 * contact timeline (CrmService), TimelineService, the AI provider
 * (AiUsageService), CatalogService and the Gmail / Drive services are stubs
 * off the boundary; ExpensePostingService (COGS) is a no-op (no product lines).
 *
 * Fixtures: prefix `v42a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency order
 * in beforeAll and afterAll; no $transaction wrapping of the cases.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v42a_';
const HEADER = 'x-v42a-user';
const TOTAL = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const ID = {
  owner: `${P}owner`,
  staffNone: `${P}staffNone`,
  staffRead: `${P}staffRead`,
  biz: `${P}biz`,
  contact: `${P}contact`,
};

type Emitted = { name: string; payload: any };
const emitted: Emitted[] = [];
/** The contact timeline entries CommerceService logged (CrmService.logContactEvent). */
const contactEvents: Array<{ type: string; data: any }> = [];
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
const quietLogger = { log: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

let db: any;
let app: any;
let redis: any;
let testing: any;
let commerce: any;
let workflow: any;
let coa: any;
let undoService: any;
let DelegationLoopServiceRef: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM autopilot_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function agent() {
  return request(app.getHttpServer());
}
function aiExecute(as: string, action: string, params: Record<string, unknown>) {
  return agent().post(`/commerce/businesses/${ID.biz}/ai-execute`).set(HEADER, as).send({ action, params });
}

/** A 100.00 invoice moved to `status` the way the product moves it (issue posts the receivable). */
async function seedInvoice(
  key: string,
  status: 'DRAFT' | 'SENT' | 'PENDING' | 'OVERDUE' | 'FAILED' | 'PAID' | 'VOID',
  dueInDays = 14,
  opts: { invoiceNumber?: string; total?: number } = {},
) {
  const id = `${P}inv_${key}`;
  const total = opts.total ?? TOTAL;
  await db.invoice.create({
    data: {
      id,
      invoiceNumber: opts.invoiceNumber ?? `${P}INV-${key}`,
      businessId: ID.biz,
      contactId: ID.contact,
      status: 'DRAFT',
      subtotal: total,
      total,
      currency: 'TTD',
      dueDate: new Date(Date.now() + dueInDays * DAY_MS),
      items: { create: [{ description: `v42a ${key}`, quantity: 1, unitPrice: total, total }] },
    },
  });
  if (status === 'DRAFT') return id;
  await workflow.transition(id, 'SENT', { sentAt: new Date() });
  if (status === 'PENDING') await workflow.transition(id, 'PENDING');
  if (status === 'OVERDUE') await workflow.transition(id, 'OVERDUE');
  if (status === 'FAILED') await workflow.transition(id, 'FAILED');
  if (status === 'VOID') await workflow.transition(id, 'VOID');
  if (status === 'PAID') {
    await commerce.recordPayment(id, ID.biz, { amount: TOTAL, method: 'cash', reference: `${P}seed_${key}` }, { actorId: ID.owner });
  }
  emitted.length = 0;
  return id;
}

async function invoiceRow(id: string) {
  const [row] = await db.$queryRawUnsafe(
    `SELECT status::text AS status, paid_at AS "paidAt", deleted_at AS "deletedAt" FROM invoices WHERE id = $1`,
    id,
  );
  return row;
}

function eventsFor(invoiceId: string, name?: string) {
  return emitted.filter(
    (e) => e.name.startsWith('invoice.') && (!name || e.name === name) && (e.payload?.invoice?.id === invoiceId || e.payload?.invoiceId === invoiceId),
  );
}

/** Debits minus credits on ACCOUNTS_RECEIVABLE for this invoice's own postings (recognition and its reversal). */
async function receivableNet(invoiceId: string): Promise<number> {
  const ar = await coa.getBySystemKey(ID.biz, 'ACCOUNTS_RECEIVABLE');
  const [row] = await db.$queryRawUnsafe(
    `SELECT COALESCE(SUM(le.debit), 0)::text AS d, COALESCE(SUM(le.credit), 0)::text AS c
       FROM ledger_entries le JOIN financial_transactions ft ON ft.id = le.transaction_id
      WHERE le.business_id = $1 AND le.account_id = $2
        AND (ft.source_id = $3 OR ft.source_id IN (SELECT id FROM payments WHERE invoice_id = $3))`,
    ID.biz, ar.id, invoiceId,
  );
  return Math.round((Number(row.d) - Number(row.c)) * 100) / 100;
}

/** The invoice's own accrual recognition rows (sourceType Invoice), their statuses sorted. */
async function recognitionStatuses(invoiceId: string): Promise<string[]> {
  const rows = await db.financialTransaction.findMany({ where: { businessId: ID.biz, sourceType: 'Invoice', sourceId: invoiceId }, select: { status: true } });
  return rows.map((t: any) => t.status).sort();
}

async function paymentPostings(paymentId: string) {
  return db.financialTransaction.findMany({ where: { businessId: ID.biz, sourceType: 'Payment', sourceId: paymentId }, include: { entries: true } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Hold the invoice row (SELECT ... FOR UPDATE) in a transaction of its own,
 * start `calls`, wait until `waiters` backends of this database are waiting on
 * a lock (each call has read the row and is at its write), run `during` inside
 * the holder, then release. Returns the calls' settled results.
 */
async function interleave(
  invoiceId: string,
  waiters: number,
  calls: () => Array<Promise<unknown>>,
  during?: (tx: any) => Promise<unknown>,
): Promise<PromiseSettledResult<unknown>[]> {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let locked!: (pid: number) => void;
  const isLocked = new Promise<number>((r) => { locked = r; });
  const holder = db.$transaction(
    async (tx: any) => {
      const [me] = await tx.$queryRawUnsafe(`SELECT pg_backend_pid()::int AS pid`);
      await tx.$queryRawUnsafe(`SELECT id FROM invoices WHERE id = $1 FOR UPDATE`, invoiceId);
      locked(me.pid);
      await gate;
      if (during) await during(tx);
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  const holderPid = await isLocked;
  const started = calls();
  const deadline = Date.now() + 10_000;
  let seen = 0;
  while (Date.now() < deadline) {
    // Backends waiting on the holder, directly or behind a waiter queued on the same row
    // (other suites' lock waits on this database are not counted).
    const [row] = await db.$queryRawUnsafe(
      `WITH w AS (SELECT pid, pg_blocking_pids(pid) AS b FROM pg_stat_activity WHERE datname = current_database())
       SELECT count(*)::int AS n FROM w
        WHERE $1 = ANY(w.b) OR EXISTS (SELECT 1 FROM w w2 WHERE w2.pid = ANY(w.b) AND $1 = ANY(w2.b))`,
      holderPid,
    );
    seen = row.n;
    if (seen >= waiters) break;
    await sleep(25);
  }
  expect(seen, 'every call reached its write while the row was held').toBeGreaterThanOrEqual(waiters);
  release();
  await holder;
  return Promise.allSettled(started);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const IORedis = (await import('ioredis')).default;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceAiController } = await import('../src/modules/commerce/commerce-ai.controller');
  const { CommerceAiService } = await import('../src/modules/commerce/commerce-ai.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  ({ DelegationLoopService: DelegationLoopServiceRef } = await import('../src/modules/autopilot/delegation-loop.service'));
  const { UndoService } = await import('../src/modules/ai/undo.service');

  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });

  testing = await Test.createTestingModule({
    controllers: [CommerceController, CommerceAiController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      { provide: REDIS_CLIENT, useValue: redis },
      CommerceService,
      CommerceStatsService,
      CommerceAiService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      RevenuePostingService,
      PostingService,
      AccountingPeriodService,
      ChartOfAccountsSeederService,
      LedgerBalanceService,
      { provide: AiUsageService, useValue: { callAi: async () => ({ content: '{}' }) } },
      { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
      { provide: EventEmitter2, useValue: recorder },
      {
        provide: CrmService,
        useValue: {
          logContactEvent: async (e: { type: string; data: any }) => {
            contactEvents.push(e);
            return null;
          },
        },
      },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      PaymentEvidenceService,
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
    ],
  }).compile();
  commerce = testing.get(CommerceService);
  workflow = testing.get(InvoiceWorkflowService);
  coa = testing.get(ChartOfAccountsSeederService);
  // The real UndoService both undo routes call (POST /ai/businesses/:businessId/agent/undo/:undoId and
  // the plan-step undo); it resolves CommerceService from this module. Its execution log is off the boundary.
  undoService = new UndoService(testing.get(PrismaService), recorder as any, { log: async () => undefined } as any, testing);

  app = testing.createNestApplication();
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
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const [user, tag] of [[ID.owner, 'owner'], [ID.staffNone, 'none'], [ID.staffRead, 'read']] as const) {
    await db.user.create({ data: { id: user, email: `${P}${tag}@test.local`, role: 'USER' } });
  }
  await db.business.create({
    data: { id: ID.biz, name: 'V42A Lifecycle', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD', accountingBasis: 'ACCRUAL' },
  });
  const m = (user: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${user}_m`, userId: user, businessId: ID.biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, 'OWNER');
  await m(ID.staffNone, 'STAFF', { revenue: 'none', crm: 'read' });
  await m(ID.staffRead, 'STAFF', { revenue: 'read', crm: 'read' });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'V42a', lastName: 'Customer', email: `${P}customer@test.local` } });
  await coa.ensureDefaults(ID.biz);
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  await app?.close();
  await redis?.quit().catch(() => undefined);
});

beforeEach(() => {
  emitted.length = 0;
  contactEvents.length = 0;
});

describe('CAS: one transition wins, the other is refused 409 with no event (CF-39)', () => {
  it('LC-01 RED-BEFORE: two concurrent transition(id, OVERDUE) calls that both read SENT -> one fulfilled, one 409; invoice.overdue emitted once', async () => {
    const inv = await seedInvoice('lc01', 'SENT');
    const results = await interleave(inv, 2, () => [workflow.transition(inv, 'OVERDUE'), workflow.transition(inv, 'OVERDUE')]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.map((r) => r.status).sort(), JSON.stringify(rejected.map((r) => String(r.reason)))).toEqual(['fulfilled', 'rejected']);
    expect(rejected[0].reason).toMatchObject({ status: 409 });
    expect((await invoiceRow(inv)).status).toBe('OVERDUE');
    expect(eventsFor(inv, 'invoice.overdue')).toHaveLength(1);
  }, 60_000);

  it('LC-02 RED-BEFORE: transition to the status the invoice already holds -> 409, no event, nothing written', async () => {
    const inv = await seedInvoice('lc02', 'OVERDUE');
    await expect(workflow.transition(inv, 'OVERDUE')).rejects.toMatchObject({ status: 409 });
    expect((await invoiceRow(inv)).status).toBe('OVERDUE');
    expect(eventsFor(inv)).toHaveLength(0);
  }, 60_000);

  it('LC-02b RED-BEFORE: PATCH status/overdue on an invoice already OVERDUE -> 200, answered idempotently: no second invoice.overdue', async () => {
    const inv = await seedInvoice('lc02b', 'OVERDUE');
    const res = await agent()
      .patch(`/commerce/invoices/${inv}/status/overdue`)
      .set(HEADER, ID.owner)
      .send({ businessId: ID.biz, status: 'OVERDUE' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: inv, status: 'OVERDUE' });
    expect((await invoiceRow(inv)).status).toBe('OVERDUE');
    expect(eventsFor(inv)).toHaveLength(0);
  }, 60_000);

  it('LC-02c (review CR-V42-2): two overlapping updateInvoiceStatus(SENT) calls on a DRAFT -> both answer SENT; one invoice.sent, one recognition, one timeline entry', async () => {
    const inv = await seedInvoice('lc02c', 'DRAFT');
    // What send-email calls once Gmail has accepted the message (commerce.controller.ts send-email).
    const send = () => commerce.updateInvoiceStatus({ invoiceId: inv, status: 'SENT', actorId: ID.owner, businessId: ID.biz, sentAt: new Date() });
    const results = await interleave(inv, 2, () => [send(), send()]);
    const outcome = results.map((r) => (r.status === 'fulfilled' ? `fulfilled ${(r.value as any).status}` : `rejected ${String(r.reason)}`));
    expect(outcome).toEqual(['fulfilled SENT', 'fulfilled SENT']);
    for (const r of results) expect((r as PromiseFulfilledResult<any>).value).toMatchObject({ id: inv, status: 'SENT' });
    expect((await invoiceRow(inv)).status).toBe('SENT');
    expect(eventsFor(inv, 'invoice.sent')).toHaveLength(1);
    expect(await recognitionStatuses(inv)).toEqual(['POSTED']);
    expect(await receivableNet(inv)).toBe(TOTAL);
    expect(contactEvents.filter((e) => e.type === 'invoice.sent')).toHaveLength(1);
  }, 60_000);

  it('LC-02d (review CR-V42-2): two overlapping markInvoicePaid calls on a zero-balance invoice -> both answer PAID; one invoice.paid; no payment invented', async () => {
    const inv = await seedInvoice('lc02d', 'SENT', 14, { total: 0 });
    const results = await interleave(inv, 2, () => [commerce.markInvoicePaid(inv, ID.owner, ID.biz), commerce.markInvoicePaid(inv, ID.owner, ID.biz)]);
    const outcome = results.map((r) => (r.status === 'fulfilled' ? `fulfilled ${(r.value as any).status}` : `rejected ${String(r.reason)}`));
    expect(outcome).toEqual(['fulfilled PAID', 'fulfilled PAID']);
    expect((await invoiceRow(inv)).status).toBe('PAID');
    expect(eventsFor(inv, 'invoice.paid')).toHaveLength(1);
    expect(await db.payment.count({ where: { invoiceId: inv } })).toBe(0);
  }, 60_000);

  it('LC-03 RED-BEFORE: a payment settles the invoice while transition(OVERDUE) is in flight -> the transition is refused 409; PAID stands; no invoice.overdue', async () => {
    const inv = await seedInvoice('lc03', 'SENT');
    const results = await interleave(
      inv,
      1,
      () => [workflow.transition(inv, 'OVERDUE')],
      // The settling writer commits first (it holds the row): what a payment's reconcile writes.
      (tx) => tx.$executeRawUnsafe(`UPDATE invoices SET status = 'PAID', paid_at = now() WHERE id = $1`, inv),
    );
    expect(results[0].status).toBe('rejected');
    expect((results[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect((await invoiceRow(inv)).status).toBe('PAID');
    expect(eventsFor(inv, 'invoice.overdue')).toHaveLength(0);
  }, 60_000);
});

describe('payment-failed answers a repeated failed attempt (review CR-V42-1)', () => {
  const paymentFailed = (inv: string, reason: string) =>
    agent().patch(`/commerce/invoices/${inv}/payment-failed?businessId=${ID.biz}`).set(HEADER, ID.owner).send({ reason });
  const failedAttempts = () => contactEvents.filter((e) => e.type === 'invoice.payment_failed').map((e) => e.data?.reason);

  it('PF-01: PATCH payment-failed on an invoice already FAILED (a second failed attempt) -> 200; still FAILED; the attempt logged; no second invoice.payment_failed', async () => {
    const inv = await seedInvoice('pf01', 'SENT');
    const first = await paymentFailed(inv, 'card declined');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await paymentFailed(inv, 'card declined again');
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ id: inv, status: 'FAILED' });
    expect((await invoiceRow(inv)).status).toBe('FAILED');
    expect(eventsFor(inv, 'invoice.payment_failed')).toHaveLength(1);
    expect(failedAttempts()).toEqual(['card declined', 'card declined again']);
  }, 60_000);

  it('PF-02: two overlapping markInvoicePaymentFailed calls on a SENT invoice -> both answer FAILED; one invoice.payment_failed; both attempts logged', async () => {
    const inv = await seedInvoice('pf02', 'SENT');
    const results = await interleave(inv, 2, () => [
      commerce.markInvoicePaymentFailed(inv, ID.owner, 'attempt 1', ID.biz),
      commerce.markInvoicePaymentFailed(inv, ID.owner, 'attempt 2', ID.biz),
    ]);
    const outcome = results.map((r) => (r.status === 'fulfilled' ? `fulfilled ${(r.value as any).status}` : `rejected ${String(r.reason)}`));
    expect(outcome).toEqual(['fulfilled FAILED', 'fulfilled FAILED']);
    expect((await invoiceRow(inv)).status).toBe('FAILED');
    expect(eventsFor(inv, 'invoice.payment_failed')).toHaveLength(1);
    expect(failedAttempts().sort()).toEqual(['attempt 1', 'attempt 2']);
  }, 60_000);
});

describe('DelegationLoop payment recovery goes through the workflow', () => {
  /**
   * The real runPaymentRecovery over the real database. With `staleFor`, its
   * read returns that one invoice as SENT whatever the row holds (the row
   * moved after the loop read it).
   */
  function loop(staleFor?: string) {
    const client = staleFor
      ? new Proxy(db, {
          get(target: any, prop: string | symbol) {
            if (prop === 'invoice') {
              const inv = target.invoice;
              return new Proxy(inv, {
                get(t: any, p: string | symbol) {
                  if (p === 'findMany') {
                    return async (args: any) =>
                      (await t.findMany({ ...args, where: { ...args.where, id: staleFor, status: undefined } })).map((r: any) => ({ ...r, status: 'SENT' }));
                  }
                  const v = Reflect.get(t, p);
                  return typeof v === 'function' ? v.bind(t) : v;
                },
              });
            }
            const v = Reflect.get(target, prop);
            return typeof v === 'function' ? v.bind(target) : v;
          },
        })
      : db;
    const service = Object.assign(Object.create(DelegationLoopServiceRef.prototype), {
      prisma: { client },
      events: recorder,
      timeline: { logEvent: async () => undefined },
      emailService: { send: async () => undefined },
      logger: quietLogger,
      contactWindow: async () => ({ allowed: true }),
      moduleRef: testing,
    });
    // requiresConfirm: the reminder goes to a human, so nothing is emailed.
    return () => service.runPaymentRecovery(ID.biz, {}, { itemsScanned: 0, itemsMatched: 0, actionsCreated: 0, actionsBlocked: 0, results: [] }, true);
  }
  const tasksFor = (inv: string) => db.autopilotTask.findMany({ where: { businessId: ID.biz, relatedId: inv } });

  it('DL-01 RED-BEFORE: a SENT invoice past its grace -> OVERDUE through the workflow; invoice.overdue carries the nested InvoiceStatusPayload', async () => {
    const inv = await seedInvoice('dl01', 'SENT', -10);
    await loop()();
    expect((await invoiceRow(inv)).status).toBe('OVERDUE');
    const events = emitted.filter((e) => e.name === 'invoice.overdue');
    expect(events, JSON.stringify(events.map((e) => e.payload))).toHaveLength(1);
    const payload = events[0].payload;
    expect(payload).toMatchObject({ businessId: ID.biz, status: 'OVERDUE', invoice: { id: inv, businessId: ID.biz, status: 'OVERDUE' } });
    expect(payload).not.toHaveProperty('invoiceId');
    expect(payload).not.toHaveProperty('source');
    expect(await tasksFor(inv)).toHaveLength(1);
  }, 60_000);

  it('DL-02 RED-BEFORE: the loop read SENT but a payment settled the invoice first -> stays PAID; no invoice.overdue; no reminder', async () => {
    const inv = await seedInvoice('dl02', 'PAID', -10);
    await loop(inv)();
    expect((await invoiceRow(inv)).status).toBe('PAID');
    expect(emitted.filter((e) => e.name === 'invoice.overdue')).toHaveLength(0);
    expect(await tasksFor(inv)).toHaveLength(0);
  }, 60_000);

  it('DL-03 RED-BEFORE: the loop read SENT but the overdue scheduler flipped it first -> no second invoice.overdue; the reminder is still raised', async () => {
    const inv = await seedInvoice('dl03', 'OVERDUE', -10);
    await loop(inv)();
    expect((await invoiceRow(inv)).status).toBe('OVERDUE');
    expect(emitted.filter((e) => e.name === 'invoice.overdue')).toHaveLength(0);
    expect(await tasksFor(inv)).toHaveLength(1);
  }, 60_000);
});

describe('POST /commerce/businesses/:businessId/ai-execute goes through the workflow and the ledger door', () => {
  it('AI-01 RED-BEFORE + LEDGER: mark_paid records one manual payment by the caller with exactly one posting; the receivable nets to zero; one invoice.paid', async () => {
    const inv = await seedInvoice('ai01', 'SENT');
    expect(await receivableNet(inv)).toBe(TOTAL);
    const res = await aiExecute(ID.owner, 'mark_paid', { invoiceId: inv });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, invoiceId: inv });
    const row = await invoiceRow(inv);
    expect(row.status).toBe('PAID');
    expect(row.paidAt).not.toBeNull();
    const payments = await db.payment.findMany({ where: { invoiceId: inv } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: 'SUCCESSFUL', amount: TOTAL, provider: 'manual', method: 'MANUAL', recordedBy: ID.owner, businessId: ID.biz });
    const postings = await paymentPostings(payments[0].id);
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({ status: 'POSTED', sourceType: 'Payment', sourceId: payments[0].id });
    expect(Number(postings[0].amount)).toBe(TOTAL);
    expect(await receivableNet(inv)).toBe(0);
    expect(eventsFor(inv, 'invoice.paid')).toHaveLength(1);
  }, 60_000);

  it('AI-02 RED-BEFORE: a member whose revenue scope is none (or read) -> 403; nothing written', async () => {
    const inv = await seedInvoice('ai02', 'SENT');
    for (const member of [ID.staffNone, ID.staffRead]) {
      const res = await aiExecute(member, 'mark_paid', { invoiceId: inv });
      expect(res.status, `${member}: ${JSON.stringify(res.body)}`).toBe(403);
    }
    expect((await invoiceRow(inv)).status).toBe('SENT');
    expect(await db.payment.count({ where: { invoiceId: inv } })).toBe(0);
    expect(eventsFor(inv)).toHaveLength(0);
  }, 60_000);

  it('AI-03 RED-BEFORE + LEDGER: void_invoice on a SENT accrual invoice -> VOID through the workflow; the AR recognition is reversed (nets to zero); one invoice.void', async () => {
    const inv = await seedInvoice('ai03', 'SENT');
    expect(await receivableNet(inv)).toBe(TOTAL);
    const res = await aiExecute(ID.owner, 'void_invoice', { invoiceId: inv });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, invoiceId: inv });
    expect((await invoiceRow(inv)).status).toBe('VOID');
    expect(await receivableNet(inv)).toBe(0);
    const recognition = await db.financialTransaction.findMany({ where: { businessId: ID.biz, sourceType: 'Invoice', sourceId: inv } });
    expect(recognition.map((t: any) => t.status).sort()).toEqual(['POSTED', 'REVERSED']);
    expect(eventsFor(inv, 'invoice.void')).toHaveLength(1);
  }, 60_000);

  it('AI-04 RED-BEFORE: void_invoice on a PAID invoice -> 409; still PAID; the payment untouched; no event', async () => {
    const inv = await seedInvoice('ai04', 'PAID');
    const res = await aiExecute(ID.owner, 'void_invoice', { invoiceId: inv });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect((await invoiceRow(inv)).status).toBe('PAID');
    expect(await db.payment.count({ where: { invoiceId: inv, status: 'SUCCESSFUL' } })).toBe(1);
    expect(eventsFor(inv)).toHaveLength(0);
  }, 60_000);

  it('AI-05 RED-BEFORE: mark_paid on a VOID invoice -> 409; no payment, no posting; still VOID', async () => {
    const inv = await seedInvoice('ai05', 'VOID');
    const res = await aiExecute(ID.owner, 'mark_paid', { invoiceId: inv });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect((await invoiceRow(inv)).status).toBe('VOID');
    expect(await db.payment.count({ where: { invoiceId: inv } })).toBe(0);
    expect(eventsFor(inv)).toHaveLength(0);
  }, 60_000);

  it('AI-06 (review SEC-V42-2): mark_paid by invoiceNumber pays the invoice with exactly that number, not another whose number contains it', async () => {
    const longer = await seedInvoice('ai06a', 'SENT', 14, { invoiceNumber: `${P}N-0012` });
    const named = await seedInvoice('ai06b', 'SENT', 14, { invoiceNumber: `${P}N-001` });
    const res = await aiExecute(ID.owner, 'mark_paid', { invoiceNumber: `${P}N-001` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, invoiceId: named });
    expect((await invoiceRow(named)).status).toBe('PAID');
    expect(await db.payment.count({ where: { invoiceId: named, status: 'SUCCESSFUL' } })).toBe(1);
    expect((await invoiceRow(longer)).status).toBe('SENT');
    expect(await db.payment.count({ where: { invoiceId: longer } })).toBe(0);
    expect(eventsFor(longer)).toHaveLength(0);
  }, 60_000);

  it('AI-07 (review SEC-V42-2): mark_paid by a partial number that matches more than one invoice -> refused; nothing paid', async () => {
    const a = await seedInvoice('ai07a', 'SENT', 14, { invoiceNumber: `${P}M-0012` });
    const b = await seedInvoice('ai07b', 'SENT', 14, { invoiceNumber: `${P}M-0013` });
    const res = await aiExecute(ID.owner, 'mark_paid', { invoiceNumber: `${P}M-001` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: false });
    expect(res.body.error).toMatch(/more than one invoice/);
    for (const inv of [a, b]) {
      expect((await invoiceRow(inv)).status).toBe('SENT');
      expect(await db.payment.count({ where: { invoiceId: inv } })).toBe(0);
      expect(eventsFor(inv)).toHaveLength(0);
    }
  }, 60_000);
});

describe('Undo of an AI-created invoice (CommerceService.undoInvoice) goes through the workflow', () => {
  it('UN-01 + LEDGER (review SEC-V42-1): undoing a SENT invoice returns it to DRAFT, non-terminal: no void, no reversal, no event; re-issuing it posts nothing twice', async () => {
    const inv = await seedInvoice('un01', 'SENT');
    expect(await receivableNet(inv)).toBe(TOTAL);
    const result = await commerce.undoInvoice(inv, ID.biz);
    expect(result).toMatchObject({ id: inv, status: 'reverted_to_draft' });
    expect((await invoiceRow(inv)).status).toBe('DRAFT');
    expect(eventsFor(inv)).toHaveLength(0);
    expect(await recognitionStatuses(inv)).toEqual(['POSTED']);
    expect(await receivableNet(inv)).toBe(TOTAL);
    // Non-terminal: a person can issue it again, and the recognition is not posted a second time.
    await workflow.transition(inv, 'SENT', { sentAt: new Date() });
    expect((await invoiceRow(inv)).status).toBe('SENT');
    expect(await recognitionStatuses(inv)).toEqual(['POSTED']);
    expect(await receivableNet(inv)).toBe(TOTAL);
    expect(eventsFor(inv, 'invoice.sent')).toHaveLength(1);
  }, 60_000);

  it('UN-02 control: undoing a DRAFT soft-deletes it; undoing a PAID invoice returns it to DRAFT (MP-16) with no event', async () => {
    const draft = await seedInvoice('un02d', 'DRAFT');
    expect(await commerce.undoInvoice(draft, ID.biz)).toMatchObject({ id: draft, status: 'deleted' });
    expect((await invoiceRow(draft)).deletedAt).not.toBeNull();

    const paid = await seedInvoice('un02p', 'PAID');
    expect(await commerce.undoInvoice(paid, ID.biz)).toMatchObject({ id: paid, status: 'reverted_to_draft' });
    expect((await invoiceRow(paid)).status).toBe('DRAFT');
    expect(eventsFor(paid)).toHaveLength(0);
  }, 60_000);

  it('UN-03 RED-BEFORE: undoing a VOID invoice -> 409 (VOID is terminal); still VOID', async () => {
    const inv = await seedInvoice('un03', 'VOID');
    await expect(commerce.undoInvoice(inv, ID.biz)).rejects.toMatchObject({ status: 409 });
    expect((await invoiceRow(inv)).status).toBe('VOID');
    expect(eventsFor(inv)).toHaveLength(0);
  }, 60_000);

  it('UN-04 + LEDGER (review CR-V42-3): undoing an OVERDUE invoice a payment of 40 touched returns it to DRAFT; the payment stands; the receivable stays 60; nothing reversed', async () => {
    const inv = await seedInvoice('un04', 'SENT');
    await commerce.recordPayment(inv, ID.biz, { amount: 40, method: 'cash', reference: `${P}un04_pay` }, { actorId: ID.owner });
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');
    await commerce.updateInvoiceStatus({ invoiceId: inv, status: 'OVERDUE', actorId: ID.owner, businessId: ID.biz });
    expect((await invoiceRow(inv)).status).toBe('OVERDUE');
    expect(await receivableNet(inv)).toBe(60);
    emitted.length = 0;
    const result = await commerce.undoInvoice(inv, ID.biz);
    expect(result).toMatchObject({ id: inv, status: 'reverted_to_draft' });
    expect((await invoiceRow(inv)).status).toBe('DRAFT');
    const payments = await db.payment.findMany({ where: { invoiceId: inv } });
    expect(payments.map((p: any) => [p.status, Number(p.amount)])).toEqual([['SUCCESSFUL', 40]]);
    expect(await recognitionStatuses(inv)).toEqual(['POSTED']);
    expect(await receivableNet(inv)).toBe(60);
    expect(eventsFor(inv)).toHaveLength(0);
  }, 60_000);

  it('UN-05 (review SEC-V42-1): through UndoService.undo (both undo routes) a SENT, PENDING, OVERDUE or FAILED invoice comes back reverted_to_draft, never voided', async () => {
    for (const status of ['SENT', 'PENDING', 'OVERDUE', 'FAILED'] as const) {
      const inv = await seedInvoice(`un05_${status.toLowerCase()}`, status);
      const undoId = await undoService.registerAction({ businessId: ID.biz, actionType: 'create_invoice', entityType: 'invoice', entityId: inv, originalPayload: {} });
      const out = await undoService.undo(undoId, ID.owner);
      expect(out, `${status}: ${JSON.stringify(out)}`).toMatchObject({ success: true, restored: { id: inv, status: 'reverted_to_draft' } });
      expect((await invoiceRow(inv)).status, status).toBe('DRAFT');
      expect(await recognitionStatuses(inv), status).toEqual(['POSTED']);
      expect(await receivableNet(inv), status).toBe(TOTAL);
      expect(eventsFor(inv), status).toHaveLength(0);
    }
  }, 60_000);
});
