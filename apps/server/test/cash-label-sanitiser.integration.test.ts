/**
 * V1-91 (`FU-CASH-LABEL-SANITISER`, P138, Journey H, D-135) — real-Postgres
 * integration proof that ONE shared code-only currency label sanitiser governs
 * every structured `otherCurrencyCash` list across the server:
 *
 *   - `otherCurrencyCash(position)` (`CashPositionService`)
 *   - `SafeToSpendService.calculate` (structured list + explanation)
 *   - `FinanceOverviewService.getOverview` (computed + cached read)
 *   - `CashflowForecastService.forecast`
 *   - `OsService.getCommandCenter` (`flows.financial.otherCurrencyCash`)
 *   - KEY tools `finance.calculateSafeToSpend` and `finance.cashflowForecast`
 *   - `AiAdvisorService.predictCashFlow` (`otherCurrencyCash` + `otherCurrencyCashNotListed`)
 *
 * Contract:
 *   CLS-01  Valid 3-letter ASCII alphabetic ISO codes (`^[A-Z]{3}$` after
 *           trim+uppercase, e.g. `' usd '` -> `'USD'`, `'EUR'`) are returned
 *           as uppercase 3-letter codes sorted alphabetically with exact
 *           cent-rounded amounts. Any non-code free-text label (`"US Dollars"`,
 *           `"<script>alert(1)</script>"`, `"US$"`) is NEVER echoed and is
 *           aggregated into a single generic `UNCODED` bucket whose `amount`
 *           is the exact cent-safe sum (`250.25`) and whose `count` records
 *           the number of non-code currency entries (`3`).
 *   CLS-02  `SafeToSpendService.calculate` and KEY tool `finance.calculateSafeToSpend`
 *           return the exact sanitized `otherCurrencyCash`, keep `cashBalance`
 *           in TTD only (`1000`), and never echo any non-code label in the DTO
 *           or `explanation`.
 *   CLS-03  `FinanceOverviewService.getOverview` returns the exact sanitized
 *           `otherCurrencyCash`, invalidates any stale cached entry carrying
 *           raw free-text labels, and serves the sanitized list on cache hit.
 *   CLS-04  `CashflowForecastService.forecast` and KEY tool `finance.cashflowForecast`
 *           return the exact sanitized `otherCurrencyCash`, open at TTD `1000`,
 *           and never echo any non-code label.
 *   CLS-05  `OsService.getCommandCenter` returns the exact sanitized
 *           `flows.financial.otherCurrencyCash`, and `AiAdvisorService.predictCashFlow`
 *           lists only coded currencies while counting all `3` uncoded entries
 *           in `otherCurrencyCashNotListed`.
 *   CLS-06  Cross-tenant isolation & edge shapes: a second tenant holding only
 *           non-code free-text accounts (`"Trinidad Dollars"` + `"Cash Box"`)
 *           gets `[{ currency: 'UNCODED', amount: 100, count: 2 }]` with zero
 *           leakage from tenant A; a third tenant holding only valid 3-letter
 *           ISO codes (`GBP`, `USD`) gets no `UNCODED` entry and no `count`
 *           property on coded entries.
 *
 * Fixture prefix: `v91j_` (registered in `apps/server/test/helpers/fixture-prefixes.json`,
 * cleaned up via raw SQL using `sqlLikePrefix(P)`).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v91j_';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  ownerC: `${P}ownerC`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizC: `${P}bizC`,
};

const RAW_LEAK_A = /US DOLLARS|<script>|alert\(1\)|US\$/i;
const RAW_LEAK_B = /TRINIDAD DOLLARS|CASH BOX/i;
const EXPECTED_OTHER_A = [
  { currency: 'EUR', amount: 120.5 },
  { currency: 'USD', amount: 500 },
  { currency: 'UNCODED', amount: 250.25, count: 3 },
];
const EXPECTED_OTHER_B = [
  { currency: 'UNCODED', amount: 100, count: 2 },
];
const EXPECTED_OTHER_C = [
  { currency: 'GBP', amount: 75 },
  { currency: 'USD', amount: 250 },
];

let db: typeof import('@keyflow/db').db;
let CashPositionService: typeof import('../src/modules/finance/cash-position.service').CashPositionService;
let otherCurrencyCash: typeof import('../src/modules/finance/cash-position.service').otherCurrencyCash;
let SafeToSpendService: typeof import('../src/modules/finance/safe-to-spend.service').SafeToSpendService;
let FinanceOverviewService: typeof import('../src/modules/finance/finance-overview.service').FinanceOverviewService;
let CashflowForecastService: typeof import('../src/modules/finance/cashflow-forecast.service').CashflowForecastService;
let ChartOfAccountsSeederService: typeof import('../src/modules/finance/chart-of-accounts-seeder.service').ChartOfAccountsSeederService;
let OsService: typeof import('../src/modules/os/os.service').OsService;
let FlowOrchestratorService: typeof import('../src/modules/ai/flow-orchestrator.service').FlowOrchestratorService;
let AiAdvisorService: typeof import('../src/modules/ai/ai-advisor.service').AiAdvisorService;

let cashPosition: InstanceType<typeof CashPositionService>;
let safeToSpend: InstanceType<typeof SafeToSpendService>;
let financeOverview: InstanceType<typeof FinanceOverviewService>;
let cashflowForecast: InstanceType<typeof CashflowForecastService>;
let osService: InstanceType<typeof OsService>;
let flowOrchestrator: InstanceType<typeof FlowOrchestratorService>;
let aiAdvisor: InstanceType<typeof AiAdvisorService>;
let redisStore: Map<string, unknown>;

async function cleanup() {
  await db.$executeRawUnsafe(`DELETE FROM revenue_actions WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(
    `DELETE FROM ledger_entries WHERE transaction_id IN (SELECT id FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)})`,
  );
  await db.$executeRawUnsafe(`DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`);
}

describe('V1-91 (FU-CASH-LABEL-SANITISER): shared code-only currency sanitiser across structured otherCurrencyCash lists', () => {
  beforeAll(async () => {
    ({ db } = await import('@keyflow/db'));
    ({ CashPositionService, otherCurrencyCash } = await import('../src/modules/finance/cash-position.service'));
    ({ SafeToSpendService } = await import('../src/modules/finance/safe-to-spend.service'));
    ({ FinanceOverviewService } = await import('../src/modules/finance/finance-overview.service'));
    ({ CashflowForecastService } = await import('../src/modules/finance/cashflow-forecast.service'));
    ({ ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service'));
    ({ OsService } = await import('../src/modules/os/os.service'));
    ({ FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service'));
    ({ AiAdvisorService } = await import('../src/modules/ai/ai-advisor.service'));

    await cleanup();

    await db.user.createMany({
      data: [
        { id: ID.ownerA, email: `${P}owner_a@test.local`, name: 'v91j Owner A', role: 'USER' },
        { id: ID.ownerB, email: `${P}owner_b@test.local`, name: 'v91j Owner B', role: 'USER' },
        { id: ID.ownerC, email: `${P}owner_c@test.local`, name: 'v91j Owner C', role: 'USER' },
      ],
    });

    await db.business.createMany({
      data: [
        { id: ID.bizA, name: 'v91j Biz A', slug: `${P}biza`, ownerId: ID.ownerA, currency: 'TTD' },
        { id: ID.bizB, name: 'v91j Biz B', slug: `${P}bizb`, ownerId: ID.ownerB, currency: 'TTD' },
        { id: ID.bizC, name: 'v91j Biz C', slug: `${P}bizc`, ownerId: ID.ownerC, currency: 'TTD' },
      ],
    });

    await db.membership.createMany({
      data: [
        { id: `${P}m_a`, businessId: ID.bizA, userId: ID.ownerA, role: 'OWNER' },
        { id: `${P}m_b`, businessId: ID.bizB, userId: ID.ownerB, role: 'OWNER' },
        { id: `${P}m_c`, businessId: ID.bizC, userId: ID.ownerC, role: 'OWNER' },
      ],
    });

    const prismaStub = { client: db } as any;
    const coaSeeder = new ChartOfAccountsSeederService(prismaStub);
    await coaSeeder.ensureDefaults(ID.bizA);
    await coaSeeder.ensureDefaults(ID.bizB);
    await coaSeeder.ensureDefaults(ID.bizC);

    const bankId = async (bizId: string, key: string) => {
      const row = await coaSeeder.getBySystemKey(bizId, key);
      if (!row) throw new Error(`Missing ${key} COA for ${bizId}`);
      return row.id;
    };

    const [cashA, bankA, cashB, bankB, cashC, bankC] = await Promise.all([
      bankId(ID.bizA, 'CASH'),
      bankId(ID.bizA, 'BANK'),
      bankId(ID.bizB, 'CASH'),
      bankId(ID.bizB, 'BANK'),
      bankId(ID.bizC, 'CASH'),
      bankId(ID.bizC, 'BANK'),
    ]);

    // Biz A: TTD 1000 + valid USD (' usd ') 500 + valid EUR 120.50 + 3 non-code free-text accounts summing to 250.25.
    await db.financialAccount.createMany({
      data: [
        {
          id: `${P}acc_a_ttd`,
          businessId: ID.bizA,
          chartOfAccountId: cashA,
          name: 'v91j Main TTD Till',
          type: 'CASH',
          currency: 'TTD',
          openingBalance: 1000,
          currentBalance: 1000,
          isActive: true,
        },
        {
          id: `${P}acc_a_usd`,
          businessId: ID.bizA,
          chartOfAccountId: bankA,
          name: 'v91j Valid USD Bank',
          type: 'BANK',
          currency: ' usd ',
          openingBalance: 500,
          currentBalance: 500,
          isActive: true,
        },
        {
          id: `${P}acc_a_eur`,
          businessId: ID.bizA,
          chartOfAccountId: bankA,
          name: 'v91j Valid EUR Bank',
          type: 'BANK',
          currency: 'EUR',
          openingBalance: 120.5,
          currentBalance: 120.5,
          isActive: true,
        },
        {
          id: `${P}acc_a_free1`,
          businessId: ID.bizA,
          chartOfAccountId: bankA,
          name: 'v91j Legacy Account 1',
          type: 'BANK',
          currency: 'US Dollars',
          openingBalance: 125.1,
          currentBalance: 125.1,
          isActive: true,
        },
        {
          id: `${P}acc_a_free2`,
          businessId: ID.bizA,
          chartOfAccountId: bankA,
          name: 'v91j Legacy Account 2',
          type: 'BANK',
          currency: '<script>alert(1)</script>',
          openingBalance: 74.9,
          currentBalance: 74.9,
          isActive: true,
        },
        {
          id: `${P}acc_a_free3`,
          businessId: ID.bizA,
          chartOfAccountId: bankA,
          name: 'v91j Legacy Account 3',
          type: 'BANK',
          currency: 'US$',
          openingBalance: 50.25,
          currentBalance: 50.25,
          isActive: true,
        },
      ],
    });

    // Biz B: TTD 300 + 2 non-code free-text accounts summing to 100.00 (cross-tenant control).
    await db.financialAccount.createMany({
      data: [
        {
          id: `${P}acc_b_ttd`,
          businessId: ID.bizB,
          chartOfAccountId: cashB,
          name: 'v91j BizB Till',
          type: 'CASH',
          currency: 'TTD',
          openingBalance: 300,
          currentBalance: 300,
          isActive: true,
        },
        {
          id: `${P}acc_b_free1`,
          businessId: ID.bizB,
          chartOfAccountId: bankB,
          name: 'v91j BizB Legacy 1',
          type: 'BANK',
          currency: 'Trinidad Dollars',
          openingBalance: 88.4,
          currentBalance: 88.4,
          isActive: true,
        },
        {
          id: `${P}acc_b_free2`,
          businessId: ID.bizB,
          chartOfAccountId: bankB,
          name: 'v91j BizB Legacy 2',
          type: 'BANK',
          currency: 'Cash Box',
          openingBalance: 11.6,
          currentBalance: 11.6,
          isActive: true,
        },
      ],
    });

    // Biz C: TTD 400 + only valid 3-letter ISO codes (USD 250, GBP 75).
    await db.financialAccount.createMany({
      data: [
        {
          id: `${P}acc_c_ttd`,
          businessId: ID.bizC,
          chartOfAccountId: cashC,
          name: 'v91j BizC Till',
          type: 'CASH',
          currency: 'TTD',
          openingBalance: 400,
          currentBalance: 400,
          isActive: true,
        },
        {
          id: `${P}acc_c_usd`,
          businessId: ID.bizC,
          chartOfAccountId: bankC,
          name: 'v91j BizC USD Bank',
          type: 'BANK',
          currency: 'USD',
          openingBalance: 250,
          currentBalance: 250,
          isActive: true,
        },
        {
          id: `${P}acc_c_gbp`,
          businessId: ID.bizC,
          chartOfAccountId: bankC,
          name: 'v91j BizC GBP Bank',
          type: 'BANK',
          currency: 'GBP',
          openingBalance: 75,
          currentBalance: 75,
          isActive: true,
        },
      ],
    });

    redisStore = new Map<string, unknown>();
    const redisStub = {
      getJson: async <T>(key: string): Promise<T | null> => (redisStore.get(key) as T) ?? null,
      setJson: async (key: string, val: unknown): Promise<void> => {
        redisStore.set(key, val);
      },
      del: async (key: string): Promise<void> => {
        redisStore.delete(key);
      },
    } as any;

    cashPosition = new CashPositionService(prismaStub);
    safeToSpend = new SafeToSpendService(prismaStub, coaSeeder, cashPosition);
    financeOverview = new FinanceOverviewService(prismaStub, null, null, redisStub, cashPosition);
    cashflowForecast = new CashflowForecastService(prismaStub, cashPosition);
    osService = new OsService(
      prismaStub,
      {
        summary: async () => ({ open: 0, waitingApproval: 0, executableByKey: 0, byCategory: [] }),
      } as any,
      cashPosition,
    );
    flowOrchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
      prisma: prismaStub,
      governance: { getToolTier: () => 1 },
      executionLog: { logToolExecution: async () => 'log' },
      businessGraph: { invalidateCache() {} },
      attributeExecutionLog: async () => undefined,
      moduleRef: {
        get: (tok: unknown) =>
          tok === SafeToSpendService
            ? safeToSpend
            : tok === CashflowForecastService
              ? cashflowForecast
              : undefined,
      },
    }) as FlowOrchestratorService;
    aiAdvisor = new AiAdvisorService(prismaStub, {} as any, {} as any, {} as any, cashPosition);
  }, 60_000);

  afterAll(async () => {
    await cleanup();
  }, 60_000);

  it('[CLS-01] CashPositionService + otherCurrencyCash aggregates all non-code labels into one UNCODED bucket with exact sum and count while preserving valid 3-letter ISO codes', async () => {
    const position = await cashPosition.getCashPosition(ID.bizA);
    expect(position.currency).toBe('TTD');
    expect(position.cashBalance).toBe(1000);

    const other = otherCurrencyCash(position);
    expect(other).toEqual(EXPECTED_OTHER_A);
    expect(JSON.stringify(other)).not.toMatch(RAW_LEAK_A);
  });

  it('[CLS-02] SafeToSpendService and canonical KEY tool finance_safe_to_spend never echo non-code labels in otherCurrencyCash or explanation', async () => {
    const dto = await safeToSpend.calculate(ID.bizA);
    expect(dto.currency).toBe('TTD');
    expect(dto.cashBalance).toBe(1000);
    expect(dto.otherCurrencyCash).toEqual(EXPECTED_OTHER_A);
    expect(JSON.stringify(dto)).not.toMatch(RAW_LEAK_A);

    const toolData: any = await flowOrchestrator.executeToolAction(ID.bizA, 'finance_safe_to_spend', {});
    expect(toolData.cashBalance).toBe(1000);
    expect(toolData.otherCurrencyCash).toEqual(EXPECTED_OTHER_A);
    expect(JSON.stringify(toolData)).not.toMatch(RAW_LEAK_A);
  });

  it('[CLS-03] FinanceOverviewService returns sanitized otherCurrencyCash, invalidates stale cached raw labels, and serves sanitized list on cache hit', async () => {
    // Seed a stale cache entry mimicking a pre-sanitiser payload carrying raw free text.
    redisStore.set(`finance:overview:${ID.bizA}`, {
      cashBalance: 1000,
      cashBasis: 'ledger',
      cashCurrency: 'TTD',
      currency: 'TTD',
      otherCurrencyCash: [
        { currency: '<SCRIPT>ALERT(1)</SCRIPT>', amount: 74.9 },
        { currency: 'EUR', amount: 120.5 },
        { currency: 'US DOLLARS', amount: 125.1 },
        { currency: 'US$', amount: 50.25 },
        { currency: 'USD', amount: 500 },
      ],
      cashAccountCount: 6,
      revenueThisMonth: 0,
      expensesThisMonth: 0,
      netProfitThisMonth: 0,
      outstandingInvoices: 0,
      outstandingInvoiceCount: 0,
      overdueInvoices: 0,
      overdueInvoiceCount: 0,
      billsDue: 0,
      billsDueCount: 0,
      taxReserved: 0,
      cashRunwayMonths: null,
      pendingActionCount: 0,
      actions: [],
    });

    const fresh = await financeOverview.getOverview(ID.bizA, null);
    expect(fresh.cashBalance).toBe(1000);
    expect(fresh.cashCurrency).toBe('TTD');
    expect(fresh.otherCurrencyCash).toEqual(EXPECTED_OTHER_A);
    expect(JSON.stringify(fresh)).not.toMatch(RAW_LEAK_A);

    // Second read hits cache and still serves the sanitized payload.
    const cached = await financeOverview.getOverview(ID.bizA, null);
    expect(cached.otherCurrencyCash).toEqual(EXPECTED_OTHER_A);
    expect(JSON.stringify(cached)).not.toMatch(RAW_LEAK_A);
  });

  it('[CLS-04] CashflowForecastService and canonical KEY tool finance_cashflow_forecast return sanitized otherCurrencyCash without echoing non-code labels', async () => {
    const forecast = await cashflowForecast.forecast(ID.bizA, 90);
    expect(forecast.currency).toBe('TTD');
    expect(forecast.openingCash).toBe(1000);
    expect(forecast.otherCurrencyCash).toEqual(EXPECTED_OTHER_A);
    expect(JSON.stringify(forecast)).not.toMatch(RAW_LEAK_A);

    const toolData: any = await flowOrchestrator.executeToolAction(ID.bizA, 'finance_cashflow_forecast', { horizonDays: 90 });
    expect(toolData.openingCash).toBe(1000);
    expect(toolData.otherCurrencyCash).toEqual(EXPECTED_OTHER_A);
    expect(JSON.stringify(toolData)).not.toMatch(RAW_LEAK_A);
  });

  it('[CLS-05] OsService command center and AiAdvisorService.predictCashFlow never echo non-code labels and preserve exact uncoded count', async () => {
    const cc = await osService.getCommandCenter(ID.bizA);
    expect(cc.flows.financial.cashBalance).toBe(1000);
    expect(cc.flows.financial.otherCurrencyCash).toEqual(EXPECTED_OTHER_A);
    expect(JSON.stringify(cc)).not.toMatch(RAW_LEAK_A);

    const predicted: any = await aiAdvisor.predictCashFlow(ID.bizA, 30);
    expect(predicted.currentBalance).toBe(1000);
    expect(predicted.currency).toBe('TTD');
    expect(predicted.otherCurrencyCash).toEqual([
      { currency: 'EUR', amount: 120.5 },
      { currency: 'USD', amount: 500 },
    ]);
    expect(predicted.otherCurrencyCashNotListed).toBe(3);
    expect(JSON.stringify(predicted)).not.toMatch(RAW_LEAK_A);
  });

  it('[CLS-06] Cross-tenant isolation and pure-uncoded / pure-coded shapes hold across all structured surfaces', async () => {
    // Biz B: pure non-code free text only -> single UNCODED bucket summing 88.40 + 11.60 = 100, count 2.
    const [posB, stsB, ovB, fcB, osB] = await Promise.all([
      cashPosition.getCashPosition(ID.bizB),
      safeToSpend.calculate(ID.bizB),
      financeOverview.getOverview(ID.bizB, null),
      cashflowForecast.forecast(ID.bizB, 30),
      osService.getCommandCenter(ID.bizB),
    ]);

    expect(posB.cashBalance).toBe(300);
    expect(otherCurrencyCash(posB)).toEqual(EXPECTED_OTHER_B);
    expect(stsB.otherCurrencyCash).toEqual(EXPECTED_OTHER_B);
    expect(ovB.otherCurrencyCash).toEqual(EXPECTED_OTHER_B);
    expect(fcB.otherCurrencyCash).toEqual(EXPECTED_OTHER_B);
    expect(osB.flows.financial.otherCurrencyCash).toEqual(EXPECTED_OTHER_B);

    for (const payload of [stsB, ovB, fcB, osB]) {
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toMatch(RAW_LEAK_B);
      expect(serialized).not.toMatch(RAW_LEAK_A);
      expect(serialized).not.toContain('250.25');
    }

    // Biz C: only valid 3-letter ISO codes -> no UNCODED bucket and no count property.
    const [posC, stsC, ovC, fcC, osC] = await Promise.all([
      cashPosition.getCashPosition(ID.bizC),
      safeToSpend.calculate(ID.bizC),
      financeOverview.getOverview(ID.bizC, null),
      cashflowForecast.forecast(ID.bizC, 30),
      osService.getCommandCenter(ID.bizC),
    ]);

    expect(posC.cashBalance).toBe(400);
    expect(otherCurrencyCash(posC)).toEqual(EXPECTED_OTHER_C);
    expect(stsC.otherCurrencyCash).toEqual(EXPECTED_OTHER_C);
    expect(ovC.otherCurrencyCash).toEqual(EXPECTED_OTHER_C);
    expect(fcC.otherCurrencyCash).toEqual(EXPECTED_OTHER_C);
    expect(osC.flows.financial.otherCurrencyCash).toEqual(EXPECTED_OTHER_C);
    expect(otherCurrencyCash(posC).every((entry) => !('count' in entry))).toBe(true);
  });
});
