import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { BusinessGuard } from '../../../core/auth/business.guard';
import {
  ModuleScopeGuard,
  RequireModuleScope,
} from '../../../core/auth/module-scope.guard';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { assertContactVisible, type CrmAccess } from '../crm-permissions.helper';
import { contactWhereWithId } from '../crm.helpers';
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

function actorUserId(req: { user?: { id?: string } }): string {
  // ModuleScopeGuard already refuses a request without a user; this keeps the
  // routes closed if it ever does not.
  const id = req.user?.id;
  if (!id) throw new UnauthorizedException('Authentication required');
  return id;
}

/**
 * The contact-scoped routes answer only for a contact the caller may open by
 * the GET crm contacts/:contactId rule (V1-08 assertContactVisible): a hidden
 * contact gets the same 404 'Contact not found' as an unknown id, before any
 * service call (FOLLOW3-D3). A forget soft-deletes its contact for the grace
 * period (D-25), so audit, export and forget/cancel apply that rule with
 * `includeDeleted`: the tenant predicate and the caller's visibility, without
 * the deletedAt filter, so the member who may open the contact keeps the
 * cancel window. Forget acts on a live contact and keeps the GET detail rule.
 *
 * Forget soft-deletes the contact and schedules its purge, so it also holds the
 * member's CRM delete scope exactly as DELETE contacts/:contactId does
 * (CrmService.softDeleteContact), after the visibility check (review ST-3,
 * CR-1). The business's privacy settings (the forget grace window, and the
 * recent forget requests with their reasons) need CRM admin scope (review
 * ST-4).
 */
@Controller('crm')
export class ContactPrivacyController {
  constructor(
    @Inject(ContactAuditService) private readonly audit: ContactAuditService,
    @Inject(ContactPrivacyService) private readonly privacy: ContactPrivacyService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  // ----- Audit tab -----

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @Get('businesses/:businessId/contacts/:contactId/audit')
  async listAudit(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    await assertContactVisible(this.prisma, businessId, contactId, actorUserId(req), { includeDeleted: true });
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
  async export(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: Request & { user?: { id?: string; email?: string } },
  ) {
    await assertContactVisible(this.prisma, businessId, contactId, actorUserId(req), { includeDeleted: true });
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
  async forget(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { reason?: string } | undefined,
    @Req() req: Request & { user?: { id?: string; email?: string } },
  ) {
    const actor = actorUserId(req);
    const access = await assertContactVisible(this.prisma, businessId, contactId, actor);
    await this.assertMayDelete(businessId, contactId, actor, access);
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
  async cancelForget(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: Request & { user?: { id?: string; email?: string } },
  ) {
    await assertContactVisible(this.prisma, businessId, contactId, actorUserId(req), { includeDeleted: true });
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

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'admin')
  @Get('businesses/:businessId/privacy-settings')
  getSettings(@Param('businessId') businessId: string) {
    return this.privacy.getSettings(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'admin')
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

  /**
   * The delete-scope rule of DELETE contacts/:contactId
   * (CrmService.softDeleteContact), for a contact assertContactVisible has
   * already let the caller open: crm_delete 'none' is refused, 'owned' only
   * for a contact the caller owns, and a 'my book' member only for one they
   * own (404, as DELETE answers). No restriction for OWNER or SUPER_ADMIN.
   */
  private async assertMayDelete(businessId: string, contactId: string, actor: string, access: CrmAccess) {
    if (access.isOwner || access.isSuperAdmin) return;
    if (access.deleteScope === 'none') {
      throw new ForbiddenException('You do not have permission to delete contacts');
    }
    const contact = await this.prisma.client.contact.findFirst({
      where: contactWhereWithId(businessId, contactId),
      select: { ownerId: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    if (access.deleteScope === 'owned' && contact.ownerId !== actor) {
      throw new ForbiddenException('You can only delete contacts you own');
    }
    if (!access.viewAll && contact.ownerId !== actor) {
      throw new NotFoundException('Contact not found');
    }
  }
}
