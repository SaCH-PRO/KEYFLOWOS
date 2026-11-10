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
 *         money beyond it, a payment of the whole total (what mark-paid recorded before the
 *         CR-V44-1 reader half: now the remainder net of credits, CN-34), and any payment on a
 *         FULLY_CREDITED invoice -> 409 with nothing written
 *   (the CR-V44-1 reader half: CN-32..CN-35 below, W4-CREDIT-AWARE-READERS)
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
 *
 * W4-CREDIT-REFUND-PAIDAT (the W3-CREDIT-RECONCILE-BIND todo in invoice-workflow.service.ts):
 *   CRB-CR-1 CR-V44-2 (D-14, D-78), refund half: a refund that unsettles a credited invoice clears its
 *         paidAt at the refund (reconcileCreditedFromPayments), by reconcileFromCredits' rule: kept
 *         only while the invoice's own payment rows net of refunds settle the total. The status
 *         stays credited (D-78); refund-then-credit and credit-then-refund end with one paidAt
 *         (CN-31); a reconcile that leaves the payment settling the total keeps it, and another
 *         business's REFUNDED row on the invoice unsettles nothing (RC-DEP-2)
 *
 * W5-REFUND-DOORS-KEEP (the W4-CREDIT-REFUND-PAIDAT review todo SEC-CRP-1 / CR-REG-2):
 *   CRP-1 RED-BEFORE CR-V44-2 (D-14, D-78) the provider refund doors reconcile a credited invoice under
 *         'keep', as the manual door does: a Stripe refund (refund.created, or charge.refunded with only
 *         its cumulative) or a PayPal refund (by capture, or by invoice) that leaves more received than
 *         the credits leave owing keeps the credited status and clears the paidAt (base: the reconcile
 *         was refused 409, swallowed by the webhook, and the stale paidAt stayed); the same money
 *         position ends with one paidAt through the manual and the provider doors
 *
 * W4-CREDIT-AWARE-READERS (the V1-44 review todo CR-V44-1, reader half; D-13, D-28, D-75, D-78),
 * on a second app (CommerceController + PaymentsController, see its describe):
 *   CN-32 RED-BEFORE a 100 invoice with 20 paid and 30 credited (PARTIALLY_CREDITED) is shown on
 *         the share surfaces with what is due net of the APPLIED credit notes: the bare-id public
 *         view and the token pay page remaining 50, the token view amountDue 50 (base: 404 /
 *         not_found). Another business's APPLIED note and payment row on it move nothing (D-75).
 *         The token money routes behind payLinkInvoice (status poll, gateways, checkout) stay
 *         closed 404: their readers are credit-unaware and outside the write set (an it.todo
 *         then, live since W5-CREDIT-AWARE-PAY, below; W8-HOUSEKEEPING)
 *   CN-33 RED-BEFORE the token offline intent is accepted on it and capped at the 50 net of
 *         credits (INTENT_PAYABLE_STATUSES); no status move, no posting
 *   CN-34 RED-BEFORE mark-paid records exactly the 50 the credits leave owing (one SUCCESSFUL
 *         mark-paid row and its posting; base: 409, it recorded the credit-unaware 80) and the
 *         invoice stays PARTIALLY_CREDITED (D-78) with the receivable at 0; then the share
 *         surfaces show 0 due, the intent is 409 and a second mark-paid writes nothing
 *   CN-35 a FULLY_CREDITED invoice stays unpayable: mark-paid 409 with nothing written; the
 *         share surfaces, the intent and the token money routes answer 404 (not shareable)
 *
 * W5-CREDIT-AWARE-PAY (the two W4-CREDIT-AWARE-READERS todos: CR-V44-1 rest, CR-AR-2 server half;
 * D-13, D-75, D-78), providers stubbed at the network edge (no real provider traffic):
 *   CN-32 (amended) the token status poll, closed 404 for a credited invoice until now, states the
 *         same 50 due and the 30 credited from the own-tenant rows and notes
 *   CAP-01 RED-BEFORE the token and bare-id status polls and the public receipt state 50 due and 30
 *         credited; the Stripe, WiPay and PayPal checkouts ask for 50 (not invoice.total); foreign
 *         rows move nothing (D-75); a checkout records and posts nothing
 *   CAP-02 RED-BEFORE the WiPay callback verified over the 50 requested records 50, the invoice stays
 *         PARTIALLY_CREDITED (D-78), its redelivery is a duplicate; then 0 due, 30 credited, and every
 *         checkout of the settled invoice is 409 with no provider called
 *   CAP-03 RED-BEFORE the token PayPal capture takes only the order for the 50 and records 50; an
 *         order for the 100 total is refused 400 before PayPal captures
 *   CAP-04 RED-BEFORE control: an uncredited part-paid invoice's Stripe checkout asks for its remainder
 *   CAP-05 RED-BEFORE FULLY_CREDITED stays unpayable: the token routes, the receipt and the bare-id
 *         status 404; the bare-id checkout 409 with no provider called
 *
 * W5-CREDIT-AWARE-PAY review repairs (D-13, D-19, D-75, D-78): the WiPay callback is verified against the
 * amounts the invoice's checkouts asked for, kept before WiPay is called (webhook_events 'wipay-requested'),
 * or the whole total a pre-W5 checkout asked for; never a remainder worked out when the callback arrives:
 *   CAP-02 (amended) the payer's WiPay checkout asks for the 50 before its callback arrives
 *   CAP-06 SEC-CAP-1 / CR-CAP-1 a payment recorded between the checkout and its callback, and a second
 *          paid checkout of the same amount: each callback records the amount asked (packet head: 400
 *          'Invalid WiPay callback signature', nothing written); a refused checkout keeps nothing
 *   CAP-07 SEC-CAP-1 / CR-CAP-1 a credit note applied between the checkout and its callback: the 70 asked is
 *          recorded, the invoice stays PARTIALLY_CREDITED
 *   CAP-08 SEC-CAP-2 the redelivery of a recorded transaction after its credit note is voided is the
 *          duplicate answer, nothing more written
 *   CAP-09 SEC-CAP-3 invoice A's transaction sent with B's order_id, B owing the same 50 but never asked
 *          for it, is refused 400 with no row and no claim; A's own callback then records it on A
 *   (CR-CAP-2: cleanup() deletes this suite's webhook_events rows, so a second run starts clean)
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
 * W5-REFUND-DOORS-KEEP: the module's PaymentsService is real (its provider
 * refund doors, called as the webhooks call them); its CommerceService (the
 * pay-link reads, off those doors) is an empty stub and no provider connector
 * is provided.
 *
 * Fixtures: prefix `v44a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL (patterns built by sqlLikePrefix) in dependency
 * order in beforeAll and afterAll; no $transaction wrapping of the cases.
 */
import 'reflect-metadata';
import path from 'path';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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
let paymentsSvc: any;
let DriveIntakeOrchestratorClass: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    // W5-CREDIT-AWARE-PAY review CR-CAP-2: the WiPay claims (CAP-02) and the amounts the WiPay checkouts asked
    // for (CAP-06..CAP-09) are this suite's rows too; left behind, a second run read 'Duplicate callback ignored'.
    `DELETE FROM webhook_events WHERE provider_event_id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM credit_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
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
  // W5-REFUND-DOORS-KEEP (SEC-CRP-1 / CR-REG-2): the provider refund doors (processStripeRefund,
  // processPaypalRefund) over the same real Prisma, workflow and ledger chain; CommerceService is
  // off those doors (the pay-link reads only) and is an empty stub; no provider connector is provided.
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');

  const real: any[] = [
    CreditNoteService,
    PostingService,
    AccountingPeriodService,
    ChartOfAccountsSeederService,
    RevenuePostingService,
    InvoiceWorkflowService,
    PaymentsService,
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
      { provide: CommerceService, useValue: {} },
      { provide: EventEmitter2, useValue: recorder },
    ],
  }).compile();
  workflow = moduleRef.get(InvoiceWorkflowService);
  revenuePosting = moduleRef.get(RevenuePostingService);
  paymentsSvc = moduleRef.get(PaymentsService);
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
 * (credit-note.service.ts, invoice-workflow.service.ts) and kept the halves
 * outside it as it.todo; none is left in this file: the later packets in the
 * header (W3-CREDIT-RECONCILE-BIND through W5-CREDIT-AWARE-PAY) closed them
 * (W8-HOUSEKEEPING).
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

    // CR-V44-1: a payment of the whole total (what mark-paid recorded before the W4-CREDIT-AWARE-READERS
    // reader half, which did not net credits) is refused, not over-collected. Mark-paid now records the
    // remainder net of the APPLIED credit notes and leaves the invoice PARTIALLY_CREDITED (CN-34, D-78).
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

  // The CR-V44-1 reader half (the share surfaces, the token pay link, mark-paid) is live as
  // CN-32..CN-35 (W4-CREDIT-AWARE-READERS, at the end of this file).
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
          providerPaymentId: `${P}pp_${id.slice(P.length)}`,
          reference: original.providerPaymentId,
          businessId: ID.biz,
          invoiceId,
        },
      });
      await revenuePosting.onPaymentRefunded(paymentId, { tx, createdById: ID.owner, refund: { paymentId: id, amount } });
      return workflow.reconcileFromPayments(invoiceId, { tx, eventBuffer: [], onIllegalTransition: 'keep' });
    });
  }

  /**
   * W4-CREDIT-REFUND-PAIDAT review CR-REG-1: refundPayment above now clears a
   * credited invoice's paidAt itself (CRB-CR-1), so a credit move after it
   * would meet no paidAt to clear and CN-29 / CN-31 would no longer prove the
   * clears in reconcileFromCredits. This checks the refund cleared it, then
   * puts back the paidAt the refunded payment stamped: the stale paidAt a row
   * refunded before W4-CREDIT-REFUND-PAIDAT still carries, as does one a
   * provider refund webhook left before W5-REFUND-DOORS-KEEP, when its
   * reconcile was refused 409 (review SEC-CRP-1, CRP-1 after CRB-CR-1). The
   * credit move must clear it.
   */
  async function putBackStalePaidAt(invoiceId: string, paidAt: Date | null) {
    expect(paidAt, 'the paid invoice was stamped').not.toBeNull();
    expect(await invoiceRow(invoiceId), 'the refund cleared it (CRB-CR-1)').toMatchObject({ paidAt: null });
    await db.invoice.update({ where: { id: invoiceId }, data: { paidAt } });
    expect((await invoiceRow(invoiceId)).paidAt, 'stale paidAt in place before the credit move').toEqual(paidAt);
  }

  it('CN-29 CR-V44-2 (D-14, D-78): reconcileFromCredits clears paidAt once the status it writes is not PAID and the payment rows no longer settle the invoice; a PAID invoice part-credited with its payment in place keeps it, and a return to PAID keeps or stamps it', async () => {
    // W4-CREDIT-REFUND-PAIDAT review CR-REG-1: (a)-(c) put the refunded payment's paidAt back after the refund
    // (putBackStalePaidAt), so the credit move meets a stale paidAt and the status move's { paidAt: null } in
    // reconcileFromCredits is what clears it (with that clear removed, (a)-(c) fail).
    // (a) Paid, part-credited, refunded in full, the note voided: SENT, owed afresh, no paidAt.
    const a = await seedInvoice('rc_sent', 'PAID');
    const paidAtA = (await invoiceRow(a)).paidAt;
    expect(paidAtA).not.toBeNull();
    const noteA = await createNote(a, 30);
    expect((await applyNote(noteA.id)).status).toBe(201);
    expect(await invoiceRow(a), 'part-credited with its payment in place: paidAt kept (CN-06)').toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: paidAtA });
    await expect(refundPayment(a, TOTAL, 'rf_all')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    await putBackStalePaidAt(a, paidAtA);
    expect((await voidNote(noteA.id)).status).toBe(201);
    // RED-BEFORE (W3 base ca12b6f5): SENT, still carrying the paidAt of the payment that went back.
    expect(await invoiceRow(a), 'reopened to SENT: no paidAt (D-14)').toMatchObject({ status: 'SENT', paidAt: null });

    // (b) Paid, part-credited, half refunded, the note voided: PARTIALLY_PAID, no paidAt.
    const b = await seedInvoice('rc_part', 'PAID');
    const paidAtB = (await invoiceRow(b)).paidAt;
    const noteB = await createNote(b, 30);
    expect((await applyNote(noteB.id)).status).toBe(201);
    await expect(refundPayment(b, 50, 'rf_half')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    await putBackStalePaidAt(b, paidAtB);
    expect((await voidNote(noteB.id)).status).toBe(201);
    // RED-BEFORE (W3 base ca12b6f5): PARTIALLY_PAID with the stale paidAt.
    expect(await invoiceRow(b), 'reopened to PARTIALLY_PAID: no paidAt (D-14)').toMatchObject({ status: 'PARTIALLY_PAID', paidAt: null });

    // (c) D-78: a credited status is not PAID. Once the money went back, crediting the rest leaves no paidAt either.
    const c = await seedInvoice('rc_full', 'PAID');
    const paidAtC = (await invoiceRow(c)).paidAt;
    const noteC30 = await createNote(c, 30);
    expect((await applyNote(noteC30.id)).status).toBe(201);
    await expect(refundPayment(c, TOTAL, 'rf_all')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    await putBackStalePaidAt(c, paidAtC);
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
    // W4-CREDIT-REFUND-PAIDAT review CR-REG-1: paths A-C put the refunded payment's paidAt back after the refund
    // (putBackStalePaidAt), so the credit move meets a stale paidAt: A and C prove the clear on the unchanged-status
    // branch of reconcileFromCredits, B the status move's { paidAt: null } (with those clears removed, A-C fail).
    // Path A: paid, part-credited 30, refunded in full, then credited 20 more: PARTIALLY_CREDITED -> PARTIALLY_CREDITED.
    const a = await seedInvoice('rc_same_a', 'PAID');
    const paidAtA = (await invoiceRow(a)).paidAt;
    const noteA30 = await createNote(a, 30);
    expect((await applyNote(noteA30.id)).status).toBe(201);
    await expect(refundPayment(a, TOTAL, 'rf_all')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    await putBackStalePaidAt(a, paidAtA);
    const noteA20 = await createNote(a, 20);
    expect((await applyNote(noteA20.id)).status).toBe(201);
    // RED-BEFORE (pkt/W3-CREDIT-RECONCILE-BIND f38160e9): the status did not move, so the early return kept the refunded payment's paidAt.
    expect(await invoiceRow(a), 'apply, status unchanged, nothing settles: no paidAt').toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });

    // Path B: the same money position (credited 50 of 100, the 100 refunded) reached through FULLY_CREDITED.
    const b = await seedInvoice('rc_same_b', 'PAID');
    const paidAtB = (await invoiceRow(b)).paidAt;
    const noteB30 = await createNote(b, 30);
    expect((await applyNote(noteB30.id)).status).toBe(201);
    await expect(refundPayment(b, TOTAL, 'rf_all')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    await putBackStalePaidAt(b, paidAtB);
    const noteB70 = await createNote(b, 70);
    expect((await applyNote(noteB70.id)).status).toBe(201);
    expect(await invoiceRow(b), 'path B, FULLY_CREDITED, nothing received net: no paidAt').toMatchObject({ status: 'FULLY_CREDITED', paidAt: null });
    expect((await voidNote(noteB70.id)).status).toBe(201);
    const noteB20 = await createNote(b, 20);
    expect((await applyNote(noteB20.id)).status).toBe(201);
    const rowA = await invoiceRow(a);
    const rowB = await invoiceRow(b);
    expect(rowB, 'path B').toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });
    expect({ status: rowA.status, paidAt: rowA.paidAt }, 'one money position, one paidAt').toEqual({ status: rowB.status, paidAt: rowB.paidAt });

    // A void that leaves the invoice PARTIALLY_CREDITED clears it the same way.
    const c = await seedInvoice('rc_same_c', 'PAID');
    const paidAtC = (await invoiceRow(c)).paidAt;
    const noteC30 = await createNote(c, 30);
    expect((await applyNote(noteC30.id)).status).toBe(201);
    const noteC20 = await createNote(c, 20);
    expect((await applyNote(noteC20.id)).status).toBe(201);
    await expect(refundPayment(c, TOTAL, 'rf_all')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    await putBackStalePaidAt(c, paidAtC);
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

  // W4-CREDIT-REFUND-PAIDAT: CRB-CR-1, the refund door's half of CR-V44-2 (reconcileCreditedFromPayments).
  it('CRB-CR-1 W4-CREDIT-REFUND-PAIDAT CR-V44-2 (D-14, D-78), refund half: a refund that unsettles a credited invoice clears its paidAt at the refund, by the rule reconcileFromCredits uses (kept only while its own payment rows net of refunds settle the total); the status stays credited (D-78), one money position ends with one paidAt whatever the path, and a reconcile that leaves the payments settling the total keeps it', async () => {
    // (a) The todo's case: PAID, part-credited 30 (paidAt kept, CN-06), then refunded in full.
    const a = await seedInvoice('rr_all', 'PAID');
    const paidAtA = (await invoiceRow(a)).paidAt;
    expect(paidAtA).not.toBeNull();
    const noteA = await createNote(a, 30);
    expect((await applyNote(noteA.id)).status).toBe(201);
    expect(await invoiceRow(a)).toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: paidAtA });
    await expect(refundPayment(a, TOTAL, 'rf_all')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    // RED-BEFORE (pkt/W4-TRASH-D46-repair c77fca7e): PARTIALLY_CREDITED still carrying the refunded payment's paidAt.
    expect(await invoiceRow(a), 'refunded in full: credited status kept (D-78), no paidAt (D-14)').toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });

    // (b) A part refund within what the credit leaves owing (50 of 100 back, 30 credited): no paidAt either.
    const b = await seedInvoice('rr_half', 'PAID');
    const noteB = await createNote(b, 30);
    expect((await applyNote(noteB.id)).status).toBe(201);
    await expect(refundPayment(b, 50, 'rf_half')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    expect(await invoiceRow(b), 'part refunded: no paidAt').toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });

    // (c) A refund the reconcile keeps although it leaves more received than the credit leaves owing ('keep':
    //     90 net of 100, 30 credited): the payments no longer settle the total, so no paidAt.
    const c = await seedInvoice('rr_keep', 'PAID');
    const noteC = await createNote(c, 30);
    expect((await applyNote(noteC.id)).status).toBe(201);
    await expect(refundPayment(c, 10, 'rf_ten')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    expect(await invoiceRow(c), "kept under 'keep': no paidAt").toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });

    // (d) FULLY_CREDITED after its payment (paidAt kept by the credit move), then refunded in full.
    const d = await seedInvoice('rr_full', 'PAID');
    const paidAtD = (await invoiceRow(d)).paidAt;
    const noteD = await createNote(d, TOTAL);
    expect((await applyNote(noteD.id)).status).toBe(201);
    expect(await invoiceRow(d)).toMatchObject({ status: 'FULLY_CREDITED', paidAt: paidAtD });
    await expect(refundPayment(d, TOTAL, 'rf_all')).resolves.toMatchObject({ status: 'FULLY_CREDITED', changed: false });
    // RED-BEFORE (pkt/W4-TRASH-D46-repair c77fca7e): FULLY_CREDITED with the refunded payment's paidAt.
    expect(await invoiceRow(d), 'FULLY_CREDITED, nothing received net: no paidAt').toMatchObject({ status: 'FULLY_CREDITED', paidAt: null });

    // (e) One money position (paid 100, 30 back, credited 30), two paths: refund after the credit, or before it.
    const e1 = await seedInvoice('rr_path_credit_first', 'PAID');
    const noteE1 = await createNote(e1, 30);
    expect((await applyNote(noteE1.id)).status).toBe(201);
    await expect(refundPayment(e1, 30, 'rf_thirty')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    const e2 = await seedInvoice('rr_path_refund_first', 'PAID');
    await expect(refundPayment(e2, 30, 'rf_thirty')).resolves.toMatchObject({ status: 'PARTIALLY_PAID', changed: true });
    const noteE2 = await createNote(e2, 30);
    expect((await applyNote(noteE2.id)).status).toBe(201);
    const rowE1 = await invoiceRow(e1);
    const rowE2 = await invoiceRow(e2);
    expect(rowE2, 'refund first (D-14 clears it), then the credit').toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });
    // RED-BEFORE (pkt/W4-TRASH-D46-repair c77fca7e): the credit-first path kept the paidAt of the payment partly refunded.
    expect({ status: rowE1.status, paidAt: rowE1.paidAt }, 'one money position, one paidAt').toEqual({ status: rowE2.status, paidAt: rowE2.paidAt });

    // (f) Control: a reconcile under 'keep' (as the refund doors run it) that leaves the invoice's own payment
    //     settling the total keeps the paidAt; a REFUNDED row tagged with another business is not this invoice's
    //     money (RC-DEP-2) and unsettles nothing. (Without 'keep' this over-settled invoice, 100 received and 30
    //     credited, is refused 409 as before: CN-16.)
    const f = await seedInvoice('rr_kept', 'PAID');
    const paidAtF = (await invoiceRow(f)).paidAt;
    const noteF = await createNote(f, 30);
    expect((await applyNote(noteF.id)).status).toBe(201);
    await db.payment.create({
      data: {
        id: `${f}_foreign_refund`,
        amount: -TOTAL,
        currency: 'TTD',
        status: 'REFUNDED',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_rr_kept_foreign_refund`,
        businessId: ID.bizF,
        invoiceId: f,
      },
    });
    emitted.length = 0;
    await expect(workflow.reconcileFromPayments(f, { onIllegalTransition: 'keep' })).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    expect(await invoiceRow(f), 'still settled by its own payment: paidAt kept').toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: paidAtF });
    expect(emitted.filter((ev) => ev.name.startsWith('invoice.')), 'no status move, no invoice event').toEqual([]);
    await expectBalanced(ID.biz);
  });

  // W5-REFUND-DOORS-KEEP: the W4-CREDIT-REFUND-PAIDAT review todo SEC-CRP-1 / CR-REG-2 (payments.service.ts).
  // Reproduced at the todo: paid 100, credited 30, a committed REFUNDED -10 row, then reconcileFromPayments(inv) with no
  // options (as processStripeRefund ran it) rejected 409 '... still owes after its credit notes (70 owed)' and the row
  // stayed PARTIALLY_CREDITED with its paidAt; refundPayment (the manual door, 'keep') ends the same position with none
  // (CRB-CR-1 (c)). Here the provider doors themselves run: the original is written by the provider's own delivery
  // (processStripeChargeOrSession, processPaypalCaptureCompleted: recordedBy null, the provider's id), the refund by the
  // provider refund door, whose reconcile runs after its refund transaction commits.
  it("CRP-1 SEC-CRP-1 / CR-REG-2 W5-REFUND-DOORS-KEEP CR-V44-2 (D-14, D-78), provider refund doors: a Stripe or PayPal refund webhook on a credited invoice that leaves more received than its credits leave owing (paid 100, credited 30 or 100, 10 refunded) clears its paidAt as the manual refund door does; processStripeRefund and processPaypalRefund reconcile under onIllegalTransition 'keep', so reconcileCreditedFromPayments keeps the credited status (D-78) and re-derives the paidAt (D-14) instead of refusing 409, and one money position ends with one paidAt whatever the door", async () => {
    /** A 100 invoice paid in full by the provider's own delivery, then `credited` applied (the paidAt kept, CN-06). */
    async function providerPaidAndCredited(key: string, provider: 'stripe' | 'paypal', credited: number) {
      const inv = await seedInvoice(key, 'SENT');
      if (provider === 'stripe') {
        await paymentsSvc.processStripeChargeOrSession(
          'payment_intent.succeeded',
          { id: `${P}pi_${key}`, amount_received: 10000, currency: 'ttd', latest_charge: `${P}ch_${key}`, metadata: { invoiceId: inv } },
          `${P}evt_${key}`,
        );
      } else {
        await paymentsSvc.processPaypalCaptureCompleted({ id: `${P}CAP_${key}`, custom_id: inv, amount: { value: '100.00', currency_code: 'TTD' } });
      }
      const [original] = await db.payment.findMany({ where: { invoiceId: inv } });
      expect(original, `${key}: the provider's own row`).toMatchObject({ provider, status: 'SUCCESSFUL', recordedBy: null });
      expect(Number(original.amount), `${key}: 100 received`).toBe(TOTAL);
      const paid = await invoiceRow(inv);
      expect(paid.status, `${key}: paid in full`).toBe('PAID');
      expect(paid.paidAt, `${key}: stamped`).not.toBeNull();
      const note = await createNote(inv, credited);
      expect((await applyNote(note.id)).status).toBe(201);
      const status = credited < TOTAL ? 'PARTIALLY_CREDITED' : 'FULLY_CREDITED';
      expect(await invoiceRow(inv), `${key}: credited with its payment in place, paidAt kept (CN-06)`).toMatchObject({ status, paidAt: paid.paidAt });
      emitted.length = 0;
      return { inv, original };
    }

    /**
     * D-78 (W5-REFUND-DOORS-KEEP review SEC-W5RDK-1 / CR-RDK-1): a credited status is kept, so the door moves no status
     * and emits no invoice event. Asserted at the end of each door's sub-case: the next providerPaidAndCredited (and
     * seedInvoice) clears the recorder, so a single check after the last door would see only that door's events.
     */
    function expectNoInvoiceEvent(door: string) {
      expect(emitted.filter((ev) => ev.name.startsWith('invoice.')), `${door}: a credited status is kept, no status move, no invoice event`).toEqual([]);
    }

    /** The refund row the door committed: -10, REFUNDED, linked to the original (V1-29c). */
    async function expectRefundRow(inv: string, original: any) {
      const refunds = await db.payment.findMany({ where: { invoiceId: inv, status: 'REFUNDED' } });
      expect(refunds.map((r: any) => [Number(r.amount), r.reference, r.businessId]), 'one refund row of 10, linked to its payment').toEqual([
        [-10, original.providerPaymentId, ID.biz],
      ]);
    }

    // (a) Stripe refund.created (the Refund object) on PARTIALLY_CREDITED: 90 received net, 70 owed after the credit.
    const a = await providerPaidAndCredited('crp_stripe_part', 'stripe', 30);
    await paymentsSvc.processStripeRefund(
      'refund.created',
      { id: `${P}re_crp_stripe_part`, amount: 1000, currency: 'ttd', charge: `${P}ch_crp_stripe_part`, payment_intent: `${P}pi_crp_stripe_part`, status: 'succeeded' },
      ID.biz,
    );
    await expectRefundRow(a.inv, a.original);
    // RED-BEFORE (base db5656e7): PARTIALLY_CREDITED still carrying the refunded payment's paidAt (the reconcile refused 409, swallowed).
    expect(await invoiceRow(a.inv), "Stripe door, kept under 'keep': credited status kept (D-78), no paidAt (D-14)").toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });
    expectNoInvoiceEvent('(a) Stripe refund.created on PARTIALLY_CREDITED');

    // (b) PayPal refund naming its capture, the same position.
    const b = await providerPaidAndCredited('crp_paypal_part', 'paypal', 30);
    const paypalPartRefund = {
      id: `${P}RF_crp_paypal_part`,
      amount: { value: '10.00', currency_code: 'TTD' },
      supplementary_data: { related_ids: { capture_id: `${P}CAP_crp_paypal_part` } },
    };
    await paymentsSvc.processPaypalRefund(paypalPartRefund);
    await expectRefundRow(b.inv, b.original);
    // RED-BEFORE (base db5656e7): PARTIALLY_CREDITED with the stale paidAt.
    expect(await invoiceRow(b.inv), "PayPal door (by capture), kept under 'keep': no paidAt").toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });
    expectNoInvoiceEvent('(b) PayPal refund by capture on PARTIALLY_CREDITED');

    // (c) Stripe charge.refunded with no refunds.data (the charge's cumulative amount_refunded) on FULLY_CREDITED: 90 net, 0 owed.
    const c = await providerPaidAndCredited('crp_stripe_full', 'stripe', TOTAL);
    await paymentsSvc.processStripeRefund(
      'charge.refunded',
      { id: `${P}ch_crp_stripe_full`, payment_intent: `${P}pi_crp_stripe_full`, amount_refunded: 1000, currency: 'ttd' },
      ID.biz,
    );
    await expectRefundRow(c.inv, c.original);
    // RED-BEFORE (base db5656e7): FULLY_CREDITED with the stale paidAt.
    expect(await invoiceRow(c.inv), "Stripe door (cumulative), over-settled FULLY_CREDITED kept under 'keep': no paidAt").toMatchObject({ status: 'FULLY_CREDITED', paidAt: null });
    expectNoInvoiceEvent('(c) Stripe charge.refunded on FULLY_CREDITED');

    // (d) PayPal refund naming no capture (createRefundWithPostingByInvoice, resolved by custom_id) on FULLY_CREDITED.
    const d = await providerPaidAndCredited('crp_paypal_full', 'paypal', TOTAL);
    await paymentsSvc.processPaypalRefund({ id: `${P}RF_crp_paypal_full`, custom_id: d.inv, amount: { value: '10.00', currency_code: 'TTD' } });
    await expectRefundRow(d.inv, d.original);
    // RED-BEFORE (base db5656e7): FULLY_CREDITED with the stale paidAt.
    expect(await invoiceRow(d.inv), "PayPal door (by invoice), over-settled FULLY_CREDITED kept under 'keep': no paidAt").toMatchObject({ status: 'FULLY_CREDITED', paidAt: null });
    expectNoInvoiceEvent('(d) PayPal refund by invoice on FULLY_CREDITED');

    // (e) One money position (paid 100, credited 30, 10 back), three doors: the manual door ends it as the provider doors do.
    const m = await seedInvoice('crp_manual', 'PAID');
    const noteM = await createNote(m, 30);
    expect((await applyNote(noteM.id)).status).toBe(201);
    emitted.length = 0;
    await expect(refundPayment(m, 10, 'rf_ten')).resolves.toMatchObject({ status: 'PARTIALLY_CREDITED', changed: false });
    expectNoInvoiceEvent('(e) manual refund door on PARTIALLY_CREDITED');
    const rowM = await invoiceRow(m);
    for (const [door, inv] of [['Stripe', a.inv], ['PayPal', b.inv]] as const) {
      const row = await invoiceRow(inv);
      expect({ status: row.status, paidAt: row.paidAt }, `${door} door and the manual door: one money position, one paidAt`).toEqual({ status: rowM.status, paidAt: rowM.paidAt });
    }

    // A redelivery records nothing more and moves nothing (the door's dedupe on the refund id).
    emitted.length = 0;
    await paymentsSvc.processPaypalRefund(paypalPartRefund);
    await expectRefundRow(b.inv, b.original);
    expect(await invoiceRow(b.inv)).toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });
    expectNoInvoiceEvent('PayPal redelivery');
    await expectBalanced(ID.biz);
  });
});

