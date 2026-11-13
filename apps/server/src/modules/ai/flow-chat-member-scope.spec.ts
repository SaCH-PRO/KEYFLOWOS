import { describe, expect, it, vi } from 'vitest';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { keyMemberMenuScopes, keyMemberToolScopes } from './plan-step-authority';
import { graphActionRequirement } from './graph-actions.controller';
import { CANONICAL_MODULE_TOOLS, GOVERNED_UNGRANTED } from '../structure/job-role-policy.service';
import { FLOW_TOOLS } from './flow-tool-registry';

/**
 * PR195-KEY-GATES (review findings SEC-P195BW-3, SEC-P195BW-5, CRR-P195BD-2): a member driving KEY (their own
 * chat turn: CHAT, CHAT_STREAM, CHAT_CONFIRM; an approved plan run over HTTP: PLAN_HTTP; a KEY-cortex turn's
 * bridged call: CORTEX_BRIDGE) is held to the SAME module scope the tool's REST route requires, for reads and
 * writes, on the menu and at dispatch. One generic gate, derived from the canonical tool table
 * (CANONICAL_MODULE_TOOLS, which job-role-tool-families.spec.ts re-derives from the route decorators), the
 * governed part of a GOVERNED_UNGRANTED tool and the authority map's extra scopes, replaces the per-module
 * special cases (D-40 operations, D-98 revenue writes, the payroll extra scope), which are special cases of it.
 * Before, member chat checked only operations, revenue writes and payroll's extra scope: an expenses-read
 * member ran expenses_create, finance_pay_bill and inventory_advance_purchase_order (REST: 403 'expenses
 * requires write access'), and a revenue-none member read receivables and the P&L (REST: 403 'revenue
 * requires read access', D-57).
 *
 *   KMS-01  RED-BEFORE  the gate is derived: every canonical tool needs its table module and level, a
 *                       GOVERNED_UNGRANTED tool its governed floor, payroll_mark_paid its expenses write
 *                       beside operations; a tool no route governs needs nothing (D-98's narrowest reading)
 *   KMS-02  RED-BEFORE  expenses writes (expenses_create, finance_pay_bill, inventory_advance_purchase_order):
 *                       an expenses-read member is refused on the menu and at dispatch, on CHAT, PLAN_HTTP and
 *                       CORTEX_BRIDGE, before any service is called; expenses write, the OWNER run
 *   KMS-03  RED-BEFORE  Books / money reads (finance_profit_and_loss, finance_view_receivables): a revenue-none
 *                       member is refused, a revenue-read member runs
 *   KMS-04  RED-BEFORE  a crm read (deals_list_stages): a crm-none member is refused, crm read runs
 *   KMS-05  control     an operations write (contracts_create, D-40 as before): operations read refused, write runs
 *   KMS-06  control     D-98 and the payroll extra scope keep their answers through the generic gate
 *   KMS-07  RED-BEFORE  a platform SUPER_ADMIN, as ModuleScopeGuard and each door hold them: a member passes
 *                       every scope but the invoice, quote and payment writes (held to its own revenue write,
 *                       FOLLOW3-A2); one who is not a member is refused every money write, the expenses ones
 *                       included (D-46, SEC-P195BW-7), and passes the rest as ModuleScopeGuard passes them
 */

const BIZ = 'biz_kms';
const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
type Member = { role: string; permissionScopes?: unknown };

const MEMBERS: Record<string, Member | null> = {
  owner: { role: 'OWNER' },
  // STAFF role defaults: read on every module but settings, team and ai
  staffDefault: { role: 'STAFF' },
  crmOnly: { role: 'STAFF', permissionScopes: { crm: 'read' } },
  revenueOnly: { role: 'STAFF', permissionScopes: { revenue: 'read' } },
  expWrite: { role: 'STAFF', permissionScopes: { expenses: 'write', revenue: 'read', operations: 'read', crm: 'read', storefront: 'read' } },
  opsWrite: { role: 'STAFF', permissionScopes: { operations: 'write', crm: 'read' } },
  // a platform SUPER_ADMIN who holds a STAFF membership with read scopes
  saMember: { role: 'STAFF', permissionScopes: { revenue: 'read', expenses: 'read', operations: 'read', crm: 'read' } },
  saOutsider: null,
};
const SUPER_ADMINS = ['saMember', 'saOutsider'];

