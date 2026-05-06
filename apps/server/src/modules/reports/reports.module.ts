import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { LedgerReportingService } from './ledger-reporting.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { FinanceModule } from '../finance/finance.module';

/**
 * FIN4 — Reports module owns the read-only report query layer
 * (`LedgerReportingService`) and the generated/AI-driven report surface
 * (`ReportsService`). Imports `FinanceModule` so we can derive every
 * figure from the ledger via `LedgerBalanceService` /
 * `ReceivablesService`, instead of summing source rows.
 */
@Module({
  imports: [PrismaModule, AiModule, FinanceModule],
  controllers: [ReportsController],
  providers: [ReportsService, LedgerReportingService],
  exports: [LedgerReportingService],
})
export class ReportsModule {}
