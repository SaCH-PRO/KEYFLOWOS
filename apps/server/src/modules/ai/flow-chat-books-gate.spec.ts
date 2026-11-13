import { describe, expect, it, vi } from 'vitest';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { KEY_BOOKS_REVENUE_TOOLS, keyRevenueMenuLevel, keyRevenueWriteLevel, memberRevenueWriteRefusal } from './plan-step-authority';
import { graphActionModuleScope } from './graph-actions.controller';
import { CANONICAL_MODULE_TOOLS } from '../structure/job-role-policy.service';

/**
 * PR195-BOOKS-DOORS: KEY's side of the Books doors (review findings SEC-P195JS-1, -3, -4, -5 and
 * CRR-P195JS-1). Real FlowOrchestratorService prototype (selectToolsForRequest, executeToolDirectly,
 * executeTool, memberScopeRefusal, executeToolAction) and the real plan-step-authority readers;
 * stand-ins: the Prisma membership and user reads, and the services the cases call (recorders), so a
 * refusal is seen to call none of them.
 *
 *   FB-01  RED-BEFORE  SEC-P195JS-4: a member-driven turn that names no member (CHAT, CHAT_STREAM,
 *                      CHAT_CONFIRM, PLAN_HTTP with no principal; CORTEX_BRIDGE run for no one; the
 *                      Chatwoot support desk calls chat with no user) is refused every money write
 *                      before dispatch (D-73: KEY writes money only for a member): the journal, an
 *                      invoice marked paid, payroll marked paid, a bank match. A read still runs.
 *   FB-02  RED-BEFORE  ... and its menu offers none of them
 *   FB-03  RED-BEFORE  SEC-P195JS-3: KEY's journal behaves as POST journal-entries: an ADJUSTMENT (any
 *                      other type is refused 400 before the door), its amount the lines' debits, and
 *                      the member it runs for recorded as its author (createdById)
 *   FB-04  RED-BEFORE  SEC-P195JS-5 / CRR-P195JS-1: a platform SUPER_ADMIN who is a member is held as
 *                      each tool's web door holds them: the Books doors (ModuleScopeGuard, which admits
 *                      a SUPER_ADMIN, and the membership check) admit them whatever their membership's
 *                      scopes, so KEY offers and runs the journal and a bank match for them; the
 *                      invoice, quote and payment doors hold them to their membership's revenue write
 *                      (FOLLOW3-A1/A2: assertSuperAdminMayWriteRevenue), so KEY still refuses
 *                      commerce_mark_invoice_paid; payroll_mark_paid admits them as PayrollService does
 *   FB-05  RED-BEFORE  SEC-P195JS-1: the derived table: the KEY tools whose routes moved under a module
 *                      write (finance_auto_match_bank, reconcile_run_auto_match, reconcile_match_line:
 *                      revenue write; inventory_advance_purchase_order: expenses write); the D-98 gate
 *                      reads the revenue ones as money writes
 *   FB-06  RED-BEFORE  a revenue:read member's chat call to a bank match or auto-match is refused before
 *                      BankMatchingService is called; the OWNER's runs
 *   FB-07  pin         (added with the fix) the partition KEY_BOOKS_REVENUE_TOOLS draws: every revenue write
 *                      of the derived table is a Books tool (its route is a finance.controller door, which
 *                      admits a SUPER_ADMIN member) or an invoice, quote or payment tool (whose doors hold a
 *                      SUPER_ADMIN member to its own revenue write); a new revenue write fails here until it
 *                      is placed on purpose
 */

const BIZ = 'biz_1';
type Member = { role: string; permissionScopes?: unknown };
const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

