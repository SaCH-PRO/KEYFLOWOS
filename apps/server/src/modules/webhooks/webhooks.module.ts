import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  // R0-20b: the legacy Stripe route hands verified events to the Stripe ledger door (PaymentsService).
  imports: [PaymentsModule],
  controllers: [WebhooksController],
  providers: [WebhookDispatcherService],
  exports: [WebhookDispatcherService],
})
export class WebhooksModule {}
