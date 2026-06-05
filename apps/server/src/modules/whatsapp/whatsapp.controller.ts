import { Body, Controller, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { WhatsAppService, type WhatsAppConfig } from './whatsapp.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('whatsapp')
export class WhatsAppController {
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
    @Body() body: { From?: string; Body?: string; WaId?: string; ProfileName?: string; SmsMessageSid?: string },
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

    // Twilio/Meta inbound message
    const from = body.From ?? body.WaId ?? '';
    const messageBody = body.Body ?? '';
    const externalId = body.SmsMessageSid ?? body.WaId ?? undefined;
    const senderName = body.ProfileName ?? undefined;

    if (!from) {
      return { success: false, error: 'Missing from' };
    }

    const result = await this.service.receiveInbound(businessId, {
      from,
      body: messageBody,
      externalId,
      senderName,
    });

    return { success: true, contactId: result.contactId, isNew: result.isNew };
  }
}
