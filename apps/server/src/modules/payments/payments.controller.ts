import { Body, Controller, Get, Inject, Logger, Param, Post, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('invoice/:invoiceId/gateways')
  async getGateways(@Param('invoiceId') invoiceId: string) {
    const invoice = await this.prisma.client.invoice.findUnique({
      where: { id: invoiceId },
      select: { businessId: true },
    });
    if (!invoice) throw new Error('Invoice not found');
    return this.payments.getAvailableGateways(invoice.businessId);
  }

  @Post('invoice/:invoiceId/wipay')
  async createWipayCheckout(
    @Param('invoiceId') invoiceId: string,
    @Body() body: { returnUrl: string },
  ) {
    return this.payments.createWipayCheckout(invoiceId, body.returnUrl);
  }

  @Get('wipay/callback')
  async handleWipayCallback(@Query() queryParams: Record<string, string>) {
    return this.payments.handleWipayCallback(queryParams);
  }

  @Post('invoice/:invoiceId/paypal/create-order')
  async createPaypalOrder(@Param('invoiceId') invoiceId: string) {
    return this.payments.createPaypalOrder(invoiceId);
  }

  @Post('paypal/capture/:orderId')
  async capturePaypalOrder(
    @Param('orderId') orderId: string,
    @Body() body: { invoiceId: string },
  ) {
    return this.payments.capturePaypalOrder(orderId, body.invoiceId);
  }

  @Get('paypal/setup')
  async getPaypalSetup() {
    return this.payments.getPaypalClientToken();
  }

  @Get('invoice/:invoiceId/status')
  async getInvoicePaymentStatus(@Param('invoiceId') invoiceId: string) {
    return this.payments.getInvoicePaymentStatus(invoiceId);
  }
}
