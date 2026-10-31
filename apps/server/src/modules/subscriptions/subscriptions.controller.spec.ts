/**
 * R0-08 / R0-08c-SUBSCRIPTION-AUTHORITY — the controller's plan-change routes
 * are OWNER only and audited (pure: a recording fake Prisma client, no
 * database). The real-database proof of the same rule, including the review's
 * reproduction of ST-R008-1, is test/subscriptions-authority.integration.test.ts.
 *
 * RED-BEFORE (the R0 working branch at 8b8cf715): every POST handler passed the
 * request straight to SubscriptionsService, so a STAFF or ADMIN member — who
 * BusinessGuard admits like any member — started trials, activated, cancelled
 * and recorded manual payments, and nothing named the acting user.
 *
 * The rule pinned here: the POST handlers are exactly trial, activate, cancel,
 * checkout and record-payment (a new POST route fails U01 until it is
 * classified); each admits the business owner (OWNER membership or
 * Business.ownerId) and SUPER_ADMIN, refuses everyone else with 403
 * {code:'SUBSCRIPTION_OWNER_ONLY'} before reading the body and with nothing
 * written, and writes one team_activity_logs row naming the actor on success.
 * The GET handlers keep the membership rule BusinessGuard applies.
 */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ForbiddenException, RequestMethod, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

const BIZ = 'biz_sub_1';
const OWNER = { id: 'u_owner', role: 'USER' };
const LEGACY_OWNER = { id: 'u_legacy_owner', role: 'USER' };
const STAFF = { id: 'u_staff', role: 'USER' };
const ADMIN = { id: 'u_admin', role: 'USER' };
const SUPER = { id: 'u_super', role: 'SUPER_ADMIN' };

const WRITE_METHODS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

interface Call { model: string; method: string; args: any }

/**
 * A Prisma client that records every model call. Reads answer from `state`;
 * writes echo their data back with an id. $transaction runs its callback on
 * the same recorder, so a write inside a transaction is still a write.
 */
function fakePrisma(state: { memberships: Record<string, string>; ownerId: string; activeSub: Record<string, unknown> | null }) {
  const calls: Call[] = [];
  const model = (name: string) =>
    new Proxy({}, {
      get(_t, method) {
        if (typeof method !== 'string' || method === 'then') return undefined;
        return async (args: any) => {
          calls.push({ model: name, method, args });
          if (WRITE_METHODS.has(method)) {
            if (method.endsWith('Many')) return { count: 1 };
            return { id: `fake_${name}_${calls.length}`, currentPeriodStart: new Date(), currentPeriodEnd: new Date(), ...(args?.data ?? {}) };
          }
          if (name === 'membership') {
            const userId = args?.where?.userId_businessId?.userId ?? args?.where?.userId;
            const role = state.memberships[userId];
            return role ? { userId, businessId: BIZ, role } : null;
          }
          if (name === 'business') {
            const where = args?.where ?? {};
            if (where.id && where.id !== BIZ) return null;
            if (where.ownerId && where.ownerId !== state.ownerId) return null;
            return { id: BIZ, ownerId: state.ownerId };
          }
          if (name === 'subscription' && method.startsWith('find') && method !== 'findMany') return state.activeSub;
          if (method === 'findMany') return [];
          if (method === 'count') return 0;
          return null;
        };
      },
    });
  const client: any = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (prop === '$transaction') return async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
      if (prop.startsWith('$')) return undefined;
      return model(prop);
    },
  });
  return {
    prisma: { client },
    writes: () => calls.filter((c) => WRITE_METHODS.has(c.method)),
    auditWrites: () => calls.filter((c) => c.model === 'teamActivityLog' && WRITE_METHODS.has(c.method)),
  };
}

const ACTIVE_FLOW = { id: 'sub_active', businessId: BIZ, plan: 'FLOW', status: 'ACTIVE', currency: 'TTD', priceMonthly: 99 };

