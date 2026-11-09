/**
 * W3-D17b-REVIEW-SOLICIT-DEDUPE (V1-89, FOLLOW4), REAL database.
 *
 * V1-84 (FOLLOW3-D17-JOB-RUNNER-CLAIMS) made ReviewSolicitationService claim
 * each review_solicitation job before its effect, so one job is sent once. Two
 * gaps were left:
 *
 *   1. The review request send carried no dedupeKey. A booking is solicited
 *      twice when it completes (booking.completed, job review_booking_<booking>)
 *      and its final or deposit invoice is paid (invoice.paid, job
 *      review_invoice_<invoice>): two jobs, two review emails for one visit,
 *      whichever runner tick or server instance takes them.
 *   2. TransactionalEmailService's dedupe was check-then-act: it read
 *      customer_notification_logs for a SENT/QUEUED/DRAINED row with the key and
 *      wrote that row only after the provider answered, so two concurrent sends
 *      with one key both passed the read and both reached the provider.
 *
 * The packet gives every review solicitation send a deterministic key, the
 * booking plus the purpose (`review-solicitation:booking:<booking>`; an invoice
 * that belongs to no booking keeps its own `review-solicitation:invoice:<invoice>`,
 * so a contact's unrelated purchases are each still solicited), and makes the
 * sender's dedupe atomic with storage that already exists: before any effect a
 * keyed send inserts a claim row on idempotency_keys (unique on business and
 * key; no migration) under the slot `transactional-email.dedupe:<key>`. A
 * concurrent send with the same key meets the unique index and stands down
 * (QUEUED, no provider call). The claim is given back once the outcome row is
 * written, so the notification log stays the durable record: a FAILED send can
 * be retried and a QUEUED one is deduped by its row. A claim left by a send that
 * died mid-flight is taken over once older than the stale window (15 minutes).
 *
 * What runs for real against DATABASE_URL: PrismaService, ReviewSolicitationService
 * (its event handlers, which write the jobs, and processPendingJobs), and
 * TransactionalEmailService (business context, do-not-contact check, dedupe,
 * template, notification log). The only stand-in is GmailService, the provider:
 * it reports connected and records what it would send (no provider traffic). In
 * the concurrent cases getGmailStatus is a gate that holds each send until two
 * sends have reached it (or 1.5 s pass), so on a check-then-act dedupe both
 * concurrent sends pass the dedupe read before either writes its row: the race
 * is deterministic. The runner reads every business's due jobs, so its reads
 * are narrowed to this suite's business (ANDed with its own where clause), as
 * job-runner-claims.integration.test.ts does.
 *
 * Fixtures: prefix `v89q_` (registered in test/helpers/fixture-prefixes.json),
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll, beforeEach and
 * afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v89q_';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  service: `${P}service`,
};
const CONTACT_EMAIL = `${P}contact@test.local`;
const CONTACT = { id: ID.contact, firstName: 'V89q', lastName: 'Customer', email: CONTACT_EMAIL };

/** The review solicitation's dedupe keys (W3-D17b): the booking plus the purpose, or the invoice when it has no booking. */
const bookingKey = (bookingId: string) => `review-solicitation:booking:${bookingId}`;
const invoiceKey = (invoiceId: string) => `review-solicitation:invoice:${invoiceId}`;
/** The sender's claim slot on idempotency_keys for a dedupe key. */
const claimSlot = (dedupeKey: string) => `transactional-email.dedupe:${dedupeKey}`;

/** Due long ago (plainly due at any clock). */
const DUE = new Date(Date.UTC(2000, 0, 1));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

let db: any;
let moduleRef: any;
let prismaService: any;
let ReviewSolicitationClass: any;
let TransactionalEmailClass: any;

// ---------------------------------------------------------------------------
// The provider stand-in (GmailService): connected, records, never sends
// ---------------------------------------------------------------------------
type ProviderSend = { businessId: string; to: string; subject: string };
const providerSends: ProviderSend[] = [];
let statusCalls = 0;
/** getGmailStatus holds each caller until this many calls have arrived (0: no gate). */
let statusGate = 0;
const GATE_TIMEOUT_MS = 1_500;
let gmailConnected = true;
/** How many provider sends throw before one succeeds (each send attempt counts). */
let failProviderAttempts = 0;

