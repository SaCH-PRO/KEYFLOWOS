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
 *
 * W4-TRASH-D46 review repair SEC-TRASH-D46-1 (revenue:read; D-46 rules writes
 * only): listTrashed applies ModuleScopeGuard's revenue:read rule to the same
 * three models (D46-S09f: a model filter naming one refuses a member below
 * revenue:read; D46-S09g: the every-model listing leaves them out for that
 * member). A SUPER_ADMIN keeps the guard's read admission, with no lookup.
 *
 * W6-TRASH-MODULE-SCOPE (owner ruling D-95; review SEC-TL500-3) carries the
 * same rule to every trash model: restoring or permanently deleting a trashed
 * record needs write access to the module the record belongs to, and seeing it
 * in the trash needs that module's read access (one table, TRASH_MODULE in
 * trash.controller.ts, restated here as D95_MODULE: CRM for contacts,
 * accounts and opportunities; revenue for invoices, quotes and recurring
 * invoices; people, the canonical 'team' module, for staff; marketing, the
 * canonical 'content' module, for community posts and landing pages). D-46
 * still refuses a non-member SUPER_ADMIN on the revenue models. The trashed
 * rows of the models the client's soft-delete extension covers are read with a
 * raw query the extension does not rewrite (the D46-S09g follow-up: the
 * owner's listing shows trashed invoices and quotes). The HTTP half is
 * d46-commerce-writes D95-*.
 *
 * W7-DRIVE-INTAKE-SCOPE (R0-CMF2 review SEC-CMF2-3; D-46): approving a drive
 * intake plan (POST drive/businesses/:businessId/intake/:id/approve) needs
 * revenue:write, as every payment-writing route has since R0-02, so
 * DriveIntakeController.approve joins the census as GUARDED: an approved plan
 * creates invoices, records payments and applies credit notes, so D-46 refuses
 * a non-member SUPER_ADMIN there too. The HTTP half is
 * test/payments-actor.integration.test.ts PA-18e..f. Its review repair
 * SEC-W7DI-2 adds DriveIntakeController.reject (revenue:write, GUARDED): a
 * rejected plan can no longer be approved (HTTP half PA-18h).
 */
import 'reflect-metadata';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { CONTROLLER_WATERMARK, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Prisma } from '@prisma/client';
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

const ACCOUNTING_PUSH =
  'accounting push (SWEEP-P0-SCOPES round 2, WHP-1): copies invoices and customers to the QuickBooks or Xero account a member who reads them bound, ' +
  'and stamps the external id it answers; no invoice, quote or payment write (no amount, line or status changes), so not the D-46 invoice-write door';

const LEVERAGE_ATTRIBUTION = 'revenue attribution override (which source, campaign or staff member earned a booking or invoice): reporting metadata, not an invoice, quote or payment write';
const LEVERAGE_TIME = 'time-cost entries (minutes and cost rate logged against a reference): margin reporting, not an invoice, quote or payment write';
const RECURRING_GUARDED =
  'GUARDED (W3-D46-CREATE-AND-RECURRING, D-46; was OPEN, review SEC-A1-2): an invoice schedule the scheduler turns into real invoices. ' +
  'RecurringInvoiceController.assertSuperAdminMayWriteRevenue runs first: a SUPER_ADMIN needs a Membership in :businessId holding revenue:write';
/**
 * W7-DRIVE-INTAKE-SCOPE (R0-CMF2 review SEC-CMF2-3; the R0-02 rule; D-46):
 * DriveIntakeController.approve became a revenue:write handler of the commerce
 * module, so D-46 applies to it as to every other one: an approved plan
 * creates and finalizes invoices, records payments and applies credit notes.
 */
const DRIVE_INTAKE_GUARDED =
  'GUARDED (W7-DRIVE-INTAKE-SCOPE, D-46): approving a drive intake plan runs its create_invoice, record_payment and apply_credit_note steps. ' +
  'DriveIntakeController.assertSuperAdminMayWriteRevenue runs first: a SUPER_ADMIN needs a Membership in :businessId holding revenue:write';
/**
 * W7-DRIVE-INTAKE-SCOPE review repair SEC-W7DI-2 (D-46): rejecting a drive
 * intake plan decides its money as approving it does, so reject needs
 * revenue:write and joins approve as GUARDED.
 */
const DRIVE_INTAKE_REJECT_GUARDED =
  'GUARDED (W7-DRIVE-INTAKE-SCOPE review repair SEC-W7DI-2, D-46): rejecting a drive intake plan stops its create_invoice, record_payment and apply_credit_note steps from ever running. ' +
  'DriveIntakeController.assertSuperAdminMayWriteRevenue runs first: a SUPER_ADMIN needs a Membership in :businessId holding revenue:write';

/**
 * Review repair SEC-A1-2: the census covers every revenue:write handler of
 * every controller in the commerce module, not only CommerceController, so a
 * gap shows here by name. OPEN entries are known gaps waiting on a ruling and
 * a follow-up packet, never a claim of coverage (none remains: D46-S06b).
 * GUARDED entries call their controller's D-46 helper first (D46-S07).
 */
const OTHER_CONTROLLERS: Record<string, Record<string, { kind: OtherKind; why: string }>> = {
  // SWEEP-P0-SCOPES round 2 class repair (CLASS A, WHP-1): the accounting push became a revenue:write handler.
  AccountingController: {
    pushInvoice: { kind: 'EXEMPT', why: ACCOUNTING_PUSH },
    pushCustomers: { kind: 'EXEMPT', why: ACCOUNTING_PUSH },
  },
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
  DriveIntakeController: {
    approve: { kind: 'GUARDED', why: DRIVE_INTAKE_GUARDED },
    // W7-DRIVE-INTAKE-SCOPE review repair SEC-W7DI-2 (D-46): reject became a
    // revenue:write handler too (a rejected plan can no longer be approved).
    reject: { kind: 'GUARDED', why: DRIVE_INTAKE_REJECT_GUARDED },
  },
};

/** The constructor dependencies of each other controller with GUARDED writes, by name, in order. */
const OTHER_CONSTRUCTOR_DEPS: Record<string, string[]> = {
  RecurringInvoiceController: ['service', 'prisma'],
  DriveIntakeController: ['connectorIntelligence', 'orchestrator', 'prisma'],
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
    // W7-DRIVE-INTAKE-SCOPE (D-46): DriveIntakeController.approve joins them;
    // its review repair SEC-W7DI-2: and DriveIntakeController.reject.
    expect(ofKind('GUARDED').sort()).toEqual(
      [
        'DriveIntakeController.approve',
        'DriveIntakeController.reject',
        ...['cancel', 'create', 'pause', 'resume', 'update'].map((h) => `RecurringInvoiceController.${h}`),
      ],
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
        // W7-DRIVE-INTAKE-SCOPE: DriveIntakeController binds the tenant in its
        // controller path (drive/businesses/:businessId), so its handler paths
        // are read below that prefix; every other controller's handler path
        // names :businessId itself.
        const controllerPath = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
        const handlerPath = String(Reflect.getMetadata(PATH_METADATA, cls.prototype[handler]));
        const tenantPath = controllerPath.endsWith('businesses/:businessId') ? `businesses/:businessId/${handlerPath}` : handlerPath;
        expect(tenantPath, handler).toMatch(/^businesses\/:businessId\//);
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

  /**
   * W6-TRASH-MODULE-SCOPE (owner ruling D-95): the module each trash model belongs to, restated from
   * trash.controller.ts TRASH_MODULE. D-95 names CRM for contacts, accounts and opportunities; revenue for
   * invoices, quotes and recurring invoices; people for staff (the canonical module key is 'team':
   * core/authority/module-vocabulary.ts has no 'people'); marketing for community posts and landing pages
   * (the canonical key is 'content', as D-63 maps marketing rows in timeline-visibility.ts). Every other
   * model takes the module its own routes declare (deal: crm; product: revenue, its writes need
   * revenue:write; expense: expenses; automationFlow: automations), else its product area (booking and
   * service: bookings; project and projectTask: projects; socialPost, emailCampaign, leadForm and
   * communityComment: content, the marketing area; site: settings, as D-63 maps site rows).
   */
  const D95_MODULE: Record<string, string> = {
    contact: 'crm', account: 'crm', opportunity: 'crm', deal: 'crm',
    invoice: 'revenue', quote: 'revenue', recurringInvoice: 'revenue', product: 'revenue',
    staffMember: 'team',
    communityPost: 'content', landingPage: 'content', communityComment: 'content',
    socialPost: 'content', emailCampaign: 'content', leadForm: 'content',
    booking: 'bookings', service: 'bookings',
    project: 'projects', projectTask: 'projects',
    expense: 'expenses',
    automationFlow: 'automations',
    site: 'settings',
  };

  /** W6-TRASH-MODULE-SCOPE: the trash's raw read (the client's soft-delete extension does not rewrite it). */
  const RAW = 'prisma.client.$queryRawUnsafe';
  /**
   * W6-TRASH-MODULE-SCOPE review repair SEC-W6T-1 (D-95 with V1-08): a contact read or write resolves the
   * caller's CRM access (resolveCrmAccess: this user read, then the Membership read again), for the
   * visibility clause GET contacts/:id applies. Neither is a read of a trash model.
   */
  const USER_LOOKUP = 'prisma.client.user.findUnique';
  const lcfirst = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);
  const TABLE_MODEL = new Map<string, string>(Prisma.dmmf.datamodel.models.map((m) => [m.dbName ?? m.name, lcfirst(m.name)]));

  /**
   * The trash models the client's soft-delete extension covers, read from its source
   * (packages/db/src/client.ts softDelete([...])): their findMany, count and findFirst
   * rewrite any deletedAt filter to deletedAt null, so the trash reads them raw.
   */
  const CLIENT_SOFT_DELETED: Set<string> = (() => {
    const source = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'src', 'client.ts'), 'utf8');
    const list = /softDelete\(\[([\s\S]*?)\]\)/.exec(source)?.[1] ?? '';
    return new Set([...list.matchAll(/"(\w+)"/g)].map((m) => lcfirst(m[1]!)).filter((model) => model in D95_MODULE));
  })();

  /** The trash model a recorded read names: prisma.client.<model>.<op>, or the table a raw query reads. */
  function modelOf(call: { path: string; args: unknown[] }): string | undefined {
    if (call.path !== RAW) return call.path.split('.')[2];
    const table = /FROM "([^"]+)"/.exec(String(call.args[0]))?.[1];
    return table ? TABLE_MODEL.get(table) : undefined;
  }

  /**
   * Calls TrashController[handler] for `model` as `user`, with the Membership lookup answering `membership`
   * (W6-TRASH-MODULE-SCOPE: and any other path `extra` answers).
   */
  async function trashCall(
    handler: 'restore' | 'permanentDelete',
    model: string,
    user: { id: string; role: string },
    membership: unknown,
    extra: Record<string, (...args: unknown[]) => unknown> = {},
  ) {
    const calls: Array<{ path: string; args: unknown[] }> = [];
    const answers = { [MEMBERSHIP_LOOKUP]: async () => membership, [USER_LOOKUP]: async () => ({ id: user.id, role: user.role }), ...extra };
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

    // W6-TRASH-MODULE-SCOPE review repair SEC-W6T-4 (owner ruling D-95: "D-46 still refuses a non-member
    // SUPER_ADMIN", a ruling about every trash model): this control pinned that a model outside revenue
    // cost a SUPER_ADMIN no Membership lookup, so a non-member SUPER_ADMIN restored (or erased) any
    // non-revenue record in any tenant. It is now refused after the lookup alone, as every non-member is.
    it(`D46-S09 TrashController.${handler} control (D-95, SEC-W6T-4): a model outside revenue (contact) by a non-member SUPER_ADMIN is refused 403 'Not a member of this business' after the Membership lookup alone; a SUPER_ADMIN ADMIN member goes on to the trashed contact's raw lookup`, async () => {
      const { calls, error } = await trashCall(handler, 'contact', { id: USER_ID, role: 'SUPER_ADMIN' }, null);
      // RED-BEFORE: no lookup and the trashed contact looked up (then restored).
      expect(error, String(error)).toBeInstanceOf(ForbiddenException);
      expect((error as Error).message).toBe('Not a member of this business');
      expect(calls.map((c) => c.path)).toEqual([MEMBERSHIP_LOOKUP]);
      const member = await trashCall(handler, 'contact', { id: USER_ID, role: 'SUPER_ADMIN' }, { role: 'ADMIN', permissionScopes: null });
      expect(member.error, String(member.error)).not.toBeInstanceOf(ForbiddenException);
      // W6-TRASH-MODULE-SCOPE (D46-S09g follow-up): the client soft-deletes Contact, so the
      // trashed row is looked up with a raw query (it was prisma.client.contact.findFirst).
      const lookups = member.calls.filter((c) => c.path === RAW);
      expect(lookups).toHaveLength(1);
      expect(modelOf(lookups[0]!)).toBe('contact');
    });
  }

  it('D46-S09 TrashController control: a model the trash does not hold (payment) is still a 400 before any lookup', async () => {
    const { calls, error } = await trashCall('restore', 'payment', { id: USER_ID, role: 'SUPER_ADMIN' }, null);
    expect(String(error)).toMatch(/not trashable/);
    expect(calls).toEqual([]);
  });

  /**
   * W4-TRASH-D46 review repair SEC-TRASH-D46-1 (revenue:read; D-46 rules writes
   * only): listTrashed ran behind BusinessGuard alone, so a member below
   * revenue:read read the trash's invoice, quote and schedule rows. It now
   * applies ModuleScopeGuard's revenue:read rule to those models (a SUPER_ADMIN
   * is admitted to reads without a lookup, as the guard admits it). The HTTP
   * half is d46-commerce-writes D46-S09f.
   */
  /**
   * W6-TRASH-MODULE-SCOPE: with `softDelete`, a Prisma findMany of a model the client soft-deletes answers
   * what the extension makes it answer (the live rows only: it rewrites the trash filter to deletedAt null).
   */
  async function listCall(
    user: { id: string; role: string },
    membership: unknown,
    model?: string,
    rows: Record<string, unknown[]> = {},
    softDelete = false,
  ) {
    const calls: Array<{ path: string; args: unknown[] }> = [];
    const answers = new Proxy({} as Record<string, (...args: unknown[]) => unknown>, {
      get: (_target, path) => {
        if (path === MEMBERSHIP_LOOKUP) return async () => membership;
        // W6-TRASH-MODULE-SCOPE review repair SEC-W6T-1: the CRM access a contact read resolves.
        if (path === USER_LOOKUP) return async () => ({ id: user.id, role: user.role });
        // W5-TRASH-LIST-500: a model's findMany answers `rows[model]` (default none).
        if (typeof path === 'string' && path.endsWith('.findMany')) {
          const name = path.split('.')[2]!;
          const answered = rows[name] ?? [];
          return async () =>
            softDelete && CLIENT_SOFT_DELETED.has(name) ? answered.filter((r) => (r as { deletedAt?: unknown }).deletedAt == null) : answered;
        }
        if (typeof path === 'string' && path.endsWith('.count')) return async () => 0;
        // W6-TRASH-MODULE-SCOPE: a raw read of a model's table answers the same rows; a raw count, 0.
        if (path === RAW) {
          return async (sql: unknown) => {
            const model = modelOf({ path: RAW, args: [sql] })!;
            return /count\(/.test(String(sql)) ? [{ n: 0 }] : rows[model] ?? [];
          };
        }
        return undefined;
      },
    });
    const controller = new Trash(...TRASH_DEPS.map((name) => recorder(name, calls, answers)));
    const req = { user, headers: {}, params: { businessId: BIZ }, query: model ? { model } : {}, body: {} };
    const meta: Record<string, { index: number; data?: unknown }> = Reflect.getMetadata(ROUTE_ARGS_METADATA, Trash, 'listTrashed') ?? {};
    const args: unknown[] = [];
    for (const [key, { index, data }] of Object.entries(meta)) {
      const type = Number(key.split(':')[0]);
      if (type === RouteParamtypes.REQUEST) args[index] = req;
      else if (type === RouteParamtypes.PARAM) args[index] = BIZ;
      else if (type === RouteParamtypes.QUERY) args[index] = data === 'model' ? model : data === 'limit' ? 50 : 0;
      else args[index] = undefined;
    }
    let result: any = null;
    let error: unknown = null;
    try {
      result = await controller.listTrashed(...args);
    } catch (err) {
      error = err;
    }
    return { calls, error, result };
  }

  /** The trash models a call list read (the Membership and user lookups are access reads, not trash reads). */
  const queried = (calls: Array<{ path: string; args: unknown[] }>) =>
    calls.filter((c) => c.path !== MEMBERSHIP_LOOKUP && c.path !== USER_LOOKUP).map(modelOf);

  for (const model of Object.keys(TRASH_REVENUE)) {
    it(`D46-S09f TrashController.listTrashed ?model=${model} (SEC-TRASH-D46-1, revenue:read): a member below revenue:read (USER ADMIN with an explicit revenue:'none', SUPER_ADMIN is not one) is refused with the guard's 'requires read access' message after the lookup alone; a USER with no membership gets 'Not a member of this business'`, async () => {
      for (const membership of [
        { role: 'ADMIN', permissionScopes: { revenue: 'none', settings: 'admin', crm: 'write' } },
        { role: 'STAFF', permissionScopes: { crm: 'write' } },
      ]) {
        const { calls, error } = await listCall({ id: USER_ID, role: 'USER' }, membership, model);
        expect(error, String(error)).toBeInstanceOf(ForbiddenException);
        expect((error as Error).message).toBe('Insufficient permissions: revenue requires read access (you have none)');
        expect(calls.map((c) => c.path)).toEqual([MEMBERSHIP_LOOKUP]);
        expect(calls[0]!.args[0]).toMatchObject({ where: { userId_businessId: { userId: USER_ID, businessId: BIZ } } });
      }
      const none = await listCall({ id: USER_ID, role: 'USER' }, null, model);
      expect((none.error as Error)?.message).toBe('Not a member of this business');
      expect(none.calls.map((c) => c.path)).toEqual([MEMBERSHIP_LOOKUP]);
    });

    it(`D46-S09f TrashController.listTrashed ?model=${model} control (SEC-TRASH-D46-1): a revenue:read member (USER STAFF default, USER explicit read) is admitted after the lookup; a SUPER_ADMIN, member or not, is admitted with no lookup (reads are not D-46 writes)`, async () => {
      for (const membership of [{ role: 'STAFF', permissionScopes: null }, { role: 'ADMIN', permissionScopes: { revenue: 'read' } }]) {
        const { calls, error, result } = await listCall({ id: USER_ID, role: 'USER' }, membership, model);
        expect(error, String(error)).toBeNull();
        expect(calls[0]?.path).toBe(MEMBERSHIP_LOOKUP);
        expect(queried(calls)).toEqual([model, model]);
        expect(result).toEqual({ items: [], total: 0, model });
      }
      for (const membership of [null, { role: 'ADMIN', permissionScopes: { revenue: 'none' } }]) {
        const { calls, error } = await listCall({ id: USER_ID, role: 'SUPER_ADMIN' }, membership, model);
        expect(error, String(error)).toBeNull();
        expect(calls.map((c) => c.path)).not.toContain(MEMBERSHIP_LOOKUP);
        expect(queried(calls)).toEqual([model, model]);
      }
    });
  }

  // W6-TRASH-MODULE-SCOPE (owner ruling D-95): this control pinned that a model outside revenue cost no
  // Membership lookup for any caller. D-95 holds every model to its own module's read access, so a
  // contact now needs crm:read: a USER with no Membership is refused after the lookup alone, and only a
  // SUPER_ADMIN (ModuleScopeGuard's read admission) still reads it with no lookup.
  it("D46-S09f TrashController.listTrashed control (SEC-TRASH-D46-1; W6-TRASH-MODULE-SCOPE, D-95): a model outside revenue (contact) needs crm:read: a USER with no membership gets 'Not a member of this business' after the lookup alone; a SUPER_ADMIN reads it with no lookup", async () => {
    const none = await listCall({ id: USER_ID, role: 'USER' }, null, 'contact');
    expect(none.error, String(none.error)).toBeInstanceOf(ForbiddenException);
    expect((none.error as Error).message).toBe('Not a member of this business');
    expect(none.calls.map((c) => c.path)).toEqual([MEMBERSHIP_LOOKUP]);
    const sa = await listCall({ id: USER_ID, role: 'SUPER_ADMIN' }, null, 'contact');
    expect(sa.error, String(sa.error)).toBeNull();
    expect(sa.calls.map((c) => c.path)).not.toContain(MEMBERSHIP_LOOKUP);
    expect(queried(sa.calls)).toEqual(['contact', 'contact']);
  });

  // W6-TRASH-MODULE-SCOPE (owner ruling D-95): every model is now held to its own module's read access,
  // so the member below revenue:read holds every other module at admin (an explicit map names each one;
  // it named only settings, which under D-95 reads the site alone), the STAFF reader's role defaults
  // (team and settings 'none') read no staffMember or site, and product is a revenue model (its writes
  // need revenue:write). The revenue claims are unchanged.
  // W6-TRASH-MODULE-SCOPE review repair SEC-W6T-1 (D-95 with V1-08): the contact read now applies the
  // caller's CRM visibility, so after the one module lookup the listing resolves the CRM access
  // (resolveCrmAccess: one user read, one Membership read) right before it reads contacts.
  it("D46-S09g TrashController.listTrashed every model (SEC-TRASH-D46-1, revenue:read; W6-TRASH-MODULE-SCOPE, D-95, SEC-W6T-1): a member below revenue:read gets 200 and no invoice, quote, recurringInvoice or product query runs (one module lookup, then the CRM access its contact read needs); a revenue:read member gets every revenue model queried and a SUPER_ADMIN (no lookup) every model", async () => {
    const allButRevenue = Object.fromEntries([...new Set(Object.values(D95_MODULE))].map((m) => [m, m === 'revenue' ? 'none' : 'admin']));
    const below = await listCall({ id: USER_ID, role: 'USER' }, { role: 'ADMIN', permissionScopes: allButRevenue });
    expect(below.error, String(below.error)).toBeNull();
    expect(below.result).toEqual({ items: [], total: 0 });
    const paths = below.calls.map((c) => c.path);
    const contactRead = below.calls.findIndex((c) => modelOf(c) === 'contact');
    expect(paths.slice(0, contactRead)).toEqual([MEMBERSHIP_LOOKUP, USER_LOOKUP, MEMBERSHIP_LOOKUP]);
    expect(paths.slice(contactRead)).not.toContain(MEMBERSHIP_LOOKUP);
    expect(paths.slice(contactRead)).not.toContain(USER_LOOKUP);
    const belowModels = queried(below.calls);
    for (const model of Object.keys(TRASH_REVENUE)) expect(belowModels, model).not.toContain(model);
    expect(belowModels).not.toContain('product');
    expect(belowModels).toContain('contact');
    expect(belowModels).toContain('expense');
    const revenueModels = Object.keys(D95_MODULE).filter((m) => D95_MODULE[m] === 'revenue');

    const reader = await listCall({ id: USER_ID, role: 'USER' }, { role: 'STAFF', permissionScopes: null });
    expect(reader.error, String(reader.error)).toBeNull();
    const readerModels = queried(reader.calls);
    for (const model of revenueModels) expect(readerModels, model).toContain(model);
    for (const model of ['staffMember', 'site']) expect(readerModels, model).not.toContain(model);
    const sa = await listCall({ id: USER_ID, role: 'SUPER_ADMIN' }, null);
    expect(sa.error, String(sa.error)).toBeNull();
    expect(sa.calls.map((c) => c.path)).not.toContain(MEMBERSHIP_LOOKUP);
    const models = queried(sa.calls);
    for (const model of Object.keys(TRASH_REVENUE)) expect(models, model).toContain(model);
    expect(models).toHaveLength(belowModels.length + revenueModels.length);
  });

  /**
   * W5-TRASH-LIST-500 (D46-S09g): the every-model listing answered 500 for
   * every caller: queryModel('opportunity') filtered on businessId, which
   * Opportunity does not have (it names its business posterBusinessId), so
   * Prisma refused the query before it ran. Each model is now filtered on its
   * own tenant column. The HTTP half is d46-commerce-writes D46-S09g.
   */
  const FIELDS = new Map<string, Set<string>>(
    Prisma.dmmf.datamodel.models.map((m) => [m.name.charAt(0).toLowerCase() + m.name.slice(1), new Set(m.fields.map((f) => f.name))]),
  );

  /**
   * `where` is `model`'s trash filter in BIZ: only columns the Prisma datamodel
   * gives the model (RED-BEFORE D46-S09g: opportunity.businessId), :businessId
   * on the model's own tenant column (Opportunity: posterBusinessId), and
   * deletedAt set. W5-TRASH-LIST-500 review repair (SEC-TL500-2): the same
   * deletedAt condition again under NOT, which the client's soft-delete
   * extension leaves in place (it overwrites the top-level deletedAt with
   * null), so a model it covers matches no row instead of its live rows.
   */
  function expectTrashedWhere(model: string, where: Record<string, unknown>, label: string) {
    expect(FIELDS.has(model), label).toBe(true);
    const columns = [...Object.keys(where).filter((key) => key !== 'NOT'), ...Object.keys((where.NOT ?? {}) as object)];
    for (const column of columns) expect(FIELDS.get(model)!.has(column), `${label}: ${model}.${column}`).toBe(true);
    expect(where.deletedAt, label).toEqual({ not: null });
    expect(where.NOT, label).toEqual({ deletedAt: null });
    expect(where[model === 'opportunity' ? 'posterBusinessId' : 'businessId'], label).toBe(BIZ);
  }

  /**
   * W6-TRASH-MODULE-SCOPE (D46-S09g follow-up): a raw trash read of `model` (one the client's soft-delete
   * extension covers, so a Prisma read could never see its trashed rows): its own table, :businessId ($1)
   * on the model's tenant column, deleted_at IS NOT NULL, and every column it selects is a column of the
   * model, aliased to the Prisma field name (the listing answers the shape a Prisma read answers).
   */
  function expectTrashedSql(model: string, args: unknown[], label: string) {
    expect(CLIENT_SOFT_DELETED.has(model), `${label}: only a model the client soft-deletes is read raw`).toBe(true);
    const [sql, ...values] = args as [string, ...unknown[]];
    const meta = Prisma.dmmf.datamodel.models.find((m) => lcfirst(m.name) === model)!;
    const column = (field: string) => meta.fields.find((f) => f.name === field)?.dbName ?? field;
    expect(sql, label).toContain(`FROM "${meta.dbName ?? meta.name}"`);
    expect(sql, label).toContain(`"${column('businessId')}" = $1`);
    expect(sql, label).toContain(`"${column('deletedAt')}" IS NOT NULL`);
    expect(values[0], label).toBe(BIZ);
    const pairs = [...sql.matchAll(/"([^"]+)" AS "([^"]+)"/g)];
    for (const [, col, field] of pairs) expect(column(field!), `${label}: ${col} AS ${field}`).toBe(col);
    if (!/count\(/.test(sql)) {
      const scalars = meta.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum').map((f) => f.name);
      expect(pairs.map(([, , field]) => field).sort(), `${label}: every column, by its Prisma name`).toEqual(scalars.sort());
    }
  }

  /** A trash read (Prisma or raw) of the model it names, scoped as expectTrashedWhere / expectTrashedSql say. */
  function expectTrashedRead(call: { path: string; args: unknown[] }, label: string) {
    const model = modelOf(call)!;
    if (call.path === RAW) expectTrashedSql(model, call.args, label);
    else expectTrashedWhere(model, (call.args[0] as { where: Record<string, unknown> }).where, label);
  }

  it("D46-S09g W5-TRASH-LIST-500 TrashController.listTrashed every model: each model's query filters only columns the Prisma datamodel gives it (Opportunity by posterBusinessId, it has no businessId), scoped to :businessId and to trashed rows; ?model=opportunity is scoped the same way", async () => {
    const owner = await listCall({ id: USER_ID, role: 'USER' }, { role: 'OWNER', permissionScopes: null });
    expect(owner.error, String(owner.error)).toBeNull();
    const reads = owner.calls.filter((c) => c.path !== MEMBERSHIP_LOOKUP && c.path !== USER_LOOKUP);
    expect(reads.map(modelOf)).toContain('opportunity');
    for (const call of reads) {
      // RED-BEFORE: opportunity.businessId (Prisma: Unknown argument `businessId`).
      // W6-TRASH-MODULE-SCOPE: a model the client soft-deletes is read raw, scoped the same way.
      expectTrashedRead(call, String(modelOf(call)));
    }

    // W6-TRASH-MODULE-SCOPE (owner ruling D-95): an opportunity is a CRM record, so ?model=opportunity
    // needs crm:read; the caller is the owner (it was a USER with no Membership, now refused).
    const one = await listCall({ id: USER_ID, role: 'USER' }, { role: 'OWNER', permissionScopes: null }, 'opportunity');
    expect(one.error, String(one.error)).toBeNull();
    expect(one.calls.map((c) => c.path)).toEqual([MEMBERSHIP_LOOKUP, 'prisma.client.opportunity.findMany', 'prisma.client.opportunity.count']);
    for (const { args } of one.calls.slice(1)) {
      // W5-TRASH-LIST-500 review repair (SEC-TL500-2): with the NOT clause.
      expect((args[0] as { where: unknown }).where).toEqual({ posterBusinessId: BIZ, deletedAt: { not: null }, NOT: { deletedAt: null } });
    }
  });

  it('D46-S09g W5-TRASH-LIST-500 TrashController.listTrashed every model: a row a model answers with deletedAt null (the soft-delete extension rewrites the trash filter to deletedAt null for Contact, Invoice, Quote and eight more) is a live record and is not listed; trashed rows are, newest first, and total counts them', async () => {
    const live = { id: 'contact_live', businessId: BIZ, deletedAt: null };
    const trashedContact = { id: 'contact_trashed', businessId: BIZ, deletedAt: new Date('2026-11-01T00:00:00Z') };
    const trashedOpp = { id: 'opp_trashed', posterBusinessId: BIZ, deletedAt: new Date('2026-11-02T00:00:00Z') };
    const liveInvoice = { id: 'invoice_live', businessId: BIZ, deletedAt: null };
    const { error, result } = await listCall({ id: USER_ID, role: 'SUPER_ADMIN' }, null, undefined, {
      contact: [live, trashedContact],
      opportunity: [trashedOpp],
      invoice: [liveInvoice],
    });
    expect(error, String(error)).toBeNull();
    // RED-BEFORE: contact_live and invoice_live listed as trash (total 4).
    expect(result.items.map((i: any) => `${i._model}:${i.id}`)).toEqual(['opportunity:opp_trashed', 'contact:contact_trashed']);
    expect(result.total).toBe(2);
  });

  /** Every model the every-model listing reads, in its order (a SUPER_ADMIN reads them all). */
  async function trashModels(): Promise<string[]> {
    const { calls } = await listCall({ id: USER_ID, role: 'SUPER_ADMIN' }, null);
    return queried(calls) as string[];
  }

  /**
   * W5-TRASH-LIST-500 review repair SEC-TL500-1 / CR-TL500-1 (D46-S09h): D46-S09g
   * lists trashed opportunities, but restore and permanent delete still looked
   * the row up with { id, businessId, deletedAt }, which Opportunity does not
   * have, so every Restore or Delete of a listed opportunity answered 500 (and
   * the web page, which ignores the error, showed it done). The lookup now uses
   * the listing's filter; it is the only tenant check before the write, which
   * keys on the id alone. The HTTP half is d46-commerce-writes D46-S09h.
   */
  it('D46-S09h W5-TRASH-LIST-500 repair (SEC-TL500-1, CR-TL500-1) TrashController.restore and permanentDelete: every trashable model is looked up by :id with only columns the Prisma datamodel gives it, scoped to :businessId on its own tenant column (Opportunity by posterBusinessId) and to trashed rows', async () => {
    const models = await trashModels();
    expect(models).toContain('opportunity');
    expect(models).toHaveLength(22);
    for (const handler of ['restore', 'permanentDelete'] as const) {
      for (const model of models) {
        const { calls } = await trashCall(handler, model, { id: USER_ID, role: 'USER' }, { role: 'OWNER', permissionScopes: null });
        // W6-TRASH-MODULE-SCOPE (D46-S09g follow-up): a model the client soft-deletes is looked up raw.
        const lookups = calls.filter((c) => c.path === `prisma.client.${model}.findFirst` || (c.path === RAW && modelOf(c) === model));
        expect(lookups, `${handler} ${model}`).toHaveLength(1);
        expect(lookups[0]!.path, `${handler} ${model}`).toBe(CLIENT_SOFT_DELETED.has(model) ? RAW : `prisma.client.${model}.findFirst`);
        // RED-BEFORE: opportunity.businessId (Prisma: Unknown argument `businessId`, a 500).
        expectTrashedRead(lookups[0]!, `${handler} ${model}`);
        if (lookups[0]!.path === RAW) {
          expect(String(lookups[0]!.args[0]), `${handler} ${model}`).toContain('"id" = $2');
          expect(lookups[0]!.args[2], `${handler} ${model}`).toBe(`${model}_d46`);
        } else {
          expect((lookups[0]!.args[0] as { where: Record<string, unknown> }).where.id, `${handler} ${model}`).toBe(`${model}_d46`);
        }
      }
    }
  });

  /**
   * W5-TRASH-LIST-500 review repair SEC-TL500-2 (D46-S09i): ?model= listed the
   * LIVE rows of every model the client's soft-delete extension covers (it
   * overwrites the trash filter with deletedAt null), so ?model=contact showed
   * every live contact, PRIVATE ones included, to a member with crm 'none'.
   * Every model's ?model= read now carries the trash filter the extension
   * cannot overwrite, on findMany and count alike, and a live row is never
   * listed. The HTTP half is d46-commerce-writes D46-S09i.
   */
  it('D46-S09i W5-TRASH-LIST-500 repair (SEC-TL500-2) TrashController.listTrashed ?model=<every trashable model>: findMany and count carry the trash filter the soft-delete extension cannot overwrite, and a row answered with deletedAt null (a live record) is not listed', async () => {
    const models = await trashModels();
    expect(models).toHaveLength(22);
    for (const model of models) {
      const live = { id: `${model}_live`, businessId: BIZ, deletedAt: null };
      const trashed = { id: `${model}_trashed`, businessId: BIZ, deletedAt: new Date('2026-11-01T00:00:00Z') };
      const { calls, error, result } = await listCall({ id: USER_ID, role: 'SUPER_ADMIN' }, null, model, { [model]: [live, trashed] });
      expect(error, `${model}: ${String(error)}`).toBeNull();
      // W6-TRASH-MODULE-SCOPE (D46-S09g follow-up): a model the client soft-deletes is read raw (its trashed rows show).
      expect(calls.map((c) => c.path), model).toEqual(
        CLIENT_SOFT_DELETED.has(model) ? [RAW, RAW] : [`prisma.client.${model}.findMany`, `prisma.client.${model}.count`],
      );
      // RED-BEFORE: { businessId, deletedAt: { not: null } } alone, which the extension rewrites to deletedAt null.
      for (const call of calls) expectTrashedRead(call, `${model} ${call.path}`);
      // RED-BEFORE: `${model}_live` listed as trash.
      expect(result.items.map((i: any) => i.id), model).toEqual([`${model}_trashed`]);
      expect(result.model, model).toBe(model);
    }
  });

  /**
   * W6-TRASH-MODULE-SCOPE (owner ruling D-95; review SEC-TL500-3, its it.todo in d46-commerce-writes made
   * live): restoring or permanently deleting a trashed record needs write access to the module the record
   * belongs to, and seeing it in the trash needs that module's read access (D95_MODULE above). The
   * controller applies ModuleScopeGuard's rule itself (it runs BusinessGuard alone), as SEC-TRASH-D46-1
   * did for revenue; a SUPER_ADMIN keeps the guard's admission outside revenue, and D-46 still refuses a
   * non-member one on the revenue models (D46-S09). The HTTP half is d46-commerce-writes D95-*.
   */
  const ALL_MODULES = [...new Set(Object.values(D95_MODULE))];
  /** An explicit scope map: every module of the table at admin, `overrides` on top. */
  const scopesWith = (overrides: Record<string, string>) => ({
    ...Object.fromEntries(ALL_MODULES.map((m) => [m, 'admin'])),
    ...overrides,
  });

  it("D95-U01 W6-TRASH-MODULE-SCOPE (D-95, SEC-TL500-3): a crm-none member (USER ADMIN, explicit crm:'none', every other module admin) cannot see a trashed contact (?model=contact: 403 'Insufficient permissions: crm requires read access (you have none)'; the every-model listing reads no contact, account, opportunity or deal) nor restore or permanently delete one (403 'crm requires write access (you have none)'), after the Membership lookup alone", async () => {
    const crmNone = { role: 'ADMIN', permissionScopes: scopesWith({ crm: 'none' }) };
    const listed = await listCall({ id: USER_ID, role: 'USER' }, crmNone, 'contact');
    // RED-BEFORE: 200 and contact read (no lookup).
    expect(listed.error, String(listed.error)).toBeInstanceOf(ForbiddenException);
    expect((listed.error as Error).message).toBe('Insufficient permissions: crm requires read access (you have none)');
    expect(listed.calls.map((c) => c.path)).toEqual([MEMBERSHIP_LOOKUP]);

    const every = await listCall({ id: USER_ID, role: 'USER' }, crmNone);
    expect(every.error, String(every.error)).toBeNull();
    expect(every.calls.filter((c) => c.path === MEMBERSHIP_LOOKUP)).toHaveLength(1);
    const models = queried(every.calls);
    for (const model of ['contact', 'account', 'opportunity', 'deal']) expect(models, model).not.toContain(model);
    expect(models).toContain('invoice');

    for (const handler of ['restore', 'permanentDelete'] as const) {
      const { calls, error } = await trashCall(handler, 'contact', { id: USER_ID, role: 'USER' }, crmNone);
      // RED-BEFORE: no lookup; the trashed contact looked up (and, found, restored or deleted).
      expect(error, `${handler}: ${String(error)}`).toBeInstanceOf(ForbiddenException);
      expect((error as Error).message, handler).toBe('Insufficient permissions: crm requires write access (you have none)');
      expect(calls.map((c) => c.path), handler).toEqual([MEMBERSHIP_LOOKUP]);
    }
  });

  it("D95-U02 W6-TRASH-MODULE-SCOPE (D-95, SEC-TL500-3): a people-none member (explicit team:'none'; D-95's people is the canonical team module) cannot restore or permanently delete staff (403 'Insufficient permissions: team requires write access (you have none)') nor list it; a STAFF member (role defaults: team none) neither; a team:'read' member lists staff but is refused the writes", async () => {
    for (const [membership, level] of [
      [{ role: 'ADMIN', permissionScopes: scopesWith({ team: 'none' }) }, 'none'],
      [{ role: 'STAFF', permissionScopes: null }, 'none'],
      [{ role: 'ADMIN', permissionScopes: scopesWith({ team: 'read' }) }, 'read'],
    ] as const) {
      for (const handler of ['restore', 'permanentDelete'] as const) {
        const { calls, error } = await trashCall(handler, 'staffMember', { id: USER_ID, role: 'USER' }, membership);
        // RED-BEFORE: no lookup; the trashed staff member looked up.
        expect(error, `${level} ${handler}: ${String(error)}`).toBeInstanceOf(ForbiddenException);
        expect((error as Error).message, `${level} ${handler}`).toBe(`Insufficient permissions: team requires write access (you have ${level})`);
        expect(calls.map((c) => c.path), `${level} ${handler}`).toEqual([MEMBERSHIP_LOOKUP]);
      }
      const listed = await listCall({ id: USER_ID, role: 'USER' }, membership, 'staffMember');
      const every = await listCall({ id: USER_ID, role: 'USER' }, membership);
      expect(every.error, String(every.error)).toBeNull();
      if (level === 'none') {
        expect(listed.error, String(listed.error)).toBeInstanceOf(ForbiddenException);
        expect((listed.error as Error).message).toBe('Insufficient permissions: team requires read access (you have none)');
        expect(queried(every.calls)).not.toContain('staffMember');
      } else {
        expect(listed.error, String(listed.error)).toBeNull();
        expect(queried(listed.calls)).toEqual(['staffMember', 'staffMember']);
        expect(queried(every.calls)).toContain('staffMember');
      }
    }
  });

  it('D95-U03 W6-TRASH-MODULE-SCOPE (D-95) module table: every trashable model is held to its own module (D95_MODULE): restore and permanentDelete by a member holding it at read are refused "<module> requires write access (you have read)" after the lookup alone and go on at write; ?model=<model> by a member holding it at none is refused "<module> requires read access (you have none)" after the lookup alone and is read at read', async () => {
    expect((await trashModels()).sort()).toEqual(Object.keys(D95_MODULE).sort());
    for (const [model, module] of Object.entries(D95_MODULE)) {
      for (const handler of ['restore', 'permanentDelete'] as const) {
        const reader = await trashCall(handler, model, { id: USER_ID, role: 'USER' }, { role: 'ADMIN', permissionScopes: scopesWith({ [module]: 'read' }) });
        expect(reader.error, `${model} ${handler}: ${String(reader.error)}`).toBeInstanceOf(ForbiddenException);
        expect((reader.error as Error).message, `${model} ${handler}`).toBe(`Insufficient permissions: ${module} requires write access (you have read)`);
        expect(reader.calls.map((c) => c.path), `${model} ${handler}`).toEqual([MEMBERSHIP_LOOKUP]);

        const writer = await trashCall(handler, model, { id: USER_ID, role: 'USER' }, { role: 'STAFF', permissionScopes: { [module]: 'write' } });
        expect(writer.error, `${model} ${handler}: ${String(writer.error)}`).not.toBeInstanceOf(ForbiddenException);
        expect(writer.calls[0]?.path, `${model} ${handler}`).toBe(MEMBERSHIP_LOOKUP);
        expect(writer.calls.slice(1).map(modelOf), `${model} ${handler}: the lookup ran`).toContain(model);
      }
      const none = await listCall({ id: USER_ID, role: 'USER' }, { role: 'ADMIN', permissionScopes: scopesWith({ [module]: 'none' }) }, model);
      expect(none.error, `${model}: ${String(none.error)}`).toBeInstanceOf(ForbiddenException);
      expect((none.error as Error).message, model).toBe(`Insufficient permissions: ${module} requires read access (you have none)`);
      expect(none.calls.map((c) => c.path), model).toEqual([MEMBERSHIP_LOOKUP]);
      const read = await listCall({ id: USER_ID, role: 'USER' }, { role: 'STAFF', permissionScopes: { [module]: 'read' } }, model);
      expect(read.error, `${model}: ${String(read.error)}`).toBeNull();
      expect(queried(read.calls), model).toEqual([model, model]);
    }
  });

  it("D95-U04 W6-TRASH-MODULE-SCOPE (D46-S09g follow-up) TrashController.listTrashed: the owner's every-model listing and ?model=invoice|quote list trashed invoices and quotes, read with a raw query the client's soft-delete extension does not rewrite (it rewrites a Prisma read of Invoice and Quote to deletedAt null, so those rows never showed); a live row is still not listed", async () => {
    expect(CLIENT_SOFT_DELETED.has('invoice')).toBe(true);
    expect(CLIENT_SOFT_DELETED.has('quote')).toBe(true);
    const deletedAt = new Date('2026-11-03T00:00:00Z');
    const rows = {
      invoice: [{ id: 'invoice_live', businessId: BIZ, deletedAt: null }, { id: 'invoice_trashed', businessId: BIZ, deletedAt }],
      quote: [{ id: 'quote_trashed', businessId: BIZ, deletedAt: new Date('2026-11-02T00:00:00Z') }],
    };
    const owner = await listCall({ id: USER_ID, role: 'USER' }, { role: 'OWNER', permissionScopes: null }, undefined, rows, true);
    expect(owner.error, String(owner.error)).toBeNull();
    // RED-BEFORE: [] (the Prisma read answers the live invoice only, which is not trash).
    expect(owner.result.items.map((i: any) => `${i._model}:${i.id}`)).toEqual(['invoice:invoice_trashed', 'quote:quote_trashed']);
    for (const model of ['invoice', 'quote']) {
      const reads = owner.calls.filter((c) => modelOf(c) === model);
      expect(reads.map((c) => c.path), model).toEqual([RAW]);
      expectTrashedSql(model, reads[0]!.args, model);
      const one = await listCall({ id: USER_ID, role: 'USER' }, { role: 'OWNER', permissionScopes: null }, model, rows, true);
      expect(one.error, String(one.error)).toBeNull();
      expect(one.result.items.map((i: any) => i.id), model).toEqual([`${model}_trashed`]);
    }
  });

  it("D95-U05 W6-TRASH-MODULE-SCOPE: restore of a trashed product or service (now found: it is looked up raw) clears deletedAt through the Catalog module's own restore (restoreProduct / restoreService, which emit the update events; the catalog boundary keeps Product/Service writes there); CatalogService.updateProduct ignores deletedAt, so the restore answered restored while the product stayed in the trash", async () => {
    for (const [model, method] of [['product', 'restoreProduct'], ['service', 'restoreService']] as const) {
      const row = { id: `${model}_d46`, businessId: BIZ, deletedAt: new Date('2026-11-01T00:00:00Z') };
      const { calls, error } = await trashCall('restore', model, { id: USER_ID, role: 'USER' }, { role: 'OWNER', permissionScopes: null }, {
        [RAW]: async () => [row],
        [`catalog.${method}`]: async () => ({ ...row, deletedAt: null }),
      });
      // RED-BEFORE: the lookup is prisma.client.<model>.findFirst (unanswered here; the extension hides the row).
      expect(error, `${model}: ${String(error)}`).toBeNull();
      const paths = calls.map((c) => c.path);
      expect(paths, model).toEqual([MEMBERSHIP_LOOKUP, RAW, `catalog.${method}`]);
      expect(calls[2]!.args, model).toEqual([BIZ, row.id]);
    }
  });

  it("D95-U06 W6-TRASH-MODULE-SCOPE: permanentDelete of a trashed record of a model the client soft-deletes answers 409 and writes nothing: the client turns a delete of that model into a soft delete, so the trash answered 'deleted' while the row stayed in the trash", async () => {
    for (const model of CLIENT_SOFT_DELETED) {
      const row = { id: `${model}_d46`, businessId: BIZ, deletedAt: new Date('2026-11-01T00:00:00Z') };
      const { calls, error } = await trashCall('permanentDelete', model, { id: USER_ID, role: 'USER' }, { role: 'OWNER', permissionScopes: null }, {
        [RAW]: async () => [row],
      });
      // RED-BEFORE: the lookup is prisma.client.<model>.findFirst (the extension hides the trashed row: 404).
      expect((error as { getStatus?: () => number })?.getStatus?.(), `${model}: ${String(error)}`).toBe(409);
      expect((error as Error).message, model).toBe(`Permanent delete is not available for a trashed ${model}: it can only be restored`);
      // Review repair SEC-W6T-1: a contact's lookup first resolves the caller's CRM access (its visibility clause).
      expect(calls.map((c) => c.path), model).toEqual(
        model === 'contact' ? [MEMBERSHIP_LOOKUP, USER_LOOKUP, MEMBERSHIP_LOOKUP, RAW] : [MEMBERSHIP_LOOKUP, RAW],
      );
    }
  });

  /**
   * W6-TRASH-MODULE-SCOPE review repairs (unit half; the HTTP half is d46-commerce-writes D95-R01..R06).
   * The trash reads the trashed rows of the models the client soft-deletes, so it applies what those
   * modules' own routes apply: the contact visibility of R0-01/V1-08/D-74 (SEC-W6T-1, CR-W6T-1), the
   * withheld quote viewToken of SEC-V52-1 (SEC-W6T-2), the forget and merge flows' hold on their
   * contacts (D-25, SEC-W6T-3) and D-95's "D-46 still refuses a non-member SUPER_ADMIN" (SEC-W6T-4).
   */
  const contactReads = (calls: Array<{ path: string; args: unknown[] }>) => calls.filter((c) => c.path === RAW && modelOf(c) === 'contact');

  it("D95-U07 (D-95 with V1-08 visibilityClause; SEC-W6T-1, CR-W6T-1): every raw read of trashed contacts carries the caller's CRM visibility as parameters after its own: TEAM/SHARED, own or shared for a crm:read member; own or shared only for a 'my book' member (crm_view 'owned'); no clause for the owner or a SUPER_ADMIN; and every one leaves out the contacts the forget and merge flows hold", async () => {
    for (const [label, user, membership, expected] of [
      ['crm:read STAFF', { id: USER_ID, role: 'USER' }, { role: 'STAFF', permissionScopes: null }, ['TEAM', 'SHARED', USER_ID, USER_ID]],
      ["crm_view 'owned'", { id: USER_ID, role: 'USER' }, { role: 'STAFF', permissionScopes: { crm: 'write', crm_view: 'owned' } }, [USER_ID, USER_ID]],
      ['OWNER', { id: USER_ID, role: 'USER' }, { role: 'OWNER', permissionScopes: null }, []],
      ['SUPER_ADMIN', { id: USER_ID, role: 'SUPER_ADMIN' }, null, []],
    ] as const) {
      for (const model of ['contact', undefined]) {
        const { calls, error } = await listCall(user, membership, model);
        expect(error, `${label} ${model}: ${String(error)}`).toBeNull();
        const reads = contactReads(calls);
        expect(reads.length, `${label} ${model}`).toBe(model ? 2 : 1);
        for (const read of reads) {
          const [sql, ...values] = read.args as [string, ...unknown[]];
          const fixed = /count\(/.test(sql) ? 1 : 3;
          // RED-BEFORE: [BIZ, 50, 0] alone for every caller (every trashed contact listed).
          expect(values.slice(fixed), `${label} ${model} ${sql.slice(0, 40)}`).toEqual(expected);
          for (const [i] of expected.entries()) expect(sql, label).toContain(`$${fixed + 1 + i}`);
          expect(sql, label).toContain('"merged_into_id" IS NULL');
          expect(sql, label).toContain('"contact_forget_requests"');
          if (expected.length > 0) expect(sql, label).toContain('"contact_shares"');
        }
      }
      for (const handler of ['restore', 'permanentDelete'] as const) {
        if (!membership) continue; // a non-member SUPER_ADMIN is refused before the lookup (D95-U08)
        const { calls } = await trashCall(handler, 'contact', user, membership.role === 'STAFF' ? { ...membership, permissionScopes: { crm: 'write', ...(membership.permissionScopes ?? {}) } } : membership);
        const [lookup] = contactReads(calls);
        expect(lookup, `${label} ${handler}`).toBeDefined();
        expect((lookup!.args as unknown[]).slice(1), `${label} ${handler}`).toEqual([BIZ, 'contact_d46', ...expected]);
      }
    }
  });

  it("D95-U08 (D-95: 'D-46 still refuses a non-member SUPER_ADMIN'; SEC-W6T-4): a non-member SUPER_ADMIN is refused restore and permanent delete of every trash model after the Membership lookup alone: 'Not authorized to update this invoice|quote' on the revenue models (D-46), 'Not a member of this business' on every other", async () => {
    for (const model of Object.keys(D95_MODULE)) {
      for (const handler of ['restore', 'permanentDelete'] as const) {
        const { calls, error } = await trashCall(handler, model, { id: USER_ID, role: 'SUPER_ADMIN' }, null);
        // RED-BEFORE: outside revenue, no lookup and the record looked up (then restored, or erased).
        expect(error, `${model} ${handler}: ${String(error)}`).toBeInstanceOf(ForbiddenException);
        expect((error as Error).message, `${model} ${handler}`).toBe(
          TRASH_REVENUE[model] ? `Not authorized to update this ${TRASH_REVENUE[model]}` : 'Not a member of this business',
        );
        expect(calls.map((c) => c.path), `${model} ${handler}`).toEqual([MEMBERSHIP_LOOKUP]);
      }
    }
  });

  it("D95-U09 (SEC-V52-1; SEC-W6T-2): a trashed quote's viewToken is in no trash answer: GET trash?model=quote, GET trash and the restore's item carry every other field and no viewToken", async () => {
    const quote = { id: 'quote_d46', businessId: BIZ, status: 'SENT', viewToken: 'view_token_not_a_real_link', deletedAt: new Date('2026-11-01T00:00:00Z') };
    for (const model of ['quote', undefined]) {
      const { error, result } = await listCall({ id: USER_ID, role: 'USER' }, { role: 'STAFF', permissionScopes: null }, model, { quote: [quote] });
      expect(error, String(error)).toBeNull();
      const item = result.items.find((i: any) => i.id === 'quote_d46');
      // RED-BEFORE: item.viewToken === 'view_token_not_a_real_link'.
      expect(item, String(model)).toMatchObject({ id: 'quote_d46', status: 'SENT', businessId: BIZ });
      expect('viewToken' in item, String(model)).toBe(false);
    }
    const calls: Array<{ path: string; args: unknown[] }> = [];
    const controller = new Trash(...TRASH_DEPS.map((name) => recorder(name, calls, {
      [MEMBERSHIP_LOOKUP]: async () => ({ role: 'OWNER', permissionScopes: null }),
      [RAW]: async () => [quote],
      'prisma.client.quote.update': async () => ({ ...quote, deletedAt: null }),
    })));
    const answered = await controller.restore(BIZ, 'quote', 'quote_d46', { user: { id: USER_ID, role: 'USER' } });
    expect(calls.map((c) => c.path)).toEqual([MEMBERSHIP_LOOKUP, RAW, 'prisma.client.quote.update']);
    // RED-BEFORE: item.viewToken === 'view_token_not_a_real_link'.
    expect(answered).toMatchObject({ restored: true, model: 'quote', id: 'quote_d46', item: { id: 'quote_d46', status: 'SENT', deletedAt: null } });
    expect('viewToken' in answered.item).toBe(false);
  });

  it("D95-U10 (V1-08 crm_edit; SEC-W6T-1, CR-W6T-1): a crm:write member whose crm_edit is 'none' is refused a contact restore (403 'You do not have permission to edit contacts') before the contact lookup; one whose crm_edit is 'owned' is refused a visible contact owned by another member and not shared with them (403 'You can only edit contacts you own') and restores their own", async () => {
    const none = await trashCall('restore', 'contact', { id: USER_ID, role: 'USER' }, { role: 'STAFF', permissionScopes: { crm: 'write', crm_edit: 'none' } });
    expect(none.error, String(none.error)).toBeInstanceOf(ForbiddenException);
    expect((none.error as Error).message).toBe('You do not have permission to edit contacts');
    expect(contactReads(none.calls)).toEqual([]);

    const owned = { role: 'STAFF', permissionScopes: { crm: 'write', crm_edit: 'owned' } };
    const other = { id: 'contact_d46', businessId: BIZ, ownerId: 'someone_else', visibility: 'TEAM', deletedAt: new Date('2026-11-01T00:00:00Z') };
    const refused = await trashCall('restore', 'contact', { id: USER_ID, role: 'USER' }, owned, {
      [RAW]: async () => [other],
      'prisma.client.contactShare.findFirst': async () => null,
    });
    // RED-BEFORE: the contact restored (only crm:write was checked).
    expect(refused.error, String(refused.error)).toBeInstanceOf(ForbiddenException);
    expect((refused.error as Error).message).toBe('You can only edit contacts you own');
    expect(refused.calls.map((c) => c.path)).not.toContain('prisma.client.contact.update');

    const mine = await trashCall('restore', 'contact', { id: USER_ID, role: 'USER' }, owned, {
      [RAW]: async () => [{ ...other, ownerId: USER_ID }],
      'prisma.client.contact.update': async () => ({ ...other, ownerId: USER_ID, deletedAt: null }),
    });
    expect(mine.error, String(mine.error)).toBeNull();
    expect(mine.calls.map((c) => c.path)).toContain('prisma.client.contact.update');
  });
});
