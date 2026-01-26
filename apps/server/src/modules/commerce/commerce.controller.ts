import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { CommerceService } from './commerce.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { ReceiptService } from './receipt.service';
import { UpdateInvoiceStatusDto } from './dto/update-invoice-status.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';

@Controller('commerce')
export class CommerceController {
  constructor(private readonly commerce: CommerceService, private readonly receipts: ReceiptService) {}

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
  @Patch('products/:productId')
  updateProduct(@Param('productId') productId: string, @Body() body: UpdateProductDto) {
    return this.commerce.updateProduct({
      productId,
      name: body.name,
      price: body.price,
      currency: body.currency,
      description: body.description,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('products/:productId')
  deleteProduct(@Param('productId') productId: string) {
    return this.commerce.deleteProduct(productId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('invoices/:invoiceId/paid')
  markInvoicePaid(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    return this.commerce.markInvoicePaid(invoiceId, req?.user?.id);
  }

  @Post('public/invoices/:invoiceId/paid')
  markInvoicePaidPublic(@Param('invoiceId') invoiceId: string) {
    return this.commerce.markInvoicePaid(invoiceId, null);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('invoices/:invoiceId/payment-failed')
  markInvoicePaymentFailed(
    @Param('invoiceId') invoiceId: string,
    @Req() req: any,
    @Body() body: { reason?: string },
  ) {
    return this.commerce.markInvoicePaymentFailed(invoiceId, req?.user?.id, body?.reason);
  }

  @UseGuards(AuthGuard, BusinessGuard)
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
  createInvoice(@Param('businessId') businessId: string, @Body() body: CreateInvoiceDto) {
    return this.commerce.createInvoice({
      businessId,
      contactId: body.contactId,
      issueDate: body.issueDate ? new Date(body.issueDate) : undefined,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      status: body.status,
      currency: body.currency,
      items: body.items,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('invoices/:invoiceId')
  getInvoice(@Param('invoiceId') invoiceId: string) {
    return this.commerce.getInvoice(invoiceId);
  }

  @Get('public/invoices/:invoiceId')
  getInvoicePublic(@Param('invoiceId') invoiceId: string) {
    return this.commerce.getInvoice(invoiceId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('invoices/:invoiceId')
  updateInvoice(@Param('invoiceId') invoiceId: string, @Body() body: UpdateInvoiceDto) {
    return this.commerce.updateInvoice({
      invoiceId,
      contactId: body.contactId,
      issueDate: body.issueDate ? new Date(body.issueDate) : undefined,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      status: body.status,
      currency: body.currency,
      items: body.items,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('invoices/:invoiceId')
  deleteInvoice(@Param('invoiceId') invoiceId: string) {
    return this.commerce.deleteInvoice(invoiceId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
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

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/quotes')
  listQuotes(@Param('businessId') businessId: string) {
    return this.commerce.listQuotes(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/quotes')
  createQuote(@Param('businessId') businessId: string, @Body() body: CreateQuoteDto) {
    return this.commerce.createQuote({
      businessId,
      contactId: body.contactId,
      issueDate: body.issueDate ? new Date(body.issueDate) : undefined,
      expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
      status: body.status,
      currency: body.currency,
      items: body.items,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('quotes/:quoteId')
  getQuote(@Param('quoteId') quoteId: string) {
    return this.commerce.getQuote(quoteId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('quotes/:quoteId')
  updateQuote(@Param('quoteId') quoteId: string, @Body() body: UpdateQuoteDto) {
    return this.commerce.updateQuote({
      quoteId,
      contactId: body.contactId,
      issueDate: body.issueDate ? new Date(body.issueDate) : undefined,
      expiryDate: body.expiryDate ? new Date(body.expiryDate) : undefined,
      status: body.status,
      currency: body.currency,
      items: body.items,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('quotes/:quoteId')
  deleteQuote(@Param('quoteId') quoteId: string) {
    return this.commerce.deleteQuote(quoteId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('invoices/:invoiceId/receipt')
  getReceipt(@Param('invoiceId') invoiceId: string) {
    return this.receipts.buildReceipt(invoiceId);
  }

  @Get('public/invoices/:invoiceId/receipt')
  getReceiptPublic(@Param('invoiceId') invoiceId: string) {
    return this.receipts.buildReceipt(invoiceId);
  }
}
