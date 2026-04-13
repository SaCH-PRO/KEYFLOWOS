import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ChannelConnectionService } from './channel-connection.service';
import { OutboundContentService } from './outbound-content.service';
import { DeliveryQueueService } from './delivery-queue.service';

@Controller('communications')
export class CommunicationsController {
  constructor(
    @Inject(ChannelConnectionService) private readonly connections: ChannelConnectionService,
    @Inject(OutboundContentService) private readonly content: OutboundContentService,
    @Inject(DeliveryQueueService) private readonly delivery: DeliveryQueueService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'communications' };
  }

  // --- Channel Connections ---

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/connections')
  listConnections(@Param('businessId') businessId: string) {
    return this.connections.list(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/connections/:id')
  getConnection(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.connections.get(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/connections')
  createConnection(@Param('businessId') businessId: string, @Body() body: any) {
    return this.connections.create(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/connections/:id')
  updateConnection(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: any) {
    return this.connections.update(businessId, id, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/connections/:id')
  deleteConnection(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.connections.delete(businessId, id);
  }

  // --- Destinations ---

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/destinations')
  listDestinations(
    @Param('businessId') businessId: string,
    @Query('platform') platform?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.connections.listDestinations(businessId, { platform, activeOnly: activeOnly === 'true' });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/connections/:connectionId/destinations')
  createDestination(
    @Param('businessId') businessId: string,
    @Param('connectionId') connectionId: string,
    @Body() body: any,
  ) {
    return this.connections.upsertDestination(connectionId, businessId, body);
  }

  // --- Outbound Content ---

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/content')
  listContent(
    @Param('businessId') businessId: string,
    @Query('contentType') contentType?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.content.list(businessId, { contentType, status, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/content/:id')
  getContent(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.content.get(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content')
  createContent(@Param('businessId') businessId: string, @Body() body: any) {
    return this.content.create(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/content/:id')
  updateContent(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: any) {
    return this.content.update(businessId, id, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/content/:id')
  deleteContent(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.content.delete(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content/:id/variants')
  upsertVariant(@Param('businessId') businessId: string, @Param('id') contentId: string, @Body() body: any) {
    return this.content.upsertVariant(businessId, contentId, body);
  }

  // --- Delivery Operations ---

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content/:id/publish')
  publishNow(
    @Param('businessId') businessId: string,
    @Param('id') contentId: string,
    @Body() body: { destinationIds: string[] },
  ) {
    return this.delivery.publishNow(businessId, contentId, body.destinationIds);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content/:id/schedule')
  schedule(
    @Param('businessId') businessId: string,
    @Param('id') contentId: string,
    @Body() body: { destinationIds: string[]; scheduledAt: string; timezone?: string },
  ) {
    return this.delivery.schedule(businessId, contentId, body.destinationIds, body.scheduledAt, body.timezone);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/deliveries/:deliveryId/reschedule')
  reschedule(
    @Param('businessId') businessId: string,
    @Param('deliveryId') deliveryId: string,
    @Body() body: { scheduledAt: string; timezone?: string },
  ) {
    return this.delivery.reschedule(businessId, deliveryId, body.scheduledAt, body.timezone);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/deliveries/:deliveryId/cancel')
  cancel(@Param('businessId') businessId: string, @Param('deliveryId') deliveryId: string) {
    return this.delivery.cancel(businessId, deliveryId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/deliveries/:deliveryId/retry')
  retry(@Param('businessId') businessId: string, @Param('deliveryId') deliveryId: string) {
    return this.delivery.retry(businessId, deliveryId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/content/:id/delivery-summary')
  deliverySummary(@Param('businessId') businessId: string, @Param('id') contentId: string) {
    return this.delivery.getDeliverySummary(businessId, contentId);
  }
}
