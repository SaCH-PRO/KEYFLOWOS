/**
 * V1-12-DM-RECURRING-GUARD — the recurring invoice run (REAL database).
 *
 * #174 REL-03 / PRS-M15: processRecurringInvoices() set `running = true` and
 * only reset it on the last line of the happy path. One rejected due-schedule
 * scan (a transient DB error) left the flag set, and every later run of that
 * process returned [] without reading a schedule: recurring invoicing stopped
 * silently until a restart.
 *
 * #174 REL-04 / PRS-M16: the run created the invoice, moved it to SENT (its own
 * transaction, which posts AR/Revenue under ACCRUAL) and only then advanced
 * nextRunDate, with no transaction around the three. A failure between SENT
 * and the advance left a SENT, posted invoice behind a schedule still due for
 * the same period, and the next run billed the customer a second time.
 *
 * This file pins, against the real ledger chain:
 *   GUARD    a rejected scan releases the flag; the next run processes the
 *            due schedule. An overlapping call on the same instance is still
 *            refused (the guard is kept, not removed).
 *   ONE-TX   the schedule advance, the invoice create and the SENT transition
 *            run in one transaction, the advance before SENT. A failure of the
 *            advance or of the SENT step (its ACCRUAL posting) leaves no
 *            invoice and no posting behind; the next run bills the period once.
 *   RACE     two runners (two server instances) reading the same due period
 *            create one invoice: the advance is a compare-and-set on the
 *            nextRunDate both read.
 *   LEDGER   one Invoice:<id>:invoice_finalized posting per period under
 *            ACCRUAL, none duplicated.
 *
 * V1-12 review repairs pinned here as well:
 *   CLAIM    the compare-and-set re-applies the scan's due predicate: a
 *            schedule paused, cancelled, soft-deleted or ended between the
 *            scan and the claim is not billed (ST-12-1, ST-12-2a); the invoice
 *            is built from the claimed row, so an amount changed after the
 *            scan bills at the new amount (ST-12-2b); a frequency changed after
 *            the scan is not advanced on the scanned one.
 *   TENANT   create refuses a contact of another business (404, nothing
 *            written); a legacy schedule bound to one is never billed and its
 *            contact reaches no listener, on a CASH business where no posting
 *            refuses it; the contact is checked again on the claimed row
 *            (ST-12-3).
 *
 * Wiring: RecurringInvoiceService, InvoiceWorkflowService, RevenuePostingService,
 * PostingService and ChartOfAccountsSeederService are the real classes against
 * DATABASE_URL. The PrismaService handed to the recurring and workflow services
 * wraps the real client to (a) inject one-shot faults (scan rejects, schedule
 * advance throws), (b) record which transaction each write ran in, and (c)
 * scope the due-schedule scan to this suite's businesses, so a run never bills
 * another suite's schedules. The scan's own where clause is kept verbatim.
 * The ACCRUAL posting is the real one, wrapped to fail once on demand.
 * The event emitter and the timeline are recorders.
 *
 * Fixtures: prefix `v12a_`; hard-deleted by raw SQL with sqlLikePrefix() in
 * beforeAll and afterAll; no $transaction wrapping. Each case seeds its own
 * schedule and every schedule is cancelled after the case.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v12a_';

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
  /** A CASH business: no posting stands between a schedule and its SENT invoice (ST-12-3). */
  cashBiz: `${P}cashbiz`,
  cashContact: `${P}cashcontact`,
  /** Another tenant and its customer. */
  otherBiz: `${P}otherbiz`,
  otherContact: `${P}xcontact`,
};
const OTHER_EMAIL = `${P}xcustomer@test.local`;
/** The businesses whose schedules a run of this suite may read. */
const SCANNED = [ID.biz, ID.cashBiz];

let db: any;
let realLedger: any;
/**
 * A fresh RecurringInvoiceService (one server process) over the wrapped client.
 * Each case builds its own, so a flag left set by one case cannot refuse the
 * runs of the next; the race case builds two.
 */
let newRunner: () => any;

// ---------------------------------------------------------------- recorders