function orchestratorFor(members: Record<string, Member | null>, superAdmins: string[] = []) {
  const prisma = {
    client: {
      membership: {
        findUnique: vi.fn(async ({ where }: any) => {
          const m = members[where.userId_businessId.userId];
          return m ? { role: m.role, permissionScopes: m.permissionScopes ?? null } : null;
        }),
      },
      user: {
        findUnique: vi.fn(async ({ where }: any) => ({ role: superAdmins.includes(where.id) ? 'SUPER_ADMIN' : 'USER' })),
      },
      bankTransaction: { count: vi.fn(async () => 0) },
    },
  };
  const post = vi.fn(async () => ({ transactionId: 'tx_1', alreadyPosted: false }));
  const markRunPaid = vi.fn(async () => ({ id: 'run_1', status: 'PAID' }));
  const markInvoicePaid = vi.fn(async () => ({ id: 'inv_1', status: 'PAID' }));
  const autoMatch = vi.fn(async () => ({ scanned: 0, matched: 0, ambiguous: 0 }));
  const manualMatch = vi.fn(async () => ({ id: 'bt_1', status: 'MATCHED' }));
  const receivables = vi.fn(async () => ({ buckets: [], ledgerArBalance: 0, ledgerReconciled: true, ledgerDelta: 0 }));
  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    prisma,
    logger: quiet,
    governance: { getToolTier: () => 3 },
    executionLog: { logToolExecution: async () => 'log_1' },
    businessGraph: { invalidateCache() {} },
    attributeExecutionLog: async () => undefined,
    getPosting: () => ({ post }),
    getPayroll: () => ({ markRunPaid }),
    getCommerce: () => ({ markInvoicePaid }),
    getBankMatching: () => ({ autoMatch, manualMatch }),
  }) as any;
  return { orchestrator, post, markRunPaid, markInvoicePaid, autoMatch, manualMatch, receivables };
}

async function menu(orchestrator: any, userId: string | null | undefined): Promise<string[]> {
  const tools = await orchestrator.selectToolsForRequest(
    BIZ,
    [],
    'post a journal entry in finance; mark the payroll run paid; commerce mark invoice paid; reconcile match bank line; view receivables',
    undefined,
    userId,
  );
  return tools.map((t: { function: { name: string } }) => t.function.name);
}

const JOURNAL_ARGS = {
  date: '2026-11-01T00:00:00.000Z',
  amount: 30,
  description: 'adjust',
  entries: [
    { accountId: 'coa_cash', debit: 30 },
    { accountId: 'coa_equity', credit: 30 },
  ],
};

const MEMBERS: Record<string, Member | null> = {
  owner: { role: 'OWNER' },
  revenueRead: { role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'read' } },
  revenueWrite: { role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'write' } },
  // a platform SUPER_ADMIN who holds a STAFF membership: revenue read, operations write, expenses read
  saMember: { role: 'STAFF', permissionScopes: { revenue: 'read', expenses: 'read', operations: 'write', crm: 'read' } },
  saOutsider: null,
};

const MONEY_CALLS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['finance_post_journal_entry', { type: 'ADJUSTMENT', ...JOURNAL_ARGS }],
  ['commerce_mark_invoice_paid', { invoiceId: 'inv_1' }],
  ['payroll_mark_paid', { runId: 'run_1', paymentMethod: 'cash' }],
  ['reconcile_match_line', { bankTransactionId: 'bt_1', ledgerTransactionId: 'tx_9' }],
];

describe('FB-01/02 (SEC-P195JS-4): a member-driven turn that names no member writes no money (D-73)', () => {
  it.each([
    ['CHAT', { surface: 'CHAT', principalUserId: null }],
    ['CHAT_STREAM', { surface: 'CHAT_STREAM', principalUserId: null }],
    ['CHAT_CONFIRM', { surface: 'CHAT_CONFIRM', principalUserId: null }],
    ['PLAN_HTTP', { surface: 'PLAN_HTTP', principalUserId: null }],
    ['CORTEX_BRIDGE', { surface: 'CORTEX_BRIDGE', principalUserId: null, onBehalfOfUserId: null }],
  ])('FB-01 RED-BEFORE: %s with no member: every money write is refused before dispatch', async (_s, action) => {
    const { orchestrator, post, markRunPaid, markInvoicePaid, manualMatch } = orchestratorFor(MEMBERS);
    for (const [tool, args] of MONEY_CALLS) {
      await expect(orchestrator.executeToolDirectly(BIZ, tool, { ...args }, undefined, { ...action }), tool).rejects.toThrow(
        /names no member .*\(D-73\)/,
      );
    }
    expect(post).not.toHaveBeenCalled();
    expect(markRunPaid).not.toHaveBeenCalled();
    expect(markInvoicePaid).not.toHaveBeenCalled();
    expect(manualMatch).not.toHaveBeenCalled();
  });

  it('FB-02 RED-BEFORE: the menu of a chat turn with no member (the support desk) offers no money write; a read still is', async () => {
    const { orchestrator } = orchestratorFor(MEMBERS);
    for (const who of [null, undefined]) {
      const names = await menu(orchestrator, who);
      for (const [tool] of MONEY_CALLS) expect(names, `${String(who)} ${tool}`).not.toContain(tool);
      expect(names).toContain('finance_view_receivables');
    }
  });
});