/** Every POST handler, with a body the owner's call succeeds with and the subscription state it needs. */
const POST_HANDLERS: Array<{ name: string; path: string; activeSub: typeof ACTIVE_FLOW | null; call: (c: any, user: unknown) => Promise<unknown> }> = [
  { name: 'startTrial', path: 'businesses/:businessId/trial', activeSub: null, call: (c, u) => c.startTrial(BIZ, { plan: 'FLOW', currency: 'TTD' }, u) },
  { name: 'activateSubscription', path: 'businesses/:businessId/activate', activeSub: ACTIVE_FLOW, call: (c, u) => c.activateSubscription(BIZ, { plan: 'KEYFLOW', currency: 'USD', gateway: 'manual' }, u) },
  { name: 'cancelSubscription', path: 'businesses/:businessId/cancel', activeSub: ACTIVE_FLOW, call: (c, u) => c.cancelSubscription(BIZ, u) },
  { name: 'createCheckout', path: 'businesses/:businessId/checkout', activeSub: ACTIVE_FLOW, call: (c, u) => c.createCheckout(BIZ, { plan: 'KEYFLOW', currency: 'USD', gateway: 'wipay' }, u) },
  { name: 'recordSubscriptionPayment', path: 'businesses/:businessId/record-payment', activeSub: ACTIVE_FLOW, call: (c, u) => c.recordSubscriptionPayment(BIZ, { plan: 'KEYFLOW', currency: 'USD', method: 'manual' }, u) },
];

function controllerFor(activeSub: typeof ACTIVE_FLOW | null) {
  const fake = fakePrisma({
    memberships: { [OWNER.id]: 'OWNER', [STAFF.id]: 'STAFF', [ADMIN.id]: 'ADMIN' },
    ownerId: LEGACY_OWNER.id,
    activeSub,
  });
  const controller = new SubscriptionsController(new SubscriptionsService(fake.prisma as any));
  return { controller, ...fake };
}

async function expectOwnerOnly(p: Promise<unknown>, label: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, `${label}: refused`).toBeInstanceOf(ForbiddenException);
  expect((err as ForbiddenException).getResponse(), label).toMatchObject({
    code: 'SUBSCRIPTION_OWNER_ONLY',
    message: 'Only the business owner can change the plan.',
  });
}

function routesOf(method: RequestMethod) {
  const proto = SubscriptionsController.prototype as any;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && Reflect.getMetadata(METHOD_METADATA, proto[name]) === method)
    .map((name) => ({ name, path: Reflect.getMetadata(PATH_METADATA, proto[name]) as string, guards: (Reflect.getMetadata(GUARDS_METADATA, proto[name]) ?? []) as unknown[] }));
}

