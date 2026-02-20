import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('expenses')
export class ExpensesController {
  constructor(
    @Inject(ExpensesService) private readonly expenses: ExpensesService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/expenses')
  listExpenses(
    @Param('businessId') businessId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('categoryId') categoryId?: string,
    @Query('vendor') vendor?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.expenses.listExpenses(businessId, {
      startDate,
      endDate,
      categoryId,
      vendor,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/expenses/summary')
  getExpenseSummary(
    @Param('businessId') businessId: string,
    @Query('period') period?: string,
  ) {
    return this.expenses.getExpenseSummary(businessId, period);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/expenses/:expenseId')
  getExpense(
    @Param('businessId') businessId: string,
    @Param('expenseId') expenseId: string,
  ) {
    return this.expenses.getExpense(businessId, expenseId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
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
      isRecurring?: boolean;
      recurringFrequency?: string;
      categoryId?: string;
    },
  ) {
    return this.expenses.createExpense({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
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
      isRecurring?: boolean;
      recurringFrequency?: string;
      categoryId?: string | null;
    },
  ) {
    return this.expenses.updateExpense({ businessId, expenseId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/expenses/:expenseId')
  deleteExpense(
    @Param('businessId') businessId: string,
    @Param('expenseId') expenseId: string,
  ) {
    return this.expenses.deleteExpense(businessId, expenseId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/expense-categories')
  listCategories(@Param('businessId') businessId: string) {
    return this.expenses.listCategories(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/expense-categories')
  createCategory(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; icon?: string; color?: string },
  ) {
    return this.expenses.createCategory({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/expense-categories/:categoryId')
  deleteCategory(
    @Param('businessId') businessId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.expenses.deleteCategory(businessId, categoryId);
  }
}
