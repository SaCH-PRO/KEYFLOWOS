/**
 * FOLLOW3-A1-D46-COMMERCE-WRITES (D-46) — the CommerceController write-route
 * census.
 *
 * BusinessGuard and ModuleScopeGuard admit a platform SUPER_ADMIN to every
 * tenant and skip the module scope (core/auth/business.guard.ts,
 * core/auth/module-scope.guard.ts). D-46 keeps a SUPER_ADMIN who is not a
 * member refused on tenant invoice writes, and FOLLOW3-A2 set the rule: that
 * role acts on a business's money only through a Membership in it whose scope
 * map, or role defaults, hold revenue:write. The guards are not changed (that
 * would rewrite RA-G4-13's guard half and QS-07, and refuse SUPER_ADMIN on
 * every other module), so CommerceController applies the rule itself, first,
 * in every `businesses/:businessId` revenue:write handler. This file makes the
 * next such handler visible:
 *
 *   D46-S01  every handler carrying @RequireModuleScope('revenue', 'write') is
 *            listed exactly once: GUARDED (calls the helper first), EXEMPT
 *            (with the reason it is not an invoice, quote or payment write
 *            under D-46) or SERVICE_REFUSED (a bare-id route whose service
 *            checks the actor's Membership itself). A new handler fails here.
 *   D46-S02  each GUARDED handler, called as a SUPER_ADMIN with no membership,
 *            refuses 403 'Not authorized to update this invoice' ('... quote'
 *            for the quote routes) having made exactly one call: the
 *            Membership lookup for (user, path tenant). Nothing else ran.
 *   D46-S03  the same handler, called as a SUPER_ADMIN whose membership holds
 *            revenue:read (STAFF default) or an explicit revenue:'none', is
 *            refused with the guard's message, again after the lookup alone.
 *   D46-S04  a SUPER_ADMIN member with revenue:write (ADMIN default, or an
 *            explicit write) is admitted: the lookup, then the handler goes on.
 *   D46-S05  a regular member (role USER) costs no extra query: the helper
 *            never reads Membership unless role === 'SUPER_ADMIN'.
 */