const events: Array<{ name: string; payload: any }> = [];
const eventRecorder = {
  emit: (name: string, payload: unknown) => {
    events.push({ name, payload });
    return true;
  },
  emitAsync: async (name: string, payload: unknown) => {
    events.push({ name, payload });
    return [];
  },
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

/** One-shot faults, consumed by the wrapped client and the posting probe. */
const faults = {
  scanRejects: 0,
  advanceThrows: 0,
  postingThrows: 0,
};

/** Writes on recurring_invoices / invoices, in call order, tagged with the transaction they ran in (null: none). */
const opLog: Array<{ tx: number | null; op: 'advance' | 'invoice.create' | 'invoice.sent' | 'failure.record'; ref?: string }> = [];
let txSeq = 0;

interface Gate {
  arrive(): Promise<void>;
  allArrived: Promise<void>;
  release(): void;
}
/** Holds the due-schedule scan of each runner until `expected` runners have read, then (auto) releases them together. */
let scanGate: Gate | null = null;

function makeGate(expected: number, autoRelease: boolean): Gate {
  let arrived = 0;
  let open!: () => void;
  let allIn!: () => void;
  const released = new Promise<void>((r) => { open = r; });
  const allArrived = new Promise<void>((r) => { allIn = r; });
  // Never hang the suite: a gate opens by itself after 10 s.
  const timer = setTimeout(() => open(), 10_000);
  timer.unref?.();
  return {
    async arrive() {
      arrived += 1;
      if (arrived >= expected) {
        allIn();
        if (autoRelease) { clearTimeout(timer); open(); }
      }
      await released;
    },
    allArrived,
    release() { clearTimeout(timer); open(); },
  };
}

const INJECTED = 'v12a injected fault';

function wrapDelegate(model: 'recurringInvoice' | 'invoice', delegate: any, tx: number | null) {
  return new Proxy(delegate, {
    get(target, prop) {
      const orig = Reflect.get(target, prop);
      if (typeof orig !== 'function') return orig;
      return (...args: any[]) => {
        const a = args[0] ?? {};
        if (model === 'recurringInvoice' && prop === 'findMany' && tx === null) {
          if (faults.scanRejects > 0) {
            faults.scanRejects -= 1;
            return Promise.reject(new Error(`${INJECTED}: due-schedule scan lost its connection`));
          }
          // Scope the scan to this suite's business; the service's own where is kept as is.
          const scoped = { ...a, where: { AND: [a.where ?? {}, { businessId: { in: SCANNED } }] } };
          const rows = orig.apply(target, [scoped]);
          const gate = scanGate;
          return gate ? Promise.resolve(rows).then(async (r: unknown) => { await gate.arrive(); return r; }) : rows;
        }
        if (model === 'recurringInvoice' && (prop === 'update' || prop === 'updateMany')) {
          const ref = a.where?.id;
          if (a.data && a.data.nextRunDate !== undefined) {
            opLog.push({ tx, op: 'advance', ref });
            if (faults.advanceThrows > 0) {
              faults.advanceThrows -= 1;
              return Promise.reject(new Error(`${INJECTED}: schedule advance failed`));
            }
          } else if (a.data && a.data.failureCount !== undefined) {
            opLog.push({ tx, op: 'failure.record', ref });
          }
        }
        if (model === 'invoice' && prop === 'create') {
          opLog.push({ tx, op: 'invoice.create', ref: a.data?.recurringInvoiceId });
        }
        if (model === 'invoice' && prop === 'update' && a.data?.status === 'SENT') {
          opLog.push({ tx, op: 'invoice.sent', ref: a.where?.id });
        }
        return orig.apply(target, args);
      };
    },
  });
}

function wrapClient(client: any, tx: number | null): any {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'recurringInvoice' || prop === 'invoice') {
        return wrapDelegate(prop, Reflect.get(target, prop), tx);
      }
      if (prop === '$transaction' && tx === null) {
        return (arg: any, opts?: any) =>
          typeof arg === 'function'
            ? target.$transaction((inner: any) => arg(wrapClient(inner, ++txSeq)), opts)
            : target.$transaction(arg, opts);
      }
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

// ---------------------------------------------------------------- helpers

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM recurring_invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** A MONTHLY schedule due one minute ago: exactly one period is due, the next one is a month out. */
async function seedDueSchedule(tag: string, owner: { businessId: string; contactId: string } = { businessId: ID.biz, contactId: ID.contact }) {
  const id = `${P}rec_${tag}`;
  const nextRunDate = new Date(Date.now() - 60_000);
  await db.recurringInvoice.create({
    data: {
      id,
      businessId: owner.businessId,
      contactId: owner.contactId,
      name: `V12 ${tag}`,
      description: `v12 ${tag} retainer`,
      frequency: 'MONTHLY',
      amount: 150,
      currency: 'TTD',
      startDate: new Date('2026-01-01T00:00:00Z'),
      nextRunDate,
      status: 'ACTIVE',
    },
  });
  const advanced = new Date(nextRunDate);
  advanced.setMonth(advanced.getMonth() + 1);
  return { id, nextRunDate, advanced };
}

async function scheduleRow(id: string) {
  return db.recurringInvoice.findUnique({
    where: { id },
    select: { nextRunDate: true, generatedCount: true, failureCount: true, lastError: true, lastGeneratedAt: true },
  });
}

async function invoicesOf(scheduleId: string): Promise<Array<{ id: string; status: string; total: number }>> {
  return db.invoice.findMany({
    where: { recurringInvoiceId: scheduleId },
    select: { id: true, status: true, total: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** invoice_finalized postings of the suite's business whose source is one of `invoiceIds`. */
async function finalizedPostings(invoiceIds: string[]): Promise<Array<{ externalRef: string; sourceId: string; status: string; amount: unknown }>> {
  if (invoiceIds.length === 0) return [];
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, sourceType: 'Invoice', sourceId: { in: invoiceIds }, externalRef: { endsWith: ':invoice_finalized' } },
    select: { externalRef: true, sourceId: true, status: true, amount: true },
  });
}

/** invoice_finalized postings written since `before` (a snapshot from allFinalizedPostings()). */
async function postingsSince(before: Array<{ externalRef: string }>): Promise<string[]> {
  const seen = new Set(before.map((p) => p.externalRef));
  return (await allFinalizedPostings()).map((p) => p.externalRef).filter((ref) => !seen.has(ref));
}

/** Every invoice_finalized posting of the suite's business. */
async function allFinalizedPostings(): Promise<Array<{ externalRef: string; sourceId: string }>> {
  return db.financialTransaction.findMany({
    where: { businessId: ID.biz, externalRef: { endsWith: ':invoice_finalized' } },
    select: { externalRef: true, sourceId: true },
  });
}

/** The period was billed exactly once: one SENT invoice, one AR posting keyed on it, schedule advanced one period. */
async function expectBilledOnce(schedule: { id: string; advanced: Date }) {
  const invoices = await invoicesOf(schedule.id);
  expect(invoices, 'one invoice for the period').toHaveLength(1);
  expect(invoices[0].status).toBe('SENT');
  const postings = await finalizedPostings(invoices.map((i) => i.id));
  expect(postings, 'one invoice_finalized posting for the period').toHaveLength(1);
  expect(postings[0].externalRef).toBe(`Invoice:${invoices[0].id}:invoice_finalized`);
  expect(postings[0].status).toBe('POSTED');
  expect(Number(postings[0].amount)).toBe(150);
  const row = await scheduleRow(schedule.id);
  expect(row.nextRunDate.getTime(), 'nextRunDate advanced exactly one period').toBe(schedule.advanced.getTime());
  expect(row.generatedCount).toBe(1);
  return invoices[0];
}

// ---------------------------------------------------------------- lifecycle

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { RecurringInvoiceService } = await import('../src/modules/commerce/recurring-invoice.service');
  const { InvoiceWorkflowService } = await import('../src/modules/commerce/invoice-workflow.service');
  const { RevenuePostingService } = await import('../src/modules/finance/revenue-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');

  const prismaSvc = new PrismaService();
  const coaSeeder = new ChartOfAccountsSeederService(prismaSvc);
  realLedger = new RevenuePostingService(prismaSvc, new PostingService(prismaSvc), coaSeeder, { recordEvent: async () => null } as any);

  // The ACCRUAL posting is the real one; it fails once when a case asks for it.
  const postingProbe = {
    onInvoiceFinalized: async (invoiceId: string, opts?: unknown) => {
      if (faults.postingThrows > 0) {
        faults.postingThrows -= 1;
        throw new Error(`${INJECTED}: AR/Revenue posting failed`);
      }
      return realLedger.onInvoiceFinalized(invoiceId, opts);
    },
    onInvoiceVoided: async (invoiceId: string, opts?: unknown) => realLedger.onInvoiceVoided(invoiceId, opts),
  };

  const wrappedPrisma = { client: wrapClient(db, null) } as any;
  const workflow = new InvoiceWorkflowService(wrappedPrisma, eventRecorder as any, postingProbe as any, {} as any);
  newRunner = () => new RecurringInvoiceService(wrappedPrisma, eventRecorder as any, workflow);

  await cleanup(); // in case a prior run aborted

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V12 Recurring Biz', ownerId: ID.owner, currency: 'TTD', accountingBasis: 'ACCRUAL' } });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'V12', lastName: 'Customer', email: `${P}customer@test.local` } });
  await coaSeeder.ensureDefaults(ID.biz);
  await db.business.create({ data: { id: ID.cashBiz, name: 'V12 Cash Biz', ownerId: ID.owner, currency: 'TTD', accountingBasis: 'CASH' } });
  await db.contact.create({ data: { id: ID.cashContact, businessId: ID.cashBiz, firstName: 'V12', lastName: 'Cash Customer', email: `${P}cashcustomer@test.local` } });
  await db.business.create({ data: { id: ID.otherBiz, name: 'V12 Other Tenant', ownerId: ID.owner, currency: 'TTD' } });
  await db.contact.create({ data: { id: ID.otherContact, businessId: ID.otherBiz, firstName: 'V12', lastName: 'Other Tenant Customer', email: OTHER_EMAIL } });
}, 180_000);

