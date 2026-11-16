import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { createHmac } from 'crypto';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { ChannelConnectionService } from './channel-connection.service';
import { OutboundContentService } from './outbound-content.service';
import { DeliveryQueueService } from './delivery-queue.service';
import { ContentAiService } from './content-ai.service';
import { WhatsAppAdapter } from './adapters/whatsapp-adapter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { assertMayBindExport } from '../../core/connectors/connector-exports';
import { assertMemberModuleLevel } from '../../core/auth/member-module-level';
import { CHANNEL_EXPORT_TYPE, isMessagingProvider } from './channel-audience';
import { HiddenModuleWrites } from '../../core/auth/hidden-module-writes.decorator';

/** The member a route acts for (AuthMiddleware attaches it; AuthGuard requires it). */
type MemberRequest = { user?: { id?: string; role?: string } };

// SECURITY: TRACKING_HMAC_SECRET must not silently fall back to an empty string —
// an empty HMAC key would let any caller forge tracking tokens (ported from
// develop 1c7e6f93).
const TRACKING_SECRET = process.env.TRACKING_HMAC_SECRET;

function signTrackingToken(deliveryId: string, extra?: string): string {
  if (!TRACKING_SECRET) throw new Error('TRACKING_HMAC_SECRET is not configured');
  const data = extra ? `${deliveryId}:${extra}` : deliveryId;
  return createHmac('sha256', TRACKING_SECRET).update(data).digest('hex').slice(0, 16);
}

function verifyTrackingToken(deliveryId: string, token: string, extra?: string): boolean {
  if (!TRACKING_SECRET) return false;
  return signTrackingToken(deliveryId, extra) === token;
}

