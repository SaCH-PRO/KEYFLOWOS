import {
  BadRequestException,
  Body, Controller, Delete, ForbiddenException, Get, Header, Inject, NotFoundException, Param, Patch, Post, Query, Req, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthenticatedUser } from '../../core/decorators/current-user.decorator';
import { ReceivablesService } from './receivables.service';
import { LedgerBalanceService } from './ledger-balance.service';
import { FinanceOverviewService } from './finance-overview.service';
import { FinanceAccountsService, type CreateAccountInput, type UpdateAccountInput } from './finance-accounts.service';
import { FinanceCoaService, type CreateCoaInput, type UpdateCoaInput } from './finance-coa.service';
import { FinanceTaxRateService, type UpsertTaxRateInput } from './finance-tax-rate.service';
import { FinanceSettingsService, type UpdateFinanceSettingsInput } from './finance-settings.service';
import { BankImportService, type ImportProfile } from './bank-import.service';
import { StatementSourceService, type StatementSources } from './statement-source.service';
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
import { CreditNoteService, RESERVED_CREDIT_NOTE_NUMBER_PREFIX, type CreateCreditNoteInput, type UpdateCreditNoteInput } from './credit-note.service';
import { AccountingPeriodService, type CreateAccountingPeriodInput, type CloseAccountingPeriodInput } from './accounting-period.service';
import { BankConnectionService, type CreateBankConnectionInput, type UpdateBankConnectionInput } from './bank-connection.service';
import { ExchangeRateService, type CreateExchangeRateInput } from './exchange-rate.service';
import { FixedAssetService, type CreateFixedAssetInput, type UpdateFixedAssetInput } from './fixed-asset.service';
import { SystemEmailSendError } from '../notifications/system-email.service';
import { redactAddresses } from '../../core/security/redaction';
import { resolveTimelineViewer } from '../timeline/timeline-visibility';
import { assertGoogleConnectOwner } from '../../core/connectors/google-suite.controller';

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
    @Inject(StatementSourceService) private readonly statementSources: StatementSourceService,
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
    @Inject(BankConnectionService) private readonly bankConnections: BankConnectionService,
    @Inject(ExchangeRateService) private readonly exchangeRates: ExchangeRateService,
    @Inject(FixedAssetService) private readonly fixedAssets: FixedAssetService,
  ) {}

  // ---------- Manual Journal Entries ----------
  // PR195-JOURNAL-SCOPE (review finding CR-P195-4): a manual journal writes the books, so it needs
  // revenue write, the module of the Books (owner ruling D-57: no module key of their own; their reads,
  // GET journal-entries included, need revenue read, and the credit notes, the other manual Books write
  // on this controller, revenue write). ModuleScopeGuard refuses a member below it with 403 before the
  // handler, so nothing is posted; ensureAccess still refuses a platform SUPER_ADMIN who is not a member
  // (D-46, FOLLOW3-A5), whom the guard passes. The derived KEY tool table follows the decorator
  // (job-role-tool-families.spec.ts): finance_post_journal_entry is revenue write there.
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('journal-entries')
  async createJournalEntry(
    @Param('businessId') businessId: string,
    @Body() body: {
      date: string;
      description: string;
      reference?: string;
      notes?: string;
      currency?: string;
      entries: Array<{ accountId: string; debit?: number; credit?: number; memo?: string }>;
    },
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id as string | undefined;
    // FOLLOW3-A5 (F2 PF-03): the membership check every sibling Books write
    // runs. BusinessGuard lets a SUPER_ADMIN through, so without it a
    // SUPER_ADMIN with no Membership posted into any business's ledger.
    if (!userId) throw new ForbiddenException('No access to this business');
    await this.ensureAccess(userId, businessId);
    // PR195-PORT (owner PR #195, the General Journal page): a body with no
    // line list answers 400 instead of throwing 500 on .reduce, and amounts
    // sent as strings are read as numbers. A currency, when sent, goes to the
    // door as written: the door posts the business currency and refuses a
    // manual journal in any other with 400 (D-13, V1-37), rather than this
    // route re-labelling the amounts. The PR's per-line financialAccountId is
    // not taken: the door keeps cash per chart row (V1-34).
    if (!Array.isArray(body?.entries) || body.entries.length < 2) {
      throw new BadRequestException('Journal entry requires at least 2 lines');
    }
    let currency: string | undefined;
    if (body.currency !== undefined && body.currency !== null && String(body.currency).trim() !== '') {
      currency = String(body.currency).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException(`Invalid currency code: ${String(body.currency)}`);
    }
    const totalDebit = body.entries.reduce((sum, e) => sum + (Number(e.debit) || 0), 0);
    const input: PostingInput = {
      businessId,
      type: 'ADJUSTMENT',
      date: (() => { const d = new Date(body.date); if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date'); return d; })(),
      amount: totalDebit,
      ...(currency ? { currency } : {}),
      description: body.description,
      reference: body.reference ?? null,
      notes: body.notes ?? null,
      entries: body.entries.map((e) => ({
        accountId: e.accountId,
        debit: Number(e.debit) || 0,
        credit: Number(e.credit) || 0,
        memo: e.memo,
      })),
      createdById: userId ?? null,
    };
    return this.posting.post(input);
  }

  // FOLLOW3-A6 review SEC-A5A6-02 (D-57): the manual journal lines are
  // general-ledger lines (BRS-01), so the list needs revenue:read too; and
  // SEC-A5A6-04: the membership check, so a non-member SUPER_ADMIN (whom
  // ModuleScopeGuard and BusinessGuard pass) reads no ledger line.
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('journal-entries')
  async listJournalEntries(
    @Param('businessId') businessId: string,
    @Req() req: { user: AuthenticatedUser },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('accountId') accountId?: string,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    const where: any = { businessId, type: 'ADJUSTMENT' };
    if (from || to) {
      where.date = {};
      if (from) { const d = new Date(from); if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid from date'); where.date.gte = d; }
      if (to) { const d = new Date(to); if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid to date'); where.date.lte = d; }
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
  // FOLLOW3-A6 (owner ruling D-57): the Books reads that carry revenue and
  // cash figures (general ledger, per-account balance, receivables aging,
  // customer balance, overview, safe-to-spend) need revenue:read, the
  // trial-balance gate below; no new module key. ModuleScopeGuard runs after
  // the class guards and refuses a revenue:none member with 403 before the
  // handler, so nothing is read or seeded for them. Review SEC-A5A6-02: the
  // routes that serve the same figures again (GET journal-entries, the
  // accountant export ZIP, its signed URL and its email, money-moves and the
  // cashflow forecast) carry the same gate. Review SEC-A5A6-04: each of these
  // reads also runs ensureAccess, so a non-member SUPER_ADMIN (whom
  // BusinessGuard and ModuleScopeGuard pass) is refused on every one.
  // A distinguished owner (Business.ownerId) with no Membership row is refused
  // by BusinessGuard and ensureAccess (owner ruling D-104, W10-OWNER-MEMBERSHIP;
  // review CR-A6-02, BRS-12).
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
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
      from: from ? (() => { const d = new Date(from); if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid from date'); return d; })() : undefined,
      to: to ? (() => { const d = new Date(to); if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid to date'); return d; })() : undefined,
      page: page ? (() => { const n = parseInt(page, 10); if (Number.isNaN(n)) throw new BadRequestException('Invalid page'); return n; })() : undefined,
      pageSize: pageSize ? (() => { const n = parseInt(pageSize, 10); if (Number.isNaN(n)) throw new BadRequestException('Invalid pageSize'); return n; })() : undefined,
    });
  }

  /**
   * V1-37b review SEC-V37b-1: the trial balance carries the REVENUE rows per
   * currency, so it needs revenue:read (ModuleScopeGuard, the gate of the
   * commerce revenue reads): a member whose revenue scope is none is refused
   * with 403 before anything is read. FOLLOW3-A6 (D-57) applies the same
   * gate to the sibling Books reads that carry revenue and cash figures.
   */
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('trial-balance')
  async getTrialBalance(
    @Param('businessId') businessId: string,
    @Req() req: Request,
    @Query('asOf') asOf?: string,
  ) {
    await this.ensureAccess((req as any).user.id, businessId);
    const result = await this.ledgerBalance.getTrialBalance(businessId, asOf ? (() => { const d = new Date(asOf); if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid asOf date'); return d; })() : undefined);
    // V1-37b (V1-37 review ST-V37-3 / RV37-01): the service answers one row per
    // (account, currency). Each item carries its currency, so an account that
    // saw TTD and USD is two labelled items, never two unlabelled ones a
    // client keys or totals by account alone.
    return {
      items: result.map((r) => ({
        accountId: r.accountId,
        systemKey: r.systemKey,
        name: r.name,
        type: r.type,
        currency: r.currency,
        debit: r.debit.toString(),
        credit: r.credit.toString(),
        net: r.net.toString(),
      })),
    };
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('trial-balance/account/:accountId')
  async getAccountBalance(
    @Param('businessId') businessId: string,
    @Param('accountId') accountId: string,
    @Req() req: Request,
    @Query('asOf') asOf?: string,
  ) {
    await this.ensureAccess((req as any).user.id, businessId);
    // FOLLOW3-A5: the balance is an aggregate by accountId alone (aggregate is
    // not tenant-hooked), so the account must be the route business's own
    // chart row first; another business's id answers like an unknown one.
    const account = await this.prisma.client.chartOfAccount.findFirst({
      where: { id: accountId, businessId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('Account not found');
    const balance = await this.ledgerBalance.getAccountBalance(accountId, asOf ? new Date(asOf) : undefined);
    return { accountId, balance: balance.toString() };
  }

  private async ensureAccess(userId: string, businessId: string) {
    const biz = await this.prisma.client.business.findFirst({
      // Owner ruling D-104 (W10-OWNER-MEMBERSHIP): a Membership is the one access rule.
      where: { id: businessId, members: { some: { userId } } },
      select: { id: true },
    });
    if (!biz) throw new ForbiddenException('No access to this business');
  }

  // ---------- Receivables (FIN2) ----------
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('receivables/aging')
  async aging(@Param('businessId') businessId: string, @Req() req: { user: AuthenticatedUser }, @Query('asOf') asOf?: string) {
    await this.ensureAccess(req.user.id, businessId);
    const date = asOf ? (() => { const d = new Date(asOf); if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid asOf date'); return d; })() : new Date();
    const [report, ledgerAr] = await Promise.all([
      this.receivables.getAging(businessId, date),
      this.receivables.getLedgerArBalance(businessId, date),
    ]);
    return { ...report, ledgerArBalance: ledgerAr };
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('customers/:contactId/balance')
  async customerBalance(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user: AuthenticatedUser },
    @Query('asOf') asOf?: string,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    const date = asOf ? new Date(asOf) : new Date();
    return this.receivables.getCustomerBalance(businessId, contactId, date);
  }

  // ---------- Overview ----------
  /**
   * W9-FINANCE-OVERVIEW (TS-22g; review SEC-W8RA-4, CR-W8RA-2; owner ruling D-63): the overview's
   * revenue actions are served to the member as GET revenue-actions serves them, so the member is
   * passed as the viewer (resolveTimelineViewer, the revenue-actions routes' own); revenue read stays
   * the gate (ModuleScopeGuard, D-57).
   */
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('overview')
  async getOverview(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const viewer = await resolveTimelineViewer(this.prisma, businessId, req.user.id);
    return this.overview.getOverview(businessId, viewer);
  }

  @Get('expense-breakdown')
  async getExpenseBreakdown(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const expenses = await this.prisma.client.expense.findMany({
      where: { businessId, date: { gte: monthStart }, deletedAt: null, status: { not: 'VOID' } },
      select: { amount: true, categoryId: true, category: { select: { name: true } } },
    });

    const totals = new Map<string, { category: string; amount: number; budget: number }>();
    for (const e of expenses) {
      const key = e.categoryId ?? 'uncategorised';
      const existing = totals.get(key);
      if (existing) {
        existing.amount += e.amount;
      } else {
        totals.set(key, {
          category: e.category?.name ?? 'Uncategorised',
          amount: e.amount,
          budget: 0,
        });
      }
    }

    const budgets = await this.prisma.client.expenseBudget.findMany({
      where: { businessId },
      select: { categoryId: true, amount: true },
    });
    for (const b of budgets) {
      if (!b.categoryId) continue;
      const entry = totals.get(b.categoryId);
      if (entry) entry.budget = b.amount;
    }

    const items = Array.from(totals.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    return { items };
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
    // V1-37b (V1-34 review CR-34-01): create posts the opening balance through
    // the ledger door; the caller is recorded as its author.
    return this.accounts.create(businessId, body, { userId: req.user.id });
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
  /**
   * R0-09f (owner ruling D-11, R0-09d sweep): Business.defaultTaxRate is a field
   * of the owner-only business profile, so a non-owner's change to it is
   * refused (403 BUSINESS_PROFILE_OWNER_ONLY) before anything is written; the
   * other finance settings keep ensureAccess (any member).
   */
  @Patch('settings')
  async patchSettings(
    @Param('businessId') businessId: string,
    @Body() body: UpdateFinanceSettingsInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    const input = await this.settings.assertTaxRateOwner(businessId, body ?? {}, req.user);
    return this.settings.update(businessId, input);
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
      sinceDate: body.since ? (() => { const d = new Date(body.since); if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid since date'); return d; })() : null,
      untilDate: body.until ? (() => { const d = new Date(body.until); if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid until date'); return d; })() : null,
      userId: req.user.id,
    });
  }

  // ---------- Recurring Journal Entries ----------
  // PR195-JOURNAL-SCOPE (CR-P195-4): a template is a manual journal that posts itself (run posts one
  // ADJUSTMENT at once, the scheduler posts the rest), so every write of one needs revenue write, as
  // POST journal-entries does; otherwise a member below it creates a template and runs it. ensureAccess
  // stays (D-46). The reads are unchanged.
  @Get('recurring-journal-entries')
  async listRecurringJournals(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.recurringJournals.list(businessId);
    return { items };
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
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

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
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

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('recurring-journal-entries/:id/run')
  async runRecurringJournal(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.recurringJournals.runOnce(businessId, id);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('recurring-journal-entries/:id/cancel')
  async cancelRecurringJournal(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.recurringJournals.cancel(businessId, id);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
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

  /**
   * Bank statement import. Multipart upload, field name `file`.
   *
   * Accepts OFX/QFX, MT940, QIF and CSV — the format is sniffed from the
   * CONTENT, so a bank that emails OFX with a .csv extension still parses
   * correctly. Route name and field kept for compatibility with the existing
   * client; it is no longer CSV-only.
   */
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
    if (!file || !file.buffer) throw new BadRequestException('A statement file is required');
    const content = file.buffer.toString('utf8');
    const result = await this.bankImport.ingest(businessId, accountId, content, {
      userId: req.user.id,
      source: 'upload',
    });
    if (autoMatch !== 'false') {
      const m = await this.bankMatch.autoMatch(businessId, accountId, { userId: req.user.id });
      return { ...result, autoMatched: m };
    }
    return result;
  }

  /**
   * Remember how this account's CSV exports are laid out.
   *
   * Column detection guesses well and guessing is not good enough for an
   * unattended import: a bank renaming "Amount" to "Value (TTD)" would start
   * failing silently. Map it once here and every later import — including an
   * automated one — is deterministic.
   */
  @Post('accounts/:accountId/import-profile')
  async saveImportProfile(
    @Param('businessId') businessId: string,
    @Param('accountId') accountId: string,
    @Body() body: ImportProfile,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankImport.saveImportProfile(businessId, accountId, body);
  }

  /**
   * Connect an automated statement source to this account.
   *
   * `driveFolderId` — anything dropped in that Drive folder is imported.
   * `gmailQuery`    — Gmail search syntax, e.g. `from:republicbank.com`.
   *
   * Both are swept nightly. Either can be run on demand below.
   *
   * W11-GOOGLE-STATEMENT-SOURCE-OWNER (owner ruling D-132, applying D-99; the owner is D-125's): a
   * source names which of the business's mail or Drive files are read into the books, so setting one
   * up is the business owner's (assertGoogleConnectOwner, 403 GOOGLE_CONNECT_OWNER_ONLY before anything
   * is stored), as running a sweep is below.
   */
  @Post('accounts/:accountId/statement-sources')
  async setStatementSources(
    @Param('businessId') businessId: string,
    @Param('accountId') accountId: string,
    @Body() body: StatementSources,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    await assertGoogleConnectOwner(this.prisma, businessId, req.user);
    return this.statementSources.setSources(businessId, accountId, body);
  }

  /**
   * Run a configured source now rather than waiting for the nightly sweep.
   *
   * W11-GOOGLE-STATEMENT-SOURCE-OWNER (D-132, D-99): it reads the business Gmail or Drive, so it is the
   * business owner's (403 GOOGLE_CONNECT_OWNER_ONLY before either is read).
   */
  @Post('accounts/:accountId/statement-sources/:source/sweep')
  async sweepStatementSource(
    @Param('businessId') businessId: string,
    @Param('accountId') accountId: string,
    @Param('source') source: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    await assertGoogleConnectOwner(this.prisma, businessId, req.user);
    if (source === 'drive') return this.statementSources.sweepDrive(businessId, accountId);
    if (source === 'gmail') return this.statementSources.sweepGmail(businessId, accountId);
    throw new BadRequestException('source must be "drive" or "gmail"');
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
      sinceDate: since ? (() => { const d = new Date(since); if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid since date'); return d; })() : null,
      untilDate: until ? (() => { const d = new Date(until); if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid until date'); return d; })() : null,
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
      periodStart: (() => { const d = new Date(body.periodStart); if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid periodStart'); return d; })(),
      periodEnd: (() => { const d = new Date(body.periodEnd); if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid periodEnd'); return d; })(),
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
  // FOLLOW3-A6 review SEC-A5A6-02 (D-57, every money report): the ZIP holds
  // trial-balance.csv, general-ledger.csv and ar-aging.csv, the figures the
  // trial-balance gate and the six Books reads refuse a revenue:none member,
  // so the stream, the signed URL and the email below need revenue:read.
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
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
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
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
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('safe-to-spend')
  async getSafeToSpend(@Param('businessId') businessId: string, @Req() req: { user: AuthenticatedUser }) {
    await this.ensureAccess(req.user.id, businessId);
    return this.safeToSpend.calculate(businessId);
  }

  // ---------- Cashflow Forecast ----------
  // Review SEC-A5A6-02/04: the forecast opens on the cash balance and counts
  // the open receivables (the safe-to-spend and aging figures), and money-moves
  // below names the overdue receivables total: revenue:read and membership.
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('cashflow-forecast')
  async getCashflowForecast(
    @Param('businessId') businessId: string,
    @Req() req: { user: AuthenticatedUser },
    @Query('days') days?: string,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    const daysNum = days ? parseInt(days, 10) : 90;
    if (days && Number.isNaN(daysNum)) throw new BadRequestException('Invalid days');
    return this.cashflowForecast.forecast(businessId, daysNum);
  }

  // ---------- Money Moves ----------
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('money-moves')
  async getMoneyMoves(@Param('businessId') businessId: string, @Req() req: { user: AuthenticatedUser }) {
    await this.ensureAccess(req.user.id, businessId);
    return this.moneyMoves.generate(businessId);
  }

  /**
   * Email the Accountant Export ZIP directly to a recipient. Uses the
   * business's configured `accountantEmail` when `to` is omitted; pass
   * `saveRecipient: true` to persist a new address as the new default.
   */
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
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
    try {
      return await this.accountantExportEmail.send({
        businessId,
        periodStart,
        periodEnd,
        basis: body?.basis,
        to: body?.to ?? null,
        message: body?.message ?? null,
        saveRecipient: Boolean(body?.saveRecipient),
        userId: req.user.id,
      });
    } catch (err) {
      // W5-SYSTEM-EMAIL-CALLERS (SEC-W4HK-1, 9B-D2): this error escapes to the
      // global filter, whose 500 line logs its stack and whose error registry
      // keeps its message. The sink's message can quote the recipient, so the
      // same error class, outcome and provider code go on with any address
      // redacted (and no cause attached). The 500 response is unchanged.
      if (err instanceof SystemEmailSendError) {
        throw new SystemEmailSendError(redactAddresses(err.message), err.outcome, err.providerCode);
      }
      throw err;
    }
  }

  // ---------- Cash Reserve Buckets ----------
  @Get('reserves')
  async listReserves(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.cashReserve.list(businessId);
    return { items };
  }

  @Post('reserves')
  async createReserve(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; purpose: string; targetAmount?: number; currentAmount?: number; currency?: string },
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.cashReserve.create(businessId, body);
  }

  @Patch('reserves/:id')
  async updateReserve(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: Partial<{ name: string; purpose: string; targetAmount: number; currentAmount: number; status: string }>,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.cashReserve.update(businessId, id, body);
  }

  @Delete('reserves/:id')
  async deleteReserve(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.cashReserve.delete(businessId, id);
  }

  // ---------- Credit Notes ----------
  // V1-44b (V1-44 review SEC-V44-1, owner ruling D-57): a credit note moves
  // money once applied (a revenue reversal, the receivable reduced, the
  // invoice credited), so every credit-note write (create, PATCH, apply, void,
  // DELETE) needs revenue:write, the invoice status door's gate, and the reads
  // (list, detail: invoice total, status, contactId) need revenue:read.
  // ModuleScopeGuard runs after the class guards and refuses before the
  // handler, so a refused call reads and writes nothing; ensureAccess still
  // refuses a non-member SUPER_ADMIN (D-46), whom both guards pass.
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('credit-notes')
  async listCreditNotes(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.creditNotes.list(businessId);
    return { items };
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('credit-notes')
  async createCreditNote(
    @Param('businessId') businessId: string,
    @Body() body: CreateCreditNoteInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    // V1-44b review (SEC-V44b-R1, CRR-V44b-1): 'CN-DRIVE-' numbers belong to
    // the Drive-intake plan steps, which answer a note carrying their number
    // as their own; a member-made one would be applied in the approver's name.
    if (
      typeof body?.creditNoteNumber === 'string' &&
      body.creditNoteNumber.trim().toUpperCase().startsWith(RESERVED_CREDIT_NOTE_NUMBER_PREFIX)
    ) {
      throw new BadRequestException(`Credit note numbers starting ${RESERVED_CREDIT_NOTE_NUMBER_PREFIX} are reserved for Drive intake`);
    }
    return this.creditNotes.create(businessId, body);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('credit-notes/:id')
  async getCreditNote(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.creditNotes.get(businessId, id);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Patch('credit-notes/:id')
  async updateCreditNote(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: UpdateCreditNoteInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.creditNotes.update(businessId, id, body);
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('credit-notes/:id/apply')
  async applyCreditNote(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.creditNotes.apply(businessId, id, { userId: req.user?.id });
  }

  // V1-44b (SEC-V44-5): the member who voids is recorded on the reversal
  // posting of an APPLIED note, as apply records the member on the original.
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('credit-notes/:id/void')
  async voidCreditNote(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.creditNotes.void(businessId, id, { userId: req.user?.id });
  }

  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Delete('credit-notes/:id')
  async deleteCreditNote(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.creditNotes.remove(businessId, id);
  }

  // ---------- Accounting Periods ----------
  @Get('accounting-periods')
  async listAccountingPeriods(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.accountingPeriods.list(businessId);
    return { items };
  }

  @Post('accounting-periods')
  async createAccountingPeriod(
    @Param('businessId') businessId: string,
    @Body() body: CreateAccountingPeriodInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.accountingPeriods.create(businessId, body);
  }

  @Get('accounting-periods/:id')
  async getAccountingPeriod(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.accountingPeriods.get(businessId, id);
  }

  @Patch('accounting-periods/:id')
  async updateAccountingPeriod(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: Partial<CreateAccountingPeriodInput>,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    // V1-15b repair2 (review SEC9-1): the owner's or an admin's call, like close / reopen.
    return this.accountingPeriods.update(businessId, id, body, { actorId: req.user?.id });
  }

  @Post('accounting-periods/:id/close')
  async closeAccountingPeriod(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: CloseAccountingPeriodInput,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.accountingPeriods.close(businessId, id, { closedById: req.user?.id });
  }

  @Post('accounting-periods/:id/reopen')
  async reopenAccountingPeriod(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.accountingPeriods.reopen(businessId, id);
  }

  @Delete('accounting-periods/:id')
  async deleteAccountingPeriod(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    // V1-15b repair2 (review SEC9-1): the owner's or an admin's call, like close / reopen.
    return this.accountingPeriods.remove(businessId, id, { actorId: req.user?.id });
  }

  // ---------- Bank Connections ----------
  @Get('bank-connections')
  async listBankConnections(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.bankConnections.list(businessId);
    return { items };
  }

  @Post('bank-connections')
  async createBankConnection(@Param('businessId') businessId: string, @Body() body: CreateBankConnectionInput, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankConnections.create(businessId, body);
  }

  @Get('bank-connections/:id')
  async getBankConnection(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankConnections.get(businessId, id);
  }

  @Patch('bank-connections/:id')
  async updateBankConnection(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: UpdateBankConnectionInput, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankConnections.update(businessId, id, body);
  }

  @Post('bank-connections/:id/sync')
  async syncBankConnection(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: { cursor?: string }, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankConnections.recordSync(businessId, id, body.cursor);
  }

  @Delete('bank-connections/:id')
  async deleteBankConnection(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.bankConnections.remove(businessId, id);
  }

  // ---------- Exchange Rates ----------
  @Get('exchange-rates')
  async listExchangeRates(
    @Param('businessId') businessId: string,
    @Req() req: any,
    @Query('from') fromCurrency?: string,
    @Query('to') toCurrency?: string,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.exchangeRates.list(businessId, fromCurrency && toCurrency ? { from: fromCurrency, to: toCurrency } : undefined);
    return { items };
  }

  @Post('exchange-rates')
  async createExchangeRate(@Param('businessId') businessId: string, @Body() body: CreateExchangeRateInput, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.exchangeRates.create(businessId, body);
  }

  @Post('exchange-rates/bulk')
  async bulkCreateExchangeRates(@Param('businessId') businessId: string, @Body() body: { rates: CreateExchangeRateInput[] }, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.exchangeRates.bulkCreate(businessId, body.rates);
  }

  @Get('exchange-rates/latest')
  async getLatestExchangeRate(
    @Param('businessId') businessId: string,
    @Req() req: any,
    @Query('from') fromCurrency: string,
    @Query('to') toCurrency: string,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.exchangeRates.getLatest(businessId, fromCurrency, toCurrency);
  }

  @Delete('exchange-rates/:id')
  async deleteExchangeRate(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.exchangeRates.remove(businessId, id);
  }

  // ---------- Fixed Assets ----------
  @Get('fixed-assets')
  async listFixedAssets(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.fixedAssets.list(businessId);
    return { items };
  }

  @Post('fixed-assets')
  async createFixedAsset(@Param('businessId') businessId: string, @Body() body: CreateFixedAssetInput, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.fixedAssets.create(businessId, body);
  }

  @Get('fixed-assets/:id')
  async getFixedAsset(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.fixedAssets.get(businessId, id);
  }

  @Patch('fixed-assets/:id')
  async updateFixedAsset(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: UpdateFixedAssetInput, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.fixedAssets.update(businessId, id, body);
  }

  @Post('fixed-assets/:id/depreciate')
  async depreciateFixedAsset(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: { asOf?: string }, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    if (body.asOf) {
      const asOfDate = new Date(body.asOf);
      if (Number.isNaN(asOfDate.getTime())) throw new BadRequestException('Invalid asOf date');
    }
    return this.fixedAssets.runDepreciation(businessId, id, body.asOf ? new Date(body.asOf) : undefined);
  }

  @Get('fixed-assets/:id/depreciation')
  async calculateDepreciation(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Req() req: any,
    @Query('asOf') asOf?: string,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.fixedAssets.calculateDepreciation(businessId, id, asOf ? new Date(asOf) : undefined);
  }

  @Post('fixed-assets/:id/dispose')
  async disposeFixedAsset(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { proceeds: number; disposalDate?: string },
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    return this.fixedAssets.dispose(businessId, id, body.proceeds, body.disposalDate);
  }

  @Delete('fixed-assets/:id')
  async deleteFixedAsset(@Param('businessId') businessId: string, @Param('id') id: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.fixedAssets.remove(businessId, id);
  }
}