function orchestratorFor() {
  const prisma = {
    client: {
      membership: {
        findUnique: vi.fn(async ({ where }: any) => {
          const m = MEMBERS[where.userId_businessId.userId];
          return m ? { role: m.role, permissionScopes: m.permissionScopes ?? null } : null;
        }),
      },
      user: { findUnique: vi.fn(async ({ where }: any) => ({ role: SUPER_ADMINS.includes(where.id) ? 'SUPER_ADMIN' : 'USER' })) },
    },
  };
  const rec = {
    createExpense: vi.fn(async () => ({ id: 'exp_1' })),
    markBillPaid: vi.fn(async () => ({ id: 'bill_1', status: 'PAID' })),
    advancePurchaseOrderStatus: vi.fn(async () => ({ id: 'po_1', status: 'RECEIVED' })),
    getPnl: vi.fn(async () => ({ net: 600 })),
    getAging: vi.fn(async () => ({ asOf: new Date(), customers: [{ name: 'Alice', outstanding: 1 }], totals: {} })),
    listStages: vi.fn(async () => [{ id: 'st_1' }]),
    createContract: vi.fn(async () => ({ id: 'ctr_1' })),
    markInvoicePaid: vi.fn(async () => ({ id: 'inv_1', status: 'PAID' })),
    post: vi.fn(async () => ({ transactionId: 'tx_1', alreadyPosted: false })),
    markRunPaid: vi.fn(async () => ({ id: 'run_1', status: 'PAID' })),
  };
  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    prisma,
    logger: quiet,
    governance: { getToolTier: () => 2 },
    executionLog: { logToolExecution: async () => 'log_1' },
    businessGraph: { invalidateCache() {} },
    attributeExecutionLog: async () => undefined,
    getExpenses: () => ({ createExpense: rec.createExpense, markBillPaid: rec.markBillPaid }),
    getMarketplace: () => ({ advancePurchaseOrderStatus: rec.advancePurchaseOrderStatus }),
    getLedgerReporting: () => ({ getPnl: rec.getPnl }),
    getReceivables: () => ({ getAging: rec.getAging }),
    getDeals: () => ({ listStages: rec.listStages }),
    getContracts: () => ({ createContract: rec.createContract }),
    getCommerce: () => ({ markInvoicePaid: rec.markInvoicePaid }),
    getPosting: () => ({ post: rec.post }),
    getPayroll: () => ({ markRunPaid: rec.markRunPaid }),
  }) as any;
  return { orchestrator, rec };
}

/**
 * The member's menu, the turn's text naming `about`: the registry has more tools than the 128 a turn is offered,
 * ranked by the words of their names the text holds, so naming them keeps a tool the gate lets through on it.
 */
async function menu(orchestrator: any, userId: string, about: readonly string[]): Promise<string[]> {
  const tools = await orchestrator.selectToolsForRequest(BIZ, [], about.join(' '), undefined, userId);
  return tools.map((t: { function: { name: string } }) => t.function.name);
}

const CALLS: Record<string, Record<string, unknown>> = {
  expenses_create: { amount: 50, description: 'paper' },
  finance_pay_bill: { billId: 'bill_1' },
  inventory_advance_purchase_order: { purchaseOrderId: 'po_1', status: 'RECEIVED' },
  finance_profit_and_loss: { from: '2026-01-01', to: '2026-11-01' },
  finance_view_receivables: {},
  deals_list_stages: {},
  contracts_create: { title: 'MSA', contractType: 'SERVICE_AGREEMENT' },
  commerce_mark_invoice_paid: { invoiceId: 'inv_1' },
  finance_post_journal_entry: { date: '2026-11-01T00:00:00.000Z', description: 'adj', entries: [{ accountId: 'a', debit: 5 }, { accountId: 'b', credit: 5 }] },
  payroll_mark_paid: { runId: 'run_1', paymentMethod: 'cash' },
};

