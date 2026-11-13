import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { assertMayBindExport } from '../../core/connectors/connector-exports';
import { PrismaService } from '../../core/prisma/prisma.service';
import { MicrosoftOAuthService } from './microsoft-oauth.service';

@Controller('connect/microsoft')
export class MicrosoftOAuthController {
  constructor(
    @Inject(MicrosoftOAuthService) private readonly svc: MicrosoftOAuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  // Auth URL is path-scoped to :businessId so BusinessGuard can enforce
  // membership; we deliberately do NOT expose a query-only variant since
  // that would allow IDOR (any authenticated user binding OAuth to any
  // businessId they can guess).
  //
  // SWEEP-P0-SCOPES second review repair (finding SV-3, the SEC-1 credential
  // class): membership is not enough. The signed state names the business
  // only, and the public callback stores the Outlook contacts tokens of
  // whoever completes the consent on that business, so a member who started
  // it with their own Microsoft account replaced the owner's connection.
  // Starting it needs settings admin, as the connector credentials do (OWNER
  // and ADMIN by role default, STAFF none; an explicit map binds every role,
  // D-114). The Google connections keep their owner rule (D-99).
  //
  // SWEEP-P0-SCOPES round 3 class repair (CLASS A; finding WPH2-1): the
  // account this consent binds receives the business's contacts (the Outlook
  // contacts push sends every linked contact's edits to it), so the member who
  // starts it reads crm too (assertMayBindExport, CONNECTOR_EXPORT_READS
  // outlook_contacts), as the integration pushes' binders do. The signed state
  // names that member, and the callback records them as the account's binder,
  // the receiver every push is checked for.
  @Get('businesses/:businessId/auth-url')
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'admin')
  async buildAuthUrl(
    @Param('businessId') businessId: string,
    @Req() req: { user?: { id?: string; role?: string } },
  ): Promise<{ authUrl: string }> {
    await assertMayBindExport(this.prisma, businessId, req.user, 'outlook_contacts');
    return { authUrl: this.svc.buildAuthUrl(businessId, req.user?.id ?? '') };
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
    } catch (err: any) {
      const reason = err instanceof Error ? err.message : 'unknown';
      return res.redirect(`${failure}&reason=${encodeURIComponent(reason)}`);
    }
  }
}
