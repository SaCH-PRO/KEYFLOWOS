import { Body, Controller, Delete, Get, Header, Inject, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { Response } from 'express';

@Controller('expenses')
export class ExpensesController {
  constructor(
    @Inject(ExpensesService) private readonly expenses: ExpensesService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/expenses')
  listExpenses(
    @Param('businessId') businessId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('period') period?: string,
    @Query('categoryId') categoryId?: string,
    @Query('vendor') vendor?: string,
    @Query('search') search?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('tag') tag?: string,
    @Query('isRecurring') isRecurring?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.expenses.listExpenses(businessId, {
      startDate,
      endDate,
      period,
      categoryId,
      vendor,
      search,
      paymentMethod,
      tag,
      isRecurring: isRecurring !== undefined ? isRecurring === 'true' : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/expenses/summary')
  getExpenseSummary(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.expenses.getExpenseSummary(businessId, period, startDate, endDate);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/expenses/vendors')
  getVendorAnalytics(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.expenses.getVendorAnalytics(businessId, period, startDate, endDate);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/expenses/margin-analysis')
  getMarginAnalysis(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.expenses.getMarginAnalysis(businessId, period, startDate, endDate);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/expenses/by-project/:projectId')
  getExpensesByProject(
    @Param('businessId') businessId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.expenses.getExpensesByEntity(businessId, 'projectId', projectId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/expenses/by-service/:serviceId')
  getExpensesByService(
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
  ) {
    return this.expenses.getExpensesByEntity(businessId, 'serviceId', serviceId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/expenses/recurring-candidates')
  getRecurringCandidates(
    @Param('businessId') businessId: string,
  ) {
    return this.expenses.detectRecurringCandidates(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/expenses/export')
  async exportCSV(
    @Param('businessId') businessId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('categoryId') categoryId?: string,
    @Res() res?: Response,
  ) {
    const csv = await this.expenses.exportExpensesCSV(businessId, { startDate, endDate, categoryId });
    res!.setHeader('Content-Type', 'text/csv');
    res!.setHeader('Content-Disposition', `attachment; filename=expenses-${new Date().toISOString().split('T')[0]}.csv`);
    res!.send(csv);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/expenses/:expenseId')
  getExpense(
    @Param('businessId') businessId: string,
    @Param('expenseId') expenseId: string,
  ) {
    return this.expenses.getExpense(businessId, expenseId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'write')
  @Post('businesses/:businessId/expenses')
  createExpense(
    @Param('businessId') businessId: string,
    @Body() body: {
      description: string;
      amount: number;
      currency?: string;
      date?: string;
      vendor?: string;
      receiptUrl?: string;
      notes?: string;
      paymentMethod?: string;
      tags?: string[];
      isRecurring?: boolean;
      recurringFrequency?: string;
      categoryId?: string;
      projectId?: string;
      contactId?: string;
      serviceId?: string;
    },
  ) {
    return this.expenses.createExpense({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'write')
  @Patch('businesses/:businessId/expenses/:expenseId')
  updateExpense(
    @Param('businessId') businessId: string,
    @Param('expenseId') expenseId: string,
    @Body() body: {
      description?: string;
      amount?: number;
      currency?: string;
      date?: string;
      vendor?: string;
      receiptUrl?: string;
      notes?: string;
      paymentMethod?: string;
      tags?: string[];
      isRecurring?: boolean;
      recurringFrequency?: string;
      categoryId?: string | null;
      projectId?: string | null;
      contactId?: string | null;
      serviceId?: string | null;
    },
  ) {
    return this.expenses.updateExpense({ businessId, expenseId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'write')
  @Delete('businesses/:businessId/expenses/:expenseId')
  deleteExpense(
    @Param('businessId') businessId: string,
    @Param('expenseId') expenseId: string,
  ) {
    return this.expenses.deleteExpense(businessId, expenseId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/expense-categories')
  listCategories(@Param('businessId') businessId: string) {
    return this.expenses.listCategories(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'write')
  @Post('businesses/:businessId/expense-categories')
  createCategory(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; icon?: string; color?: string },
  ) {
    return this.expenses.createCategory({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'write')
  @Delete('businesses/:businessId/expense-categories/:categoryId')
  deleteCategory(
    @Param('businessId') businessId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.expenses.deleteCategory(businessId, categoryId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/expense-budgets')
  listBudgets(
    @Param('businessId') businessId: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
  ) {
    return this.expenses.listBudgets(
      businessId,
      month ? parseInt(month, 10) : undefined,
      year ? parseInt(year, 10) : undefined,
    );
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'write')
  @Post('businesses/:businessId/expense-budgets')
  upsertBudget(
    @Param('businessId') businessId: string,
    @Body() body: {
      categoryId?: string;
      amount: number;
      month: number;
      year: number;
      alertAt?: number;
      rollover?: boolean;
    },
  ) {
    return this.expenses.upsertBudget({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'write')
  @Delete('businesses/:businessId/expense-budgets/:budgetId')
  deleteBudget(
    @Param('businessId') businessId: string,
    @Param('budgetId') budgetId: string,
  ) {
    return this.expenses.deleteBudget(businessId, budgetId);
  }
}
