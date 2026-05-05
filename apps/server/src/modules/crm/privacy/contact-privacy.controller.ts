import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { BusinessGuard } from '../../../core/auth/business.guard';
import {
  ModuleScopeGuard,
  RequireModuleScope,
} from '../../../core/auth/module-scope.guard';
import { ContactAuditService } from './contact-audit.service';
import { ContactPrivacyService } from './contact-privacy.service';

function clientMeta(req: Request) {
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null;
  const userAgent = (req.headers['user-agent'] as string | undefined) || null;
  return { ip, userAgent };
}

@Controller('crm')
export class ContactPrivacyController {
  constructor(
    @Inject(ContactAuditService) private readonly audit: ContactAuditService,
    @Inject(ContactPrivacyService) private readonly privacy: ContactPrivacyService,
  ) {}

  // ----- Audit tab -----

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @Get('businesses/:businessId/contacts/:contactId/audit')
  listAudit(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.audit.list({
      businessId,
      contactId,
      action: action || undefined,
      actorId: actorId || undefined,
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
      limit: limit ? Number(limit) : undefined,
      cursor: cursor || undefined,
    });
  }

  // ----- Export -----

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @Post('businesses/:businessId/contacts/:contactId/export')
  export(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: Request & { user?: { id?: string; email?: string } },
  ) {
    const meta = clientMeta(req);
    return this.privacy.exportContact({
      businessId,
      contactId,
      actor: req.user?.id
        ? { type: 'USER', id: req.user.id, label: req.user.email ?? null }
        : { type: 'SYSTEM' },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  // Public download — token in URL acts as auth.
  @Get('contact-exports/:token/download')
  async download(
    @Param('token') token: string,
    @Query('format') format: string | undefined,
    @Req() req: Request,
  ) {
    if (!token || token.length < 16) {
      throw new BadRequestException('Invalid token');
    }
    const fmt = format === 'json' ? 'json' : 'zip';
    const meta = clientMeta(req);
    return this.privacy.resolveDownload({
      token,
      format: fmt,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  // ----- Forget -----

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @Post('businesses/:businessId/contacts/:contactId/forget')
  forget(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { reason?: string } | undefined,
    @Req() req: Request & { user?: { id?: string; email?: string } },
  ) {
    const meta = clientMeta(req);
    return this.privacy.requestForget({
      businessId,
      contactId,
      reason: body?.reason ?? null,
      actor: req.user?.id
        ? { type: 'USER', id: req.user.id, label: req.user.email ?? null }
        : { type: 'SYSTEM' },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @Post('businesses/:businessId/contacts/:contactId/forget/cancel')
  cancelForget(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: Request & { user?: { id?: string; email?: string } },
  ) {
    const meta = clientMeta(req);
    return this.privacy.cancelForget({
      businessId,
      contactId,
      actor: req.user?.id
        ? { type: 'USER', id: req.user.id, label: req.user.email ?? null }
        : { type: 'SYSTEM' },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  // ----- Settings → Privacy -----

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/privacy-settings')
  getSettings(@Param('businessId') businessId: string) {
    return this.privacy.getSettings(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/privacy-settings')
  updateSettings(
    @Param('businessId') businessId: string,
    @Body() body: { forgetGraceDays?: number; defaultForgetReason?: string | null },
  ) {
    return this.privacy.updateSettings({
      businessId,
      forgetGraceDays: body.forgetGraceDays,
      defaultForgetReason: body.defaultForgetReason ?? undefined,
    });
  }
}
