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
 *   D46-S06  (review SEC-A1-2) the same census over every controller in the
 *            commerce module: each revenue:write handler outside
 *            CommerceController is SERVICE_REFUSED, EXEMPT with a reason, or
 *            OPEN (a known, unruled gap naming its follow-up packet). The OPEN
 *            set is pinned (D46-S06b) and its behaviour is an it.todo (D46-S07,
 *            D46-S08), so the gap shows rather than reading as covered.
 */
import 'reflect-metadata';
import { readdirSync } from 'fs';
import { join } from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { CONTROLLER_WATERMARK, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
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

/**
 * Bare-id revenue:write handlers: the service refuses a human actor unless its
 * Membership in the document's business holds revenue:write (scope map, else
 * role defaults), ModuleScopeGuard's rule restated, so a SUPER_ADMIN the guard
 * waves through is held to it too (review SEC-A1-1; d46-commerce-writes
 * D46-R01..R04).
 */
const SERVICE_REFUSED: Record<string, string> = {
  markInvoicePaid: 'CommerceService.markInvoicePaid: the actor\'s Membership in the invoice\'s business holding revenue:write (RR-R002-01, D46-R01; RA-G4-13 pins the guard half)',
  markInvoicePaymentFailed: 'CommerceService.markInvoicePaymentFailed: the actor\'s Membership holding revenue:write (RR-R002-02, D46-R02)',
  updateInvoiceStatus: 'CommerceService.updateInvoiceStatus: the actor\'s Membership holding revenue:write (RR-R002-03, D46-R03)',
  updateQuoteStatus: 'CommerceService.updateQuoteStatus: the actor\'s Membership holding revenue:write (QS-07, D46-R04)',
};

type OtherKind = 'SERVICE_REFUSED' | 'EXEMPT' | 'OPEN';

const LEVERAGE_ATTRIBUTION = 'revenue attribution override (which source, campaign or staff member earned a booking or invoice): reporting metadata, not an invoice, quote or payment write';
const LEVERAGE_TIME = 'time-cost entries (minutes and cost rate logged against a reference): margin reporting, not an invoice, quote or payment write';
const RECURRING_OPEN =
  'OPEN (review SEC-A1-2, unruled): an invoice schedule the scheduler turns into real invoices. Neither RecurringInvoiceController nor ' +
  'RecurringInvoiceService checks a SUPER_ADMIN\'s Membership, so a non-member SUPER_ADMIN creates an ACTIVE schedule in any tenant. ' +
  'recurring-invoice.controller.ts and recurring-invoice.service.ts are outside this packet\'s write set: needs a D-46 ruling and a follow-up packet';

/**
 * Review repair SEC-A1-2: the census covers every revenue:write handler of
 * every controller in the commerce module, not only CommerceController, so a
 * gap shows here by name. OPEN entries are known gaps waiting on a ruling and
 * a follow-up packet (see the it.todo below), never a claim of coverage.
 */
const OTHER_CONTROLLERS: Record<string, Record<string, { kind: OtherKind; why: string }>> = {
  CommerceAiController: {
    aiExecute: {
      kind: 'SERVICE_REFUSED',
      why:
        'ai-execute: mark_paid, void_invoice, convert_quote and send_quote run CommerceService.markInvoicePaid / updateInvoiceStatus / ' +
        'updateQuoteStatus as req.user, which require that actor\'s Membership holding revenue:write (SEC-A1-1); the product actions are ' +
        'catalog writes (D-46 is ruled for invoice writes)',
    },
  },
  LeverageController: {
    updateAttribution: { kind: 'EXEMPT', why: LEVERAGE_ATTRIBUTION },
    create: { kind: 'EXEMPT', why: LEVERAGE_TIME },
    update: { kind: 'EXEMPT', why: LEVERAGE_TIME },
    remove: { kind: 'EXEMPT', why: LEVERAGE_TIME },
  },
  RecurringInvoiceController: {
    create: { kind: 'OPEN', why: RECURRING_OPEN },
    update: { kind: 'OPEN', why: RECURRING_OPEN },
    pause: { kind: 'OPEN', why: RECURRING_OPEN },
    resume: { kind: 'OPEN', why: RECURRING_OPEN },
    cancel: { kind: 'OPEN', why: RECURRING_OPEN },
  },
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

function revenueWriteHandlersOf(cls: any): string[] {
  return Object.getOwnPropertyNames(cls.prototype).filter((name) => {
    if (name === 'constructor' || typeof cls.prototype[name] !== 'function') return false;
    const scope: { module: string; minLevel: string } | undefined = Reflect.getMetadata(MODULE_SCOPE_KEY, cls.prototype[name]);
    return scope?.module === 'revenue' && scope.minLevel === 'write';
  });
}

function revenueWriteHandlers(): string[] {
  return revenueWriteHandlersOf(Controller);
}

/** Every Nest controller class the commerce module's *.controller.ts files export, by class name. */
const moduleControllers = new Map<string, any>();

beforeAll(async () => {
  ({ CommerceController: Controller } = await import('./commerce.controller'));
  const files = readdirSync(__dirname).filter((f) => f.endsWith('.controller.ts')).sort();
  for (const file of files) {
    const target = join(__dirname, file);
    const mod: Record<string, unknown> = await import(target);
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === 'function' && Reflect.getMetadata(CONTROLLER_WATERMARK, value)) moduleControllers.set(name, value);
    }
  }
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

describe('D-46 write-route census, the whole commerce module (review SEC-A1-2)', () => {
  it('D46-S06: every revenue:write handler of every controller in src/modules/commerce is classified, exactly once: CommerceController by D46-S01\'s lists, every other controller in OTHER_CONTROLLERS (SERVICE_REFUSED, EXEMPT with a reason, or OPEN naming its follow-up); a new controller or handler fails here', () => {
    expect(moduleControllers.get('CommerceController'), 'the loader found CommerceController').toBe(Controller);
    const found: Record<string, string[]> = {};
    for (const [name, cls] of moduleControllers) {
      if (name === 'CommerceController') continue;
      const handlers = revenueWriteHandlersOf(cls).sort();
      if (handlers.length > 0) found[name] = handlers;
    }
    const listed = Object.fromEntries(Object.entries(OTHER_CONTROLLERS).map(([name, handlers]) => [name, Object.keys(handlers).sort()]));
    expect(found, 'classify the new revenue:write controller or handler in OTHER_CONTROLLERS').toEqual(listed);
    for (const [name, handlers] of Object.entries(OTHER_CONTROLLERS)) {
      for (const [handler, { kind, why }] of Object.entries(handlers)) {
        expect(why.trim().length, `${name}.${handler} has no reason`).toBeGreaterThan(20);
        if (kind === 'OPEN') expect(why, `${name}.${handler}: an OPEN entry names its follow-up`).toMatch(/follow-up packet/);
      }
    }
  });

  it('D46-S06b: the OPEN entries are exactly the RecurringInvoiceController writes (the known SEC-A1-2 gap), so a new gap cannot hide among them', () => {
    const open = Object.entries(OTHER_CONTROLLERS).flatMap(([name, handlers]) =>
      Object.entries(handlers).filter(([, v]) => v.kind === 'OPEN').map(([h]) => `${name}.${h}`),
    );
    expect(open.sort()).toEqual(
      ['cancel', 'create', 'pause', 'resume', 'update'].map((h) => `RecurringInvoiceController.${h}`),
    );
  });

  it.todo(
    'D46-S07 (SEC-A1-2, needs a ruling and a follow-up packet): a SUPER_ADMIN with no Membership in :businessId, or one below revenue:write, ' +
      'is refused on POST/PATCH/pause/resume/DELETE commerce/businesses/:businessId/recurring-invoices and no recurring_invoices row is written. ' +
      'Not implementable here: recurring-invoice.controller.ts and recurring-invoice.service.ts are outside the FOLLOW3-A1 write set.',
  );

  it.todo(
    'D46-S08 (SEC-A1-2 / builder deviation, needs a ruling): POST commerce/businesses/:businessId/invoices refuses a non-member SUPER_ADMIN. ' +
      'Not implementable here: commerce-authorization.e2e.test.ts CC-FORWARD pins a non-member SUPER_ADMIN\'s invoice create as 201, ' +
      'and changing that control is outside the FOLLOW3-A1 write set.',
  );
});
