import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import { ConnectorIntelligenceService } from '../ai/connector-intelligence.service';
import { DriveIntakeOrchestrator } from './drive-intake-orchestrator.service';
import { PrismaService } from '../../core/prisma/prisma.service';

interface AuthenticatedRequest {
  user?: { id: string; role?: string };
}

@Controller('drive/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class DriveIntakeController {
  constructor(
    private readonly connectorIntelligence: ConnectorIntelligenceService,
    private readonly orchestrator: DriveIntakeOrchestrator,
    private readonly prisma: PrismaService,
  ) {}

  @Post('sync')
  async sync(@Param('businessId') businessId: string) {
    const result = await this.connectorIntelligence.syncGoogleDrive(businessId);
    return { success: true, ...result };
  }

  /**
   * W7-DRIVE-INTAKE-SCOPE review repair SEC-W7DI-3: the list carries every
   * intake's extractedData and proposedActions (payment amounts, invoice ids,
   * contact details), so it needs revenue:read, as GET .../invoices does; a
   * member with no revenue access is refused 403 there and here. `limit` is
   * clamped to 1..100 (default 50, as the web asks) instead of handing Prisma
   * any number, or NaN, as `take`.
   */
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  @Get('intake')
  async listIntake(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const where: Record<string, unknown> = { businessId };
    if (status) where.status = status;
    const asked = limit ? parseInt(limit, 10) : NaN;
    const take = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), 100) : 50;
    const items = await this.prisma.client.driveIntakeFile.findMany({
      where,
      orderBy: { modifiedTime: 'desc' },
      take,
    });
    return { items };
  }

  /**
   * W7-DRIVE-INTAKE-SCOPE (R0-CMF2 review SEC-CMF2-3): approving a plan runs
   * its steps (create_invoice, record_payment, apply_credit_note), so it needs
   * revenue:write, the scope every payment-writing route has required since
   * R0-02. Behind AuthGuard and BusinessGuard alone, a member with revenue:read,
   * or with only crm:read, approved a plan that recorded a payment the manual
   * payment route refuses them. A refused approval is answered before the
   * orchestrator claims the intake, so nothing is written and the plan stays
   * approvable by a member who may. The approver is still the recorder
   * (R0-CMF2, PA-18a): the orchestrator is handed req.user, never the plan.
   * Review repair SEC-W7DI-1: DriveIntakeOrchestrator.executePlan applies the
   * same rule itself (assertApproverMayRunPlan), so the data-inbox approve
   * route, which runs the same plan, is held to it too.
   */
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('intake/:intakeFileId/approve')
  async approve(
    @Param('businessId') businessId: string,
    @Param('intakeFileId') intakeFileId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId);
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authenticated user required');
    return this.orchestrator.executePlan(businessId, intakeFileId, userId);
  }

  /**
   * W7-DRIVE-INTAKE-SCOPE review repair SEC-W7DI-2 (D-46): rejecting a plan
   * decides its money as approving it does (a rejected plan can no longer be
   * approved), so reject needs what approve needs: revenue:write, and, as a
   * revenue:write handler of the commerce module, a SUPER_ADMIN's Membership
   * holding it (d46-write-routes.spec.ts lists reject GUARDED). Behind
   * AuthGuard and BusinessGuard alone, a member refused approve (crm:read only)
   * rejected a pending plan, and the member who may then got 400. The
   * orchestrator refuses an already approved intake (rejectIntakeFile).
   */
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'write')
  @Post('intake/:intakeFileId/reject')
  async reject(
    @Param('businessId') businessId: string,
    @Param('intakeFileId') intakeFileId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId);
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authenticated user required');
    await this.orchestrator.rejectIntakeFile(businessId, intakeFileId, userId);
    return { success: true };
  }

  /**
   * W7-DRIVE-INTAKE-SCOPE, owner ruling D-46 (a platform SUPER_ADMIN who is not
   * a member stays refused on tenant invoice writes): BusinessGuard and
   * ModuleScopeGuard admit SUPER_ADMIN to every tenant and skip the module
   * scope, so approve, now a revenue:write handler of the commerce module,
   * applies FOLLOW3-A2's rule as CommerceController.assertSuperAdminMayWriteRevenue
   * does (private there; restated here as RecurringInvoiceController and
   * PaymentsOpsController restate it). That role needs a Membership in
   * :businessId whose scope map (or, without one, the role defaults) holds
   * revenue:write. No membership answers 403 'Not authorized to update this
   * invoice'; a membership below revenue:write answers the guard's message.
   * Refused before any read or write. Every other caller is unchanged and costs
   * no query (the guards already applied this rule to it). d46-write-routes.spec.ts
   * lists approve as GUARDED, and (review repair SEC-W7DI-2) reject.
   */
  private async assertSuperAdminMayWriteRevenue(req: AuthenticatedRequest | undefined, businessId: string): Promise<void> {
    const user = req?.user;
    if (user?.role !== 'SUPER_ADMIN') return;
    const membership = user.id
      ? await this.prisma.client.membership.findUnique({
          where: { userId_businessId: { userId: user.id, businessId } },
          select: { role: true, permissionScopes: true },
        })
      : null;
    if (!membership) throw new ForbiddenException('Not authorized to update this invoice');
    const scopes: Record<string, string> =
      membership.permissionScopes && typeof membership.permissionScopes === 'object'
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);
    const level = scopes.revenue || 'none';
    if (rankOf(level) < LEVEL_RANK.write) {
      throw new ForbiddenException(`Insufficient permissions: revenue requires write access (you have ${level})`);
    }
  }
}
