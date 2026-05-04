import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsOpsController } from './payments-ops.controller';
import { PaymentsOpsService } from './payments-ops.service';
import { CurrencyRatesService } from './currency-rates.service';
import { CurrencyRatesScheduler } from './currency-rates.scheduler';
import { CommerceModule } from '../commerce/commerce.module';

@Module({
  imports: [CommerceModule],
  controllers: [PaymentsController, PaymentsOpsController],
  providers: [PaymentsService, PaymentsOpsService, CurrencyRatesService, CurrencyRatesScheduler],
  exports: [PaymentsService, PaymentsOpsService, CurrencyRatesService],
})
export class PaymentsModule {}