afterAll(async () => {
  if (db) await cleanup();
});

afterEach(async () => {
  faults.scanRejects = 0;
  faults.advanceThrows = 0;
  faults.postingThrows = 0;
  scanGate = null;
  events.length = 0;
  opLog.length = 0;
  // A case's schedule never leaks into the next case's run.
  await db.recurringInvoice.updateMany({ where: { businessId: { in: SCANNED } }, data: { status: 'CANCELLED' } });
});

// ---------------------------------------------------------------- cases

describe('fixture sanity (real rows)', () => {
  it('seeded one ACCRUAL business with its chart of accounts and a contact', async () => {
    const biz = await db.business.findUnique({ where: { id: ID.biz }, select: { accountingBasis: true } });
    expect(biz.accountingBasis).toBe('ACCRUAL');
    const ar = await db.chartOfAccount.findUnique({ where: { businessId_systemKey: { businessId: ID.biz, systemKey: 'ACCOUNTS_RECEIVABLE' } } });
    expect(ar).not.toBeNull();
    expect((await db.contact.findUnique({ where: { id: ID.contact } })).businessId).toBe(ID.biz);
  });
});

describe('GUARD: the run flag is released on failure (REL-03 / PRS-M15)', () => {
  it('after the due-schedule scan rejects once, the next run is not refused: it processes the due schedule', async () => {
    const schedule = await seedDueSchedule('scan');
    const svc = newRunner();

    faults.scanRejects = 1;
    await expect(svc.processRecurringInvoices()).rejects.toThrow(INJECTED);

    const second = await svc.processRecurringInvoices();
    expect(second.map((r: any) => r.recurringId), 'the second run read and billed the due schedule').toContain(schedule.id);
    await expectBilledOnce(schedule);

    // And the flag is released after a successful run too: a third run reads again (nothing is due).
    faults.scanRejects = 0;
    const third = await svc.processRecurringInvoices();
    expect(third).toEqual([]);
    await expectBilledOnce(schedule);
  });

  it('control: a call that overlaps a run in flight on the same instance still returns [] (the guard is kept)', async () => {
    const schedule = await seedDueSchedule('overlap');
    const svc = newRunner();

    const gate = makeGate(1, false);
    scanGate = gate;
    const first = svc.processRecurringInvoices();
    await gate.allArrived; // the first run holds the flag and has read the schedule

    const overlapping = await svc.processRecurringInvoices();
    expect(overlapping, 'an overlapping call on the same instance is refused').toEqual([]);

    gate.release();
    const done = await first;
    expect(done.map((r: any) => r.recurringId)).toEqual([schedule.id]);
    await expectBilledOnce(schedule);
  });
});

