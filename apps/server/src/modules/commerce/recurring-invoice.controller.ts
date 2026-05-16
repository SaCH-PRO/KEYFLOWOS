import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { RecurringInvoiceService } from './recurring-invoice.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { TeamAuditInterceptor, AuditAction } from '../../core/interceptors/team-audit.interceptor';

@Controller('commerce')
export class RecurringInvoiceController {
  constructor(
    @Inject(RecurringInvoiceService) private readonly service: RecurringInvoiceService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/recurring-invoices')
  list(@Param('businessId') businessId: string) {
    return this.service.listRecurringInvoices(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('businesses/:businessId/recurring-invoices/:id')
  get(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.getRecurringInvoice(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'recurring_invoice_created', 'recurring_invoice')
  @Post('businesses/:businessId/recurring-invoices')
  create(
    @Param('businessId') businessId: string,
    @Body() body: {
      contactId: string;
      name: string;
      description?: string;
      frequency: string;
      amount: number;
      currency?: string;
      startDate: string;
      endDate?: string | null;
      nextRunDate: string;
      metadata?: Record<string, unknown> | null;
    },
  ) {
    return this.service.createRecurringInvoice({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'recurring_invoice_updated', 'recurring_invoice')
  @Patch('businesses/:businessId/recurring-invoices/:id')
  update(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: {
      contactId?: string;
      name?: string;
      description?: string | null;
      frequency?: string;
      amount?: number;
      currency?: string;
      startDate?: string;
      endDate?: string | null;
      nextRunDate?: string;
      status?: string;
      metadata?: Record<string, unknown> | null;
    },
  ) {
    return this.service.updateRecurringInvoice({ id, businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'recurring_invoice_paused', 'recurring_invoice')
  @Post('businesses/:businessId/recurring-invoices/:id/pause')
  pause(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.pauseRecurringInvoice(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'recurring_invoice_resumed', 'recurring_invoice')
  @Post('businesses/:businessId/recurring-invoices/:id/resume')
  resume(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.resumeRecurringInvoice(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('revenue', 'recurring_invoice_cancelled', 'recurring_invoice')
  @Delete('businesses/:businessId/recurring-invoices/:id')
  cancel(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.cancelRecurringInvoice(businessId, id);
  }
}
