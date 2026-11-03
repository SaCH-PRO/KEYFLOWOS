/**
 * R0-19-EVIDENCE-BASELINE (M16) — the BusinessEvent audit label of the manual
 * payment route.
 *
 * inferEventMeta walks the route segments right to left and takes the first
 * one in its entity map. `payments` is not in the map, so
 * POST /commerce/businesses/:businessId/invoices/:invoiceId/payments walked
 * back to `invoices` and the audit row said `invoice.create`, with the
 * invoice id as its subject (the handler answers { payment, invoice, ... }, so
 * extractSubjectId found no top-level id and fell back to params.invoiceId).
 *
 * Contract pinned here (pure: the real interceptor and Reflector, the
 * ResilientEmitterService is a recorder; the real-DB pins are in
 * test/evidence-feed.integration.test.ts):
 *
 *   POST .../invoices/:invoiceId/payments -> exactly one emit: payment.record,
 *     subjectType 'payment', subjectId = response.payment.id, the human actor;
 *     never invoice.create, never the invoice id as subject
 *   the same route without a payment id in the response -> subjectId 'unknown', never the invoice id
 *   contacts, invoices and quotes keep their labels (create / update / delete) and subject ids
 *   the rule is the exact route: from-evidence, refund and GET are not relabelled by it
 *   R0-19 review (R19-ST-1): an R0-D2 idempotent replay on the route (the
 *     response's Payment was recorded by another user, or before this request
 *     started) emits nothing: the replay wrote nothing, and a payment.record row
 *     would name the replaying member as the recorder. A fresh record (recorded
 *     by the acting user while the handler ran) still emits exactly one row.
 *     Residual: two concurrent submits by the SAME user both emit payment.record
 *     naming that user (the losing submit's Payment is the winner's, recorded by
 *     the same user after the loser started); the envelope carries no replay flag.
 */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { defer, lastValueFrom, of } from 'rxjs';
import { BusinessEventInterceptor, SKIP_BUSINESS_EVENT_KEY } from './business-event.interceptor';
import type { BusinessEventJob } from './business-event.queue';

const BIZ = 'biz_r19';
const USER = 'user_r19';
const PAYMENT_ROUTE = '/commerce/businesses/:businessId/invoices/:invoiceId/payments';

interface Call {
  method: string;
  routePath: string;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  response?: unknown;
  /** Build the response while the handler runs (after the interceptor took the request). */
  respond?: () => unknown;
  user?: { id: string } | null;
  skip?: boolean;
}

/** Run the real interceptor once and return what it handed the emitter. */
async function run(call: Call): Promise<{ emitted: BusinessEventJob[]; result: unknown }> {
  const emitted: BusinessEventJob[] = [];
  const resilient = {
    emit: async (job: BusinessEventJob) => {
      emitted.push(job);
    },
  };
  const interceptor = new BusinessEventInterceptor(resilient as never, new Reflector());
  const handler = function handler() {
    return undefined;
  };
  if (call.skip) Reflect.defineMetadata(SKIP_BUSINESS_EVENT_KEY, true, handler);
  const req = {
    method: call.method,
    route: { path: call.routePath },
    url: call.routePath,
    params: { businessId: BIZ, ...(call.params ?? {}) },
    body: call.body ?? {},
    user: call.user === undefined ? { id: USER } : call.user ?? undefined,
    headers: { 'user-agent': 'vitest' },
    ip: '127.0.0.1',
  };
  const ctx = {
    getHandler: () => handler,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req }),
  };
  const result = await lastValueFrom(
    interceptor.intercept(ctx as never, {
      handle: () => defer(() => of(call.respond ? call.respond() : call.response ?? {})),
    }),
  );
  // The audit write is a tap(async ...): the response is not held for it.
  await new Promise((resolve) => setImmediate(resolve));
  return { emitted, result };
}

/** The manual payment handler's response shape (CommerceService.recordPayment). */
function paymentResponse(paymentId: string, invoiceId: string) {
  return {
    payment: { id: paymentId, invoiceId, amount: 100, status: 'SUCCESSFUL', method: 'cash' },
    invoice: { id: invoiceId, status: 'PARTIALLY_PAID', total: 250 },
    paidAmount: 100,
    remaining: 150,
  };
}

