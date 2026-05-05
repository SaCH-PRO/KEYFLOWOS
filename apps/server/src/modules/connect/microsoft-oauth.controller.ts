import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { MicrosoftOAuthService } from './microsoft-oauth.service';

@Controller('connect/microsoft')
export class MicrosoftOAuthController {
  constructor(
    @Inject(MicrosoftOAuthService) private readonly svc: MicrosoftOAuthService,
  ) {}

  // Auth URL is path-scoped to :businessId so BusinessGuard can enforce
  // membership; we deliberately do NOT expose a query-only variant since
  // that would allow IDOR (any authenticated user binding OAuth to any
  // businessId they can guess).
  @Get('businesses/:businessId/auth-url')
  @UseGuards(AuthGuard, BusinessGuard)
  buildAuthUrl(@Param('businessId') businessId: string): { authUrl: string } {
    return { authUrl: this.svc.buildAuthUrl(businessId) };
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '';
    const success = `${appUrl}/app/settings/contact-sources?microsoft=connected`;
    const failure = `${appUrl}/app/settings/contact-sources?microsoft=error`;
    if (error) return res.redirect(`${failure}&reason=${encodeURIComponent(error)}`);
    if (!code || !state) throw new BadRequestException('Missing code or state');
    try {
      const result = await this.svc.handleCallback(code, state);
      const params = new URLSearchParams({
        microsoft: result.ok ? 'connected' : 'verify_failed',
        email: result.email,
        ...(result.error ? { reason: result.error } : {}),
      });
      return res.redirect(`${appUrl}/app/settings/contact-sources?${params.toString()}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown';
      return res.redirect(`${failure}&reason=${encodeURIComponent(reason)}`);
    }
  }
}
