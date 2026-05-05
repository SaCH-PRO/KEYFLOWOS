import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { PostingService } from './posting.service';
import { LedgerBalanceService } from './ledger-balance.service';
import { FinanceAuditService } from './finance-audit.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';
import { FinancialAccountSeederService } from './financial-account-seeder.service';

/**
 * FIN1 — Finance OS foundation. No controllers in this task. Exports the
 * core services so downstream FIN2/FIN3/FIN4/FIN5/etc can inject them.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    PostingService,
    LedgerBalanceService,
    FinanceAuditService,
    ChartOfAccountsSeederService,
    FinancialAccountSeederService,
  ],
  exports: [
    PostingService,
    LedgerBalanceService,
    FinanceAuditService,
    ChartOfAccountsSeederService,
    FinancialAccountSeederService,
  ],
})
export class FinanceModule {}
