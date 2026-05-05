import {
  Body, Controller, Delete, ForbiddenException, Get, Inject, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ReceivablesService } from './receivables.service';
import { FinanceOverviewService } from './finance-overview.service';
import { FinanceAccountsService, type CreateAccountInput, type UpdateAccountInput } from './finance-accounts.service';
import { FinanceCoaService, type CreateCoaInput, type UpdateCoaInput } from './finance-coa.service';
import { FinanceTaxRateService, type UpsertTaxRateInput } from './finance-tax-rate.service';
import { FinanceSettingsService, type UpdateFinanceSettingsInput } from './finance-settings.service';

/**
 * FIN2 — read-only receivables endpoints.
 * FIN5 — Unified controller fanning out to the Finance Overview / Settings
 * sub-services. Mirrors the access-check pattern used in
 * RevenueActionController (owner OR member of the business).
 */
@Controller('finance/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class FinanceController {
  constructor(
    private readonly receivables: ReceivablesService,
    @Inject(FinanceOverviewService) private readonly overview: FinanceOverviewService,
    @Inject(FinanceAccountsService) private readonly accounts: FinanceAccountsService,
    @Inject(FinanceCoaService) private readonly coa: FinanceCoaService,
    @Inject(FinanceTaxRateService) private readonly taxRates: FinanceTaxRateService,
    @Inject(FinanceSettingsService) private readonly settings: FinanceSettingsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private async ensureAccess(userId: string, businessId: string) {
    const biz = await this.prisma.client.business.findFirst({
      where: { id: businessId, OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      select: { id: true },
    });
    if (!biz) throw new ForbiddenException('No access to this business');
  }

  // ---------- Receivables (FIN2) ----------
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

  // ---------- Overview ----------
  @Get('overview')
  async getOverview(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.overview.getOverview(businessId);
  }

  // ---------- FinancialAccount ----------
  @Get('accounts')
  async listAccounts(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.accounts.list(businessId);
    return { items };
  }
  @Post('accounts')
  async createAccount(
    @Param('businessId') businessId: string,
    @Body() body: CreateAccountInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.accounts.create(businessId, body);
  }
  @Patch('accounts/:id')
  async updateAccount(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: UpdateAccountInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.accounts.update(businessId, id, body);
  }
  @Delete('accounts/:id')
  async archiveAccount(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.accounts.archive(businessId, id);
  }

  // ---------- ChartOfAccount ----------
  @Get('chart-of-accounts')
  async listCoa(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.coa.list(businessId);
    return { items };
  }
  @Post('chart-of-accounts')
  async createCoa(
    @Param('businessId') businessId: string,
    @Body() body: CreateCoaInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.coa.create(businessId, body);
  }
  @Patch('chart-of-accounts/:id')
  async updateCoa(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: UpdateCoaInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.coa.update(businessId, id, body);
  }
  @Delete('chart-of-accounts/:id')
  async archiveCoa(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.coa.archive(businessId, id);
  }

  // ---------- TaxRate ----------
  @Get('tax-rates')
  async listTaxRates(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.taxRates.list(businessId);
    return { items };
  }
  @Post('tax-rates')
  async createTaxRate(
    @Param('businessId') businessId: string,
    @Body() body: UpsertTaxRateInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.taxRates.create(businessId, body);
  }
  @Patch('tax-rates/:id')
  async updateTaxRate(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: Partial<UpsertTaxRateInput>,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.taxRates.update(businessId, id, body);
  }
  @Delete('tax-rates/:id')
  async deleteTaxRate(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.taxRates.remove(businessId, id);
  }

  // ---------- Settings ----------
  @Get('settings')
  async getSettings(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.settings.get(businessId);
  }
  @Patch('settings')
  async patchSettings(
    @Param('businessId') businessId: string,
    @Body() body: UpdateFinanceSettingsInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.settings.update(businessId, body);
  }
}