describe('ONE-TX: schedule advance and invoice creation in one transaction (REL-04 / PRS-M16)', () => {
  it('the schedule advance fails during the run: the next run bills the period once, and the failed attempt leaves nothing behind', async () => {
    const schedule = await seedDueSchedule('advance');
    const svc = newRunner();
    const postingsBefore = await allFinalizedPostings();

    faults.advanceThrows = 1;
    const failedRun = await svc.processRecurringInvoices();
    const left = {
      invoices: await invoicesOf(schedule.id),
      postings: await postingsSince(postingsBefore),
      row: await scheduleRow(schedule.id),
      events: events.map((e) => e.name),
    };

    events.length = 0;
    const retry = await svc.processRecurringInvoices();

    // The headline: the period is billed once across the failed run and the retry.
    const invoice = await expectBilledOnce(schedule);
    expect(retry.map((r: any) => r.recurringId)).toEqual([schedule.id]);
    const row = await scheduleRow(schedule.id);
    expect(row.failureCount).toBe(0);
    expect(row.lastError).toBeNull();
    expect(events.filter((e) => e.name === 'invoice.sent').map((e) => e.payload.invoice.id)).toEqual([invoice.id]);
    expect(events.filter((e) => e.name === 'invoice.created').map((e) => e.payload.invoice.id)).toEqual([invoice.id]);

    // The failed attempt left nothing: no invoice, no posting, schedule still due, failure recorded, no invoice event.
    expect(failedRun.map((r: any) => r.recurringId)).not.toContain(schedule.id);
    expect(left.invoices, 'the failed attempt left an invoice behind').toEqual([]);
    expect(left.postings, 'the failed attempt left a posting behind').toEqual([]);
    expect(left.row.nextRunDate.getTime()).toBe(schedule.nextRunDate.getTime());
    expect(left.row.generatedCount).toBe(0);
    expect(left.row.failureCount).toBe(1);
    expect(left.row.lastError).toContain('schedule advance failed');
    expect(left.events).toContain('recurring_invoice.failed');
    expect(left.events, 'an invoice event for an invoice that does not exist').not.toContain('invoice.sent');
    expect(left.events).not.toContain('invoice.created');

    // A third run the same hour bills nothing more.
    expect(await svc.processRecurringInvoices()).toEqual([]);
    await expectBilledOnce(schedule);
  });

  it('nextRunDate is advanced in the same transaction as the invoice create and the SENT transition, before SENT', async () => {
    const schedule = await seedDueSchedule('order');
    const svc = newRunner();

    const result = await svc.processRecurringInvoices();
    expect(result.map((r: any) => r.recurringId)).toEqual([schedule.id]);
    const invoice = await expectBilledOnce(schedule);

    const advance = opLog.findIndex((o) => o.op === 'advance' && o.ref === schedule.id);
    const create = opLog.findIndex((o) => o.op === 'invoice.create' && o.ref === schedule.id);
    const sent = opLog.findIndex((o) => o.op === 'invoice.sent' && o.ref === invoice.id);
    expect([advance, create, sent].every((i) => i >= 0), JSON.stringify(opLog)).toBe(true);
    expect(opLog[advance].tx, 'the schedule advance ran outside any transaction').not.toBeNull();
    expect(opLog[create].tx, 'the invoice create and the schedule advance ran in different transactions').toBe(opLog[advance].tx);
    expect(opLog[sent].tx, 'the SENT transition and the schedule advance ran in different transactions').toBe(opLog[advance].tx);
    expect(advance, 'the schedule advanced after SENT').toBeLessThan(sent);
  });

  it('the SENT step fails (its ACCRUAL posting throws): the create and the advance roll back with it; the retry bills once', async () => {
    const schedule = await seedDueSchedule('posting');
    const svc = newRunner();
    const postingsBefore = await allFinalizedPostings();

    faults.postingThrows = 1;
    const failedRun = await svc.processRecurringInvoices();
    const left = {
      invoices: await invoicesOf(schedule.id),
      postings: await postingsSince(postingsBefore),
      row: await scheduleRow(schedule.id),
    };

    const retry = await svc.processRecurringInvoices();

    await expectBilledOnce(schedule);
    expect(retry.map((r: any) => r.recurringId)).toEqual([schedule.id]);

    expect(failedRun.map((r: any) => r.recurringId)).not.toContain(schedule.id);
    expect(left.invoices, 'a DRAFT invoice was left behind by the failed SENT').toEqual([]);
    expect(left.postings).toEqual([]);
    expect(left.row.nextRunDate.getTime(), 'the schedule advanced past a period that was never billed').toBe(schedule.nextRunDate.getTime());
    expect(left.row.generatedCount).toBe(0);
    expect(left.row.failureCount).toBe(1);
    expect(left.row.lastError).toContain('posting failed');
  });
});

