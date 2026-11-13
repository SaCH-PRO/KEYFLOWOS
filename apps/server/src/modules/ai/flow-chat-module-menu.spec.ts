import { describe, expect, it, vi } from 'vitest';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { keyRevenueMenuLevel, keyRevenueWriteLevel, noMemberToolRefusal } from './plan-step-authority';
import { graphActionRequirement } from './graph-actions.controller';
import { CANONICAL_MODULE_TOOLS } from '../structure/job-role-policy.service';

/**
 * PR195-JOURNAL-SCOPE (review finding CR-P195-4, and the PR195-PORT repair's open item on the FLOW
 * menu): KEY member chat offers, and runs, a tool only when the member holds what its authority map
 * entry requires, for the two money writes the port touched.
 *
 *   - finance_post_journal_entry: POST finance journal-entries now needs revenue write
 *     (journal-write-scope.spec.ts), so the derived table (CANONICAL_MODULE_TOOLS.revenue) holds the
 *     tool at write and the D-98 revenue gate (keyRevenueWriteLevel / keyRevenueMenuLevel, which read
 *     that table) refuses it to a member below revenue write: on the menu and when a call runs.
 *     Before, the tool was ungranted, the gate read it as no money write, and a revenue:read member's
 *     chat (or a non-member SUPER_ADMIN's) was offered it and ran it.
 *   - payroll_mark_paid: the port holds it to expenses write beside operations write
 *     (GRAPH_ACTION_EXTRA_SCOPES; PayrollService refuses 403 inside dispatch). The chat menu read the
 *     operations gate (D-40) and the revenue gate (D-98) only, so it still offered the tool to a
 *     member with operations write and expenses read, and the call was only refused once dispatched.
 *     Now the authority map's extra scopes (other than revenue, which the revenue gate judges with the
 *     call's arguments) are held on the menu and before dispatch, as PayrollService holds them: a
 *     Membership of this business (D-46), a SUPER_ADMIN who is a member passing.
 *
 * Real FlowOrchestratorService prototype (selectToolsForRequest, executeToolDirectly, executeTool,
 * memberScopeRefusal, executeToolAction); stand-ins: the Prisma membership and user reads, and the
 * ledger door and payroll service the two cases call (recorders), so a refusal is seen to call
 * neither.
 *
 *   FM-01  RED-BEFORE  a revenue:read member is not offered finance_post_journal_entry (a read of the
 *                      Books still is)
 *   FM-02  CONTROL     revenue write, an ADMIN on defaults and the OWNER are offered it
 *   FM-03  RED-BEFORE  operations write with expenses read: payroll_mark_paid is not offered (approve is)
 *   FM-04  CONTROL     operations and expenses write are offered it; operations read is not (D-40)
 *   FM-05  RED-BEFORE  a platform SUPER_ADMIN who is not a member is offered neither (D-46)
 *   FM-06  RED-BEFORE  a revenue:read member's chat call to finance_post_journal_entry is refused with
 *                      the route's words before the ledger door is called, on every member-driven
 *                      surface (CHAT, CHAT_STREAM, CHAT_CONFIRM, PLAN_HTTP, CORTEX_BRIDGE)
 *   FM-07  RED-BEFORE  payroll_mark_paid for operations write with expenses read is refused before
 *                      PayrollService is called
 *   FM-08  CONTROL     the OWNER's call posts once; operations and expenses write mark the run paid
 *   FM-09  table       keyRevenueWriteLevel reads finance_post_journal_entry as a revenue write
 *                      (RED-BEFORE); its authority map entry and D-73 refusal are as before
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
    },
  };
  const post = vi.fn(async () => ({ transactionId: 'tx_1', alreadyPosted: false }));
  const markRunPaid = vi.fn(async () => ({ id: 'run_1', status: 'PAID' }));
  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    prisma,
    logger: quiet,
    governance: { getToolTier: () => 3 },
    executionLog: { logToolExecution: async () => 'log_1' },
    businessGraph: { invalidateCache() {} },
    attributeExecutionLog: async () => undefined,
    getPosting: () => ({ post }),
    getPayroll: () => ({ markRunPaid }),
  }) as any;
  return { orchestrator, post, markRunPaid };
}

/** The tool names the member's own chat turn is offered (no crew: the whole registry, then the gates). */
async function menu(orchestrator: any, userId: string): Promise<string[]> {
  const tools = await orchestrator.selectToolsForRequest(BIZ, [], 'post a journal entry in finance; mark the payroll run paid; approve the payroll run; view receivables', undefined, userId);
  return tools.map((t: { function: { name: string } }) => t.function.name);
}

