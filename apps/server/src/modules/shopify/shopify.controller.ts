import { Controller, Get, Post, Inject, Param, Body, UseGuards, Query } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ShopifyService } from './shopify.service';
import { ConnectorCredentialsService } from '../../core/connectors/connector-credentials.service';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('shopify')
export class ShopifyController {
  constructor(
    @Inject(ShopifyService) private readonly shopify: ShopifyService,
    @Inject(ConnectorCredentialsService) private readonly credentials: ConnectorCredentialsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/connect')
  async connect(
    @Param('businessId') businessId: string,
    @Body() body: { shopDomain: string; accessToken: string },
  ) {
    const shopDomain = body.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    await this.credentials.setCredentials(businessId, 'shopify', {
      shopDomain,
      accessToken: body.accessToken,
    });

    const test = await this.shopify.testConnection(businessId);
    if (!test.success) {
      await this.prisma.client.connectorStatus.update({
        where: { businessId_connectorType: { businessId, connectorType: 'shopify' } },
        data: { status: 'error', lastError: test.error, lastErrorAt: new Date() },
      });
      return { success: false, error: test.error };
    }

    await this.prisma.client.connectorStatus.update({
      where: { businessId_connectorType: { businessId, connectorType: 'shopify' } },
      data: {
        status: 'connected',
        connectedAt: new Date(),
        lastError: null,
        lastErrorAt: null,
        errorCount: 0,
      },
    });

    return { success: true, shopName: test.shopName };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/test')
  async test(@Param('businessId') businessId: string) {
    return this.shopify.testConnection(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/sync/products')
  async syncProducts(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.shopify.syncProducts(businessId, { limit: limit ? parseInt(limit, 10) : undefined });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/sync/orders')
  async syncOrders(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.shopify.syncOrders(businessId, { limit: limit ? parseInt(limit, 10) : undefined });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/sync/customers')
  async syncCustomers(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.shopify.syncCustomers(businessId, { limit: limit ? parseInt(limit, 10) : undefined });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/sync/all')
  async syncAll(@Param('businessId') businessId: string) {
    const [products, orders, customers] = await Promise.all([
      this.shopify.syncProducts(businessId),
      this.shopify.syncOrders(businessId),
      this.shopify.syncCustomers(businessId),
    ]);
    return { products, orders, customers };
  }
}
