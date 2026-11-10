/**
 * R0-19-EVIDENCE-BASELINE — issue #186 step 4 audit trail: the manual payment
 * is audited as a payment, on a REAL database, through the REAL
 * BusinessEvent pipeline (interceptor -> ResilientEmitterService -> BullMQ
 * queue on Redis -> worker -> BusinessEventService -> business_events).
 *
 * M16 / M49 (docs/reconstruction/BUILD-MAP-001.md): inferEventMeta had no
 * 'payments' entry, so POST .../invoices/:invoiceId/payments walked back to
 * 'invoices' and the audit row said `invoice.create`, subject = the invoice.
 *
 * Contract pinned here, for a partial (100 of 250 -> PARTIALLY_PAID) and a full
 * (the remaining 150 -> PAID) manual payment recorded by the owner:
 *
 *   Payment.recordedBy = the owner                                     (R0-11, fresh Prisma read)
 *   one ContactEvent invoice.payment_recorded with actorId = the owner (per payment)
 *   one BusinessEvent payment.record, subjectType 'payment', subjectId = Payment.id,
 *     actorType human, actorId = the owner                            (per payment)
 *   no invoice.create row, and no audit row whose subject is the invoice
 *   one FinancialTransaction Payment:<id>:payment_recorded (per payment)
 *   LEDGER: the audit write adds no FinancialTransaction or LedgerEntry: the
 *     business holds exactly the two payment postings and their entries
 *   tenant control: GET /timeline/businesses/B/events (owner B) returns B's rows
 *     and none of A's; owner B on A's timeline is refused; B's payment audit row
 *     is B's
 *   R0-19 review (R19-ST-1): an R0-D2 idempotent replay (same reference + amount)
 *     answers 201 with the recorded Payment and writes nothing, the audit row
 *     included: by the owner (EF-08) or by an ADMIN re-submitting the owner's
 *     slip (EF-09), the payment keeps exactly one payment.record row, actorId =
 *     the owner, agreeing with Payment.recordedBy and the ContactEvent
 *
 * V1-25-EVT-BUSINESS-FEED (M49; D-08: Activity rows power the user feed), the
 * read the cockpit's business feed makes, GET /timeline/businesses/:id/events:
 *   EF-10a CONTROL  the harness gives queryEvents the parameter types tsc emits
 *     ([String, QueryTimelineDto]), so the ValidationPipe applies the DTO here as
 *     it does in the built server (esbuild emits none, and without them no query
 *     was validated at all)
 *   EF-10  the page size is bounded: limit 10000, 201, 0, -1, 2.5 and 'abc' answer
 *     400 with no row
 *   EF-10b limit 200, 50 and 1 are read as numbers and answer at most that many
 *     rows; minRevenueImpact is read as a number too
 *   EF-11  after the partial and the final payment, A's feed (as the cockpit
 *     reads it, limit 50) holds one FINANCE payment_recorded row per payment
 *     with its amount and currency, and the commerce paid row with the invoice
 *     total. The paid row's writer is ActivityEventListener.onInvoicePaid, which
 *     the full app's EventEmitter drives from invoice.paid; this harness's bus is
 *     a recorder, so the one invoice.paid payload it recorded for A (EF-02) is
 *     delivered to the real listener (real ActivityService, real rows) here
 *   EF-12 LEDGER  each feed amount equals its Payment row and its posting (and
 *     the posting's balanced entries), in integer cents (D-13); the paid row's
 *     total equals the invoice total, the two payments and the two postings
 *   EF-13  tenant B's feed, read the same way, holds none of A's rows (the paid
 *     row included), and owner A on B's feed is refused
 *   V1-25 review repairs:
 *   EF-11b (CR-V125-1, contract since V1-55) the second invoice.paid listener
 *     the full app registers (AutomationExecutorService.onInvoicePaid) is
 *     delivered the same payload: it writes no feed row, so the feed holds ONE
 *     paid row for the invoice, ActivityEventListener's (until V1-55 it wrote
 *     a second, the pair the cockpit reader showed once)
 *   EF-11c (CR-V125-2) each payment's CRM contact mirror row (raw event name
 *     as title, JSON detail with reference and recordedBy) as the reader sees it
 *   EF-14..EF-16 were it.todo there: the scope filter (SEC-V125-1), CRM scope
 *     and contact visibility (SEC-V125-2) and the sibling-route bounds
 *     (SEC-V125-3) were server changes outside V1-25's write set. Live since
 *     W4-TIMELINE-SCOPE, below.
 *
 * W4-TIMELINE-SCOPE (EF-14..EF-16; owner ruling D-63, the rule V1-84
 * FOLLOW3-D1-TIMELINE-SCOPE built in timeline-visibility.ts): the business
 * feed's rows follow the caller's module scopes and contact visibility, and
 * every feed limit is bounded. On A, after EF-13, three STAFF members (explicit
 * scope maps), two PRIVATE contacts and five rows written through the real
 * TimelineService are added (scopeFixture):
 *   EF-14 (SEC-V125-1) a STAFF member with revenue 'none' gets no FINANCE /
 *     commerce / PAYMENT row (no amount, invoice total or number) from /events
 *     (?category=, ?minRevenueImpact=, ?entityType= included), the day's
 *     summary (revenueImpact 0) or the legacy route, and keeps the rows of the
 *     modules it reads; the OWNER's feed still holds every money row
 *   EF-15 (SEC-V125-2) a member with crm 'none' gets no row naming a contact
 *     (?contactId= answers []), on /events and the legacy route; that member
 *     has crm_view 'all' (review CR-W4TS-1), so visibilityClause lists TEAM
 *     contact A and only the crm-read rule withholds A's rows; a crm_view
 *     'owned' member gets only rows naming contacts it can list
 *     (visibilityClause, M7): not A's unshared TEAM contact's money rows nor the
 *     owner's PRIVATE contact's row, until contact A is shared with it; the
 *     OWNER sees every row and the ADMIN (view-all) every row except those
 *     naming a PRIVATE contact it neither owns nor is shared (M7, V1-84 TS-03)
 *   EF-16 (SEC-V125-3) GET .../upcoming and the legacy
 *     GET /api/flows/businesses/:id/activity answer 400 above TIMELINE_MAX_LIMIT
 *     (limit=100000 included) as /events does, serve at most 200 rows at 200,
 *     and /upcoming is filtered by the same rule
 *   FlowController (its activity route and the real ActivityService) is
 *   mounted for the legacy route; its other collaborators are stubs that route
 *   never calls.
 *   EF-17 (was it.todo, review SEC-W4TS-1, = timeline-scope TS-14): the scope
 *   was these four timeline reads, not every Activity reader. GET
 *   /ai/businesses/:id/briefing/morning (ai.controller.ts, outside that
 *   packet's write set) served the SCHEDULED rows, the `due` row's amount and
 *   contact included, and revenueToday, unfiltered. Live since
 *   W5-BRIEFING-SCOPE (D-63), below: the real AiController on its own app.
 *
 * V1-55-EVT-ACTIVITY-DEDUPE (M50; owner ruling D-08: Activity is the
 * user-visible feed, BusinessEvent the audit trail), on a third tenant C: each
 * step's domain events, as the real services put them on the bus, are handed to
 * the Activity writers the full app registers for them (ActivityEventListener,
 * AutomationExecutorService and the CRM RevenueEventListener, subscribed by the
 * real @nestjs/event-emitter loader on a real EventEmitter2 with the
 * event-bus.module.ts options), and every Activity row the step wrote is pinned:
 *   V55-01 contact create (the real CrmService.createContact; the CRM controller
 *     is not mounted here): ActivityEventListener's crm created row, the only
 *     one since V1-55b (V55-08)
 *   V55-02 invoice create (POST .../invoices): one commerce created row
 *   V55-03 invoice send (PATCH .../status/sent): one commerce sent row
 *   V55-04 a partial manual payment: its FINANCE payment_recorded row, no paid row
 *   V55-05 the final manual payment: its FINANCE row and ONE commerce paid row
 *     for the settled invoice, ActivityEventListener's ('Payment received');
 *     since PR196-CRM-LIFECYCLE (D-81) the CRM RevenueEventListener moves the
 *     invoice's LEAD contact to CLIENT through a real CrmService on the feed bus
 *     (review CR-1: the stub had no such method and the move never ran here):
 *     one 'Status changed' row and one follow-up task, which writes no row; the
 *     executor's stage-change task request is pinned as characterization (CR-2)
 *   flows are still dispatched: one ACTIVE published flow per trigger
 *     (contact.created, invoice.sent, invoice.paid, booking.created,
 *     booking.confirmed) runs once, through the executor, with the step's ids
 *   LEDGER: the feed writers add no FinancialTransaction or LedgerEntry; each
 *     payment has exactly one Payment:<id>:payment_recorded posting, and C holds
 *     only those two, balanced
 *   V55-09 booking create (the real BookingsService.createBooking; the bookings
 *     controller is not mounted here): ONE bookings created row,
 *     ActivityEventListener's ('New booking'), whose detail carries the start
 *     time since V1-55b (V55-11; review repair CR-V155-1 kept the executor's
 *     timed row until then); the booking.created flow is dispatched once
 *   V55-10 booking confirm (the real BookingsService.confirmBooking): ONE
 *     bookings confirmed row, ActivityEventListener's (the executor's removed
 *     row had no detail, so nothing it showed is lost); the booking.confirmed
 *     flow is dispatched once
 *   V55-06 the cockpit read of C shows each of those rows once
 *
 * V1-55b-FEED-DEDUPE-REST (the three V1-55 todos, now cases):
 *   V55-07 the CRM contact timeline keeps the settled invoice's ContactEvent
 *     (RevenueEventListener, from the invoice.paid emit) but writes no Activity
 *     copy of it: the settlement's one feed row is ActivityEventListener's paid
 *     row
 *   V55-07b it.todo then: the CRM copy of a payment's invoice.payment_recorded
 *     contact event was still written: it was the only Activity row naming the
 *     payment's actor, and payments-actor.integration.test.ts (outside the
 *     write set) pinned it (closed by W4-FEED-COPY-COMPLETE, below)
 *   V55-08 contact create writes ONE crm created row, ActivityEventListener's
 *     'New contact' (the executor's 'New contact added' is gone;
 *     log-redaction.integration.test.ts observes the executor's run itself)
 *   V55-11 booking create writes ONE bookings created row, ActivityEventListener's,
 *     and its detail carries the booking's start time (the executor's timed
 *     row is gone)
 *   Not in this packet: the CRM ContactEvent copy of contact.created,
 *     invoice.created, booking.created and booking.confirmed is still written
 *     beside the listener's row (crm:<event>:contact, pinned per step below)
 *   RESIDUAL (review CR-V155b-1), so V1-55b does NOT close "one feed row per
 *     event" for contact create or booking create: V55-08 / V55-11 count one
 *     row of the listener's kind, but the feed also holds the CRM copy, and the
 *     cockpit reader (web business-timeline.tsx feedRows) leaves out only
 *     invoice.payment_recorded copies. It shows 'New contact' + 'Contact
 *     created' and 'New booking' + 'Booking created': two rows each, the same
 *     count as at base, where its DOUBLE_WRITTEN rule already showed the
 *     listener/executor pair once. What V1-55b changes there: the booking row
 *     always carries the start time. V55-06 pins the copies; V55-12 is the todo
 *
 * W3-V1-55c-FEED-ACTOR (owner ruling D-90, on D-08; review CR-V155b-1):
 *   D-90  the FINANCE payment_recorded row RevenuePostingService writes for a
 *     payment names who recorded it: actorId the recorder, actorType USER for
 *     a person and SYSTEM for KEY (as the CRM invoice.payment_recorded copy
 *     carried it), none when no actor is known. EF-01 / EF-02 / EF-05
 *     (expectPaymentEvidence), EF-11 (the cockpit read), V55-04 / V55-05 and
 *     V55-07a pin it; payments-actor.integration.test.ts reads the actor there.
 *   V55-12 contact create (CrmService.createContact) shows ONE row in the
 *     cockpit: its contact.created ContactEvent is written with
 *     meta.feedCopy=false (the V1-55b mechanism), so the feed holds
 *     ActivityEventListener's 'New contact' and no crm:contact.created copy;
 *     the referral path (crm-network.service.ts), which emits no
 *     contact.created, keeps its copy as its only row.
 *   Left open by W3-V1-55c (outside its write set): V55-07b and V55-12b.
 *
 * W4-FEED-COPY-COMPLETE (owner ruling D-90, on D-08; V55-07b, V55-12b): one
 * feed row per payment and per booking create. CrmService.logContactEvent ->
 * CrmTimelineService.logContactEvent now carries meta.feedCopy (the V1-55b
 * switch), and both ContactEvents are written with feedCopy=false:
 *   V55-07b a manual payment (CommerceService.recordPayment) writes ONE feed
 *     row, its FINANCE payment_recorded row naming the recorder (V55-07a); its
 *     invoice.payment_recorded ContactEvent and its payment.record audit row
 *     stay, and no crm:invoice.payment_recorded:contact copy is written
 *     (EF-01 / EF-02 / EF-11c, V55-04 / V55-05 pin the same in each harness)
 *   V55-12b booking create (BookingsService.createBooking) shows ONE row in the
 *     cockpit, ActivityEventListener's 'New booking': its booking.created
 *     ContactEvent stays on the contact's timeline with no Activity copy
 *     (V55-09 / V55-06 pin the same); booking confirm's copy is not in D-90
 *     and stays (V55-10). The storefront booking's copy
 *     (PublicEventsService.logStorefrontEvent) is outside this packet.
 *   Review repairs (D-90, D-63 / V1-84):
 *   V55-13 (SEC-FCC-1) CrmTimelineService.logEvent wrote every CRM copy with
 *     category CONTACT (its map was keyed by category names @keyflow/shared no
 *     longer uses), so a member with crm read and revenue 'none' was served a
 *     money copy's amount. A copy that carries money (a sales_revenue type, or
 *     data with an amount field) is now COMMERCE; any other copy stays CONTACT.
 *     V55-13b it.todo then: copies already stored as CONTACT need a backfill
 *     or the visibility rule (outside the write set; closed by
 *     W5-FEED-CATEGORIES, below).
 *   V55-14 (CR-FCC-1) ?contactId= still returns the one row a manual payment
 *     and a booking create keep; V55-14b it.todo then: those rows carry no
 *     category and name the contact by contactId only, so ?category= and
 *     ?entityType=contact&entityId= no longer find them (the fix is in
 *     revenue-posting.service.ts and activity-event.listener.ts, outside the
 *     write set; the category closed by W5-FEED-CATEGORIES, below).
 *
 * W5-FEED-CATEGORIES (owner rulings D-90 and D-63, the V1-84 timeline rule;
 * V55-13b, V55-14b, were it.todo):
 *   V55-13b (SEC-FCC-1) a stored row whose data carries a money field (the
 *     V55-13 list: amount, total, subtotal, invoiceTotal, totalPaid,
 *     paymentAmount, refundAmount, depositAmount) is a revenue row whatever
 *     its category, so the CRM copies already stored as CONTACT (or with no
 *     category) are not served to a member with crm read and revenue 'none';
 *     no data migration, the stored rows are unchanged.
 *   V55-14b (CR-FCC-1) the FINANCE payment_recorded row is written with
 *     category PAYMENT and onBookingCreated's 'New booking' with BOOKING, so
 *     ?category= finds a manual payment's and a booking create's one row.
 *   Review repairs (D-90, D-63 / V1-84):
 *   V55-13c (CR-W5FC-2) a stored crm row whose action is a sales_revenue type
 *     (deal.created / won / lost carry the deal amount as data.value, not on
 *     the money field list) is a revenue row whatever its category, as
 *     V55-13 writes today's copy of the same event as COMMERCE by its type.
 *   V55-13d (SEC-W5FC-2 / CR-W5FC-1) the money-in-data and type terms read
 *     crm-scope rows only (the CRM copies SEC-FCC-1 is about): an EXPENSE row
 *     with data.amount keeps D-63's binding and is served on expenses read.
 *   V55-13e it.todo then (SEC-W5FC-1, outside the write set): GET
 *     /crm/businesses/:b/contacts/:c/events served the ContactEvent rows,
 *     amounts included, on crm read alone (closed for that one route by
 *     W6-CONTACT-EVENTS-MONEY, below; the sibling reads are V55-13f..h).
 *
 * W6-CONTACT-EVENTS-MONEY (SEC-W5FC-1; owner rulings D-90 and D-63, the V1-84
 * timeline rule; V55-13e, was it.todo): GET /crm/businesses/:b/contacts/:c/events
 * (CrmController.contactEvents -> CrmService -> CrmTimelineService
 * .listContactEvents) serves a member without revenue read only the
 * ContactEvents the feed would serve them a copy of: an event of a
 * sales_revenue type or whose data carries a money field (crmRowCarriesMoney,
 * timeline-visibility.ts, the one MONEY_DATA_FIELDS list) is withheld, the
 * page filled from older events; a member with revenue read gets every event.
 * The real CrmController, CrmService and CrmTimelineService are mounted on
 * their own app over this suite's PrismaService and identity header; the
 * controller's other collaborators are empty stand-ins the route never calls.
 *   This closes SEC-W5FC-1 for the /events route only, not the disclosure
 *   class. Review repairs (SEC-W6CEM-1, SEC-W6CEM-2, CR-W6CEM-1; D-90 / D-63):
 *   V55-13f..h it.todo (outside this packet's write set, they need a ruling
 *   and a follow-up packet): the same member still reads the same
 *   ContactEvents and amounts, one sibling GET away on the same contact, from
 *   cross-journey / story / dossier (V55-13f), revenue-summary and journey
 *   (V55-13g), and the contact detail the web Timeline tab draws from
 *   (V55-13h) (closed by W7-CONTACT-MONEY-VIEWS, below).
 *
 * W7-CONTACT-MONEY-VIEWS (SEC-W6CEM-1, SEC-W6CEM-2, CR-W6CEM-1; owner rulings
 * D-90 and D-63, the V1-84 timeline rule, as the briefings apply it; V55-13f,
 * V55-13g, V55-13h, were it.todo): the contact's sibling reads serve a member
 * without revenue read no money row and no money figure. Cross-journey, story
 * and dossier (CrmJourneyService.getContactCrossJourney, generateAiInsight),
 * the journey and the revenue summary (CrmRevenueService
 * .getContactRevenueSummary), and the contact detail (CrmStatsService
 * .contactDetail): the ContactEvents V55-13e withholds are withheld (the page
 * filled from older events), the contact's invoices and quotes are not read,
 * and every figure read from them (totals, revenue, balances, invoice counts,
 * the insight's payment sentence, the contact's stored lifetimeValue /
 * averageSpend) is 0 or null in the response's existing shape. The owner and
 * a member with revenue read get every row and figure, as before.
 *   Review repair SEC-W7CMV-3 (V55-13i): the detail and the dossier's contact
 *   also serve that member the stored paymentReliability as null (as the
 *   revenue summary does), and riskFlags / opportunities without the entries
 *   derived from invoices and quotes. Residuals outside the write set (follow-
 *   up): GET .../ai-insight and .../insight-card (crm-ai.controller.ts), the
 *   contact list (stored amounts, revenue sort and filters), the business-wide
 *   predictive-revenue / financial-growth, and health.payment (dossier and
 *   .../health-metrics).
 *
 * CHARACTERIZATION ONLY in EF-01 / EF-02: the Activity rows each payment writes
 *   in the R0-19 harness, whose bus is a recorder (no listener runs there; the
 *   V1-55 block above runs them), and the domain events it puts on the bus.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, CommerceService, InvoiceWorkflowService,
 * RevenuePostingService, PostingService, ChartOfAccountsSeederService,
 * CrmTimelineService, TimelineService (Activity rows), TimelineController,
 * FlowController's activity route and ActivityService (W4-TIMELINE-SCOPE),
 * BusinessEventInterceptor (installed as APP_INTERCEPTOR, as app.module.ts
 * does), ResilientEmitterService, BusinessEventQueueService (its BullMQ queue and
 * worker on REDIS_URL) and BusinessEventService write and read real rows, and the
 * production GlobalHttpExceptionFilter + ValidationPipe are installed. Stand-ins:
 * identity attachment (a test middleware reads `x-k19a-user`, loads that seeded
 * user row and attaches { id, email, role } as the Supabase-verifying
 * AuthMiddleware would); EventEmitter2 is a recorder; the anomaly inspector,
 * stats cache, COGS posting and the AI / Gmail / Drive services are stubs off
 * the boundary. TimelineController declares its TimelineService dependency only
 * through tsc-emitted `design:paramtypes`, which vitest's esbuild transform does
 * not emit, so the test defines that one metadata entry exactly as tsc would.
 * ResilientEmitterService.emit is wrapped by a pass-through recorder (`emits`):
 * every job still goes to the real queue; the recorder shows, without waiting
 * on the worker, what the interceptor handed it for a request.
 *
 * Queue isolation (R0-19 review, CR-R19-1): 'business-events' is one global
 * BullMQ queue name, so every app on the same REDIS_URL (a dist/main.js that a
 * parallel test file spawns) would compete for this run's jobs, and this run's
 * worker for theirs. BullMQ's real Queue and Worker are therefore constructed
 * with a BullMQ `prefix` of this run's own (vi.mock below adds only that
 * option); BusinessEventQueueService itself is unchanged. Its keys are deleted
 * in afterAll.
 *
 * Fixtures: prefix `k19a_` (registered in test/helpers/fixture-prefixes.json),
 * plus a per-run tag in every id so a BullMQ job left over from an earlier run
 * can never land on this run's business. Hard-deleted by raw SQL matched
 * through sqlLikePrefix(P), in dependency order, in beforeAll and afterAll; no
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

/** CR-R19-1: this run's own BullMQ key prefix (no other app on REDIS_URL shares it). */
const BULL = vi.hoisted(() => ({
  prefix: `k19a-bull-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
}));

// The real BullMQ classes; only the key prefix is set, for every queue and worker
// this harness builds (BusinessEventQueueService's 'business-events' pair).
vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bullmq')>();
  type QueueArgs = ConstructorParameters<typeof actual.Queue>;
  type WorkerArgs = ConstructorParameters<typeof actual.Worker>;
  class Queue extends actual.Queue {
    constructor(name: string, opts?: QueueArgs[1], connection?: QueueArgs[2]) {
      super(name, { ...opts, prefix: BULL.prefix } as QueueArgs[1], connection);
    }
  }
  class Worker extends actual.Worker {
    constructor(name: string, processor?: WorkerArgs[1], opts?: WorkerArgs[2], connection?: WorkerArgs[3]) {
      super(name, processor, { ...opts, prefix: BULL.prefix } as WorkerArgs[2], connection);
    }
  }
  return { ...actual, Queue, Worker };
});

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k19a_';
const HEADER = 'x-k19a-user';
/** Per-run tag: ids differ between runs, so a stale queued audit job cannot hit them. */
const RUN = Date.now().toString(36);

const ID = {
  ownerA: `${P}${RUN}_ownerA`,
  adminA: `${P}${RUN}_adminA`,
  ownerB: `${P}${RUN}_ownerB`,
  bizA: `${P}${RUN}_bizA`,
  bizB: `${P}${RUN}_bizB`,
  contactA: `${P}${RUN}_contactA`,
  contactB: `${P}${RUN}_contactB`,
  invA: `${P}${RUN}_invA`,
  invB: `${P}${RUN}_invB`,
};

const PAYMENT_ROUTE = '/commerce/businesses/:businessId/invoices/:invoiceId/payments';
const INVOICE_A_TOTAL = 250;
const INVOICE_B_TOTAL = 80;

let db: any;
let app: any;
let redis: any;

/** Domain events CommerceService / InvoiceWorkflowService put on the bus. */
const bus: Array<{ name: string; payload: any }> = [];
const eventRecorder = {
  emit: (name: string, payload: unknown) => {
    bus.push({ name, payload });
    return true;
  },
  emitAsync: async () => [],
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

/** Every job the interceptor handed ResilientEmitterService (pass-through recorder). */
const emits: Array<{ eventType: string; subjectId: string; actorId: string }> = [];

/** Shared across the ordered cases below. */
const S: {
  partialId?: string;
  fullId?: string;
  bPaymentId?: string;
} = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM business_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    // V1-55: the flows seeded for tenant C and the team audit rows of its invoice create.
    `DELETE FROM flow_versions WHERE flow_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM automation_flows WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    // PR196-CRM-LIFECYCLE (D-81): the follow-up task of tenant C's paid invoice and its assignment.
    `DELETE FROM task_assignments WHERE task_id IN (SELECT id FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payment_links WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    // V1-55 review (CR-V155-1): tenant C's booking and its service (Booking.contact is NoAction).
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    // W4-TIMELINE-SCOPE (EF-15): the share of contact A with the owned-view member.
    `DELETE FROM contact_shares WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    // W7-CONTACT-MONEY-VIEWS (V55-13f..h): tenant C's quotes and contact notes (Quote.contact is NoAction).
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function payAs(user: string, biz: string, inv: string, body: Record<string, unknown>) {
  return agent().post(`/commerce/businesses/${biz}/invoices/${inv}/payments`).set(HEADER, user).send(body);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `read` until `done` holds or the deadline passes; return the last read. */
async function waitFor<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await sleep(50);
    value = await read();
  }
  return value;
}

/** Every audit row of a business, oldest first (fresh read). */
async function auditRows(businessId: string): Promise<any[]> {
  return db.businessEvent.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } });
}

