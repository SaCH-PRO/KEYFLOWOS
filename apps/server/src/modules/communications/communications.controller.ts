import { BadRequestException, Body, Controller, Delete, Get, Inject, Optional, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { createHmac } from 'crypto';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ChannelConnectionService } from './channel-connection.service';
import { OutboundContentService } from './outbound-content.service';
import { DeliveryQueueService } from './delivery-queue.service';
import { ContentAiService } from './content-ai.service';
import { WhatsAppAdapter } from './adapters/whatsapp-adapter';

const TRACKING_SECRET = process.env.TRACKING_HMAC_SECRET || '';

function signTrackingToken(deliveryId: string, extra?: string): string {
  const data = extra ? `${deliveryId}:${extra}` : deliveryId;
  return createHmac('sha256', TRACKING_SECRET).update(data).digest('hex').slice(0, 16);
}

function verifyTrackingToken(deliveryId: string, token: string, extra?: string): boolean {
  return signTrackingToken(deliveryId, extra) === token;
}

@Controller('communications')
export class CommunicationsController {
  constructor(
    @Inject(ChannelConnectionService) private readonly connections: ChannelConnectionService,
    @Inject(OutboundContentService) private readonly content: OutboundContentService,
    @Inject(DeliveryQueueService) private readonly delivery: DeliveryQueueService,
    @Optional() @Inject(ContentAiService) private readonly contentAi: ContentAiService | null,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'communications' };
  }

  // --- Channel Connections ---

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/connections/health-summary')
  async healthSummary(@Param('businessId') businessId: string) {
    return this.connections.getHealthSummary(businessId);
  }

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
  @Post('businesses/:businessId/connections/sync-from-social')
  async syncFromSocial(@Param('businessId') businessId: string) {
    return this.connections.syncFromSocial(businessId);
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

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/connections/:id/health-check')
  async healthCheck(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.connections.runHealthCheck(businessId, id);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/destinations/:destId/toggle')
  toggleDestination(@Param('businessId') businessId: string, @Param('destId') destId: string, @Body() body: { isActive: boolean }) {
    return this.connections.toggleDestination(businessId, destId, body.isActive);
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

  // --- Email Validation & Audience ---

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/email/validate-send')
  validateEmailSend(@Param('businessId') businessId: string, @Body() body: { subject?: string; destinationIds?: string[]; segmentTags?: string[] }) {
    return this.connections.validateEmailSend(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/audience/expand')
  expandAudience(@Param('businessId') businessId: string, @Body() body: { segmentTags?: string[]; limit?: number }) {
    return this.connections.expandAudience(businessId, body);
  }

  // --- WhatsApp Connect & Verify ---

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/whatsapp/verify-connection')
  async verifyWhatsAppConnection(@Param('businessId') businessId: string, @Body() body: { accessToken: string }) {
    const adapter = new WhatsAppAdapter();
    return adapter.validateConnection({ token: body.accessToken });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/whatsapp/list-phones')
  async listWhatsAppPhones(@Param('businessId') businessId: string, @Body() body: { accessToken: string; waBusinessAccountId: string }) {
    const adapter = new WhatsAppAdapter();
    return adapter.listPhoneNumbers(body.accessToken, body.waBusinessAccountId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/whatsapp/connect')
  async connectWhatsApp(@Param('businessId') businessId: string, @Body() body: { accessToken: string; waBusinessAccountId: string; label?: string }) {
    return this.connections.connectWhatsApp(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/audience/health')
  audienceHealth(@Param('businessId') businessId: string) {
    return this.connections.getAudienceHealth(businessId);
  }

  @Get('deliveries/:deliveryId/track-open')
  async trackOpen(
    @Param('deliveryId') deliveryId: string,
    @Query('t') token: string | undefined,
    @Res() res: import('express').Response,
  ) {
    if (TRACKING_SECRET && token && verifyTrackingToken(deliveryId, token)) {
      await this.delivery.trackOpen(deliveryId);
    }
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-store, no-cache');
    return res.send(pixel);
  }

  @Get('deliveries/:deliveryId/track-click')
  async trackClick(
    @Param('deliveryId') deliveryId: string,
    @Query('t') token: string | undefined,
    @Query('r') redirectUrl: string | undefined,
    @Res() res: import('express').Response,
  ) {
    if (!TRACKING_SECRET || !token || !redirectUrl) {
      return res.status(400).json({ error: 'Invalid tracking request' });
    }
    if (!verifyTrackingToken(deliveryId, token, redirectUrl)) {
      return res.status(400).json({ error: 'Invalid tracking token' });
    }
    await this.delivery.trackClick(deliveryId);
    if (/^https?:\/\//i.test(redirectUrl)) {
      return res.redirect(302, redirectUrl);
    }
    return res.json({ ok: true });
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

  // --- Delivery Log ---

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/deliveries')
  listDeliveries(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('contentId') contentId?: string,
    @Query('contentType') contentType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.delivery.listDeliveries(businessId, {
      status, channel, contentId, contentType, dateFrom, dateTo,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/deliveries/:deliveryId/events')
  deliveryEvents(@Param('businessId') businessId: string, @Param('deliveryId') deliveryId: string) {
    return this.delivery.getDeliveryEvents(businessId, deliveryId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content/:id/retry-all')
  retryAllFailed(@Param('businessId') businessId: string, @Param('id') contentId: string) {
    return this.delivery.retryAllFailed(businessId, contentId);
  }

  // --- Content AI ---

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/generate-draft')
  async aiGenerateDraft(@Param('businessId') businessId: string, @Body() body: { contentType: string; objective?: string; tone?: string; audience?: string; topic?: string; existingBody?: string }) {
    if (!this.contentAi) throw new BadRequestException('AI service unavailable');
    return this.contentAi.generateDraft(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/rewrite')
  async aiRewrite(@Param('businessId') businessId: string, @Body() body: { body: string; targetChannel: string; tone?: string; objective?: string }) {
    if (!this.contentAi) throw new BadRequestException('AI service unavailable');
    return this.contentAi.rewriteForChannel(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-subjects')
  async aiSuggestSubjects(@Param('businessId') businessId: string, @Body() body: { body: string; objective?: string; tone?: string; audience?: string }) {
    if (!this.contentAi) throw new BadRequestException('AI service unavailable');
    return this.contentAi.suggestSubjects(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-cta')
  async aiSuggestCta(@Param('businessId') businessId: string, @Body() body: { body: string; objective?: string; contentType?: string }) {
    if (!this.contentAi) throw new BadRequestException('AI service unavailable');
    return this.contentAi.suggestCta(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-hashtags')
  async aiSuggestHashtags(@Param('businessId') businessId: string, @Body() body: { body: string; industry?: string }) {
    if (!this.contentAi) throw new BadRequestException('AI service unavailable');
    return this.contentAi.suggestHashtags(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/shorten-expand')
  async aiShortenExpand(@Param('businessId') businessId: string, @Body() body: { body: string; action: 'shorten' | 'expand'; targetChannel?: string }) {
    if (!this.contentAi) throw new BadRequestException('AI service unavailable');
    return this.contentAi.shortenOrExpand(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-channels')
  async aiSuggestChannels(@Param('businessId') businessId: string, @Body() body: { body: string; objective?: string; audience?: string; availableChannels: string[] }) {
    if (!this.contentAi) throw new BadRequestException('AI service unavailable');
    return this.contentAi.suggestChannels(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-time')
  async aiSuggestTime(@Param('businessId') businessId: string, @Body() body: { contentType: string; audience?: string; timezone?: string }) {
    if (!this.contentAi) throw new BadRequestException('AI service unavailable');
    return this.contentAi.suggestSendTime(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-preview-text')
  async aiSuggestPreviewText(@Param('businessId') businessId: string, @Body() body: { subject: string; body: string; objective?: string }) {
    if (!this.contentAi) throw new BadRequestException('AI service unavailable');
    return this.contentAi.suggestPreviewText(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-audience-segments')
  async aiSuggestAudienceSegments(@Param('businessId') businessId: string, @Body() body: { body: string; contentType?: string; objective?: string; existingSegments?: string[] }) {
    if (!this.contentAi) throw new BadRequestException('AI service unavailable');
    return this.contentAi.suggestAudienceSegments(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-content-ideas')
  async aiSuggestContentIdeas(@Param('businessId') businessId: string, @Body() body: { objective?: string; audience?: string; recentTopics?: string[]; contentType?: string }) {
    if (!this.contentAi) throw new BadRequestException('AI service unavailable');
    return this.contentAi.suggestContentIdeas(businessId, body);
  }
}
