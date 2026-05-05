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
import { FinanceController } from './finance.controller';

/**
 * FIN1/FIN2 — Finance OS foundation + revenue/receivables read APIs.
 * Exports posting + receivables services so downstream modules
 * (commerce, payments, scripts) can wire revenue events through here.
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
  ],
  exports: [
    PostingService,
    LedgerBalanceService,
    FinanceAuditService,
    ChartOfAccountsSeederService,
    FinancialAccountSeederService,
    RevenuePostingService,
    ReceivablesService,
  ],
})
export class FinanceModule {}
