import { Body, Controller, Get, Inject, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { TeamAuditInterceptor, AuditAction } from '../../core/interceptors/team-audit.interceptor';

/**
 * FIN3 — Bills, payables aging and vendor balances live under the
 * `/finance/...` URL prefix per the FIN3 spec. They share the same
 * Expense table internally — a Bill is just an Expense with status=BILL.
 */
@Controller('finance')
export class BillsController {
  constructor(@Inject(ExpensesService) private readonly expenses: ExpensesService) {}

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/bills')
  listBills(@Param('businessId') businessId: string) {
    return this.expenses.listExpenses(businessId, { status: 'BILL', limit: 200 });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('expenses', 'bill_created', 'expense')
  @Post('businesses/:businessId/bills')
  createBill(
    @Param('businessId') businessId: string,
    @Body()
    body: {
      description: string;
      amount: number;
      currency?: string;
      date?: string;
      dueDate?: string;
      vendor?: string;
      notes?: string;
      categoryId?: string;
      contactId?: string;
      paymentMethod?: string;
    },
  ) {
    return this.expenses.createExpense({
      businessId,
      description: body.description,
      amount: body.amount,
      currency: body.currency,
      date: body.date,
      dueDate: body.dueDate,
      vendor: body.vendor,
      notes: body.notes,
      categoryId: body.categoryId,
      contactId: body.contactId,
      paymentMethod: body.paymentMethod,
      status: 'BILL',
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('expenses', 'bill_paid', 'expense')
  @Post('businesses/:businessId/bills/:billId/pay')
  payBill(
    @Param('businessId') businessId: string,
    @Param('billId') billId: string,
    @Body() body: { paymentMethod?: string; paidAt?: string },
  ) {
    return this.expenses.markBillPaid({
      businessId,
      expenseId: billId,
      paymentMethod: body?.paymentMethod,
      paidAt: body?.paidAt,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('expenses', 'bill_voided', 'expense')
  @Post('businesses/:businessId/bills/:billId/void')
  voidBill(
    @Param('businessId') businessId: string,
    @Param('billId') billId: string,
    @Body() body: { reason?: string },
  ) {
    return this.expenses.voidExpense({ businessId, expenseId: billId, reason: body?.reason });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/payables/aging')
  payablesAging(@Param('businessId') businessId: string) {
    return this.expenses.getPayablesAging(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/vendors/balances')
  vendorBalances(@Param('businessId') businessId: string) {
    return this.expenses.getVendorBalances(businessId);
  }

  /**
   * Per-vendor balance — returns lifetime billed/paid plus current
   * outstanding for a single vendor (matched by contactId first, then by
   * the free-form `Expense.vendor` string).
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/vendors/:vendorId/balance')
  vendorBalance(
    @Param('businessId') businessId: string,
    @Param('vendorId') vendorId: string,
  ) {
    return this.expenses.getVendorBalance(businessId, vendorId);
  }
}
