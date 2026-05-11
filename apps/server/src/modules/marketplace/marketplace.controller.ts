// @keyflow:dormant — UI surface gated by featureFlags (KEY-9 cleanup target).
import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Req, Res, UseGuards, Inject, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { MarketplaceService } from './marketplace.service';
import { CommerceIntegrationService } from './commerce-integration.service';

@Controller('marketplace')
@UseGuards(AuthGuard, BusinessGuard)
export class MarketplaceController {
  constructor(
    @Inject(MarketplaceService) private readonly marketplaceService: MarketplaceService,
    @Inject(CommerceIntegrationService) private readonly commerceIntegration: CommerceIntegrationService,
  ) {}

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

  @Post('businesses/:businessId/orders/:orderId/fulfill')
  fulfillOrder(
    @Param('businessId') businessId: string,
    @Param('orderId') orderId: string,
    @Body() body: { action: string; [key: string]: any },
  ) {
    const { action, ...data } = body;
    return this.marketplaceService.fulfillOrder(businessId, orderId, action, data);
  }

  @Post('businesses/:businessId/orders/:orderId/route')
  routeOrder(
    @Param('businessId') businessId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.marketplaceService.routeOrder(businessId, orderId);
  }

  @Get('businesses/:businessId/orders/:orderId/routes')
  getFulfillmentRoutes(
    @Param('businessId') businessId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.marketplaceService.getFulfillmentRoutes(businessId, orderId);
  }

  @Patch('businesses/:businessId/fulfillment-routes/:routeId')
  updateFulfillmentRoute(
    @Param('businessId') businessId: string,
    @Param('routeId') routeId: string,
    @Body() body: any,
  ) {
    return this.marketplaceService.updateFulfillmentRoute(businessId, routeId, body);
  }

  @Get('businesses/:businessId/inventory/alerts')
  getInventoryAlerts(@Param('businessId') businessId: string) {
    return this.marketplaceService.getInventoryAlerts(businessId);
  }

  @Post('businesses/:businessId/purchase-orders/:poId/advance')
  advancePurchaseOrderStatus(
    @Param('businessId') businessId: string,
    @Param('poId') poId: string,
    @Body() body: { status: 'SUBMITTED' | 'ACKNOWLEDGED' | 'SHIPPED' | 'RECEIVED' },
  ) {
    return this.marketplaceService.advancePurchaseOrderStatus(businessId, poId, body);
  }

  @Post('businesses/:businessId/fulfillment-routes/:routeId/activate-preorder')
  activatePreorderRoute(
    @Param('businessId') businessId: string,
    @Param('routeId') routeId: string,
  ) {
    return this.marketplaceService.activatePreorderRoute(businessId, routeId);
  }

  @Get('businesses/:businessId/orders/:orderId/token')
  async getOrderToken(
    @Param('businessId') businessId: string,
    @Param('orderId') orderId: string,
  ) {
    const token = await this.marketplaceService.getOrderToken(businessId, orderId);
    return { token };
  }

  @Get('businesses/:businessId/delivery-config')
  getDeliveryConfig(@Param('businessId') businessId: string) {
    return this.marketplaceService.getDeliveryConfig(businessId);
  }

  @Put('businesses/:businessId/delivery-config')
  updateDeliveryConfig(@Param('businessId') businessId: string, @Body() body: any) {
    return this.marketplaceService.updateDeliveryConfig(businessId, body);
  }

  @Get('businesses/:businessId/orders/:orderId/cross-links')
  getOrderCrossLinks(
    @Param('businessId') businessId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.commerceIntegration.getOrderCrossLinks(businessId, orderId);
  }

  @Get('businesses/:businessId/contacts/:contactId/order-history')
  getContactOrderHistory(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.commerceIntegration.getContactOrderHistory(businessId, contactId);
  }

  @Post('businesses/:businessId/products/:productId/promote')
  promoteProductToContent(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.commerceIntegration.promoteProductToContent(businessId, productId);
  }

  @Post('businesses/:businessId/orders/:orderId/create-project')
  createProjectForBundleOrder(
    @Param('businessId') businessId: string,
    @Param('orderId') orderId: string,
    @Body() body: { name?: string; description?: string; contactId?: string },
  ) {
    return this.commerceIntegration.createProjectForBundleOrder(businessId, orderId, body);
  }

  @Post('businesses/:businessId/post-purchase/process')
  processPostPurchaseJobs(@Param('businessId') businessId: string) {
    return this.commerceIntegration.processPostPurchaseJobs(businessId);
  }

  @Get('businesses/:businessId/inventory/summary')
  getInventorySummary(@Param('businessId') businessId: string) {
    return this.marketplaceService.getInventorySummary(businessId);
  }

  @Get('businesses/:businessId/inventory/movements')
  getInventoryMovements(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.marketplaceService.getInventoryMovements(businessId, limit ? parseInt(limit, 10) : 100);
  }

  @Post('businesses/:businessId/inventory/adjust')
  adjustInventory(
    @Param('businessId') businessId: string,
    @Body() body: any,
    @Req() req: { user?: { id?: string } },
  ) {
    if (!body.reasonCode) throw new BadRequestException('reasonCode is required for stock adjustments');
    if (body.reasonCode === 'MANUAL' && !body.note?.trim()) throw new BadRequestException('A note is required for manual adjustments');
    return this.marketplaceService.adjustInventory(businessId, { ...body, userId: req.user?.id });
  }

  @Post('businesses/:businessId/inventory/transfer')
  transferInventory(
    @Param('businessId') businessId: string,
    @Body() body: any,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.marketplaceService.transferInventory(businessId, { ...body, userId: req.user?.id });
  }

  @Get('businesses/:businessId/inventory/export-excel')
  async exportInventoryExcel(
    @Param('businessId') businessId: string,
    @Res() res: Response,
  ) {
    const buffer = await this.marketplaceService.exportInventoryExcel(businessId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="inventory-${Date.now()}.xlsx"`);
    res.send(buffer);
  }

  @Get('businesses/:businessId/inventory/template-excel')
  async getInventoryTemplate(@Param('businessId') businessId: string, @Res() res: Response) {
    const buffer = await this.marketplaceService.getInventoryExcelTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="inventory-import-template.xlsx"');
    res.send(buffer);
  }

  @Post('businesses/:businessId/inventory/import-excel')
  @UseInterceptors(FileInterceptor('file'))
  importInventoryExcel(
    @Param('businessId') businessId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.marketplaceService.importInventoryExcel(businessId, file.buffer);
  }

}