describe('BusinessEventInterceptor: the manual payment route is audited as a payment (R0-19, M16)', () => {
  it('R19-I01: POST .../invoices/:invoiceId/payments emits exactly one payment.record row whose subject is the Payment, by the acting human', async () => {
    const { emitted, result } = await run({
      method: 'POST',
      routePath: PAYMENT_ROUTE,
      params: { invoiceId: 'inv_1' },
      body: { amount: 100, method: 'cash', reference: 'R19-1' },
      response: paymentResponse('pay_1', 'inv_1'),
    });
    expect(result, 'the response passes through untouched').toEqual(paymentResponse('pay_1', 'inv_1'));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      businessId: BIZ,
      eventType: 'payment.record',
      subjectType: 'payment',
      subjectId: 'pay_1',
      action: 'record',
      actorType: 'human',
      actorId: USER,
      metadata: { route: PAYMENT_ROUTE, httpMethod: 'POST' },
    });
  });

  it('R19-I02: the payment row is never labelled invoice.create and never takes the invoice id as its subject', async () => {
    const { emitted } = await run({
      method: 'POST',
      routePath: PAYMENT_ROUTE,
      params: { invoiceId: 'inv_2' },
      body: { amount: 150, method: 'bank_transfer' },
      response: paymentResponse('pay_2', 'inv_2'),
    });
    expect(emitted.map((e) => e.eventType)).not.toContain('invoice.create');
    expect(emitted.map((e) => e.subjectType)).not.toContain('invoice');
    expect(emitted.map((e) => e.subjectId)).not.toContain('inv_2');
  });

  it('R19-I03: the route path as Express reports it, with or without a leading slash, is matched', async () => {
    for (const routePath of [PAYMENT_ROUTE, PAYMENT_ROUTE.slice(1)]) {
      const { emitted } = await run({
        method: 'POST',
        routePath,
        params: { invoiceId: 'inv_3' },
        response: paymentResponse('pay_3', 'inv_3'),
      });
      expect(emitted, routePath).toHaveLength(1);
      expect(emitted[0], routePath).toMatchObject({ eventType: 'payment.record', subjectId: 'pay_3' });
    }
  });

  it("R19-I04: a payment response without a payment id is subject 'unknown', never the invoice id", async () => {
    const { emitted } = await run({
      method: 'POST',
      routePath: PAYMENT_ROUTE,
      params: { invoiceId: 'inv_4' },
      response: { invoice: { id: 'inv_4' }, paidAmount: 0, remaining: 250 },
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ eventType: 'payment.record', subjectType: 'payment', subjectId: 'unknown' });
  });

  it('R19-I05: an anonymous call on the route is still a payment.record row, attributed to the system', async () => {
    const { emitted } = await run({
      method: 'POST',
      routePath: PAYMENT_ROUTE,
      params: { invoiceId: 'inv_5' },
      response: paymentResponse('pay_5', 'inv_5'),
      user: null,
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ eventType: 'payment.record', actorType: 'system', actorId: 'anonymous' });
  });
});

