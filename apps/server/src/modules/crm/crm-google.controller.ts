import { BadRequestException, Body, Controller, Get, Inject, Logger, Param, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { CrmGoogleService } from './crm-google.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { CrmRateLimitGuard, CrmRateLimit } from './guards/rate-limit.guard';
import type { Response } from 'express';

@Controller('crm')
@UseGuards(CrmRateLimitGuard)
export class CrmGoogleController {
  private readonly logger = new Logger(CrmGoogleController.name);

  constructor(
    @Inject(CrmGoogleService) private readonly google: CrmGoogleService,
  ) {}

  // W7-GOOGLE-IMPORT-SCOPE (review finding ST-1): this URL starts the Google
  // contact import the OAuth callback completes, so it needs crm write, as
  // POST google/import and the CSV import (R0-13) do.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
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
      return res.redirect('/app/crm/contacts?google_error=missing_params');
    }

    const verifiedState = this.google.verifyState(state);
    if (!verifiedState) {
      return res.redirect('/app/crm/contacts?google_error=invalid_state');
    }

    try {
      const tokens = await this.google.exchangeCodeForTokens(code);
      const result = await this.google.importGoogleContacts({
        businessId: verifiedState.businessId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });

      return res.redirect(`/app/crm/contacts?google_success=true&imported=${result.imported}`);
    } catch (err: any) {
      this.logger.error('Google OAuth callback failed', (err as Error).message);
      return res.redirect('/app/crm/contacts?google_error=import_failed');
    }
  }

  // W7-GOOGLE-IMPORT-SCOPE (review finding ST-1): a Google import writes
  // contacts, so it needs crm write (as the CSV import does since R0-13), and
  // the requesting member is the actor every contact write checks and records
  // (CrmGoogleService.importGoogleContacts). Before, the route ran under
  // AuthGuard and BusinessGuard only and imported with no actor, so a crm
  // read-only member could merge Google data into the owner's PRIVATE contact.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/google/import')
  async importFromGoogle(
    @Param('businessId') businessId: string,
    @Body() body: { accessToken: string; refreshToken?: string },
    @Req() req: { user?: { id?: string } },
  ) {
    const actorUserId = req?.user?.id;
    if (!actorUserId) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!body.accessToken) {
      throw new BadRequestException('accessToken is required');
    }
    return this.google.importGoogleContacts({
      businessId,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      actorUserId,
    });
  }
}
