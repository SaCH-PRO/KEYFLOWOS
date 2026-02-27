import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { MarketplaceService } from './marketplace.service';

@Controller('marketplace')
@UseGuards(AuthGuard, BusinessGuard)
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('businesses/:businessId/dashboard')
  getDashboard(@Param('businessId') businessId: string) {
    return this.marketplaceService.getDashboard(businessId);
  }

  @Get('businesses/:businessId/listings')
  getListings(
    @Param('businessId') businessId: string,
    @Query('marketReach') marketReach?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.marketplaceService.getListings(businessId, { marketReach }, page ? parseInt(page, 10) : 1, pageSize ? parseInt(pageSize, 10) : 50);
  }

  @Post('businesses/:businessId/listings')
  createListing(@Param('businessId') businessId: string, @Body() body: any) {
    return this.marketplaceService.createListing(businessId, body);
  }

  @Patch('businesses/:businessId/listings/:listingId')
  updateListing(
    @Param('businessId') businessId: string,
    @Param('listingId') listingId: string,
    @Body() body: any,
  ) {
    return this.marketplaceService.updateListing(businessId, listingId, body);
  }

  @Delete('businesses/:businessId/listings/:listingId')
  deleteListing(
    @Param('businessId') businessId: string,
    @Param('listingId') listingId: string,
  ) {
    return this.marketplaceService.deleteListing(businessId, listingId);
  }

  @Get('businesses/:businessId/shipping-zones')
  getShippingZones(@Param('businessId') businessId: string) {
    return this.marketplaceService.getShippingZones(businessId);
  }

  @Post('businesses/:businessId/shipping-zones')
  createShippingZone(@Param('businessId') businessId: string, @Body() body: any) {
    return this.marketplaceService.createShippingZone(businessId, body);
  }

  @Patch('businesses/:businessId/shipping-zones/:zoneId')
  updateShippingZone(
    @Param('businessId') businessId: string,
    @Param('zoneId') zoneId: string,
    @Body() body: any,
  ) {
    return this.marketplaceService.updateShippingZone(businessId, zoneId, body);
  }

  @Delete('businesses/:businessId/shipping-zones/:zoneId')
  deleteShippingZone(
    @Param('businessId') businessId: string,
    @Param('zoneId') zoneId: string,
  ) {
    return this.marketplaceService.deleteShippingZone(businessId, zoneId);
  }

  @Get('businesses/:businessId/warehouses')
  getWarehouses(@Param('businessId') businessId: string) {
    return this.marketplaceService.getWarehouses(businessId);
  }

  @Post('businesses/:businessId/warehouses')
  createWarehouse(@Param('businessId') businessId: string, @Body() body: any) {
    return this.marketplaceService.createWarehouse(businessId, body);
  }

  @Patch('businesses/:businessId/warehouses/:warehouseId')
  updateWarehouse(
    @Param('businessId') businessId: string,
    @Param('warehouseId') warehouseId: string,
    @Body() body: any,
  ) {
    return this.marketplaceService.updateWarehouse(businessId, warehouseId, body);
  }

  @Delete('businesses/:businessId/warehouses/:warehouseId')
  deleteWarehouse(
    @Param('businessId') businessId: string,
    @Param('warehouseId') warehouseId: string,
  ) {
    return this.marketplaceService.deleteWarehouse(businessId, warehouseId);
  }

  @Get('businesses/:businessId/inventory')
  getInventory(
    @Param('businessId') businessId: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.marketplaceService.getInventory(businessId, warehouseId);
  }

  @Post('businesses/:businessId/inventory')
  upsertInventory(@Param('businessId') businessId: string, @Body() body: any) {
    return this.marketplaceService.upsertInventory(businessId, body);
  }

  @Get('businesses/:businessId/orders')
  getOrders(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.marketplaceService.getOrders(businessId, { status, type }, page ? parseInt(page, 10) : 1, pageSize ? parseInt(pageSize, 10) : 50);
  }

  @Get('businesses/:businessId/orders/:orderId')
  getOrder(
    @Param('businessId') businessId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.marketplaceService.getOrder(businessId, orderId);
  }

  @Post('businesses/:businessId/orders')
  createOrder(@Param('businessId') businessId: string, @Body() body: any) {
    return this.marketplaceService.createOrder(businessId, body);
  }

  @Patch('businesses/:businessId/orders/:orderId/status')
  updateOrderStatus(
    @Param('businessId') businessId: string,
    @Param('orderId') orderId: string,
    @Body() body: any,
  ) {
    return this.marketplaceService.updateOrderStatus(businessId, orderId, body.status, body);
  }

  @Get('businesses/:businessId/shipments')
  getShipments(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.marketplaceService.getShipments(businessId, { status }, page ? parseInt(page, 10) : 1, pageSize ? parseInt(pageSize, 10) : 50);
  }

  @Post('businesses/:businessId/shipments')
  createShipment(@Param('businessId') businessId: string, @Body() body: any) {
    return this.marketplaceService.createShipment(businessId, body);
  }

  @Patch('businesses/:businessId/shipments/:shipmentId')
  updateShipment(
    @Param('businessId') businessId: string,
    @Param('shipmentId') shipmentId: string,
    @Body() body: any,
  ) {
    return this.marketplaceService.updateShipment(businessId, shipmentId, body);
  }

  @Get('businesses/:businessId/customs')
  getCustomsDeclarations(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.marketplaceService.getCustomsDeclarations(businessId, { status, type }, page ? parseInt(page, 10) : 1, pageSize ? parseInt(pageSize, 10) : 50);
  }

  @Post('businesses/:businessId/customs')
  createCustomsDeclaration(@Param('businessId') businessId: string, @Body() body: any) {
    return this.marketplaceService.createCustomsDeclaration(businessId, body);
  }

  @Patch('businesses/:businessId/customs/:declId')
  updateCustomsDeclaration(
    @Param('businessId') businessId: string,
    @Param('declId') declId: string,
    @Body() body: any,
  ) {
    return this.marketplaceService.updateCustomsDeclaration(businessId, declId, body);
  }

  @Get('businesses/:businessId/pre-orders')
  getPreOrders(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.marketplaceService.getPreOrders(businessId, { status }, page ? parseInt(page, 10) : 1, pageSize ? parseInt(pageSize, 10) : 50);
  }

  @Post('businesses/:businessId/pre-orders')
  createPreOrder(@Param('businessId') businessId: string, @Body() body: any) {
    return this.marketplaceService.createPreOrder(businessId, body);
  }

  @Patch('businesses/:businessId/pre-orders/:preOrderId')
  updatePreOrder(
    @Param('businessId') businessId: string,
    @Param('preOrderId') preOrderId: string,
    @Body() body: any,
  ) {
    return this.marketplaceService.updatePreOrder(businessId, preOrderId, body);
  }

  @Get('businesses/:businessId/purchase-orders')
  getPurchaseOrders(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.marketplaceService.getPurchaseOrders(businessId, { status }, page ? parseInt(page, 10) : 1, pageSize ? parseInt(pageSize, 10) : 50);
  }

  @Post('businesses/:businessId/purchase-orders')
  createPurchaseOrder(@Param('businessId') businessId: string, @Body() body: any) {
    return this.marketplaceService.createPurchaseOrder(businessId, body);
  }

  @Patch('businesses/:businessId/purchase-orders/:poId')
  updatePurchaseOrder(
    @Param('businessId') businessId: string,
    @Param('poId') poId: string,
    @Body() body: any,
  ) {
    return this.marketplaceService.updatePurchaseOrder(businessId, poId, body);
  }
}