describe('BusinessEventInterceptor: an idempotent replay on the manual payment route is not audited (R0-19 review, R19-ST-1)', () => {
  const OWNER = 'owner_r19';
  const ADMIN = 'admin_r19';
  const LONG_AGO = () => new Date(Date.now() - 60_000);

  /** recordPayment's envelope around a Payment row with its recorder and creation time. */
  function recorded(paymentId: string, invoiceId: string, recordedBy: string | null, createdAt: Date | string) {
    const r = paymentResponse(paymentId, invoiceId);
    return { ...r, payment: { ...r.payment, recordedBy, createdAt } };
  }

  it("R19-R01: an ADMIN replaying the owner's payment (same reference + amount) emits nothing; the response passes through", async () => {
    const response = recorded('pay_r1', 'inv_r1', OWNER, LONG_AGO());
    const { emitted, result } = await run({
      method: 'POST',
      routePath: PAYMENT_ROUTE,
      params: { invoiceId: 'inv_r1' },
      body: { amount: 100, method: 'cash', reference: 'SLIP-1' },
      response,
      user: { id: ADMIN },
    });
    expect(result).toEqual(response);
    expect(emitted, 'no payment.record row naming the ADMIN as recorder').toEqual([]);
  });

  it('R19-R02: the owner replaying their own payment (recorded before this request) emits nothing', async () => {
    const { emitted } = await run({
      method: 'POST',
      routePath: PAYMENT_ROUTE,
      params: { invoiceId: 'inv_r2' },
      response: recorded('pay_r2', 'inv_r2', OWNER, LONG_AGO()),
      user: { id: OWNER },
    });
    expect(emitted).toEqual([]);
  });

  it('R19-R03: a replay that lost a concurrent insert (the Payment is newer than the request but another member recorded it) emits nothing', async () => {
    const { emitted } = await run({
      method: 'POST',
      routePath: PAYMENT_ROUTE,
      params: { invoiceId: 'inv_r3' },
      respond: () => recorded('pay_r3', 'inv_r3', OWNER, new Date(Date.now() + 5)),
      user: { id: ADMIN },
    });
    expect(emitted).toEqual([]);
  });

  it('R19-R04: a fresh record (recorded by the acting user while the handler ran) still emits exactly one payment.record row; Date or ISO createdAt', async () => {
    for (const stamp of [(d: Date) => d, (d: Date) => d.toISOString()]) {
      const { emitted } = await run({
        method: 'POST',
        routePath: PAYMENT_ROUTE,
        params: { invoiceId: 'inv_r4' },
        respond: () => recorded('pay_r4', 'inv_r4', ADMIN, stamp(new Date())),
        user: { id: ADMIN },
      });
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({ eventType: 'payment.record', subjectId: 'pay_r4', actorType: 'human', actorId: ADMIN });
    }
  });

  it('R19-R05: an anonymous fresh record (recordedBy null) is still a payment.record row; an anonymous replay of a member\'s payment is not', async () => {
    const fresh = await run({
      method: 'POST',
      routePath: PAYMENT_ROUTE,
      params: { invoiceId: 'inv_r5' },
      respond: () => recorded('pay_r5', 'inv_r5', null, new Date()),
      user: null,
    });
    expect(fresh.emitted).toHaveLength(1);
    expect(fresh.emitted[0]).toMatchObject({ eventType: 'payment.record', subjectId: 'pay_r5', actorType: 'system' });

    const replay = await run({
      method: 'POST',
      routePath: PAYMENT_ROUTE,
      params: { invoiceId: 'inv_r5' },
      respond: () => recorded('pay_r5b', 'inv_r5', OWNER, new Date()),
      user: null,
    });
    expect(replay.emitted).toEqual([]);
  });

  it('R19-R06: the replay check belongs to the manual payment rule only: other routes with an old or foreign row still emit their label', async () => {
    const old = LONG_AGO();
    const invoice = await run({
      method: 'POST',
      routePath: '/commerce/businesses/:businessId/invoices',
      response: { id: 'inv_r6', createdAt: old, recordedBy: OWNER, payment: { id: 'pay_r6', recordedBy: OWNER, createdAt: old } },
      user: { id: ADMIN },
    });
    expect(invoice.emitted).toHaveLength(1);
    expect(invoice.emitted[0]).toMatchObject({ eventType: 'invoice.create', subjectId: 'inv_r6' });

    const fromEvidence = await run({
      method: 'POST',
      routePath: `${PAYMENT_ROUTE}/from-evidence`,
      params: { invoiceId: 'inv_r6' },
      response: recorded('pay_r6', 'inv_r6', OWNER, old),
      user: { id: ADMIN },
    });
    expect(fromEvidence.emitted).toHaveLength(1);
    expect(fromEvidence.emitted[0]).toMatchObject({ eventType: 'invoice.create', subjectType: 'invoice' });
  });
});

