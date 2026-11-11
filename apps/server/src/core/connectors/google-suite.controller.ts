import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { BusinessGuard } from '../auth/business.guard';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleSuiteService, ALL_SERVICES } from './google-suite.service';
import type { GoogleService } from './google-suite.service';

/**
 * W8-GOOGLE-CONSENT-OWNER (owner ruling D-99): every Google connection of a
 * business (Calendar, Drive, Contacts, Gmail, Analytics, Search Console) is
 * started, synced and disconnected only by the business owner. Anyone else
 * gets 403 with this code before a consent URL is built or a stored
 * connection is touched. Gmail keeps its own GMAIL_OWNER_ONLY (R0-CMF5, D-11)
 * and Analytics and Search Console SEO_CONNECTOR_OWNER_ONLY (D-94): same rule.
 */
export const GOOGLE_CONNECT_OWNER_ONLY = 'GOOGLE_CONNECT_OWNER_ONLY';
const GOOGLE_CONNECT_OWNER_ONLY_MESSAGE =
  'Only the business owner can connect, sync or disconnect a Google service for this business';

export type GoogleConnectActor = { id?: string; role?: string };

/**
 * W8-GOOGLE-CONSENT-OWNER (owner ruling D-99): the owner rule for a Google
 * connection of `businessId`. It is the Gmail rule's shape
 * (GmailService.assertConnectAuthority, D-11), as SeoController restates it
 * for D-94: an OWNER membership of this business or its distinguished owner
 * (Business.ownerId), with the SUPER_ADMIN bypass BusinessGuard already
 * grants. The rule is the route business's own: owning another business does
 * not count. No actor is 401; anyone else 403 GOOGLE_CONNECT_OWNER_ONLY. The
 * routes call it first (after AuthGuard and BusinessGuard), before anything is
 * read or written. Exported for the bookings calendar, Drive and CRM Google
 * contact import doors, whose modules do not import CommerceModule.
 */
export async function assertGoogleConnectOwner(
  prisma: PrismaService,
  businessId: string,
  actor: GoogleConnectActor | undefined,
): Promise<void> {
  if (!actor?.id) throw new UnauthorizedException('Authentication required');
  if (actor.role === 'SUPER_ADMIN') return;
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId: actor.id, businessId } },
    select: { role: true },
  });
  if (membership?.role === 'OWNER') return;
  const owned = await prisma.client.business.findFirst({
    // Owner ruling D-104 (W10-OWNER-MEMBERSHIP): the ownerId arm counts only with a Membership row.
    where: { id: businessId, ownerId: actor.id, members: { some: { userId: actor.id } } },
    select: { id: true },
  });
  if (owned) return;
  throw new ForbiddenException({ code: GOOGLE_CONNECT_OWNER_ONLY, message: GOOGLE_CONNECT_OWNER_ONLY_MESSAGE });
}

@Controller('connect/google-suite')
export class GoogleSuiteController {
  constructor(
    @Inject(GoogleSuiteService) private readonly suite: GoogleSuiteService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * R0-CMF5 review ST-CMF5-1: a consent that includes gmail (the default, all
   * services, does) connects the business mailbox invoices, reminders, receipts
   * and quotes are sent from, so it follows the Gmail owner rule (owner ruling
   * D-11; GmailService.assertConnectAuthority: OWNER membership,
   * Business.ownerId or SUPER_ADMIN, else 403 GMAIL_OWNER_ONLY), and the state
   * names the caller so the Gmail grant is only staged for them to confirm.
   *
   * W8-GOOGLE-CONSENT-OWNER (owner ruling D-99, settling W7 review CR-RCV-1,
   * SEC-W7RCV-2, CR-RCV-2): a consent without gmail is the owner's too, by the
   * same rule (assertGoogleConnectOwner, 403 GOOGLE_CONNECT_OWNER_ONLY); R0-CMF5
   * review 2 (CMF5R-2) had left it open to members. The bookings calendar and
   * Drive consent URLs follow the same rule. The web key-connect sign-in still
   * retries without gmail on GMAIL_OWNER_ONLY; that retry is now refused too
   * and its message shown (web follow-up).
   */
  @Post('businesses/:businessId/auth-url')
  @UseGuards(AuthGuard, BusinessGuard)
  async buildAuthUrl(
    @Param('businessId') businessId: string,
    @Req() req: { user?: { id: string; role?: string } },
    @Body() body: { services?: unknown } = {},
  ): Promise<{ authUrl: string; services: GoogleService[] }> {
    const requested = Array.isArray(body?.services) && body.services.length ? body.services : ALL_SERVICES;
    const unknown = requested.filter((s) => !ALL_SERVICES.includes(s as GoogleService));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown Google service: ${unknown.map(String).join(', ')}`);
    }
    const services = requested as GoogleService[];
    if (services.includes('gmail')) {
      const gmail = await this.suite.gmailBinding();
      await gmail.assertConnectAuthority(businessId, req.user);
    } else {
      await assertGoogleConnectOwner(this.prisma, businessId, req.user);
    }
    return { authUrl: this.suite.buildAuthUrl(businessId, services, req.user?.id), services };
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '';
    const failure = `${appUrl}/app/key-connect?google=error`;

    if (error) {
      return res.redirect(`${failure}&reason=${encodeURIComponent(error)}`);
    }
    if (!code || !state) {
      throw new BadRequestException('Missing code or state');
    }
    try {
      const result = await this.suite.handleCallback(code, state);
      const params = new URLSearchParams({
        google: 'connected',
        services: result.enabledServices.join(','),
        email: result.email,
      });
      if (result.gmailPendingId) {
        // R0-CMF5 review ST-CMF5-1: the Gmail grant is staged, not linked. The
        // commerce page shows the mailbox and the owner who started it confirms.
        const pending = new URLSearchParams({ gmail: 'pending', pending: result.gmailPendingId, google: 'connected', services: params.get('services') ?? '' });
        return res.redirect(`${appUrl}/app/commerce?${pending.toString()}`);
      }
      return res.redirect(`${appUrl}/app/key-connect?${params.toString()}`);
    } catch (err: any) {
      const reason = err instanceof Error ? err.message : 'Unknown error';
      return res.redirect(`${failure}&reason=${encodeURIComponent(reason)}`);
    }
  }
}
