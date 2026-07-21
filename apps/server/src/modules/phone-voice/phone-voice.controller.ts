import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import twilio from 'twilio';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

const STREAM_PATH = '/api/v1/cortex/phone/stream';
const INBOUND_PATH = '/api/v1/cortex/phone/inbound';

function baseUrl(): string {
  // The voice bridge lives on the API host, not the web app host (APP_URL
  // points at the Next.js app in dev).
  return (process.env.PUBLIC_BASE_URL ?? process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
}

@Controller('api/v1/cortex/phone')
export class PhoneVoiceController {
  /**
   * Twilio inbound-call webhook. Answers with TwiML that connects the call
   * to the realtime voice bridge. Configure the number's voice webhook to:
   *   {PUBLIC_BASE_URL}/api/v1/cortex/phone/inbound?businessId=<businessId>
   */
  @Post('inbound')
  inbound(@Query('businessId') businessId: string, @Req() req: Request, @Res() res: Response) {
    if (!businessId) {
      throw new BadRequestException('businessId is required');
    }
    this.assertValidTwilioSignature(req);

    const wsUrl = `${baseUrl().replace(/^http/, 'ws')}${STREAM_PATH}?businessId=${encodeURIComponent(businessId)}`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}" />
  </Connect>
</Response>`;
    res.type('text/xml').send(twiml);
  }

  /**
   * Place an outbound call whose audio is handled by the voice bridge.
   * Requires TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER.
   */
  @Post('outbound')
  @UseGuards(AuthGuard, BusinessGuard)
  async outbound(@Body() dto: { to: string; purpose?: string; businessId: string }) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER;
    if (!sid || !token || !from) {
      throw new ServiceUnavailableException('Twilio is not configured (TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER)');
    }
    if (!dto.to) throw new BadRequestException('to is required');
    if (!dto.businessId) throw new BadRequestException('businessId is required');

    const url = `${baseUrl()}${INBOUND_PATH}?businessId=${encodeURIComponent(dto.businessId)}`;
    const client = twilio(sid, token);
    const call = await client.calls.create({ to: dto.to, from, url });
    return { callSid: call.sid, status: call.status, to: dto.to };
  }

  private assertValidTwilioSignature(req: Request) {
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!token) return; // dev convenience; production must configure the token
    const signature = req.headers['x-twilio-signature'] as string | undefined;
    const url = `${baseUrl()}${req.originalUrl}`;
    const valid = twilio.validateRequest(token, signature ?? '', url, req.body as Record<string, unknown>);
    if (!valid) {
      throw new BadRequestException('Invalid Twilio signature');
    }
  }
}
