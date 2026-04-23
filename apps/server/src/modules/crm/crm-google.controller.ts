import { BadRequestException, Body, Controller, Get, Inject, Logger, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { CrmGoogleService } from './crm-google.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CrmRateLimitGuard, CrmRateLimit } from './guards/rate-limit.guard';
import type { Response } from 'express';

@Controller('crm')
@UseGuards(CrmRateLimitGuard)
export class CrmGoogleController {
  private readonly logger = new Logger(CrmGoogleController.name);

  constructor(
    @Inject(CrmGoogleService) private readonly google: CrmGoogleService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/google/auth-url')
  getGoogleAuthUrl(@Param('businessId') businessId: string) {
    const url = this.google.getAuthUrl(businessId);
    return { url };
  }

  @Get('google/callback')
  async handleGoogleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      return res.redirect('/app/crm/pipeline?google_error=missing_params');
    }

    const verifiedState = this.google.verifyState(state);
    if (!verifiedState) {
      return res.redirect('/app/crm/pipeline?google_error=invalid_state');
    }

    try {
      const tokens = await this.google.exchangeCodeForTokens(code);
      const result = await this.google.importGoogleContacts({
        businessId: verifiedState.businessId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });

      return res.redirect(`/app/crm/pipeline?google_success=true&imported=${result.imported}`);
    } catch (err) {
      this.logger.error('Google OAuth callback failed', (err as Error).message);
      return res.redirect('/app/crm/pipeline?google_error=import_failed');
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/google/import')
  async importFromGoogle(
    @Param('businessId') businessId: string,
    @Body() body: { accessToken: string; refreshToken?: string },
  ) {
    if (!body.accessToken) {
      throw new BadRequestException('accessToken is required');
    }
    return this.google.importGoogleContacts({
      businessId,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
    });
  }
}