const JOURNAL_ARGS = {
  type: 'ADJUSTMENT',
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
  admin: { role: 'ADMIN' },
  staffDefault: { role: 'STAFF' }, // role defaults: revenue read, operations read, expenses read
  revenueRead: { role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'read' } },
  revenueWrite: { role: 'STAFF', permissionScopes: { crm: 'read', revenue: 'write' } },
  opsWriteExpRead: { role: 'STAFF', permissionScopes: { operations: 'write', expenses: 'read' } },
  opsWriteExpWrite: { role: 'STAFF', permissionScopes: { operations: 'write', expenses: 'write' } },
  opsReadExpWrite: { role: 'STAFF', permissionScopes: { operations: 'read', expenses: 'write' } },
  saOutsider: null,
};

describe('PR195-JOURNAL-SCOPE: the FLOW chat menu offers a money write only to a member holding its scopes', () => {
  it('FM-01 RED-BEFORE: a revenue:read member is not offered finance_post_journal_entry; a Books read still is', async () => {
    const { orchestrator } = orchestratorFor(MEMBERS);
    for (const who of ['revenueRead', 'staffDefault']) {
      const names = await menu(orchestrator, who);
      expect(names, who).not.toContain('finance_post_journal_entry');
      expect(names, who).toContain('finance_view_receivables');
    }
  });

  it('FM-02 CONTROL: revenue write, an ADMIN on role defaults and the OWNER are offered finance_post_journal_entry', async () => {
    const { orchestrator } = orchestratorFor(MEMBERS);
    for (const who of ['revenueWrite', 'admin', 'owner']) expect(await menu(orchestrator, who), who).toContain('finance_post_journal_entry');
  });

  it('FM-03 RED-BEFORE: operations write with expenses read is not offered payroll_mark_paid; payroll_approve_run (operations write alone) still is', async () => {
    const { orchestrator } = orchestratorFor(MEMBERS);
    const names = await menu(orchestrator, 'opsWriteExpRead');
    expect(names).not.toContain('payroll_mark_paid');
    expect(names).toContain('payroll_approve_run');
  });

  it('FM-04 CONTROL: operations and expenses write are offered payroll_mark_paid; operations read is not (D-40), whatever its expenses', async () => {
    const { orchestrator } = orchestratorFor(MEMBERS);
    expect(await menu(orchestrator, 'opsWriteExpWrite')).toContain('payroll_mark_paid');
    expect(await menu(orchestrator, 'owner')).toContain('payroll_mark_paid');
    expect(await menu(orchestrator, 'opsReadExpWrite')).not.toContain('payroll_mark_paid');
  });

  it('FM-05 RED-BEFORE: a platform SUPER_ADMIN who is not a member is offered neither money write (D-46)', async () => {
    const { orchestrator } = orchestratorFor(MEMBERS, ['saOutsider']);
    const names = await menu(orchestrator, 'saOutsider');
    expect(names).not.toContain('finance_post_journal_entry');
    expect(names).not.toContain('payroll_mark_paid');
  });
});

