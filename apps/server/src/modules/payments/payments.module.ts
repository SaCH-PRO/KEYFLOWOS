import { Module, forwardRef } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsOpsController } from './payments-ops.controller';
import { PaymentsOpsService } from './payments-ops.service';
import { CurrencyRatesService } from './currency-rates.service';
import { CurrencyRatesScheduler } from './currency-rates.scheduler';
import { CommerceModule } from '../commerce/commerce.module';
import { FinanceModule } from '../finance/finance.module';
import { SiteModule } from '../site/site.module';

@Module({
  imports: [CommerceModule, FinanceModule, forwardRef(() => SiteModule)],
  controllers: [PaymentsController, PaymentsOpsController],
  providers: [PaymentsService, PaymentsOpsService, CurrencyRatesService, CurrencyRatesScheduler],
  exports: [PaymentsService, PaymentsOpsService, CurrencyRatesService],
})
export class PaymentsModule {}
