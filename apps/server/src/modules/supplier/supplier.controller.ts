// @keyflow:dormant — UI surface gated by featureFlags (KEY-9 cleanup target).
import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { SupplierService } from './supplier.service';

@Controller('supplier')
@UseGuards(AuthGuard, BusinessGuard)
export class SupplierController {
  constructor(@Inject(SupplierService) private readonly supplierService: SupplierService) {}

  // ---- SupplierConnection ----

  @Get('businesses/:businessId/connections')
  getConnections(
    @Param('businessId') businessId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.supplierService.getSupplierConnections(
      businessId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
    );
  }

  @Get('businesses/:businessId/connections/:connectionId')
  getConnection(
    @Param('businessId') businessId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.supplierService.getSupplierConnection(businessId, connectionId);
  }

  @Post('businesses/:businessId/connections')
  createConnection(
    @Param('businessId') businessId: string,
    @Body() body: any,
  ) {
    return this.supplierService.createSupplierConnection(businessId, body);
  }

  @Patch('businesses/:businessId/connections/:connectionId')
  updateConnection(
    @Param('businessId') businessId: string,
    @Param('connectionId') connectionId: string,
    @Body() body: any,
  ) {
    return this.supplierService.updateSupplierConnection(businessId, connectionId, body);
  }

  @Delete('businesses/:businessId/connections/:connectionId')
  deleteConnection(
    @Param('businessId') businessId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.supplierService.deleteSupplierConnection(businessId, connectionId);
  }

  // ---- SupplierProduct ----

  @Get('businesses/:businessId/connections/:connectionId/products')
  getSupplierProducts(
    @Param('businessId') businessId: string,
    @Param('connectionId') connectionId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('availability') availability?: string,
  ) {
    return this.supplierService.getSupplierProducts(
      businessId,
      connectionId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 50,
      { availability },
    );
  }

  @Post('businesses/:businessId/connections/:connectionId/products')
  createSupplierProduct(
    @Param('businessId') businessId: string,
    @Param('connectionId') connectionId: string,
    @Body() body: any,
  ) {
    return this.supplierService.createSupplierProduct(businessId, {
      ...body,
      supplierConnectionId: connectionId,
    });
  }

  @Get('businesses/:businessId/supplier-products/:supplierProductId')
  getSupplierProduct(
    @Param('businessId') businessId: string,
    @Param('supplierProductId') supplierProductId: string,
  ) {
    return this.supplierService.getSupplierProduct(businessId, supplierProductId);
  }

  @Patch('businesses/:businessId/supplier-products/:supplierProductId')
  updateSupplierProduct(
    @Param('businessId') businessId: string,
    @Param('supplierProductId') supplierProductId: string,
    @Body() body: any,
  ) {
    return this.supplierService.updateSupplierProduct(businessId, supplierProductId, body);
  }

  @Delete('businesses/:businessId/supplier-products/:supplierProductId')
  deleteSupplierProduct(
    @Param('businessId') businessId: string,
    @Param('supplierProductId') supplierProductId: string,
  ) {
    return this.supplierService.deleteSupplierProduct(businessId, supplierProductId);
  }

  @Post('businesses/:businessId/supplier-products/:supplierProductId/create-product')
  createProductFromSupplier(
    @Param('businessId') businessId: string,
    @Param('supplierProductId') supplierProductId: string,
    @Body() body: any,
  ) {
    return this.supplierService.createProductFromSupplier(businessId, supplierProductId, body);
  }

  // ---- ProductVariant ----

  @Get('businesses/:businessId/products/:productId/variants')
  getProductVariants(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.supplierService.getProductVariants(businessId, productId);
  }

  @Post('businesses/:businessId/products/:productId/variants')
  createProductVariant(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
    @Body() body: any,
  ) {
    return this.supplierService.createProductVariant(businessId, {
      ...body,
      productId,
    });
  }

  @Patch('businesses/:businessId/product-variants/:variantId')
  updateProductVariant(
    @Param('businessId') businessId: string,
    @Param('variantId') variantId: string,
    @Body() body: any,
  ) {
    return this.supplierService.updateProductVariant(businessId, variantId, body);
  }

  @Delete('businesses/:businessId/product-variants/:variantId')
  deleteProductVariant(
    @Param('businessId') businessId: string,
    @Param('variantId') variantId: string,
  ) {
    return this.supplierService.deleteProductVariant(businessId, variantId);
  }

  // ---- ProductSourceLink ----

  @Get('businesses/:businessId/products/:productId/source-links')
  getProductSourceLinks(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.supplierService.getProductSourceLinks(businessId, productId);
  }

  @Post('businesses/:businessId/products/:productId/source-links')
  createProductSourceLink(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
    @Body() body: any,
  ) {
    return this.supplierService.createProductSourceLink(businessId, {
      ...body,
      productId,
    });
  }

  @Patch('businesses/:businessId/source-links/:linkId')
  updateProductSourceLink(
    @Param('businessId') businessId: string,
    @Param('linkId') linkId: string,
    @Body() body: any,
  ) {
    return this.supplierService.updateProductSourceLink(businessId, linkId, body);
  }

  @Delete('businesses/:businessId/source-links/:linkId')
  deleteProductSourceLink(
    @Param('businessId') businessId: string,
    @Param('linkId') linkId: string,
  ) {
    return this.supplierService.deleteProductSourceLink(businessId, linkId);
  }

  // ---- ProductCostProfile ----

  @Get('businesses/:businessId/products/:productId/cost-profile')
  getProductCostProfile(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.supplierService.getProductCostProfile(businessId, productId);
  }

  @Put('businesses/:businessId/products/:productId/cost-profile')
  upsertProductCostProfile(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
    @Body() body: any,
  ) {
    return this.supplierService.upsertProductCostProfile(businessId, {
      ...body,
      productId,
    });
  }

  @Get('businesses/:businessId/products/:productId/margin-snapshots')
  getMarginSnapshots(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
    @Query('limit') limit?: string,
  ) {
    return this.supplierService.getMarginSnapshots(businessId, productId, limit ? parseInt(limit, 10) : 20);
  }
}
