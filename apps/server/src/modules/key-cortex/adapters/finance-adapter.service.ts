import { Injectable, NotFoundException } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
import { ExpensesService } from '../../expenses/expenses.service';
import { FinanceOverviewService } from '../../finance/finance-overview.service';
import { FinanceAccountsService } from '../../finance/finance-accounts.service';
import { LedgerReportingService, ReportBasis } from '../../reports/ledger-reporting.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class FinanceAdapterService {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly overview: FinanceOverviewService,
    private readonly accounts: FinanceAccountsService,
    private readonly ledger: LedgerReportingService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    try {
      switch (command.action) {
        case 'record_expense': {
          const created = await this.recordExpense({
            businessId: command.businessId,
            description: command.parameters.description as string,
            amount: command.parameters.amount as number,
            categoryId: command.parameters.category as string,
            date: command.parameters.date as string | undefined,
            receiptUrl: command.parameters.receiptUrl as string | undefined,
          });
          return connectorOk(command, start, created);
        }
        case 'create_budget': {
          const created = await this.createBudget({
            businessId: command.businessId,
            categoryId: command.parameters.category as string,
            amount: command.parameters.amount as number,
            period: command.parameters.period as string,
            startDate: command.parameters.startDate as string,
          });
          return connectorOk(command, start, created);
        }
        case 'update_budget': {
          const updated = await this.updateBudget({
            businessId: command.businessId,
            budgetId: command.parameters.budgetId as string,
            amount: command.parameters.amount as number | undefined,
            active: command.parameters.active as boolean | undefined,
          });
          return connectorOk(command, start, updated);
        }
        case 'delete_expense': {
          const deleted = await this.deleteExpense({
            businessId: command.businessId,
            expenseId: command.parameters.expenseId as string,
          });
          return connectorOk(command, start, deleted);
        }
        case 'categorize_transaction': {
          const categorized = await this.categorizeTransaction({
            businessId: command.businessId,
            expenseId: command.parameters.transactionId as string,
            categoryId: command.parameters.category as string,
          });
          return connectorOk(command, start, categorized);
        }
        case 'generate_pnl': {
          const report = await this.generatePnl({
            businessId: command.businessId,
            from: command.parameters.from as string,
            to: command.parameters.to as string,
            format: (command.parameters.format as string) || 'summary',
          });
          return connectorOk(command, start, report);
        }
        default:
          return connectorFail(command, start, `Unknown finance action: ${command.action}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return connectorFail(command, start, message);
    }
  }

  async getOverview(businessId: string) {
    return this.overview.getOverview(businessId);
  }

  private async recordExpense(input: {
    businessId: string;
    description: string;
    amount: number;
    categoryId?: string;
    date?: string;
    receiptUrl?: string;
  }) {
    return this.expenses.createExpense({
      businessId: input.businessId,
      description: input.description,
      amount: input.amount,
      categoryId: input.categoryId,
      date: input.date,
      receiptUrl: input.receiptUrl,
    });
  }

  private async createBudget(input: {
    businessId: string;
    categoryId: string;
    amount: number;
    period: string;
    startDate: string;
  }) {
    const date = input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : new Date();
    return this.expenses.upsertBudget({
      businessId: input.businessId,
      categoryId: input.categoryId,
      amount: input.amount,
      month: date.getUTCMonth() + 1,
      year: date.getUTCFullYear(),
    });
  }

  private async updateBudget(input: {
    businessId: string;
    budgetId: string;
    amount?: number;
    active?: boolean;
  }) {
    const budget = await this.prisma.client.expenseBudget.findFirst({
      where: { id: input.budgetId, businessId: input.businessId },
    });
    if (!budget) {
      throw new NotFoundException('Budget not found');
    }
    return this.expenses.upsertBudget({
      businessId: input.businessId,
      categoryId: budget.categoryId ?? undefined,
      amount: input.amount ?? budget.amount,
      month: budget.month,
      year: budget.year,
    });
  }

  private async deleteExpense(input: { businessId: string; expenseId: string }) {
    await this.expenses.voidExpense({
      businessId: input.businessId,
      expenseId: input.expenseId,
    });
    return { deleted: true, expenseId: input.expenseId };
  }

  private async categorizeTransaction(input: {
    businessId: string;
    expenseId: string;
    categoryId: string;
  }) {
    return this.expenses.updateExpense({
      businessId: input.businessId,
      expenseId: input.expenseId,
      categoryId: input.categoryId,
    });
  }

  private async generatePnl(input: {
    businessId: string;
    from: string;
    to: string;
    format: string;
  }) {
    const from = new Date(input.from);
    const to = new Date(input.to);
    const basis: ReportBasis = input.format === 'cash' ? 'cash' : 'accrual';
    const report = await this.ledger.getPnl(input.businessId, from, to, basis);
    if (input.format === 'summary') {
      return {
        netProfit: report.netProfit,
        revenue: report.revenue.total,
        operatingExpenses: report.operatingExpenses.total,
        grossProfit: report.grossProfit,
        currency: report.currency,
        period: { from: input.from, to: input.to },
      };
    }
    return report;
  }
}
