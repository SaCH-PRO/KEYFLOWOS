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
 *            set was pinned (D46-S06b) and its behaviour an it.todo (D46-S07,
 *            D46-S08), so the gap showed rather than reading as covered.
 *
 * W3-D46-CREATE-AND-RECURRING (owner ruling D-46: a platform SUPER_ADMIN who
 * is not a member stays refused on tenant invoice writes) closes that gap:
 * createInvoice (POST businesses/:b/invoices) moves from EXEMPT to GUARDED, and
 * the five RecurringInvoiceController writes from OPEN to GUARDED (each calls
 * RecurringInvoiceController.assertSuperAdminMayWriteRevenue, the same rule, first).
 *   D46-S06b  no OPEN entry remains.
 *   D46-S07   (unit half) each GUARDED write of another controller holds the
 *             D46-S02..S05 contract; the HTTP half is
 *             test/d46-commerce-writes.integration.test.ts D46-S07a..e.
 *   D46-S08   (unit half) createInvoice is GUARDED, so D46-S02..S05 run on
 *             it; the HTTP half is d46-commerce-writes D46-S08.
 *
 * The census reads src/modules/commerce only, so D46-S06b's "no OPEN entry"
 * holds inside that module. Review SEC-W3D46R-3 found the schedule rows
 * written outside it: TrashController (src/modules/trash) restores and
 * permanently deletes recurringInvoice rows behind BusinessGuard alone (its
 * @RequireModuleScope('settings') has no ModuleScopeGuard to enforce it), so a
 * non-member SUPER_ADMIN and a revenue:read STAFF member restore a soft-deleted
 * ACTIVE schedule, which then bills again. trash.controller.ts is outside the
 * W3-D46-CREATE-AND-RECURRING write set: D46-S09 kept it visible as an
 * it.todo for its follow-up packet.
 *
 * W4-TRASH-D46 (owner ruling D-46) makes D46-S09 live: TrashController's
 * restore and permanent delete of a revenue model (recurringInvoice, invoice,
 * quote) refuse a SUPER_ADMIN with no Membership in the business ('Not
 * authorized to update this invoice|quote') and any caller whose Membership is
 * below revenue:write (the guard's 'Insufficient permissions' message), after
 * the Membership lookup alone; a refused call restores nothing, so a trashed
 * schedule never bills again on their call. Every other trash model is
 * unchanged. The HTTP half is d46-commerce-writes D46-S09a..e.
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
  // W3-D46-CREATE-AND-RECURRING (D-46): was EXEMPT, pinned by CC-FORWARD's
  // non-member SUPER_ADMIN 201 (now aligned to the refusal).
  createInvoice: 'invoice',
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

type OtherKind = 'GUARDED' | 'SERVICE_REFUSED' | 'EXEMPT' | 'OPEN';

const LEVERAGE_ATTRIBUTION = 'revenue attribution override (which source, campaign or staff member earned a booking or invoice): reporting metadata, not an invoice, quote or payment write';
const LEVERAGE_TIME = 'time-cost entries (minutes and cost rate logged against a reference): margin reporting, not an invoice, quote or payment write';
const RECURRING_GUARDED =
  'GUARDED (W3-D46-CREATE-AND-RECURRING, D-46; was OPEN, review SEC-A1-2): an invoice schedule the scheduler turns into real invoices. ' +
  'RecurringInvoiceController.assertSuperAdminMayWriteRevenue runs first: a SUPER_ADMIN needs a Membership in :businessId holding revenue:write';

/**
 * Review repair SEC-A1-2: the census covers every revenue:write handler of
 * every controller in the commerce module, not only CommerceController, so a
 * gap shows here by name. OPEN entries are known gaps waiting on a ruling and
 * a follow-up packet, never a claim of coverage (none remains: D46-S06b).
 * GUARDED entries call their controller's D-46 helper first (D46-S07).
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
    create: { kind: 'GUARDED', why: RECURRING_GUARDED },
    update: { kind: 'GUARDED', why: RECURRING_GUARDED },
    pause: { kind: 'GUARDED', why: RECURRING_GUARDED },
    resume: { kind: 'GUARDED', why: RECURRING_GUARDED },
    cancel: { kind: 'GUARDED', why: RECURRING_GUARDED },
  },
};

/** The constructor dependencies of each other controller with GUARDED writes, by name, in order. */
const OTHER_CONSTRUCTOR_DEPS: Record<string, string[]> = {
  RecurringInvoiceController: ['service', 'prisma'],
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
function argsFor(handler: string, req: unknown, cls: any = Controller): unknown[] {
  const meta: Record<string, { index: number; data?: unknown }> = Reflect.getMetadata(ROUTE_ARGS_METADATA, cls, handler) ?? {};
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
  return callOn(Controller, CONSTRUCTOR_DEPS, handler, user, membership);
}

/** callAs for any controller class, built over recorders named `depNames` (its constructor dependencies, in order). */
async function callOn(cls: any, depNames: string[], handler: string, user: { id: string; role: string }, membership: unknown) {
  const calls: Array<{ path: string; args: unknown[] }> = [];
  const answers = { [MEMBERSHIP_LOOKUP]: async () => membership };
  const deps = depNames.map((name) => recorder(name, calls, answers));
  const controller = new cls(...deps);
  const req = { user, headers: {}, params: { businessId: BIZ }, body: {} };
  let error: unknown = null;
  try {
    await controller[handler](...argsFor(handler, req, cls));
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

  it('D46-S06b: no OPEN entry remains (W3-D46-CREATE-AND-RECURRING, D-46: the RecurringInvoiceController writes, the SEC-A1-2 gap, are GUARDED), so a new gap fails here', () => {
    const ofKind = (kind: OtherKind) =>
      Object.entries(OTHER_CONTROLLERS).flatMap(([name, handlers]) =>
        Object.entries(handlers).filter(([, v]) => v.kind === kind).map(([h]) => `${name}.${h}`),
      );
    expect(ofKind('OPEN')).toEqual([]);
    expect(ofKind('GUARDED').sort()).toEqual(
      ['cancel', 'create', 'pause', 'resume', 'update'].map((h) => `RecurringInvoiceController.${h}`),
    );
  });

  // W3-D46-CREATE-AND-RECURRING (D-46): the it.todo D46-S07 made live. The HTTP
  // half (real guards, real rows) is test/d46-commerce-writes.integration.test.ts D46-S07a..e.
  for (const [name, handlers] of Object.entries(OTHER_CONTROLLERS)) {
    for (const [handler, { kind }] of Object.entries(handlers)) {
      if (kind !== 'GUARDED') continue;
      it(`D46-S07 (unit half) ${name}.${handler} (D-46): a SUPER_ADMIN with no membership is refused 403 'Not authorized to update this invoice' after the Membership lookup alone; below revenue:write, the guard's message; a revenue:write member passes the helper; a role USER costs no Membership query`, async () => {
        const cls = moduleControllers.get(name);
        const deps = OTHER_CONSTRUCTOR_DEPS[name];
        expect(cls, name).toBeDefined();
        expect(deps, `${name}: list its constructor dependencies in OTHER_CONSTRUCTOR_DEPS`).toBeDefined();
        expect(String(Reflect.getMetadata(PATH_METADATA, cls.prototype[handler])), handler).toMatch(/^businesses\/:businessId\//);
        const sa = { id: USER_ID, role: 'SUPER_ADMIN' };

        const none = await callOn(cls, deps!, handler, sa, null);
        expect(none.error, String(none.error)).toBeInstanceOf(ForbiddenException);
        expect((none.error as Error).message).toBe('Not authorized to update this invoice');
        expect(none.calls.map((c) => c.path)).toEqual([MEMBERSHIP_LOOKUP]);
        expect(none.calls[0]!.args[0]).toMatchObject({ where: { userId_businessId: { userId: USER_ID, businessId: BIZ } } });

        for (const [membership, level] of [
          [{ role: 'STAFF', permissionScopes: null }, 'read'],
          [{ role: 'ADMIN', permissionScopes: { revenue: 'none', crm: 'write' } }, 'none'],
        ] as const) {
          const below = await callOn(cls, deps!, handler, sa, membership);
          expect(below.error, `${level}: ${String(below.error)}`).toBeInstanceOf(ForbiddenException);
          expect((below.error as Error).message).toBe(`Insufficient permissions: revenue requires write access (you have ${level})`);
          expect(below.calls.map((c) => c.path)).toEqual([MEMBERSHIP_LOOKUP]);
        }

        for (const membership of [{ role: 'ADMIN', permissionScopes: null }, { role: 'STAFF', permissionScopes: { revenue: 'write' } }]) {
          const ok = await callOn(cls, deps!, handler, sa, membership);
          expect(ok.error, String(ok.error)).not.toBeInstanceOf(ForbiddenException);
          expect(ok.calls[0]?.path).toBe(MEMBERSHIP_LOOKUP);
          expect(ok.calls.length, 'the handler went on past the helper').toBeGreaterThan(1);
          expect(ok.calls.slice(1).map((c) => c.path)).not.toContain(MEMBERSHIP_LOOKUP);
        }

        const user = await callOn(cls, deps!, handler, { id: USER_ID, role: 'USER' }, null);
        expect(user.error, String(user.error)).not.toBeInstanceOf(ForbiddenException);
        expect(user.calls.map((c) => c.path)).not.toContain(MEMBERSHIP_LOOKUP);
      });
    }
  }

  // W3-D46-CREATE-AND-RECURRING (D-46): the it.todo D46-S08 made live. The HTTP
  // half is test/d46-commerce-writes.integration.test.ts D46-S08; CC-FORWARD's
  // non-member SUPER_ADMIN expectation is aligned to the refusal.
  it('D46-S08 (unit half, D-46): createInvoice (POST businesses/:businessId/invoices) is GUARDED, not EXEMPT, so D46-S02..S05 hold it to the helper', () => {
    expect(GUARDED.createInvoice).toBe('invoice');
    expect(EXEMPT).not.toHaveProperty('createInvoice');
    expect(pathOf('createInvoice')).toBe('businesses/:businessId/invoices');
  });

  // W3-D46-CREATE-AND-RECURRING review SEC-W3D46R-3 (D-46): reproduced on the
  // repair branch with a real-database probe (TrashController, real
  // BusinessGuard): the non-member SUPER_ADMIN's POST
  // api/businesses/A/trash/recurringInvoice/:id/restore answered 201 and the row
  // came back {status ACTIVE, deletedAt null} (the commerce resume route answers
  // that SUPER_ADMIN 403), its DELETE .../recurringInvoice/:id answered 200 and
  // the row was gone, and a STAFF member holding revenue:'read' restored another
  // schedule with 201.
  // W4-TRASH-D46 (D-46): the it.todo D46-S09 made live, below. TrashController's
  // restore and permanent delete of a revenue model (invoice, quote,
  // recurringInvoice; the trash holds no payment model) run D-46 and the
  // revenue:write module scope first. The HTTP half (real guards, real rows, the
  // real recurring run) is test/d46-commerce-writes.integration.test.ts D46-S09a..e.
});

describe('D46-S09 (W4-TRASH-D46, D-46; review SEC-W3D46R-3): TrashController restore and permanent delete of revenue models', () => {
  const TRASH_DEPS = ['prisma', 'catalog'];
  const TRASH_REVENUE: Record<string, 'invoice' | 'quote'> = { recurringInvoice: 'invoice', invoice: 'invoice', quote: 'quote' };
  let Trash: any;

  beforeAll(async () => {
    ({ TrashController: Trash } = await import('../trash/trash.controller'));
  }, 120_000);

  /** Calls TrashController[handler] for `model` as `user`, with the Membership lookup answering `membership`. */
  async function trashCall(handler: 'restore' | 'permanentDelete', model: string, user: { id: string; role: string }, membership: unknown) {
    const calls: Array<{ path: string; args: unknown[] }> = [];
    const answers = { [MEMBERSHIP_LOOKUP]: async () => membership };
    const controller = new Trash(...TRASH_DEPS.map((name) => recorder(name, calls, answers)));
    const req = { user, headers: {}, params: { businessId: BIZ, model, id: `${model}_d46` }, body: {} };
    const meta: Record<string, { index: number; data?: unknown }> = Reflect.getMetadata(ROUTE_ARGS_METADATA, Trash, handler) ?? {};
    const args: unknown[] = [];
    for (const [key, { index, data }] of Object.entries(meta)) {
      const type = Number(key.split(':')[0]);
      if (type === RouteParamtypes.REQUEST) args[index] = req;
      else if (type === RouteParamtypes.PARAM) args[index] = data === 'businessId' ? BIZ : data === 'model' ? model : `${model}_d46`;
      else args[index] = undefined;
    }
    let error: unknown = null;
    try {
      await controller[handler](...args);
    } catch (err) {
      error = err;
    }
    return { calls, error };
  }

  for (const handler of ['restore', 'permanentDelete'] as const) {
    for (const [model, subject] of Object.entries(TRASH_REVENUE)) {
      it(`D46-S09 TrashController.${handler} ${model} (D-46): a SUPER_ADMIN with no membership is refused 403 'Not authorized to update this ${subject}' after the Membership lookup alone`, async () => {
        const { calls, error } = await trashCall(handler, model, { id: USER_ID, role: 'SUPER_ADMIN' }, null);
        expect(error, String(error)).toBeInstanceOf(ForbiddenException);
        expect((error as Error).message).toBe(`Not authorized to update this ${subject}`);
        expect(calls.map((c) => c.path)).toEqual([MEMBERSHIP_LOOKUP]);
        expect(calls[0]!.args[0]).toMatchObject({ where: { userId_businessId: { userId: USER_ID, businessId: BIZ } } });
      });

      it(`D46-S09 TrashController.${handler} ${model} (D-46, revenue:write): a member below revenue:write (SUPER_ADMIN STAFF, SUPER_ADMIN with an explicit revenue:'none', USER STAFF, USER with an explicit revenue:'read') is refused with the guard's message after the lookup alone; a USER with no membership gets 'Not a member of this business'`, async () => {
        for (const [user, membership, level] of [
          [{ id: USER_ID, role: 'SUPER_ADMIN' }, { role: 'STAFF', permissionScopes: null }, 'read'],
          [{ id: USER_ID, role: 'SUPER_ADMIN' }, { role: 'ADMIN', permissionScopes: { revenue: 'none', crm: 'write' } }, 'none'],
          [{ id: USER_ID, role: 'USER' }, { role: 'STAFF', permissionScopes: null }, 'read'],
          [{ id: USER_ID, role: 'USER' }, { role: 'ADMIN', permissionScopes: { revenue: 'read' } }, 'read'],
        ] as const) {
          const { calls, error } = await trashCall(handler, model, user, membership);
          expect(error, `${user.role} ${level}: ${String(error)}`).toBeInstanceOf(ForbiddenException);
          expect((error as Error).message).toBe(`Insufficient permissions: revenue requires write access (you have ${level})`);
          expect(calls.map((c) => c.path)).toEqual([MEMBERSHIP_LOOKUP]);
        }
        const none = await trashCall(handler, model, { id: USER_ID, role: 'USER' }, null);
        expect(none.error, String(none.error)).toBeInstanceOf(ForbiddenException);
        expect((none.error as Error).message).toBe('Not a member of this business');
        expect(none.calls.map((c) => c.path)).toEqual([MEMBERSHIP_LOOKUP]);
      });

      it(`D46-S09 TrashController.${handler} ${model} (D-46): a revenue:write member (SUPER_ADMIN ADMIN, SUPER_ADMIN explicit write, USER OWNER) is admitted past the check and the handler goes on`, async () => {
        for (const [user, membership] of [
          [{ id: USER_ID, role: 'SUPER_ADMIN' }, { role: 'ADMIN', permissionScopes: null }],
          [{ id: USER_ID, role: 'SUPER_ADMIN' }, { role: 'STAFF', permissionScopes: { revenue: 'write' } }],
          [{ id: USER_ID, role: 'USER' }, { role: 'OWNER', permissionScopes: null }],
        ] as const) {
          const { calls, error } = await trashCall(handler, model, user, membership);
          expect(error, String(error)).not.toBeInstanceOf(ForbiddenException);
          expect(calls[0]?.path).toBe(MEMBERSHIP_LOOKUP);
          expect(calls.length, 'the handler went on past the check').toBeGreaterThan(1);
          expect(calls.slice(1).map((c) => c.path)).not.toContain(MEMBERSHIP_LOOKUP);
        }
      });
    }

    it(`D46-S09 TrashController.${handler} control: a model outside revenue (contact) is unchanged: no Membership lookup, even for a non-member SUPER_ADMIN`, async () => {
      const { calls } = await trashCall(handler, 'contact', { id: USER_ID, role: 'SUPER_ADMIN' }, null);
      expect(calls.map((c) => c.path)).not.toContain(MEMBERSHIP_LOOKUP);
      expect(calls[0]?.path).toBe('prisma.client.contact.findFirst');
    });
  }

  it('D46-S09 TrashController control: a model the trash does not hold (payment) is still a 400 before any lookup', async () => {
    const { calls, error } = await trashCall('restore', 'payment', { id: USER_ID, role: 'SUPER_ADMIN' }, null);
    expect(String(error)).toMatch(/not trashable/);
    expect(calls).toEqual([]);
  });
});
