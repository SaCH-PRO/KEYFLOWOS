import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CreateProductDto } from '../commerce/dto/create-product.dto';
import { BulkProductsDto } from '../commerce/dto/bulk-products.dto';
import { CreateCatalogServiceDto, UpdateCatalogServiceDto, BatchCatalogServicesDto } from './dto/catalog-service.dto';

/**
 * Canonical Catalog HTTP surface. Store/Commerce/Bookings continue to
 * expose their existing endpoints as deprecated thin pass-throughs.
 */
@Controller('catalog')
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  // ----- Products -----

  @Get('public/businesses/:businessId/products')
  listPublicProducts(@Param('businessId') businessId: string) {
    return this.catalog.listPublicProducts(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/products')
  listProducts(
    @Param('businessId') businessId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.catalog.listProducts(
      businessId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/products')
  createProduct(@Param('businessId') businessId: string, @Body() body: CreateProductDto) {
    return this.catalog.createProduct({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/products/bulk')
  bulkUpdateProducts(@Param('businessId') businessId: string, @Body() body: BulkProductsDto) {
    return this.catalog.bulkUpdateProducts(businessId, body.ids, body.action);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/products/:productId')
  updateProduct(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
    @Body() body: Partial<CreateProductDto>,
  ) {
    return this.catalog.updateProduct({ businessId, productId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/products/:productId')
  deleteProduct(@Param('businessId') businessId: string, @Param('productId') productId: string) {
    return this.catalog.deleteProduct(businessId, productId);
  }

  // ----- Services -----

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/services')
  listServices(@Param('businessId') businessId: string) {
    return this.catalog.listServices(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/services')
  createService(@Param('businessId') businessId: string, @Body() body: CreateCatalogServiceDto) {
    return this.catalog.createService({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/services/:serviceId')
  updateService(
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
    @Body() body: UpdateCatalogServiceDto,
  ) {
    return this.catalog.updateService({ businessId, serviceId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/services/:serviceId')
  deleteService(@Param('businessId') businessId: string, @Param('serviceId') serviceId: string) {
    return this.catalog.deleteService(businessId, serviceId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/services/batch')
  batchServices(@Param('businessId') businessId: string, @Body() body: BatchCatalogServicesDto) {
    return this.catalog.batchServices(businessId, body);
  }
}
