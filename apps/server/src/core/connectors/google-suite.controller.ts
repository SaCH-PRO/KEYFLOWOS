import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { BusinessGuard } from '../auth/business.guard';
import { GoogleSuiteService, ALL_SERVICES } from './google-suite.service';
import type { GoogleService } from './google-suite.service';

@Controller('connect/google-suite')
export class GoogleSuiteController {
  constructor(
    @Inject(GoogleSuiteService) private readonly suite: GoogleSuiteService,
  ) {}

  /**
   * R0-CMF5 review ST-CMF5-1: a consent that includes gmail (the default, all
   * services, does) connects the business mailbox invoices, reminders, receipts
   * and quotes are sent from, so it follows the Gmail owner rule (owner ruling
   * D-11; GmailService.assertConnectAuthority: OWNER membership,
   * Business.ownerId or SUPER_ADMIN, else 403 GMAIL_OWNER_ONLY), and the state
   * names the caller so the Gmail grant is only staged for them to confirm.
   *
   * W7-RECENT-CONTACTS-VISIBILITY (owner ruling D-94): every consent follows
   * that rule, whatever services it asks for. A calendar, drive, forms,
   * contacts or business profile grant stores the business's Google OAuth
   * tokens on the business and provisions its connectors, which D-94 makes the
   * owner's alone, as Gmail (and GA4 and Search Console) are: anyone else gets
   * 403 GMAIL_OWNER_ONLY before a URL is minted. Checked after the services are
   * validated, so an unknown service is still a 400.
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
    const gmail = await this.suite.gmailBinding();
    await gmail.assertConnectAuthority(businessId, req.user);
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
