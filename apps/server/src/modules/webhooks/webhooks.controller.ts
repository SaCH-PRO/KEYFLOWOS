import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CommerceService } from '../commerce/commerce.service';
import { StripeWebhookDto } from './dto/stripe-webhook.dto';
import { randomBytes } from 'crypto';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'webhooks' };
  }

  @Post('stripe')
  async handleStripeWebhook(@Body() body: StripeWebhookDto) {
    return this.commerce.markInvoicePaid(body.invoiceId);
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
}