describe('BusinessEventInterceptor: contacts, invoices and quotes keep their labels (R0-19)', () => {
  const unchanged: Array<[string, Call, Record<string, string>]> = [
    [
      'POST crm contacts -> contact.create, subject = the created contact',
      { method: 'POST', routePath: '/crm/businesses/:businessId/contacts', response: { id: 'ct_1', firstName: 'A' } },
      { eventType: 'contact.create', subjectType: 'contact', action: 'create', subjectId: 'ct_1' },
    ],
    [
      'PATCH crm contact -> contact.update',
      { method: 'PATCH', routePath: '/crm/businesses/:businessId/contacts/:contactId', params: { contactId: 'ct_2' }, response: { id: 'ct_2' } },
      { eventType: 'contact.update', subjectType: 'contact', action: 'update', subjectId: 'ct_2' },
    ],
    [
      'DELETE crm contact -> contact.delete, subject from the path when the response has no id',
      { method: 'DELETE', routePath: '/crm/businesses/:businessId/contacts/:contactId', params: { contactId: 'ct_3' }, response: { success: true } },
      { eventType: 'contact.delete', subjectType: 'contact', action: 'delete', subjectId: 'ct_3' },
    ],
    [
      'POST commerce invoices -> invoice.create, subject = the created invoice',
      { method: 'POST', routePath: '/commerce/businesses/:businessId/invoices', response: { id: 'inv_10', status: 'DRAFT' } },
      { eventType: 'invoice.create', subjectType: 'invoice', action: 'create', subjectId: 'inv_10' },
    ],
    [
      'PATCH commerce invoice -> invoice.update',
      { method: 'PATCH', routePath: '/commerce/businesses/:businessId/invoices/:invoiceId', params: { invoiceId: 'inv_11' }, response: { id: 'inv_11' } },
      { eventType: 'invoice.update', subjectType: 'invoice', action: 'update', subjectId: 'inv_11' },
    ],
    [
      'DELETE commerce invoice -> invoice.delete, subject from the path',
      { method: 'DELETE', routePath: '/commerce/businesses/:businessId/invoices/:invoiceId', params: { invoiceId: 'inv_12' }, response: { success: true } },
      { eventType: 'invoice.delete', subjectType: 'invoice', action: 'delete', subjectId: 'inv_12' },
    ],
    [
      'POST commerce quotes -> quote.create, subject = the created quote',
      { method: 'POST', routePath: '/commerce/businesses/:businessId/quotes', response: { id: 'q_1' } },
      { eventType: 'quote.create', subjectType: 'quote', action: 'create', subjectId: 'q_1' },
    ],
    [
      'PATCH commerce quote -> quote.update',
      { method: 'PATCH', routePath: '/commerce/businesses/:businessId/quotes/:quoteId', params: { quoteId: 'q_2' }, response: { id: 'q_2' } },
      { eventType: 'quote.update', subjectType: 'quote', action: 'update', subjectId: 'q_2' },
    ],
  ];

  for (const [name, call, expected] of unchanged) {
    it(`R19-U: ${name}`, async () => {
      const { emitted } = await run(call);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({ businessId: BIZ, actorId: USER, actorType: 'human', ...expected });
    });
  }
});

