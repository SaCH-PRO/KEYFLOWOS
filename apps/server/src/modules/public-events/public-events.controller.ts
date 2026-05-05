import { Body, Controller, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { PublicEventsService } from './public-events.service';
import { PublicRateLimit, PublicRateLimitGuard } from '../../core/guards/public-rate-limit.guard';
import { isCanonicalContactEventType } from '@keyflow/shared';

const VISITOR_COOKIE = 'kf_vid';
const COOKIE_MAX_AGE_DAYS = 365;

function readVisitorCookie(req: Request): string | null {
  const headerVid = req.headers['x-visitor-id'];
  if (typeof headerVid === 'string' && headerVid.trim()) return headerVid.trim();
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === VISITOR_COOKIE) return rest.join('=').trim() || null;
  }
  return null;
}

function writeVisitorCookie(res: Response, visitorId: string) {
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${VISITOR_COOKIE}=${encodeURIComponent(visitorId)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`,
  );
}

type TrackBody = {
  type: string;
  sourceDetail?: string;
  referralCode?: string;
  data?: Record<string, unknown>;
  identity?: {
    name?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    companyName?: string;
  };
};

@Controller('public-events')
export class PublicEventsController {
  constructor(@Inject(PublicEventsService) private readonly events: PublicEventsService) {}

  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(120, 60_000)
  @Post('businesses/:businessId/track')
  async track(
    @Param('businessId') businessId: string,
    @Body() body: TrackBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const type = (body?.type ?? '').trim();
    if (!type || !isCanonicalContactEventType(type)) {
      return { tracked: false, reason: 'invalid_type' };
    }

    const visitorId = readVisitorCookie(req);
    const result = await this.events.track({
      businessId,
      visitorId,
      type,
      sourceDetail: body.sourceDetail ?? null,
      referralCode: body.referralCode ?? null,
      data: (body.data ?? {}) as Prisma.InputJsonValue,
      identity: body.identity ?? null,
    });

    if (!visitorId || visitorId !== result.visitorId) {
      writeVisitorCookie(res, result.visitorId);
    }

    return {
      tracked: true,
      visitorId: result.visitorId,
      contactId: result.contactId,
      eventId: result.eventId,
    };
  }
}
