import { BadRequestException, Body, Controller, ExecutionContext, ForbiddenException, Get, HttpException, Inject, Injectable, Logger, NotFoundException, Optional, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import twilio from 'twilio';
import { WhatsAppService, type WhatsAppConfig } from './whatsapp.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { resolveRequestBusinessId, type TenantBearingRequest } from '../../core/auth/request-business-id';
import { EffectiveAuthorityResolver } from '../../core/authority/effective-authority.resolver';
import { CurrentUser, type AuthenticatedUser } from '../../core/decorators/current-user.decorator';
import { WebhookIngressLoggerService } from '../../core/connectors/webhook-ingress-logger.service';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * ModuleScopeGuard for the WhatsApp send and inbox routes, plus the config
 * owner (R0-SEC2 review CR-SEC2-1).
 *
 * ModuleScopeGuard reads the caller's membership row and refuses a
 * distinguished owner (Business.ownerId) who has none ('Not a member of this
 * business'). Before R0-SEC2 that owner sent from, and read the inbox of, its
 * own business; and PATCH .../config still admits it (WhatsAppService
 * .isConfigOwner). So whoever may replace the sending identity may also see
 * it and send from it: WhatsAppService.isConfigOwner (OWNER membership,
 * Business.ownerId, SUPER_ADMIN) for the business the guards resolve
 * (resolveRequestBusinessId, the tenant BusinessGuard has already checked)
 * passes; everyone else gets ModuleScopeGuard's answer, unchanged. The owner
 * rule admits no one a role default would refuse (OWNER holds operations:
 * admin); it only closes the missing-membership gap on these routes.
 */
@Injectable()
export class WhatsAppOperationsScopeGuard extends ModuleScopeGuard {
  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(Reflector) reflector: Reflector,
    @Inject(WhatsAppService) private readonly whatsapp: WhatsAppService,
    @Optional() @Inject(EffectiveAuthorityResolver) authority?: EffectiveAuthorityResolver,
  ) {
    super(prisma, reflector, authority);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TenantBearingRequest & { user?: { id?: string; role?: string } }>();
    const businessId = resolveRequestBusinessId(req);
    if (businessId && (await this.whatsapp.isConfigOwner(businessId, req.user))) return true;
    return super.canActivate(context);
  }
}

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

interface WhatsAppWebhookBody {
  From?: string;
  Body?: string;
  WaId?: string;
  ProfileName?: string;
  SmsMessageSid?: string;
  MessageSid?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id?: string;
          from?: string;
          timestamp?: string;
          text?: { body?: string };
        }>;
        contacts?: Array<{
          profile?: { name?: string };
          wa_id?: string;
        }>;
      };
    }>;
  }>;
  object?: string;
}

interface ParsedInbound {
  from: string;
  body: string;
  senderName?: string;
  externalId?: string;
  provider: 'twilio' | 'meta';
  receivedAt?: Date;
}

