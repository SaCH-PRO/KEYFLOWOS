import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Logger,
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
  private readonly logger = new Logger(PhoneVoiceController.name);

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

  /**
   * Verify the call really came from Twilio — and REFUSE when we cannot tell.
   *
   * This used to read:
   *
   *     const token = process.env.TWILIO_AUTH_TOKEN;
   *     if (!token) return; // dev convenience; production must configure the token
   *
   * Nothing enforced that comment. Measured 2026-08-10: `.env.production`
   * contains no TWILIO_* variables at all, so on the live server the check
   * returned immediately and `POST /cortex/phone/inbound?businessId=<anything>`
   * was completely unauthenticated — accepting an attacker-supplied tenant id
   * and answering with TwiML carrying the voice-bridge WebSocket URL for that
   * business.
   *
   * An unconfigured verifier that accepts everything is worse than no endpoint,
   * because the route looks protected in review: there IS a signature check,
   * and it is called on the first line. This is the same failure the CI gate in
   * scripts/deploy.sh was fixed for — "an unavailable checker that waves the
   * deploy through is the same failure one layer down" — so it takes the same
   * shape: fail closed, and make the escape hatch explicit enough that nobody
   * sets it by accident.
   *
   * PHONE_VOICE_ALLOW_UNVERIFIED=1 restores the old behaviour for local work
   * against a tunnel, where Twilio's signature is computed over a URL the
   * server cannot reconstruct. It logs every time it is used, because a
   * bypass nobody can see is how this started.
   */
  private assertValidTwilioSignature(req: Request) {
    const token = process.env.TWILIO_AUTH_TOKEN;

    if (!token) {
      if (process.env.PHONE_VOICE_ALLOW_UNVERIFIED === '1') {
        this.logger.warn(
          'PHONE_VOICE_ALLOW_UNVERIFIED=1 — accepting an UNVERIFIED inbound call webhook. ' +
            'Never set this in production.',
        );
        return;
      }
      throw new ForbiddenException(
        'Inbound voice webhook rejected: TWILIO_AUTH_TOKEN is not configured, so this ' +
          'request cannot be verified as coming from Twilio.',
      );
    }

    const signature = req.headers['x-twilio-signature'] as string | undefined;
    const url = `${baseUrl()}${req.originalUrl}`;
    const valid = twilio.validateRequest(token, signature ?? '', url, req.body as Record<string, unknown>);
    if (!valid) {
      throw new BadRequestException('Invalid Twilio signature');
    }
  }
}
