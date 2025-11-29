import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CommerceService } from './commerce.service';

@Controller('commerce')
export class CommerceController {
  constructor(private readonly commerce: CommerceService) {}

  @Get('businesses/:businessId/products')
  listProducts(@Param('businessId') businessId: string) {
    return this.commerce.listProducts(businessId);
  }

  @Post('businesses/:businessId/products')
  createProduct(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; price: number; currency?: string; description?: string },
  ) {
    return this.commerce.createProduct({ businessId, ...body });
  }

  @Patch('invoices/:invoiceId/paid')
  markInvoicePaid(@Param('invoiceId') invoiceId: string) {
    return this.commerce.markInvoicePaid(invoiceId);
  }
}
