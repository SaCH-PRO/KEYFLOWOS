import {
  BadRequestException,
  Body, Controller, Delete, ForbiddenException, Get, Header, Inject, Param, Patch, Post, Query, Req, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ReceivablesService } from './receivables.service';
import { FinanceOverviewService } from './finance-overview.service';
import { FinanceAccountsService, type CreateAccountInput, type UpdateAccountInput } from './finance-accounts.service';
import { FinanceCoaService, type CreateCoaInput, type UpdateCoaInput } from './finance-coa.service';
import { FinanceTaxRateService, type UpsertTaxRateInput } from './finance-tax-rate.service';
import { FinanceSettingsService, type UpdateFinanceSettingsInput } from './finance-settings.service';
import { BankImportService } from './bank-import.service';
import { BankMatchingService } from './bank-matching.service';
import { ReconciliationService } from './reconciliation.service';

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
    @Inject(BankImportService) private readonly bankImport: BankImportService,
    @Inject(BankMatchingService) private readonly bankMatch: BankMatchingService,
    @Inject(ReconciliationService) private readonly reconciliation: ReconciliationService,
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

  // ---------- FIN6: Reconciliation ----------

  /** CSV bank statement import. Multipart upload, field name `file`. */
  @Post('accounts/:accountId/bank-transactions/import')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  async importBankCsv(
    @Param('businessId') businessId: string,
    @Param('accountId') accountId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
    @Query('autoMatch') autoMatch?: string,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    if (!file || !file.buffer) throw new BadRequestException('CSV file is required');
    const csv = file.buffer.toString('utf8');
    const result = await this.bankImport.importCsv(businessId, accountId, csv, { userId: req.user.id });
    if (autoMatch !== 'false') {
      const m = await this.bankMatch.autoMatch(businessId, accountId, { userId: req.user.id });
      return { ...result, autoMatched: m };
    }
    return result;
  }

  /** Split-view payload for the reconciliation UI: bank rows + ledger candidates. */
  @Get('accounts/:accountId/bank-transactions')
  async listBankTransactions(
    @Param('businessId') businessId: string,
    @Param('accountId') accountId: string,
    @Req() req: any,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankMatch.getSplitView(businessId, accountId, {
      sinceDate: since ? new Date(since) : null,
      untilDate: until ? new Date(until) : null,
    });
  }

  @Post('accounts/:accountId/bank-transactions/auto-match')
  async runAutoMatch(
    @Param('businessId') businessId: string,
    @Param('accountId') accountId: string,
    @Req() req: any,
    @Body() body?: { since?: string; until?: string },
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankMatch.autoMatch(businessId, accountId, {
      sinceDate: body?.since ? new Date(body.since) : null,
      untilDate: body?.until ? new Date(body.until) : null,
      userId: req.user.id,
    });
  }

  @Post('bank-transactions/:bankTransactionId/match')
  async manualMatch(
    @Param('businessId') businessId: string,
    @Param('bankTransactionId') bankTransactionId: string,
    @Body() body: { transactionId: string },
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    if (!body?.transactionId) throw new BadRequestException('transactionId is required');
    return this.bankMatch.manualMatch(businessId, bankTransactionId, body.transactionId, req.user.id);
  }

  @Post('bank-transactions/:bankTransactionId/unmatch')
  async unmatch(
    @Param('businessId') businessId: string,
    @Param('bankTransactionId') bankTransactionId: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankMatch.unmatch(businessId, bankTransactionId, req.user.id);
  }

  @Post('bank-transactions/:bankTransactionId/ignore')
  async ignoreBankRow(
    @Param('businessId') businessId: string,
    @Param('bankTransactionId') bankTransactionId: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankMatch.ignore(businessId, bankTransactionId, req.user.id);
  }

  @Get('reconciliations')
  async listReconciliations(
    @Param('businessId') businessId: string,
    @Req() req: any,
    @Query('accountId') accountId?: string,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.reconciliation.list(businessId, accountId ?? null);
    return { items };
  }

  @Post('reconciliations')
  async createReconciliation(
    @Param('businessId') businessId: string,
    @Body() body: { accountId: string; periodStart: string; periodEnd: string; statementBalance: number | string; notes?: string | null },
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    if (!body?.accountId) throw new BadRequestException('accountId is required');
    if (!body?.periodStart || !body?.periodEnd) throw new BadRequestException('periodStart and periodEnd are required');
    return this.reconciliation.create(businessId, {
      accountId: body.accountId,
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      statementBalance: body.statementBalance ?? 0,
      notes: body.notes ?? null,
    }, req.user.id);
  }

  @Get('reconciliations/:id')
  async getReconciliation(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.reconciliation.get(businessId, id);
  }

  @Post('reconciliations/:id/complete')
  async completeReconciliation(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.reconciliation.complete(businessId, id, req.user.id);
  }

  @Get('reconciliations/:id/report')
  async reconciliationReport(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.reconciliation.getReport(businessId, id);
  }

  @Get('reconciliations/:id/report.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async reconciliationReportCsv(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    const csv = await this.reconciliation.exportReportCsv(businessId, id);
    res.setHeader('Content-Disposition', `attachment; filename="reconciliation-${id}.csv"`);
    res.send(csv);
  }
}
