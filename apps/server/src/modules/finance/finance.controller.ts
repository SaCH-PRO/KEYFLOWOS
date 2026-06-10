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
import { LedgerBalanceService } from './ledger-balance.service';
import { FinanceOverviewService } from './finance-overview.service';
import { FinanceAccountsService, type CreateAccountInput, type UpdateAccountInput } from './finance-accounts.service';
import { FinanceCoaService, type CreateCoaInput, type UpdateCoaInput } from './finance-coa.service';
import { FinanceTaxRateService, type UpsertTaxRateInput } from './finance-tax-rate.service';
import { FinanceSettingsService, type UpdateFinanceSettingsInput } from './finance-settings.service';
import { BankImportService } from './bank-import.service';
import { BankMatchingService } from './bank-matching.service';
import { ReconciliationService } from './reconciliation.service';
import { TaxLiabilityService } from './tax-liability.service';
import { AccountantExportService } from './accountant-export.service';
import { FinanceIntelligenceService } from './finance-intelligence.service';
import { AccountantExportEmailService } from './accountant-export-email.service';
import { ObjectStorageService } from '../../core/object-storage';
import { PostingService, type PostingInput } from './posting.service';
import { SafeToSpendService } from './safe-to-spend.service';
import { CashflowForecastService } from './cashflow-forecast.service';
import { MoneyMovesService } from './money-moves.service';
import { CashReserveService } from './cash-reserve.service';
import { BankRuleService, type CreateBankRuleInput, type UpdateBankRuleInput } from './bank-rule.service';
import { RecurringJournalEntryService, type CreateRecurringJournalEntryInput, type UpdateRecurringJournalEntryInput } from './recurring-journal-entry.service';
import { CreditNoteService, type CreateCreditNoteInput, type UpdateCreditNoteInput } from './credit-note.service';
import { AccountingPeriodService, type CreateAccountingPeriodInput, type CloseAccountingPeriodInput } from './accounting-period.service';

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
    @Inject(ReceivablesService) private readonly receivables: ReceivablesService,
    @Inject(LedgerBalanceService) private readonly ledgerBalance: LedgerBalanceService,
    @Inject(FinanceOverviewService) private readonly overview: FinanceOverviewService,
    @Inject(FinanceAccountsService) private readonly accounts: FinanceAccountsService,
    @Inject(FinanceCoaService) private readonly coa: FinanceCoaService,
    @Inject(FinanceTaxRateService) private readonly taxRates: FinanceTaxRateService,
    @Inject(FinanceSettingsService) private readonly settings: FinanceSettingsService,
    @Inject(BankImportService) private readonly bankImport: BankImportService,
    @Inject(BankMatchingService) private readonly bankMatch: BankMatchingService,
    @Inject(BankRuleService) private readonly bankRules: BankRuleService,
    @Inject(RecurringJournalEntryService) private readonly recurringJournals: RecurringJournalEntryService,
    @Inject(ReconciliationService) private readonly reconciliation: ReconciliationService,
    @Inject(TaxLiabilityService) private readonly taxLiability: TaxLiabilityService,
    @Inject(AccountantExportService) private readonly accountantExport: AccountantExportService,
    @Inject(FinanceIntelligenceService) private readonly intel: FinanceIntelligenceService,
    @Inject(AccountantExportEmailService) private readonly accountantExportEmail: AccountantExportEmailService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SafeToSpendService) private readonly safeToSpend: SafeToSpendService,
    @Inject(CashflowForecastService) private readonly cashflowForecast: CashflowForecastService,
    @Inject(MoneyMovesService) private readonly moneyMoves: MoneyMovesService,
    @Inject(CashReserveService) private readonly cashReserve: CashReserveService,
    @Inject(CreditNoteService) private readonly creditNotes: CreditNoteService,
    @Inject(AccountingPeriodService) private readonly accountingPeriods: AccountingPeriodService,
  ) {}

  // ---------- Manual Journal Entries ----------
  @Post('journal-entries')
  async createJournalEntry(
    @Param('businessId') businessId: string,
    @Body() body: {
      date: string;
      description: string;
      reference?: string;
      notes?: string;
      entries: Array<{ accountId: string; debit?: number; credit?: number; memo?: string }>;
    },
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id as string | undefined;
    const totalDebit = body.entries.reduce((sum, e) => sum + (e.debit ?? 0), 0);
    const input: PostingInput = {
      businessId,
      type: 'ADJUSTMENT',
      date: new Date(body.date),
      amount: totalDebit,
      description: body.description,
      reference: body.reference ?? null,
      notes: body.notes ?? null,
      entries: body.entries.map((e) => ({
        accountId: e.accountId,
        debit: e.debit ?? 0,
        credit: e.credit ?? 0,
        memo: e.memo,
      })),
      createdById: userId ?? null,
    };
    return this.posting.post(input);
  }

  @Get('journal-entries')
  async listJournalEntries(
    @Param('businessId') businessId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('accountId') accountId?: string,
  ) {
    const where: any = { businessId, type: 'ADJUSTMENT' };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }
    const transactions = await this.prisma.client.financialTransaction.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        entries: {
          include: { account: { select: { id: true, name: true, type: true, code: true } } },
        },
        contact: { select: { id: true, displayName: true } },
      },
    });
    return { items: transactions };
  }

  // ---------- General Ledger & Trial Balance ----------
  @Get('general-ledger')
  async getGeneralLedger(
    @Param('businessId') businessId: string,
    @Req() req: Request,
    @Query('accountId') accountId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    await this.ensureAccess((req as any).user.id, businessId);
    return this.ledgerBalance.getGeneralLedger(businessId, {
      accountId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('trial-balance')
  async getTrialBalance(
    @Param('businessId') businessId: string,
    @Req() req: Request,
    @Query('asOf') asOf?: string,
  ) {
    await this.ensureAccess((req as any).user.id, businessId);
    const result = await this.ledgerBalance.getTrialBalance(businessId, asOf ? new Date(asOf) : undefined);
    return {
      items: result.map((r) => ({
        accountId: r.accountId,
        systemKey: r.systemKey,
        name: r.name,
        type: r.type,
        debit: r.debit.toString(),
        credit: r.credit.toString(),
        net: r.net.toString(),
      })),
    };
  }

  @Get('trial-balance/account/:accountId')
  async getAccountBalance(
    @Param('businessId') businessId: string,
    @Param('accountId') accountId: string,
    @Req() req: Request,
    @Query('asOf') asOf?: string,
  ) {
    await this.ensureAccess((req as any).user.id, businessId);
    const balance = await this.ledgerBalance.getAccountBalance(accountId, asOf ? new Date(asOf) : undefined);
    return { accountId, balance: balance.toString() };
  }

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

  // ---------- FIN8: Finance intelligence / action queue ----------
  @Get('intelligence/actions')
  async listIntelActions(
    @Param('businessId') businessId: string,
    @Req() req: any,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.intel.list(businessId, { status, kind });
    return { items };
  }

  @Post('intelligence/scan')
  async runIntelScan(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.intel.scan(businessId);
  }

  @Post('intelligence/actions/:id/resolve')
  async resolveIntelAction(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { resolution?: string | null },
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.intel.resolve(businessId, id, req.user.id, body?.resolution ?? null);
  }

  @Post('intelligence/actions/:id/dismiss')
  async dismissIntelAction(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.intel.dismiss(businessId, id, req.user.id);
  }

  @Get('intelligence/insight')
  async getIntelInsight(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.intel.getInsightStrip(businessId);
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

  // ---------- Bank Rules ----------
  @Get('bank-rules')
  async listBankRules(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.bankRules.list(businessId);
    return { items };
  }

  @Post('bank-rules')
  async createBankRule(
    @Param('businessId') businessId: string,
    @Body() body: CreateBankRuleInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankRules.create(businessId, body);
  }

  @Get('bank-rules/:id')
  async getBankRule(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankRules.get(businessId, id);
  }

  @Patch('bank-rules/:id')
  async updateBankRule(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: UpdateBankRuleInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankRules.update(businessId, id, body);
  }

  @Delete('bank-rules/:id')
  async deleteBankRule(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankRules.remove(businessId, id);
  }

  @Post('bank-rules/apply')
  async applyBankRules(
    @Param('businessId') businessId: string,
    @Body() body: { bankTransactionIds: string[] },
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankRules.applyRules(businessId, body.bankTransactionIds ?? [], { userId: req.user.id });
  }

  @Post('accounts/:accountId/bank-rules/apply')
  async applyBankRulesToAccount(
    @Param('businessId') businessId: string,
    @Param('accountId') accountId: string,
    @Body() body: { since?: string; until?: string },
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankRules.applyRulesToAccount(businessId, accountId, {
      sinceDate: body.since ? new Date(body.since) : null,
      untilDate: body.until ? new Date(body.until) : null,
      userId: req.user.id,
    });
  }

  // ---------- Recurring Journal Entries ----------
  @Get('recurring-journal-entries')
  async listRecurringJournals(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.recurringJournals.list(businessId);
    return { items };
  }

  @Post('recurring-journal-entries')
  async createRecurringJournal(
    @Param('businessId') businessId: string,
    @Body() body: CreateRecurringJournalEntryInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.recurringJournals.create(businessId, body);
  }

  @Get('recurring-journal-entries/:id')
  async getRecurringJournal(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.recurringJournals.get(businessId, id);
  }

  @Patch('recurring-journal-entries/:id')
  async updateRecurringJournal(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: UpdateRecurringJournalEntryInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.recurringJournals.update(businessId, id, body);
  }

  @Post('recurring-journal-entries/:id/run')
  async runRecurringJournal(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.recurringJournals.runOnce(businessId, id);
  }

  @Post('recurring-journal-entries/:id/cancel')
  async cancelRecurringJournal(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.recurringJournals.cancel(businessId, id);
  }

  @Delete('recurring-journal-entries/:id')
  async deleteRecurringJournal(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.recurringJournals.remove(businessId, id);
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

  // ---------- FIN7: Tax Liabilities ----------
  @Get('tax-liabilities')
  async listTaxLiabilities(
    @Param('businessId') businessId: string,
    @Query('status') status: string | undefined,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.taxLiability.list(businessId, status);
    return { items };
  }

  @Post('tax-liabilities/recompute')
  async recomputeTaxLiabilities(
    @Param('businessId') businessId: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.taxLiability.recompute(businessId);
  }

  @Get('tax-liabilities/:id')
  async getTaxLiability(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.taxLiability.get(businessId, id);
  }

  @Get('tax-liabilities/:id/contributing-invoices')
  async taxContributingInvoices(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.taxLiability.contributingInvoices(businessId, id);
  }

  @Get('tax-calendar')
  async taxCalendar(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.taxLiability.getFilingCalendar(businessId);
  }

  @Post('tax-liabilities/:id/file')
  async fileTaxLiability(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { dueDate?: string | null; notes?: string | null },
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.taxLiability.file(
      businessId,
      id,
      body?.dueDate ? new Date(body.dueDate) : null,
      body?.notes ?? null,
    );
  }

  @Post('tax-liabilities/:id/pay')
  async payTaxLiability(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { paymentDate?: string; notes?: string | null },
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.taxLiability.pay(businessId, id, {
      paymentDate: body?.paymentDate ? new Date(body.paymentDate) : undefined,
      notes: body?.notes ?? null,
      userId: req.user.id,
    });
  }

  // ---------- FIN7: Spec-path aliases for /tax/liabilities ----------
  // The canonical handlers above live under `/tax-liabilities`; the
  // FIN7 spec uses `/tax/liabilities`. Both paths are first-class and
  // delegate to the same logic.
  @Get('tax/liabilities')
  listTaxLiabilitiesAlias(
    @Param('businessId') businessId: string,
    @Query('status') status: string | undefined,
    @Req() req: any,
  ) { return this.listTaxLiabilities(businessId, status, req); }

  @Post('tax/liabilities/recompute')
  recomputeTaxLiabilitiesAlias(
    @Param('businessId') businessId: string,
    @Req() req: any,
  ) { return this.recomputeTaxLiabilities(businessId, req); }

  @Get('tax/liabilities/:id')
  getTaxLiabilityAlias(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) { return this.getTaxLiability(businessId, id, req); }

  @Get('tax/liabilities/:id/contributing-invoices')
  taxContributingInvoicesAlias(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) { return this.taxContributingInvoices(businessId, id, req); }

  @Post('tax/liabilities/:id/file')
  fileTaxLiabilityAlias(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { dueDate?: string | null; notes?: string | null },
    @Req() req: any,
  ) { return this.fileTaxLiability(businessId, id, body, req); }

  @Post('tax/liabilities/:id/pay')
  payTaxLiabilityAlias(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { paymentDate?: string; notes?: string | null },
    @Req() req: any,
  ) { return this.payTaxLiability(businessId, id, body, req); }

  // ---------- FIN7: Accountant Export ZIP ----------
  @Get('accountant-export.zip')
  async accountantExportStream(
    @Param('businessId') businessId: string,
    @Query('start') start: string | undefined,
    @Query('end') end: string | undefined,
    @Query('basis') basis: 'CASH' | 'ACCRUAL' | undefined,
    @Req() req: any,
    @Res() res: Response,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    if (!start || !end) {
      throw new BadRequestException('start and end query params are required (YYYY-MM-DD)');
    }
    const periodStart = new Date(`${start}T00:00:00.000Z`);
    const periodEnd = new Date(`${end}T23:59:59.999Z`);
    const result = await this.accountantExport.build({
      businessId, periodStart, periodEnd, basis, userId: req.user.id,
    });
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', String(result.bytes));
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  }

  /**
   * Spec endpoint: build the ZIP, persist it to object storage, and return
   * a short-lived signed download URL plus metadata. Lets clients hand the
   * URL off (email, queue, etc.) without re-streaming through the API.
   *
   * Accepts both `(periodStart, periodEnd)` (spec contract) and
   * `(start, end)` (legacy/short form). Each may be a YYYY-MM-DD string or
   * a full ISO timestamp.
   */
  @Post('accountant-export')
  async accountantExportSigned(
    @Param('businessId') businessId: string,
    @Body() body: {
      periodStart?: string; periodEnd?: string;
      start?: string; end?: string;
      basis?: 'CASH' | 'ACCRUAL'; expiresIn?: number;
    },
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    const rawStart = body?.periodStart ?? body?.start;
    const rawEnd = body?.periodEnd ?? body?.end;
    if (!rawStart || !rawEnd) {
      throw new BadRequestException(
        'periodStart and periodEnd body fields are required (YYYY-MM-DD or ISO timestamp)',
      );
    }
    const periodStart = /T/.test(rawStart) ? new Date(rawStart) : new Date(`${rawStart}T00:00:00.000Z`);
    const periodEnd = /T/.test(rawEnd) ? new Date(rawEnd) : new Date(`${rawEnd}T23:59:59.999Z`);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      throw new BadRequestException('periodStart / periodEnd are not valid dates');
    }
    const result = await this.accountantExport.build({
      businessId, periodStart, periodEnd, basis: body?.basis, userId: req.user.id,
    });
    const storage = new ObjectStorageService();
    const { objectPath } = await storage.uploadBuffer(result.buffer, {
      contentType: result.contentType,
      subdir: `accountant-exports/${businessId}`,
      filename: result.filename,
    });
    const expiresIn = Math.max(60, Math.min(body?.expiresIn ?? 3600, 24 * 3600));
    const downloadUrl = await storage.getReadSignedUrl(objectPath, {
      expiresIn,
      downloadFilename: result.filename,
    });
    return {
      filename: result.filename,
      contentType: result.contentType,
      bytes: result.bytes,
      objectPath,
      downloadUrl,
      expiresIn,
      generatedAt: new Date().toISOString(),
    };
  }

  // ---------- Safe to Spend ----------
  @Get('safe-to-spend')
  async getSafeToSpend(@Param('businessId') businessId: string) {
    return this.safeToSpend.calculate(businessId);
  }

  // ---------- Cashflow Forecast ----------
  @Get('cashflow-forecast')
  async getCashflowForecast(
    @Param('businessId') businessId: string,
    @Query('days') days?: string,
  ) {
    return this.cashflowForecast.forecast(businessId, days ? parseInt(days, 10) : 90);
  }

  // ---------- Money Moves ----------
  @Get('money-moves')
  async getMoneyMoves(@Param('businessId') businessId: string) {
    return this.moneyMoves.generate(businessId);
  }

  /**
   * Email the Accountant Export ZIP directly to a recipient. Uses the
   * business's configured `accountantEmail` when `to` is omitted; pass
   * `saveRecipient: true` to persist a new address as the new default.
   */
  @Post('accountant-export/email')
  async accountantExportEmailSend(
    @Param('businessId') businessId: string,
    @Body() body: {
      periodStart?: string; periodEnd?: string;
      start?: string; end?: string;
      basis?: 'CASH' | 'ACCRUAL';
      to?: string | null;
      message?: string | null;
      saveRecipient?: boolean;
    },
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    const rawStart = body?.periodStart ?? body?.start;
    const rawEnd = body?.periodEnd ?? body?.end;
    if (!rawStart || !rawEnd) {
      throw new BadRequestException(
        'periodStart and periodEnd body fields are required (YYYY-MM-DD or ISO timestamp)',
      );
    }
    const periodStart = /T/.test(rawStart) ? new Date(rawStart) : new Date(`${rawStart}T00:00:00.000Z`);
    const periodEnd = /T/.test(rawEnd) ? new Date(rawEnd) : new Date(`${rawEnd}T23:59:59.999Z`);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      throw new BadRequestException('periodStart / periodEnd are not valid dates');
    }
    return this.accountantExportEmail.send({
      businessId,
      periodStart,
      periodEnd,
      basis: body?.basis,
      to: body?.to ?? null,
      message: body?.message ?? null,
      saveRecipient: Boolean(body?.saveRecipient),
      userId: req.user.id,
    });
  }

  // ---------- Cash Reserve Buckets ----------
  @Get('reserves')
  async listReserves(@Param('businessId') businessId: string) {
    return this.cashReserve.list(businessId);
  }

  @Post('reserves')
  async createReserve(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; purpose: string; targetAmount?: number; currentAmount?: number; currency?: string },
  ) {
    return this.cashReserve.create(businessId, body);
  }

  @Patch('reserves/:id')
  async updateReserve(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: Partial<{ name: string; purpose: string; targetAmount: number; currentAmount: number; status: string }>,
  ) {
    return this.cashReserve.update(businessId, id, body);
  }

  @Delete('reserves/:id')
  async deleteReserve(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.cashReserve.delete(businessId, id);
  }

  // ---------- Credit Notes ----------
  @Get('credit-notes')
  async listCreditNotes(@Param('businessId') businessId: string) {
    return this.creditNotes.list(businessId);
  }

  @Post('credit-notes')
  async createCreditNote(
    @Param('businessId') businessId: string,
    @Body() body: CreateCreditNoteInput,
  ) {
    return this.creditNotes.create(businessId, body);
  }

  @Get('credit-notes/:id')
  async getCreditNote(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.creditNotes.get(businessId, id);
  }

  @Patch('credit-notes/:id')
  async updateCreditNote(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: UpdateCreditNoteInput,
  ) {
    return this.creditNotes.update(businessId, id, body);
  }

  @Post('credit-notes/:id/apply')
  async applyCreditNote(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    return this.creditNotes.apply(businessId, id, { userId: req.user?.id });
  }

  @Post('credit-notes/:id/void')
  async voidCreditNote(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.creditNotes.void(businessId, id);
  }

  @Delete('credit-notes/:id')
  async deleteCreditNote(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.creditNotes.remove(businessId, id);
  }

  // ---------- Accounting Periods ----------
  @Get('accounting-periods')
  async listAccountingPeriods(@Param('businessId') businessId: string) {
    return this.accountingPeriods.list(businessId);
  }

  @Post('accounting-periods')
  async createAccountingPeriod(
    @Param('businessId') businessId: string,
    @Body() body: CreateAccountingPeriodInput,
  ) {
    return this.accountingPeriods.create(businessId, body);
  }

  @Get('accounting-periods/:id')
  async getAccountingPeriod(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.accountingPeriods.get(businessId, id);
  }

  @Patch('accounting-periods/:id')
  async updateAccountingPeriod(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: Partial<CreateAccountingPeriodInput>,
  ) {
    return this.accountingPeriods.update(businessId, id, body);
  }

  @Post('accounting-periods/:id/close')
  async closeAccountingPeriod(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: CloseAccountingPeriodInput,
    @Req() req: any,
  ) {
    return this.accountingPeriods.close(businessId, id, { closedById: req.user?.id });
  }

  @Post('accounting-periods/:id/reopen')
  async reopenAccountingPeriod(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.accountingPeriods.reopen(businessId, id);
  }

  @Delete('accounting-periods/:id')
  async deleteAccountingPeriod(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.accountingPeriods.remove(businessId, id);
  }
}