describe('FB-03 (SEC-P195JS-3): KEY\'s journal is the General Journal\'s', () => {
  it('FB-03 RED-BEFORE: a type other than ADJUSTMENT is refused 400 before the ledger door', async () => {
    const { orchestrator, post } = orchestratorFor(MEMBERS);
    for (const type of ['INCOME', 'EXPENSE', 'TAX', 'OPENING_BALANCE', 'adjustment ']) {
      await expect(
        orchestrator.executeToolDirectly(BIZ, 'finance_post_journal_entry', { ...JOURNAL_ARGS, type }, undefined, { surface: 'CHAT', principalUserId: 'owner' }),
        type,
      ).rejects.toThrow(/posts ADJUSTMENT journals only/);
    }
    expect(post).not.toHaveBeenCalled();
  });

  it('FB-03 RED-BEFORE: it posts an ADJUSTMENT whose amount is its debits, authored by the member it runs for', async () => {
    const { orchestrator, post } = orchestratorFor(MEMBERS);
    await orchestrator.executeToolDirectly(BIZ, 'finance_post_journal_entry', { ...JOURNAL_ARGS, type: 'ADJUSTMENT', amount: 999 }, undefined, { surface: 'CHAT', principalUserId: 'revenueWrite' });
    await orchestrator.executeToolDirectly(BIZ, 'finance_post_journal_entry', { ...JOURNAL_ARGS }, undefined, { surface: 'PLAN_HTTP', principalUserId: 'owner' });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0]).toMatchObject({ businessId: BIZ, type: 'ADJUSTMENT', amount: 30, createdById: 'revenueWrite' });
    expect(post.mock.calls[1][0]).toMatchObject({ businessId: BIZ, type: 'ADJUSTMENT', amount: 30, createdById: 'owner' });
  });
});

describe('FB-04 (SEC-P195JS-5, CRR-P195JS-1): a SUPER_ADMIN who is a member, as each web door holds them', () => {
  it('FB-04 RED-BEFORE: offered and run the Books tools (ModuleScopeGuard admits them); still refused an invoice marked paid (FOLLOW3-A2)', async () => {
    const { orchestrator, post, manualMatch, markInvoicePaid } = orchestratorFor(MEMBERS, ['saMember', 'saOutsider']);
    const names = await menu(orchestrator, 'saMember');
    expect(names).toContain('finance_post_journal_entry');
    expect(names).toContain('reconcile_match_line');
    expect(names).not.toContain('commerce_mark_invoice_paid');
    expect(names).toContain('payroll_mark_paid');
    await expect(
      orchestrator.executeToolDirectly(BIZ, 'finance_post_journal_entry', { ...JOURNAL_ARGS, type: 'ADJUSTMENT' }, undefined, { surface: 'CHAT', principalUserId: 'saMember' }),
    ).resolves.toEqual({ transactionId: 'tx_1', alreadyPosted: false });
    await expect(
      orchestrator.executeToolDirectly(BIZ, 'reconcile_match_line', { bankTransactionId: 'bt_1', ledgerTransactionId: 'tx_9' }, undefined, { surface: 'CHAT', principalUserId: 'saMember' }),
    ).resolves.toBeDefined();
    await expect(
      orchestrator.executeToolDirectly(BIZ, 'commerce_mark_invoice_paid', { invoiceId: 'inv_1' }, undefined, { surface: 'CHAT', principalUserId: 'saMember' }),
    ).rejects.toThrow(/revenue requires write access \(you have read\)/);
    expect(post).toHaveBeenCalledTimes(1);
    expect(manualMatch).toHaveBeenCalledTimes(1);
    expect(markInvoicePaid).not.toHaveBeenCalled();
  });

  it('FB-04 RED-BEFORE (D-46; the bank match is new to the gate): a SUPER_ADMIN who is not a member is offered and run none of them', async () => {
    const { orchestrator, post } = orchestratorFor(MEMBERS, ['saMember', 'saOutsider']);
    const names = await menu(orchestrator, 'saOutsider');
    for (const [tool] of MONEY_CALLS) expect(names, tool).not.toContain(tool);
    await expect(
      orchestrator.executeToolDirectly(BIZ, 'finance_post_journal_entry', { ...JOURNAL_ARGS, type: 'ADJUSTMENT' }, undefined, { surface: 'CHAT', principalUserId: 'saOutsider' }),
    ).rejects.toThrow(/revenue requires write access \(you have none\)/);
    expect(post).not.toHaveBeenCalled();
  });

  it('FB-04 RED-BEFORE: memberRevenueWriteRefusal, the reader every member surface shares, answers the same', async () => {
    const { orchestrator } = orchestratorFor(MEMBERS, ['saMember', 'saOutsider']);
    const prisma = orchestrator.prisma;
    expect(await memberRevenueWriteRefusal(prisma, BIZ, 'saMember', 'finance_post_journal_entry')).toBeNull();
    expect(await memberRevenueWriteRefusal(prisma, BIZ, 'saMember', 'commerce_mark_invoice_paid')).toMatch(/you have read/);
    expect(await memberRevenueWriteRefusal(prisma, BIZ, 'saOutsider', 'finance_post_journal_entry')).toMatch(/you have none/);
    expect(await memberRevenueWriteRefusal(prisma, BIZ, 'revenueRead', 'finance_post_journal_entry')).toMatch(/you have read/);
  });
});

