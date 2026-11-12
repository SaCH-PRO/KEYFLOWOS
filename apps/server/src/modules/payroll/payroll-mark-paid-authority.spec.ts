import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PayrollController } from './payroll.controller';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { MODULE_SCOPE_KEY, ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import { CANONICAL_MODULE_TOOLS } from '../structure/job-role-policy.service';
import { graphActionRequirement } from '../ai/graph-actions.controller';
import { keyRevenueWriteLevel, noMemberToolRefusal } from '../ai/plan-step-authority';
import { FLOW_TOOLS } from '../ai/flow-tool-registry';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';
import { KEY_SYSTEM_ACTOR_ID } from '../../core/auth/system-actor';

/**
 * PR195-PORT: marking a payroll run paid now writes the books (part 2). Payroll
 * is sensitive, and the port must not widen who may do it, on the web or on KEY.
 * These pin the head's authority as it was at b4a30241 (they pass there) and
 * the two new arguments the port adds (they fail there):
 *
 *   PA-01  POST payroll/.../runs/:runId/mark-paid keeps AuthGuard, BusinessGuard,
 *          ModuleScopeGuard and operations write (D-40's module; D-36's
 *          route level), no more and no less.
 *   PA-02  KEY's payroll_mark_paid keeps its authority map entry: operations
 *          write as the canonical module tool, operations in the graph-action
 *          map, risk tier 3 (D-36: KEY needs admin), no revenue gate added
 *          (D-98 reads route tables, and the route is unchanged), and a run
 *          with no member principal is refused nothing new (D-73).
 *   PA-03  the registry describes the posting and the payment account / method
 *          arguments the service now requires.
 *   PA-04  the REST handler names the signed-in member as the posting's actor
 *          and passes the account / method from the body.
 *   PA-05  the KEY dispatcher posts as KEY's system actor with the member the
 *          turn runs for as initiatedBy (as commerce mark-paid, D-90), and
 *          passes the account / method.
 *   PA-06  finance_post_journal_entry's manual equivalent is the General
 *          Journal page (/app/finance/journal), which part 3 builds.
 */

const tool = (name: string) => FLOW_TOOLS.find((t) => t.name === name)!;

describe('payroll mark-paid authority is unchanged by the port (PR195-PORT)', () => {
  it('PA-01 the route keeps its guards and operations write', () => {
    const handler = PayrollController.prototype.markRunPaid;
    expect(Reflect.getMetadata(MODULE_SCOPE_KEY, handler)).toEqual({ module: 'operations', minLevel: 'write' });
    expect(Reflect.getMetadata(GUARDS_METADATA, PayrollController)).toEqual([AuthGuard, BusinessGuard, ModuleScopeGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
    // approve stays operations write as well
    expect(Reflect.getMetadata(MODULE_SCOPE_KEY, PayrollController.prototype.approveRun)).toEqual({ module: 'operations', minLevel: 'write' });
  });

  it('PA-02 KEY\'s payroll_mark_paid keeps its authority map entry', () => {
    expect(CANONICAL_MODULE_TOOLS.operations.payroll_mark_paid).toBe('write');
    for (const [module, tools] of Object.entries(CANONICAL_MODULE_TOOLS)) {
      if (module === 'operations') continue;
      expect(Object.prototype.hasOwnProperty.call(tools, 'payroll_mark_paid'), `payroll_mark_paid granted under ${module}`).toBe(false);
    }
    const requirement = graphActionRequirement('payroll_mark_paid');
    expect(requirement).not.toBeNull();
    expect(requirement && 'scopes' in requirement ? requirement.scopes.map((s) => s.module) : requirement).toEqual(['operations']);
    expect(requirement && 'scopes' in requirement ? requirement.ownerOnly : undefined).toBeUndefined();
    expect(keyRevenueWriteLevel('payroll_mark_paid')).toBeNull();
    expect(noMemberToolRefusal('payroll_mark_paid')).toBeNull();
    const t = tool('payroll_mark_paid');
    expect(t.riskTier).toBe(3);
    expect(t.riskLevel).toBe('high');
    expect(t.family).toBe('execute');
    expect(t.manualEquivalentRoute).toBe('/app/payroll');
  });

  it('PA-03 the registry names the posting and the payment account or method', () => {
    const t = tool('payroll_mark_paid');
    expect(t.description).toMatch(/general ledger/i);
    expect(t.changedEntities).toEqual(['payrollRun', 'financialTransaction', 'ledgerEntry']);
    const props = (t.parameters as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(Object.keys(props).sort()).toEqual(['paymentAccountId', 'paymentMethod', 'runId']);
    expect(props.paymentMethod.enum).toEqual(['cash', 'bank_transfer', 'wire', 'ach', 'cheque', 'wipay', 'paypal', 'stripe']);
    expect((t.parameters as { required: string[] }).required).toEqual(['runId']);
  });

  it('PA-04 REST: the signed-in member is the posting\'s actor; account and method come from the body', async () => {
    const payroll = { markRunPaid: vi.fn(async () => ({ id: 'run_1', status: 'PAID' })) };
    const controller = new PayrollController(payroll as any);
    await (controller.markRunPaid as any)(
      'biz_1',
      'run_1',
      { paymentAccountId: 'fa_1', paymentMethod: 'bank_transfer', actorId: 'forged', initiatedBy: 'forged' },
      { user: { id: 'u_member' } },
    );
    expect(payroll.markRunPaid).toHaveBeenCalledWith('biz_1', 'run_1', {
      paymentAccountId: 'fa_1',
      paymentMethod: 'bank_transfer',
      actorId: 'u_member',
    });
  });

  it('PA-05 KEY: posts as KEY\'s system actor for the member the turn runs for', async () => {
    const markRunPaid = vi.fn(async () => ({ id: 'run_1', status: 'PAID' }));
    const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
      getPayroll: () => ({ markRunPaid }),
    });
    const result = await (orchestrator as any).executeToolAction(
      'biz_1',
      'payroll_mark_paid',
      { runId: 'run_1', paymentMethod: 'cash', actorId: 'forged' },
      { surface: 'CHAT', principalUserId: 'u_admin' },
    );
    expect(result).toEqual({ id: 'run_1', status: 'PAID' });
    expect(markRunPaid).toHaveBeenCalledWith('biz_1', 'run_1', {
      paymentAccountId: undefined,
      paymentMethod: 'cash',
      actorId: KEY_SYSTEM_ACTOR_ID,
      initiatedBy: 'u_admin',
    });
  });

  it('PA-06 finance_post_journal_entry points at the General Journal page', () => {
    expect(tool('finance_post_journal_entry').manualEquivalentRoute).toBe('/app/finance/journal');
  });
});
