/**
 * P44 — TOF-FINANCE-CANONICAL-TOOLS (owner rulings D-57, D-104, D-135, D-141, D-145):
 * Registers the three forward-looking canonical finance intelligence tools in
 * FLOW_TOOLS, routes each to its domain owner service, gates each under
 * CANONICAL_MODULE_TOOLS.revenue (`read`) + KEY_BOOKS_MEMBERSHIP_READ_TOOLS
 * (FinanceController.ensureAccess, D-104), and keeps all three off memberless
 * KEY surfaces.
 */
import { describe, expect, it, vi } from 'vitest';
import { FLOW_TOOLS, getToolByName } from './flow-tool-registry';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { MEMBERLESS_KEY_TOOLS } from './memberless-key-tools';
import { keyMemberMenuScopes, keyMemberToolScopes } from './plan-step-authority';
import { KEY_BOOKS_MEMBERSHIP_READ_TOOLS } from './graph-actions.controller';
import { CANONICAL_MODULE_TOOLS } from '../structure/job-role-policy.service';
import { SafeToSpendService } from '../finance/safe-to-spend.service';
import { CashflowForecastService } from '../finance/cashflow-forecast.service';
import { MoneyMovesService } from '../finance/money-moves.service';

const BIZ = 'biz_fin_intel';
const CANONICAL_FINANCE_INTEL_TOOLS = [
  'finance_safe_to_spend',
  'finance_cashflow_forecast',
  'finance_money_moves',
] as const;

const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

function makeOrchestrator(members: Record<string, { role: string; permissionScopes?: unknown } | null>, superAdmins: string[] = []) {
  const safeToSpend = {
    calculate: vi.fn(async (businessId: string) => ({
      businessId,
      cashBalance: 12000,
      taxReserved: 1500,
      billsDueNext30Days: 2000,
      operatingBuffer: 3000,
      otherReserves: 500,
      safeToSpend: 5000,
      currency: 'TTD',
      explanation: ['Ledger cash position minus reserves'],
    })),
  };
  const cashflowForecast = {
    forecast: vi.fn(async (businessId: string, horizonDays: number) => ({
      businessId,
      horizonDays,
      currency: 'TTD',
      openingCash: 12000,
      projectedClosingCash: 14500,
      lowestProjectedCash: 9800,
      dangerDates: [],
      scenarios: { expected: [], conservative: [], optimistic: [] },
      inflows: [],
      outflows: [],
      recommendations: [],
    })),
  };
  const moneyMoves = {
    generate: vi.fn(async (businessId: string) => [
      {
        id: `mm-collect-${businessId}`,
        type: 'COLLECT_RECEIVABLE',
        title: 'Collect 2 overdue invoices',
        summary: 'Chasing these invoices could add TTD 1500.00 to cash.',
        expectedImpact: 1500,
        currency: 'TTD',
        confidence: 75,
        riskTier: 1,
        effort: 'LOW',
        timeToImpactDays: 7,
        linkedEntities: [],
        recommendedActions: [],
      },
    ]),
  };

  const prisma = {
    client: {
      membership: {
        findUnique: vi.fn(async ({ where }: any) => {
          const m = members[where.userId_businessId.userId];
          return m ? { role: m.role, permissionScopes: m.permissionScopes ?? null } : null;
        }),
      },
      user: {
        findUnique: vi.fn(async ({ where }: any) => ({
          role: superAdmins.includes(where.id) ? 'SUPER_ADMIN' : 'USER',
        })),
      },
    },
  };

  const svc = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: quiet,
    prisma,
    governance: { getToolTier: () => 1 },
    executionLog: { logToolExecution: async () => 'log_1' },
    businessGraph: { invalidateCache() {} },
    attributeExecutionLog: async () => undefined,
    moduleRef: {
      get: (token: unknown) => {
        if (token === SafeToSpendService) return safeToSpend;
        if (token === CashflowForecastService) return cashflowForecast;
        if (token === MoneyMovesService) return moneyMoves;
        throw new Error(`Unexpected token: ${String(token)}`);
      },
    },
  }) as FlowOrchestratorService;

  return { svc, safeToSpend, cashflowForecast, moneyMoves };
}

function executeRaw(svc: FlowOrchestratorService, tool: string, args: Record<string, unknown> = {}) {
  return (svc as unknown as {
    executeToolAction: (b: string, t: string, a: Record<string, unknown>) => Promise<unknown>;
  }).executeToolAction(BIZ, tool, args);
}