describe('FB-05/06 (SEC-P195JS-1): the KEY tools whose routes moved', () => {
  it('FB-05 RED-BEFORE: the derived table and the D-98 gate hold the bank matching tools at revenue write and the purchase-order advance at expenses write', () => {
    for (const tool of ['finance_auto_match_bank', 'reconcile_run_auto_match', 'reconcile_match_line']) {
      expect(CANONICAL_MODULE_TOOLS.revenue[tool], tool).toBe('write');
      expect(keyRevenueWriteLevel(tool), tool).toBe('write');
      expect(keyRevenueMenuLevel(tool), tool).toBe('write');
      expect(graphActionModuleScope(tool), tool).toEqual({ module: 'revenue', minLevel: 'write' });
      expect(KEY_BOOKS_REVENUE_TOOLS.has(tool), tool).toBe(true);
    }
    expect(CANONICAL_MODULE_TOOLS.expenses.inventory_advance_purchase_order).toBe('write');
    expect(graphActionModuleScope('inventory_advance_purchase_order')).toEqual({ module: 'expenses', minLevel: 'write' });
    expect(KEY_BOOKS_REVENUE_TOOLS.has('finance_post_journal_entry')).toBe(true);
  });

  it('FB-06 RED-BEFORE: a revenue:read member\'s chat bank match and auto-match are refused before BankMatchingService; the OWNER\'s run', async () => {
    const { orchestrator, autoMatch, manualMatch } = orchestratorFor(MEMBERS);
    for (const [tool, args] of [
      ['reconcile_match_line', { bankTransactionId: 'bt_1', ledgerTransactionId: 'tx_9' }],
      ['reconcile_run_auto_match', { accountId: 'fa_1' }],
      ['finance_auto_match_bank', { accountId: 'fa_1' }],
    ] as const) {
      await expect(
        orchestrator.executeToolDirectly(BIZ, tool, { ...args }, undefined, { surface: 'CHAT', principalUserId: 'revenueRead' }),
        tool,
      ).rejects.toThrow(/revenue requires write access \(you have read\)/);
      await expect(orchestrator.executeToolDirectly(BIZ, tool, { ...args }, undefined, { surface: 'CHAT', principalUserId: 'owner' }), tool).resolves.toBeDefined();
    }
    expect(manualMatch).toHaveBeenCalledTimes(1);
    expect(autoMatch).toHaveBeenCalledTimes(2);
  });
});

describe('FB-07: which revenue writes admit a SUPER_ADMIN member (the doors they copy)', () => {
  it('FB-07 pin: every revenue write of the derived table is a Books tool or an invoice, quote or payment tool', () => {
    const writes = Object.entries(CANONICAL_MODULE_TOOLS.revenue)
      .filter(([, level]) => level === 'write' || level === 'admin')
      .map(([tool]) => tool)
      .sort();
    const books = writes.filter((t) => KEY_BOOKS_REVENUE_TOOLS.has(t));
    const doorsHoldingMembers = writes.filter((t) => !KEY_BOOKS_REVENUE_TOOLS.has(t));
    expect(books).toEqual(['finance_auto_match_bank', 'finance_post_journal_entry', 'reconcile_match_line', 'reconcile_run_auto_match']);
    expect(doorsHoldingMembers).toEqual([
      'commerce_convert_quote', 'commerce_create_invoice', 'commerce_create_quote', 'commerce_delete_invoice',
      'commerce_mark_invoice_paid', 'commerce_update_invoice', 'payments_create_link', 'payments_refund_charge', 'payments_revoke_link',
    ]);
    // The set names nothing outside the table.
    for (const t of KEY_BOOKS_REVENUE_TOOLS) expect(writes, t).toContain(t);
  });
});