describe('SubscriptionsController — plan changes are OWNER only and audited (R0-08c)', () => {
  it('[R0-08c-U01] the POST routes are exactly trial, activate, cancel, checkout and record-payment, each behind AuthGuard and BusinessGuard', () => {
    const posts = routesOf(RequestMethod.POST);
    expect(posts.map((r) => [r.name, r.path]).sort()).toEqual(POST_HANDLERS.map((h) => [h.name, h.path]).sort());
    for (const r of posts) {
      expect(r.guards, r.name).toContain(AuthGuard);
      expect(r.guards, r.name).toContain(BusinessGuard);
    }
  });

  it('[R0-08c-U02] RED-BEFORE: every POST handler refuses a STAFF member with 403 SUBSCRIPTION_OWNER_ONLY and writes nothing', async () => {
    for (const h of POST_HANDLERS) {
      const { controller, writes } = controllerFor(h.activeSub);
      await expectOwnerOnly(h.call(controller, STAFF), `STAFF ${h.name}`);
      expect(writes(), `STAFF ${h.name}`).toEqual([]);
    }
  });

  it('[R0-08c-U03] RED-BEFORE: every POST handler refuses an ADMIN member the same way and writes nothing', async () => {
    for (const h of POST_HANDLERS) {
      const { controller, writes } = controllerFor(h.activeSub);
      await expectOwnerOnly(h.call(controller, ADMIN), `ADMIN ${h.name}`);
      expect(writes(), `ADMIN ${h.name}`).toEqual([]);
    }
  });

  it('[R0-08c-U04] RED-BEFORE: authority is checked before the body: a STAFF member sending an unknown plan gets SUBSCRIPTION_OWNER_ONLY, not a validation error', async () => {
    const { controller, writes } = controllerFor(null);
    await expectOwnerOnly(controller.startTrial(BIZ, { plan: 'NOT_A_PLAN' }, STAFF as any), 'STAFF trial NOT_A_PLAN');
    await expectOwnerOnly(
      (controller as any).recordSubscriptionPayment(BIZ, { plan: 'NOT_A_PLAN', currency: 'USD', method: 'manual' }, STAFF),
      'STAFF record-payment NOT_A_PLAN',
    );
    expect(writes()).toEqual([]);
  });

  it('[R0-08c-U05] RED-BEFORE: the OWNER membership is allowed on every POST handler, and each call writes exactly one team_activity_logs row naming the owner', async () => {
    for (const h of POST_HANDLERS) {
      const { controller, auditWrites } = controllerFor(h.activeSub);
      await expect(h.call(controller, OWNER), `OWNER ${h.name}`).resolves.toBeTruthy();
      const audit = auditWrites();
      expect(audit, `OWNER ${h.name}: one audit row`).toHaveLength(1);
      expect(audit[0].args.data, `OWNER ${h.name}`).toMatchObject({ businessId: BIZ, userId: OWNER.id, module: 'billing' });
    }
  });

  it('[R0-08c-U06] the distinguished owner (Business.ownerId) with no membership row is allowed, audited against that owner', async () => {
    for (const h of POST_HANDLERS) {
      const { controller, auditWrites } = controllerFor(h.activeSub);
      await expect(h.call(controller, LEGACY_OWNER), `ownerId owner ${h.name}`).resolves.toBeTruthy();
      expect(auditWrites().map((c) => c.args.data.userId), h.name).toEqual([LEGACY_OWNER.id]);
    }
  });

  it('[R0-08c-U07] SUPER_ADMIN keeps the platform bypass with no membership, audited against the super admin', async () => {
    for (const h of POST_HANDLERS) {
      const { controller, auditWrites } = controllerFor(h.activeSub);
      await expect(h.call(controller, SUPER), `SUPER_ADMIN ${h.name}`).resolves.toBeTruthy();
      expect(auditWrites().map((c) => c.args.data.userId), h.name).toEqual([SUPER.id]);
    }
  });

  it('[R0-08c-U08] RED-BEFORE: a POST handler reached with no authenticated user refuses (401) and writes nothing', async () => {
    for (const h of POST_HANDLERS) {
      const { controller, writes } = controllerFor(h.activeSub);
      const err = await h.call(controller, undefined).then(() => null, (e: unknown) => e);
      expect(err, h.name).toBeInstanceOf(UnauthorizedException);
      expect(writes(), h.name).toEqual([]);
    }
  });

  it('[R0-08c-U09] the GET handlers keep the membership rule: they take no actor and a member reads current, history, payments and check-limit', async () => {
    const gets = routesOf(RequestMethod.GET);
    for (const r of gets.filter((g) => g.path.startsWith('businesses/'))) {
      expect(r.guards, r.name).toContain(BusinessGuard);
    }
    const { controller, writes } = controllerFor(ACTIVE_FLOW);
    await expect(controller.getCurrentSubscription(BIZ)).resolves.toMatchObject({ plan: 'FLOW', status: 'ACTIVE' });
    await expect(controller.getHistory(BIZ)).resolves.toEqual([]);
    await expect(controller.getPaymentHistory(BIZ)).resolves.toEqual([]);
    await expect(controller.checkLimit(BIZ, 'contacts')).resolves.toMatchObject({ allowed: true, current: 0 });
    expect(writes()).toEqual([]);
  });
});
