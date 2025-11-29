import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CommerceService } from './commerce.service';
import { AuthGuard } from '../../core/auth/auth.guard';

@Controller('commerce')
export class CommerceController {
  constructor(private readonly commerce: CommerceService) {}

  @UseGuards(AuthGuard)
  @Get('businesses/:businessId/products')
  listProducts(@Param('businessId') businessId: string) {
    return this.commerce.listProducts(businessId);
  }

  @UseGuards(AuthGuard)
  @Post('businesses/:businessId/products')
  createProduct(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; price: number; currency?: string; description?: string },
  ) {
    return this.commerce.createProduct({ businessId, ...body });
  }

  @UseGuards(AuthGuard)
  @Patch('invoices/:invoiceId/paid')
  markInvoicePaid(@Param('invoiceId') invoiceId: string) {
    return this.commerce.markInvoicePaid(invoiceId);
  }
}