describe('PR195-JOURNAL-SCOPE: a call the member may not make is refused before the ledger is written', () => {
  it.each(['CHAT', 'CHAT_STREAM', 'CHAT_CONFIRM', 'PLAN_HTTP'])(
    'FM-06 RED-BEFORE: %s: a revenue:read member\'s finance_post_journal_entry is refused with the route\'s words; the ledger door is not called',
    async (surface) => {
      const { orchestrator, post } = orchestratorFor(MEMBERS);
      await expect(
        orchestrator.executeToolDirectly(BIZ, 'finance_post_journal_entry', { ...JOURNAL_ARGS }, undefined, { surface, principalUserId: 'revenueRead' }),
      ).rejects.toThrow(/Insufficient permissions: revenue requires write access \(you have read\)/);
      expect(post).not.toHaveBeenCalled();
    },
  );

  it('FM-06 RED-BEFORE: CORTEX_BRIDGE (the member a KEY-cortex turn runs for) and a non-member SUPER_ADMIN\'s chat are refused the same way', async () => {
    const { orchestrator, post } = orchestratorFor(MEMBERS, ['saOutsider']);
    await expect(
      orchestrator.executeToolDirectly(BIZ, 'finance_post_journal_entry', { ...JOURNAL_ARGS }, undefined, { surface: 'CORTEX_BRIDGE', principalUserId: null, onBehalfOfUserId: 'revenueRead' }),
    ).rejects.toThrow(/revenue requires write access \(you have read\)/);
    await expect(
      orchestrator.executeToolDirectly(BIZ, 'finance_post_journal_entry', { ...JOURNAL_ARGS }, undefined, { surface: 'CHAT', principalUserId: 'saOutsider' }),
    ).rejects.toThrow(/revenue requires write access \(you have none\)/);
    expect(post).not.toHaveBeenCalled();
  });

  it('FM-07 RED-BEFORE: payroll_mark_paid for operations write with expenses read is refused before PayrollService is called', async () => {
    const { orchestrator, markRunPaid } = orchestratorFor(MEMBERS, ['saOutsider']);
    for (const surface of ['CHAT', 'PLAN_HTTP']) {
      await expect(
        orchestrator.executeToolDirectly(BIZ, 'payroll_mark_paid', { runId: 'run_1', paymentMethod: 'cash' }, undefined, { surface, principalUserId: 'opsWriteExpRead' }),
        surface,
      ).rejects.toThrow(/Insufficient permissions: expenses requires write access \(you have read\)/);
    }
    // D-46: a platform SUPER_ADMIN who is not a member is refused as PayrollService refuses them.
    await expect(
      orchestrator.executeToolDirectly(BIZ, 'payroll_mark_paid', { runId: 'run_1', paymentMethod: 'cash' }, undefined, { surface: 'CHAT', principalUserId: 'saOutsider' }),
    ).rejects.toThrow(/Not a member of this business/);
    expect(markRunPaid).not.toHaveBeenCalled();
  });

  it('FM-08 CONTROL: the OWNER\'s and an ADMIN\'s journal post once; operations and expenses write mark the run paid', async () => {
    const { orchestrator, post, markRunPaid } = orchestratorFor(MEMBERS);
    for (const who of ['owner', 'admin', 'revenueWrite']) {
      await expect(
        orchestrator.executeToolDirectly(BIZ, 'finance_post_journal_entry', { ...JOURNAL_ARGS }, undefined, { surface: 'CHAT', principalUserId: who }),
        who,
      ).resolves.toEqual({ transactionId: 'tx_1', alreadyPosted: false });
    }
    expect(post).toHaveBeenCalledTimes(3);
    await expect(
      orchestrator.executeToolDirectly(BIZ, 'payroll_mark_paid', { runId: 'run_1', paymentMethod: 'cash' }, undefined, { surface: 'CHAT', principalUserId: 'opsWriteExpWrite' }),
    ).resolves.toEqual({ id: 'run_1', status: 'PAID' });
    expect(markRunPaid).toHaveBeenCalledTimes(1);
  });
});

describe('PR195-JOURNAL-SCOPE: the tables KEY reads', () => {
  it('FM-09 RED-BEFORE: finance_post_journal_entry is a revenue write in the derived table and the D-98 gate; its authority map entry and D-73 are as before', () => {
    expect(CANONICAL_MODULE_TOOLS.revenue.finance_post_journal_entry).toBe('write');
    expect(keyRevenueWriteLevel('finance_post_journal_entry')).toBe('write');
    expect(keyRevenueMenuLevel('finance_post_journal_entry')).toBe('write');
    const requirement = graphActionRequirement('finance_post_journal_entry');
    expect(requirement && 'scopes' in requirement ? requirement.scopes : requirement).toEqual([{ module: 'revenue', minLevel: 'write' }]);
    expect(noMemberToolRefusal('finance_post_journal_entry')).toMatch(/revenue write\), and a KEY plan or monitor with no member principal writes neither \(D-73\)/);
  });
});