/**
 * The audit rows a request wrote: wait for the business's row count to reach
 * `before + 1` (the audit write is asynchronous: a tap after the response, then
 * the queue worker), let a duplicate surface if there is one, then return the
 * new rows.
 */
async function newAuditRows(businessId: string, before: number): Promise<any[]> {
  await waitFor(() => auditRows(businessId), (rows) => rows.length >= before + 1);
  await sleep(400);
  return (await auditRows(businessId)).slice(before);
}

/** This run's audit queue (run-scoped prefix, so only this run's jobs). */
async function auditQueue(): Promise<any> {
  const { BusinessEventQueueService } = await import('../src/modules/business-events/business-event.queue');
  return app.get(BusinessEventQueueService).queue;
}

/** Wait until this run's audit queue holds no waiting, active or delayed job. */
async function drainAuditQueue(ms = 10_000): Promise<Record<string, number>> {
  const queue = await auditQueue();
  return waitFor(
    () => queue.getJobCounts('waiting', 'active', 'delayed'),
    (c: Record<string, number>) => (c.waiting ?? 0) + (c.active ?? 0) + (c.delayed ?? 0) === 0,
    ms,
  );
}

async function activityRows(businessId: string): Promise<Array<{ id: string; module: string; action: string; entityType: string; entityId: string | null }>> {
  return db.activity.findMany({
    where: { businessId },
    orderBy: { occurredAt: 'asc' },
    select: { id: true, module: true, action: true, entityType: true, entityId: true },
  });
}

/** Activity rows written since `before` once the fire-and-forget writers settle. */
async function newActivityRows(businessId: string, before: number) {
  let last = -1;
  let rows = await activityRows(businessId);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await sleep(250);
    rows = await activityRows(businessId);
    if (rows.length > before && rows.length === last) break;
    last = rows.length;
  }
  return rows.slice(before);
}

async function contactEventsFor(businessId: string, contactId: string, reference: string): Promise<any[]> {
  const rows = await db.contactEvent.findMany({
    where: { businessId, contactId, type: 'invoice.payment_recorded' },
    orderBy: { createdAt: 'asc' },
  });
  return rows.filter((r: any) => (r.data as any)?.reference === reference);
}

async function postingsFor(businessId: string, paymentId: string): Promise<any[]> {
  return db.financialTransaction.findMany({
    where: { businessId, externalRef: `Payment:${paymentId}:payment_recorded` },
  });
}

/** The step-4 evidence pins for one manual payment recorded by `owner`. */
async function expectPaymentEvidence(opts: {
  businessId: string;
  contactId: string;
  invoiceId: string;
  paymentId: string;
  owner: string;
  reference: string;
  audit: any[];
}) {
  const row = await db.payment.findUnique({ where: { id: opts.paymentId } });
  expect(row).toMatchObject({ businessId: opts.businessId, invoiceId: opts.invoiceId, status: 'SUCCESSFUL' });
  expect(row.recordedBy, 'Payment.recordedBy').toBe(opts.owner);

  const events = await contactEventsFor(opts.businessId, opts.contactId, opts.reference);
  expect(events, 'ContactEvent invoice.payment_recorded').toHaveLength(1);
  expect(events[0]).toMatchObject({ actorId: opts.owner, actorType: 'USER', source: 'commerce' });
  expect((events[0].data as any).invoiceId).toBe(opts.invoiceId);

  expect(opts.audit, 'audit rows written by this request').toHaveLength(1);
  expect(opts.audit[0]).toMatchObject({
    businessId: opts.businessId,
    eventType: 'payment.record',
    subjectType: 'payment',
    subjectId: opts.paymentId,
    action: 'record',
    actorType: 'human',
    actorId: opts.owner,
  });
  expect((opts.audit[0].metadata as any)).toMatchObject({ route: PAYMENT_ROUTE, httpMethod: 'POST' });

  const postings = await postingsFor(opts.businessId, opts.paymentId);
  expect(postings, 'Payment:<id>:payment_recorded posting').toHaveLength(1);
  expect(postings[0]).toMatchObject({ type: 'INCOME', status: 'POSTED', sourceType: 'Payment', sourceId: opts.paymentId, createdById: opts.owner });

  // W3-V1-55c (D-90): the payment's one FINANCE feed row names who recorded it.
  const finance = await financeRowsFor(opts.businessId, opts.paymentId);
  expect(finance, 'FINANCE payment_recorded row').toHaveLength(1);
  expect(finance[0]).toMatchObject({ actorType: 'USER', actorId: opts.owner });
}

/** The FINANCE payment_recorded Activity rows of one payment, once the fire-and-forget write lands. */
async function financeRowsFor(businessId: string, paymentId: string): Promise<any[]> {
  return waitFor(
    () => db.activity.findMany({ where: { businessId, module: 'FINANCE', action: 'payment_recorded', entityType: 'payment', entityId: paymentId } }),
    (rows: any[]) => rows.length >= 1,
    5_000,
  );
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
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
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
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
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { TimelineController } = await import('../src/modules/timeline/timeline.controller');
  const { BusinessEventInterceptor } = await import('../src/modules/business-events/business-event.interceptor');
  const { ResilientEmitterService } = await import('../src/modules/business-events/resilient-emitter.service');
  const { BusinessEventQueueService } = await import('../src/modules/business-events/business-event.queue');
  const { BusinessEventService } = await import('../src/modules/business-events/business-event.service');
  const { BusinessEventAnomalyService } = await import('../src/modules/business-events/business-event-anomaly.service');
  // W4-TIMELINE-SCOPE (EF-14..EF-16): the legacy feed route, GET /api/flows/businesses/:id/activity.
  const { FlowController } = await import('../src/modules/flow/flow.controller');
  const { FlowService } = await import('../src/modules/flow/flow.service');
  const { ActivityService } = await import('../src/modules/flow/activity.service');
  const { CrossModuleAgentService } = await import('../src/modules/flow/cross-module-agent.service');
  const { FlowEngineService } = await import('../src/modules/flow/flow-engine.service');
  const { FlowRunnerService } = await import('../src/modules/flow/flow-runner.service');
  const { FlowTemplateService } = await import('../src/modules/flow/flow-template.service');

  // What tsc emits for FlowController's constructor (its last three
  // collaborators are injected by type only).
  if (!Reflect.getMetadata('design:paramtypes', FlowController)) {
    Reflect.defineMetadata('design:paramtypes', [
      FlowService, ActivityService, CrossModuleAgentService, PrismaService,
      FlowEngineService, FlowRunnerService, FlowTemplateService,
    ], FlowController);
  }

  // What tsc emits for `constructor(private readonly timeline: TimelineService)`.
  if (!Reflect.getMetadata('design:paramtypes', TimelineController)) {
    Reflect.defineMetadata('design:paramtypes', [TimelineService], TimelineController);
  }
  // V1-25: what tsc emits for queryEvents(@Param() businessId: string,
  // @Query() query: QueryTimelineDto). Without it the ValidationPipe sees no
  // metatype and never applies the DTO, so this harness would read a query the
  // built server refuses (and the reverse). EF-10a pins it against tsc.
  const { QueryTimelineDto } = await import('../src/modules/timeline/dto/query-timeline.dto');
  if (!Reflect.getMetadata('design:paramtypes', TimelineController.prototype, 'queryEvents')) {
    Reflect.defineMetadata('design:paramtypes', [String, QueryTimelineDto], TimelineController.prototype, 'queryEvents');
  }

  // BullMQ refuses a connection whose maxRetriesPerRequest is not null
  // (RedisModule sets the same for the app).
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null, lazyConnect: false });

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController, TimelineController, FlowController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PublicRateLimitGuard,
      PlanLimitGuard,
      CrmRateLimitGuard,
      TeamAuditInterceptor,
      { provide: REDIS_CLIENT, useValue: redis },
      // The audit pipeline, wired as app.module.ts and BusinessEventModule wire it.
      { provide: APP_INTERCEPTOR, useClass: BusinessEventInterceptor },
      ResilientEmitterService,
      BusinessEventQueueService,
      BusinessEventService,
      { provide: BusinessEventAnomalyService, useValue: { inspect: async () => undefined } },
      CommerceService,
      InvoiceWorkflowService,
      InvoiceReceiptBuilderService,
      RevenuePostingService,
      PostingService,
      ChartOfAccountsSeederService,
      { provide: ExpensePostingService, useValue: {} },
      { provide: EventEmitter2, useValue: eventRecorder },
      // Real contact timeline and real Activity writer.
      CrmTimelineService,
      TimelineService,
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      {
        provide: CrmService,
        useFactory: (t: InstanceType<typeof CrmTimelineService>) => ({
          logContactEvent: (input: Parameters<InstanceType<typeof CrmTimelineService>['logContactEvent']>[0]) => t.logContactEvent(input),
        }),
        inject: [CrmTimelineService],
      },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CommerceStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CatalogService, useValue: {} },
      { provide: PublicEventsService, useValue: {} },
      { provide: TimeEntryService, useValue: {} },
      { provide: GmailService, useValue: {} },
      { provide: CommerceVisionService, useValue: {} },
      { provide: StoreReadinessService, useValue: {} },
      { provide: PaymentEvidenceService, useValue: {} },
      { provide: DocumentIntelligenceService, useValue: {} },
      { provide: GoogleDriveService, useValue: {} },
      // W4-TIMELINE-SCOPE: the legacy feed route reads real rows through the
      // real ActivityService; FlowController's other collaborators are stubs
      // that route never calls.
      ActivityService,
      { provide: FlowService, useValue: {} },
      { provide: CrossModuleAgentService, useValue: {} },
      { provide: FlowEngineService, useValue: {} },
      { provide: FlowRunnerService, useValue: {} },
      { provide: FlowTemplateService, useValue: {} },
    ],
  }).compile();

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
  // Same filter and pipe as app-bootstrap.ts, so status codes are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  // Pass-through recorder: the real emit still runs for every job.
  const resilient: InstanceType<typeof ResilientEmitterService> = app.get(ResilientEmitterService);
  const realEmit = resilient.emit.bind(resilient);
  resilient.emit = async (job: Parameters<typeof realEmit>[0]) => {
    emits.push({ eventType: job.eventType, subjectId: job.subjectId, actorId: job.actorId });
    return realEmit(job);
  };

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.ownerA, email: `${P}${RUN}_ownerA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.adminA, email: `${P}${RUN}_adminA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}${RUN}_ownerB@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'K19A Biz A', ownerId: ID.ownerA, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizB, name: 'K19A Biz B', ownerId: ID.ownerB, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}${RUN}_mA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}${RUN}_mAa`, userId: ID.adminA, businessId: ID.bizA, role: 'ADMIN' } });
  await db.membership.create({ data: { id: `${P}${RUN}_mB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'K19a', lastName: 'CustomerA', email: `${P}${RUN}_ca@test.local` } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'K19a', lastName: 'CustomerB', email: `${P}${RUN}_cb@test.local` } });
  const seeder = moduleRef.get(ChartOfAccountsSeederService);
  await seeder.ensureDefaults(ID.bizA);
  await seeder.ensureDefaults(ID.bizB);

  for (const [id, businessId, contactId, total, n] of [
    [ID.invA, ID.bizA, ID.contactA, INVOICE_A_TOTAL, 1],
    [ID.invB, ID.bizB, ID.contactB, INVOICE_B_TOTAL, 2],
  ] as const) {
    await db.invoice.create({
      data: {
        id,
        invoiceNumber: `K19A-${RUN}-${n}`,
        status: 'SENT',
        subtotal: total,
        total,
        currency: 'TTD',
        businessId,
        contactId,
        items: { create: [{ id: `${id}_item1`, description: `K19A item ${n}`, quantity: 1, unitPrice: total, total }] },
      },
    });
  }
}, 180_000);

afterAll(async () => {
  // Let in-flight audit jobs land before the worker stops, so none is left queued.
  if (app) {
    try { await drainAuditQueue(5_000); } catch { /* best-effort */ }
    await app.close();
  }
  if (db) await cleanup();
  if (redis) {
    // CR-R19-1: drop this run's BullMQ keys (completed jobs are kept for a day otherwise).
    try {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${BULL.prefix}:*`, 'COUNT', 500);
        if (keys.length) await redis.del(...keys);
        cursor = next;
      } while (cursor !== '0');
    } catch { /* best-effort */ }
    await redis.quit();
  }
}, 60_000);

describe('harness isolation (R0-19 review, CR-R19-1)', () => {
  it("the audit queue and its worker run under this run's own BullMQ prefix, so no other app on REDIS_URL takes this run's jobs", async () => {
    const { BusinessEventQueueService } = await import('../src/modules/business-events/business-event.queue');
    const service = app.get(BusinessEventQueueService) as any;
    expect(service.queue.name).toBe('business-events');
    expect(service.queue.opts.prefix).toBe(BULL.prefix);
    expect(service.worker?.opts?.prefix, 'the worker shares the prefix').toBe(BULL.prefix);
    expect(BULL.prefix).not.toBe('bull');
  });
});

describe('fixture sanity (real rows)', () => {
  it('two tenants, each with an OWNER, a system chart of accounts and one SENT invoice; no payment, posting, audit or Activity row yet', async () => {
    const roster: Record<string, string[][]> = {
      [ID.bizA]: [[ID.ownerA, 'OWNER'], [ID.adminA, 'ADMIN']],
      [ID.bizB]: [[ID.ownerB, 'OWNER']],
    };
    for (const [biz, inv] of [[ID.bizA, ID.invA], [ID.bizB, ID.invB]]) {
      const members = await db.membership.findMany({ where: { businessId: biz } });
      expect(members.map((m: any) => [m.userId, m.role]).sort()).toEqual([...roster[biz]].sort());
      expect(await db.chartOfAccount.count({ where: { businessId: biz, isSystem: true } })).toBeGreaterThan(0);
      expect((await db.invoice.findUnique({ where: { id: inv } })).status).toBe('SENT');
      expect(await db.payment.count({ where: { businessId: biz } })).toBe(0);
      expect(await db.financialTransaction.count({ where: { businessId: biz } })).toBe(0);
      expect(await auditRows(biz)).toEqual([]);
      expect(await activityRows(biz)).toEqual([]);
    }
  });
});

describe('step 4 audit trail: a manual payment is audited as a payment (R0-19, real DB, real audit pipeline)', () => {
  it('EF-01: partial payment (100 of 250) by the owner -> PARTIALLY_PAID; recordedBy, one ContactEvent, one payment.record audit row on the Payment, one posting', async () => {
    const auditBefore = (await auditRows(ID.bizA)).length;
    const activityBefore = (await activityRows(ID.bizA)).length;
    bus.length = 0;
    emits.length = 0;

    const reference = `${P}${RUN}-partial`;
    const res = await payAs(ID.ownerA, ID.bizA, ID.invA, { amount: 100, method: 'cash', reference });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    S.partialId = res.body.payment.id;
    // The interceptor handed the emitter this request's one row before the response left.
    expect(emits).toEqual([{ eventType: 'payment.record', subjectId: S.partialId, actorId: ID.ownerA }]);
    expect((await db.invoice.findUnique({ where: { id: ID.invA } })).status).toBe('PARTIALLY_PAID');

    const audit = await newAuditRows(ID.bizA, auditBefore);
    await expectPaymentEvidence({
      businessId: ID.bizA, contactId: ID.contactA, invoiceId: ID.invA, paymentId: S.partialId!,
      owner: ID.ownerA, reference, audit,
    });

    // CHARACTERIZATION (V1-55 / D-08): what this payment wrote to Activity in
    // this harness, and what it put on the bus. Since W4-FEED-COPY-COMPLETE
    // (D-90, V55-07b) its FINANCE row is its only one: the ContactEvent above
    // gets no crm:invoice.payment_recorded:contact copy.
    const activity = await newActivityRows(ID.bizA, activityBefore);
    expect(activity.map((a) => `${a.module}:${a.action}:${a.entityType}`).sort()).toEqual([
      'FINANCE:payment_recorded:payment',
    ]);
    expect(activity.find((a) => a.module === 'FINANCE')?.entityId).toBe(S.partialId);
    // Sorted: business_event.created is the audit worker's fan-out and lands after the response.
    expect(bus.map((e) => e.name).sort()).toEqual(['business_event.created', 'crm.contact_event.logged', 'invoice.payment_recorded']);
    expect(bus.filter((e) => e.name === 'business_event.created').map((e) => e.payload.eventType)).toEqual(['payment.record']);
  });

  it('EF-02: full payment (the remaining 150) by the owner -> PAID; the same pins for the second payment', async () => {
    const auditBefore = (await auditRows(ID.bizA)).length;
    const activityBefore = (await activityRows(ID.bizA)).length;
    bus.length = 0;
    emits.length = 0;

    const reference = `${P}${RUN}-full`;
    const res = await payAs(ID.ownerA, ID.bizA, ID.invA, { amount: 150, method: 'bank_transfer', reference });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    S.fullId = res.body.payment.id;
    expect(emits).toEqual([{ eventType: 'payment.record', subjectId: S.fullId, actorId: ID.ownerA }]);
    expect(S.fullId).not.toBe(S.partialId);
    expect(res.body.remaining).toBe(0);
    expect((await db.invoice.findUnique({ where: { id: ID.invA } })).status).toBe('PAID');

    const audit = await newAuditRows(ID.bizA, auditBefore);
    await expectPaymentEvidence({
      businessId: ID.bizA, contactId: ID.contactA, invoiceId: ID.invA, paymentId: S.fullId!,
      owner: ID.ownerA, reference, audit,
    });

    // CHARACTERIZATION. In the full app invoice.paid also drives
    // ActivityEventListener.onInvoicePaid (the feed's one paid row since V1-55);
    // no listener is wired in this harness (the V1-55 block below wires them).
    // W4-FEED-COPY-COMPLETE (D-90, V55-07b): no CRM contact-event copy.
    const activity = await newActivityRows(ID.bizA, activityBefore);
    expect(activity.map((a) => `${a.module}:${a.action}:${a.entityType}`).sort()).toEqual([
      'FINANCE:payment_recorded:payment',
    ]);
    expect(activity.find((a) => a.module === 'FINANCE')?.entityId).toBe(S.fullId);
    expect(bus.map((e) => e.name).sort()).toEqual(['business_event.created', 'crm.contact_event.logged', 'invoice.paid']);
    expect(bus.filter((e) => e.name === 'business_event.created').map((e) => e.payload.eventType)).toEqual(['payment.record']);
  });

  it('EF-03: business A holds exactly one payment.record row per payment and no invoice.create row, nor any audit row whose subject is the invoice', async () => {
    const rows = await auditRows(ID.bizA);
    expect(rows.map((r) => [r.eventType, r.subjectType, r.subjectId])).toEqual([
      ['payment.record', 'payment', S.partialId],
      ['payment.record', 'payment', S.fullId],
    ]);
    expect(rows.filter((r) => r.eventType === 'invoice.create')).toEqual([]);
    expect(rows.filter((r) => r.subjectId === ID.invA)).toEqual([]);
    // The audit row of each payment exists nowhere else.
    for (const paymentId of [S.partialId, S.fullId]) {
      const bySubject = await db.businessEvent.findMany({ where: { subjectType: 'payment', subjectId: paymentId } });
      expect(bySubject.map((r: any) => r.businessId)).toEqual([ID.bizA]);
    }
  });

  it('EF-04 LEDGER: the audit write adds no FinancialTransaction or LedgerEntry; A holds exactly the two payment postings, each balanced', async () => {
    const txns = await db.financialTransaction.findMany({ where: { businessId: ID.bizA }, orderBy: { createdAt: 'asc' } });
    expect(txns.map((t: any) => t.externalRef)).toEqual([
      `Payment:${S.partialId}:payment_recorded`,
      `Payment:${S.fullId}:payment_recorded`,
    ]);
    const entries = await db.ledgerEntry.findMany({ where: { businessId: ID.bizA } });
    const txnIds = new Set(txns.map((t: any) => t.id));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter((e: any) => !txnIds.has(e.transactionId)), 'ledger entries outside the two postings').toEqual([]);
    for (const t of txns) {
      const own = entries.filter((e: any) => e.transactionId === t.id);
      const debit = own.reduce((s: number, e: any) => s + Number(e.debit ?? 0), 0);
      const credit = own.reduce((s: number, e: any) => s + Number(e.credit ?? 0), 0);
      expect(debit, `posting ${t.externalRef} balanced`).toBeCloseTo(credit, 2);
      expect(debit).toBeCloseTo(Number(t.amount), 2);
    }
  });
});

describe('tenant control on the evidence feed (R0-19)', () => {
  it('EF-05: owner B records a payment on B -> one payment.record audit row in B, none in A', async () => {
    const auditBeforeB = (await auditRows(ID.bizB)).length;
    const auditA = (await auditRows(ID.bizA)).length;
    const reference = `${P}${RUN}-b`;
    const res = await payAs(ID.ownerB, ID.bizB, ID.invB, { amount: 30, method: 'cash', reference });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    S.bPaymentId = res.body.payment.id;

    const audit = await newAuditRows(ID.bizB, auditBeforeB);
    await expectPaymentEvidence({
      businessId: ID.bizB, contactId: ID.contactB, invoiceId: ID.invB, paymentId: S.bPaymentId!,
      owner: ID.ownerB, reference, audit,
    });
    expect(await auditRows(ID.bizA)).toHaveLength(auditA);
  });

  it("EF-06: GET /timeline/businesses/B/events (owner B) answers B's rows and none of A's", async () => {
    await newActivityRows(ID.bizB, 0);
    const res = await agent().get(`/timeline/businesses/${ID.bizB}/events`).set(HEADER, ID.ownerB);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length, "B's own payment rows are in its feed").toBeGreaterThan(0);
    expect(res.body.every((row: any) => row.businessId === ID.bizB)).toBe(true);

    const aIds = new Set((await activityRows(ID.bizA)).map((a) => a.id));
    expect(aIds.size, "A's payments wrote Activity rows").toBeGreaterThan(0);
    expect(res.body.filter((row: any) => aIds.has(row.id)), "A's Activity rows in B's feed").toEqual([]);
    const text = JSON.stringify(res.body);
    for (const leak of [ID.bizA, ID.invA, ID.contactA, S.partialId!, S.fullId!]) {
      expect(text.includes(leak), `B's feed mentions ${leak}`).toBe(false);
    }
    expect(res.body.some((row: any) => row.entityId === S.bPaymentId)).toBe(true);
  });

  it("EF-07: owner B on A's timeline is refused (403) and receives no row", async () => {
    const res = await agent().get(`/timeline/businesses/${ID.bizA}/events`).set(HEADER, ID.ownerB);
    expect(res.status).toBe(403);
    expect(Array.isArray(res.body)).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(S.partialId!);
  });
});

describe('idempotent replay of a recorded payment (R0-D2) is not audited (R0-19 review, R19-ST-1)', () => {
  /**
   * Replay `reference` (100, cash) on invoice A as `user` and pin that nothing
   * was written: same Payment back, no payment, posting, ContactEvent or audit
   * row, and the payment's audit trail is still its one payment.record row by
   * the owner, agreeing with Payment.recordedBy.
   */
  async function expectSilentReplay(user: string, reference: string, paymentId: string) {
    const auditBefore = await auditRows(ID.bizA);
    const txnsBefore = await db.financialTransaction.count({ where: { businessId: ID.bizA } });
    const entriesBefore = await db.ledgerEntry.count({ where: { businessId: ID.bizA } });
    emits.length = 0;

    const res = await payAs(user, ID.bizA, ID.invA, { amount: 100, method: 'cash', reference });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.payment.id).toBe(paymentId);
    expect(emits, 'the interceptor handed the emitter nothing for the replay').toEqual([]);

    expect(await db.payment.count({ where: { invoiceId: ID.invA } })).toBe(2);
    expect((await db.payment.findUnique({ where: { id: paymentId } })).recordedBy, 'Payment.recordedBy').toBe(ID.ownerA);
    expect(await db.financialTransaction.count({ where: { businessId: ID.bizA } })).toBe(txnsBefore);
    expect(await db.ledgerEntry.count({ where: { businessId: ID.bizA } })).toBe(entriesBefore);
    const events = await contactEventsFor(ID.bizA, ID.contactA, reference);
    expect(events.map((e: any) => e.actorId), 'ContactEvent invoice.payment_recorded').toEqual([ID.ownerA]);

    // Nothing reaches business_events either: this run's queue drains and the
    // business holds the rows it held before the replay.
    await sleep(300);
    await drainAuditQueue();
    expect((await auditRows(ID.bizA)).map((r) => r.id)).toEqual(auditBefore.map((r) => r.id));
    const trail = await db.businessEvent.findMany({ where: { subjectType: 'payment', subjectId: paymentId } });
    expect(trail.map((r: any) => [r.businessId, r.eventType, r.actorType, r.actorId])).toEqual([
      [ID.bizA, 'payment.record', 'human', ID.ownerA],
    ]);
  }

  it('EF-08: the owner replaying the partial payment (same reference + amount) gets the same Payment back and writes nothing: no payment, posting, ContactEvent or audit row', async () => {
    await expectSilentReplay(ID.ownerA, `${P}${RUN}-partial`, S.partialId!);
  });

  it("EF-09: an ADMIN re-submitting the owner's slip (same reference + amount) gets the same Payment back and writes no audit row naming the ADMIN; the payment keeps one payment.record row by the owner", async () => {
    await expectSilentReplay(ID.adminA, `${P}${RUN}-partial`, S.partialId!);
    const byAdmin = await db.businessEvent.findMany({ where: { businessId: ID.bizA, actorId: ID.adminA } });
    expect(byAdmin, 'audit rows attributed to the ADMIN').toEqual([]);
  });
});

