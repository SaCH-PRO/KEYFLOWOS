import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Logger, Param, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
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
  // POST google/import and the CSV import (R0-13) do. Review repairs SEC-GIS-2
  // and CR-W7G-1: it is issued only to a member the import admits
  // (CrmGoogleService.assertCanImport, so crm_edit 'none' is refused 403 here
  // too), and its signed state names that member, whom the callback imports as.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/google/auth-url')
  async getGoogleAuthUrl(
    @Param('businessId') businessId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    const memberId = req?.user?.id;
    if (!memberId) {
      throw new UnauthorizedException('Authentication required');
    }
    const url = await this.google.getAuthUrl(businessId, memberId);
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

    // W7-GOOGLE-IMPORT-SCOPE review repairs (SEC-GIS-1, SEC-GIS-2, SEC-GIS-3,
    // CR-W7G-1): this public route has no session, so the verified state is
    // the only binding. verifyState accepts only a state getAuthUrl minted for
    // the CRM contact import, naming its business and member, once. The import
    // then runs as that member, re-checked now (crm write, allowed to create
    // contacts) before Google is called, and through the same edit/visibility
    // door and audit actor as POST google/import. Before, any state signed with
    // GOOGLE_STATE_SECRET (a bookings calendar state any member can get) was
    // accepted, any number of times, and imported in system context.
    const verifiedState = this.google.verifyState(state);
    if (!verifiedState) {
      return res.redirect('/app/crm/contacts?google_error=invalid_state');
    }

    try {
      await this.google.assertCanImport(verifiedState.businessId, verifiedState.memberId);
    } catch (err: unknown) {
      this.logger.warn(`Google OAuth callback refused: ${(err as Error).message}`);
      const refused = err instanceof ForbiddenException || err instanceof UnauthorizedException;
      return res.redirect(`/app/crm/contacts?google_error=${refused ? 'forbidden' : 'import_failed'}`);
    }

    try {
      const tokens = await this.google.exchangeCodeForTokens(code);
      const result = await this.google.importGoogleContacts({
        businessId: verifiedState.businessId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        actorUserId: verifiedState.memberId,
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