describe('RACE: two runners on one due period', () => {
  it('two instances that both read the period as due create one invoice and one posting; the loser records no failure', async () => {
    const schedule = await seedDueSchedule('race');

    scanGate = makeGate(2, true); // both runners have read the schedule as due before either writes
    const [a, b] = await Promise.all([newRunner().processRecurringInvoices(), newRunner().processRecurringInvoices()]);

    const billed = [...a, ...b].filter((r: any) => r.recurringId === schedule.id);
    expect(billed, 'both runners billed the period').toHaveLength(1);
    await expectBilledOnce(schedule);
    const row = await scheduleRow(schedule.id);
    expect(row.failureCount, 'the runner that lost the period recorded a failure').toBe(0);
    expect(events.filter((e) => e.name === 'recurring_invoice.failed')).toEqual([]);
  });
});

/** Holds the next run's due-schedule scan after it has read; resolves once the run has read the schedules. */
async function runHeldAfterScan(svc: any) {
  const gate = makeGate(1, false);
  scanGate = gate;
  const run: Promise<any[]> = svc.processRecurringInvoices();
  await gate.allArrived;
  return { release: async () => { gate.release(); return run; } };
}

describe('CLAIM: the compare-and-set re-applies the due predicate to the row it bills (V1-12 review ST-12-1 / ST-12-2)', () => {
  it('a schedule paused, cancelled or soft-deleted between the scan and the claim is not billed, and no failure is recorded', async () => {
    const paused = await seedDueSchedule('pause');
    const cancelled = await seedDueSchedule('cancel');
    const deleted = await seedDueSchedule('softdel');
    const svc = newRunner();

    const held = await runHeldAfterScan(svc); // the run has read all three as due
    await svc.pauseRecurringInvoice(ID.biz, paused.id);
    await svc.cancelRecurringInvoice(ID.biz, cancelled.id);
    await db.recurringInvoice.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const result = await held.release();

    expect(result, 'the run billed a schedule the owner stopped after the scan').toEqual([]);
    for (const s of [paused, cancelled, deleted]) {
      expect(await invoicesOf(s.id), s.id).toEqual([]);
      const row = await scheduleRow(s.id);
      expect(row.nextRunDate.getTime(), `${s.id} advanced`).toBe(s.nextRunDate.getTime());
      expect(row.generatedCount).toBe(0);
      expect(row.failureCount, `${s.id}: a skipped claim is not a failure`).toBe(0);
    }
    const names = events.map((e) => e.name);
    expect(names).not.toContain('invoice.sent');
    expect(names).not.toContain('recurring_invoice.generated');
    expect(names).not.toContain('recurring_invoice.failed');
  });

  it('a schedule ended (endDate moved into the past) between the scan and the claim is not billed', async () => {
    const ended = await seedDueSchedule('ended');
    const svc = newRunner();

    const held = await runHeldAfterScan(svc);
    await svc.updateRecurringInvoice({ id: ended.id, businessId: ID.biz, endDate: new Date(Date.now() - 60 * 60_000) });
    const result = await held.release();

    expect(result, 'the run billed a period after the schedule ended').toEqual([]);
    expect(await invoicesOf(ended.id)).toEqual([]);
    const row = await scheduleRow(ended.id);
    expect(row.nextRunDate.getTime()).toBe(ended.nextRunDate.getTime());
    expect(row.generatedCount).toBe(0);
    expect(row.failureCount).toBe(0);
  });

  it('an amount changed between the scan and the claim is billed at the amount the schedule holds, not the scanned one', async () => {
    const s = await seedDueSchedule('amount'); // scanned at 150
    const svc = newRunner();

    const held = await runHeldAfterScan(svc);
    await svc.updateRecurringInvoice({ id: s.id, businessId: ID.biz, amount: 999 });
    const result = await held.release();

    expect(result.map((r: any) => r.recurringId)).toEqual([s.id]);
    const invoices = await invoicesOf(s.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('SENT');
    expect(Number(invoices[0].total), 'billed at the scanned amount').toBe(999);
    const items = await db.invoiceItem.findMany({ where: { invoiceId: invoices[0].id }, select: { unitPrice: true, total: true } });
    expect(items.map((i: any) => [Number(i.unitPrice), Number(i.total)])).toEqual([[999, 999]]);
    const postings = await finalizedPostings([invoices[0].id]);
    expect(postings.map((p) => Number(p.amount)), 'AR posted at the scanned amount').toEqual([999]);
    const generated = events.filter((e) => e.name === 'recurring_invoice.generated');
    expect(generated.map((e) => e.payload.recurringInvoice.amount)).toEqual([999]);
    const row = await scheduleRow(s.id);
    expect(row.nextRunDate.getTime()).toBe(s.advanced.getTime());
    expect(row.generatedCount).toBe(1);
  });

  it('a frequency changed between the scan and the claim is not advanced on the scanned frequency: the run skips it, the next run bills it once on the new one', async () => {
    const s = await seedDueSchedule('freq'); // scanned MONTHLY
    const svc = newRunner();

    const held = await runHeldAfterScan(svc);
    await svc.updateRecurringInvoice({ id: s.id, businessId: ID.biz, frequency: 'WEEKLY' });
    const result = await held.release();

    expect(result, 'the run advanced the schedule on the frequency it scanned').toEqual([]);
    expect(await invoicesOf(s.id)).toEqual([]);
    expect((await scheduleRow(s.id)).failureCount).toBe(0);

    const next = await svc.processRecurringInvoices();
    expect(next.map((r: any) => r.recurringId)).toEqual([s.id]);
    expect(await invoicesOf(s.id)).toHaveLength(1);
    const weekly = new Date(s.nextRunDate);
    weekly.setDate(weekly.getDate() + 7);
    const row = await scheduleRow(s.id);
    expect(row.nextRunDate.getTime(), 'advanced one WEEKLY period').toBe(weekly.getTime());
    expect(row.generatedCount).toBe(1);
  });
});

describe("TENANT: a schedule never binds or bills another business's contact (V1-12 review ST-12-3)", () => {
  /** Every recorded event whose payload carries the other tenant's contact (its id or its customer's email). */
  const leaks = () =>
    events
      .filter((e) => { const s = JSON.stringify(e.payload ?? null); return s.includes(ID.otherContact) || s.includes(OTHER_EMAIL); })
      .map((e) => e.name);

  it('create: a contact of another business is a 404 and nothing is written; an unknown id the same; a contact of the business is accepted', async () => {
    const svc = newRunner();
    const input = (contactId: unknown) => ({
      businessId: ID.cashBiz,
      contactId: contactId as string,
      name: `V12 create ${String(contactId)}`,
      frequency: 'MONTHLY',
      amount: 150,
      startDate: '2026-01-01T00:00:00Z',
      nextRunDate: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
    });

    await expect(svc.createRecurringInvoice(input(ID.otherContact))).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.createRecurringInvoice(input(`${P}no_such_contact`))).rejects.toThrow('Contact not found');
    await expect(svc.createRecurringInvoice(input(''))).rejects.toBeInstanceOf(BadRequestException);
    const written = await db.recurringInvoice.findMany({ where: { name: { startsWith: 'V12 create' } }, select: { id: true } });
    expect(written, 'a schedule bound to a contact outside the business was written').toEqual([]);
    expect(events.filter((e) => e.name === 'recurring_invoice.created')).toEqual([]);
    expect(leaks()).toEqual([]);

    const ok = await svc.createRecurringInvoice(input(ID.cashContact));
    expect(ok.contactId).toBe(ID.cashContact);
    expect(ok.contact.businessId).toBe(ID.cashBiz);
  });

  it('run (CASH business): a legacy schedule bound to another business\'s contact is not billed, its contact reaches no listener, and the failure is recorded; the business\'s own schedule is billed', async () => {
    const legacy = await seedDueSchedule('foreign', { businessId: ID.cashBiz, contactId: ID.otherContact });
    const own = await seedDueSchedule('cashown', { businessId: ID.cashBiz, contactId: ID.cashContact });
    const svc = newRunner();

    const result = await svc.processRecurringInvoices();

    expect(result.map((r: any) => r.recurringId), 'only the schedule bound to the business\'s own contact is billed').toEqual([own.id]);
    expect(await invoicesOf(legacy.id), 'an invoice was issued to another tenant\'s contact').toEqual([]);
    const row = await scheduleRow(legacy.id);
    expect(row.nextRunDate.getTime()).toBe(legacy.nextRunDate.getTime());
    expect(row.generatedCount).toBe(0);
    expect(row.failureCount).toBe(1);
    expect(row.lastError).toContain('does not belong to its business');

    expect(leaks(), 'an event handed another tenant\'s contact to a listener').toEqual([]);
    const failed = events.filter((e) => e.name === 'recurring_invoice.failed');
    expect(failed.map((e) => [e.payload.recurringInvoice.id, e.payload.recurringInvoice.contactId, e.payload.businessId])).toEqual([[legacy.id, null, ID.cashBiz]]);

    const ownInvoices = await db.invoice.findMany({ where: { recurringInvoiceId: own.id }, select: { status: true, businessId: true, contactId: true } });
    expect(ownInvoices).toEqual([{ status: 'SENT', businessId: ID.cashBiz, contactId: ID.cashContact }]);
  });

  it('run: the contact is checked again on the claimed row, inside the transaction (a schedule re-pointed to another business\'s contact after the scan is not billed)', async () => {
    // No API path re-points a schedule's contact today; the direct write stands
    // in for any writer between the scan and the claim, and pins the check that
    // guards the invoice now built from the claimed row.
    const s = await seedDueSchedule('repoint', { businessId: ID.cashBiz, contactId: ID.cashContact });
    const svc = newRunner();

    const held = await runHeldAfterScan(svc);
    await db.recurringInvoice.update({ where: { id: s.id }, data: { contactId: ID.otherContact } });
    const result = await held.release();

    expect(result).toEqual([]);
    expect(await invoicesOf(s.id), 'an invoice was issued to another tenant\'s contact').toEqual([]);
    const row = await scheduleRow(s.id);
    expect(row.nextRunDate.getTime(), 'the claim was not rolled back with the refused invoice').toBe(s.nextRunDate.getTime());
    expect(row.generatedCount).toBe(0);
    expect(row.failureCount).toBe(1);
    expect(row.lastError).toContain('does not belong to its business');
    expect(leaks()).toEqual([]);
    expect(events.map((e) => e.name)).not.toContain('invoice.sent');
  });
});

describe('LEDGER: one invoice_finalized posting per period under ACCRUAL', () => {
  it('across every case above, each invoice of this business has exactly one posting and no posting is duplicated or orphaned', async () => {
    const invoices: Array<{ id: string; status: string }> = await db.invoice.findMany({
      where: { businessId: ID.biz },
      select: { id: true, status: true },
    });
    const postings = await allFinalizedPostings();
    const refs = postings.map((p) => p.externalRef);
    expect(new Set(refs).size, 'a duplicated invoice_finalized posting').toBe(refs.length);
    expect(invoices.every((i) => i.status === 'SENT'), JSON.stringify(invoices)).toBe(true);
    expect(refs.sort()).toEqual(invoices.map((i) => `Invoice:${i.id}:invoice_finalized`).sort());
    // One period per schedule was due in each case that billed: scan, overlap, advance, order, posting, race, amount, freq.
    const perSchedule = await db.invoice.groupBy({ by: ['recurringInvoiceId'], where: { businessId: ID.biz }, _count: { _all: true } });
    expect(perSchedule.every((g: any) => g._count._all === 1), JSON.stringify(perSchedule)).toBe(true);
  });
});