function executeAsMember(
  svc: FlowOrchestratorService,
  tool: string,
  opts: { surface: 'CHAT' | 'BACKGROUND_SWEEP'; principalUserId?: string; args?: Record<string, unknown> },
) {
  return (svc as unknown as {
    executeToolDirectly: (
      b: string,
      t: string,
      a: Record<string, unknown>,
      envelope?: unknown,
      ctx?: { surface?: string; principalUserId?: string },
    ) => Promise<unknown>;
  }).executeToolDirectly(BIZ, tool, opts.args ?? {}, undefined, {
    surface: opts.surface,
    principalUserId: opts.principalUserId,
  });
}

describe('P44 (TOF-FINANCE-CANONICAL-TOOLS): canonical finance intelligence tools', () => {
  it.each(CANONICAL_FINANCE_INTEL_TOOLS)(
    '%s is registered as a low-risk canonical read capability',
    (name) => {
      const tool = FLOW_TOOLS.find((candidate) => candidate.name === name);
      expect(tool).toBeDefined();
      expect(getToolByName(name)).toBe(tool);
      expect(tool?.family).toBe('read');
      expect(tool?.riskLevel).toBe('low');
      expect(tool?.riskTier).toBe(1);
      expect(tool?.manualEquivalentRoute).toBe('/app/finance');
    },
  );

  it('keeps historical cashflow and forward forecast as distinct capabilities', () => {
    const historical = FLOW_TOOLS.find((tool) => tool.name === 'finance_cashflow');
    const forecast = FLOW_TOOLS.find((tool) => tool.name === 'finance_cashflow_forecast');

    expect(historical).toBeDefined();
    expect(forecast).toBeDefined();
    expect(historical?.parameters.required).toEqual(expect.arrayContaining(['from', 'to']));
    expect(forecast?.parameters.required).toEqual([]);
    expect(forecast?.description.toLowerCase()).toContain('projection');
  });

  it('does not describe money-move recommendations as execution authority', () => {
    const tool = FLOW_TOOLS.find((candidate) => candidate.name === 'finance_money_moves');
    expect(tool).toBeDefined();
    expect(tool?.description.toLowerCase()).toContain('not execution authority');
  });

  it('routes each canonical finance intelligence tool to its domain owner service and validates horizonDays', async () => {
    const { svc, safeToSpend, cashflowForecast, moneyMoves } = makeOrchestrator({});

    const sts = await executeRaw(svc, 'finance_safe_to_spend');
    expect(safeToSpend.calculate).toHaveBeenCalledWith(BIZ);
    expect(sts).toMatchObject({ safeToSpend: 5000, currency: 'TTD' });

    const fcDefault = await executeRaw(svc, 'finance_cashflow_forecast');
    expect(cashflowForecast.forecast).toHaveBeenCalledWith(BIZ, 90);
    expect(fcDefault).toMatchObject({ horizonDays: 90, projectedClosingCash: 14500 });

    const fcCustom = await executeRaw(svc, 'finance_cashflow_forecast', { horizonDays: 30.9 });
    expect(cashflowForecast.forecast).toHaveBeenLastCalledWith(BIZ, 30);
    expect(fcCustom).toMatchObject({ horizonDays: 30 });

    cashflowForecast.forecast.mockClear();
    for (const bad of [0, -10, 366, 'soon', '', '   ', true, false, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(executeRaw(svc, 'finance_cashflow_forecast', { horizonDays: bad })).rejects.toThrow(
        /horizonDays must be between 1 and 365/,
      );
    }
    expect(cashflowForecast.forecast).not.toHaveBeenCalled();

    const mm = await executeRaw(svc, 'finance_money_moves');
    expect(moneyMoves.generate).toHaveBeenCalledWith(BIZ);
    expect(mm).toMatchObject({
      moves: [expect.objectContaining({ id: `mm-collect-${BIZ}`, type: 'COLLECT_RECEIVABLE' })],
    });
  });

  it('rejects boolean, empty, non-finite, and out-of-range horizonDays on real executeToolDirectly dispatch (validateToolInput) while stripping strict-mode null on optional horizonDays', async () => {
    const { svc, cashflowForecast } = makeOrchestrator({
      revRead: { role: 'STAFF', permissionScopes: { revenue: 'read' } },
    });

    for (const badType of [true, false, '', '   ', 'soon', Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        executeAsMember(svc, 'finance_cashflow_forecast', {
          surface: 'CHAT',
          principalUserId: 'revRead',
          args: { horizonDays: badType },
        }),
      ).rejects.toThrow(/Field "horizonDays" for finance_cashflow_forecast must be a number/);
    }
    for (const outOfRange of [0, -10, 366]) {
      await expect(
        executeAsMember(svc, 'finance_cashflow_forecast', {
          surface: 'CHAT',
          principalUserId: 'revRead',
          args: { horizonDays: outOfRange },
        }),
      ).rejects.toThrow(/horizonDays must be between 1 and 365/);
    }
    expect(cashflowForecast.forecast).not.toHaveBeenCalled();

    // RR-STRICT-TOOL-SCHEMAS (D-261/D-262): OpenAI strict mode encodes optional
    // fields as nullable, so validateToolInput strips null on optional horizonDays
    // and the handler applies its default 90-day horizon.
    await expect(
      executeAsMember(svc, 'finance_cashflow_forecast', {
        surface: 'CHAT',
        principalUserId: 'revRead',
        args: { horizonDays: null },
      }),
    ).resolves.toMatchObject({ horizonDays: 90 });

    await expect(
      executeAsMember(svc, 'finance_cashflow_forecast', {
        surface: 'CHAT',
        principalUserId: 'revRead',
        args: { horizonDays: '45' },
      }),
    ).resolves.toMatchObject({ horizonDays: 45 });
    expect(cashflowForecast.forecast).toHaveBeenCalledWith(BIZ, 45);
  });

  it('gates all three under CANONICAL_MODULE_TOOLS.revenue read, KEY_BOOKS_MEMBERSHIP_READ_TOOLS (D-104), and excludes them from memberless turns', async () => {
    for (const name of CANONICAL_FINANCE_INTEL_TOOLS) {
      expect(CANONICAL_MODULE_TOOLS.revenue[name]).toBe('read');
      expect(keyMemberToolScopes(name)).toEqual([{ module: 'revenue', minLevel: 'read' }]);
      expect(keyMemberMenuScopes(name)).toEqual([{ module: 'revenue', minLevel: 'read' }]);
      expect(KEY_BOOKS_MEMBERSHIP_READ_TOOLS.has(name)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(MEMBERLESS_KEY_TOOLS, name)).toBe(false);
    }

    const { svc, safeToSpend, cashflowForecast, moneyMoves } = makeOrchestrator(
      {
        crmOnly: { role: 'STAFF', permissionScopes: { crm: 'read' } },
        revRead: { role: 'STAFF', permissionScopes: { revenue: 'read' } },
        saOutsider: null,
        saMember: { role: 'STAFF', permissionScopes: { revenue: 'read' } },
      },
      ['saOutsider', 'saMember'],
    );

    // Revenue-none member is refused every tool before any domain service runs.
    for (const name of CANONICAL_FINANCE_INTEL_TOOLS) {
      await expect(
        executeAsMember(svc, name, { surface: 'CHAT', principalUserId: 'crmOnly' }),
      ).rejects.toThrow(/revenue requires read access/);
    }
    expect(safeToSpend.calculate).not.toHaveBeenCalled();
    expect(cashflowForecast.forecast).not.toHaveBeenCalled();
    expect(moneyMoves.generate).not.toHaveBeenCalled();

    // Non-member platform SUPER_ADMIN is refused (FinanceController.ensureAccess, D-104).
    for (const name of CANONICAL_FINANCE_INTEL_TOOLS) {
      await expect(
        executeAsMember(svc, name, { surface: 'CHAT', principalUserId: 'saOutsider' }),
      ).rejects.toThrow(/No access to this business/);
    }
    expect(safeToSpend.calculate).not.toHaveBeenCalled();
    expect(cashflowForecast.forecast).not.toHaveBeenCalled();
    expect(moneyMoves.generate).not.toHaveBeenCalled();

    // Memberless surface is refused every tool before any domain service runs.
    for (const name of CANONICAL_FINANCE_INTEL_TOOLS) {
      await expect(
        executeAsMember(svc, name, { surface: 'BACKGROUND_SWEEP' }),
      ).rejects.toThrow();
    }
    expect(safeToSpend.calculate).not.toHaveBeenCalled();
    expect(cashflowForecast.forecast).not.toHaveBeenCalled();
    expect(moneyMoves.generate).not.toHaveBeenCalled();

    // Revenue-read member and member SUPER_ADMIN succeed.
    await expect(
      executeAsMember(svc, 'finance_safe_to_spend', { surface: 'CHAT', principalUserId: 'revRead' }),
    ).resolves.toMatchObject({ safeToSpend: 5000 });
    await expect(
      executeAsMember(svc, 'finance_cashflow_forecast', { surface: 'CHAT', principalUserId: 'revRead' }),
    ).resolves.toMatchObject({ horizonDays: 90 });
    await expect(
      executeAsMember(svc, 'finance_money_moves', { surface: 'CHAT', principalUserId: 'saMember' }),
    ).resolves.toMatchObject({ moves: [expect.objectContaining({ type: 'COLLECT_RECEIVABLE' })] });
  });
});
