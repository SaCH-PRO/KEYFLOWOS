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
 */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
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
    interceptor.intercept(ctx as never, { handle: () => of(call.response ?? {}) }),
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
