import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AuthModule } from '../../core/auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { CommerceModule } from '../commerce/commerce.module';
import { FinanceIntelligenceService } from './finance-intelligence.service';
import { FinanceIntelligenceSchedulerService } from './finance-intelligence.scheduler';
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
import { ExpensePostingService } from './expense-posting.service';
import { TaxLiabilityService } from './tax-liability.service';
import { TaxLiabilityRollupScheduler } from './tax-liability-rollup.scheduler';
import { AccountantExportService } from './accountant-export.service';
import { AccountantExportEmailService } from './accountant-export-email.service';
import { SystemEmailService } from '../notifications/system-email.service';
import { FinanceController } from './finance.controller';

/**
 * FIN1/FIN2 — Finance OS foundation + revenue/receivables read APIs.
 * FIN3 — Adds ExpensePostingService for expense/bill/PO/COGS recipes,
 * invoked synchronously by Expenses, Marketplace, and Commerce modules
 * inside the same Prisma $transaction as the source-row write (no async
 * listeners — atomic ledger + source commit).
 * FIN5 — Adds the unified `/finance/businesses/:bid/*` controller for the
 * new Finance cockpit (Overview, Accounts CRUD, COA CRUD, Tax Rates,
 * Settings) plus its sub-services.
 */
@Module({
  imports: [PrismaModule, AuthModule, AiModule, forwardRef(() => CommerceModule)],
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
    ExpensePostingService,
    TaxLiabilityService,
    TaxLiabilityRollupScheduler,
    AccountantExportService,
    FinanceIntelligenceService,
    FinanceIntelligenceSchedulerService,
    AccountantExportEmailService,
    SystemEmailService,
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
    ExpensePostingService,
    FinanceIntelligenceService,
  ],
})
export class FinanceModule {}
