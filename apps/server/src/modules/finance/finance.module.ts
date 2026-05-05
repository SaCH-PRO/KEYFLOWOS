import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthModule } from '../../core/auth/auth.module';
import { PostingService } from './posting.service';
import { LedgerBalanceService } from './ledger-balance.service';
import { FinanceAuditService } from './finance-audit.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';
import { FinancialAccountSeederService } from './financial-account-seeder.service';
import { RevenuePostingService } from './revenue-posting.service';
import { ReceivablesService } from './receivables.service';
import { FinanceOverviewService } from './finance-overview.service';
import { FinanceAccountsService } from './finance-accounts.service';
import { FinanceCoaService } from './finance-coa.service';
import { FinanceTaxRateService } from './finance-tax-rate.service';
import { FinanceSettingsService } from './finance-settings.service';
import { BankImportService } from './bank-import.service';
import { BankMatchingService } from './bank-matching.service';
import { ReconciliationService } from './reconciliation.service';
import { FinanceController } from './finance.controller';

/**
 * FIN1/FIN2 — Finance OS foundation + revenue/receivables read APIs.
 * FIN5 — Adds the unified `/finance/businesses/:bid/*` controller for the
 * new Finance cockpit (Overview, Accounts CRUD, COA CRUD, Tax Rates,
 * Settings) plus its sub-services.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [FinanceController],
  providers: [
    PostingService,
    LedgerBalanceService,
    FinanceAuditService,
    ChartOfAccountsSeederService,
    FinancialAccountSeederService,
    RevenuePostingService,
    ReceivablesService,
    FinanceOverviewService,
    FinanceAccountsService,
    FinanceCoaService,
    FinanceTaxRateService,
    FinanceSettingsService,
    BankImportService,
    BankMatchingService,
    ReconciliationService,
  ],
  exports: [
    PostingService,
    LedgerBalanceService,
    FinanceAuditService,
    ChartOfAccountsSeederService,
    FinancialAccountSeederService,
    RevenuePostingService,
    ReceivablesService,
    FinanceOverviewService,
    FinanceAccountsService,
    FinanceCoaService,
    FinanceTaxRateService,
    FinanceSettingsService,
    BankImportService,
    BankMatchingService,
    ReconciliationService,
  ],
})
export class FinanceModule {}