const gmailStub = {
  getGmailStatus: async (_businessId: string) => {
    statusCalls += 1;
    const deadline = Date.now() + GATE_TIMEOUT_MS;
    while (statusCalls < statusGate && Date.now() < deadline) await pause(5);
    return { connected: gmailConnected };
  },
  sendEmail: async (args: { businessId: string; to: string; subject: string; htmlBody: string }) => {
    if (failProviderAttempts > 0) {
      failProviderAttempts -= 1;
      throw new Error(`${P} provider stand-in refused`);
    }
    providerSends.push({ businessId: args.businessId, to: args.to, subject: args.subject });
    return { messageId: `${P}provider_${providerSends.length}` };
  },
};

/** The real sender over the real database, the provider stood in; every send's input and answer recorded. */
type SendCall = { input: any; result: any };
const sendCalls: SendCall[] = [];
function sender() {
  const real = new TransactionalEmailClass(prismaService, gmailStub);
  return {
    real,
    send: async (input: any) => {
      const result = await real.send(input);
      sendCalls.push({ input, result });
      return result;
    },
  };
}

/** A Prisma client whose scheduledAgentJob reads are narrowed to this suite's business; everything else is the real client. */
function narrowedPrisma() {
  const realClient = prismaService.client;
  const jobs = new Proxy(realClient.scheduledAgentJob, {
    get(target, prop) {
      if (prop === 'findMany') {
        return (args: any) => target.findMany({ ...args, where: { AND: [args?.where ?? {}, { businessId: ID.biz }] } });
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const client = new Proxy(realClient, {
    get(target, prop) {
      if (prop === 'scheduledAgentJob') return jobs;
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { client };
}

/** A runner instance (a server instance's hourly tick): the real service over a narrowed client and the real sender. */
function runner() {
  return new ReviewSolicitationClass(narrowedPrisma(), sender());
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
let invoiceSeq = 0;
async function invoice(id: string) {
  invoiceSeq += 1;
  return db.invoice.create({
    data: { id: `${P}${id}`, businessId: ID.biz, contactId: ID.contact, invoiceNumber: `${P}INV-${invoiceSeq}`, total: 100, status: 'PAID' },
  });
}

async function booking(id: string, opts: { invoiceId?: string; depositInvoiceId?: string } = {}) {
  const start = new Date(Date.UTC(2026, 9, 1, 13, 0, 0));
  return db.booking.create({
    data: {
      id: `${P}${id}`,
      businessId: ID.biz,
      contactId: ID.contact,
      serviceId: ID.service,
      startTime: start,
      endTime: new Date(start.getTime() + 60 * 60_000),
      status: 'COMPLETED',
      invoiceId: opts.invoiceId ?? null,
      depositInvoiceId: opts.depositInvoiceId ?? null,
    },
  });
}

/** The two events of a real booking, as their emitters send them (the invoice.paid payload need not carry its booking). */
async function bookingCompleted(service: any, bookingId: string) {
  await service.onBookingCompleted({ businessId: ID.biz, booking: { id: bookingId }, contact: CONTACT });
}
async function invoicePaid(service: any, invoiceId: string) {
  await service.onInvoicePaid({ businessId: ID.biz, invoice: { id: invoiceId, contact: CONTACT } });
}

/** The jobs the writers scheduled 3 days out, made due now. */
async function makeJobsDue() {
  await db.scheduledAgentJob.updateMany({ where: { businessId: ID.biz, jobType: 'review_solicitation' }, data: { scheduledFor: DUE } });
}

async function jobs() {
  return db.scheduledAgentJob.findMany({ where: { businessId: ID.biz, jobType: 'review_solicitation' }, orderBy: { checkpoint: 'asc' } });
}

async function sentRows() {
  return db.customerNotificationLog.findMany({ where: { businessId: ID.biz, type: 'review_request', status: 'SENT' }, orderBy: { createdAt: 'asc' } });
}

async function claimRows() {
  return db.idempotencyKey.findMany({ where: { businessId: ID.biz, idempotencyKey: { startsWith: 'transactional-email.dedupe:' } } });
}

function reviewInput(dedupeKey: string) {
  return {
    businessId: ID.biz,
    type: 'review_request',
    recipientEmail: CONTACT_EMAIL,
    recipientName: 'V89q Customer',
    contactId: ID.contact,
    templateData: { productNames: ['your service'] },
    dedupeKey,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
async function cleanEffects() {
  for (const sql of [
    `DELETE FROM scheduled_agent_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM customer_notification_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM scheduled_agent_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM customer_notification_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  ReviewSolicitationClass = (await import('../src/modules/conversion/review-solicitation.service')).ReviewSolicitationService;
  TransactionalEmailClass = (await import('../src/modules/notifications/transactional-email.service')).TransactionalEmailService;

  Logger.overrideLogger(false);

  moduleRef = await Test.createTestingModule({ providers: [PrismaService] }).compile();
  prismaService = moduleRef.get(PrismaService);

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V89q Biz', ownerId: ID.owner, currency: 'TTD' } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'V89q', lastName: 'Customer', email: CONTACT_EMAIL } });
  await db.service.create({ data: { id: ID.service, businessId: ID.biz, name: 'V89q Visit', duration: 60, price: 100 } });
}, 120_000);

afterAll(async () => {
  if (moduleRef) await moduleRef.close();
  if (db) await cleanup();
});

beforeEach(async () => {
  providerSends.length = 0;
  sendCalls.length = 0;
  statusCalls = 0;
  statusGate = 0;
  gmailConnected = true;
  failProviderAttempts = 0;
  await cleanEffects();
});

// ---------------------------------------------------------------------------
// RS-01..03: one review request per booking
// ---------------------------------------------------------------------------
describe('W3-D17b-REVIEW-SOLICIT-DEDUPE: a booking is solicited for a review once', () => {
  it('RS-01: two concurrent solicitations for the same booking send once: booking.completed and invoice.paid for its final invoice schedule two jobs, two concurrent runner ticks each take one, and the provider is reached once under the booking key', async () => {
    const inv = await invoice('inv_final');
    const bk = await booking('bk1', { invoiceId: inv.id });
    const writer = runner();
    await bookingCompleted(writer, bk.id);
    await invoicePaid(writer, inv.id);
    await makeJobsDue();
    expect((await jobs()).map((j: any) => j.checkpoint)).toEqual([`review_booking_${bk.id}`, `review_invoice_${inv.id}`]);

    statusGate = 2; // a check-then-act dedupe lets both sends reach the provider check before either writes its row
    await Promise.all([runner().processPendingJobs(), runner().processPendingJobs()]);

    expect(providerSends).toHaveLength(1);
    expect(providerSends[0]).toMatchObject({ businessId: ID.biz, to: CONTACT_EMAIL });
    // Both jobs ran their send, under one key; the one that met the held claim stood down.
    expect(sendCalls.map((c) => c.input.dedupeKey)).toEqual([bookingKey(bk.id), bookingKey(bk.id)]);
    expect(sendCalls.map((c) => c.result.status).sort()).toEqual(['QUEUED', 'SENT']);
    expect((await sentRows()).map((r: any) => r.messageId)).toEqual([bookingKey(bk.id)]);
    expect((await jobs()).map((j: any) => j.status)).toEqual(['COMPLETED', 'COMPLETED']);
    expect(await claimRows()).toEqual([]);
  }, 30_000);

  it('RS-02: two concurrent sends with one dedupe key through the real transactional sender reach the provider once; the second stands down QUEUED on the held claim, and the claim is given back after the SENT row', async () => {
    const one = sender();
    const two = sender();
    statusGate = 2;

    await Promise.all([one.send(reviewInput(bookingKey(`${P}bk_direct`))), two.send(reviewInput(bookingKey(`${P}bk_direct`)))]);

    expect(providerSends).toHaveLength(1);
    expect(sendCalls.map((c) => c.result.status).sort()).toEqual(['QUEUED', 'SENT']);
    expect((await sentRows()).map((r: any) => r.messageId)).toEqual([bookingKey(`${P}bk_direct`)]);
    expect(await claimRows()).toEqual([]);
  }, 30_000);

  it('RS-03: one runner tick over the booking and deposit-invoice solicitations of one booking sends once; the second answers from the SENT row under the booking key', async () => {
    const dep = await invoice('inv_deposit');
    const bk = await booking('bk3', { depositInvoiceId: dep.id });
    const writer = runner();
    await invoicePaid(writer, dep.id);
    await bookingCompleted(writer, bk.id);
    await makeJobsDue();

    await runner().processPendingJobs();

    expect(providerSends).toHaveLength(1);
    expect(sendCalls.map((c) => c.input.dedupeKey)).toEqual([bookingKey(bk.id), bookingKey(bk.id)]);
    expect(sendCalls.map((c) => c.result.status)).toEqual(['SENT', 'SENT']);
    expect((await sentRows()).map((r: any) => r.messageId)).toEqual([bookingKey(bk.id)]);
    expect((await jobs()).map((j: any) => j.status)).toEqual(['COMPLETED', 'COMPLETED']);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// RS-04: the key is the booking (or the invoice), never the contact alone
// ---------------------------------------------------------------------------
describe('W3-D17b-REVIEW-SOLICIT-DEDUPE: the key names what is reviewed, not who', () => {
  it('RS-04: CONTROL: two bookings and an invoice of no booking, all of one contact, are each solicited once, keyed by their own booking or invoice', async () => {
    const bkA = await booking('bkA');
    const bkB = await booking('bkB');
    const loose = await invoice('inv_loose');
    const writer = runner();
    await bookingCompleted(writer, bkA.id);
    await bookingCompleted(writer, bkB.id);
    await invoicePaid(writer, loose.id);
    await makeJobsDue();

    await runner().processPendingJobs();

    expect(providerSends).toHaveLength(3);
    expect((await sentRows()).map((r: any) => r.messageId).sort()).toEqual([bookingKey(bkA.id), bookingKey(bkB.id), invoiceKey(loose.id)].sort());
  }, 30_000);
});

// ---------------------------------------------------------------------------
// RS-05..06: the claim never outlives its send
// ---------------------------------------------------------------------------
describe('W3-D17b-REVIEW-SOLICIT-DEDUPE: the dedupe claim is given back with the outcome row', () => {
  it('RS-05: a send that failed at the provider gives its claim back, so a retry with the same key is sent; a send queued while Gmail is disconnected gives its claim back and the next send with its key answers QUEUED from the row', async () => {
    const failing = sender();
    failProviderAttempts = 3; // every attempt of the first send
    const first = await failing.send(reviewInput(bookingKey(`${P}bk_retry`)));
    expect(first).toEqual({ status: 'FAILED' });
    expect(await claimRows()).toEqual([]);

    const retry = await sender().send(reviewInput(bookingKey(`${P}bk_retry`)));
    expect(retry.status).toBe('SENT');
    expect(providerSends).toHaveLength(1);
    expect(await claimRows()).toEqual([]);

    gmailConnected = false;
    const queued = await sender().send(reviewInput(bookingKey(`${P}bk_queued`)));
    expect(queued).toEqual({ status: 'QUEUED' });
    expect(await claimRows()).toEqual([]);
    gmailConnected = true;
    const again = await sender().send(reviewInput(bookingKey(`${P}bk_queued`)));
    expect(again.status).toBe('QUEUED');
    expect(providerSends).toHaveLength(1);
    const queuedRows = await db.customerNotificationLog.findMany({ where: { businessId: ID.biz, messageId: bookingKey(`${P}bk_queued`) } });
    expect(queuedRows.map((r: any) => r.status)).toEqual(['QUEUED']);
  }, 30_000);

  it('RS-06: a claim held by a live send is respected (QUEUED, no provider call, the claim untouched); a claim left by a send that died over 15 minutes ago is taken over and the send goes out', async () => {
    const liveKey = bookingKey(`${P}bk_live`);
    await db.idempotencyKey.create({ data: { id: `${P}claim_live`, businessId: ID.biz, idempotencyKey: claimSlot(liveKey), status: 'claimed' } });

    const held = await sender().send(reviewInput(liveKey));
    expect(held).toEqual({ status: 'QUEUED' });
    expect(providerSends).toHaveLength(0);
    expect((await claimRows()).map((r: any) => r.id)).toEqual([`${P}claim_live`]);

    const deadKey = bookingKey(`${P}bk_dead`);
    await db.$executeRawUnsafe(
      `INSERT INTO idempotency_keys (id, business_id, idempotency_key, status, created_at, updated_at)
       VALUES ('${P}claim_dead', '${ID.biz}', '${claimSlot(deadKey)}', 'claimed', now() - interval '1 hour', now() - interval '1 hour')`,
    );

    const taken = await sender().send(reviewInput(deadKey));
    expect(taken.status).toBe('SENT');
    expect(providerSends).toHaveLength(1);
    expect((await claimRows()).map((r: any) => r.id)).toEqual([`${P}claim_live`]);
    expect((await sentRows()).map((r: any) => r.messageId)).toEqual([deadKey]);
  }, 30_000);
});
