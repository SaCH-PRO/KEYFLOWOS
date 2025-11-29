import { Body, Controller, Inject, Post } from '@nestjs/common';
import { CommerceService } from '../commerce/commerce.service';
import { StripeWebhookDto } from './dto/stripe-webhook.dto';

@Controller('webhooks')
export class WebhooksController {
  constructor(@Inject(CommerceService) private readonly commerce: CommerceService) {}

  // Minimal Stripe checkout.session.completed handler
  @Post('stripe')
  async handleStripeWebhook(@Body() body: StripeWebhookDto) {
    return this.commerce.markInvoicePaid(body.invoiceId);
  }
}
