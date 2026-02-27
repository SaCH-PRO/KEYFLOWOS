import { Body, Controller, Delete, ForbiddenException, Get, Inject, Logger, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CommerceService } from './commerce.service';
import { RecurringInvoiceService } from './recurring-invoice.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { ReceiptService } from './receipt.service';
import { GmailService } from './gmail.service';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';
import { buildQuoteEmailHtml } from './quote-email.template';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('commerce')
export class CommerceController {
  private readonly logger = new Logger(CommerceController.name);

  constructor(
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(RecurringInvoiceService) private readonly recurringInvoices: RecurringInvoiceService,
    @Inject(ReceiptService) private readonly receipts: ReceiptService,
    @Inject(GmailService) private readonly gmail: GmailService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private async verifyBusinessAccess(userId: string, businessId: string) {
    const business = await this.prisma.client.business.findFirst({
      where: {
        id: businessId,
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
        ],
      },
    });
    if (!business) {
      throw new ForbiddenException('You do not have access to this resource');
    }
  }

  @Get('public/businesses/:businessId/products')
  listPublicProducts(@Param('businessId') businessId: string) {
    return this.commerce.listPublicProducts(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/products')
  listProducts(
    @Param('businessId') businessId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.commerce.listProducts(
      businessId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/products')
  createProduct(
    @Param('businessId') businessId: string,
    @Body() body: CreateProductDto,
  ) {
    return this.commerce.createProduct({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/products/:productId')
  updateProduct(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
    @Body() body: Partial<CreateProductDto>,
  ) {
    return this.commerce.updateProduct({ businessId, productId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/products/:productId')
  deleteProduct(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.commerce.deleteProduct(businessId, productId);
  }

  @UseGuards(AuthGuard)
  @Patch('invoices/:invoiceId/paid')
  async markInvoicePaid(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    const invoice = await this.prisma.client.invoice.findUnique({ where: { id: invoiceId }, select: { businessId: true } });
    if (invoice) await this.verifyBusinessAccess(req.user.id, invoice.businessId);
    return this.commerce.markInvoicePaid(invoiceId, req?.user?.id);
  }

  @UseGuards(AuthGuard)
  @Patch('invoices/:invoiceId/payment-failed')
  async markInvoicePaymentFailed(
    @Param('invoiceId') invoiceId: string,
    @Req() req: any,
    @Body() body: { reason?: string },
  ) {
    const invoice = await this.prisma.client.invoice.findUnique({ where: { id: invoiceId }, select: { businessId: true } });
    if (invoice) await this.verifyBusinessAccess(req.user.id, invoice.businessId);
    return this.commerce.markInvoicePaymentFailed(invoiceId, req?.user?.id, body?.reason);
  }

  @UseGuards(AuthGuard)
  @Patch('invoices/:invoiceId/status/:status')
  async updateInvoiceStatus(
    @Param('invoiceId') invoiceId: string,
    @Param('status') status: string,
    @Req() req: any,
    @Body() body: UpdateInvoiceStatusDto,
  ) {
    const invoice = await this.prisma.client.invoice.findUnique({ where: { id: invoiceId }, select: { businessId: true } });
    if (invoice) await this.verifyBusinessAccess(req.user.id, invoice.businessId);
    return this.commerce.updateInvoiceStatus({
      invoiceId,
      status: status.toUpperCase() as 'SENT' | 'OVERDUE' | 'VOID',
      actorId: req?.user?.id,
      sentAt: body?.sentAt,
      dueDate: body?.dueDate,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/invoices')
  listInvoices(
    @Param('businessId') businessId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.commerce.listInvoices(
      businessId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/invoices')
  createInvoice(
    @Param('businessId') businessId: string,
    @Body() body: {
      contactId?: string;
      items: { description: string; quantity: number; unitPrice: number }[];
      currency?: string;
      dueDate?: string;
      taxRate?: number;
      discountType?: 'PERCENT' | 'FIXED';
      discountValue?: number;
      notes?: string;
    },
  ) {
    return this.commerce.createInvoice({ businessId, ...body });
  }

  @UseGuards(AuthGuard)
  @Patch('quotes/:quoteId/status/:status')
  async updateQuoteStatus(
    @Param('quoteId') quoteId: string,
    @Param('status') status: string,
    @Req() req: any,
  ) {
    try {
      const quote = await this.prisma.client.quote.findUnique({ where: { id: quoteId }, select: { businessId: true } });
      if (quote) await this.verifyBusinessAccess(req.user.id, quote.businessId);
      this.logger.log(`Updating quote ${quoteId} to status ${status} by user ${req?.user?.id}`);
      const result = await this.commerce.updateQuoteStatus({
        quoteId,
        status: status.toUpperCase() as UpdateQuoteStatusDto['status'],
        actorId: req?.user?.id,
      });
      this.logger.log(`Quote ${quoteId} status updated successfully`);
      return result;
    } catch (error: any) {
      this.logger.error(`Failed to update quote status: ${error?.message}`, error?.stack);
      throw error;
    }
  }

  @UseGuards(AuthGuard)
  @Get('invoices/:invoiceId/receipt')
  async getReceipt(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    const invoice = await this.prisma.client.invoice.findUnique({ where: { id: invoiceId }, select: { businessId: true } });
    if (invoice) await this.verifyBusinessAccess(req.user.id, invoice.businessId);
    return this.receipts.buildReceipt(invoiceId);
  }

  @Get('invoices/:invoiceId')
  getInvoice(@Param('invoiceId') invoiceId: string) {
    return this.commerce.getInvoiceWithBusiness(invoiceId, true);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/invoices/:invoiceId')
  deleteInvoice(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.commerce.deleteInvoice(invoiceId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/invoices/:invoiceId')
  updateInvoice(
    @Param('businessId') businessId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() body: {
      contactId?: string;
      items?: { description: string; quantity: number; unitPrice: number; productId?: string }[];
      currency?: string;
      dueDate?: string;
      taxRate?: number;
      discountType?: 'PERCENT' | 'FIXED' | null;
      discountValue?: number | null;
      notes?: string | null;
    },
  ) {
    return this.commerce.updateInvoice({ invoiceId, businessId, ...body });
  }

  // ========== QUOTES ==========

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/quotes')
  listQuotes(
    @Param('businessId') businessId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.commerce.listQuotes(
      businessId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @Get('quotes/:quoteId')
  getQuote(@Param('quoteId') quoteId: string) {
    return this.commerce.getQuote(quoteId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/quotes')
  createQuote(
    @Param('businessId') businessId: string,
    @Body() body: {
      contactId: string;
      items: { description: string; quantity: number; unitPrice: number; productId?: string }[];
      currency?: string;
      expiryDate?: string;
    },
  ) {
    return this.commerce.createQuote({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/quotes/:quoteId')
  updateQuote(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
    @Body() body: {
      contactId?: string;
      items?: { description: string; quantity: number; unitPrice: number; productId?: string }[];
      currency?: string;
      expiryDate?: string | null;
    },
  ) {
    return this.commerce.updateQuote({ quoteId, businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/quotes/:quoteId')
  deleteQuote(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
  ) {
    return this.commerce.deleteQuote(quoteId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/quotes/:quoteId/convert')
  convertQuoteToInvoice(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
    @Body() body: {
      taxRate?: number;
      discountType?: 'PERCENT' | 'FIXED';
      discountValue?: number;
      notes?: string;
      dueDate?: string;
    },
  ) {
    return this.commerce.convertQuoteToInvoice({ quoteId, businessId, ...body });
  }

  // ========== GMAIL INTEGRATION ==========

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/gmail/auth-url')
  getGmailAuthUrl(@Param('businessId') businessId: string) {
    const url = this.gmail.getAuthUrl(businessId);
    return { url };
  }

  @Get('gmail/callback')
  async handleGmailCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const frontendUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
      : 'http://localhost:5000';
    
    const parsedState = this.gmail.verifyState(state);
    if (!parsedState) {
      return res.redirect(`${frontendUrl}/app/commerce?gmail=error&reason=invalid_state`);
    }

    try {
      await this.gmail.saveGmailCredentials(parsedState.businessId, code);
      return res.redirect(`${frontendUrl}/app/commerce?gmail=success`);
    } catch {
      return res.redirect(`${frontendUrl}/app/commerce?gmail=error`);
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/gmail/status')
  getGmailStatus(@Param('businessId') businessId: string) {
    return this.gmail.getGmailStatus(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/gmail')
  disconnectGmail(@Param('businessId') businessId: string) {
    return this.gmail.disconnectGmail(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/quotes/:quoteId/send-email')
  async sendQuoteEmail(
    @Param('businessId') businessId: string,
    @Param('quoteId') quoteId: string,
    @Body() body: { recipientEmail: string; message?: string },
  ) {
    const quote = await this.commerce.getQuote(quoteId);
    if (!quote || quote.businessId !== businessId) {
      throw new Error('Quote not found');
    }

    const business = quote.business;
    const contact = quote.contact;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://keyflowos.replit.app';

    const emailHtml = buildQuoteEmailHtml({
      businessName: business.name,
      businessLogo: business.logoUrl,
      businessEmail: business.email,
      businessPhone: business.phone,
      businessAddress: business.address,
      businessWebsite: business.website,
      primaryColor: business.primaryColor || '#F97316',
      contactName: contact ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'Customer' : 'Customer',
      quoteNumber: quote.quoteNumber,
      quoteDate: new Date(quote.createdAt).toLocaleDateString('en-TT', { dateStyle: 'medium' }),
      expiryDate: quote.expiryDate ? new Date(quote.expiryDate).toLocaleDateString('en-TT', { dateStyle: 'medium' }) : null,
      items: quote.items.map((item: { description: string; quantity: number; unitPrice: number }) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      subtotal: quote.subtotal,
      taxRate: quote.taxRate,
      taxAmount: quote.taxAmount,
      discountType: quote.discountType,
      discountValue: quote.discountValue,
      discountAmount: quote.discountAmount,
      total: quote.total,
      currency: quote.currency,
      notes: quote.notes,
      quoteUrl: `${appUrl}/quote/${quote.id}`,
      customMessage: body.message,
    });

    await this.gmail.sendEmail({
      businessId,
      to: body.recipientEmail,
      subject: `Quote #${quote.quoteNumber} from ${business.name}`,
      htmlBody: emailHtml,
    });

    await this.commerce.updateQuoteStatus({
      quoteId,
      status: 'SENT',
      actorId: undefined,
    });

    return { success: true };
  }

  // ========== RECURRING INVOICES ==========

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/recurring-invoices')
  listRecurringInvoices(@Param('businessId') businessId: string) {
    return this.recurringInvoices.listRecurringInvoices(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/recurring-invoices/:id')
  getRecurringInvoice(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.recurringInvoices.getRecurringInvoice(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/recurring-invoices')
  createRecurringInvoice(
    @Param('businessId') businessId: string,
    @Body() body: {
      name: string;
      frequency: string;
      nextRunDate: string;
      endDate?: string;
      contactId: string;
      lineItems: { description: string; quantity: number; unitPrice: number; total: number; productId?: string }[];
      taxRate?: number;
      discountType?: 'PERCENT' | 'FIXED';
      discountValue?: number;
      currency?: string;
      notes?: string;
    },
  ) {
    return this.recurringInvoices.createRecurringInvoice({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/recurring-invoices/:id')
  updateRecurringInvoice(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      frequency?: string;
      nextRunDate?: string;
      endDate?: string | null;
      contactId?: string;
      lineItems?: { description: string; quantity: number; unitPrice: number; total: number; productId?: string }[];
      taxRate?: number;
      discountType?: 'PERCENT' | 'FIXED' | null;
      discountValue?: number | null;
      currency?: string;
      notes?: string | null;
      isActive?: boolean;
    },
  ) {
    return this.recurringInvoices.updateRecurringInvoice({ id, businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/recurring-invoices/:id')
  deleteRecurringInvoice(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.recurringInvoices.deleteRecurringInvoice(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/recurring-invoices/:id/toggle')
  toggleRecurringInvoice(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.recurringInvoices.toggleActive(businessId, id);
  }
}