/**
 * W4-CREDIT-AWARE-READERS (the V1-44 review todo CR-V44-1, reader half; owner
 * rulings D-13, D-28, D-75, D-78). The workflow half (reconcileCreditedFromPayments)
 * already let a PARTIALLY_CREDITED invoice collect what its APPLIED credit notes
 * leave owing; the readers did not net those notes, so PARTIALLY_CREDITED was kept
 * off the share surfaces and mark-paid (which recorded total - paid) was refused
 * 409 (CN-16) rather than collecting the credited part again.
 *
 * A second app on the same database: CommerceController + PaymentsController
 * behind the real AuthGuard, BusinessGuard, ModuleScopeGuard and
 * PublicRateLimitGuard (real Redis, its keys namespaced to this suite's prefix)
 * and the global TenantInterceptor and GlobalHttpExceptionFilter; the real
 * CommerceService, PaymentsService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService and ChartOfAccountsSeederService. CRM,
 * timeline, stats, subscriptions and the AI / Drive collaborators are stubs off
 * the money path. Payments are recorded through the operator route and credits
 * through the credit-note routes of the first app.
 */
describe('W4-CREDIT-AWARE-READERS CR-V44-1 reader half (D-13, D-75, D-78): the share surfaces, the token pay link and mark-paid net the APPLIED credit notes', () => {
  let commerceApp: any;
  let redis: any;
  const previousRateLimitNs = process.env.RATE_LIMIT_KEY_NAMESPACE;

  async function clearRateLimits() {
    if (!redis) return;
    const keys: string[] = await redis.keys(`pub_rate_limit:${P}:*`);
    if (keys.length) await redis.del(...keys);
  }

  beforeAll(async () => {
    process.env.RATE_LIMIT_KEY_NAMESPACE = P;
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
    const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
    const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
    const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
    const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
    const { CommerceService } = await import('../src/modules/commerce/commerce.service');
    const { PaymentsController } = await import('../src/modules/payments/payments.controller');
    const { PaymentsService } = await import('../src/modules/payments/payments.service');
    const { CommerceStatsService } = await import('../src/modules/commerce/commerce-stats.service');
    const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
    const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
    const { GmailService } = await import('../src/modules/commerce/gmail.service');
    const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
    const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
    const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
    const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');
    const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
    const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
    const { CatalogService } = await import('../src/modules/catalog/catalog.service');
    const { PublicEventsService } = await import('../src/modules/public-events/public-events.service');
    const { CrmService } = await import('../src/modules/crm/crm.service');
    const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
    const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
    const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
    const { PostingService } = await import('../src/modules/finance/posting.service');
    const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
    const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
    const { TimelineService } = await import('../src/modules/timeline/timeline.service');

    redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });
    const moduleRef = await Test.createTestingModule({
      controllers: [CommerceController, PaymentsController],
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
        PaymentsService,
        InvoiceWorkflowService,
        InvoiceReceiptBuilderService,
        RevenuePostingService,
        PostingService,
        ChartOfAccountsSeederService,
        // COGS: no fixture invoice carries a product line, so nothing is sold.
        { provide: ExpensePostingService, useValue: { onProductSold: async () => null } },
        { provide: EventEmitter2, useValue: recorder },
        { provide: CrmService, useValue: { logContactEvent: async () => null } },
        { provide: EvidenceService, useValue: {} },
        { provide: TaskAssignmentService, useValue: {} },
        { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
        { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
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
    commerceApp = moduleRef.createNestApplication();
    // Identity attachment only. No guard is overridden.
    commerceApp.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    commerceApp.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
    commerceApp.useGlobalFilters(new GlobalHttpExceptionFilter());
    commerceApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await commerceApp.init();
    await clearRateLimits();
  }, 180_000);

  afterAll(async () => {
    if (commerceApp) await commerceApp.close();
    if (redis) {
      try { await clearRateLimits(); } catch { /* best-effort */ }
      await redis.quit();
    }
    if (previousRateLimitNs === undefined) delete process.env.RATE_LIMIT_KEY_NAMESPACE;
    else process.env.RATE_LIMIT_KEY_NAMESPACE = previousRateLimitNs;
  });

  const c = () => request(commerceApp.getHttpServer());
  /** The bare-id public read, anonymous (getInvoiceForViewer's projection branch). */
  const publicView = (inv: string) => c().get(`/commerce/invoices/${inv}`);
  /** The customer pay page's read (/pay/link/[token]). */
  const payPage = (token: string) => c().get(`/commerce/public/invoice-link/${encodeURIComponent(token)}/pay`);
  /** The public token view (/public/invoice/[token]): the invoice block plus `balance`. */
  const tokenView = (token: string) => c().get(`/commerce/public/invoice-link/${encodeURIComponent(token)}`);
  const intent = (token: string, body: Record<string, unknown>) =>
    c().post(`/commerce/public/invoice-link/${encodeURIComponent(token)}/payment-intent`).send(body);
  const tokenStatus = (token: string) => c().get(`/payments/public/invoice-link/${encodeURIComponent(token)}/status`);
  const tokenGateways = (token: string) => c().get(`/payments/public/invoice-link/${encodeURIComponent(token)}/gateways`);
  const tokenCheckout = (token: string) =>
    c().post(`/payments/public/invoice-link/${encodeURIComponent(token)}/checkout`).send({ gateway: 'wipay', returnUrl: 'https://example.test/return' });
  const markPaid = (inv: string, actor = ID.owner) => c().patch(`/commerce/invoices/${inv}/paid`).set(HEADER, actor).send({ businessId: ID.biz });
  const recordPaymentRoute = (inv: string, amount: number, key: string) =>
    c().post(`/commerce/businesses/${ID.biz}/invoices/${inv}/payments`).set(HEADER, ID.owner).send({ amount, method: 'cash', idempotencyKey: `${P}${key}` });
  const createLink = (inv: string) => c().post(`/commerce/businesses/${ID.biz}/invoices/${inv}/payment-link`).set(HEADER, ID.owner).send({});

  async function paymentsOf(invoiceId: string): Promise<any[]> {
    return db.payment.findMany({ where: { invoiceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  /** A 100 invoice with a live pay link, `paid` recorded through the operator route, then `credited` applied. */
  async function seedCreditedWithLink(key: string, paid: number, credited: number): Promise<{ inv: string; token: string }> {
    const inv = await seedInvoice(key, 'SENT');
    const link = await createLink(inv);
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    if (paid > 0) {
      const res = await recordPaymentRoute(inv, paid, `${key}_pay`);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const note = await createNote(inv, credited);
    expect((await applyNote(note.id)).status).toBe(201);
    emitted.length = 0;
    return { inv, token: link.body.token };
  }

  let A: { inv: string; token: string };

  it("CN-32 RED-BEFORE W4-CREDIT-AWARE-READERS CR-V44-1 (D-13, D-75): a 100 invoice with 20 paid and 30 credited shows 50 due on the bare-id public view, the token pay page and the token view; another business's APPLIED note and payment on it move nothing; W5-CREDIT-AWARE-PAY: the token status poll states the same 50 due and the 30 credited", async () => {
    A = await seedCreditedWithLink('cr_readers', 20, 30);
    expect((await invoiceRow(A.inv)).status).toBe('PARTIALLY_CREDITED');

    // RED-BEFORE (pkt/W4-CREDIT-REFUND-PAIDAT-repair 18014bef): 404, PARTIALLY_CREDITED was not shareable.
    const view = await publicView(A.inv);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body).toMatchObject({ status: 'PARTIALLY_CREDITED', total: TOTAL, paid: 20, remaining: 50 });
    const page = await payPage(A.token);
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(page.body).toMatchObject({ status: 'PARTIALLY_CREDITED', total: TOTAL, paid: 20, remaining: 50 });
    expect(page.body.id, 'the token read carries no invoice id (V1-46b)').toBeUndefined();
    const tv = await tokenView(A.token);
    expect(tv.status).toBe(200);
    expect(tv.body, JSON.stringify(tv.body)).toMatchObject({ ok: true, invoice: { status: 'PARTIALLY_CREDITED', total: TOTAL } });
    expect(tv.body.balance).toEqual({ amountPaid: 20, amountDue: 50, paidAt: null });

    // D-75: another business's APPLIED credit note and SUCCESSFUL payment naming this invoice are not its money.
    await db.creditNote.create({
      data: {
        id: `${P}cn_foreign_cr_readers`,
        businessId: ID.bizF,
        invoiceId: A.inv,
        creditNoteNumber: `${P}CN-F-READERS`,
        status: 'APPLIED',
        amount: 10,
        appliedAt: new Date(),
      },
    });
    await db.payment.create({
      data: {
        id: `${P}pay_foreign_cr_readers`,
        amount: 10,
        currency: 'TTD',
        status: 'SUCCESSFUL',
        provider: 'cash',
        method: 'cash',
        providerPaymentId: `${P}pp_foreign_cr_readers`,
        businessId: ID.bizF,
        invoiceId: A.inv,
      },
    });
    expect((await publicView(A.inv)).body, 'own-tenant rows only').toMatchObject({ paid: 20, remaining: 50 });
    expect((await payPage(A.token)).body).toMatchObject({ paid: 20, remaining: 50 });
    expect((await tokenView(A.token)).body.balance).toEqual({ amountPaid: 20, amountDue: 50, paidAt: null });

    // W5-CREDIT-AWARE-PAY (CR-V44-1 rest; D-13, D-75): the token status poll behind payLinkInvoice was
    // closed 404 for a credited invoice (its reader was credit-unaware). It now states the figures the
    // share views state, from the own-tenant rows and notes only. The checkouts: the describe below.
    const poll = await tokenStatus(A.token);
    expect(poll.status, JSON.stringify(poll.body)).toBe(200);
    expect(poll.body).toMatchObject({ status: 'PARTIALLY_CREDITED', paid: 20, remaining: 50, credited: 30, currency: 'TTD' });
    expect(await db.payment.count({ where: { invoiceId: A.inv, businessId: ID.biz } }), 'only the operator payment').toBe(1);
  });

  it('CN-33 RED-BEFORE W4-CREDIT-AWARE-READERS CR-V44-1: the token offline intent is accepted on the PARTIALLY_CREDITED invoice and capped at the 50 its credits leave owing; no status move, no posting', async () => {
    const before = await ledgerCounts(ID.biz);
    // RED-BEFORE (18014bef): 404, PARTIALLY_CREDITED was not in INTENT_PAYABLE_STATUSES.
    const res = await intent(A.token, { method: 'bank_transfer', amount: 80 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ success: true, method: 'bank_transfer' });
    const pending = (await paymentsOf(A.inv)).filter((p) => p.status === 'PENDING' && p.businessId === ID.biz);
    expect(pending.map((p) => Number(p.amount)), 'capped at the remainder net of credits').toEqual([50]);
    expect((await invoiceRow(A.inv)).status).toBe('PARTIALLY_CREDITED');
    expect(await ledgerCounts(ID.biz), 'an intent posts nothing').toEqual(before);
    expect((await publicView(A.inv)).body, 'a PENDING intent is not money received').toMatchObject({ paid: 20, remaining: 50 });
  });

  it('CN-34 RED-BEFORE W4-CREDIT-AWARE-READERS CR-V44-1 (D-78): mark-paid records exactly the 50 the credits leave owing and leaves the invoice PARTIALLY_CREDITED with the receivable at 0; then 0 is due, the intent is 409 and a second mark-paid writes nothing', async () => {
    const before = await paymentsOf(A.inv);
    // RED-BEFORE (18014bef): 409; mark-paid tried to record the credit-unaware 80 and the reconcile refused it.
    const res = await markPaid(A.inv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status, 'D-78: paying the remainder leaves it PARTIALLY_CREDITED').toBe('PARTIALLY_CREDITED');

    const added = (await paymentsOf(A.inv)).filter((p) => !before.some((b) => b.id === p.id));
    expect(added, 'one mark-paid payment').toHaveLength(1);
    const [mp] = added;
    expect({ amount: Number(mp.amount), status: mp.status, businessId: mp.businessId, recordedBy: mp.recordedBy }).toEqual({
      amount: 50, // not 40: the foreign note is not this invoice's credit (D-75)
      status: 'SUCCESSFUL',
      businessId: ID.biz,
      recordedBy: ID.owner,
    });
    expect(mp.providerPaymentId).toMatch(new RegExp(`^manual_${A.inv}_markpaid_[0-9a-f]{32}$`));
    const posting = await db.financialTransaction.findMany({ where: { sourceType: 'Payment', sourceId: mp.id } });
    expect(posting.map((t: any) => t.externalRef), 'its posting').toEqual([`Payment:${mp.id}:payment_recorded`]);
    expect(await invoiceRow(A.inv)).toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });
    expect(emitted.filter((e) => e.name === 'invoice.paid'), 'no invoice.paid: the invoice is not PAID').toEqual([]);

    // Nothing is due any more on any share surface (own-tenant rows: 20 + 50 paid, 30 credited).
    expect((await publicView(A.inv)).body).toMatchObject({ status: 'PARTIALLY_CREDITED', paid: 70, remaining: 0 });
    expect((await payPage(A.token)).body).toMatchObject({ paid: 70, remaining: 0 });
    expect((await tokenView(A.token)).body.balance).toEqual({ amountPaid: 70, amountDue: 0, paidAt: null });
    const settled = await intent(A.token, { method: 'cash', amount: 5 });
    expect(settled.status, JSON.stringify(settled.body)).toBe(409);

    // A second mark-paid has nothing to collect: the invoice as it is, nothing written.
    const counts = await ledgerCounts(ID.biz);
    const again = await markPaid(A.inv);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.status).toBe('PARTIALLY_CREDITED');
    expect(await db.payment.count({ where: { invoiceId: A.inv, status: 'SUCCESSFUL', businessId: ID.biz } })).toBe(2);
    expect(await ledgerCounts(ID.biz)).toEqual(counts);

    // The ledger, once the foreign rows (not this invoice's money) are gone: credited 30 + received 70 = 100.
    await db.creditNote.delete({ where: { id: `${P}cn_foreign_cr_readers` } });
    await db.payment.delete({ where: { id: `${P}pay_foreign_cr_readers` } });
    expect(await ledgerOf(A.inv)).toEqual({ receivable: 0, revenue: 70, credited: 30 });
    await expectBalanced(ID.biz);
  });

  it('CN-35 W4-CREDIT-AWARE-READERS CR-V44-1: a FULLY_CREDITED invoice stays unpayable: mark-paid 409 with nothing written; the share surfaces, the intent and the token money routes answer 404', async () => {
    const F = await seedCreditedWithLink('cr_full', 0, TOTAL);
    expect((await invoiceRow(F.inv)).status).toBe('FULLY_CREDITED');
    const before = await ledgerCounts(ID.biz);
    const res = await markPaid(F.inv);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(await db.payment.count({ where: { invoiceId: F.inv } }), 'no payment').toBe(0);
    expect(await ledgerCounts(ID.biz), 'no posting').toEqual(before);
    expect(await invoiceRow(F.inv)).toMatchObject({ status: 'FULLY_CREDITED', paidAt: null });

    expect((await publicView(F.inv)).status).toBe(404);
    expect((await payPage(F.token)).status).toBe(404);
    expect((await tokenView(F.token)).body).toMatchObject({ ok: false });
    expect((await intent(F.token, { method: 'cash', amount: 10 })).status).toBe(404);
    for (const r of [await tokenStatus(F.token), await tokenGateways(F.token), await tokenCheckout(F.token)]) {
      expect(r.status, JSON.stringify(r.body)).toBe(404);
    }
    expect(await db.payment.count({ where: { invoiceId: F.inv } }), 'nothing written').toBe(0);
  });

  it('CN-36 SEC-CAR-1 W4-CREDIT-AWARE-READERS (D-78; ST-PL04-1 / CR-PL04-2): a credit-note void that commits between mark-paid reading a settled PARTIALLY_CREDITED invoice and its reload is answered 409, not 200 for an invoice that owes again; nothing written, and the retry collects what is owed', async () => {
    const { CommerceService } = await import('../src/modules/commerce/commerce.service');
    const inv = await seedInvoice('car1_race', 'SENT');
    expect((await recordPaymentRoute(inv, 70, 'car1_race_pay')).status).toBe(201);
    const note = await createNote(inv, 30);
    expect((await applyNote(note.id)).status).toBe(201);
    expect(await invoiceRow(inv)).toMatchObject({ status: 'PARTIALLY_CREDITED' });
    expect((await publicView(inv)).body, '70 paid + 30 credited: nothing owing').toMatchObject({ paid: 70, remaining: 0 });

    // The race, made deterministic: mark-paid's first invoice read (select) sees the settled
    // PARTIALLY_CREDITED row; its reload (the first findUnique carrying `include`) runs only after
    // a void of the APPLIED note has committed through the credit-note route.
    const svc: any = commerceApp.get(CommerceService);
    const realPrisma = svc.prisma;
    const realClient = realPrisma.client;
    let voided: any = null;
    const invoiceDelegate = new Proxy(realClient.invoice, {
      get(target: any, prop: string | symbol) {
        const value = Reflect.get(target, prop);
        if (prop !== 'findUnique') return typeof value === 'function' ? value.bind(target) : value;
        return async (args: any) => {
          if (!voided && args?.include) voided = await voidNote(note.id);
          return value.call(target, args);
        };
      },
    });
    const client = new Proxy(realClient, {
      get(target: any, prop: string | symbol) {
        if (prop === 'invoice') return invoiceDelegate;
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    svc.prisma = new Proxy(realPrisma, {
      get(target: any, prop: string | symbol) {
        return prop === 'client' ? client : Reflect.get(target, prop);
      },
    });
    const paymentsBefore = await paymentsOf(inv);
    let res: any;
    try {
      res = await markPaid(inv);
    } finally {
      svc.prisma = realPrisma;
    }
    expect(voided?.status, 'the void committed inside the window').toBe(201);
    expect((await noteRow(note.id)).status).toBe('VOID');

    // Packet head (1d863ecb): 200 with body.status PARTIALLY_PAID, the invoice owing 30 again.
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(JSON.stringify(res.body)).toContain('Invoice is PARTIALLY_PAID, not PAID; reload it and try again');
    expect((await paymentsOf(inv)).map((p) => p.id), 'nothing written').toEqual(paymentsBefore.map((p) => p.id));
    expect(await invoiceRow(inv)).toMatchObject({ status: 'PARTIALLY_PAID', paidAt: null });
    expect((await publicView(inv)).body).toMatchObject({ status: 'PARTIALLY_PAID', paid: 70, remaining: 30 });
    expect(emitted.filter((e) => e.name === 'invoice.paid'), 'no invoice.paid').toEqual([]);

    // Reloaded and asked again, mark-paid collects the 30 the void put back and the invoice is PAID.
    const retry = await markPaid(inv);
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.status).toBe('PAID');
    const added = (await paymentsOf(inv)).filter((p) => !paymentsBefore.some((b) => b.id === p.id));
    expect(added.map((p) => [Number(p.amount), p.status])).toEqual([[30, 'SUCCESSFUL']]);
    await expectBalanced(ID.biz);
  });

  it('CN-37 CR-AR-1 W4-CREDIT-AWARE-READERS (D-13, D-78; CR-PL04-1): mark-paid refuses a credited invoice whose refunds exceed its payments (net below zero) as it refuses an uncredited one: 409, nothing recorded beyond what the invoice owes', async () => {
    // Legacy or out-of-band rows (refundableOf caps the refunds today's writers make): 20 received,
    // 40 refunded, so the money received nets to -20. Written raw, as such rows would stand.
    const seedRows = async (inv: string, key: string) => {
      await db.payment.create({
        data: { id: `${P}pay_${key}_in`, amount: 20, currency: 'TTD', status: 'SUCCESSFUL', provider: 'cash', method: 'cash', providerPaymentId: `${P}pp_${key}_in`, businessId: ID.biz, invoiceId: inv },
      });
      await db.payment.create({
        data: { id: `${P}pay_${key}_out`, amount: -40, currency: 'TTD', status: 'REFUNDED', provider: 'cash', method: 'cash', providerPaymentId: `${P}pp_${key}_out`, businessId: ID.biz, invoiceId: inv },
      });
    };
    const refusal = 'Cannot mark an invoice paid after one of its payments was refunded';

    // Control: the same rows on an uncredited invoice are refused (the guard as it stood).
    const plain = await seedInvoice('car_ar1_plain', 'SENT');
    await seedRows(plain, 'car_ar1_plain');
    const control = await markPaid(plain);
    expect(control.status, JSON.stringify(control.body)).toBe(409);
    expect(JSON.stringify(control.body)).toContain(refusal);

    const inv = await seedInvoice('car_ar1', 'SENT');
    await seedRows(inv, 'car_ar1');
    const note = await createNote(inv, 30);
    expect((await applyNote(note.id)).status).toBe(201);
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_CREDITED');
    const counts = await ledgerCounts(ID.biz);

    // Packet head (1d863ecb): 200 with a 90 mark-paid payment, 20 more than the 70 the credit leaves owing.
    const res = await markPaid(inv);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(JSON.stringify(res.body)).toContain(refusal);
    expect((await paymentsOf(inv)).map((p) => [Number(p.amount), p.status]), 'nothing recorded').toEqual([
      [20, 'SUCCESSFUL'],
      [-40, 'REFUNDED'],
    ]);
    expect(await ledgerCounts(ID.biz), 'nothing posted').toEqual(counts);
    expect((await invoiceRow(inv)).status).toBe('PARTIALLY_CREDITED');
  });

  /**
   * W5-CREDIT-AWARE-PAY (the two W4-CREDIT-AWARE-READERS todos: CR-V44-1 rest and CR-AR-2's server half;
   * D-13, D-75, D-78): the token money routes behind payLinkInvoice (status poll, gateway list, checkout,
   * PayPal capture), the public receipt and every provider checkout read what the share views read: the
   * invoice's own-tenant payment rows net of its own APPLIED credit notes (creditAwareBalance over
   * appliedCreditsOf), in integer cents. A PARTIALLY_CREDITED invoice is payable for exactly its remainder
   * through every provider (the amount a provider is asked for is that remainder, never invoice.total),
   * the status poll and the receipt state the credit beside the remainder, and paying the remainder
   * leaves it PARTIALLY_CREDITED (D-78). A FULLY_CREDITED invoice stays closed on the token routes (404)
   * and every checkout door that reaches the payable gate refuses it 409 with no provider called.
   *
   * The providers are stubbed at the network edge as pay-link-token-gate stubs them: global fetch answers
   * Stripe's checkout-session endpoint and WiPay's gateway and refuses every other host, and the PayPal
   * SDK client is replaced on the PaymentsService instance; nothing leaves the process.
   */
  describe('W5-CREDIT-AWARE-PAY CR-V44-1 rest, CR-AR-2 (D-13, D-75, D-78): the token pay link, the status poll, the public receipt and every provider checkout net the APPLIED credit notes', () => {
    const PROVIDER_ENV: Record<string, string> = {
      STRIPE_SECRET_KEY: `${P}stripe_secret_fake`,
      STRIPE_PUBLISHABLE_KEY: `${P}stripe_publishable_fake`,
      STRIPE_WEBHOOK_SECRET: `${P}stripe_webhook_fake`,
      PUBLIC_URL_ALLOWLIST: 'https://pay.v44a.test',
      WIPAY_API_KEY: `${P}wipay_key_fake`,
      WIPAY_ACCOUNT_NUMBER: '4400000000',
      PAYPAL_CLIENT_ID: `${P}paypal_client_fake`,
      PAYPAL_CLIENT_SECRET: `${P}paypal_secret_fake`,
    };
    const previousEnv: Record<string, string | undefined> = {};
    const RETURN_URL = 'https://pay.v44a.test/pay/link/return';
    const STRIPE_BODY = { gateway: 'stripe', successUrl: `${RETURN_URL}?stripe=success`, cancelUrl: `${RETURN_URL}?stripe=cancel` };
    const WIPAY_BODY = { gateway: 'wipay', returnUrl: RETURN_URL };
    const PAYPAL_BODY = { gateway: 'paypal' };
    const realFetch = globalThis.fetch;
    const providerCalls: Array<{ url: string; body: string }> = [];
    let seq = 0;
    const paypalOrderBook = new Map<string, any[]>();
    const paypalOrders = {
      createOrder: vi.fn(async (req: any) => {
        const id = `${P}order_${++seq}`;
        paypalOrderBook.set(id, req?.body?.purchaseUnits ?? []);
        return { result: { id } };
      }),
      getOrder: vi.fn(async (req: { id: string }) => {
        const purchaseUnits = paypalOrderBook.get(req.id);
        if (!purchaseUnits) throw new Error(`V44A: the PayPal stub has no order ${req.id}`);
        return { result: { id: req.id, status: 'APPROVED', purchaseUnits } };
      }),
      captureOrder: vi.fn(async (req: { id: string }) => ({
        result: { id: req.id, status: 'COMPLETED', purchaseUnits: [{ payments: { captures: [{ id: `${P}cap_${req.id}` }] } }], payer: {} },
      })),
    };
    let paypalSpy: any;

    async function providerFetch(input: any, init?: any): Promise<Response> {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      providerCalls.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
      const { host, pathname } = new URL(url);
      if (host === 'api.stripe.com' && pathname === '/v1/checkout/sessions') {
        return new Response(JSON.stringify({ id: `${P}cs_${++seq}`, url: 'https://checkout.v44a.test/stripe' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (host.endsWith('wipayfinancial.com')) return new Response(null, { status: 302, headers: { location: 'https://checkout.v44a.test/wipay' } });
      throw new Error(`V44A: no network in this suite (refused ${url})`);
    }

    beforeAll(async () => {
      for (const [k, v] of Object.entries(PROVIDER_ENV)) {
        previousEnv[k] = process.env[k];
        process.env[k] = v;
      }
      globalThis.fetch = providerFetch as typeof fetch;
      const { PaymentsService } = await import('../src/modules/payments/payments.service');
      paypalSpy = vi.spyOn(commerceApp.get(PaymentsService) as any, 'getPaypalClient').mockImplementation(() => ({ client: {}, ordersController: paypalOrders }));
    });

    afterAll(() => {
      globalThis.fetch = realFetch;
      paypalSpy?.mockRestore();
      for (const [k, v] of Object.entries(previousEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    beforeEach(async () => {
      await clearRateLimits();
    });

    const checkout = (token: string, body: Record<string, unknown>) =>
      c().post(`/payments/public/invoice-link/${encodeURIComponent(token)}/checkout`).send(body);
    const capture = (token: string, orderId: string) =>
      c().post(`/payments/public/invoice-link/${encodeURIComponent(token)}/paypal/capture/${encodeURIComponent(orderId)}`).send({});
    const receipt = (token: string) => c().get(`/commerce/public/invoice-link/${encodeURIComponent(token)}/receipt`);
    const bareStatus = (inv: string) => c().get(`/payments/invoice/${encodeURIComponent(inv)}/status`);
    const bareCheckout = (inv: string) => c().post('/payments/create-checkout').send({ payableType: 'invoice', payableId: inv, ...STRIPE_BODY });
    const wipayCallback = (inv: string, txn: string, requested: number) =>
      c()
        .get('/payments/wipay/callback')
        .query({
          transaction_id: txn,
          order_id: inv,
          status: 'success',
          total: requested.toFixed(2),
          // WiPay's keyed proof: md5(transaction_id + the total this server requested + the API key) (V1-05, D-19).
          hash: createHash('md5').update(`${txn}${requested.toFixed(2)}${PROVIDER_ENV.WIPAY_API_KEY}`).digest('hex'),
        });
    const lastCall = (match: (url: string) => boolean) => providerCalls.filter((p) => match(p.url)).at(-1)!;
    const stripeAmount = () => new URLSearchParams(lastCall((u) => u.startsWith('https://api.stripe.com/')).body).get('line_items[0][price_data][unit_amount]');
    const wipayTotal = () => new URLSearchParams(lastCall((u) => u.includes('wipayfinancial.com')).body).get('total');

    it("CAP-01 RED-BEFORE W5-CREDIT-AWARE-PAY CR-V44-1 (D-13, D-75): a 100 invoice with 20 paid and 30 credited: the token status poll, the bare-id status poll and the receipt state 50 due and the 30 credited; the gateway list answers; the Stripe, WiPay and PayPal checkouts ask for 50, not 100; another business's note and payment on it move nothing; a checkout records nothing", async () => {
      const X = await seedCreditedWithLink('cap_due', 20, 30);
      expect((await invoiceRow(X.inv)).status).toBe('PARTIALLY_CREDITED');
      // D-75: another business's APPLIED note and SUCCESSFUL payment naming this invoice are not its money.
      await db.creditNote.create({
        data: { id: `${P}cn_foreign_cap_due`, businessId: ID.bizF, invoiceId: X.inv, creditNoteNumber: `${P}CN-F-CAP`, status: 'APPLIED', amount: 10, appliedAt: new Date() },
      });
      await db.payment.create({
        data: { id: `${P}pay_foreign_cap_due`, amount: 10, currency: 'TTD', status: 'SUCCESSFUL', provider: 'cash', method: 'cash', providerPaymentId: `${P}pp_foreign_cap_due`, businessId: ID.bizF, invoiceId: X.inv },
      });
      const ledgerBefore = await ledgerCounts(ID.biz);

      // Base (pkt/W5-REFUND-DOORS-KEEP-repair 693501ca): 404 on every token money route, 404 on the bare-id status poll and the receipt.
      const poll = await tokenStatus(X.token);
      expect(poll.status, JSON.stringify(poll.body)).toBe(200);
      expect(Object.keys(poll.body).sort()).toEqual(['credited', 'currency', 'lastPaymentAt', 'paid', 'remaining', 'status']);
      expect(poll.body).toMatchObject({ status: 'PARTIALLY_CREDITED', paid: 20, remaining: 50, credited: 30, currency: 'TTD' });
      const bare = await bareStatus(X.inv);
      expect(bare.status, JSON.stringify(bare.body)).toBe(200);
      expect(bare.body).toMatchObject({ status: 'PARTIALLY_CREDITED', paid: 20, remaining: 50, credited: 30 });
      const rc = await receipt(X.token);
      expect(rc.status, JSON.stringify(rc.body)).toBe(200);
      expect(rc.body).toMatchObject({ status: 'PARTIALLY_CREDITED', total: TOTAL, amountPaid: 20, credited: 30, amountDue: 50, paidAt: null });

      const gateways = await tokenGateways(X.token);
      expect(gateways.status, JSON.stringify(gateways.body)).toBe(200);
      expect(gateways.body.map((g: { id: string }) => g.id).sort()).toEqual(['paypal', 'stripe', 'wipay']);

      const stripe = await checkout(X.token, STRIPE_BODY);
      expect(stripe.status, JSON.stringify(stripe.body)).toBe(201);
      expect(stripeAmount(), 'Stripe is asked for the remainder net of credits, in cents').toBe('5000');
      const wipay = await checkout(X.token, WIPAY_BODY);
      expect(wipay.status, JSON.stringify(wipay.body)).toBe(201);
      expect(wipayTotal()).toBe('50.00');
      const paypal = await checkout(X.token, PAYPAL_BODY);
      expect(paypal.status, JSON.stringify(paypal.body)).toBe(201);
      expect(paypalOrderBook.get(paypal.body.orderId)).toEqual([expect.objectContaining({ customId: X.inv, amount: { currencyCode: 'TTD', value: '50.00' } })]);

      // A checkout records nothing: the provider's callback or the capture does.
      expect((await paymentsOf(X.inv)).filter((p) => p.businessId === ID.biz).map((p) => [Number(p.amount), p.status])).toEqual([[20, 'SUCCESSFUL']]);
      expect(await invoiceRow(X.inv)).toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });
      expect(await ledgerCounts(ID.biz), 'a checkout posts nothing').toEqual(ledgerBefore);
    });

    it('CAP-02 RED-BEFORE W5-CREDIT-AWARE-PAY CR-V44-1 (D-78): the WiPay callback for the 50 it was asked for records 50 and leaves the invoice PARTIALLY_CREDITED; its redelivery is a duplicate; then the poll and the receipt state 0 due beside the 30 credited, and every checkout of the settled invoice answers 409 with no provider called', async () => {
      const X = await seedCreditedWithLink('cap_wipay', 20, 30);
      const txn = `${P}wipay_tx_cap`;
      // Review SEC-CAP-1 / CR-CAP-1: the callback is verified against the amount the checkout asked WiPay for,
      // kept when it asked (not worked out again when the callback arrives), so the payer's checkout comes first.
      const asked = await checkout(X.token, WIPAY_BODY);
      expect(asked.status, JSON.stringify(asked.body)).toBe(201);
      expect(wipayTotal()).toBe('50.00');
      // Base: 400 'Invalid WiPay callback signature' (the proof was checked over the 100 total).
      const res = await wipayCallback(X.inv, txn, 50);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ success: true, invoiceId: X.inv, message: 'Payment successful' });
      expect((await paymentsOf(X.inv)).map((p) => [Number(p.amount), p.status, p.provider])).toEqual([
        [20, 'SUCCESSFUL', 'cash'],
        [50, 'SUCCESSFUL', 'wipay'],
      ]);
      expect(await invoiceRow(X.inv), 'D-78: paying the remainder leaves it PARTIALLY_CREDITED').toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });
      expect(emitted.filter((e) => e.name === 'invoice.paid'), 'no invoice.paid').toEqual([]);
      expect(await ledgerOf(X.inv)).toEqual({ receivable: 0, revenue: 70, credited: 30 });

      const again = await wipayCallback(X.inv, txn, 50);
      expect(again.body, 'the redelivery verifies against the same 50 and is deduplicated').toMatchObject({ success: true, message: 'Duplicate callback ignored' });
      expect(await db.payment.count({ where: { invoiceId: X.inv } })).toBe(2);

      expect((await tokenStatus(X.token)).body).toMatchObject({ status: 'PARTIALLY_CREDITED', paid: 70, remaining: 0, credited: 30 });
      expect((await receipt(X.token)).body).toMatchObject({ status: 'PARTIALLY_CREDITED', amountPaid: 70, credited: 30, amountDue: 0 });

      const calls = providerCalls.length;
      const orders = paypalOrders.createOrder.mock.calls.length;
      for (const body of [STRIPE_BODY, WIPAY_BODY, PAYPAL_BODY]) {
        await clearRateLimits();
        const settled = await checkout(X.token, body);
        expect(settled.status, `${body.gateway}: ${JSON.stringify(settled.body)}`).toBe(409);
        expect(settled.body.message).toBe('Invoice is already paid');
      }
      expect(providerCalls.length, 'no provider is called for a settled invoice').toBe(calls);
      expect(paypalOrders.createOrder.mock.calls.length).toBe(orders);
      await expectBalanced(ID.biz);
    });

    it("CAP-03 RED-BEFORE W5-CREDIT-AWARE-PAY CR-V44-1 (D-78): the token PayPal capture captures only the order made for the 50 the credits leave owing and records 50 (never invoice.total); an order for the whole 100 is refused 400 before PayPal captures anything", async () => {
      const X = await seedCreditedWithLink('cap_paypal', 20, 30);
      const whole = `${P}order_whole_total`;
      paypalOrderBook.set(whole, [{ customId: X.inv, referenceId: X.inv, amount: { currencyCode: 'TTD', value: TOTAL.toFixed(2) } }]);
      const captures = paypalOrders.captureOrder.mock.calls.length;
      const refused = await capture(X.token, whole);
      expect(refused.status, JSON.stringify(refused.body)).toBe(400);
      expect(refused.body.message).toBe('This PayPal order does not belong to this invoice');
      expect(paypalOrders.captureOrder.mock.calls.length, 'PayPal captured nothing').toBe(captures);

      await clearRateLimits();
      const order = await checkout(X.token, PAYPAL_BODY);
      expect(order.status, JSON.stringify(order.body)).toBe(201);
      await clearRateLimits();
      const res = await capture(X.token, order.body.orderId);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({ id: order.body.orderId, status: 'COMPLETED' });
      expect((await paymentsOf(X.inv)).map((p) => [Number(p.amount), p.status, p.provider])).toEqual([
        [20, 'SUCCESSFUL', 'cash'],
        [50, 'SUCCESSFUL', 'paypal'],
      ]);
      expect((await paymentsOf(X.inv)).find((p) => p.provider === 'paypal')!.providerPaymentId).toBe(`${P}cap_${order.body.orderId}`);
      expect(await invoiceRow(X.inv)).toMatchObject({ status: 'PARTIALLY_CREDITED', paidAt: null });
      expect(await ledgerOf(X.inv)).toEqual({ receivable: 0, revenue: 70, credited: 30 });
      await expectBalanced(ID.biz);
    });

    it('CAP-04 RED-BEFORE W5-CREDIT-AWARE-PAY (D-13) control: an uncredited invoice part-paid 40 of 100 is asked for its 60 remainder by the Stripe checkout (the remainder, never invoice.total); the poll carries no credited key', async () => {
      const inv = await seedInvoice('cap_partial', 'SENT');
      const link = await createLink(inv);
      expect(link.status, JSON.stringify(link.body)).toBe(201);
      expect((await recordPaymentRoute(inv, 40, 'cap_partial_pay')).status).toBe(201);
      expect((await invoiceRow(inv)).status).toBe('PARTIALLY_PAID');

      const poll = await tokenStatus(link.body.token);
      expect(Object.keys(poll.body).sort(), 'no credit, no credited key (the five keys)').toEqual(['currency', 'lastPaymentAt', 'paid', 'remaining', 'status']);
      expect(poll.body).toMatchObject({ status: 'PARTIALLY_PAID', paid: 40, remaining: 60 });
      const res = await checkout(link.body.token, STRIPE_BODY);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      // Base: 10000 (the whole total, though 40 had been received).
      expect(stripeAmount()).toBe('6000');
    });

    it('CAP-05 RED-BEFORE W5-CREDIT-AWARE-PAY CR-V44-1: a FULLY_CREDITED invoice stays unpayable: the token routes and the receipt answer 404, the bare-id status poll 404, and the bare-id checkout, which reaches the payable gate, answers 409 with no provider called and nothing written', async () => {
      const F = await seedCreditedWithLink('cap_full', 0, TOTAL);
      expect((await invoiceRow(F.inv)).status).toBe('FULLY_CREDITED');
      const calls = providerCalls.length;
      for (const res of [await tokenStatus(F.token), await tokenGateways(F.token), await checkout(F.token, STRIPE_BODY), await receipt(F.token), await bareStatus(F.inv)]) {
        expect(res.status, JSON.stringify(res.body)).toBe(404);
      }
      // Base: 400 'Invoice ... is not in a payable state (FULLY_CREDITED)'.
      const bare = await bareCheckout(F.inv);
      expect(bare.status, JSON.stringify(bare.body)).toBe(409);
      expect(bare.body.message).toBe('Invoice is fully credited; nothing is owed');
      expect(providerCalls.length, 'no provider called').toBe(calls);
      expect(await db.payment.count({ where: { invoiceId: F.inv } }), 'nothing written').toBe(0);
      expect(await invoiceRow(F.inv)).toMatchObject({ status: 'FULLY_CREDITED', paidAt: null });
    });

    /** The amounts the WiPay checkouts asked for on an invoice, as kept (webhook_events 'wipay-requested'), in cents. */
    async function wipayAsked(inv: string): Promise<string[]> {
      const rows = await db.webhookEvent.findMany({ where: { provider: 'wipay-requested', providerEventId: { startsWith: `${inv}:` } }, select: { providerEventId: true, businessId: true } });
      expect(rows.every((r: { businessId: string }) => r.businessId === ID.biz), 'kept with the invoice business').toBe(true);
      return rows.map((r: { providerEventId: string }) => r.providerEventId.slice(inv.length + 1)).sort();
    }
    const claimsOf = (txn: string) => db.webhookEvent.count({ where: { provider: 'wipay', providerEventId: txn } });

    it('CAP-06 W5-CREDIT-AWARE-PAY review SEC-CAP-1 / CR-CAP-1 (D-13, D-19): the WiPay callback is verified against the amount its checkout asked for, kept when it asked, so a payment recorded between the checkout and the callback, or a second paid checkout, does not turn the money WiPay took into a refused signature: each is recorded at the amount asked', async () => {
      // An uncredited invoice part-paid 40: the checkout asks for 60, then the operator records 10.
      const inv = await seedInvoice('cap06_part', 'SENT');
      const link = await createLink(inv);
      expect(link.status, JSON.stringify(link.body)).toBe(201);
      expect((await recordPaymentRoute(inv, 40, 'cap06_part_pay1')).status).toBe(201);
      const asked = await checkout(link.body.token, WIPAY_BODY);
      expect(asked.status, JSON.stringify(asked.body)).toBe(201);
      expect(wipayTotal()).toBe('60.00');
      expect(await wipayAsked(inv), 'kept before WiPay was called').toEqual(['6000']);
      expect((await recordPaymentRoute(inv, 10, 'cap06_part_pay2')).status).toBe(201);
      // Packet head: 400 'Invalid WiPay callback signature' (the remainder had become 50), nothing written.
      const res = await wipayCallback(inv, `${P}wipay_tx_cap06a`, 60);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ success: true, invoiceId: inv, message: 'Payment successful' });
      expect((await paymentsOf(inv)).map((p) => [Number(p.amount), p.status, p.provider])).toEqual([
        [40, 'SUCCESSFUL', 'cash'],
        [10, 'SUCCESSFUL', 'cash'],
        [60, 'SUCCESSFUL', 'wipay'],
      ]);
      expect(await claimsOf(`${P}wipay_tx_cap06a`)).toBe(1);

      // A credited invoice (20 paid, 30 credited): two checkouts (two tabs) both ask for 50 and both are paid.
      const X = await seedCreditedWithLink('cap06_twice', 20, 30);
      for (let i = 0; i < 2; i += 1) {
        await clearRateLimits();
        const again = await checkout(X.token, WIPAY_BODY);
        expect(again.status, JSON.stringify(again.body)).toBe(201);
        expect(wipayTotal()).toBe('50.00');
      }
      expect(await wipayAsked(X.inv), 'one kept row per amount asked').toEqual(['5000']);
      const first = await wipayCallback(X.inv, `${P}wipay_tx_cap06b1`, 50);
      expect(first.body).toMatchObject({ success: true, message: 'Payment successful' });
      // Packet head: 400 'Invalid WiPay callback signature' (the remainder had become 0, so only the 100 total was tried).
      const second = await wipayCallback(X.inv, `${P}wipay_tx_cap06b2`, 50);
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      expect(second.body).toMatchObject({ success: true, message: 'Payment successful' });
      expect((await paymentsOf(X.inv)).map((p) => [Number(p.amount), p.status, p.provider])).toEqual([
        [20, 'SUCCESSFUL', 'cash'],
        [50, 'SUCCESSFUL', 'wipay'],
        [50, 'SUCCESSFUL', 'wipay'],
      ]);
      expect(await invoiceRow(X.inv), 'D-78: still PARTIALLY_CREDITED').toMatchObject({ status: 'PARTIALLY_CREDITED' });
      // A checkout refused before WiPay is called keeps nothing.
      await clearRateLimits();
      expect((await checkout(X.token, WIPAY_BODY)).status).toBe(409);
      expect(await wipayAsked(X.inv)).toEqual(['5000']);
      await expectBalanced(ID.biz);
    });

    it('CAP-07 W5-CREDIT-AWARE-PAY review SEC-CAP-1 / CR-CAP-1 (D-13, D-78): a credit note applied between the WiPay checkout and its callback does not refuse the money WiPay took: the 70 asked is recorded and the invoice stays PARTIALLY_CREDITED', async () => {
      const X = await seedCreditedWithLink('cap07_credit', 0, 30);
      const asked = await checkout(X.token, WIPAY_BODY);
      expect(asked.status, JSON.stringify(asked.body)).toBe(201);
      expect(wipayTotal()).toBe('70.00');
      const note = await createNote(X.inv, 10);
      expect((await applyNote(note.id)).status).toBe(201);
      expect((await tokenStatus(X.token)).body).toMatchObject({ remaining: 60, credited: 40 });
      // Packet head: 400 'Invalid WiPay callback signature', no rows.
      const res = await wipayCallback(X.inv, `${P}wipay_tx_cap07`, 70);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ success: true, message: 'Payment successful' });
      expect((await paymentsOf(X.inv)).map((p) => [Number(p.amount), p.status, p.provider])).toEqual([[70, 'SUCCESSFUL', 'wipay']]);
      expect(await invoiceRow(X.inv)).toMatchObject({ status: 'PARTIALLY_CREDITED' });
      await expectBalanced(ID.biz);
    });

    it('CAP-08 W5-CREDIT-AWARE-PAY review SEC-CAP-2 (D-19): the redelivery of a recorded WiPay transaction is the duplicate answer after the balance moved: the credit note voided after the payment, the same callback is "Duplicate callback ignored", not a refused signature, and nothing more is written', async () => {
      const X = await seedCreditedWithLink('cap08_void', 20, 30);
      const asked = await checkout(X.token, WIPAY_BODY);
      expect(asked.status, JSON.stringify(asked.body)).toBe(201);
      expect(wipayTotal()).toBe('50.00');
      const txn = `${P}wipay_tx_cap08`;
      expect((await wipayCallback(X.inv, txn, 50)).body).toMatchObject({ success: true, message: 'Payment successful' });
      const note = await db.creditNote.findFirst({ where: { invoiceId: X.inv, businessId: ID.biz, status: 'APPLIED' } });
      expect((await voidNote(note.id)).status).toBe(201);
      expect((await tokenStatus(X.token)).body).toMatchObject({ status: 'PARTIALLY_PAID', paid: 70, remaining: 30 });
      const ledgerBefore = await ledgerCounts(ID.biz);
      // Packet head: 400 'Invalid WiPay callback signature' (the remainder without this row had become 80).
      const again = await wipayCallback(X.inv, txn, 50);
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body).toMatchObject({ success: true, message: 'Duplicate callback ignored' });
      expect((await paymentsOf(X.inv)).map((p) => [Number(p.amount), p.provider])).toEqual([[20, 'cash'], [50, 'wipay']]);
      expect(await claimsOf(txn)).toBe(1);
      expect(await ledgerCounts(ID.biz), 'nothing posted').toEqual(ledgerBefore);
    });

    it("CAP-09 W5-CREDIT-AWARE-PAY review SEC-CAP-3 (D-19, D-75): a WiPay proof binds only the amounts this server asked for on the invoice it names: invoice A's transaction for its 50 sent with B's order_id, where B owes 50 but no checkout asked B for 50, is refused 400 with nothing written on either (no row, no claim); A's own callback then records it on A", async () => {
      const A = await seedCreditedWithLink('cap09_a', 20, 30);
      const asked = await checkout(A.token, WIPAY_BODY);
      expect(asked.status, JSON.stringify(asked.body)).toBe(201);
      expect(wipayTotal()).toBe('50.00');
      const B = await seedInvoice('cap09_b', 'SENT');
      expect((await recordPaymentRoute(B, 50, 'cap09_b_pay')).status).toBe(201);
      expect(await wipayAsked(B), 'no checkout asked anything for B').toEqual([]);
      const txn = `${P}wipay_tx_cap09`;
      const ledgerBefore = await ledgerCounts(ID.biz);
      // Packet head: 200 'Payment successful', B PAID with [50 cash, 50 wipay] and A left owing.
      const replay = await wipayCallback(B, txn, 50);
      expect(replay.status, JSON.stringify(replay.body)).toBe(400);
      expect(replay.body.message).toBe('Invalid WiPay callback signature');
      expect((await paymentsOf(B)).map((p) => [Number(p.amount), p.provider])).toEqual([[50, 'cash']]);
      expect((await invoiceRow(B)).status).toBe('PARTIALLY_PAID');
      expect(await claimsOf(txn), 'no claim on the transaction').toBe(0);
      expect(await ledgerCounts(ID.biz), 'nothing posted').toEqual(ledgerBefore);

      const own = await wipayCallback(A.inv, txn, 50);
      expect(own.body).toMatchObject({ success: true, invoiceId: A.inv, message: 'Payment successful' });
      expect((await paymentsOf(A.inv)).map((p) => [Number(p.amount), p.provider])).toEqual([[20, 'cash'], [50, 'wipay']]);
    });
  });

  // W4-CREDIT-AWARE-READERS review CR-AR-2, web half (apps/web): the customer pages treat a settled
  // PARTIALLY_CREDITED invoice as paid and show its credit (W5-CREDIT-AWARE-PAY): pinned by
  // apps/web/src/app/pay/link/__tests__/pay-link-provider-return.test.tsx (W-PL-13, W-PL-14) and
  // apps/web/src/app/public/invoice/__tests__/public-invoice-projection.test.tsx (W-10, W-11).
});
