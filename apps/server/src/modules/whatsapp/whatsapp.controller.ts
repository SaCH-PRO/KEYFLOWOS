import { Body, Controller, ForbiddenException, Get, HttpException, Inject, Logger, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { WhatsAppService, type WhatsAppConfig } from './whatsapp.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { WebhookIngressLoggerService } from '../../core/connectors/webhook-ingress-logger.service';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

interface WhatsAppWebhookBody {
  From?: string;
  Body?: string;
  WaId?: string;
  ProfileName?: string;
  SmsMessageSid?: string;
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
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/config')
  async getConfig(@Param('businessId') businessId: string) {
    const config = await this.service.getConfig(businessId);
    return { data: config };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/config')
  async saveConfig(@Param('businessId') businessId: string, @Body() config: WhatsAppConfig) {
    await this.service.saveConfig(businessId, config);
    return { success: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/send')
  async sendMessage(
    @Param('businessId') businessId: string,
    @Body() body: { to: string; message: string },
  ) {
    const result = await this.service.sendMessage(businessId, { to: body.to, body: body.message });
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/test')
  async testConnection(@Param('businessId') businessId: string) {
    const config = await this.service.getConfig(businessId);
    if (!config) return { success: false, error: 'Not configured' };
    return { success: true, provider: config.provider };
  }

  // ─── Public webhook for inbound messages (verified by provider signature) ───

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
    } else if (parsed.provider === 'twilio') {
      this.assertTwilioSignature(req, body as unknown as Record<string, unknown>);
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

  private assertTwilioSignature(req?: RawBodyRequest, body?: Record<string, unknown>) {
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
    const raw = req?.rawBody?.toString('utf8') ?? '';
    const isValid = this.verifyTwilioSignature(url, raw, body ?? {}, signature, authToken);
    if (!isValid) {
      throw new ForbiddenException('Invalid Twilio webhook signature');
    }
  }

  private buildTwilioUrl(req?: RawBodyRequest): string {
    const protocol = (req?.headers['x-forwarded-proto'] as string) || req?.protocol || 'https';
    const host = req?.headers.host || 'localhost';
    const path = req?.originalUrl || req?.url || '';
    return `${protocol}://${host}${path}`;
  }

  private verifyTwilioSignature(
    url: string,
    _rawBody: string,
    body: Record<string, unknown>,
    signature: string,
    authToken: string,
  ): boolean {
    let payload = url;
    const keys = Object.keys(body).sort();
    for (const key of keys) {
      const value = body[key];
      if (typeof value === 'string') {
        payload += key + value;
      }
    }
    const expected = createHmac('sha256', authToken).update(payload).digest('base64');
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  private parseInboundPayload(body: WhatsAppWebhookBody): ParsedInbound | null {
    // Twilio format
    if (typeof body.From === 'string') {
      return {
        from: body.From,
        body: body.Body ?? '',
        senderName: body.ProfileName,
        externalId: body.SmsMessageSid,
        provider: 'twilio',
      };
    }

    // Meta Cloud API format
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