const SURFACES = (userId: string) => [
  { surface: 'CHAT', principalUserId: userId },
  { surface: 'CHAT_STREAM', principalUserId: userId },
  { surface: 'PLAN_HTTP', principalUserId: userId },
  { surface: 'CORTEX_BRIDGE', onBehalfOfUserId: userId },
];

async function run(orchestrator: any, tool: string, action: Record<string, unknown>) {
  return orchestrator.executeToolDirectly(BIZ, tool, { ...CALLS[tool] }, undefined, { ...action });
}

describe('KMS-01: the gate is derived from the canonical tool table', () => {
  it('KMS-01 RED-BEFORE: every canonical tool needs its table module at its table level, on the menu and at a call', () => {
    for (const [module, tools] of Object.entries(CANONICAL_MODULE_TOOLS)) {
      for (const [tool, minLevel] of Object.entries(tools)) {
        expect(keyMemberToolScopes(tool, {}), tool).toContainEqual({ module, minLevel });
        expect(keyMemberMenuScopes(tool), tool).toContainEqual({ module, minLevel });
      }
    }
  });

  it('KMS-01 RED-BEFORE: a GOVERNED_UNGRANTED tool needs its governed floor; update_status_with_confirmation needs revenue write only to move invoices; payroll_mark_paid needs expenses write beside operations', () => {
    for (const tool of Object.keys(GOVERNED_UNGRANTED).filter((t) => t !== 'execute_custom_logic')) {
      const requirement = graphActionRequirement(tool) as { scopes: Array<{ module: string; minLevel: string }> };
      expect(keyMemberToolScopes(tool, { entityType: 'invoice' }), tool).toContainEqual(requirement.scopes[0]);
    }
    expect(keyMemberToolScopes('commerce_send_invoice', {})).toEqual([{ module: 'revenue', minLevel: 'write' }]);
    expect(keyMemberToolScopes('update_status_with_confirmation', { entityType: 'invoice', ids: ['i'], newStatus: 'PAID' })).toEqual([
      { module: 'crm', minLevel: 'write' },
      { module: 'revenue', minLevel: 'write' },
    ]);
    expect(keyMemberToolScopes('update_status_with_confirmation', { entityType: 'contact', ids: ['c'], newStatus: 'CUSTOMER' })).toEqual([{ module: 'crm', minLevel: 'write' }]);
    // the menu offers it on its floor; the call is judged by its arguments (review CR-W8KRG-1)
    expect(keyMemberMenuScopes('update_status_with_confirmation')).toEqual([{ module: 'crm', minLevel: 'write' }]);
    // omitted arguments are read as an invoice move (fail closed)
    expect(keyMemberToolScopes('update_status_with_confirmation')).toContainEqual({ module: 'revenue', minLevel: 'write' });
    expect(keyMemberToolScopes('payroll_mark_paid', {})).toEqual([
      { module: 'operations', minLevel: 'write' },
      { module: 'expenses', minLevel: 'write' },
    ]);
    expect(keyMemberToolScopes('execute_custom_logic', {})).toEqual([]);
  });

  it('KMS-01: a tool no route governs needs no scope in member chat (D-98\'s narrowest reading; the plan queue keeps its prefix floor)', () => {
    const governed = new Set([...Object.values(CANONICAL_MODULE_TOOLS).flatMap((t) => Object.keys(t)), ...Object.keys(GOVERNED_UNGRANTED)]);
    const ungoverned = FLOW_TOOLS.map((t) => t.name).filter((t) => !governed.has(t));
    expect(ungoverned.length).toBeGreaterThan(50);
    for (const tool of ungoverned) expect(keyMemberToolScopes(tool, {}), tool).toEqual([]);
  });
});

