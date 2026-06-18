import { Body, Controller, Get, Inject, Logger, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { WhatsAppService, type WhatsAppConfig } from './whatsapp.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

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

  // ─── Public webhook for inbound messages (no auth — verified by provider signature in production) ───

  @Post('webhook/:businessId')
  async webhook(
    @Param('businessId') businessId: string,
    @Body() body: WhatsAppWebhookBody,
    @Query('hub.mode') hubMode?: string,
    @Query('hub.verify_token') hubVerifyToken?: string,
    @Query('hub.challenge') hubChallenge?: string,
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

    const result = await this.service.receiveInbound(businessId, {
      from: parsed.from,
      body: parsed.body,
      externalId: parsed.externalId,
      senderName: parsed.senderName,
      provider: parsed.provider,
      rawPayload: body as unknown as Record<string, unknown>,
      receivedAt: parsed.receivedAt,
    });

    return { success: true, contactId: result.contactId, isNew: result.isNew };
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
