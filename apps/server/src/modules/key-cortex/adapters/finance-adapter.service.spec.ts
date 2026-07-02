import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinanceAdapterService } from './finance-adapter.service';
import { ExpensesService } from '../../expenses/expenses.service';
import { FinanceOverviewService } from '../../finance/finance-overview.service';
import { FinanceAccountsService } from '../../finance/finance-accounts.service';
import { LedgerReportingService } from '../../reports/ledger-reporting.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ConnectorCommand } from '../key-cortex-connector.types';

const mkCmd = (action: string, parameters: Record<string, unknown> = {}): ConnectorCommand => ({
  module: 'finance',
  action,
  parameters,
  businessId: 'biz_123',
  userId: 'user_456',
  source: 'key_cortex',
  timestamp: new Date(),
  correlationId: 'corr_001',
});

describe('FinanceAdapterService', () => {
  let service: FinanceAdapterService;
  let expenses: ExpensesService;
  let overview: FinanceOverviewService;
  let accounts: FinanceAccountsService;
  let ledger: LedgerReportingService;
  let prisma: PrismaService;

  beforeEach(() => {
    expenses = {
      createExpense: vi.fn(),
      upsertBudget: vi.fn(),
      voidExpense: vi.fn(),
      updateExpense: vi.fn(),
    } as unknown as ExpensesService;

    overview = { getOverview: vi.fn() } as unknown as FinanceOverviewService;
    accounts = { list: vi.fn() } as unknown as FinanceAccountsService;

    ledger = {
      getPnl: vi.fn(),
      getCashflow: vi.fn(),
      getBalanceSheet: vi.fn(),
    } as unknown as LedgerReportingService;

    prisma = {
      client: {
        expenseBudget: { findFirst: vi.fn() },
      },
    } as unknown as PrismaService;

    service = new FinanceAdapterService(expenses, overview, accounts, ledger, prisma);
  });

  it('record_expense delegates to createExpense', async () => {
    (expenses.createExpense as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'exp_1' });
    const result = await service.execute(mkCmd('record_expense', { description: 'Coffee', amount: 25, category: 'cat_1' }));
    expect(result.success).toBe(true);
    expect(expenses.createExpense).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz_123',
      description: 'Coffee',
      amount: 25,
      categoryId: 'cat_1',
    }));
    expect(result.data).toEqual({ id: 'exp_1' });
  });

  it('create_budget delegates to upsertBudget', async () => {
    (expenses.upsertBudget as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'bud_1' });
    const result = await service.execute(mkCmd('create_budget', {
      category: 'cat_1',
      amount: 500,
      period: 'monthly',
      startDate: '2026-06-01',
    }));
    expect(result.success).toBe(true);
    expect(expenses.upsertBudget).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz_123',
      categoryId: 'cat_1',
      amount: 500,
      month: 6,
      year: 2026,
    }));
  });

  it('update_budget fetches budget and re-upserts', async () => {
    (prisma.client.expenseBudget.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'bud_1',
      businessId: 'biz_123',
      categoryId: 'cat_1',
      amount: 500,
      month: 6,
      year: 2026,
    });
    (expenses.upsertBudget as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'bud_1', amount: 700 });
    const result = await service.execute(mkCmd('update_budget', { budgetId: 'bud_1', amount: 700 }));
    expect(result.success).toBe(true);
    expect(expenses.upsertBudget).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz_123',
      categoryId: 'cat_1',
      amount: 700,
      month: 6,
      year: 2026,
    }));
  });

  it('delete_expense voids the expense', async () => {
    (expenses.voidExpense as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'exp_1', status: 'VOID' });
    const result = await service.execute(mkCmd('delete_expense', { expenseId: 'exp_1' }));
    expect(result.success).toBe(true);
    expect(expenses.voidExpense).toHaveBeenCalledWith({ businessId: 'biz_123', expenseId: 'exp_1' });
    expect(result.data).toEqual(expect.objectContaining({ deleted: true, expenseId: 'exp_1' }));
  });

  it('categorize_transaction updates expense category', async () => {
    (expenses.updateExpense as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'exp_1', categoryId: 'cat_2' });
    const result = await service.execute(mkCmd('categorize_transaction', { transactionId: 'exp_1', category: 'cat_2' }));
    expect(result.success).toBe(true);
    expect(expenses.updateExpense).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz_123',
      expenseId: 'exp_1',
      categoryId: 'cat_2',
    }));
  });

  it('generate_pnl returns summary by default', async () => {
    (ledger.getPnl as ReturnType<typeof vi.fn>).mockResolvedValue({
      netProfit: 1000,
      revenue: { total: 5000, accounts: [] },
      operatingExpenses: { total: 4000, accounts: [] },
      grossProfit: 2000,
      currency: 'TTD',
    });
    const result = await service.execute(mkCmd('generate_pnl', { from: '2026-05-01', to: '2026-05-31' }));
    expect(result.success).toBe(true);
    expect(ledger.getPnl).toHaveBeenCalledWith('biz_123', new Date('2026-05-01'), new Date('2026-05-31'), 'accrual');
    expect(result.data).toEqual(expect.objectContaining({ netProfit: 1000, revenue: 5000 }));
  });

  it('getOverview delegates to FinanceOverviewService', async () => {
    (overview.getOverview as ReturnType<typeof vi.fn>).mockResolvedValue({ cashBalance: 1234 });
    const result = await service.getOverview('biz_123');
    expect(result).toEqual({ cashBalance: 1234 });
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown finance action');
  });
});
