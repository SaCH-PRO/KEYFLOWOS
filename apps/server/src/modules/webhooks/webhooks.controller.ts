import { Body, Controller, Delete, Get, Inject, Param, Post, Query, UseGuards, Optional, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CommerceService } from '../commerce/commerce.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { StripeConnector } from '../../core/connectors/implementations/stripe.connector';
import { StripeWebhookDto } from './dto/stripe-webhook.dto';
import { randomBytes } from 'crypto';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(WebhookDispatcherService) private readonly dispatcher: WebhookDispatcherService,
    @Optional() @Inject(StripeConnector) private readonly stripeConnector?: StripeConnector,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'webhooks' };
  }

  @Post('stripe')
  async handleStripeWebhook(@Body() body: StripeWebhookDto) {
    const result = await this.commerce.markInvoicePaid(body.invoiceId);

    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: body.invoiceId },
      select: { businessId: true, total: true, currency: true },
    });

    if (invoice) {
      this.stripeConnector?.emitPaymentReceived(invoice.businessId, {
        amount: Number(invoice.total),
        currency: invoice.currency,
        invoiceId: body.invoiceId,
        externalId: body.invoiceId,
      }).catch((e) => this.logger.warn(`Stripe connector event emission failed: ${e.message}`));
    }

    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/webhooks')
  async list(@Param('businessId') businessId: string) {
    return this.prisma.client.webhook.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/webhooks')
  async create(
    @Param('businessId') businessId: string,
    @Body() body: { url: string; events: string[]; name?: string },
  ) {
    if (!body.url || !body.url.startsWith('http')) {
      return { error: 'A valid URL starting with http:// or https:// is required' };
    }
    if (!body.events || body.events.length === 0) {
      return { error: 'At least one event must be selected' };
    }
    const secret = randomBytes(32).toString('hex');
    return this.prisma.client.webhook.create({
      data: {
        businessId,
        url: body.url,
        events: body.events,
        name: body.name || 'Webhook',
        secret,
        isActive: true,
      },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/webhooks/:webhookId')
  async remove(
    @Param('businessId') businessId: string,
    @Param('webhookId') webhookId: string,
  ) {
    const deleted = await this.prisma.client.webhook.deleteMany({
      where: { id: webhookId, businessId },
    });
    if (deleted.count === 0) {
      return { error: 'Webhook not found or not owned by this business' };
    }
    return { success: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/webhooks/:webhookId/test')
  async testWebhook(
    @Param('businessId') businessId: string,
    @Param('webhookId') webhookId: string,
  ) {
    const result = await this.dispatcher.sendTestEvent(webhookId, businessId);
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/webhooks/:webhookId/deliveries')
  async deliveries(
    @Param('businessId') businessId: string,
    @Param('webhookId') webhookId: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50;
    return this.dispatcher.getDeliveryLogs(businessId, webhookId, parsedLimit);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/webhooks/:webhookId/toggle')
  async toggleWebhook(
    @Param('businessId') businessId: string,
    @Param('webhookId') webhookId: string,
    @Body() body: { isActive: boolean },
  ) {
    const updated = await this.prisma.client.webhook.updateMany({
      where: { id: webhookId, businessId },
      data: { isActive: body.isActive },
    });
    if (updated.count === 0) {
      return { error: 'Webhook not found or not owned by this business' };
    }
    return { success: true, isActive: body.isActive };
  }
}
