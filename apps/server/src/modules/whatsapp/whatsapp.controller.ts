import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { WhatsAppService } from './whatsapp.service';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

@Controller('whatsapp')
export class WhatsAppController {
  constructor(
    @Inject(WhatsAppService) private readonly service: WhatsAppService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/status')
  status(@Param('businessId') businessId: string) {
    return this.service.getConnectionStatus(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/conversations')
  list(@Param('businessId') businessId: string) {
    return this.service.listConversations(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/conversations/:contactId')
  get(@Param('businessId') businessId: string, @Param('contactId') contactId: string) {
    return this.service.getConversation(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/templates')
  templates(@Param('businessId') businessId: string) {
    return this.service.listTemplates(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/messages')
  send(
    @Param('businessId') businessId: string,
    @Body() body: {
      toPhone: string;
      contactId?: string;
      body?: string;
      templateName?: string;
      templateLanguage?: string;
      templateParams?: string[];
      mediaUrls?: string[];
      scheduledAt?: string;
    },
  ) {
    if (!body?.toPhone) throw new BadRequestException('toPhone is required');
    return this.service.sendMessage(businessId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/messages/schedule')
  schedule(
    @Param('businessId') businessId: string,
    @Body() body: {
      toPhone: string;
      contactId?: string;
      body?: string;
      templateName?: string;
      templateLanguage?: string;
      templateParams?: string[];
      mediaUrls?: string[];
      scheduledAt: string;
    },
  ) {
    if (!body?.toPhone) throw new BadRequestException('toPhone is required');
    if (!body?.scheduledAt) throw new BadRequestException('scheduledAt is required');
    return this.service.sendMessage(businessId, body);
  }

  // --- Inbound webhook (Meta WhatsApp) ---

  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ) {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!expected) throw new ForbiddenException('Webhook not configured');
    if (mode === 'subscribe' && token === expected) {
      return challenge ?? '';
    }
    throw new ForbiddenException('Invalid verify token');
  }

  @Post('webhook')
  async receiveWebhook(@Req() req: RawBodyRequest, @Body() body: WhatsAppWebhookBody) {
    this.assertValidSignature(req);

    const businessIdHint = (body?.business_id as string) || (req.query?.business_id as string);
    const entries = body?.entry ?? [];
    const results: Array<{ id?: string }> = [];

    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;
        const phoneNumberId = value.metadata?.phone_number_id;
        const businessId = businessIdHint || (await this.resolveBusinessFromPhoneNumberId(phoneNumberId));
        if (!businessId) continue;

        for (const msg of value.messages ?? []) {
          if (msg.type !== 'text' && msg.type !== 'button' && msg.type !== 'interactive' && msg.type !== 'image' && msg.type !== 'document' && msg.type !== 'video') continue;
          const text = msg.text?.body ?? msg.button?.text ?? msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? undefined;
          const senderName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name;
          const result = await this.service.receiveInbound({
            businessId,
            from: msg.from,
            body: text,
            wamid: msg.id,
            senderName,
            timestamp: msg.timestamp ? new Date(parseInt(msg.timestamp, 10) * 1000) : undefined,
          });
          if (result) results.push({ id: result.id });
        }
      }
    }

    return { ok: true, processed: results.length };
  }

  /**
   * Verify Meta's `x-hub-signature-256` HMAC over the raw request body.
   * Fails closed: if WHATSAPP_APP_SECRET is unset, or the header is missing
   * or invalid, the request is rejected — no inbound writes are performed.
   */
  private assertValidSignature(req: RawBodyRequest) {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
      throw new ForbiddenException('WhatsApp webhook secret is not configured');
    }
    const header = (req.headers['x-hub-signature-256'] || req.headers['X-Hub-Signature-256']) as string | undefined;
    if (!header || !header.startsWith('sha256=')) {
      throw new ForbiddenException('Missing webhook signature');
    }
    const raw = req.rawBody;
    if (!raw || raw.length === 0) {
      throw new ForbiddenException('Missing webhook body for signature verification');
    }
    const expected = createHmac('sha256', appSecret).update(raw).digest('hex');
    const provided = header.slice('sha256='.length);
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      throw new ForbiddenException('Invalid webhook signature');
    }
  }

  private async resolveBusinessFromPhoneNumberId(phoneNumberId?: string): Promise<string | null> {
    if (!phoneNumberId) return null;
    const dest = await this.prisma.client.channelDestination.findFirst({
      where: { platform: 'WHATSAPP', platformId: phoneNumberId },
      select: { businessId: true },
    });
    return dest?.businessId ?? null;
  }
}

interface WhatsAppWebhookBody {
  business_id?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{
          id?: string;
          from: string;
          timestamp?: string;
          type: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
        }>;
      };
    }>;
  }>;
}