describe('KMS-02: the expenses writes (SEC-P195BW-3, CRR-P195BD-2)', () => {
  const TOOLS = ['expenses_create', 'finance_pay_bill', 'inventory_advance_purchase_order'];

  it('KMS-02 RED-BEFORE: an expenses-read member (STAFF defaults) is offered none of them', async () => {
    const { orchestrator } = orchestratorFor();
    const names = await menu(orchestrator, 'staffDefault', TOOLS);
    for (const t of TOOLS) expect(names, t).not.toContain(t);
    const writer = await menu(orchestrator, 'expWrite', TOOLS);
    for (const t of TOOLS) expect(writer, t).toContain(t);
  });

  it.each(['CHAT', 'CHAT_STREAM', 'PLAN_HTTP', 'CORTEX_BRIDGE'])('KMS-02 RED-BEFORE: on %s the expenses-read member is refused before any service runs; expenses write and the OWNER run', async (surface) => {
    const { orchestrator, rec } = orchestratorFor();
    const as = (userId: string) => SURFACES(userId).find((s) => s.surface === surface)!;
    for (const t of TOOLS) {
      await expect(run(orchestrator, t, as('staffDefault')), t).rejects.toThrow(/^Insufficient permissions: expenses requires write access \(you have read\)/);
    }
    expect(rec.createExpense).not.toHaveBeenCalled();
    expect(rec.markBillPaid).not.toHaveBeenCalled();
    expect(rec.advancePurchaseOrderStatus).not.toHaveBeenCalled();
    for (const who of ['expWrite', 'owner']) for (const t of TOOLS) await expect(run(orchestrator, t, as(who)), `${who} ${t}`).resolves.toBeDefined();
    expect(rec.createExpense).toHaveBeenCalledTimes(2);
    expect(rec.markBillPaid).toHaveBeenCalledTimes(2);
    expect(rec.advancePurchaseOrderStatus).toHaveBeenCalledTimes(2);
  });
});

describe('KMS-03: the Books and money reads (SEC-P195BW-5)', () => {
  const TOOLS = ['finance_profit_and_loss', 'finance_view_receivables'];

  it('KMS-03 RED-BEFORE: a revenue-none member is offered and run none of them; revenue read runs', async () => {
    const { orchestrator, rec } = orchestratorFor();
    const names = await menu(orchestrator, 'crmOnly', TOOLS);
    for (const t of TOOLS) expect(names, t).not.toContain(t);
    for (const action of SURFACES('crmOnly')) {
      for (const t of TOOLS) {
        await expect(run(orchestrator, t, action), `${action.surface} ${t}`).rejects.toThrow(/^Insufficient permissions: revenue requires read access \(you have none\)/);
      }
    }
    expect(rec.getPnl).not.toHaveBeenCalled();
    expect(rec.getAging).not.toHaveBeenCalled();
    expect(await menu(orchestrator, 'staffDefault', TOOLS)).toEqual(expect.arrayContaining(TOOLS));
    for (const t of TOOLS) await expect(run(orchestrator, t, { surface: 'CHAT', principalUserId: 'staffDefault' }), t).resolves.toBeDefined();
  });
});