import 'reflect-metadata';
import { beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { MODULE_SCOPE_KEY } from '../../core/auth/module-scope.guard';

/** Every `businesses/:businessId` invoice, quote and payment write: the helper runs first. */
const GUARDED: Record<string, 'invoice' | 'quote'> = {
  invoiceUnbilledTime: 'invoice',
  bulkUpdateInvoices: 'invoice',
  bulkUpdateQuotes: 'quote',
  deleteInvoice: 'invoice',
  updateInvoice: 'invoice',
  sendQuoteFollowUp: 'quote',
  createQuote: 'quote',
  updateQuote: 'quote',
  deleteQuote: 'quote',
  convertQuoteToInvoice: 'quote',
  createQuotePublicLink: 'quote',
  sendQuoteEmail: 'quote',
  sendInvoiceEmail: 'invoice',
  sendInvoiceReminder: 'invoice',
  resendInvoiceReceipt: 'invoice',
  recordPayment: 'invoice',
  recordPaymentFromEvidence: 'invoice',
  confirmPendingPayment: 'invoice',
  extractPaymentEvidence: 'invoice',
  refundPayment: 'invoice',
  retryPayment: 'invoice',
  resendReceipt: 'invoice',
  createPaymentLink: 'invoice',
  deactivatePaymentLink: 'invoice',
};

const PRODUCTS = 'products/*: the catalog, not an invoice, quote or payment write (D-46 is ruled for invoice writes)';
const GMAIL = 'gmail/*: the connected mailbox (R0-CMF5 binds its connect and disconnect to the owner), not an invoice, quote or payment write';

/** `businesses/:businessId` revenue:write handlers the helper does not cover, and why. */
const EXEMPT: Record<string, string> = {
  createProduct: PRODUCTS,
  bulkUpdateProducts: PRODUCTS,
  updateProduct: PRODUCTS,
  deleteProduct: PRODUCTS,
  upsertProductCostProfile: PRODUCTS,
  scanProductImage: PRODUCTS,
  importProductsFile: PRODUCTS,
  confirmImportedProducts: PRODUCTS,
  modifyGmailMessage: GMAIL,
  sendGmailMessage: GMAIL,
  replyGmailThread: GMAIL,
  backfillStoreLinks: 'store/backfill-links: storefront link maintenance, not an invoice, quote or payment write',
  createInvoice:
    'PINNED, not ruled here: commerce-authorization.e2e.test.ts CC-FORWARD forwards a non-member SUPER_ADMIN\'s invoice create (201), and that suite must stay green (outside this write set). It creates a DRAFT and moves no money; extending D-46 to it needs that control changed (follow-up).',
};

/** Bare-id revenue:write handlers: the service refuses an actor with no Membership in the document's business. */
const SERVICE_REFUSED: Record<string, string> = {
  markInvoicePaid: 'CommerceService.markInvoicePaid: Membership of the actor in the invoice\'s business (RR-R002-01; RA-G4-13 pins the guard half)',
  markInvoicePaymentFailed: 'CommerceService.markInvoicePaymentFailed: Membership of the actor (RR-R002-02)',
  updateInvoiceStatus: 'CommerceService.updateInvoiceStatus: Membership of the actor (RR-R002-03)',
  updateQuoteStatus: 'CommerceService.updateQuoteStatus: Membership of the actor (QS-07)',
};

const BIZ = 'biz_d46';
const USER_ID = 'user_d46';
const MEMBERSHIP_LOOKUP = 'prisma.client.membership.findUnique';
const CONSTRUCTOR_DEPS = ['commerce', 'timeEntries', 'receipts', 'gmail', 'prisma', 'vision', 'subscriptions', 'storeReadiness', 'paymentEvidence', 'profileOwners'];

let Controller: any;

/** A dependency that records every call made through it and answers only what it is told to. */
function recorder(name: string, calls: Array<{ path: string; args: unknown[] }>, answers: Record<string, (...args: unknown[]) => unknown>): any {
  const make = (path: string): any =>
    new Proxy(function stand() {}, {
      get: (_target, prop) => (typeof prop === 'symbol' || prop === 'then' ? undefined : make(`${path}.${String(prop)}`)),
      apply: (_target, _this, args) => {
        calls.push({ path, args });
        const answer = answers[path];
        if (answer) return answer(...args);
        throw new Error(`UNEXPECTED ${path}`);
      },
    });
  return make(name);
}

/** The handler's arguments, built from its route-argument metadata, as the router would pass them. */
function argsFor(handler: string, req: unknown): unknown[] {
  const meta: Record<string, { index: number; data?: unknown }> = Reflect.getMetadata(ROUTE_ARGS_METADATA, Controller, handler) ?? {};
  const args: unknown[] = [];
  for (const [key, { index, data }] of Object.entries(meta)) {
    const type = Number(key.split(':')[0]);
    if (type === RouteParamtypes.REQUEST) args[index] = req;
    else if (type === RouteParamtypes.PARAM) args[index] = data === 'businessId' ? BIZ : `${String(data)}_d46`;
    else if (type === RouteParamtypes.BODY) args[index] = {};
    else args[index] = undefined;
  }
  return args;
}

/** Calls one handler as `user`, with the Membership lookup answering `membership`. */
async function callAs(handler: string, user: { id: string; role: string }, membership: unknown) {
  const calls: Array<{ path: string; args: unknown[] }> = [];
  const answers = { [MEMBERSHIP_LOOKUP]: async () => membership };
  const deps = CONSTRUCTOR_DEPS.map((name) => recorder(name, calls, answers));
  const controller = new Controller(...deps);
  const req = { user, headers: {}, params: { businessId: BIZ }, body: {} };
  let error: unknown = null;
  try {
    await controller[handler](...argsFor(handler, req));
  } catch (err) {
    error = err;
  }
  return { calls, error };
}

function scopeOf(handler: string): { module: string; minLevel: string } | undefined {
  return Reflect.getMetadata(MODULE_SCOPE_KEY, Controller.prototype[handler]);
}

function pathOf(handler: string): string {
  return Reflect.getMetadata(PATH_METADATA, Controller.prototype[handler]) ?? '';
}

function revenueWriteHandlers(): string[] {
  return Object.getOwnPropertyNames(Controller.prototype).filter((name) => {
    if (name === 'constructor' || typeof Controller.prototype[name] !== 'function') return false;
    const scope = scopeOf(name);
    return scope?.module === 'revenue' && scope.minLevel === 'write';
  });
}

beforeAll(async () => {
  ({ CommerceController: Controller } = await import('./commerce.controller'));
}, 120_000);

describe('D-46 write-route census (FOLLOW3-A1)', () => {
  it('D46-S01: every revenue:write handler is GUARDED, EXEMPT with a reason, or SERVICE_REFUSED, exactly once; GUARDED and EXEMPT are businesses/:businessId routes, SERVICE_REFUSED are not', () => {
    const listed = [...Object.keys(GUARDED), ...Object.keys(EXEMPT), ...Object.keys(SERVICE_REFUSED)];
    expect(new Set(listed).size, 'a handler is listed twice').toBe(listed.length);
    expect(revenueWriteHandlers().sort(), 'list the new revenue:write handler in GUARDED (and call the helper first), EXEMPT or SERVICE_REFUSED').toEqual(listed.sort());
    for (const name of [...Object.keys(GUARDED), ...Object.keys(EXEMPT)]) {
      expect(pathOf(name).startsWith('businesses/:businessId/'), `${name}: ${pathOf(name)}`).toBe(true);
    }
    for (const name of Object.keys(SERVICE_REFUSED)) {
      expect(pathOf(name), name).not.toContain(':businessId');
    }
    for (const [name, why] of Object.entries({ ...EXEMPT, ...SERVICE_REFUSED })) {
      expect(why.trim().length, `${name} has no reason`).toBeGreaterThan(20);
    }
  });

  for (const [handler, subject] of Object.entries(GUARDED)) {
    it(`D46-S02 ${handler}: a SUPER_ADMIN with no membership is refused 403 'Not authorized to update this ${subject}' after the Membership lookup alone`, async () => {
      const { calls, error } = await callAs(handler, { id: USER_ID, role: 'SUPER_ADMIN' }, null);
      expect(error, String(error)).toBeInstanceOf(ForbiddenException);
      expect((error as Error).message).toBe(`Not authorized to update this ${subject}`);
      expect(calls.map((c) => c.path)).toEqual([MEMBERSHIP_LOOKUP]);
      expect(calls[0]!.args[0]).toMatchObject({ where: { userId_businessId: { userId: USER_ID, businessId: BIZ } } });
    });

    it(`D46-S03 ${handler}: a SUPER_ADMIN member holding revenue:read (STAFF default) or an explicit revenue:'none' is refused with the guard's message, after the lookup alone`, async () => {
      for (const [membership, level] of [
        [{ role: 'STAFF', permissionScopes: null }, 'read'],
        [{ role: 'ADMIN', permissionScopes: { revenue: 'none', crm: 'write' } }, 'none'],
      ] as const) {
        const { calls, error } = await callAs(handler, { id: USER_ID, role: 'SUPER_ADMIN' }, membership);
        expect(error, `${level}: ${String(error)}`).toBeInstanceOf(ForbiddenException);
        expect((error as Error).message).toBe(`Insufficient permissions: revenue requires write access (you have ${level})`);
        expect(calls.map((c) => c.path)).toEqual([MEMBERSHIP_LOOKUP]);
      }
    });

    it(`D46-S04 ${handler}: a SUPER_ADMIN member with revenue:write (ADMIN default, explicit write) is admitted past the helper`, async () => {
      for (const membership of [{ role: 'ADMIN', permissionScopes: null }, { role: 'STAFF', permissionScopes: { revenue: 'write' } }]) {
        const { calls, error } = await callAs(handler, { id: USER_ID, role: 'SUPER_ADMIN' }, membership);
        expect(error, String(error)).not.toBeInstanceOf(ForbiddenException);
        expect(calls[0]?.path).toBe(MEMBERSHIP_LOOKUP);
        expect(calls.slice(1).map((c) => c.path)).not.toContain(MEMBERSHIP_LOOKUP);
      }
    });

    it(`D46-S05 ${handler}: a regular member (role USER) costs no Membership query`, async () => {
      const { calls, error } = await callAs(handler, { id: USER_ID, role: 'USER' }, null);
      expect(error, String(error)).not.toBeInstanceOf(ForbiddenException);
      expect(calls.map((c) => c.path)).not.toContain(MEMBERSHIP_LOOKUP);
    });
  }
});
