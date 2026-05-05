import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ReceivablesService } from './receivables.service';

/**
 * FIN2 — read-only receivables endpoints. Mounted under /finance so the
 * existing finance route prefix conventions hold; FIN5 will add the rest
 * (transactions, balance sheet, P&L) under the same root.
 */
@Controller('finance/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class FinanceController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Get('receivables/aging')
  async aging(@Param('businessId') businessId: string, @Query('asOf') asOf?: string) {
    const date = asOf ? new Date(asOf) : new Date();
    const [report, ledgerAr] = await Promise.all([
      this.receivables.getAging(businessId, date),
      this.receivables.getLedgerArBalance(businessId, date),
    ]);
    return { ...report, ledgerArBalance: ledgerAr };
  }

  @Get('customers/:contactId/balance')
  async customerBalance(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Query('asOf') asOf?: string,
  ) {
    const date = asOf ? new Date(asOf) : new Date();
    return this.receivables.getCustomerBalance(businessId, contactId, date);
  }
}
