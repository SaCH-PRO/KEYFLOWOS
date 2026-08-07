import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { RecurringExpenseService } from './recurring-expense.service';

interface RecurringExpenseCreateBody {
  name: string;
  frequency: string;
  nextRunDate: string | Date;
  endDate?: string | Date | null;
  description: string;
  amount: number;
  currency?: string;
  vendor?: string;
  paymentMethod?: string;
  notes?: string;
  createsBill?: boolean;
  dueOffsetDays?: number;
  categoryId?: string;
  projectId?: string;
  contactId?: string;
  serviceId?: string;
}

interface RecurringExpenseUpdateBody {
  name?: string;
  frequency?: string;
  nextRunDate?: string | Date;
  endDate?: string | Date | null;
  amount?: number;
  description?: string;
  vendor?: string;
  paymentMethod?: string | null;
  notes?: string | null;
  createsBill?: boolean;
  dueOffsetDays?: number | null;
  categoryId?: string | null;
  isActive?: boolean;
}
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { TeamAuditInterceptor, AuditAction } from '../../core/interceptors/team-audit.interceptor';

@Controller('expenses')
export class RecurringExpensesController {
  constructor(@Inject(RecurringExpenseService) private readonly svc: RecurringExpenseService) {}

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/recurring')
  list(@Param('businessId') businessId: string) {
    return this.svc.list(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'read')
  @Get('businesses/:businessId/recurring/:id')
  get(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.get(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('expenses', 'recurring_created', 'recurring_expense')
  @Post('businesses/:businessId/recurring')
  create(@Param('businessId') businessId: string, @Body() body: RecurringExpenseCreateBody) {
    return this.svc.create({ ...body, businessId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('expenses', 'recurring_updated', 'recurring_expense')
  @Patch('businesses/:businessId/recurring/:id')
  update(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: RecurringExpenseUpdateBody) {
    return this.svc.update({ ...body, businessId, id });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('expenses', 'recurring_cancelled', 'recurring_expense')
  @Delete('businesses/:businessId/recurring/:id')
  cancel(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.cancel(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('expenses', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('expenses', 'recurring_run_now', 'recurring_expense')
  @Post('businesses/:businessId/recurring/:id/run')
  runNow(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.svc.runOnce(id, businessId);
  }
}
