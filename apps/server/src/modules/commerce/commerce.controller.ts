import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { CommerceService } from './commerce.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { ReceiptService } from './receipt.service';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';

@Controller('commerce')
export class CommerceController {
  constructor(
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(ReceiptService) private readonly receipts: ReceiptService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/products')
  listProducts(@Param('businessId') businessId: string) {
    return this.commerce.listProducts(businessId);
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
  markInvoicePaid(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    return this.commerce.markInvoicePaid(invoiceId, req?.user?.id);
  }

  @UseGuards(AuthGuard)
  @Patch('invoices/:invoiceId/payment-failed')
  markInvoicePaymentFailed(
    @Param('invoiceId') invoiceId: string,
    @Req() req: any,
    @Body() body: { reason?: string },
  ) {
    return this.commerce.markInvoicePaymentFailed(invoiceId, req?.user?.id, body?.reason);
  }

  @UseGuards(AuthGuard)
  @Patch('invoices/:invoiceId/status/:status')
  updateInvoiceStatus(
    @Param('invoiceId') invoiceId: string,
    @Param('status') status: string,
    @Req() req: any,
    @Body() body: UpdateInvoiceStatusDto,
  ) {
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
  listInvoices(@Param('businessId') businessId: string) {
    return this.commerce.listInvoices(businessId);
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
  updateQuoteStatus(
    @Param('quoteId') quoteId: string,
    @Param('status') status: string,
    @Req() req: any,
  ) {
    return this.commerce.updateQuoteStatus({
      quoteId,
      status: status.toUpperCase() as UpdateQuoteStatusDto['status'],
      actorId: req?.user?.id,
    });
  }

  @UseGuards(AuthGuard)
  @Get('invoices/:invoiceId/receipt')
  getReceipt(@Param('invoiceId') invoiceId: string) {
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
  listQuotes(@Param('businessId') businessId: string) {
    return this.commerce.listQuotes(businessId);
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
}