describe('KMS-04/05/06: the other modules and the old special cases', () => {
  it('KMS-04 RED-BEFORE: a crm read (deals_list_stages) needs crm read', async () => {
    const { orchestrator, rec } = orchestratorFor();
    expect(await menu(orchestrator, 'revenueOnly', ['deals_list_stages'])).not.toContain('deals_list_stages');
    expect(await menu(orchestrator, 'crmOnly', ['deals_list_stages'])).toContain('deals_list_stages');
    await expect(run(orchestrator, 'deals_list_stages', { surface: 'CHAT', principalUserId: 'revenueOnly' })).rejects.toThrow(
      /^Insufficient permissions: crm requires read access \(you have none\)/,
    );
    expect(rec.listStages).not.toHaveBeenCalled();
    await expect(run(orchestrator, 'deals_list_stages', { surface: 'CHAT', principalUserId: 'crmOnly' })).resolves.toEqual({ stages: [{ id: 'st_1' }] });
  });

  it('KMS-05 RED-BEFORE (D-40 as a case of the gate): an operations write needs operations write, in the guard\'s words, now on PLAN_HTTP and CORTEX_BRIDGE too', async () => {
    const { orchestrator, rec } = orchestratorFor();
    expect(await menu(orchestrator, 'staffDefault', ['contracts_create'])).not.toContain('contracts_create');
    expect(await menu(orchestrator, 'opsWrite', ['contracts_create'])).toContain('contracts_create');
    for (const action of SURFACES('staffDefault')) {
      await expect(run(orchestrator, 'contracts_create', action), action.surface).rejects.toThrow(/^Insufficient permissions: operations requires write access \(you have read\)/);
    }
    expect(rec.createContract).not.toHaveBeenCalled();
    await expect(run(orchestrator, 'contracts_create', { surface: 'CHAT', principalUserId: 'opsWrite' })).resolves.toBeDefined();
  });

  it('KMS-06 control (D-98, the payroll extra scope): the revenue writes and payroll_mark_paid keep their answers', async () => {
    const { orchestrator, rec } = orchestratorFor();
    await expect(run(orchestrator, 'commerce_mark_invoice_paid', { surface: 'CHAT', principalUserId: 'staffDefault' })).rejects.toThrow(
      /^Insufficient permissions: revenue requires write access \(you have read\).*\(D-98\)/,
    );
    await expect(run(orchestrator, 'payroll_mark_paid', { surface: 'CHAT', principalUserId: 'opsWrite' })).rejects.toThrow(
      /^Insufficient permissions: expenses requires write access \(you have none\)/,
    );
    expect(rec.markInvoicePaid).not.toHaveBeenCalled();
    expect(rec.markRunPaid).not.toHaveBeenCalled();
    await expect(run(orchestrator, 'commerce_mark_invoice_paid', { surface: 'CHAT', principalUserId: 'owner' })).resolves.toBeDefined();
  });
});

describe('KMS-07: a platform SUPER_ADMIN, as ModuleScopeGuard and each door hold them', () => {
  it('KMS-07 RED-BEFORE: a SUPER_ADMIN member passes the expenses writes, the Books reads and writes, operations; is held to its own revenue write on an invoice', async () => {
    const { orchestrator } = orchestratorFor();
    const PASSED = ['expenses_create', 'finance_pay_bill', 'inventory_advance_purchase_order', 'finance_view_receivables', 'finance_post_journal_entry', 'contracts_create', 'payroll_mark_paid'];
    const names = await menu(orchestrator, 'saMember', [...PASSED, 'commerce_mark_invoice_paid']);
    for (const t of PASSED) {
      expect(names, t).toContain(t);
      await expect(run(orchestrator, t, { surface: 'CHAT', principalUserId: 'saMember' }), t).resolves.toBeDefined();
    }
    expect(names).not.toContain('commerce_mark_invoice_paid');
    await expect(run(orchestrator, 'commerce_mark_invoice_paid', { surface: 'CHAT', principalUserId: 'saMember' })).rejects.toThrow(/revenue requires write access \(you have read\)/);
  });

  it('KMS-07 RED-BEFORE (D-46, SEC-P195BW-7): a SUPER_ADMIN who is not a member is refused every money write, the expenses ones included; a read passes as ModuleScopeGuard passes it', async () => {
    const { orchestrator, rec } = orchestratorFor();
    const MONEY = ['expenses_create', 'finance_pay_bill', 'inventory_advance_purchase_order', 'finance_post_journal_entry', 'commerce_mark_invoice_paid', 'payroll_mark_paid'];
    const names = await menu(orchestrator, 'saOutsider', [...MONEY, 'finance_profit_and_loss', 'contracts_create']);
    for (const t of MONEY) {
      expect(names, t).not.toContain(t);
      await expect(run(orchestrator, t, { surface: 'CHAT', principalUserId: 'saOutsider' }), t).rejects.toThrow(/\(D-46\)/);
    }
    expect(rec.createExpense).not.toHaveBeenCalled();
    expect(rec.markBillPaid).not.toHaveBeenCalled();
    expect(rec.advancePurchaseOrderStatus).not.toHaveBeenCalled();
    expect(rec.post).not.toHaveBeenCalled();
    expect(names).toContain('finance_profit_and_loss');
    expect(names).toContain('contracts_create');
  });
});
