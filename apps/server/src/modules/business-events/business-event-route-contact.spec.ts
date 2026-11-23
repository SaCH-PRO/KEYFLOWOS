/**
 * V1-72 review (SEC-1): the contact a business event names is taken only from
 * server-derived data. The interceptor records the route's :contactId, which
 * the router resolved and the guards checked, as metadata.routeContactId; it
 * never lifts a contact id out of the request body.
 */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { defer, lastValueFrom, of } from 'rxjs';
import { BusinessEventInterceptor } from './business-event.interceptor';
import type { BusinessEventJob } from './business-event.queue';

async function run(routePath: string, params: Record<string, string>, body: Record<string, unknown>, response: unknown) {
  const emitted: BusinessEventJob[] = [];
  const interceptor = new BusinessEventInterceptor({ emit: async (j: BusinessEventJob) => void emitted.push(j) } as never, new Reflector());
  const handler = function handler() { return undefined; };
  const req = {
    method: 'POST', route: { path: routePath }, url: routePath,
    params: { businessId: 'biz_1', ...params }, body, user: { id: 'u1' },
    headers: { 'user-agent': 'vitest' }, ip: '127.0.0.1',
  };
  const ctx = { getHandler: () => handler, getClass: () => class C {}, switchToHttp: () => ({ getRequest: () => req }) };
  await lastValueFrom(interceptor.intercept(ctx as never, { handle: () => defer(() => of(response)) }));
  await new Promise((resolve) => setImmediate(resolve));
  return emitted;
}

describe('BusinessEventInterceptor records the route contact (V1-72 review, SEC-1)', () => {
  it('a route under contacts/:contactId puts the param in metadata.routeContactId', async () => {
    const [job] = await run('/crm/businesses/:businessId/contacts/:contactId/messages', { contactId: 'c_route' }, { body: 'hi' }, { id: 'm1' });
    expect(job.metadata).toMatchObject({ route: '/crm/businesses/:businessId/contacts/:contactId/messages', httpMethod: 'POST', routeContactId: 'c_route' });
  });

  it('a body contactId is never lifted into metadata', async () => {
    const [job] = await run('/commerce/businesses/:businessId/invoices/:invoiceId', { invoiceId: 'inv_1' }, { total: 5, contactId: 'c_planted' }, { id: 'inv_1' });
    expect(job.metadata).not.toHaveProperty('routeContactId');
  });
});