@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    @Inject(WhatsAppService) private readonly service: WhatsAppService,
    @Inject(WebhookIngressLoggerService) private readonly webhookLogger: WebhookIngressLoggerService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  // ─── Operator routes (R0-SEC2-WHATSAPP-CONFIG-AUTHORITY) ──────────────
  //
  // These had AuthGuard and BusinessGuard only: any member read the decrypted
  // credentials, replaced the business's sending identity and sent from its
  // number. Now: the config read answers no secret value (WhatsAppConfigView);
  // the config write is OWNER only (D-11, WhatsAppService.assertConfigOwner,
  // the BUSINESS_PROFILE_OWNER_ONLY refusal) and keeps no ModuleScopeGuard,
  // which would refuse a distinguished owner with no membership row; sending
  // needs operations:write and the inbox reads operations:read — `operations`
  // is the module key the KEY inbox routes (KeyInboxController) require, the
  // surface these WhatsApp conversations are ingested into. Those scoped
  // routes run WhatsAppOperationsScopeGuard (ModuleScopeGuard plus the config
  // owner), so the owner the config write admits is never refused them.

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/config')
  async getConfig(
    @Param('businessId') businessId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const writer = await this.service.isConfigOwner(businessId, user);
    const config = await this.service.getConfigView(businessId, { writer });
    return { data: config };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/config')
  async saveConfig(
    @Param('businessId') businessId: string,
    @Body() config: WhatsAppConfig,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    await this.service.assertConfigOwner(businessId, user);
    await this.service.saveConfig(businessId, config);
    return { success: true };
  }

  @UseGuards(AuthGuard, BusinessGuard, WhatsAppOperationsScopeGuard)
  @RequireModuleScope('operations', 'write')
  @Post('businesses/:businessId/send')
  async sendMessage(
    @Param('businessId') businessId: string,
    @Body() body: { to: string; message: string },
  ) {
    const result = await this.service.sendMessage(businessId, { to: body.to, body: body.message });
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard, WhatsAppOperationsScopeGuard)
  @RequireModuleScope('operations', 'read')
  @Post('businesses/:businessId/test')
  async testConnection(@Param('businessId') businessId: string) {
    const config = await this.service.getConfig(businessId);
    if (!config) return { success: false, error: 'Not configured' };
    return { success: true, provider: config.provider };
  }

  // ─── Manage drawer ─────────────────────────────────────────────────────
  //
  // whatsapp-manage-drawer.tsx has been calling these five routes since it was
  // written; none of them existed, so every panel in it failed. The response
  // shapes below are the drawer's own interfaces — returning the array/object
  // directly, not wrapped in `{ data }`, because that is what it reads.

  @UseGuards(AuthGuard, BusinessGuard, WhatsAppOperationsScopeGuard)
  @RequireModuleScope('operations', 'read')
  @Get('businesses/:businessId/status')
  async getStatus(
    @Param('businessId') businessId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const writer = await this.service.isConfigOwner(businessId, user);
    return this.service.getStatus(businessId, { writer });
  }

  @UseGuards(AuthGuard, BusinessGuard, WhatsAppOperationsScopeGuard)
  @RequireModuleScope('operations', 'read')
  @Get('businesses/:businessId/conversations')
  async listConversations(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listConversations(businessId, limit ? Number(limit) : undefined);
  }

  @UseGuards(AuthGuard, BusinessGuard, WhatsAppOperationsScopeGuard)
  @RequireModuleScope('operations', 'read')
  @Get('businesses/:businessId/conversations/:conversationId')
  async getConversation(
    @Param('businessId') businessId: string,
    @Param('conversationId') conversationId: string,
  ) {
    const conversation = await this.service.getConversation(businessId, conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  @UseGuards(AuthGuard, BusinessGuard, WhatsAppOperationsScopeGuard)
  @RequireModuleScope('operations', 'read')
  @Get('businesses/:businessId/templates')
  async listTemplates(@Param('businessId') businessId: string) {
    return this.service.listTemplates(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, WhatsAppOperationsScopeGuard)
  @RequireModuleScope('operations', 'write')
  @Post('businesses/:businessId/messages')
  async sendFromDrawer(
    @Param('businessId') businessId: string,
    @Body()
    body: {
      toPhone?: string;
      contactId?: string;
      body?: string;
      templateName?: string;
      templateLanguage?: string;
      templateParams?: string[];
      scheduledAt?: string;
    },
  ) {
    if (!body?.toPhone) throw new BadRequestException('toPhone is required');
    return this.service.sendFromDrawer(businessId, { ...body, toPhone: body.toPhone });
  }

  // ─── Public webhook for inbound messages (verified by provider signature) ───

  // ─── Public webhook for inbound messages (verified by provider signature) ───

  /**
   * SHARED multi-tenant endpoint — Meta allows ONE callback URL per app, so
   * every business's WhatsApp messages arrive here and are routed to the
   * business whose config owns the payload's phone_number_id. The scoped
   * /webhook/:businessId route remains for direct/legacy use.
   */
  @Get('webhook')
  verifySharedWebhook(
    @Query('hub.mode') hubMode?: string,
    @Query('hub.verify_token') hubVerifyToken?: string,
    @Query('hub.challenge') hubChallenge?: string,
  ) {
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!expectedToken) {
      throw new ForbiddenException('Webhook verify token not configured');
    }
    if (hubMode === 'subscribe' && hubVerifyToken === expectedToken) {
      return hubChallenge;
    }
    throw new ForbiddenException('Invalid verify token');
  }

  @Post('webhook')
  async sharedWebhook(
    @Body() body: WhatsAppWebhookBody,
    @Query('hub.mode') hubMode?: string,
    @Query('hub.verify_token') hubVerifyToken?: string,
    @Query('hub.challenge') hubChallenge?: string,
    @Req() req?: RawBodyRequest,
  ) {
    if (hubMode === 'subscribe' && hubVerifyToken) {
      const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;
      if (expectedToken && hubVerifyToken === expectedToken) {
        return hubChallenge;
      }
      return { error: 'Invalid verify token' };
    }

    // This is Meta's one callback URL, and it routes by the phone_number_id in Meta's envelope:
    // nothing in the body is read until Meta's signature covers it, and only the Meta shape is
    // read (V1-21b review 8 FB-1). It used to check a signature only for a body that parsed as
    // Meta, while any body with a string `From` parsed as Twilio, so an unsigned body carrying a
    // `From` and Meta's envelope was routed to the business and handed to the staff bridge, which
    // answers a position by its phone with that position's KEY envelope (and resolves its pending
    // approval on a 'YES'). A Twilio signature does not stand in: it covers the URL and the
    // string fields, not the envelope this route routes by; Twilio posts to
    // /whatsapp/webhook/:businessId.
    this.assertMetaSignature(req);
    const parsed = this.parseMetaPayload(body);
    if (!parsed?.from) {
      return { success: false, error: 'Unrecognized WhatsApp webhook payload' };
    }

    const phoneNumberId = this.metaPhoneNumberId(body);
    if (!phoneNumberId) {
      return { success: true, routed: false, reason: 'no phone_number_id in payload' };
    }

    const business = await this.prisma.client.business.findFirst({
      where: { metaData: { path: ['whatsapp', 'phoneNumberId'], equals: String(phoneNumberId) } },
      select: { id: true },
    });
    if (!business) {
      return { success: true, routed: false, reason: 'phone number not connected' };
    }

    const headers = (req?.headers ?? {}) as Record<string, unknown>;
    const result = await this.service.receiveInbound(business.id, {
      from: parsed.from,
      body: parsed.body,
      externalId: parsed.externalId,
      senderName: parsed.senderName,
      provider: parsed.provider,
      rawPayload: body as unknown as Record<string, unknown>,
      receivedAt: parsed.receivedAt,
    });
    const response = { success: true, routed: true, contactId: result.contactId, isNew: result.isNew };
    await this.webhookLogger.log({
      businessId: business.id,
      connectorType: 'whatsapp',
      payload: body,
      headers,
      statusCode: 200,
      responseBody: JSON.stringify(response),
    });
    return response;
  }

  /**
   * Meta webhook verification handshake. Meta issues a GET with hub.mode,
   * hub.verify_token and hub.challenge before delivering any messages.
   * Fails closed when WHATSAPP_VERIFY_TOKEN is not configured.
   */
  @Get('webhook/:businessId')
  verifyWebhook(
    @Param('businessId') businessId: string,
    @Query('hub.mode') hubMode?: string,
    @Query('hub.verify_token') hubVerifyToken?: string,
    @Query('hub.challenge') hubChallenge?: string,
  ) {
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!expectedToken) {
      throw new ForbiddenException('Webhook verify token not configured');
    }
    if (hubMode === 'subscribe' && hubVerifyToken === expectedToken) {
      return hubChallenge;
    }
    throw new ForbiddenException('Invalid verify token');
  }

  @Post('webhook/:businessId')
  async webhook(
    @Param('businessId') businessId: string,
    @Body() body: WhatsAppWebhookBody,
    @Query('hub.mode') hubMode?: string,
    @Query('hub.verify_token') hubVerifyToken?: string,
    @Query('hub.challenge') hubChallenge?: string,
    @Req() req?: RawBodyRequest,
  ) {
    // Meta webhook verification (GET-ish via query params on POST setup)
    if (hubMode === 'subscribe' && hubVerifyToken) {
      const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;
      if (expectedToken && hubVerifyToken === expectedToken) {
        return hubChallenge;
      }
      return { error: 'Invalid verify token' };
    }

    const parsed = this.parseInboundPayload(body);
    if (!parsed) {
      return { success: false, error: 'Unrecognized WhatsApp webhook payload' };
    }

    if (!parsed.from) {
      return { success: false, error: 'Missing from' };
    }

    if (parsed.provider === 'meta') {
      this.assertMetaSignature(req);
      // V1-21b review 9 WB-2: Meta signs every business's messages with the one app secret, so
      // the signature says Meta sent the body, not that it is this business's. The body names the
      // number it was sent to; a number this business has not connected runs nothing here (POST
      // /whatsapp/webhook routes the same body to the business that owns the number).
      await this.assertMetaNumberIsBusiness(businessId, body);
    } else if (parsed.provider === 'twilio') {
      const signature = this.assertTwilioSignature(req, body as unknown as Record<string, unknown>);
      if (!(await this.claimTwilioDelivery(businessId, signature))) {
        this.logger.warn(`Dropped a repeated Twilio delivery to business ${businessId}`);
        return { success: true, duplicate: true };
      }
    }

    const headers = (req?.headers ?? {}) as Record<string, unknown>;

    try {
      const result = await this.service.receiveInbound(businessId, {
        from: parsed.from,
        body: parsed.body,
        externalId: parsed.externalId,
        senderName: parsed.senderName,
        provider: parsed.provider,
        rawPayload: body as unknown as Record<string, unknown>,
        receivedAt: parsed.receivedAt,
      });
      const response = { success: true, contactId: result.contactId, isNew: result.isNew };
      await this.webhookLogger.log({
        businessId,
        connectorType: 'whatsapp',
        payload: body,
        headers,
        statusCode: 200,
        responseBody: JSON.stringify(response),
      });
      return response;
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = err instanceof HttpException ? err.getStatus() : 500;
      await this.webhookLogger.log({
        businessId,
        connectorType: 'whatsapp',
        payload: body,
        headers,
        statusCode,
        errorMessage: message,
      });
      return { success: false, error: message };
    }
  }

  /** The phone_number_id of Meta's envelope: the business number the message was sent to. */
  private metaPhoneNumberId(body: WhatsAppWebhookBody): string | undefined {
    const id = (body as unknown as {
      entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: unknown } } }> }>;
    }).entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
    return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
  }

  /** A Meta body is taken on /whatsapp/webhook/:businessId only for a number that business connected. */
  private async assertMetaNumberIsBusiness(businessId: string, body: WhatsAppWebhookBody) {
    const phoneNumberId = this.metaPhoneNumberId(body);
    if (!phoneNumberId) {
      throw new ForbiddenException('Meta webhook payload names no phone_number_id');
    }
    const owner = await this.prisma.client.business.findFirst({
      where: { id: businessId, metaData: { path: ['whatsapp', 'phoneNumberId'], equals: phoneNumberId } },
      select: { id: true },
    });
    if (!owner) {
      throw new ForbiddenException('This WhatsApp number is not connected to this business');
    }
  }

  private assertMetaSignature(req?: RawBodyRequest) {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) {
      this.logger.error('WHATSAPP_APP_SECRET not set; rejecting Meta webhook');
      throw new ForbiddenException('Webhook secret not configured');
    }
    const header = req?.headers['x-hub-signature-256'] as string | undefined;
    if (!header || !header.startsWith('sha256=')) {
      throw new ForbiddenException('Missing Meta webhook signature');
    }
    const raw = req?.rawBody;
    if (!raw || raw.length === 0) {
      throw new ForbiddenException('Missing webhook body for signature verification');
    }
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const provided = header.slice('sha256='.length);
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      throw new ForbiddenException('Invalid Meta webhook signature');
    }
  }

  /**
   * X-Twilio-Signature, verified as Twilio computes it (V1-21c TW-SHA1): HMAC-SHA1 under the auth
   * token over the full URL followed by each POST parameter's name and value, sorted by name,
   * base64-encoded. This used HMAC-SHA256, so every genuine Twilio delivery was refused (and a
   * value Twilio never sends was taken). twilio.validateRequest is Twilio's own check, the one
   * phone-voice.controller.ts runs; it also tries the URL with and without the standard port.
   * Answers the verified signature.
   */
  private assertTwilioSignature(req?: RawBodyRequest, body?: Record<string, unknown>): string {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      this.logger.error('TWILIO_AUTH_TOKEN not set; rejecting Twilio webhook');
      throw new ForbiddenException('Webhook secret not configured');
    }
    const signature = req?.headers['x-twilio-signature'] as string | undefined;
    if (!signature) {
      throw new ForbiddenException('Missing Twilio webhook signature');
    }
    const url = this.buildTwilioUrl(req);
    if (!twilio.validateRequest(authToken, signature, url, body ?? {})) {
      throw new ForbiddenException('Invalid Twilio webhook signature');
    }
    return signature;
  }

  /**
   * Claim a verified Twilio delivery by its signature, once (V1-21c WB3-SHIFT). Twilio signs the
   * URL and the parameters as one string of names and values run together, so a captured request
   * can be replayed with a name/value boundary moved ('MessageSid=SMx&SmsMessageSid=SMx' sent as
   * 'MessageSid=SMxSmsMessageSidSMx'): the signature still verifies, and the message id the staff
   * bridge's per-message claim keys on is new. The signature is the same, so it is the key here.
   * Only its SHA-256 is stored: the signature itself would replay the request (V1-21b WB-3).
   * Answers false for a delivery already claimed.
   */
  private async claimTwilioDelivery(businessId: string, signature: string): Promise<boolean> {
    const digest = createHash('sha256').update(signature).digest('hex');
    try {
      await this.prisma.client.webhookEvent.create({
        data: { provider: 'twilio_signature', providerEventId: `${businessId}:${digest}`, eventType: 'whatsapp_inbound', businessId },
      });
      return true;
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') return false;
      throw err;
    }
  }

  private buildTwilioUrl(req?: RawBodyRequest): string {
    const protocol = (req?.headers['x-forwarded-proto'] as string) || req?.protocol || 'https';
    const host = req?.headers.host || 'localhost';
    const path = req?.originalUrl || req?.url || '';
    return `${protocol}://${host}${path}`;
  }

  private parseInboundPayload(body: WhatsAppWebhookBody): ParsedInbound | null {
    // Twilio format
    if (typeof body.From === 'string') {
      return {
        from: body.From,
        body: body.Body ?? '',
        senderName: body.ProfileName,
        externalId: body.SmsMessageSid ?? body.MessageSid,
        provider: 'twilio',
      };
    }

    return this.parseMetaPayload(body);
  }

  /** The Meta Cloud API shape only: the sender is the message's, never a top-level `From`. */
  private parseMetaPayload(body: WhatsAppWebhookBody): ParsedInbound | null {
    if (Array.isArray(body.entry) && body.entry.length > 0) {
      const change = body.entry[0]?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];
      const contact = value?.contacts?.[0];

      if (message && typeof message.from === 'string') {
        const receivedAt = message.timestamp
          ? new Date(Number(message.timestamp) * 1000)
          : undefined;
        return {
          from: message.from,
          body: message.text?.body ?? '',
          senderName: contact?.profile?.name,
          externalId: message.id,
          provider: 'meta',
          receivedAt,
        };
      }
    }

    return null;
  }
}