describe('V1-25-EVT-BUSINESS-FEED: the business feed the cockpit reads (real DB)', () => {
  /** The page size the cockpit's BusinessTimeline asks for. */
  const COCKPIT_LIMIT = 50;
  /** The server's bound on one page of the feed. */
  const MAX_LIMIT = 200;

  /** Integer cents (D-13): the comparison unit for every amount below. */
  const cents = (v: unknown) => Math.round(Number(v) * 100);

  function feed(user: string, biz: string, query = `limit=${COCKPIT_LIMIT}`) {
    return agent().get(`/timeline/businesses/${biz}/events?${query}`).set(HEADER, user);
  }

  /** The cockpit's read of `biz`, as `user`; asserts it answered 200 with an array. */
  async function cockpitRead(user: string, biz: string): Promise<any[]> {
    const res = await feed(user, biz);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    return res.body;
  }

  it('EF-10a CONTROL: queryEvents validates its query against QueryTimelineDto, with the parameter types tsc emits', async () => {
    const ts = await import('typescript');
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(path.resolve(__dirname, '../src/modules/timeline/timeline.controller.ts'), 'utf8');
    const emitted = ts.transpileModule(source, {
      compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const end = emitted.indexOf('], TimelineController.prototype, "queryEvents", null)');
    expect(end).toBeGreaterThan(0);
    const decorators = emitted.slice(emitted.lastIndexOf('__decorate([', end), end);
    // A single-file transpile cannot see that the imported DTO is a class, so it
    // emits a guarded reference to it; reduce that to the class name.
    const types = decorators
      .match(/design:paramtypes", \[([^\]]*)\]/)?.[1]
      ?.replace(/typeof \(_\w+ = typeof \w+\.(\w+) !== "undefined" && \w+\.\1\) === "function" \? _\w+ : Object/g, '$1');
    expect(types).toBe('String, QueryTimelineDto');
    const { TimelineController } = await import('../src/modules/timeline/timeline.controller');
    const { QueryTimelineDto } = await import('../src/modules/timeline/dto/query-timeline.dto');
    expect(Reflect.getMetadata('design:paramtypes', TimelineController.prototype, 'queryEvents')).toEqual([String, QueryTimelineDto]);
  }, 30_000); // loading the TypeScript compiler alone can pass 5 s on a loaded machine

  it('EF-10: the page size is bounded: limit 10000, 201, 0, -1, 2.5 and abc answer 400 with no row', async () => {
    for (const limit of ['10000', String(MAX_LIMIT + 1), '0', '-1', '2.5', 'abc']) {
      const res = await feed(ID.ownerA, ID.bizA, `limit=${limit}`);
      expect(res.status, `limit=${limit}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(Array.isArray(res.body), `limit=${limit} answered rows`).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain(S.partialId!);
    }
  });

  it('EF-10b: a limit within the bound (200, 50, 1) is read as a number and answers at most that many rows; minRevenueImpact is read as a number', async () => {
    const total = (await activityRows(ID.bizA)).length;
    expect(total, 'A has more than one feed row').toBeGreaterThan(1);
    for (const limit of [MAX_LIMIT, COCKPIT_LIMIT, 1]) {
      const res = await feed(ID.ownerA, ID.bizA, `limit=${limit}`);
      expect(res.status, `limit=${limit}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toHaveLength(Math.min(limit, total));
      expect(res.body.every((row: any) => row.businessId === ID.bizA)).toBe(true);
    }
    const minImpact = await feed(ID.ownerA, ID.bizA, `limit=${COCKPIT_LIMIT}&minRevenueImpact=1`);
    expect(minImpact.status, JSON.stringify(minImpact.body)).toBe(200);
    expect(minImpact.body.every((row: any) => Number(row.revenueImpact) >= 1)).toBe(true);
  });

  it("EF-11: A's feed, read as the cockpit reads it, holds one FINANCE payment_recorded row per payment with its amount and the commerce paid row with the invoice total", async () => {
    // invoice.paid is recorded once for A, by the final payment (EF-02); the
    // full app's EventEmitter hands it to ActivityEventListener.onInvoicePaid.
    const paid = bus.filter((e) => e.name === 'invoice.paid');
    expect(paid.map((e) => [e.payload.businessId, e.payload.invoice?.id])).toEqual([[ID.bizA, ID.invA]]);
    const { ActivityEventListener } = await import('../src/modules/flow/activity-event.listener');
    const { ActivityService } = await import('../src/modules/flow/activity.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const listener = new ActivityEventListener(new ActivityService(app.get(PrismaService)));
    await listener.onInvoicePaid(paid[0].payload);

    const rows = await cockpitRead(ID.ownerA, ID.bizA);
    expect(rows.every((row) => row.businessId === ID.bizA)).toBe(true);
    // Newest first.
    const times = rows.map((row) => new Date(row.occurredAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const payments = rows.filter((row) => row.module === 'FINANCE' && row.action === 'payment_recorded');
    expect(payments.map((row) => row.entityId).sort()).toEqual([S.partialId, S.fullId].sort());
    const byPayment = new Map(payments.map((row) => [row.entityId, row]));
    expect(byPayment.get(S.partialId)).toMatchObject({ entityType: 'payment', data: { amount: 100, currency: 'TTD' } });
    expect(byPayment.get(S.fullId)).toMatchObject({ entityType: 'payment', data: { amount: 150, currency: 'TTD' } });
    // W3-V1-55c (D-90): the cockpit reads who recorded each payment on its FINANCE row.
    for (const id of [S.partialId, S.fullId]) {
      expect(byPayment.get(id), `FINANCE row of ${id}`).toMatchObject({ actorType: 'USER', actorId: ID.ownerA });
    }

    const paidRows = rows.filter((row) => row.action === 'paid');
    expect(paidRows).toHaveLength(1);
    expect(paidRows[0]).toMatchObject({
      module: 'commerce',
      entityType: 'invoice',
      entityId: ID.invA,
      title: 'Payment received',
      data: { invoiceId: ID.invA, total: INVOICE_A_TOTAL, currency: 'TTD' },
    });

    // minRevenueImpact is read as a number: only the paid row (revenueImpact 250) clears 200.
    const big = await feed(ID.ownerA, ID.bizA, `limit=${COCKPIT_LIMIT}&minRevenueImpact=200`);
    expect(big.status, JSON.stringify(big.body)).toBe(200);
    expect(big.body.map((row: any) => [row.action, row.entityId])).toEqual([['paid', ID.invA]]);
  });

  it("EF-11b (CR-V125-1, V1-55): in the full app invoice.paid also drives AutomationExecutorService.onInvoicePaid; it writes no second feed row, so A's feed holds ONE paid row for the invoice, ActivityEventListener's, with the invoice total", async () => {
    // flow.module.ts registers both listeners of invoice.paid; EF-11 delivered
    // the payload to the first, this delivers the same payload to the second
    // (real ActivityService and Prisma; its CRM task, e-mail, adapter and flow
    // runner collaborators are off the feed and stubbed). Until V1-55 it wrote
    // a second paid row ('Invoice paid') for the same invoice.
    const paid = bus.filter((e) => e.name === 'invoice.paid');
    expect(paid).toHaveLength(1);
    const { AutomationExecutorService } = await import('../src/modules/flow/automation-executor.service');
    const { ActivityService } = await import('../src/modules/flow/activity.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const prisma = app.get(PrismaService);
    const tasks: any[] = [];
    const crmStub = { addTask: async (t: unknown) => { tasks.push(t); }, logContactEvent: async () => undefined };
    const executor = new AutomationExecutorService(prisma, new ActivityService(prisma), crmStub as never, {} as never, null, null);
    const before = await activityRows(ID.bizA);
    await executor.onInvoicePaid(paid[0].payload);

    // It ran (its built-in invoice.paid rule still adds the thank-you task) and wrote no Activity row.
    expect(tasks.map((t) => [t.contactId, t.title])).toEqual([[ID.contactA, 'Send thank-you note']]);
    expect((await activityRows(ID.bizA)).map((a) => a.id), "the executor's Activity writes for invoice.paid").toEqual(before.map((a) => a.id));

    const rows = await cockpitRead(ID.ownerA, ID.bizA);
    const paidRows = rows.filter((row) => row.action === 'paid' && row.entityId === ID.invA);
    expect(paidRows, 'one invoice.paid, one feed row').toHaveLength(1);
    expect(paidRows[0]).toMatchObject({
      businessId: ID.bizA, module: 'commerce', action: 'paid', entityType: 'invoice', entityId: ID.invA,
      title: 'Payment received', category: 'PAYMENT',
    });
    expect(cents(paidRows[0].data.total)).toBe(cents(INVOICE_A_TOTAL));
    expect(paidRows[0].data.currency).toBe('TTD');
  });

  it("EF-11c (CR-V125-2; D-90, W4-FEED-COPY-COMPLETE V55-07b): A's feed holds no CRM contact mirror of a payment (no crm invoice.payment_recorded row, the shape the cockpit reader left out, BT-09): each payment's one row is its FINANCE row naming the owner; its invoice.payment_recorded ContactEvent, carrying the reference and recordedBy, stays on the contact's timeline", async () => {
    // Until W4-FEED-COPY-COMPLETE each payment also wrote a mirror (module crm,
    // entity the contact, title = action = 'invoice.payment_recorded', detail
    // the ContactEvent's JSON): CommerceService.recordPayment ->
    // CrmService.logContactEvent -> CrmTimelineService.logContactEvent carried
    // no meta.feedCopy. D-90 retires it.
    const rows = await cockpitRead(ID.ownerA, ID.bizA);
    const mirrors = rows.filter((row) => row.module === 'crm' && row.action === 'invoice.payment_recorded');
    expect(mirrors, 'no mirror of either payment (EF-01, EF-02) in the feed').toEqual([]);
    expect(await db.activity.count({ where: { businessId: ID.bizA, module: 'crm', action: 'invoice.payment_recorded' } }), 'no mirror in the table').toBe(0);

    // Each payment's one feed row: its FINANCE row, naming who recorded it.
    const finance = rows.filter((row) => row.module === 'FINANCE' && row.action === 'payment_recorded');
    expect(finance.map((row) => cents(row.data.amount)).sort()).toEqual([10_000, 15_000]);
    for (const row of finance) expect(row).toMatchObject({ entityType: 'payment', contactId: ID.contactA, actorType: 'USER', actorId: ID.ownerA });

    // The ContactEvents themselves stay, with what the mirror carried.
    const events = await db.contactEvent.findMany({ where: { businessId: ID.bizA, contactId: ID.contactA, type: 'invoice.payment_recorded' } });
    expect(events, 'one ContactEvent per payment (EF-01, EF-02)').toHaveLength(2);
    for (const e of events) {
      expect(e).toMatchObject({ actorType: 'USER', actorId: ID.ownerA, source: 'commerce' });
      expect(e.data).toMatchObject({ invoiceId: ID.invA, recordedBy: ID.ownerA });
      expect(String((e.data as any).reference)).toContain(`${P}${RUN}-`);
    }
    expect(events.map((e: any) => cents((e.data as any).amount)).sort()).toEqual([10_000, 15_000]);
  });

  it('EF-12 LEDGER: each feed amount equals its Payment row and its posting (balanced entries), in integer cents; the paid row total equals the invoice, the two payments and the two postings', async () => {
    const rows = await cockpitRead(ID.ownerA, ID.bizA);
    let paymentCents = 0;
    let postingCents = 0;
    for (const [paymentId, expected] of [[S.partialId!, 10_000], [S.fullId!, 15_000]] as const) {
      const row = rows.find((r) => r.action === 'payment_recorded' && r.entityId === paymentId);
      expect(row, `feed row for ${paymentId}`).toBeTruthy();
      const payment = await db.payment.findUnique({ where: { id: paymentId } });
      const postings = await postingsFor(ID.bizA, paymentId);
      expect(postings).toHaveLength(1);
      const entries = await db.ledgerEntry.findMany({ where: { transactionId: postings[0].id } });
      const debit = entries.reduce((s: number, e: any) => s + cents(e.debit ?? 0), 0);
      const credit = entries.reduce((s: number, e: any) => s + cents(e.credit ?? 0), 0);

      expect(cents(row.data.amount), 'feed amount').toBe(expected);
      expect(cents(payment.amount), 'Payment.amount').toBe(expected);
      expect(cents(postings[0].amount), 'posting amount').toBe(expected);
      expect(debit, 'posting debits').toBe(expected);
      expect(credit, 'posting credits').toBe(expected);
      expect(row.data.currency).toBe(payment.currency);
      expect(postings[0].currency).toBe(payment.currency);
      paymentCents += cents(payment.amount);
      postingCents += cents(postings[0].amount);
    }
    const paid = rows.find((r) => r.action === 'paid' && r.entityId === ID.invA);
    const invoice = await db.invoice.findUnique({ where: { id: ID.invA } });
    expect(cents(paid.data.total), 'paid row total').toBe(cents(invoice.total));
    expect(cents(invoice.total)).toBe(cents(INVOICE_A_TOTAL));
    expect(paymentCents, 'the two payments').toBe(cents(invoice.total));
    expect(postingCents, 'the two postings').toBe(cents(invoice.total));
  });

  it("EF-13: tenant B's feed, read as the cockpit reads it, holds none of A's rows (the paid row included); owner A on B's feed is refused", async () => {
    const rows = await cockpitRead(ID.ownerB, ID.bizB);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.businessId === ID.bizB)).toBe(true);
    const aIds = new Set((await activityRows(ID.bizA)).map((a) => a.id));
    expect(rows.filter((row) => aIds.has(row.id)), "A's rows in B's feed").toEqual([]);
    expect(rows.filter((row) => row.action === 'paid'), "B's invoice is not paid; A's paid row is not B's").toEqual([]);
    const text = JSON.stringify(rows);
    for (const leak of [ID.bizA, ID.invA, ID.contactA, S.partialId!, S.fullId!]) {
      expect(text.includes(leak), `B's feed mentions ${leak}`).toBe(false);
    }

    const refused = await feed(ID.ownerA, ID.bizB);
    expect(refused.status).toBe(403);
    expect(Array.isArray(refused.body)).toBe(false);
    expect(JSON.stringify(refused.body)).not.toContain(S.bPaymentId!);
  });

  // W4-TIMELINE-SCOPE (EF-14..EF-16; SEC-V125-1..3; owner ruling D-63, the
  // rule V1-84 FOLLOW3-D1-TIMELINE-SCOPE built in timeline-visibility.ts): the
  // three V1-25 review todos, live. Each reads A after EF-13, with the members,
  // contacts and rows scopeFixture adds (the rows through the real
  // TimelineService writers, so they carry what those writers store).
  // Meanwhile the cockpit still does not read the feed for a member whom the
  // V1-47 snapshot reports without revenue or CRM read (BusinessActivityFeed,
  // BT-06); these four timeline reads no longer rely on that. The morning
  // briefing did too (SEC-W4TS-1, TS-14) until W5-BRIEFING-SCOPE (EF-17).
  const SC = {
    staffRevNone: `${P}${RUN}_staffRevNone`, // STAFF, revenue 'none', crm read (view-all)
    staffCrmNone: `${P}${RUN}_staffCrmNone`, // STAFF, crm 'none' with crm_view 'all' (CR-W4TS-1), revenue read
    staffOwned: `${P}${RUN}_staffOwned`,     // STAFF, crm read with crm_view 'owned', revenue read
    cPriv: `${P}${RUN}_cPriv`,               // PRIVATE contact owned by the owner
    cOwn: `${P}${RUN}_cOwn`,                 // PRIVATE contact owned by staffOwned
  };

  /** The rows scopeFixture adds to A, and the money rows A held already (EF-11). */
  type ScopeRows = {
    noteA: string; notePriv: string; noteOwn: string; booking: string; due: string;
    /** Every row of A carrying money: the two FINANCE rows, the paid row (EF-11) and `due`. */
    money: string[];
    /** Every row of A naming contact A (it is TEAM and owned by no one). */
    namingA: string[];
  };
  let scopeRows: Promise<ScopeRows> | undefined;

  /** Today's local date at noon, as the summary route reads a day. */
  function todayParam(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T12:00:00`;
  }

  function scopeFixture(): Promise<ScopeRows> {
    scopeRows ??= (async () => {
      const { defaultScopesForRole } = await import('../src/core/authority/module-vocabulary');
      const { TimelineService } = await import('../src/modules/timeline/timeline.service');
      const staff = defaultScopesForRole('STAFF');
      const members: Array<[keyof typeof SC, Record<string, string>]> = [
        ['staffRevNone', { ...staff, revenue: 'none', crm: 'read', crm_view: 'all' }],
        // crm_view 'all' (review CR-W4TS-1): visibilityClause then lists TEAM
        // contact A for this member, so contact visibility does not mask the
        // crm-read rule (D-63): only that rule withholds A's rows (EF-15, EF-16).
        ['staffCrmNone', { ...staff, crm: 'none', crm_view: 'all', revenue: 'read' }],
        ['staffOwned', { ...staff, crm: 'read', crm_view: 'owned', revenue: 'read' }],
      ];
      for (const [key, permissionScopes] of members) {
        const id = SC[key];
        await db.user.create({ data: { id, email: `${P}${RUN}_${key}@test.local`, role: 'USER' } });
        await db.membership.create({ data: { id: `${id}_m`, userId: id, businessId: ID.bizA, role: 'STAFF', permissionScopes } });
      }
      await db.contact.create({ data: { id: SC.cPriv, businessId: ID.bizA, firstName: 'K19a', lastName: 'Private', visibility: 'PRIVATE', ownerId: ID.ownerA } });
      await db.contact.create({ data: { id: SC.cOwn, businessId: ID.bizA, firstName: 'K19a', lastName: 'StaffOwn', visibility: 'PRIVATE', ownerId: SC.staffOwned } });

      const timeline = app.get(TimelineService);
      const tomorrow = new Date(Date.now() + 86_400_000);
      const written = async (row: Promise<any>) => {
        const r = await row;
        expect(r?.id, 'TimelineService wrote the row').toBeTruthy();
        return r.id as string;
      };
      const noteA = await written(timeline.recordContactEvent(ID.bizA, ID.contactA, 'note_added', { detail: 'K19a note on customer A' }));
      const notePriv = await written(timeline.recordContactEvent(ID.bizA, SC.cPriv, 'note_added', { detail: 'K19a private note' }));
      const noteOwn = await written(timeline.recordContactEvent(ID.bizA, SC.cOwn, 'note_added', { detail: 'K19a staff-owned note' }));
      const booking = await written(timeline.recordEvent({
        businessId: ID.bizA, module: 'bookings', action: 'scheduled', entityType: 'booking', entityId: `${P}${RUN}_bk`,
        title: 'K19a booking (no contact)', category: 'BOOKING', status: 'SCHEDULED', startsAt: tomorrow,
      }));
      const due = await written(timeline.recordEvent({
        businessId: ID.bizA, module: 'commerce', action: 'due', entityType: 'invoice', entityId: ID.invA,
        title: `Invoice K19A-${RUN}-1 due`, detail: `TTD ${INVOICE_A_TOTAL}`, category: 'PAYMENT', status: 'SCHEDULED',
        startsAt: new Date(tomorrow.getTime() + 3_600_000), revenueImpact: INVOICE_A_TOTAL, contactId: ID.contactA,
      }));

      const finance = await db.activity.findMany({ where: { businessId: ID.bizA, module: 'FINANCE', action: 'payment_recorded' }, select: { id: true } });
      const paid = await db.activity.findMany({ where: { businessId: ID.bizA, module: 'commerce', action: 'paid' }, select: { id: true } });
      expect(finance, 'the two FINANCE rows of EF-01 / EF-02').toHaveLength(2);
      expect(paid, 'the paid row of EF-11').toHaveLength(1);
      const money = [...finance.map((r: any) => r.id), paid[0].id, due];
      return { noteA, notePriv, noteOwn, booking, due, money, namingA: [...money, noteA] };
    })();
    return scopeRows;
  }

  /** The ids of a 200 array answer, sorted. */
  async function idsOf(res: request.Response | Promise<request.Response>): Promise<string[]> {
    const r = await res;
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    return r.body.map((row: { id: string }) => row.id).sort();
  }

  function legacyFeed(user: string, query = 'limit=200') {
    return agent().get(`/api/flows/businesses/${ID.bizA}/activity?${query}`).set(HEADER, user);
  }

  function upcomingFeed(user: string, query = 'limit=200') {
    return agent().get(`/timeline/businesses/${ID.bizA}/upcoming?${query}`).set(HEADER, user);
  }

  /** The contacts a served row names: its contactId, and its entityId when its entityType is contact. */
  const contactsNamed = (row: any): string[] =>
    [row.contactId, String(row.entityType ?? '').toLowerCase() === 'contact' ? row.entityId : null].filter((v): v is string => typeof v === 'string' && v.length > 0);

  it("EF-14 (SEC-V125-1, D-63 / V1-84, W4-TIMELINE-SCOPE, was it.todo): a STAFF member with revenue 'none' gets no FINANCE / commerce / PAYMENT row (no amount, invoice total or number) from GET /timeline/businesses/:id/events, its filters, the day's summary or the legacy feed, and keeps the rows of the modules it reads; the OWNER's feed still holds every money row", async () => {
    const rows = await scopeFixture();

    const res = await feed(SC.staffRevNone, ID.bizA, 'limit=200');
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const served: any[] = res.body;
    // Rows filtered, not the read refused: it keeps the bookings row and the TEAM contact's note.
    expect(served.map((row) => row.id).sort()).toEqual([rows.booking, rows.noteA].sort());
    for (const row of served) {
      expect(['finance', 'commerce', 'revenue', 'payments', 'invoicing'], `module of ${row.id}`).not.toContain(String(row.module).toLowerCase());
      expect(['COMMERCE', 'PAYMENT', 'FINANCE'], `category of ${row.id}`).not.toContain(String(row.category).toUpperCase());
      expect(row.revenueImpact ?? null, `revenueImpact of ${row.id}`).toBeNull();
    }
    const text = JSON.stringify(served);
    for (const leak of [S.partialId!, S.fullId!, ID.invA, `K19A-${RUN}-1`, ...rows.money]) {
      expect(text.includes(leak), `the feed mentions ${leak}`).toBe(false);
    }

    // No filter reaches a money row.
    for (const query of ['category=PAYMENT', 'category=FINANCE', 'minRevenueImpact=1', 'entityType=payment', `entityType=invoice&entityId=${ID.invA}`, `contactId=${ID.contactA}`]) {
      const filtered = await idsOf(feed(SC.staffRevNone, ID.bizA, `limit=50&${query}`));
      expect(filtered.filter((id) => rows.money.includes(id)), `?${query}`).toEqual([]);
    }

    // The day's summary: no money row, so revenueImpact 0; the owner's counts the paid row and `due`.
    const day = await agent().get(`/timeline/businesses/${ID.bizA}/summary/${todayParam()}`).set(HEADER, SC.staffRevNone);
    expect(day.status, JSON.stringify(day.body).slice(0, 300)).toBe(200);
    expect(day.body.events.filter((e: any) => rows.money.includes(e.id))).toEqual([]);
    expect(day.body.revenueImpact).toBe(0);
    const ownerDay = await agent().get(`/timeline/businesses/${ID.bizA}/summary/${todayParam()}`).set(HEADER, ID.ownerA);
    expect(ownerDay.status).toBe(200);
    expect(ownerDay.body.revenueImpact, 'the paid row and the due row').toBe(INVOICE_A_TOTAL * 2);

    // The legacy feed applies the same rule.
    const legacy = await idsOf(legacyFeed(SC.staffRevNone));
    expect(legacy).toEqual([rows.booking, rows.noteA].sort());

    // OWNER control: unchanged, every money row is served.
    const owner = await idsOf(feed(ID.ownerA, ID.bizA, 'limit=200'));
    expect(rows.money.filter((id) => !owner.includes(id)), "money rows missing from the owner's feed").toEqual([]);
  });

  it("EF-15 (SEC-V125-2, D-63 / V1-84, W4-TIMELINE-SCOPE, was it.todo): a member with crm 'none' gets no contact-bearing row (?contactId= included), even with crm_view 'all' so that contact visibility would list contact A (CR-W4TS-1), and a crm_view 'owned' member gets no row naming a PRIVATE or unshared contact it cannot list (visibilityClause, M7) until the contact is shared; OWNER sees every row, the view-all ADMIN every row but those naming a PRIVATE contact it may not open", async () => {
    const rows = await scopeFixture();
    const all = [rows.noteA, rows.notePriv, rows.noteOwn, rows.booking, ...rows.money];
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { resolveCrmAccess, visibilityClause } = await import('../src/modules/crm/crm-permissions.helper');
    const listable = async (user: string) => {
      const clause = visibilityClause(await resolveCrmAccess(app.get(PrismaService), ID.bizA, user), user);
      const contacts = await db.contact.findMany({ where: { businessId: ID.bizA, ...(clause ? { AND: [clause] } : {}) }, select: { id: true } });
      return new Set<string>(contacts.map((c: any) => c.id));
    };

    // CR-W4TS-1 control: contact visibility alone (crm_view 'all') lists TEAM
    // contact A for the crm 'none' member, so what withholds A's rows below is
    // the crm-read rule (D-63; canReadActivityRow, activityPrefilter), not
    // visibilityClause. The PRIVATE contacts stay unlisted (M7).
    const crmNoneList = await listable(SC.staffCrmNone);
    expect(crmNoneList.has(ID.contactA), 'visibilityClause lists contact A for the crm none member').toBe(true);
    expect(crmNoneList.has(SC.cPriv) || crmNoneList.has(SC.cOwn)).toBe(false);

    // crm 'none' (revenue read): no row naming a contact, on /events and the legacy route.
    // One request at a time: supertest listens on the shared server per request.
    for (const read of [() => feed(SC.staffCrmNone, ID.bizA, 'limit=200'), () => legacyFeed(SC.staffCrmNone)]) {
      const r = await read();
      expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
      expect(r.body.flatMap(contactsNamed), 'contacts named by rows served to crm none').toEqual([]);
      expect(r.body.map((row: any) => row.id).sort()).toEqual([rows.booking]);
    }
    for (const contactId of [ID.contactA, SC.cPriv, SC.cOwn]) {
      expect(await idsOf(feed(SC.staffCrmNone, ID.bizA, `limit=50&contactId=${contactId}`)), `?contactId=${contactId}`).toEqual([]);
    }
    expect(await idsOf(feed(SC.staffCrmNone, ID.bizA, `limit=50&entityType=contact&entityId=${ID.contactA}`))).toEqual([]);

    // crm_view 'owned': only rows naming contacts it can list (the CRM list rule, M7).
    const ownedList = await listable(SC.staffOwned);
    expect([...ownedList], 'the owned-view member lists only its own contact').toEqual([SC.cOwn]);
    const ownedRes = await feed(SC.staffOwned, ID.bizA, 'limit=200');
    expect(ownedRes.status).toBe(200);
    expect(ownedRes.body.flatMap(contactsNamed).filter((id: string) => !ownedList.has(id)), 'rows naming contacts it cannot list').toEqual([]);
    expect(ownedRes.body.map((row: any) => row.id).sort()).toEqual([rows.booking, rows.noteOwn].sort());
    for (const contactId of [ID.contactA, SC.cPriv]) {
      expect(await idsOf(feed(SC.staffOwned, ID.bizA, `limit=50&contactId=${contactId}`)), `?contactId=${contactId}`).toEqual([]);
    }
    expect(await idsOf(legacyFeed(SC.staffOwned))).toEqual([rows.booking, rows.noteOwn].sort());

    // Shared with it, contact A becomes listable, and its rows (money rows included: it reads revenue) are served.
    await db.contactShare.create({ data: { id: `${P}${RUN}_shareA`, businessId: ID.bizA, contactId: ID.contactA, userId: SC.staffOwned, createdBy: ID.ownerA } });
    try {
      expect((await listable(SC.staffOwned)).has(ID.contactA)).toBe(true);
      expect(await idsOf(feed(SC.staffOwned, ID.bizA, 'limit=200'))).toEqual([rows.booking, rows.noteOwn, ...rows.namingA].sort());
      expect(await idsOf(feed(SC.staffOwned, ID.bizA, `limit=50&contactId=${ID.contactA}`))).toEqual([...rows.namingA].sort());
    } finally {
      await db.contactShare.delete({ where: { id: `${P}${RUN}_shareA` } });
    }
    expect(await idsOf(feed(SC.staffOwned, ID.bizA, `limit=50&contactId=${ID.contactA}`)), 'unshared again').toEqual([]);

    // OWNER control: every row, the PRIVATE contacts' included.
    const owner = await idsOf(feed(ID.ownerA, ID.bizA, 'limit=200'));
    expect(all.filter((id) => !owner.includes(id)), "rows missing from the owner's feed").toEqual([]);

    // ADMIN control (view-all): every row of A but those naming a PRIVATE
    // contact it neither owns nor is shared (M7: PRIVATE is restricted even
    // under view-all; V1-84 TS-03). The money rows and contact A's rows stay.
    const adminList = await listable(ID.adminA);
    expect(adminList.has(ID.contactA) && !adminList.has(SC.cPriv) && !adminList.has(SC.cOwn)).toBe(true);
    const admin = await idsOf(feed(ID.adminA, ID.bizA, 'limit=200'));
    expect(admin).toEqual(owner.filter((id) => id !== rows.notePriv && id !== rows.noteOwn));
    expect(rows.namingA.filter((id) => !admin.includes(id)), "contact A's rows missing from the ADMIN's feed").toEqual([]);
  });

  it('EF-16 (SEC-V125-3, V1-84, W4-TIMELINE-SCOPE, was it.todo): GET /timeline/businesses/:id/upcoming?limit=100000 and the legacy GET /api/flows/businesses/:id/activity?limit=100000 are bounded like /events (400 above TIMELINE_MAX_LIMIT, and for a limit that is not a positive integer); within the bound they answer at most that many rows, and /upcoming is filtered by the same rule', async () => {
    const rows = await scopeFixture();
    const { TIMELINE_MAX_LIMIT } = await import('../src/modules/timeline/dto/query-timeline.dto');
    expect(TIMELINE_MAX_LIMIT).toBe(MAX_LIMIT);

    for (const [name, read] of [['upcoming', upcomingFeed], ['legacy activity', legacyFeed]] as const) {
      for (const limit of ['100000', String(MAX_LIMIT + 1), '0', '-1', '2.5', 'abc']) {
        const res = await read(ID.ownerA, `limit=${limit}`);
        expect(res.status, `${name} limit=${limit}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(400);
        expect(Array.isArray(res.body), `${name} limit=${limit} answered rows`).toBe(false);
        const text = JSON.stringify(res.body);
        for (const id of rows.money) expect(text.includes(id), `${name} limit=${limit} mentions ${id}`).toBe(false);
      }
      for (const limit of [MAX_LIMIT, 1]) {
        const res = await read(ID.ownerA, `limit=${limit}`);
        expect(res.status, `${name} limit=${limit}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        expect(res.body.length).toBeLessThanOrEqual(limit);
        expect(res.body.every((row: any) => row.businessId === ID.bizA)).toBe(true);
      }
    }

    // /upcoming: the SCHEDULED rows, soonest first; a member without revenue
    // read, or without crm read (the due row names contact A, which that
    // member's crm_view 'all' would list: CR-W4TS-1), gets no money row.
    expect(await idsOf(upcomingFeed(ID.ownerA))).toEqual([rows.booking, rows.due].sort());
    const ordered = await upcomingFeed(ID.ownerA, '');
    expect(ordered.status).toBe(200);
    expect(ordered.body.map((row: any) => row.id)).toEqual([rows.booking, rows.due]);
    expect(await idsOf(upcomingFeed(SC.staffRevNone))).toEqual([rows.booking]);
    expect(await idsOf(upcomingFeed(SC.staffCrmNone)), 'the due row names contact A').toEqual([rows.booking]);
  });

  // W5-BRIEFING-SCOPE (review SEC-W4TS-1, = timeline-scope TS-14; owner ruling
  // D-63, the rule V1-84 built in timeline-visibility.ts). Before it,
  // AiController.morningBriefing (guards AuthGuard + BusinessGuard + the class
  // CrmRateLimitGuard) answered every member the `due` row with category
  // PAYMENT, revenueImpact 250, the invoice number and contact A, and
  // revenueToday 250 (confirmed on this fixture). The real AiController is
  // mounted on its own app over this suite's PrismaService and identity header;
  // its other collaborators are empty stand-ins the route never calls.
  let briefingApp: any;
  afterAll(async () => {
    if (briefingApp) await briefingApp.close();
  });

  /** GET /ai/businesses/:biz/briefing/morning as `user`, through the real AiController. */
  async function morningBriefing(user: string, biz = ID.bizA): Promise<request.Response> {
    if (!briefingApp) {
      const { Test } = await import('@nestjs/testing');
      const { EventEmitter2 } = await import('@nestjs/event-emitter');
      const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
      const { PrismaService } = await import('../src/core/prisma/prisma.service');
      const { AuthGuard } = await import('../src/core/auth/auth.guard');
      const { BusinessGuard } = await import('../src/core/auth/business.guard');
      const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
      const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
      const { AiController } = await import('../src/modules/ai/ai.controller');
      const ref = await Test.createTestingModule({
        controllers: [AiController],
        providers: [
          { provide: PrismaService, useValue: app.get(PrismaService) },
          AuthGuard,
          BusinessGuard,
          ModuleScopeGuard,
          CrmRateLimitGuard,
          { provide: EventEmitter2, useValue: { emit: () => true } },
        ],
      })
        .useMocker(() => ({}))
        .compile();
      briefingApp = ref.createNestApplication();
      // Identity attachment only, as the suite's app does. No guard is overridden.
      briefingApp.use(async (req: any, _res: any, next: any) => {
        const header = req.headers[HEADER];
        const id = typeof header === 'string' ? header : undefined;
        if (id && id.startsWith(P)) {
          const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
          if (user) req.user = { id: user.id, email: user.email, role: user.role };
        }
        next();
      });
      briefingApp.useGlobalFilters(new GlobalHttpExceptionFilter());
      await briefingApp.init();
    }
    return request(briefingApp.getHttpServer()).get(`/ai/businesses/${biz}/briefing/morning`).set(HEADER, user);
  }

  it("EF-17 (SEC-W4TS-1, D-63 / V1-84, W5-BRIEFING-SCOPE, was it.todo; = timeline-scope TS-14): GET /ai/businesses/:businessId/briefing/morning serves a member only the SCHEDULED rows the timeline rule lets them read (module scopes and contact visibility), as /upcoming does, withholds revenueToday and openInvoices from a member without revenue read and counts in activeLeads only the leads a member may list: staffRevNone and staffCrmNone get no `due` row (amount, revenueImpact, invoice number, contactId); the OWNER's briefing keeps every row and figure", async () => {
    const rows = await scopeFixture();
    // W5-BRIEFING-SCOPE fixture on A: two SCHEDULED rows naming the PRIVATE
    // contacts (through the real TimelineService), one open invoice, and three
    // leads (leadScore 80): a TEAM one, the owner's PRIVATE one, staffOwned's.
    const { TimelineService } = await import('../src/modules/timeline/timeline.service');
    const timeline = app.get(TimelineService);
    const later = new Date(Date.now() + 2 * 86_400_000);
    const scheduled = async (key: string, contactId: string) => {
      const row = await timeline.recordEvent({
        businessId: ID.bizA, module: 'bookings', action: 'scheduled', entityType: 'booking', entityId: `${P}${RUN}_${key}`,
        title: `K19a ${key} booking`, category: 'BOOKING', status: 'SCHEDULED', startsAt: later, contactId,
      });
      expect(row?.id, 'TimelineService wrote the row').toBeTruthy();
      return row.id as string;
    };
    const schedPriv = await scheduled('bkPriv', SC.cPriv);
    const schedOwn = await scheduled('bkOwn', SC.cOwn);
    await db.invoice.create({
      data: { id: `${P}${RUN}_invOpen`, invoiceNumber: `K19A-${RUN}-3`, status: 'SENT', subtotal: 40, total: 40, currency: 'TTD', businessId: ID.bizA, contactId: ID.contactA },
    });
    for (const [key, visibility, ownerId] of [['leadTeam', 'TEAM', null], ['leadPriv', 'PRIVATE', ID.ownerA], ['leadOwn', 'PRIVATE', SC.staffOwned]] as const) {
      await db.contact.create({ data: { id: `${P}${RUN}_${key}`, businessId: ID.bizA, firstName: 'K19a', lastName: key, visibility, ownerId, leadScore: 80 } });
    }

    type Briefing = { schedule: any[]; revenueToday: number; openInvoices: number; activeLeads: number };
    const read = async (user: string): Promise<Briefing> => {
      const res = await morningBriefing(user);
      expect(res.status, `${user}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
      expect(Array.isArray(res.body.schedule)).toBe(true);
      return res.body;
    };
    const scheduleIds = (b: Briefing) => b.schedule.map((row) => row.id).sort();

    // OWNER control: every SCHEDULED row of the last day and every figure.
    const since = new Date(Date.now() - 86_400_000);
    const allScheduled = (await db.activity.findMany({ where: { businessId: ID.bizA, status: 'SCHEDULED', occurredAt: { gte: since } }, select: { id: true } })).map((r: any) => r.id).sort();
    expect(allScheduled).toEqual([rows.booking, rows.due, schedPriv, schedOwn].sort());
    const owner = await read(ID.ownerA);
    expect(scheduleIds(owner)).toEqual(allScheduled);
    expect(owner.revenueToday, 'invoice A, settled by EF-02').toBe(INVOICE_A_TOTAL);
    expect(owner.openInvoices, 'the open invoice').toBe(1);
    expect(owner.activeLeads, 'the three leads').toBe(3);

    // revenue 'none' (crm read, crm_view 'all'): no `due` row and no revenue figure.
    const revNone = await read(SC.staffRevNone);
    expect(scheduleIds(revNone)).toEqual([rows.booking]);
    for (const row of revNone.schedule) {
      expect(row.revenueImpact ?? null, `revenueImpact of ${row.id}`).toBeNull();
      expect(['COMMERCE', 'PAYMENT', 'FINANCE']).not.toContain(String(row.category).toUpperCase());
    }
    const text = JSON.stringify(revNone.schedule);
    for (const leak of [rows.due, ID.invA, `K19A-${RUN}-1`, ID.contactA, SC.cPriv, SC.cOwn]) {
      expect(text.includes(leak), `the briefing mentions ${leak}`).toBe(false);
    }
    expect(revNone.revenueToday, 'revenueToday withheld').toBe(0);
    expect(revNone.openInvoices, 'openInvoices withheld').toBe(0);
    expect(revNone.activeLeads, 'the TEAM lead only').toBe(1);

    // crm 'none' (crm_view 'all', revenue read): no row naming a contact (so no
    // `due` row) and no lead; the revenue figures stay.
    const crmNone = await read(SC.staffCrmNone);
    expect(scheduleIds(crmNone)).toEqual([rows.booking]);
    expect(crmNone.schedule.flatMap(contactsNamed)).toEqual([]);
    expect(crmNone.revenueToday).toBe(INVOICE_A_TOTAL);
    expect(crmNone.openInvoices).toBe(1);
    expect(crmNone.activeLeads, 'crm none lists no contact').toBe(0);

    // crm_view 'owned': only the row naming its own contact, and its own lead.
    const owned = await read(SC.staffOwned);
    expect(scheduleIds(owned)).toEqual([rows.booking, schedOwn].sort());
    expect(owned.revenueToday).toBe(INVOICE_A_TOTAL);
    expect(owned.activeLeads, 'its own lead only').toBe(1);

    // ADMIN (view-all): every row but those naming a PRIVATE contact it may not open (M7).
    const admin = await read(ID.adminA);
    expect(scheduleIds(admin)).toEqual([rows.booking, rows.due].sort());
    expect(admin.revenueToday).toBe(INVOICE_A_TOTAL);
    expect(admin.openInvoices).toBe(1);
    expect(admin.activeLeads, 'the TEAM lead only').toBe(1);

    // The same rows /upcoming serves each member (every row here starts in the future).
    for (const [user, briefing] of [[ID.ownerA, owner], [SC.staffRevNone, revNone], [SC.staffCrmNone, crmNone], [SC.staffOwned, owned], [ID.adminA, admin]] as const) {
      expect(scheduleIds(briefing), `${user}: the briefing's rows are /upcoming's`).toEqual(await idsOf(upcomingFeed(user)));
    }

    // Tenant control: owner B on A's briefing is refused.
    const refused = await morningBriefing(ID.ownerB);
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).not.toContain(rows.due);
  });
});

describe('V1-55-EVT-ACTIVITY-DEDUPE: one Activity feed row per event, through the feed writers the full app registers (real DB, tenant C)', () => {
  const C = {
    owner: `${P}${RUN}_ownerC`,
    biz: `${P}${RUN}_bizC`,
    contactEmail: `${P}${RUN}_cc@test.local`,
  };
  const INVOICE_C_TOTAL = 300;
  /** One ACTIVE flow with a published version per trigger the executor dispatches in these steps. */
  const FLOW_TRIGGERS = ['contact.created', 'invoice.sent', 'invoice.paid', 'booking.created', 'booking.confirmed'] as const;
  const flowId = (trigger: string) => `${P}${RUN}_flowC_${trigger.replace(/\./g, '_')}`;
  const cents = (v: unknown) => Math.round(Number(v) * 100);

  const SC: { contactId?: string; invoiceId?: string; invoiceNumber?: string; partialId?: string; fullId?: string; bookingId?: string } = {};
  /** V55-09: tenant C's booking, on its own service, at a fixed start (no business hours, staff or lead time to meet). */
  const BOOKING_C = {
    serviceId: `${P}${RUN}_svcC`,
    start: new Date('2026-12-15T14:00:00.000Z'),
    end: new Date('2026-12-15T15:00:00.000Z'),
  };
  /** What the executor dispatched to the flow runner (the runner itself is off the feed). */
  const flowRuns: Array<{ businessId: string; flowId: string; ctx: any }> = [];
  /** What the executor's built-in rules asked CRM for. */
  const crmTasks: any[] = [];
  let feedModule: any;
  let feedBus: any;
  let crm: any;
  /** PR196-CRM-LIFECYCLE (D-81): the real CrmService the CRM RevenueEventListener moves a paid invoice's contact through, on the feed bus. */
  let lifecycleCrm: any;
  let bookings: any;

  type Row = { id: string; module: string; action: string; entityType: string; entityId: string | null; title: string; detail: string | null; data: any; category: string | null; contactId: string | null; actorType: string | null; actorId: string | null };
  const kind = (r: Row) => `${r.module}:${r.action}:${r.entityType}`;

  async function rowsOfC(): Promise<Row[]> {
    return db.activity.findMany({
      where: { businessId: C.biz },
      orderBy: { occurredAt: 'asc' },
      select: { id: true, module: true, action: true, entityType: true, entityId: true, title: true, detail: true, data: true, category: true, contactId: true, actorType: true, actorId: true },
    });
  }

  async function ledgerOfC() {
    return {
      txns: await db.financialTransaction.count({ where: { businessId: C.biz } }),
      entries: await db.ledgerEntry.count({ where: { businessId: C.biz } }),
    };
  }

  /**
   * One step of the journey: run `act` (the real route or service), take the
   * domain events it put on the bus, hand them to the feed writers on the real
   * EventEmitter2 (emit, as the services do), and return every Activity row C
   * gained once the writers settle, with C's ledger counts around the delivery.
   */
  async function step(act: () => Promise<void>) {
    const before = new Set((await rowsOfC()).map((r) => r.id));
    bus.length = 0;
    await act();
    const events = bus.splice(0);
    const ledgerBeforeDelivery = await ledgerOfC();
    for (const e of events) feedBus.emit(e.name, e.payload);
    // Settled: the same row count on four reads 250 ms apart.
    let rows = await rowsOfC();
    let stable = 0;
    const deadline = Date.now() + 10_000;
    while (stable < 4 && Date.now() < deadline) {
      await sleep(250);
      const next = await rowsOfC();
      stable = next.length === rows.length ? stable + 1 : 0;
      rows = next;
    }
    return {
      events: events.map((e) => e.name),
      rows: rows.filter((r) => !before.has(r.id)),
      ledgerBeforeDelivery,
      ledgerAfterDelivery: await ledgerOfC(),
    };
  }

  async function runsOf(trigger: string, n: number) {
    return waitFor(async () => flowRuns.filter((r) => r.flowId === flowId(trigger)), (runs) => runs.length >= n, 5_000);
  }

  beforeAll(async () => {
    const { Test } = await import('@nestjs/testing');
    const { EventEmitterModule, EventEmitter2 } = await import('@nestjs/event-emitter');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { ActivityService } = await import('../src/modules/flow/activity.service');
    const { ActivityEventListener } = await import('../src/modules/flow/activity-event.listener');
    const { AutomationExecutorService } = await import('../src/modules/flow/automation-executor.service');
    const { FlowRunnerService } = await import('../src/modules/flow/flow-runner.service');
    const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
    const { RevenueEventListener } = await import('../src/modules/crm/revenue-event.listener');
    const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');
    const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
    const { CrmService } = await import('../src/modules/crm/crm.service');
    const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
    const { BookingsService } = await import('../src/modules/bookings/bookings.service');

    await db.user.create({ data: { id: C.owner, email: `${P}${RUN}_ownerC@test.local`, role: 'USER' } });
    await db.business.create({ data: { id: C.biz, name: 'K19A Biz C', ownerId: C.owner, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${P}${RUN}_mC`, userId: C.owner, businessId: C.biz, role: 'OWNER' } });
    await app.get(ChartOfAccountsSeederService).ensureDefaults(C.biz);
    await db.service.create({ data: { id: BOOKING_C.serviceId, businessId: C.biz, name: 'K19A C service', duration: 60, price: 120 } });
    for (const trigger of FLOW_TRIGGERS) {
      await db.automationFlow.create({
        data: {
          id: flowId(trigger),
          businessId: C.biz,
          name: `K19A flow on ${trigger}`,
          category: 'test',
          status: 'ACTIVE',
          versions: {
            create: [{
              id: `${flowId(trigger)}_v1`,
              version: 1,
              status: 'PUBLISHED',
              publishedAt: new Date(),
              nodes: [{ id: 'trigger', type: 'trigger', data: { triggerEvent: trigger } }],
              edges: [],
            }],
          },
        },
      });
    }

    // The Activity writers the full app registers for these events, subscribed
    // by @nestjs/event-emitter's own loader with event-bus.module.ts's options.
    // Real: Prisma, ActivityService, the CRM timeline (contact events and their
    // Activity mirror). Off the feed and stubbed: the flow runner (recorded),
    // the executor's CRM task calls (recorded), e-mail, contact insights.
    feedModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
      providers: [
        { provide: PrismaService, useValue: app.get(PrismaService) },
        ActivityService,
        ActivityEventListener,
        AutomationExecutorService,
        RevenueEventListener,
        { provide: CrmTimelineService, useValue: app.get(CrmTimelineService) },
        { provide: ContactInsightService, useValue: { markStale: async () => undefined } },
        {
          provide: CrmService,
          useValue: {
            addTask: async (task: unknown) => { crmTasks.push(task); return task; },
            contactDetail: async () => ({ contact: null }),
            updateContact: async () => undefined,
            logContactEvent: async () => undefined,
            // PR196-CRM-LIFECYCLE review CR-1: RevenueEventListener.onInvoicePaid moves the paid
            // invoice's LEAD/PROSPECT contact to CLIENT (D-81) through the real CrmService on this
            // feed bus, as the full app does (a stub without the method throws a TypeError the
            // listener swallows, and the move would never reach the feed writers here).
            advanceToClientOnInvoicePaid: (input: unknown) => lifecycleCrm.advanceToClientOnInvoicePaid(input),
          },
        },
        { provide: TransactionalEmailService, useValue: {} },
        {
          provide: FlowRunnerService,
          useValue: { runFlow: async (businessId: string, id: string, ctx: unknown) => { flowRuns.push({ businessId, flowId: id, ctx }); return {}; } },
        },
      ],
    }).compile();
    await feedModule.init();
    feedBus = feedModule.get(EventEmitter2);
    // D-81: the paid-invoice move, emitting contact.updated / contact_task.created on the feed bus.
    // Real: Prisma and the compare-and-set, its ContactEvents and follow-up task rows; off the feed
    // and stubbed: plan limits, caches, the contact audit write (a ContactAuditEntry, not Activity).
    lifecycleCrm = new CrmService(
      app.get(PrismaService),
      feedBus,
      { checkLimit: async () => ({ allowed: true }) } as never,
      app.get(CrmTimelineService),
      { invalidateCache: () => undefined } as never,
      {} as never,
      { invalidateCache: () => undefined } as never,
      {} as never,
      { write: async () => undefined } as never,
      {} as never,
    );

    // The real contact-create service call (the CRM controller is not mounted
    // in this harness); its collaborators off the contact row and its event
    // are stubbed.
    crm = new CrmService(
      app.get(PrismaService),
      eventRecorder as never,
      { checkLimit: async () => ({ allowed: true }) } as never,
      app.get(CrmTimelineService),
      { invalidateCache: () => undefined } as never,
      {} as never,
      { invalidateCache: () => undefined } as never,
      {} as never,
      { write: async () => undefined } as never,
      {} as never,
    );

    // V55-09 / V55-10: the real booking create and confirm (the bookings
    // controller is not mounted in this harness). Real: Prisma (slot claim,
    // booking row) and the CRM contact event; the commerce, attribution,
    // subscription, e-mail, storefront and timeline collaborators are off
    // these two paths.
    bookings = new BookingsService(
      app.get(PrismaService),
      eventRecorder as never,
      crm,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }, 120_000);

  afterAll(async () => {
    if (feedModule) await feedModule.close();
  });

  it('wiring: the feed bus subscribes the full app\'s Activity writers to each event of the steps below (invoice.paid: ActivityEventListener, AutomationExecutorService, RevenueEventListener)', () => {
    for (const event of ['contact.created', 'invoice.created', 'invoice.sent', 'invoice.paid', 'booking.created', 'booking.confirmed']) {
      expect(feedBus.listeners(event).length, event).toBeGreaterThan(0);
    }
    expect(feedBus.listeners('invoice.paid')).toHaveLength(3);
  });

  /** V55-08 / V55-11: what the step wrote, kept for the case that pins it after the step. */
  const STEP: { contactCreate?: Awaited<ReturnType<typeof step>>; bookingCreate?: Awaited<ReturnType<typeof step>>; partialPayment?: Awaited<ReturnType<typeof step>>; settlingPayment?: Awaited<ReturnType<typeof step>> } = {};

  it("V55-01 contact create: ActivityEventListener's crm created row ('New contact') for the contact; the contact.created flow is dispatched once", async () => {
    const s = await step(async () => {
      const contact = await crm.createContact({ businessId: C.biz, firstName: 'K19a', lastName: 'CustomerC', email: C.contactEmail, actorUserId: C.owner });
      SC.contactId = contact.id;
    });
    STEP.contactCreate = s;
    expect(s.events).toContain('contact.created');
    const created = s.rows.filter((r) => kind(r) === 'crm:created:contact' && r.entityId === SC.contactId);
    const listenerRow = created.filter((r) => r.title === 'New contact');
    expect(listenerRow, "ActivityEventListener's crm created row").toHaveLength(1);
    expect(listenerRow[0]).toMatchObject({ contactId: SC.contactId, detail: 'K19a CustomerC added to CRM' });
    // Every row the step wrote: that one (V55-08), and since W3-V1-55c (CR-V155b-1,
    // V55-12) no CRM copy of CrmService's own contact.created ContactEvent
    // (meta.feedCopy=false; crm-network.service.ts's referral keeps its copy, V55-12).
    expect(s.rows.map(kind).sort()).toEqual(['crm:created:contact']);

    const runs = await runsOf('contact.created', 1);
    expect(runs.map((r) => [r.businessId, r.ctx.trigger, r.ctx.contactId])).toEqual([[C.biz, 'contact.created', SC.contactId]]);
    expect(s.ledgerAfterDelivery).toEqual(s.ledgerBeforeDelivery);
  });

  it("V55-08 (V1-55b, was it.todo): contact create writes ONE crm created row for the contact, ActivityEventListener's 'New contact'; the executor's 'New contact added' is not written, and its contact.created flow still ran once", async () => {
    const s = STEP.contactCreate!;
    expect(s, 'V55-01 ran').toBeTruthy();
    const created = s.rows.filter((r) => kind(r) === 'crm:created:contact' && r.entityId === SC.contactId);
    expect(created.map((r) => [r.title, r.detail, r.contactId])).toEqual([['New contact', 'K19a CustomerC added to CRM', SC.contactId]]);
    // A fresh read: no other crm created row for the contact landed later.
    const all = await db.activity.findMany({ where: { businessId: C.biz, module: 'crm', action: 'created', entityType: 'contact', entityId: SC.contactId } });
    expect(all.map((r: any) => r.title)).toEqual(['New contact']);
    expect(flowRuns.filter((r) => r.flowId === flowId('contact.created')).map((r) => r.ctx.contactId)).toEqual([SC.contactId]);
  });

  it('V55-02 invoice create (POST .../invoices): one commerce created row for the invoice', async () => {
    const s = await step(async () => {
      const res = await agent()
        .post(`/commerce/businesses/${C.biz}/invoices`)
        .set(HEADER, C.owner)
        .send({ contactId: SC.contactId, currency: 'TTD', items: [{ description: 'K19A C item', quantity: 1, unitPrice: INVOICE_C_TOTAL }] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      SC.invoiceId = res.body.id;
      SC.invoiceNumber = res.body.invoiceNumber;
    });
    expect(SC.invoiceId).toBeTruthy();
    expect(s.events).toContain('invoice.created');
    const created = s.rows.filter((r) => kind(r) === 'commerce:created:invoice' && r.entityId === SC.invoiceId);
    expect(created, 'commerce created rows for the invoice').toHaveLength(1);
    expect(created[0]).toMatchObject({ title: `Invoice ${SC.invoiceNumber} created`, category: 'COMMERCE', contactId: SC.contactId });
    expect(cents(created[0].data.total)).toBe(cents(INVOICE_C_TOTAL));
    expect(s.rows.map(kind).sort()).toEqual(['commerce:created:invoice', 'crm:invoice.created:contact']);
    expect(s.ledgerAfterDelivery).toEqual(s.ledgerBeforeDelivery);
  });

  it("V55-03 invoice send (PATCH .../status/sent): one commerce sent row for the invoice, ActivityEventListener's; the invoice.sent flow is dispatched once", async () => {
    const s = await step(async () => {
      const res = await agent()
        .patch(`/commerce/invoices/${SC.invoiceId}/status/sent`)
        .set(HEADER, C.owner)
        .send({ businessId: C.biz, status: 'SENT' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
    expect(s.events).toContain('invoice.sent');
    const sent = s.rows.filter((r) => kind(r) === 'commerce:sent:invoice' && r.entityId === SC.invoiceId);
    expect(sent.map((r) => r.title), 'commerce sent rows for the invoice').toEqual(['Invoice sent']);
    expect(sent[0]).toMatchObject({ detail: `Invoice ${SC.invoiceNumber} sent to K19a CustomerC`, contactId: SC.contactId });
    expect(s.rows.filter((r) => r.module === 'commerce').map(kind)).toEqual(['commerce:sent:invoice']);

    const runs = await runsOf('invoice.sent', 1);
    expect(runs.map((r) => [r.businessId, r.ctx.trigger, r.ctx.invoiceId, r.ctx.contactId])).toEqual([[C.biz, 'invoice.sent', SC.invoiceId, SC.contactId]]);
    expect(s.ledgerAfterDelivery).toEqual(s.ledgerBeforeDelivery);
  });

  it('V55-04 partial manual payment (100 of 300): its FINANCE payment_recorded row, no paid row; one posting; the feed writers add no ledger row', async () => {
    const s = await step(async () => {
      const res = await payAs(C.owner, C.biz, SC.invoiceId!, { amount: 100, method: 'cash', reference: `${P}${RUN}-c-partial` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      SC.partialId = res.body.payment.id;
    });
    STEP.partialPayment = s;
    expect((await db.invoice.findUnique({ where: { id: SC.invoiceId } })).status).toBe('PARTIALLY_PAID');
    expect(s.events).not.toContain('invoice.paid');
    const finance = s.rows.filter((r) => kind(r) === 'FINANCE:payment_recorded:payment');
    expect(finance.map((r) => r.entityId)).toEqual([SC.partialId]);
    expect(cents(finance[0].data.amount)).toBe(10_000);
    // W3-V1-55c (D-90): the FINANCE row names who recorded the payment.
    expect(finance[0]).toMatchObject({ actorType: 'USER', actorId: C.owner });
    expect(s.rows.filter((r) => r.action === 'paid'), 'a partial payment settles nothing').toEqual([]);
    // W4-FEED-COPY-COMPLETE (D-90, V55-07b below): the FINANCE row is the payment's
    // one row; its contact event gets no CRM copy.
    expect(s.rows.map(kind).sort()).toEqual(['FINANCE:payment_recorded:payment']);

    expect(await postingsFor(C.biz, SC.partialId!), 'Payment:<id>:payment_recorded posting').toHaveLength(1);
    expect(s.ledgerAfterDelivery).toEqual(s.ledgerBeforeDelivery);
  });

  it("V55-05 final manual payment (the remaining 200): its FINANCE row and ONE commerce paid row for the settled invoice, ActivityEventListener's ('Payment received'); the invoice.paid flow is dispatched once", async () => {
    const s = await step(async () => {
      const res = await payAs(C.owner, C.biz, SC.invoiceId!, { amount: 200, method: 'bank_transfer', reference: `${P}${RUN}-c-full` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      SC.fullId = res.body.payment.id;
    });
    STEP.settlingPayment = s;
    expect((await db.invoice.findUnique({ where: { id: SC.invoiceId } })).status).toBe('PAID');
    expect(s.events.filter((e) => e === 'invoice.paid')).toHaveLength(1);

    const paid = s.rows.filter((r) => kind(r) === 'commerce:paid:invoice' && r.entityId === SC.invoiceId);
    expect(paid.map((r) => r.title), 'commerce paid rows for the settled invoice').toEqual(['Payment received']);
    expect(paid[0]).toMatchObject({ category: 'PAYMENT', contactId: SC.contactId });
    expect(cents(paid[0].data.total)).toBe(cents(INVOICE_C_TOTAL));
    const finance = s.rows.filter((r) => kind(r) === 'FINANCE:payment_recorded:payment');
    expect(finance.map((r) => r.entityId)).toEqual([SC.fullId]);
    expect(cents(finance[0].data.amount)).toBe(20_000);
    // W3-V1-55c (D-90): the FINANCE row names who recorded the payment.
    expect(finance[0]).toMatchObject({ actorType: 'USER', actorId: C.owner });
    // Every Activity row the settling payment wrote: no second paid row, and
    // (V1-55b, V55-07) no CRM contact-event copy of invoice.paid; since
    // W4-FEED-COPY-COMPLETE (D-90, V55-07b below) no CRM copy of the payment's
    // own contact event either. Since PR196-CRM-LIFECYCLE (D-81) the paid
    // invoice also moves its LEAD contact (createContact's default status) to
    // CLIENT, and that move writes ONE row, ActivityEventListener's status row
    // on its contact.updated (D-08); its follow-up task writes none (review
    // CR-1 / SEC-L81-1).
    expect(s.rows.map(kind).sort()).toEqual([
      'FINANCE:payment_recorded:payment',
      'commerce:paid:invoice',
      'crm:updated:contact',
    ]);
    const moved = s.rows.filter((r) => kind(r) === 'crm:updated:contact');
    expect(moved[0]).toMatchObject({ entityId: SC.contactId, contactId: SC.contactId, title: 'Status changed' });
    expect(moved[0].data).toMatchObject({ from: 'LEAD', to: 'CLIENT' });
    const contactC = await db.contact.findUnique({ where: { id: SC.contactId }, select: { status: true, ownerId: true } });
    expect(contactC.status).toBe('CLIENT');
    const followUps = await db.contactTask.findMany({ where: { contactId: SC.contactId, source: 'lifecycle-automation' } });
    expect(followUps.map((t: any) => [t.businessId, t.status, t.assigneeId]), 'one D-81 follow-up').toEqual([[C.biz, 'OPEN', contactC.ownerId]]);

    const runs = await runsOf('invoice.paid', 1);
    expect(runs.map((r) => [r.businessId, r.ctx.trigger, r.ctx.invoiceId, r.ctx.contactId, cents(r.ctx.total)])).toEqual([
      [C.biz, 'invoice.paid', SC.invoiceId, SC.contactId, cents(INVOICE_C_TOTAL)],
    ]);
    // The executor's built-in invoice.paid rule still runs. CHARACTERIZATION (review CR-2, the
    // packet's L-13 todo; an owner decision): its built-in stage-change rule also runs on the D-81
    // move's contact.updated, as on every status change, asking for a second, unassigned task.
    expect(crmTasks.map((t) => [t.businessId, t.contactId, t.title]).sort()).toEqual([
      [C.biz, SC.contactId, 'Follow up after stage change'],
      [C.biz, SC.contactId, 'Send thank-you note'],
    ]);

    expect(await postingsFor(C.biz, SC.fullId!), 'Payment:<id>:payment_recorded posting').toHaveLength(1);
    expect(s.ledgerAfterDelivery).toEqual(s.ledgerBeforeDelivery);
  });

  it("V55-07 (V1-55b, was it.todo): the settled invoice's CRM contact event (RevenueEventListener.onInvoicePaid, from the invoice.paid emit) is kept on the contact's timeline but not copied into the feed: C's feed holds ONE row for the settlement, ActivityEventListener's paid row, and no crm invoice.paid row; the feed writers posted nothing", async () => {
    const s = STEP.settlingPayment!;
    expect(s, 'V55-05 ran').toBeTruthy();
    expect(s.rows.filter((r) => r.module === 'crm' && r.action === 'invoice.paid'), 'CRM copy of invoice.paid written by the settling payment').toEqual([]);

    // The contact's own timeline keeps the invoice.paid ContactEvent, from the event bus.
    const paidEvents = await waitFor(
      () => db.contactEvent.findMany({ where: { businessId: C.biz, contactId: SC.contactId, type: 'invoice.paid' } }),
      (rows: any[]) => rows.length >= 1,
      5_000,
    );
    expect(paidEvents.map((e: any) => [(e.data as any).invoiceId, e.actorType, e.source])).toEqual([[SC.invoiceId, 'SYSTEM', 'event-bus']]);

    // ...and no Activity copy of it, in the table or in the feed the cockpit reads.
    expect(await db.activity.count({ where: { businessId: C.biz, module: 'crm', action: 'invoice.paid' } })).toBe(0);
    const res = await agent().get(`/timeline/businesses/${C.biz}/events?limit=50`).set(HEADER, C.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const feedRows: Row[] = res.body;
    const settlement = feedRows.filter((r) => r.action === 'paid' || r.action === 'invoice.paid');
    expect(settlement.map((r) => [kind(r), r.entityId, r.title])).toEqual([['commerce:paid:invoice', SC.invoiceId, 'Payment received']]);

    // LEDGER: C holds only the two payment postings.
    const txns = await db.financialTransaction.findMany({ where: { businessId: C.biz }, orderBy: { createdAt: 'asc' } });
    expect(txns.map((t: any) => t.externalRef)).toEqual([`Payment:${SC.partialId}:payment_recorded`, `Payment:${SC.fullId}:payment_recorded`]);
  });

  it("V55-07a (D-90, W3-V1-55c): each manual payment's FINANCE payment_recorded row in C's feed, read as the cockpit reads it, names who recorded it (USER, the owner): the actor Payment.recordedBy, its posting and its ContactEvent carry", async () => {
    const res = await agent().get(`/timeline/businesses/${C.biz}/events?limit=50`).set(HEADER, C.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const feedRows: Row[] = res.body;
    for (const paymentId of [SC.partialId!, SC.fullId!]) {
      const finance = feedRows.filter((r) => kind(r) === 'FINANCE:payment_recorded:payment' && r.entityId === paymentId);
      expect(finance, `the FINANCE row of ${paymentId}`).toHaveLength(1);
      expect(finance[0]).toMatchObject({ actorType: 'USER', actorId: C.owner });
      expect((await db.payment.findUnique({ where: { id: paymentId } })).recordedBy).toBe(C.owner);
      expect((await postingsFor(C.biz, paymentId)).map((t: any) => t.createdById)).toEqual([C.owner]);
    }
    const events = await db.contactEvent.findMany({ where: { businessId: C.biz, contactId: SC.contactId, type: 'invoice.payment_recorded' } });
    expect(events.map((e: any) => [e.actorType, e.actorId]).sort()).toEqual([['USER', C.owner], ['USER', C.owner]]);
  });

  // V55-07b (D-90; W3-V1-55c todo, closed by W4-FEED-COPY-COMPLETE): since
  // W3-V1-55c the FINANCE row names the actor (V55-07a) and
  // payments-actor.integration.test.ts reads it there; CommerceService.recordPayment
  // now logs its invoice.payment_recorded ContactEvent with meta.feedCopy=false,
  // which CrmService.logContactEvent -> CrmTimelineService.logContactEvent carry
  // to CrmTimelineService.logEvent (the V1-55b switch).
  it("V55-07b (D-90, W4-FEED-COPY-COMPLETE, was it.todo): each manual payment writes ONE feed row, its FINANCE payment_recorded row naming who recorded it, and no CRM contact-event copy (crm:invoice.payment_recorded:contact); the invoice.payment_recorded ContactEvent (USER, the owner) and the payment.record audit row stay", async () => {
    const steps = [
      { label: 'partial', s: STEP.partialPayment!, paymentId: SC.partialId! },
      { label: 'final', s: STEP.settlingPayment!, paymentId: SC.fullId! },
    ];
    for (const { label, s, paymentId } of steps) {
      expect(s, `the ${label} payment step ran (V55-04 / V55-05)`).toBeTruthy();
      // What the payment wrote to Activity about itself: its FINANCE row only.
      expect(s.rows.filter((r) => kind(r) === 'crm:invoice.payment_recorded:contact'), `${label}: no CRM copy`).toEqual([]);
      const own = s.rows.filter((r) => kind(r) === 'FINANCE:payment_recorded:payment');
      expect(own.map((r) => [r.entityId, r.actorType, r.actorId]), `${label}: its FINANCE row`).toEqual([[paymentId, 'USER', C.owner]]);
      // The audit trail keeps its payment.record row (D-08: BusinessEvent is the audit).
      const audit = await waitFor(
        () => db.businessEvent.findMany({ where: { businessId: C.biz, eventType: 'payment.record', subjectId: paymentId } }),
        (rows: any[]) => rows.length >= 1,
        10_000,
      );
      expect(audit.map((a: any) => [a.subjectType, a.actorType, a.actorId]), `${label}: payment.record audit row`).toEqual([['payment', 'human', C.owner]]);
    }
    // No copy in the table either, for any payment of C.
    expect(await db.activity.count({ where: { businessId: C.biz, module: 'crm', action: 'invoice.payment_recorded' } })).toBe(0);

    // The ContactEvents stay on the contact's own timeline, one per payment, naming the owner.
    const events = await db.contactEvent.findMany({ where: { businessId: C.biz, contactId: SC.contactId, type: 'invoice.payment_recorded' }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e: any) => [(e.data as any).invoiceId, (e.data as any).recordedBy, e.actorType, e.actorId, e.source])).toEqual([
      [SC.invoiceId, C.owner, 'USER', C.owner, 'commerce'],
      [SC.invoiceId, C.owner, 'USER', C.owner, 'commerce'],
    ]);
    expect(events.map((e: any) => cents((e.data as any).amount))).toEqual([10_000, 20_000]);

    // The cockpit read: one row per payment.
    const res = await agent().get(`/timeline/businesses/${C.biz}/events?limit=50`).set(HEADER, C.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const paymentRows = (res.body as Row[]).filter((r) => r.action === 'payment_recorded' || r.action === 'invoice.payment_recorded');
    expect(paymentRows.map((r) => [kind(r), r.entityId]).sort()).toEqual(
      [['FINANCE:payment_recorded:payment', SC.partialId], ['FINANCE:payment_recorded:payment', SC.fullId]].sort(),
    );
  });

  it("V55-09 booking create (BookingsService.createBooking): the feed says when the booking is: ActivityEventListener's bookings created row ('New booking') names the contact and carries the start time; the booking.created flow is dispatched once", async () => {
    const s = await step(async () => {
      const booking = await bookings.createBooking({
        businessId: C.biz,
        contactId: SC.contactId,
        serviceId: BOOKING_C.serviceId,
        startTime: BOOKING_C.start,
        endTime: BOOKING_C.end,
        actorUserId: C.owner,
      });
      SC.bookingId = booking.id;
    });
    STEP.bookingCreate = s;
    expect(SC.bookingId).toBeTruthy();
    expect(s.events).toContain('booking.created');
    const created = s.rows.filter((r) => kind(r) === 'bookings:created:booking' && r.entityId === SC.bookingId);
    const when = new Date(BOOKING_C.start).toLocaleString();
    const timed = created.filter((r) => typeof r.detail === 'string' && r.detail.includes(when));
    expect(timed, `a bookings created row whose detail carries the start time (${when})`).toHaveLength(1);
    expect(timed[0]).toMatchObject({ title: 'New booking', contactId: SC.contactId });
    expect(timed[0].detail).toContain('K19a CustomerC');
    // Every row the step wrote: that one (V55-11). Since W4-FEED-COPY-COMPLETE (D-90,
    // V55-12b below) BookingsService's own booking.created ContactEvent gets no CRM copy.
    expect(s.rows.map(kind).sort()).toEqual(['bookings:created:booking']);

    const runs = await runsOf('booking.created', 1);
    expect(runs.map((r) => [r.businessId, r.ctx.trigger, r.ctx.bookingId, r.ctx.contactId])).toEqual([[C.biz, 'booking.created', SC.bookingId, SC.contactId]]);
    expect(s.ledgerAfterDelivery).toEqual(s.ledgerBeforeDelivery);
  });

  it("V55-11 (V1-55b, was it.todo; CR-V155-1): booking create writes ONE bookings created row, ActivityEventListener's, and it carries the booking's start time: 'New booking' / '<contact> booked an appointment for <start>'; the executor's 'New booking from <contact>' row is not written", async () => {
    const s = STEP.bookingCreate!;
    expect(s, 'V55-09 ran').toBeTruthy();
    const when = new Date(BOOKING_C.start).toLocaleString();
    const created = s.rows.filter((r) => kind(r) === 'bookings:created:booking' && r.entityId === SC.bookingId);
    expect(created.map((r) => [r.title, r.detail, r.contactId])).toEqual([['New booking', `K19a CustomerC booked an appointment for ${when}`, SC.contactId]]);
    expect(new Date(created[0].data.startTime).getTime(), 'the row data keeps the start time').toBe(BOOKING_C.start.getTime());
    // A fresh read: no other bookings created row for the booking landed later.
    const all = await db.activity.findMany({ where: { businessId: C.biz, module: 'bookings', action: 'created', entityId: SC.bookingId } });
    expect(all.map((r: any) => r.title)).toEqual(['New booking']);
    expect(flowRuns.filter((r) => r.flowId === flowId('booking.created')).map((r) => r.ctx.bookingId)).toEqual([SC.bookingId]);
  });

  it("V55-10 booking confirm (BookingsService.confirmBooking): ONE bookings confirmed row, ActivityEventListener's ('Booking confirmed', the contact); the booking.confirmed flow is dispatched once", async () => {
    const s = await step(async () => {
      const booking = await bookings.confirmBooking(SC.bookingId);
      expect(booking.status).toBe('CONFIRMED');
    });
    expect(s.events).toContain('booking.confirmed');
    const confirmed = s.rows.filter((r) => kind(r) === 'bookings:confirmed:booking' && r.entityId === SC.bookingId);
    expect(confirmed.map((r) => r.title), 'bookings confirmed rows for the booking').toEqual(['Booking confirmed']);
    expect(confirmed[0]).toMatchObject({ detail: 'Appointment confirmed', contactId: SC.contactId });
    expect(s.rows.map(kind).sort()).toEqual(['bookings:confirmed:booking', 'crm:booking.confirmed:contact']);

    const runs = await runsOf('booking.confirmed', 1);
    expect(runs.map((r) => [r.businessId, r.ctx.trigger, r.ctx.bookingId, r.ctx.contactId])).toEqual([[C.biz, 'booking.confirmed', SC.bookingId, SC.contactId]]);
    expect(s.ledgerAfterDelivery).toEqual(s.ledgerBeforeDelivery);
  });

  it("V55-06 C's feed, read as the cockpit reads it, shows each step's row once; each flow ran once; LEDGER: C holds exactly the two payment postings, balanced, summing to the invoice", async () => {
    const res = await agent().get(`/timeline/businesses/${C.biz}/events?limit=50`).set(HEADER, C.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows: Row[] = res.body;
    expect(rows.every((r: any) => r.businessId === C.biz)).toBe(true);
    const count = (k: string, entityId: string | undefined) => rows.filter((r) => kind(r) === k && r.entityId === entityId).length;
    // V1-55b (V55-08): one crm created row for the contact (its CRM copy is
    // pinned below: CR-V155b-1 residual).
    expect(count('crm:created:contact', SC.contactId), 'contact created').toBe(1);
    expect(count('commerce:created:invoice', SC.invoiceId), 'invoice created').toBe(1);
    expect(count('commerce:sent:invoice', SC.invoiceId), 'invoice sent').toBe(1);
    expect(count('commerce:paid:invoice', SC.invoiceId), 'invoice paid').toBe(1);
    expect(count('FINANCE:payment_recorded:payment', SC.partialId), 'partial payment').toBe(1);
    expect(count('FINANCE:payment_recorded:payment', SC.fullId), 'final payment').toBe(1);
    // V1-55b (V55-11): one bookings created row for the booking, and that row
    // carries the start time (its CRM copy is pinned below: CR-V155b-1 residual).
    expect(count('bookings:created:booking', SC.bookingId), 'booking created').toBe(1);
    expect(
      rows.filter((r) => kind(r) === 'bookings:created:booking' && r.entityId === SC.bookingId && String(r.detail).includes(new Date(BOOKING_C.start).toLocaleString())),
      'the booking created row with the start time',
    ).toHaveLength(1);
    expect(count('bookings:confirmed:booking', SC.bookingId), 'booking confirmed').toBe(1);
    // V1-55b (V55-07): no CRM contact-event copy of the settlement.
    expect(rows.filter((r) => r.module === 'crm' && r.action === 'invoice.paid')).toEqual([]);
    // W3-V1-55c (CR-V155b-1, V55-12): contact create's CRM ContactEvent copy is
    // no longer written, so the cockpit shows contact create once.
    expect(rows.filter((r) => kind(r) === 'crm:contact.created:contact' && r.entityId === SC.contactId), 'contact.created: no CRM copy').toEqual([]);
    // W4-FEED-COPY-COMPLETE (CR-V155b-1, D-90, V55-12b): booking create's CRM
    // ContactEvent copy is no longer written, so the cockpit shows booking
    // create once (until then the copy, in the shape the cockpit reader keeps,
    // stood beside the listener's row: two rows, as at base).
    const bookingCopies = rows.filter((r) => kind(r) === 'crm:booking.created:contact' && r.entityId === SC.contactId);
    expect(bookingCopies.map((r) => [r.title, r.contactId]), 'booking.created: no CRM copy').toEqual([]);
    // W4-FEED-COPY-COMPLETE (D-90, V55-07b): no CRM copy of either payment's contact event.
    expect(rows.filter((r) => kind(r) === 'crm:invoice.payment_recorded:contact'), 'invoice.payment_recorded: no CRM copy').toEqual([]);

    expect(flowRuns.map((r) => r.flowId).sort()).toEqual(FLOW_TRIGGERS.map(flowId).sort());

    const txns = await db.financialTransaction.findMany({ where: { businessId: C.biz }, orderBy: { createdAt: 'asc' } });
    expect(txns.map((t: any) => t.externalRef)).toEqual([
      `Payment:${SC.partialId}:payment_recorded`,
      `Payment:${SC.fullId}:payment_recorded`,
    ]);
    const entries = await db.ledgerEntry.findMany({ where: { businessId: C.biz } });
    const txnIds = new Set(txns.map((t: any) => t.id));
    expect(entries.filter((e: any) => !txnIds.has(e.transactionId)), 'ledger entries outside the two postings').toEqual([]);
    let total = 0;
    for (const t of txns) {
      const own = entries.filter((e: any) => e.transactionId === t.id);
      const debit = own.reduce((sum: number, e: any) => sum + cents(e.debit ?? 0), 0);
      const credit = own.reduce((sum: number, e: any) => sum + cents(e.credit ?? 0), 0);
      expect(debit, `${t.externalRef} balanced`).toBe(credit);
      expect(debit).toBe(cents(t.amount));
      total += cents(t.amount);
    }
    expect(total).toBe(cents(INVOICE_C_TOTAL));
  });

  // V55-07, V55-08 and V55-11 (V1-55 todos) are cases above, after the step
  // each one pins (V1-55b-FEED-DEDUPE-REST).

  // V55-12, the CR-V155b-1 residual for contact create (W3-V1-55c, was it.todo).
  it("V55-12 (CR-V155b-1, W3-V1-55c, was it.todo): contact create shows ONE row in the cockpit, ActivityEventListener's 'New contact': CrmService.createContact's contact.created ContactEvent stays on the contact's timeline with no Activity copy (meta.feedCopy=false, as V1-55b did for invoice.paid); a referral contact (crm-network.service.ts, no contact.created emit) keeps its copy as its only row", async () => {
    const s = STEP.contactCreate!;
    expect(s, 'V55-01 ran').toBeTruthy();
    // What the contact create wrote to Activity: the listener's row, no copy.
    expect(s.rows.filter((r) => r.entityId === SC.contactId).map((r) => [kind(r), r.title])).toEqual([['crm:created:contact', 'New contact']]);
    // The ContactEvent itself stays on the contact's own timeline.
    const created = await db.contactEvent.findMany({ where: { businessId: C.biz, contactId: SC.contactId, type: 'contact.created' } });
    expect(created.map((e: any) => [e.contactId, (e.data as any).firstName, (e.data as any).lastName])).toEqual([[SC.contactId, 'K19a', 'CustomerC']]);
    expect(await db.activity.count({ where: { businessId: C.biz, module: 'crm', action: 'contact.created', entityId: SC.contactId } })).toBe(0);
    // The cockpit read: one row for the contact's creation.
    const res = await agent().get(`/timeline/businesses/${C.biz}/events?limit=50`).set(HEADER, C.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const creation = (res.body as Row[]).filter((r) => r.entityId === SC.contactId && (kind(r) === 'crm:created:contact' || kind(r) === 'crm:contact.created:contact'));
    expect(creation.map((r) => [kind(r), r.title])).toEqual([['crm:created:contact', 'New contact']]);

    // Control: a referral creates its contact without the contact.created emit
    // (no listener row), so its ContactEvent copy stays its only feed row.
    const { CrmNetworkService } = await import('../src/modules/crm/crm-network.service');
    const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const network = new CrmNetworkService(app.get(PrismaService), app.get(CrmTimelineService), {} as never);
    bus.length = 0;
    const referral = await network.referContact({ businessId: C.biz, referrerContactId: SC.contactId!, target: { firstName: 'K19a', lastName: 'Referred' } });
    expect(bus.map((e) => e.name)).not.toContain('contact.created');
    const referred = await waitFor(
      () => db.activity.findMany({ where: { businessId: C.biz, entityId: referral.targetContactId } }),
      (rows: any[]) => rows.length >= 1,
      5_000,
    );
    await sleep(500);
    const settled = await db.activity.findMany({ where: { businessId: C.biz, entityId: referral.targetContactId } });
    expect(referred.length).toBeGreaterThan(0);
    expect(settled.map((r: any) => [kind(r), r.title])).toEqual([['crm:contact.created:contact', 'contact.created']]);
  });

  // W3-V1-55c review (SEC-V55C-1, CR-V155c-1; D-90, D-08): once the CRM copy
  // is gone, 'New contact' is the contact create's one feed row, so it names
  // who created the contact, as the copy did (USER and the member, category
  // CONTACT), not SYSTEM.
  it("V55-12a (SEC-V55C-1, CR-V155c-1, D-90, W3-V1-55c): a member's contact create, as POST /crm/businesses/:b/contacts calls it (audit actor USER), shows ONE cockpit row and it names the member: ActivityEventListener's 'New contact' carries actorType USER, actorId the member and category CONTACT, as its ContactEvent does, so ?actorType=USER and ?category=CONTACT return it and ?actorType=SYSTEM does not; a create with no audit actor (V55-01) names none, as its ContactEvent", async () => {
    let id = '';
    const s = await step(async () => {
      const contact = await crm.createContact(
        { businessId: C.biz, firstName: 'K19a', lastName: 'Member', email: `${P}${RUN}_member@test.local`, actorUserId: C.owner },
        // The audit context crm.controller.ts's createContact passes (userAuditContext).
        { actor: { type: 'USER', id: C.owner } },
      );
      id = contact.id;
    });
    expect(s.events).toContain('contact.created');
    // The one feed row the create wrote names the member.
    expect(s.rows.filter((r) => r.entityId === id).map((r) => [kind(r), r.title, r.actorType, r.actorId, r.category])).toEqual([
      ['crm:created:contact', 'New contact', 'USER', C.owner, 'CONTACT'],
    ]);
    // The same actor its ContactEvent records (and no Activity copy of it).
    const ce = await db.contactEvent.findMany({ where: { businessId: C.biz, contactId: id, type: 'contact.created' } });
    expect(ce.map((e: any) => [e.actorType, e.actorId])).toEqual([['USER', C.owner]]);
    expect(await db.activity.count({ where: { businessId: C.biz, module: 'crm', action: 'contact.created', entityId: id } })).toBe(0);

    // The cockpit's filtered reads: by actor and by category.
    const read = async (query: string) => {
      const res = await agent().get(`/timeline/businesses/${C.biz}/events?limit=50&${query}`).set(HEADER, C.owner);
      expect(res.status, `${query}: ${JSON.stringify(res.body)}`).toBe(200);
      return (res.body as Row[]).filter((r) => r.entityId === id).map((r) => [kind(r), r.title, r.actorType, r.actorId]);
    };
    expect(await read('actorType=USER')).toEqual([['crm:created:contact', 'New contact', 'USER', C.owner]]);
    expect(await read('category=CONTACT')).toEqual([['crm:created:contact', 'New contact', 'USER', C.owner]]);
    expect(await read('actorType=SYSTEM')).toEqual([]);

    // Control: V55-01's create names no audit actor; its ContactEvent names
    // none, and its row invents none (SYSTEM, no actorId), category CONTACT.
    const control = STEP.contactCreate!.rows.filter((r) => r.entityId === SC.contactId);
    expect(control.map((r) => [r.title, r.actorType, r.actorId, r.category])).toEqual([['New contact', 'SYSTEM', null, 'CONTACT']]);
    const controlEvent = await db.contactEvent.findMany({ where: { businessId: C.biz, contactId: SC.contactId, type: 'contact.created' } });
    expect(controlEvent.map((e: any) => [e.actorType, e.actorId])).toEqual([[null, null]]);
  });

  // V55-12b, the CR-V155b-1 residual for booking create (W3-V1-55c todo, closed by
  // W4-FEED-COPY-COMPLETE, D-90): BookingsService.createBooking logs its
  // booking.created ContactEvent with meta.feedCopy=false, which
  // CrmService.logContactEvent -> CrmTimelineService.logContactEvent now carry.
  // The storefront booking's copy (PublicEventsService.logStorefrontEvent) is the
  // same class and outside this packet.
  it("V55-12b (CR-V155b-1, D-90, W4-FEED-COPY-COMPLETE, was it.todo): booking create shows ONE row in the cockpit, ActivityEventListener's 'New booking': BookingsService.createBooking's booking.created ContactEvent stays on the contact's timeline with no Activity copy (meta.feedCopy=false through CrmService.logContactEvent, as V55-12 for contact create); booking confirm's copy is not in D-90 and stays", async () => {
    const s = STEP.bookingCreate!;
    expect(s, 'V55-09 ran').toBeTruthy();
    // What the booking create wrote to Activity: the listener's row, no copy.
    expect(s.rows.map((r) => [kind(r), r.entityId, r.title])).toEqual([['bookings:created:booking', SC.bookingId, 'New booking']]);
    // The ContactEvent itself stays on the contact's own timeline.
    const created = await db.contactEvent.findMany({ where: { businessId: C.biz, contactId: SC.contactId, type: 'booking.created' } });
    expect(created.map((e: any) => [(e.data as any).bookingId, new Date((e.data as any).startTime).getTime(), e.actorType, e.source])).toEqual([
      [SC.bookingId, BOOKING_C.start.getTime(), 'SYSTEM', 'bookings'],
    ]);
    expect(await db.activity.count({ where: { businessId: C.biz, module: 'crm', action: 'booking.created' } })).toBe(0);
    // The cockpit read: one row for the booking's creation.
    const res = await agent().get(`/timeline/businesses/${C.biz}/events?limit=50`).set(HEADER, C.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const creation = (res.body as Row[]).filter((r) => (kind(r) === 'bookings:created:booking' && r.entityId === SC.bookingId) || kind(r) === 'crm:booking.created:contact');
    expect(creation.map((r) => [kind(r), r.title])).toEqual([['bookings:created:booking', 'New booking']]);

    // Control: only booking create's copy goes. Booking confirm (V55-10) keeps
    // its CRM ContactEvent copy beside the listener's row (not in D-90).
    expect(await db.activity.count({ where: { businessId: C.biz, module: 'crm', action: 'booking.confirmed', entityId: SC.contactId } })).toBe(1);
  });

  // W4-FEED-COPY-COMPLETE review SEC-FCC-1 (owner rulings D-90 and D-63, the
  // V1-84 timeline rule): CrmTimelineService.logEvent mapped a ContactEvent's
  // category to the copy's Activity category by names @keyflow/shared no longer
  // uses ('revenue', 'booking', 'payment', ...), so every copy was written with
  // category CONTACT, and canReadActivityRow (timeline-visibility.ts), which
  // reads COMMERCE / PAYMENT / FINANCE or a revenueImpact as money, served a
  // money copy, its amount included, to a member with crm read and revenue
  // 'none'. A copy that carries money is now written with category COMMERCE.
  it("V55-13 (SEC-FCC-1, D-90 / D-63 review, W4-FEED-COPY-COMPLETE): a CRM Activity copy that carries money is written with category COMMERCE, so a member with crm read and revenue 'none' is not served it (no amount) and the owner is: mark-paid's invoice.paid copy (sales_revenue), a store_order.paid copy (its total) and a referral note.created copy (its invoice total); a copy with no amount keeps category CONTACT and stays served to that member", async () => {
    const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
    const timeline = app.get(CrmTimelineService);
    const staff = `${P}${RUN}_staffC`;
    const contactId = `${P}${RUN}_cTeamC`;
    const invoiceId = `${P}${RUN}_invC2`;
    const TOTAL = 8765.25;
    await db.user.create({ data: { id: staff, email: `${P}${RUN}_staffC@test.local`, role: 'USER' } });
    await db.membership.create({ data: { id: `${P}${RUN}_mCs`, userId: staff, businessId: C.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none' } } });
    await db.contact.create({ data: { id: contactId, businessId: C.biz, firstName: 'K19a', lastName: 'TeamC', visibility: 'TEAM', ownerId: C.owner } });
    await db.invoice.create({
      data: {
        id: invoiceId,
        invoiceNumber: `K19A-${RUN}-C2`,
        status: 'SENT',
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        businessId: C.biz,
        contactId,
        items: { create: [{ id: `${invoiceId}_item1`, description: 'K19A C2 item', quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
      },
    });

    // The copy D-90 leaves: CommerceService.markInvoicePaid's invoice.paid ContactEvent (sales_revenue).
    const marked = await agent().patch(`/commerce/invoices/${invoiceId}/paid?businessId=${C.biz}`).set(HEADER, C.owner).send({});
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    // store_order.paid (delivery_operations), as RevenueEventListener.onStoreOrderPaid logs it.
    await timeline.logEvent(C.biz, contactId, 'store_order.paid', { orderId: `${P}${RUN}_orderC`, total: 432.1, currency: 'TTD' }, { source: 'event-bus' });
    // note.created (crm_movement), as CrmNetworkService logs a referral's paid invoice.
    await timeline.logEvent(C.biz, contactId, 'note.created', { kind: 'referral.deal_won', referredContactId: SC.contactId, invoiceId: SC.invoiceId, total: 300 }, { source: 'crm-network' });
    // Control: a copy with no amount.
    await timeline.logEvent(C.biz, contactId, 'communication.call', { summary: 'K19a call' }, { actorType: 'USER', actorId: C.owner, source: 'crm' });

    const copies: Row[] = await waitFor(
      () => db.activity.findMany({ where: { businessId: C.biz, module: 'crm', contactId } }),
      (rows: any[]) => rows.length >= 4,
      5_000,
    );
    expect(copies.map((r) => [r.action, r.entityType, r.category]).sort()).toEqual([
      ['communication.call', 'contact', 'CONTACT'],
      ['invoice.paid', 'contact', 'COMMERCE'],
      ['note.created', 'contact', 'COMMERCE'],
      ['store_order.paid', 'contact', 'COMMERCE'],
    ]);
    // The mark-paid copy carries the invoice total (why it is a money row).
    const paidCopy = copies.find((r) => r.action === 'invoice.paid')!;
    expect(cents(JSON.parse(paidCopy.detail!).total)).toBe(cents(TOTAL));

    const read = async (user: string, query = '') => {
      const res = await agent().get(`/timeline/businesses/${C.biz}/events?limit=200&contactId=${contactId}${query}`).set(HEADER, user);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body as Row[];
    };
    // crm read, revenue 'none': the copy with no amount only, and no amount in anything served.
    const served = await read(staff);
    expect(served.map(kind)).toEqual(['crm:communication.call:contact']);
    for (const amount of ['8765.25', '432.1', '"total"']) expect(JSON.stringify(served)).not.toContain(amount);
    expect(await read(staff, '&category=COMMERCE')).toEqual([]);
    // The owner reads every copy, the three money copies under ?category=COMMERCE.
    const owner = await read(C.owner);
    expect(owner.filter((r) => r.module === 'crm').map(kind).sort()).toEqual([
      'crm:communication.call:contact',
      'crm:invoice.paid:contact',
      'crm:note.created:contact',
      'crm:store_order.paid:contact',
    ]);
    expect((await read(C.owner, '&category=COMMERCE')).map(kind).sort()).toEqual([
      'crm:invoice.paid:contact',
      'crm:note.created:contact',
      'crm:store_order.paid:contact',
    ]);
  });

  // W5-FEED-CATEGORIES (SEC-FCC-1 residual; owner rulings D-90 and D-63, the
  // V1-84 timeline rule): V55-13 fixed the category of copies written from
  // then on; the copies already stored keep category CONTACT (or none, before
  // categories existed) with their amount in data. No data migration:
  // canReadActivityRow (timeline-visibility.ts) reads a stored row whose data
  // carries a money field (the field list V55-13 uses) as a revenue row
  // whatever its category. The rows here are written as those older writers
  // stored them.
  it("V55-13b (SEC-FCC-1, D-90 / D-63, W5-FEED-CATEGORIES, was it.todo): a CRM copy already stored with category CONTACT or none whose data carries money (a crm:invoice.payment_recorded:contact row written before D-90, invoice.paid / store_order.paid / storefront booking.created copies written before V55-13) is not served to a member with crm read and revenue 'none' (no amount) on /events, ?category=CONTACT, the day's summary or the legacy feed, and is served to the owner; the stored rows are unchanged (no backfill), and copies with no money field stay served to that member", async () => {
    const staff = `${P}${RUN}_staffC13b`;
    const contactId = `${P}${RUN}_cTeamC13b`;
    await db.user.create({ data: { id: staff, email: `${P}${RUN}_staffC13b@test.local`, role: 'USER' } });
    await db.membership.create({ data: { id: `${P}${RUN}_mC13b`, userId: staff, businessId: C.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none' } } });
    await db.contact.create({ data: { id: contactId, businessId: C.biz, firstName: 'K19a', lastName: 'TeamC13b', visibility: 'TEAM', ownerId: C.owner } });

    /** A CRM copy as CrmTimelineService.logEvent stored it: raw event name as title, data as JSON detail. */
    const stored = (key: string, action: string, category: string | null, data: Record<string, unknown>) => ({
      id: `${P}${RUN}_c13b_${key}`,
      businessId: C.biz,
      module: 'crm',
      action,
      entityType: 'contact',
      entityId: contactId,
      title: action,
      detail: JSON.stringify(data),
      contactId,
      category,
      type: action,
      actorType: 'SYSTEM',
      data,
    });
    const MONEY = [
      // The pre-D-90 copy of a manual payment's ContactEvent (CommerceService.recordPayment's data).
      stored('payRec', 'invoice.payment_recorded', 'CONTACT', {
        invoiceId: SC.invoiceId, amount: 1357.91, method: 'bank_transfer', reference: `${P}${RUN}-c13b`,
        totalPaid: 1357.91, invoiceTotal: 2468.02, newStatus: 'PARTIALLY_PAID', overPaid: 0, recordedBy: C.owner,
      }),
      // Pre-V55-13 copies: mark-paid's invoice.paid (sales_revenue) and a store order's paid copy.
      stored('paid', 'invoice.paid', 'CONTACT', { invoiceId: SC.invoiceId, total: 6543.21, currency: 'TTD' }),
      stored('order', 'store_order.paid', 'CONTACT', { orderId: `${P}${RUN}_orderC13b`, total: 98.76, currency: 'TTD' }),
      // A copy stored before Activity.category existed: no category at all.
      stored('deposit', 'booking.created', null, { bookingId: `${P}${RUN}_bkC13b`, depositAmount: 24.68, currency: 'TTD' }),
    ];
    const PLAIN = [
      stored('call', 'communication.call', 'CONTACT', { summary: 'K19a C13b call' }),
      stored('note', 'note.created', null, { body: 'K19a C13b note' }),
    ];
    await db.activity.createMany({ data: [...MONEY, ...PLAIN] });
    const moneyIds = MONEY.map((r) => r.id).sort();
    const plainIds = PLAIN.map((r) => r.id).sort();
    const LEAKS = ['1357.91', '2468.02', '6543.21', '98.76', '24.68', '"amount"', '"total"', '"depositAmount"', '"invoiceTotal"', '"totalPaid"'];
    const expectNoAmount = (served: unknown, where: string) => {
      const text = JSON.stringify(served);
      for (const leak of LEAKS) expect(text.includes(leak), `${where} mentions ${leak}`).toBe(false);
    };
    const read = async (user: string, query = '') => {
      const res = await agent().get(`/timeline/businesses/${C.biz}/events?limit=200&contactId=${contactId}${query}`).set(HEADER, user);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body as Row[];
    };
    const ids = (rows: Row[]) => rows.map((r) => r.id).sort();

    // crm read, revenue 'none': the copies with no money field only, no amount anywhere.
    const served = await read(staff);
    expect(ids(served)).toEqual(plainIds);
    expectNoAmount(served, '/events');
    // ?category=CONTACT (the stored category of the money copies) does not reach them either.
    const contactCategory = await read(staff, '&category=CONTACT');
    expect(ids(contactCategory)).toEqual([`${P}${RUN}_c13b_call`]);
    expectNoAmount(contactCategory, '?category=CONTACT');

    // The day's summary and the legacy feed apply the same rule.
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T12:00:00`;
    const day = await agent().get(`/timeline/businesses/${C.biz}/summary/${today}`).set(HEADER, staff);
    expect(day.status, JSON.stringify(day.body).slice(0, 300)).toBe(200);
    const dayOwn = (day.body.events as Row[]).filter((r) => r.contactId === contactId);
    expect(ids(dayOwn)).toEqual(plainIds);
    expectNoAmount(dayOwn, "the day's summary");
    const legacy = await agent().get(`/api/flows/businesses/${C.biz}/activity?limit=200&module=crm`).set(HEADER, staff);
    expect(legacy.status, JSON.stringify(legacy.body).slice(0, 300)).toBe(200);
    const legacyOwn = (legacy.body as Row[]).filter((r) => r.contactId === contactId);
    expect(ids(legacyOwn)).toEqual(plainIds);
    expectNoAmount(legacyOwn, 'the legacy feed');

    // The owner reads every copy, the amounts included.
    const owner = await read(C.owner);
    expect(ids(owner)).toEqual([...moneyIds, ...plainIds].sort());
    expect(cents((owner.find((r) => r.id === `${P}${RUN}_c13b_payRec`)!.data as any).amount)).toBe(cents(1357.91));

    // No backfill: the stored rows keep the category they were written with.
    const after = await db.activity.findMany({ where: { id: { in: moneyIds } }, select: { id: true, category: true } });
    expect(after.map((r: any) => [r.id, r.category]).sort()).toEqual(MONEY.map((r) => [r.id, r.category]).sort());
  });

  // W5-FEED-CATEGORIES review CR-W5FC-2 (owner rulings D-90 and D-63, the
  // V1-84 timeline rule): V55-13 writes every sales_revenue copy as COMMERCE by
  // its type (crm-timeline.service.ts contactEventCopyCategory), whatever its
  // data; the deal copies carry the deal amount as data.value, which is not on
  // the V55-13 money field list. A stored crm row whose action is a
  // sales_revenue type is read as a revenue row whatever its category, so an
  // old copy and today's copy of one event get the same visibility.
  it("V55-13c (CR-W5FC-2, D-90 / D-63, W5-FEED-CATEGORIES review): a CRM copy of a sales_revenue type already stored with category CONTACT or none (deal.created / deal.won / deal.lost, the deal amount in data.value) is not served to a member with crm read and revenue 'none' on /events, ?category=CONTACT, the day's summary or the legacy feed, as today's copy of the same event (COMMERCE) is not; the owner reads them all", async () => {
    const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
    const timeline = app.get(CrmTimelineService);
    const staff = `${P}${RUN}_staffC13c`;
    const contactId = `${P}${RUN}_cTeamC13c`;
    await db.user.create({ data: { id: staff, email: `${P}${RUN}_staffC13c@test.local`, role: 'USER' } });
    await db.membership.create({ data: { id: `${P}${RUN}_mC13c`, userId: staff, businessId: C.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none' } } });
    await db.contact.create({ data: { id: contactId, businessId: C.biz, firstName: 'K19a', lastName: 'TeamC13c', visibility: 'TEAM', ownerId: C.owner } });

    /** A CRM copy as CrmTimelineService.logEvent stored it before V55-13. */
    const stored = (key: string, action: string, category: string | null, data: Record<string, unknown>) => ({
      id: `${P}${RUN}_c13c_${key}`,
      businessId: C.biz,
      module: 'crm',
      action,
      entityType: 'contact',
      entityId: contactId,
      title: action,
      detail: JSON.stringify(data),
      contactId,
      category,
      type: action,
      actorType: 'SYSTEM',
      data,
    });
    const DEALS = [
      // CrmDealsService's deal copies (crm-deals.service.ts): the amount is data.value.
      stored('created', 'deal.created', 'CONTACT', { dealId: `${P}${RUN}_dealC13c`, title: 'K19a C13c deal', value: 4321.09 }),
      stored('won', 'deal.won', 'CONTACT', { dealId: `${P}${RUN}_dealC13c`, title: 'K19a C13c deal', value: 5000.37, currency: 'TTD' }),
      stored('lost', 'deal.lost', null, { dealId: `${P}${RUN}_dealC13c2`, title: 'K19a C13c deal 2', value: 777.77, currency: 'TTD', lossReason: 'price' }),
    ];
    const PLAIN = [stored('call', 'communication.call', 'CONTACT', { summary: 'K19a C13c call' })];
    await db.activity.createMany({ data: [...DEALS, ...PLAIN] });
    // Today's copy of deal.won, through the real writer: COMMERCE by its type.
    await timeline.logEvent(C.biz, contactId, 'deal.won', { dealId: `${P}${RUN}_dealC13c3`, title: 'K19a C13c deal 3', value: 2468.13, currency: 'TTD' }, { source: 'crm' });
    const live: Row[] = await waitFor(
      () => db.activity.findMany({ where: { businessId: C.biz, module: 'crm', contactId, action: 'deal.won', NOT: { id: { startsWith: `${P}${RUN}_c13c_` } } } }),
      (rows: any[]) => rows.length >= 1,
      5_000,
    );
    expect(live.map((r) => r.category)).toEqual(['COMMERCE']);

    const plainIds = PLAIN.map((r) => r.id).sort();
    const everyId = [...DEALS.map((r) => r.id), ...plainIds, live[0].id].sort();
    const LEAKS = ['4321.09', '5000.37', '777.77', '2468.13', '"value"'];
    const expectNoAmount = (served: unknown, where: string) => {
      const text = JSON.stringify(served);
      for (const leak of LEAKS) expect(text.includes(leak), `${where} mentions ${leak}`).toBe(false);
    };
    const read = async (user: string, query = '') => {
      const res = await agent().get(`/timeline/businesses/${C.biz}/events?limit=200&contactId=${contactId}${query}`).set(HEADER, user);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body as Row[];
    };
    const ids = (rows: Row[]) => rows.map((r) => r.id).sort();

    // crm read, revenue 'none': the plain copy only, no deal amount anywhere.
    const served = await read(staff);
    expect(ids(served)).toEqual(plainIds);
    expectNoAmount(served, '/events');
    const contactCategory = await read(staff, '&category=CONTACT');
    expect(ids(contactCategory)).toEqual(plainIds);
    expectNoAmount(contactCategory, '?category=CONTACT');
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T12:00:00`;
    const day = await agent().get(`/timeline/businesses/${C.biz}/summary/${today}`).set(HEADER, staff);
    expect(day.status, JSON.stringify(day.body).slice(0, 300)).toBe(200);
    const dayOwn = (day.body.events as Row[]).filter((r) => r.contactId === contactId);
    expect(ids(dayOwn)).toEqual(plainIds);
    expectNoAmount(dayOwn, "the day's summary");
    const legacy = await agent().get(`/api/flows/businesses/${C.biz}/activity?limit=200&module=crm`).set(HEADER, staff);
    expect(legacy.status, JSON.stringify(legacy.body).slice(0, 300)).toBe(200);
    const legacyOwn = (legacy.body as Row[]).filter((r) => r.contactId === contactId);
    expect(ids(legacyOwn)).toEqual(plainIds);
    expectNoAmount(legacyOwn, 'the legacy feed');

    // The owner reads every copy, old and new.
    const owner = await read(C.owner);
    expect(ids(owner)).toEqual(everyId);
    expect(cents((owner.find((r) => r.id === `${P}${RUN}_c13c_won`)!.data as any).value)).toBe(cents(5000.37));
  });

  // W5-FEED-CATEGORIES review SEC-W5FC-2 / CR-W5FC-1 (owner ruling D-63, the
  // V1-84 timeline rule): the money-in-data term reads crm-scope rows only (the
  // CRM copies SEC-FCC-1 is about), so a row of a module with its own scope
  // keeps D-63's binding. ExpensesService writes every EXPENSE row with its
  // amount in data (create / update / delete), and GET /expenses serves the
  // same amounts on expenses read; no ruling gates those rows on revenue.
  it("V55-13d (SEC-W5FC-2 / CR-W5FC-1, D-63, W5-FEED-CATEGORIES review): an EXPENSE row whose data carries its amount (as ExpensesService.create writes it) is served to a member with expenses read and revenue 'none' on /events, the day's summary and the legacy feed, as before the packet; a crm copy carrying an amount stays withheld from that member; the owner reads both", async () => {
    const staff = `${P}${RUN}_staffC13d`;
    const contactId = `${P}${RUN}_cTeamC13d`;
    const expenseId = `${P}${RUN}_expC13d`;
    await db.user.create({ data: { id: staff, email: `${P}${RUN}_staffC13d@test.local`, role: 'USER' } });
    await db.membership.create({ data: { id: `${P}${RUN}_mC13d`, userId: staff, businessId: C.biz, role: 'STAFF', permissionScopes: { crm: 'read', expenses: 'read', revenue: 'none' } } });
    await db.contact.create({ data: { id: contactId, businessId: C.biz, firstName: 'K19a', lastName: 'TeamC13d', visibility: 'TEAM', ownerId: C.owner } });
    // As ExpensesService.create records it (expenses.service.ts): module EXPENSE, no category, data.amount.
    const expenseRow = {
      id: `${P}${RUN}_c13d_exp`,
      businessId: C.biz,
      module: 'EXPENSE',
      action: 'created',
      entityType: 'expense',
      entityId: expenseId,
      title: 'Expense created: K19a C13d supplies',
      detail: 'TTD 12.5',
      data: { amount: 12.5, currency: 'TTD', status: 'PAID', vendor: 'K19a C13d vendor' },
    };
    // A crm copy stored as CONTACT with an amount (SEC-FCC-1): still a revenue row.
    const crmRow = {
      id: `${P}${RUN}_c13d_crm`,
      businessId: C.biz,
      module: 'crm',
      action: 'store_order.paid',
      entityType: 'contact',
      entityId: contactId,
      title: 'store_order.paid',
      detail: JSON.stringify({ orderId: `${P}${RUN}_orderC13d`, total: 13.57, currency: 'TTD' }),
      contactId,
      category: 'CONTACT',
      type: 'store_order.paid',
      actorType: 'SYSTEM',
      data: { orderId: `${P}${RUN}_orderC13d`, total: 13.57, currency: 'TTD' },
    };
    await db.activity.createMany({ data: [expenseRow, crmRow] });
    const mine = [expenseRow.id, crmRow.id];
    const ids = (rows: Row[]) => rows.map((r) => r.id).filter((id) => mine.includes(id)).sort();
    const events = async (user: string, query: string) => {
      const res = await agent().get(`/timeline/businesses/${C.biz}/events?limit=200&${query}`).set(HEADER, user);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body as Row[];
    };

    // expenses read, revenue 'none': the EXPENSE row with its amount; not the crm money copy.
    const expenseRows = await events(staff, `entityType=expense&entityId=${expenseId}`);
    expect(ids(expenseRows)).toEqual([expenseRow.id]);
    expect(cents((expenseRows[0].data as any).amount)).toBe(cents(12.5));
    expect(ids(await events(staff, `contactId=${contactId}`))).toEqual([]);
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T12:00:00`;
    const day = await agent().get(`/timeline/businesses/${C.biz}/summary/${today}`).set(HEADER, staff);
    expect(day.status, JSON.stringify(day.body).slice(0, 300)).toBe(200);
    expect(ids(day.body.events as Row[])).toEqual([expenseRow.id]);
    const legacyExpense = await agent().get(`/api/flows/businesses/${C.biz}/activity?limit=200&module=EXPENSE`).set(HEADER, staff);
    expect(legacyExpense.status, JSON.stringify(legacyExpense.body).slice(0, 300)).toBe(200);
    expect(ids(legacyExpense.body as Row[])).toEqual([expenseRow.id]);
    const legacyCrm = await agent().get(`/api/flows/businesses/${C.biz}/activity?limit=200&module=crm`).set(HEADER, staff);
    expect(legacyCrm.status, JSON.stringify(legacyCrm.body).slice(0, 300)).toBe(200);
    expect(ids(legacyCrm.body as Row[])).toEqual([]);

    // The owner reads both.
    expect(ids(await events(C.owner, `entityType=expense&entityId=${expenseId}`))).toEqual([expenseRow.id]);
    expect(ids(await events(C.owner, `contactId=${contactId}`))).toEqual([crmRow.id]);
  });

  // W6-CONTACT-EVENTS-MONEY (W5-FEED-CATEGORIES review SEC-W5FC-1; owner
  // rulings D-90 and D-63, the V1-84 timeline rule). Before it, GET
  // /crm/businesses/:b/contacts/:c/events (CrmController.contactEvents,
  // RequireModuleScope('crm', 'read')) returned the contact's ContactEvent rows
  // with their full data through CrmTimelineService.listContactEvents, e.g. a
  // manual payment's invoice.payment_recorded {amount, totalPaid, invoiceTotal},
  // which D-90 still writes (feedCopy false), so a member with crm read and
  // revenue 'none' read the amounts the feed withholds (V55-13 / V55-13b /
  // V55-13c). The real CrmController is mounted on its own app over this
  // suite's PrismaService and identity header, with the real CrmService (`crm`,
  // over the suite's real CrmTimelineService); its other collaborators are
  // empty stand-ins the route never calls. W7-CONTACT-MONEY-VIEWS (V55-13f..h)
  // adds the real CrmJourneyService, CrmRevenueService and CrmStatsService the
  // contact's sibling reads call (CrmStatsService's cache is a stand-in that
  // contactDetail never reads).
  let crmApp: any;
  afterAll(async () => {
    if (crmApp) await crmApp.close();
  });

  /** The real CrmController app (built once). */
  async function crmControllerApp(): Promise<any> {
    if (!crmApp) {
      const { Test } = await import('@nestjs/testing');
      const { EventEmitter2 } = await import('@nestjs/event-emitter');
      const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
      const { PrismaService } = await import('../src/core/prisma/prisma.service');
      const { AuthGuard } = await import('../src/core/auth/auth.guard');
      const { BusinessGuard } = await import('../src/core/auth/business.guard');
      const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
      const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
      const { CrmController } = await import('../src/modules/crm/crm.controller');
      const { CrmService } = await import('../src/modules/crm/crm.service');
      const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
      const { CrmJourneyService } = await import('../src/modules/crm/crm-journey.service');
      const { CrmRevenueService } = await import('../src/modules/crm/crm-revenue.service');
      const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
      const { CrmCacheService } = await import('../src/modules/crm/crm-cache.service');
      const ref = await Test.createTestingModule({
        controllers: [CrmController],
        providers: [
          { provide: PrismaService, useValue: app.get(PrismaService) },
          AuthGuard,
          BusinessGuard,
          ModuleScopeGuard,
          CrmRateLimitGuard,
          { provide: CrmService, useValue: crm },
          { provide: CrmTimelineService, useValue: app.get(CrmTimelineService) },
          CrmJourneyService,
          CrmRevenueService,
          CrmStatsService,
          { provide: CrmCacheService, useValue: { get: async () => null, set: async () => undefined, invalidate: async () => undefined } },
          { provide: EventEmitter2, useValue: { emit: () => true } },
        ],
      })
        .useMocker(() => ({}))
        .compile();
      crmApp = ref.createNestApplication();
      // Identity attachment only, as the suite's app does. No guard is overridden.
      crmApp.use(async (req: any, _res: any, next: any) => {
        const header = req.headers[HEADER];
        const id = typeof header === 'string' ? header : undefined;
        if (id && id.startsWith(P)) {
          const found = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
          if (found) req.user = { id: found.id, email: found.email, role: found.role };
        }
        next();
      });
      crmApp.useGlobalFilters(new GlobalHttpExceptionFilter());
      await crmApp.init();
    }
    return crmApp;
  }

  /** GET /crm/businesses/:biz/contacts/:contactId/events as `user`, through the real CrmController. */
  async function contactEventsRoute(user: string, contactId: string, biz = C.biz): Promise<request.Response> {
    return request((await crmControllerApp()).getHttpServer()).get(`/crm/businesses/${biz}/contacts/${contactId}/events`).set(HEADER, user);
  }

  it("V55-13e (SEC-W5FC-1, D-90 / D-63, W6-CONTACT-EVENTS-MONEY, was it.todo): GET /crm/businesses/:b/contacts/:c/events (CrmController.contactEvents -> CrmTimelineService.listContactEvents) withholds from a member with crm read and revenue 'none' every ContactEvent the feed reads as a money row (a manual payment's invoice.payment_recorded {amount, totalPaid, invoiceTotal}, which D-90 still writes; invoice.paid; store_order.paid; a storefront booking.created's deposit; deal.won by its type), fills that member's page from older events, and serves the owner and a member with revenue read every event, amounts included", async () => {
    const staff = `${P}${RUN}_staffC13e`;
    const staffRev = `${P}${RUN}_staffC13eRev`;
    const contactId = `${P}${RUN}_cTeamC13e`;
    const invoiceId = `${P}${RUN}_invC13e`;
    const TOTAL = 4975.5;
    const PAID = 1357.91;
    await db.user.create({ data: { id: staff, email: `${P}${RUN}_staffC13e@test.local`, role: 'USER' } });
    await db.user.create({ data: { id: staffRev, email: `${P}${RUN}_staffC13eRev@test.local`, role: 'USER' } });
    await db.membership.create({ data: { id: `${P}${RUN}_mC13e`, userId: staff, businessId: C.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none' } } });
    await db.membership.create({ data: { id: `${P}${RUN}_mC13eRev`, userId: staffRev, businessId: C.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'read' } } });
    await db.contact.create({ data: { id: contactId, businessId: C.biz, firstName: 'K19a', lastName: 'TeamC13e', visibility: 'TEAM', ownerId: C.owner } });
    await db.invoice.create({
      data: {
        id: invoiceId,
        invoiceNumber: `K19A-${RUN}-C13e`,
        status: 'SENT',
        subtotal: TOTAL,
        total: TOTAL,
        currency: 'TTD',
        businessId: C.biz,
        contactId,
        items: { create: [{ id: `${invoiceId}_item1`, description: 'K19A C13e item', quantity: 1, unitPrice: TOTAL, total: TOTAL }] },
      },
    });

    // ContactEvents as their writers store them: two with no amount (oldest),
    // then four money events (newer).
    const t0 = Date.now() - 60 * 60_000;
    const at = (minutes: number) => new Date(t0 + minutes * 60_000);
    const event = (key: string, type: string, data: Record<string, unknown>, createdAt: Date) => ({
      id: `${P}${RUN}_c13e_${key}`, businessId: C.biz, contactId, type, data, actorType: 'SYSTEM', source: 'k19a', createdAt,
    });
    const PLAIN = [
      event('call', 'communication.call', { summary: 'K19a C13e call' }, at(0)),
      event('note', 'note.created', { body: 'K19a C13e note' }, at(1)),
    ];
    const MONEY = [
      // mark-paid's invoice.paid (sales_revenue), RevenueEventListener.onStoreOrderPaid's order total,
      // a storefront booking.created's deposit, CrmDealsService's deal.won (sales_revenue; amount in data.value).
      event('paid', 'invoice.paid', { invoiceId, total: 6543.21, currency: 'TTD' }, at(10)),
      event('order', 'store_order.paid', { orderId: `${P}${RUN}_orderC13e`, total: 9876.54, currency: 'TTD' }, at(11)),
      event('deposit', 'booking.created', { bookingId: `${P}${RUN}_bkC13e`, depositAmount: 2468.68, currency: 'TTD' }, at(12)),
      event('won', 'deal.won', { dealId: `${P}${RUN}_dealC13e`, title: 'K19a C13e deal', value: 5000.37, currency: 'TTD' }, at(13)),
    ];
    await db.contactEvent.createMany({ data: [...PLAIN, ...MONEY] });
    // The newest: a manual payment through the real route, whose
    // invoice.payment_recorded ContactEvent D-90 still writes (no Activity copy).
    const reference = `${P}${RUN}-c13e`;
    const paid = await payAs(C.owner, C.biz, invoiceId, { amount: PAID, method: 'bank_transfer', reference });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const [payment] = await contactEventsFor(C.biz, contactId, reference);
    expect(payment, 'the payment\'s ContactEvent').toBeTruthy();
    expect(cents((payment.data as any).amount)).toBe(cents(PAID));
    expect(cents((payment.data as any).totalPaid)).toBe(cents(PAID));
    expect(cents((payment.data as any).invoiceTotal)).toBe(cents(TOTAL));

    type EventRow = { id: string; type: string; data: any };
    const read = async (user: string) => {
      const res = await contactEventsRoute(user, contactId);
      expect(res.status, `${user}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
      return res.body as EventRow[];
    };
    const LEAKS = ['1357.91', '4975.5', '6543.21', '9876.54', '2468.68', '5000.37', '"amount"', '"total"', '"totalPaid"', '"invoiceTotal"', '"depositAmount"', '"value"'];
    const expectNoAmount = (served: unknown, where: string) => {
      const text = JSON.stringify(served);
      for (const leak of LEAKS) expect(text.includes(leak), `${where} mentions ${leak}`).toBe(false);
    };
    const plainNewestFirst = PLAIN.map((e) => e.id).reverse();
    const everyNewestFirst = [payment.id, ...MONEY.map((e) => e.id).reverse(), ...plainNewestFirst];

    // crm read, revenue 'none': the events with no amount only, newest first, no amount anywhere.
    const served = await read(staff);
    expect(served.map((e) => e.id)).toEqual(plainNewestFirst);
    expectNoAmount(served, "revenue 'none'");

    // The owner, and a STAFF member with revenue read, get every event, newest first, the amounts included.
    for (const user of [C.owner, staffRev]) {
      const all = await read(user);
      expect(all.map((e) => e.id), user).toEqual(everyNewestFirst);
      expect(cents(all[0].data.amount), user).toBe(cents(PAID));
      expect(cents(all.find((e) => e.type === 'deal.won')!.data.value), user).toBe(cents(5000.37));
    }

    // The page (20 events by default): twenty more money events, newer than
    // every other. The owner's page is those twenty; the member without
    // revenue read still gets the events with no amount (the page is filled
    // from older events, as the feed fills its page).
    const base = new Date(payment.createdAt).getTime();
    await db.contactEvent.createMany({
      data: Array.from({ length: 20 }, (_, i) =>
        event(`more${i}`, 'store_order.paid', { orderId: `${P}${RUN}_orderC13e${i}`, total: 7000 + i, currency: 'TTD' }, new Date(base + (i + 1) * 1000)),
      ),
    });
    const ownerPage = await read(C.owner);
    expect(ownerPage.map((e) => e.id)).toEqual(Array.from({ length: 20 }, (_, i) => `${P}${RUN}_c13e_more${19 - i}`));
    const staffPage = await read(staff);
    expect(staffPage.map((e) => e.id)).toEqual(plainNewestFirst);
    expectNoAmount(staffPage, "revenue 'none', page 2");

    // Tenant control: owner B on C's contact is refused, and the route still
    // refuses a request with no identity.
    const foreign = await contactEventsRoute(ID.ownerB, contactId);
    expect(foreign.status).toBe(403);
    expectNoAmount(foreign.body, 'the refusal');
    const anonymous = await request(crmApp.getHttpServer()).get(`/crm/businesses/${C.biz}/contacts/${contactId}/events`);
    expect([401, 403]).toContain(anonymous.status);
  });

  // W7-CONTACT-MONEY-VIEWS (W6-CONTACT-EVENTS-MONEY review SEC-W6CEM-1,
  // SEC-W6CEM-2, CR-W6CEM-1; owner rulings D-90 and D-63, the V1-84 timeline
  // rule, as W5-BRIEFING-SCOPE / W6-BRIEFINGS-SCOPE apply them to the
  // briefings). V55-13e closed GET .../events only. Reproduced on db6bc4b9 by a
  // temporary probe: the same member with crm read and revenue 'none' read the
  // same ContactEvents and amounts one sibling GET away on the same contact
  // (cross-journey / story / dossier, revenue-summary / journey, and the contact
  // detail), every read answering 200 with the amounts. Each read now serves
  // that member no money row and no money figure: the ContactEvents V55-13e
  // withholds are withheld (the page filled from older events), the contact's
  // invoices and quotes (revenue rows, D-63: commerce maps to revenue) are not
  // read, and every figure read from them is 0 or null in the response's
  // existing shape (as the briefings report revenueToday and openInvoices as 0).
  // The owner and a member with revenue read get every row and figure, as before.
  // The real CrmController with the real CrmJourneyService, CrmRevenueService
  // and CrmStatsService (crmControllerApp above).

  /** GET /crm/businesses/:biz/contacts/:contactId<suffix> as `user`, through the real CrmController. */
  async function contactRoute(user: string, contactId: string, suffix: string, biz = C.biz): Promise<request.Response> {
    return request((await crmControllerApp()).getHttpServer()).get(`/crm/businesses/${biz}/contacts/${contactId}${suffix}`).set(HEADER, user);
  }

  /** The amounts the V55-13f..h contact carries, each distinct so a leak names its source. */
  const MV = {
    SENT_TOTAL: 4975.5, // a SENT invoice, part paid through the real manual payment route
    PAID: 1357.91, // that payment (its invoice.payment_recorded ContactEvent, its Payment row)
    PAID_INVOICE: 5321.87, // a PAID invoice, with an invoice.paid ContactEvent { amount }
    OPEN_TOTAL: 2468.13, // a SENT invoice nothing was paid on
    QUOTE_TOTAL: 3697.41, // a SENT quote
    LIFETIME_VALUE: 8642.19, // Contact.lifetimeValue (ContactInsightService writes the contact's paid total)
    AVERAGE_SPEND: 1728.44, // Contact.averageSpend
  };
  /** Every way the reads print one of those amounts (plain, grouped, in TTD text), and the insight's payment sentence. */
  const MV_LEAKS = [
    '4975.5', '4,975.5', '1357.91', '1,357.91', '5321.87', '5,321.87', '2468.13', '2,468.13',
    '3697.41', '3,697.41', '8642.19', '8,642.19', '1728.44', '1,728.44', 'TTD ', 'payments totaling',
  ];
  const expectNoMoney = (served: unknown, where: string) => {
    const text = JSON.stringify(served);
    for (const leak of MV_LEAKS) expect(text.includes(leak), `${where} mentions ${leak}`).toBe(false);
  };

  /**
   * A TEAM contact of C (status CLIENT, its stored lifetimeValue / averageSpend
   * set) with money on every read V55-13f..h covers, and the two STAFF members
   * that read it: `staff` {crm: 'read', revenue: 'none'} and `staffRev` {crm:
   * 'read', revenue: 'read'}. ContactEvents, oldest first: a call and a
   * note.created (no amount), the PAID invoice's invoice.paid {amount}, then the
   * manual payment's invoice.payment_recorded {amount, totalPaid, invoiceTotal}
   * (the real route, as D-90 still writes it).
   */
  async function seedMoneyContact(tag: string) {
    const staff = `${P}${RUN}_staff${tag}`;
    const staffRev = `${P}${RUN}_staff${tag}Rev`;
    const contactId = `${P}${RUN}_cTeam${tag}`;
    const inv = { sent: `${P}${RUN}_inv${tag}Sent`, paid: `${P}${RUN}_inv${tag}Paid`, open: `${P}${RUN}_inv${tag}Open` };
    const quoteId = `${P}${RUN}_quote${tag}`;
    const noteId = `${P}${RUN}_note${tag}`;
    await db.user.create({ data: { id: staff, email: `${P}${RUN}_staff${tag}@test.local`, role: 'USER' } });
    await db.user.create({ data: { id: staffRev, email: `${P}${RUN}_staff${tag}Rev@test.local`, role: 'USER' } });
    await db.membership.create({ data: { id: `${P}${RUN}_m${tag}`, userId: staff, businessId: C.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'none' } } });
    await db.membership.create({ data: { id: `${P}${RUN}_m${tag}Rev`, userId: staffRev, businessId: C.biz, role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'read' } } });
    await db.contact.create({
      data: {
        id: contactId, businessId: C.biz, firstName: 'K19a', lastName: `Team${tag}`, status: 'CLIENT', visibility: 'TEAM', ownerId: C.owner,
        lifetimeValue: MV.LIFETIME_VALUE, averageSpend: MV.AVERAGE_SPEND,
      },
    });
    const t0 = Date.now() - 60 * 60_000;
    const at = (minutes: number) => new Date(t0 + minutes * 60_000);
    const invoice = (id: string, suffix: string, status: string, total: number, extra: Record<string, unknown> = {}) =>
      db.invoice.create({
        data: {
          id, invoiceNumber: `K19A-${RUN}-${tag}${suffix}`, status, subtotal: total, total, currency: 'TTD', businessId: C.biz, contactId,
          items: { create: [{ id: `${id}_item1`, description: `K19A ${tag} item ${suffix}`, quantity: 1, unitPrice: total, total }] },
          ...extra,
        },
      });
    await invoice(inv.sent, 'S', 'SENT', MV.SENT_TOTAL);
    await invoice(inv.paid, 'P', 'PAID', MV.PAID_INVOICE, { paidAt: at(2) });
    await invoice(inv.open, 'O', 'SENT', MV.OPEN_TOTAL);
    await db.quote.create({
      data: { id: quoteId, quoteNumber: `K19A-Q-${RUN}-${tag}`, status: 'SENT', subtotal: MV.QUOTE_TOTAL, total: MV.QUOTE_TOTAL, currency: 'TTD', businessId: C.biz, contactId },
    });
    await db.contactNote.create({ data: { id: noteId, businessId: C.biz, contactId, body: `K19a ${tag} note body`, createdAt: at(1) } });
    const ev = (key: string, type: string, data: Record<string, unknown>, createdAt: Date) => ({
      id: `${P}${RUN}_${tag}_${key}`, businessId: C.biz, contactId, type, data, actorType: 'SYSTEM', source: 'k19a', createdAt,
    });
    const call = ev('call', 'communication.call', { summary: `K19a ${tag} call` }, at(0));
    const note = ev('note', 'note.created', { noteId }, at(1));
    const invoicePaid = ev('paid', 'invoice.paid', { invoiceId: inv.paid, amount: MV.PAID_INVOICE, currency: 'TTD' }, at(2));
    await db.contactEvent.createMany({ data: [call, note, invoicePaid] });
    const reference = `${P}${RUN}-${tag}`;
    const paid = await payAs(C.owner, C.biz, inv.sent, { amount: MV.PAID, method: 'bank_transfer', reference });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const [payment] = await contactEventsFor(C.biz, contactId, reference);
    expect(payment, "the payment's ContactEvent").toBeTruthy();
    expect(cents((payment.data as any).amount)).toBe(cents(MV.PAID));
    expect(cents((payment.data as any).invoiceTotal)).toBe(cents(MV.SENT_TOTAL));
    return { staff, staffRev, contactId, inv, quoteId, noteId, callId: call.id, noteEventId: note.id, invoicePaidId: invoicePaid.id, payment };
  }

  it("V55-13f (SEC-W6CEM-1, D-90 / D-63, W7-CONTACT-MONEY-VIEWS, was it.todo): GET /crm/businesses/:b/contacts/:c/cross-journey (CrmJourneyService.getContactCrossJourney) and the two routes built on it, .../story (any ?filter=, money included) and .../dossier, serve a member with crm read and revenue 'none' no money row and no amount: not the money ContactEvents V55-13e withholds (invoice.paid, invoice.payment_recorded), not the contact's invoice and quote rows, summary.totalRevenue 0, the dossier's insight without its payment sentence or the 'high-value' tag, and the dossier's contact and meta without their amounts; the owner and a member with revenue read keep every row and amount", async () => {
    const S13f = await seedMoneyContact('C13f');
    type Item = { id: string; module: string; type: string; description?: string; value?: number };
    const read = async (user: string, suffix: string) => {
      const res = await contactRoute(user, S13f.contactId, suffix);
      expect(res.status, `${user} ${suffix}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
      return res.body;
    };
    const PLAIN_IDS = ['first_contact', S13f.callId, S13f.noteEventId].sort();

    // crm read, revenue 'none': the contact, its call and its note; no money row, no amount.
    const journey = await read(S13f.staff, '/cross-journey');
    expect((journey.timeline as Item[]).map((i) => i.id).sort()).toEqual(PLAIN_IDS);
    expect((journey.timeline as Item[]).filter((i) => i.module === 'commerce')).toEqual([]);
    expect(journey.summary.totalRevenue).toBe(0);
    expect(journey.summary.moduleCounts.commerce).toBe(0);
    expect((journey.timeline as Item[]).find((i) => i.id === S13f.noteEventId)?.description).toBe('K19a C13f note body');
    expectNoMoney(journey, "cross-journey, revenue 'none'");
    for (const suffix of ['/story', '/story?filter=all', '/story?filter=money', '/story?filter=notes']) {
      const story = await read(S13f.staff, suffix);
      expect(story.summary.totalRevenue, suffix).toBe(0);
      expectNoMoney(story, `${suffix}, revenue 'none'`);
    }
    expect((await read(S13f.staff, '/story?filter=money')).timeline).toEqual([]);
    const dossier = await read(S13f.staff, '/dossier');
    expect(dossier.contact.id).toBe(S13f.contactId);
    expect((dossier.timeline as Item[]).map((i) => i.id).sort()).toEqual(PLAIN_IDS);
    expect(dossier.summary.totalRevenue).toBe(0);
    expect(dossier.meta.totalRevenue).toBe(0);
    expect(dossier.meta.outstandingBalance).toBe(0);
    expect(dossier.contact.lifetimeValue).toBeNull();
    expect(dossier.insight.summary).toMatch(/^K19a is a client with \d+ interactions and 1 notes\.$/);
    expect(dossier.insight.tags).not.toContain('high-value');
    expect(dossier.notes.map((n: any) => n.id)).toEqual([S13f.noteId]);
    expectNoMoney(dossier, "dossier, revenue 'none'");

    // The owner, and a STAFF member with revenue read, get every row and amount.
    for (const user of [C.owner, S13f.staffRev]) {
      const all = await read(user, '/cross-journey');
      const byId = new Map((all.timeline as Item[]).map((i) => [i.id, i]));
      expect(cents(byId.get(S13f.invoicePaidId)?.value), user).toBe(cents(MV.PAID_INVOICE));
      expect(byId.get(S13f.invoicePaidId)?.description, user).toMatch(/^TTD 5,?321\.87$/);
      expect(cents(byId.get(S13f.payment.id)?.value), user).toBe(cents(MV.PAID));
      expect(cents(byId.get(`inv_${S13f.inv.open}`)?.value), user).toBe(cents(MV.OPEN_TOTAL));
      expect(cents(byId.get(`quote_${S13f.quoteId}`)?.value), user).toBe(cents(MV.QUOTE_TOTAL));
      for (const id of PLAIN_IDS) expect(byId.has(id), `${user}: ${id}`).toBe(true);
      expect(cents(all.summary.totalRevenue), user).toBe(cents(MV.PAID_INVOICE));
      const money = await read(user, '/story?filter=money');
      expect((money.timeline as Item[]).map((i) => i.id).sort(), user).toEqual(
        [S13f.invoicePaidId, S13f.payment.id, `inv_${S13f.inv.open}`, `quote_${S13f.quoteId}`].sort(),
      );
      const full = await read(user, '/dossier');
      expect(cents(full.summary.totalRevenue), user).toBe(cents(MV.PAID_INVOICE));
      expect(cents(full.meta.totalRevenue), user).toBe(cents(MV.PAID_INVOICE));
      expect(cents(full.contact.lifetimeValue), user).toBe(cents(MV.LIFETIME_VALUE));
      expect(full.insight.summary, user).toMatch(/payments totaling TTD 5,?321\.87/);
      expect(full.insight.tags, user).toContain('high-value');
    }

    // Tenant control: owner B on C's contact is refused on every route, and carries no amount.
    for (const suffix of ['/cross-journey', '/story?filter=money', '/dossier']) {
      const foreign = await contactRoute(ID.ownerB, S13f.contactId, suffix);
      expect(foreign.status, suffix).toBe(403);
      expectNoMoney(foreign.body, `${suffix}, the refusal`);
    }
  });

  it("V55-13g (SEC-W6CEM-2, D-90 / D-63, W7-CONTACT-MONEY-VIEWS, was it.todo): GET /crm/businesses/:b/contacts/:c/revenue-summary (CrmRevenueService.getContactRevenueSummary) and .../journey (CrmJourneyService.getContactJourney) serve a member with crm read and revenue 'none' no amount and no revenue figure: the summary keeps its shape with lifetimeRevenue, outstandingBalance, openInvoices and openQuotes 0, lastPaymentAt, lastPaymentAmount and paymentReliability null and no recentRevenueActions, and the journey has no 'Payment Received' or quote milestone; the owner and a member with revenue read keep every figure", async () => {
    const S13g = await seedMoneyContact('C13g');
    const read = async (user: string, suffix: string) => {
      const res = await contactRoute(user, S13g.contactId, suffix);
      expect(res.status, `${user} ${suffix}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
      return res.body;
    };

    // crm read, revenue 'none'.
    const summary = await read(S13g.staff, '/revenue-summary');
    expect(summary).toEqual({
      contactId: S13g.contactId,
      currency: 'TTD',
      lifetimeRevenue: 0,
      outstandingBalance: 0,
      openInvoices: 0,
      openQuotes: 0,
      lastPaymentAt: null,
      lastPaymentAmount: null,
      paymentReliability: null,
      recentRevenueActions: [],
    });
    const milestones = await read(S13g.staff, '/journey');
    expect((milestones as Array<{ type: string }>).map((m) => m.type)).toEqual(['first_contact']);
    expectNoMoney(summary, "revenue-summary, revenue 'none'");
    expectNoMoney(milestones, "journey, revenue 'none'");

    // The owner, and a STAFF member with revenue read, get every figure.
    for (const user of [C.owner, S13g.staffRev]) {
      const full = await read(user, '/revenue-summary');
      expect(cents(full.lifetimeRevenue), user).toBe(cents(MV.PAID));
      expect(cents(full.lastPaymentAmount), user).toBe(cents(MV.PAID));
      expect(cents(full.outstandingBalance), user).toBeGreaterThanOrEqual(cents(MV.OPEN_TOTAL));
      expect(full.openQuotes, user).toBe(1);
      expect((full.recentRevenueActions as Array<{ amount: number | null }>).map((a) => cents(a.amount)).sort(), user).toEqual(
        [cents(MV.PAID), cents(MV.PAID_INVOICE)].sort(),
      );
      const journey = (await read(user, '/journey')) as Array<{ id: string; title: string; value?: number }>;
      const payment = journey.find((m) => m.id === `payment_${S13g.inv.paid}`);
      expect(payment?.title, user).toBe('Payment Received');
      expect(cents(payment?.value), user).toBe(cents(MV.PAID_INVOICE));
      expect(cents(journey.find((m) => m.id === `quote_${S13g.quoteId}`)?.value), user).toBe(cents(MV.QUOTE_TOTAL));
    }

    // Tenant control: owner B on C's contact is refused.
    for (const suffix of ['/revenue-summary', '/journey']) {
      const foreign = await contactRoute(ID.ownerB, S13g.contactId, suffix);
      expect(foreign.status, suffix).toBe(403);
      expectNoMoney(foreign.body, `${suffix}, the refusal`);
    }
  });

  it("V55-13h (CR-W6CEM-1, D-90 / D-63, W7-CONTACT-MONEY-VIEWS, was it.todo): GET /crm/businesses/:b/contacts/:c (CrmStatsService.contactDetail, whose `events` the web contact page's Timeline tab draws from) serves a member with crm read and revenue 'none' only the ContactEvents V55-13e serves them, the page of 50 filled from older events, no invoice rows, meta's invoice figures (totalRevenue, outstandingBalance, unpaidInvoices, paidInvoices, invoiceCount) 0 and the contact's lifetimeValue / averageSpend null; the owner and a member with revenue read keep every event, invoice and figure", async () => {
    const S13h = await seedMoneyContact('C13h');
    type Detail = { contact: any; events: Array<{ id: string; type: string; data: any }>; invoices: Array<{ id: string; total: number | null }>; meta: any };
    const read = async (user: string) => {
      const res = await contactRoute(user, S13h.contactId, '');
      expect(res.status, `${user}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
      return res.body as Detail;
    };
    const plainNewestFirst = [S13h.noteEventId, S13h.callId];

    // crm read, revenue 'none'.
    const detail = await read(S13h.staff);
    expect(detail.contact.id).toBe(S13h.contactId);
    expect(detail.events.map((e) => e.id)).toEqual(plainNewestFirst);
    expect(detail.invoices).toEqual([]);
    expect(detail.meta).toMatchObject({ totalRevenue: 0, outstandingBalance: 0, unpaidInvoices: 0, paidInvoices: 0, invoiceCount: 0, oldestUnpaidInvoiceDueAt: null });
    expect(detail.contact.lifetimeValue).toBeNull();
    expect(detail.contact.averageSpend).toBeNull();
    expectNoMoney(detail, "contact detail, revenue 'none'");

    // The owner, and a STAFF member with revenue read, get every event, invoice and figure.
    for (const user of [C.owner, S13h.staffRev]) {
      const full = await read(user);
      expect(full.events.map((e) => e.id), user).toEqual([S13h.payment.id, S13h.invoicePaidId, ...plainNewestFirst]);
      expect(cents(full.events[0].data.amount), user).toBe(cents(MV.PAID));
      expect(new Map(full.invoices.map((i) => [i.id, cents(i.total)])), user).toEqual(
        new Map([[S13h.inv.sent, cents(MV.SENT_TOTAL)], [S13h.inv.paid, cents(MV.PAID_INVOICE)], [S13h.inv.open, cents(MV.OPEN_TOTAL)]]),
      );
      expect(cents(full.meta.totalRevenue), user).toBe(cents(MV.PAID_INVOICE));
      expect(cents(full.meta.outstandingBalance), user).toBeGreaterThanOrEqual(cents(MV.OPEN_TOTAL));
      expect(full.meta.invoiceCount, user).toBe(3);
      expect(cents(full.contact.lifetimeValue), user).toBe(cents(MV.LIFETIME_VALUE));
      expect(cents(full.contact.averageSpend), user).toBe(cents(MV.AVERAGE_SPEND));
    }

    // The page (50 events): fifty more money events, newer than every other.
    // The owner's page is those fifty; the member without revenue read still
    // gets the events with no amount (the page is filled from older events).
    const base = new Date(S13h.payment.createdAt).getTime();
    await db.contactEvent.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        id: `${P}${RUN}_C13h_more${i}`, businessId: C.biz, contactId: S13h.contactId, type: 'store_order.paid',
        data: { orderId: `${P}${RUN}_orderC13h${i}`, total: 7000 + i, currency: 'TTD' }, actorType: 'SYSTEM', source: 'k19a',
        createdAt: new Date(base + (i + 1) * 1000),
      })),
    });
    expect((await read(C.owner)).events.map((e) => e.id)).toEqual(Array.from({ length: 50 }, (_, i) => `${P}${RUN}_C13h_more${49 - i}`));
    const page = await read(S13h.staff);
    expect(page.events.map((e) => e.id)).toEqual(plainNewestFirst);
    expectNoMoney(page, "contact detail, revenue 'none', page 2");
    expect(JSON.stringify(page.events)).not.toContain('"total"');

    // Tenant control: owner B on C's contact is refused.
    const foreign = await contactRoute(ID.ownerB, S13h.contactId, '');
    expect(foreign.status).toBe(403);
    expectNoMoney(foreign.body, 'the refusal');
  });

  // W7-CONTACT-MONEY-VIEWS review repair SEC-W7CMV-3 (owner rulings D-90 and
  // D-63). Reproduced on 5be0a761 by a temporary probe: with the stored
  // paymentReliability 37, riskFlags ['unpaid_invoices', 'poor_payment_history',
  // 'dormant'] and opportunities ['upsell_ready', 'pending_quotes',
  // 'open_deals'], GET contacts/:c and .../dossier served the member with crm
  // read and revenue 'none' all of them (lifetimeValue null), while GET
  // .../revenue-summary served the same member paymentReliability null.
  // ContactInsightService derives those riskFlags / opportunities entries from
  // the contact's invoices and quotes (revenue rows, D-63); 'upsell_ready' is a
  // paid-total threshold like the insight's 'high-value' tag, which V55-13f
  // withholds.
  it("V55-13i (SEC-W7CMV-3, D-90 / D-63, W7-CONTACT-MONEY-VIEWS review): GET /crm/businesses/:b/contacts/:c and .../dossier serve a member with crm read and revenue 'none' the contact's stored paymentReliability as null, as .../revenue-summary does, and its stored riskFlags / opportunities without the entries derived from its invoices and quotes ('unpaid_invoices', 'poor_payment_history', 'declining_engagement', 'pending_quotes', 'upsell_ready'), the other entries kept in order; the owner and a member with revenue read keep every stored value", async () => {
    const S13i = await seedMoneyContact('C13i');
    const RISK = ['unpaid_invoices', 'dormant', 'poor_payment_history', 'high_cancellation_rate', 'declining_engagement'];
    const OPPORTUNITIES = ['pending_quotes', 'open_deals', 'upsell_ready', 'referral_ask'];
    await db.contact.update({ where: { id: S13i.contactId }, data: { paymentReliability: 37, riskFlags: RISK, opportunities: OPPORTUNITIES } });
    const read = async (user: string, suffix: string) => {
      const res = await contactRoute(user, S13i.contactId, suffix);
      expect(res.status, `${user} ${suffix}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
      return res.body;
    };

    // crm read, revenue 'none': the detail and the dossier's contact agree with the revenue summary.
    for (const suffix of ['', '/dossier']) {
      const { contact } = await read(S13i.staff, suffix);
      expect(contact.id, suffix).toBe(S13i.contactId);
      expect(contact.paymentReliability, suffix).toBeNull();
      expect(contact.riskFlags, suffix).toEqual(['dormant', 'high_cancellation_rate']);
      expect(contact.opportunities, suffix).toEqual(['open_deals', 'referral_ask']);
      expect(contact.lifetimeValue, suffix).toBeNull();
      expect(contact.averageSpend, suffix).toBeNull();
      expectNoMoney(contact, `${suffix || 'detail'} contact, revenue 'none'`);
    }
    expect((await read(S13i.staff, '/revenue-summary')).paymentReliability).toBeNull();

    // The owner, and a STAFF member with revenue read, keep every stored value.
    for (const user of [C.owner, S13i.staffRev]) {
      for (const suffix of ['', '/dossier']) {
        const { contact } = await read(user, suffix);
        expect(contact.paymentReliability, `${user} ${suffix}`).toBe(37);
        expect(contact.riskFlags, `${user} ${suffix}`).toEqual(RISK);
        expect(contact.opportunities, `${user} ${suffix}`).toEqual(OPPORTUNITIES);
        expect(cents(contact.lifetimeValue), `${user} ${suffix}`).toBe(cents(MV.LIFETIME_VALUE));
      }
    }

    // A stored value that is not a list is served as it is (null here).
    const { Prisma } = await import('@prisma/client');
    await db.contact.update({ where: { id: S13i.contactId }, data: { riskFlags: Prisma.DbNull, opportunities: Prisma.DbNull } });
    const bare = (await read(S13i.staff, '')).contact;
    expect(bare.riskFlags).toBeNull();
    expect(bare.opportunities).toBeNull();
  });

  // W4-FEED-COPY-COMPLETE review CR-FCC-1 (D-90): the copies D-90 removed were
  // the only rows of a manual payment and of a booking create with a category
  // (CONTACT) and with entityType 'contact'. The rows that remain name the
  // contact by contactId only.
  it("V55-14 (CR-FCC-1, D-90 review, W4-FEED-COPY-COMPLETE): ?contactId=<contact> still returns each manual payment's FINANCE payment_recorded row and the booking create's 'New booking' row, the one feed row each of them keeps", async () => {
    const res = await agent().get(`/timeline/businesses/${C.biz}/events?limit=200&contactId=${SC.contactId}`).set(HEADER, C.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body as Row[];
    expect(rows.filter((r) => kind(r) === 'FINANCE:payment_recorded:payment').map((r) => r.entityId).sort()).toEqual([SC.partialId, SC.fullId].sort());
    expect(rows.filter((r) => kind(r) === 'bookings:created:booking').map((r) => [r.entityId, r.title])).toEqual([[SC.bookingId, 'New booking']]);
    expect(rows.filter((r) => kind(r) === 'crm:invoice.payment_recorded:contact' || kind(r) === 'crm:booking.created:contact')).toEqual([]);
  });

  // W5-FEED-CATEGORIES (CR-FCC-1; D-90): the one row a manual payment keeps
  // (RevenuePostingService's FINANCE payment_recorded row) and the one a booking
  // create keeps (ActivityEventListener.onBookingCreated's 'New booking') are
  // written with a category, PAYMENT and BOOKING, so ?category= finds them as
  // it found the CRM copies D-90 removed (category CONTACT), where V55-12a kept
  // CONTACT on 'New contact'. Their entity stays the payment / the booking;
  // they name the contact by contactId (?contactId=, V55-14).
  it("V55-14b (CR-FCC-1, D-90, W5-FEED-CATEGORIES, was it.todo): each manual payment's FINANCE payment_recorded row is stored with category PAYMENT and the booking create's 'New booking' row with category BOOKING, so ?category=PAYMENT&contactId=<contact> returns both payments' FINANCE rows and ?category=BOOKING&contactId=<contact> the 'New booking' row; their entity stays the payment / the booking", async () => {
    // As written (fresh read of the stored rows): the two manual payments' rows,
    // and every other FINANCE payment_recorded row of C (V55-13's mark-paid
    // posts one through the same writer) is PAYMENT too.
    const finance = await db.activity.findMany({ where: { businessId: C.biz, module: 'FINANCE', action: 'payment_recorded', entityType: 'payment' }, select: { entityId: true, category: true, contactId: true } });
    expect(finance.filter((r: any) => r.entityId === SC.partialId || r.entityId === SC.fullId).map((r: any) => [r.entityId, r.category, r.contactId]).sort()).toEqual(
      [[SC.partialId, 'PAYMENT', SC.contactId], [SC.fullId, 'PAYMENT', SC.contactId]].sort(),
    );
    expect(finance.length, 'FINANCE payment_recorded rows of C').toBeGreaterThanOrEqual(2);
    expect(finance.filter((r: any) => r.category !== 'PAYMENT')).toEqual([]);
    const booked = await db.activity.findMany({ where: { businessId: C.biz, module: 'bookings', action: 'created', entityId: SC.bookingId }, select: { title: true, category: true, contactId: true } });
    expect(booked.map((r: any) => [r.title, r.category, r.contactId])).toEqual([['New booking', 'BOOKING', SC.contactId]]);

    const read = async (query: string) => {
      const res = await agent().get(`/timeline/businesses/${C.biz}/events?limit=200&contactId=${SC.contactId}&${query}`).set(HEADER, C.owner);
      expect(res.status, `${query}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body as Row[];
    };
    const payments = await read('category=PAYMENT');
    expect(payments.filter((r) => kind(r) === 'FINANCE:payment_recorded:payment').map((r) => r.entityId).sort()).toEqual([SC.partialId, SC.fullId].sort());
    const bookingRows = await read('category=BOOKING');
    expect(bookingRows.filter((r) => kind(r) === 'bookings:created:booking').map((r) => [r.entityId, r.title])).toEqual([[SC.bookingId, 'New booking']]);
    // By entity: the payment's and the booking's own rows.
    expect((await read('entityType=payment')).filter((r) => kind(r) === 'FINANCE:payment_recorded:payment').map((r) => r.entityId).sort()).toEqual([SC.partialId, SC.fullId].sort());
    expect((await read(`entityType=booking&entityId=${SC.bookingId}`)).filter((r) => kind(r) === 'bookings:created:booking').map((r) => r.title)).toEqual(['New booking']);
  });
});