describe('BusinessEventInterceptor: the payment rule is the exact route and method (R0-19 scope)', () => {
  it('R19-S01: GET on the payments route emits nothing (reads are not audited)', async () => {
    const { emitted } = await run({ method: 'GET', routePath: PAYMENT_ROUTE, params: { invoiceId: 'inv_20' }, response: { payments: [] } });
    expect(emitted).toEqual([]);
  });

  it('R19-S02: from-evidence is not matched by the manual-route rule; it keeps its current invoice.create label (outside R0-19)', async () => {
    const { emitted } = await run({
      method: 'POST',
      routePath: `${PAYMENT_ROUTE}/from-evidence`,
      params: { invoiceId: 'inv_21' },
      response: paymentResponse('pay_21', 'inv_21'),
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ eventType: 'invoice.create', subjectType: 'invoice' });
  });

  it('R19-S03: the refund route is not matched by the manual-route rule; it keeps its current label (outside R0-19)', async () => {
    const { emitted } = await run({
      method: 'POST',
      routePath: '/commerce/businesses/:businessId/payments/:paymentId/refund',
      params: { paymentId: 'pay_22' },
      response: { id: 'pay_22', status: 'REFUNDED' },
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ eventType: 'unknown.create', subjectId: 'pay_22' });
  });

  it('R19-S04: @SkipBusinessEvent still skips the manual payment route', async () => {
    const { emitted } = await run({
      method: 'POST',
      routePath: PAYMENT_ROUTE,
      params: { invoiceId: 'inv_23' },
      response: paymentResponse('pay_23', 'inv_23'),
      skip: true,
    });
    expect(emitted).toEqual([]);
  });

  it('R19-S05: a route under no business emits nothing, payment-shaped or not', async () => {
    const emitted: BusinessEventJob[] = [];
    const interceptor = new BusinessEventInterceptor({ emit: async (j: BusinessEventJob) => void emitted.push(j) } as never, new Reflector());
    const req = { method: 'POST', route: { path: PAYMENT_ROUTE }, params: {}, body: {}, headers: {} };
    const ctx = { getHandler: () => function h() { return undefined; }, switchToHttp: () => ({ getRequest: () => req }) };
    await lastValueFrom(interceptor.intercept(ctx as never, { handle: () => of(paymentResponse('pay_24', 'inv_24')) }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(emitted).toEqual([]);
  });
});

/**
 * V1-41b review (SEC-V41b-1, CR-V41b-1): the pending-payment confirm route
 * records the money of a PENDING extracted row through the manual payment
 * door, as the confirming member, and answers recordPayment's envelope plus
 * confirmedPaymentId. It is audited exactly as a manual payment: one
 * payment.record row on the SUCCESSFUL Payment it recorded, by the confirming
 * member; never invoice.create on the invoice, never the pending row or the
 * invoice as subject. A confirm answering a Payment this request did not
 * record (the door's keyed replay, or a manual payment that took the door's
 * key) emits nothing (R19-ST-1). The real-DB pins are V41-T1i/T1j in
 * test/untrusted-payment-inputs.integration.test.ts.
 */
describe('BusinessEventInterceptor: the pending-payment confirm route is audited as the payment it records (V1-41b review)', () => {
  const CONFIRM_ROUTE = `${PAYMENT_ROUTE}/:paymentId/confirm`;
  const OTHER = 'other_member_v41b';

  /** CommerceService.recordPayment's envelope as confirmPendingPayment answers it. */
  function confirmed(paymentId: string, invoiceId: string, pendingId: string, recordedBy: string | null, createdAt: Date | string) {
    const r = paymentResponse(paymentId, invoiceId);
    return { ...r, payment: { ...r.payment, recordedBy, createdAt }, confirmedPaymentId: pendingId };
  }

  it('V41b-A01: a fresh confirm emits exactly one payment.record row whose subject is the recorded Payment, by the confirming member; never invoice.create, never the pending row or the invoice as subject', async () => {
    for (const routePath of [CONFIRM_ROUTE, CONFIRM_ROUTE.slice(1)]) {
      const { emitted, result } = await run({
        method: 'POST',
        routePath,
        params: { invoiceId: 'inv_c1', paymentId: 'pend_c1' },
        body: { amount: 100 },
        respond: () => confirmed('pay_c1', 'inv_c1', 'pend_c1', USER, new Date()),
      });
      expect(result, routePath).toMatchObject({ payment: { id: 'pay_c1' }, confirmedPaymentId: 'pend_c1' });
      expect(emitted, routePath).toHaveLength(1);
      expect(emitted[0], routePath).toMatchObject({
        businessId: BIZ,
        eventType: 'payment.record',
        subjectType: 'payment',
        subjectId: 'pay_c1',
        action: 'record',
        actorType: 'human',
        actorId: USER,
        metadata: { route: routePath, httpMethod: 'POST' },
      });
      expect(emitted.map((e) => e.eventType), routePath).not.toContain('invoice.create');
      expect(emitted.map((e) => e.subjectId), routePath).not.toContain('inv_c1');
      expect(emitted.map((e) => e.subjectId), routePath).not.toContain('pend_c1');
    }
  });

  it('V41b-A02: a confirm answering a Payment recorded before this request (the keyed replay after a failed confirm) or by another member (a manual payment that took the door key, a lost race) emits nothing', async () => {
    const replays = [
      confirmed('pay_c2', 'inv_c2', 'pend_c2', USER, new Date(Date.now() - 60_000)),
      confirmed('pay_c2b', 'inv_c2', 'pend_c2', OTHER, new Date(Date.now() - 60_000)),
    ];
    for (const response of replays) {
      const { emitted, result } = await run({
        method: 'POST',
        routePath: CONFIRM_ROUTE,
        params: { invoiceId: 'inv_c2', paymentId: 'pend_c2' },
        body: { amount: 100 },
        response,
      });
      expect(result).toEqual(response);
      expect(emitted, response.payment.id).toEqual([]);
    }
    const race = await run({
      method: 'POST',
      routePath: CONFIRM_ROUTE,
      params: { invoiceId: 'inv_c2', paymentId: 'pend_c2' },
      respond: () => confirmed('pay_c2c', 'inv_c2', 'pend_c2', OTHER, new Date(Date.now() + 5)),
    });
    expect(race.emitted).toEqual([]);
  });

  it('V41b-A03: the confirm rule is the exact route: the manual payment route keeps its own rule and from-evidence keeps its label', async () => {
    const manual = await run({
      method: 'POST',
      routePath: PAYMENT_ROUTE,
      params: { invoiceId: 'inv_c3' },
      respond: () => confirmed('pay_c3', 'inv_c3', 'pend_c3', USER, new Date()),
    });
    expect(manual.emitted.map((e) => [e.eventType, e.subjectId])).toEqual([['payment.record', 'pay_c3']]);

    const fromEvidence = await run({
      method: 'POST',
      routePath: `${PAYMENT_ROUTE}/from-evidence`,
      params: { invoiceId: 'inv_c3' },
      response: paymentResponse('pay_c3b', 'inv_c3'),
    });
    expect(fromEvidence.emitted.map((e) => [e.eventType, e.subjectType])).toEqual([['invoice.create', 'invoice']]);
  });
});