@HiddenModuleWrites('marketing', 'content')
@Controller('communications')
export class CommunicationsController {
  constructor(
    @Inject(ChannelConnectionService) private readonly connections: ChannelConnectionService,
    @Inject(OutboundContentService) private readonly content: OutboundContentService,
    @Inject(DeliveryQueueService) private readonly delivery: DeliveryQueueService,
    @Inject(ContentAiService) private readonly contentAi: ContentAiService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
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

  /**
   * SWEEP-P0-SCOPES round 1 class repair (CLASS B; found by the census call graph, CEN-10b): settings
   * admin. It copies every social connection's token over the business's channel connection of that
   * provider (ChannelConnectionService.syncFromSocial), replacing the channel credential the other
   * connection writes need settings admin for (SV-2).
   *
   * SWEEP-P0-FOLLOWUP repair (review SEC-FU-1): the sync writes no messaging connection (EMAIL, GOOGLE, WHATSAPP): a
   * social connection is never a sending account, and copying one over the owner-bound mailbox swapped its token for
   * another member's while the recorded binder stayed. Those accounts are bound only by the routes below, which check
   * the binder reads what it receives (CEN-11c reads the doors from the call graph).
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'admin')
  @Post('businesses/:businessId/connections/sync-from-social')
  async syncFromSocial(@Param('businessId') businessId: string) {
    return this.connections.syncFromSocial(businessId);
  }

  /**
   * SWEEP-P0-SCOPES second review repair (finding SV-2, the SEC-1 credential class): a channel
   * connection is the business's account credential (its token and refresh token, the mailbox or page
   * every send goes from). Creating, changing and deleting one, and connecting WhatsApp, need settings
   * admin, as the connector credentials do (SEC-1): OWNER and ADMIN by role default, STAFF none; an
   * explicit map binds every role (D-114). They ran AuthGuard and BusinessGuard only: the sweep's STAFF
   * member (settings none) replaced the owner's email connection's token and account, and a member of
   * two businesses moved the connection into their own (ChannelConnectionService now writes only a
   * connection's own fields). The reads stay open to members and answer no token (stripSecrets).
   */
  /**
   * SWEEP-P0-FOLLOWUP (round 3 recheck WH3-1, CLASS A): an EMAIL / Gmail or WhatsApp connection's account receives
   * every message sent through it, with the recipient's address or phone, so binding one is binding an export
   * account: beside settings admin, the binder reads what it receives (crm: assertMayBindExport,
   * CONNECTOR_EXPORT_READS.channel_messaging) and is recorded as its binder (providerMeta.boundBy, set by the
   * server; a boundBy in the body is dropped). Sends through it reach only the contacts every receiver may open
   * (channelRecipients). A settings admin whose map says crm none bound their own mailbox and the owner's PRIVATE
   * contacts were queued through it.
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'admin')
  @Post('businesses/:businessId/connections')
  async createConnection(@Param('businessId') businessId: string, @Body() body: any, @Req() req: MemberRequest) {
    if (isMessagingProvider(body?.provider)) await assertMayBindExport(this.prisma, businessId, req.user, CHANNEL_EXPORT_TYPE);
    return this.connections.create(businessId, body, req.user);
  }

  // SWEEP-P0-FOLLOWUP (WH3-1): changing a messaging connection's account (token, mailbox, provider meta) rebinds it
  // (see createConnection); a change that keeps the account (its label, its health) binds nothing. Repair COR-2: a
  // change of the stored account, not an account field sent back unchanged (the web's sender form always sends its
  // mailbox with a new label).
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'admin')
  @Patch('businesses/:businessId/connections/:id')
  async updateConnection(@Param('businessId') businessId: string, @Param('id') id: string, @Body() body: any, @Req() req: MemberRequest) {
    if (await this.connections.rebindsAccount(businessId, id, body)) {
      await assertMayBindExport(this.prisma, businessId, req.user, CHANNEL_EXPORT_TYPE);
    }
    return this.connections.update(businessId, id, body, req.user);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'admin')
  @Delete('businesses/:businessId/connections/:id')
  deleteConnection(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.connections.delete(businessId, id);
  }

  /**
   * SWEEP-P0-SCOPES round 3 class repair (CLASS B; finding CB-1): settings admin, as the connection writes are
   * (SV-2). A health check writes the connection's healthState, the sending state a settings admin sets (PATCH
   * connections/:id 'Disabled' pauses the sender; DeliveryQueueService refuses a campaign whose sender is not
   * 'Connected'). It ran membership only and recomputed the state from the token facts, so any member lifted
   * the admin's 'Disabled' back to 'Connected'. A health check also keeps an admin's 'Disabled'
   * (ChannelConnectionService.runHealthCheck): only PATCH connections/:id lifts it.
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'admin')
  @Post('businesses/:businessId/connections/:id/health-check')
  async healthCheck(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.connections.runHealthCheck(businessId, id);
  }

  /**
   * SWEEP-P0-SCOPES round 2 class repair (CLASS B; finding CW-2): settings admin, as the connection
   * writes are (SV-2). A destination is where every send goes (a page and its own access token,
   * ChannelDestination.destinationMeta): adding one, replacing its token, or turning the owner's off is a
   * binding write. Both ran AuthGuard and BusinessGuard only: any member replaced the token on the
   * owner's page, added a page of their own under the owner's credentialed connection, and turned the
   * owner's page off. A destination read answers no token (ChannelConnectionService).
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'admin')
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'admin')
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
  validateEmailSend(@Param('businessId') businessId: string, @Body() body: { subject?: string; destinationIds?: string[]; segmentTags?: string[]; ageGroups?: string[] }) {
    return this.connections.validateEmailSend(businessId, body);
  }

  /**
   * SWEEP-P0-FOLLOWUP repair (review SEC-FU-3): a preview of the audience is a read of the business's contacts (their
   * names, emails and phones): crm read, checked in the handler as publishNow checks content write, and only the
   * contacts the member may open (ChannelConnectionService.expandAudience). It was membership-only and answered the
   * owner's PRIVATE contacts to a member with every module none.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/audience/expand')
  async expandAudience(
    @Param('businessId') businessId: string,
    @Body() body: { segmentTags?: string[]; ageGroups?: string[]; limit?: number; channel?: string },
    @Req() req: MemberRequest,
  ) {
    await assertMemberModuleLevel(this.prisma, businessId, req.user, 'crm', 'read');
    return this.connections.expandAudience(businessId, body, req.user);
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

  /** SWEEP-P0-SCOPES second review repair (SV-2): stores the business's WhatsApp token: settings admin, as createConnection. */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'admin')
  @Post('businesses/:businessId/whatsapp/connect')
  async connectWhatsApp(
    @Param('businessId') businessId: string,
    @Body() body: { accessToken: string; waBusinessAccountId: string; label?: string },
    @Req() req: MemberRequest,
  ) {
    // SWEEP-P0-FOLLOWUP (WH3-1): a WhatsApp business account is an export account (see createConnection).
    await assertMayBindExport(this.prisma, businessId, req.user, CHANNEL_EXPORT_TYPE);
    return this.connections.connectWhatsApp(businessId, body, req.user);
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

  /**
   * SWEEP-P0-FOLLOWUP (WH3-1): publishing or scheduling content sends it, to an audience of the business's contacts
   * for an email or WhatsApp send: content write (it was membership only), and the audience is held to what the
   * sending member and each sending account's binder may open (DeliveryQueueService, channelRecipients: the member
   * needs crm read for an audience send).
   *
   * Content write is checked in the handler (assertMemberModuleLevel, ModuleScopeGuard's reading), not declared on the
   * route: a declared scope makes DeliveryQueueService.publishNow governed work that KEY's comms_send_broadcast (a
   * legacy-family tool) reaches one call deeper, which job-role-tool-families.spec.ts's drift guard (a required
   * Release 0 case) refuses until that tool's grant is reviewed (an R0 amendment). The broadcast still meets the
   * receiver rule (channelRecipients) with the command's member as the sender.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content/:id/publish')
  async publishNow(
    @Param('businessId') businessId: string,
    @Param('id') contentId: string,
    @Body() body: { destinationIds: string[] },
    @Req() req: MemberRequest,
  ) {
    await assertMemberModuleLevel(this.prisma, businessId, req.user, 'content', 'write');
    return this.delivery.publishNow(businessId, contentId, body.destinationIds, req.user ?? null);
  }

  // SWEEP-P0-FOLLOWUP (WH3-1): content write (in the handler) and the audience rule; see publishNow.
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content/:id/schedule')
  async schedule(
    @Param('businessId') businessId: string,
    @Param('id') contentId: string,
    @Body() body: { destinationIds: string[]; scheduledAt: string; timezone?: string },
    @Req() req: MemberRequest,
  ) {
    await assertMemberModuleLevel(this.prisma, businessId, req.user, 'content', 'write');
    return this.delivery.schedule(businessId, contentId, body.destinationIds, body.scheduledAt, body.timezone, req.user ?? null);
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

  /**
   * SWEEP-P0-FOLLOWUP repair (review SEC-FU-2): a retry sends the delivery again, so it needs content write, as
   * publish does (checked in the handler; see publishNow). It was membership-only. The delivery is held to the
   * receiver rule again when it is sent (DeliveryQueueService.executeDelivery, channelSendRefusal): a contact the
   * sending account's binder may not open now fails RECEIVER_MAY_NOT_OPEN instead of going out.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/deliveries/:deliveryId/retry')
  async retry(@Param('businessId') businessId: string, @Param('deliveryId') deliveryId: string, @Req() req: MemberRequest) {
    await assertMemberModuleLevel(this.prisma, businessId, req.user, 'content', 'write');
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

  // SWEEP-P0-FOLLOWUP repair (review SEC-FU-2): content write, as retry (see retry).
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content/:id/retry-all')
  async retryAllFailed(@Param('businessId') businessId: string, @Param('id') contentId: string, @Req() req: MemberRequest) {
    await assertMemberModuleLevel(this.prisma, businessId, req.user, 'content', 'write');
    return this.delivery.retryAllFailed(businessId, contentId);
  }

  // --- Content AI ---

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/generate-draft')
  async aiGenerateDraft(@Param('businessId') businessId: string, @Body() body: { contentType: string; objective?: string; tone?: string; audience?: string; topic?: string; existingBody?: string }) {
    return this.contentAi.generateDraft(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/rewrite')
  async aiRewrite(@Param('businessId') businessId: string, @Body() body: { body: string; targetChannel: string; tone?: string; objective?: string }) {
    return this.contentAi.rewriteForChannel(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-subjects')
  async aiSuggestSubjects(@Param('businessId') businessId: string, @Body() body: { body: string; objective?: string; tone?: string; audience?: string }) {
    return this.contentAi.suggestSubjects(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-cta')
  async aiSuggestCta(@Param('businessId') businessId: string, @Body() body: { body: string; objective?: string; contentType?: string }) {
    return this.contentAi.suggestCta(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-hashtags')
  async aiSuggestHashtags(@Param('businessId') businessId: string, @Body() body: { body: string; industry?: string }) {
    return this.contentAi.suggestHashtags(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/shorten-expand')
  async aiShortenExpand(@Param('businessId') businessId: string, @Body() body: { body: string; action: 'shorten' | 'expand'; targetChannel?: string }) {
    return this.contentAi.shortenOrExpand(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-channels')
  async aiSuggestChannels(@Param('businessId') businessId: string, @Body() body: { body: string; objective?: string; audience?: string; availableChannels: string[] }) {
    return this.contentAi.suggestChannels(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-time')
  async aiSuggestTime(@Param('businessId') businessId: string, @Body() body: { contentType: string; audience?: string; timezone?: string }) {
    return this.contentAi.suggestSendTime(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-preview-text')
  async aiSuggestPreviewText(@Param('businessId') businessId: string, @Body() body: { subject: string; body: string; objective?: string }) {
    return this.contentAi.suggestPreviewText(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-audience-segments')
  async aiSuggestAudienceSegments(@Param('businessId') businessId: string, @Body() body: { body: string; contentType?: string; objective?: string; existingSegments?: string[] }) {
    return this.contentAi.suggestAudienceSegments(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/content-ai/suggest-content-ideas')
  async aiSuggestContentIdeas(@Param('businessId') businessId: string, @Body() body: { objective?: string; audience?: string; recentTopics?: string[]; contentType?: string }) {
    return this.contentAi.suggestContentIdeas(businessId, body);
  }
}
