import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GatewayId, PaymentsOpsService } from './payments-ops.service';

const VALID_GATEWAYS: GatewayId[] = ['stripe', 'paypal', 'wipay'];

function assertGateway(id: string): GatewayId {
  if (!VALID_GATEWAYS.includes(id as GatewayId)) {
    throw new BadRequestException(`Invalid gateway: ${id}`);
  }
  return id as GatewayId;
}

/** The caller as AuthGuard attaches it. */
type ActorRequest = { user?: { id?: string; role?: string } };

@Controller('payments/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class PaymentsOpsController {
  constructor(
    @Inject(PaymentsOpsService) private readonly ops: PaymentsOpsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * FOLLOW3-A2-D46-PAYMENTS-OPS (D-46): a platform SUPER_ADMIN acts on a
   * business's money only with the authority that business gave it.
   * BusinessGuard and ModuleScopeGuard both admit SUPER_ADMIN to every tenant
   * and skip the module scope, so the gateway writes below (refund,
   * payment-link create and revoke) apply ModuleScopeGuard's legacy rule to
   * that role here: a Membership in :businessId whose scope map (or, without
   * one, the role defaults) holds revenue:write. Checked before any gateway
   * call: a refused request costs no provider traffic and moves no money.
   * Review SEC-A2-1: a membership alone is not enough (a STAFF default of
   * revenue:read, or an explicit revenue:'none' set by the business, is 403),
   * as in payment-evidence.service.ts and undo.service.ts. Every other caller
   * is unchanged (the guards already apply this rule to it). The reads are
   * not affected.
   */
  private async assertSuperAdminMayWriteRevenue(req: ActorRequest, businessId: string): Promise<void> {
    const user = req.user;
    if (user?.role !== 'SUPER_ADMIN') return;
    const membership = user.id
      ? await this.prisma.client.membership.findUnique({
          where: { userId_businessId: { userId: user.id, businessId } },
          select: { role: true, permissionScopes: true },
        })
      : null;
    if (!membership) throw new ForbiddenException('Not a member of this business');
    const scopes: Record<string, string> =
      membership.permissionScopes && typeof membership.permissionScopes === 'object'
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);
    const level = scopes.revenue || 'none';
    if (rankOf(level) < LEVEL_RANK.write) {
      throw new ForbiddenException(`Insufficient permissions: revenue requires write access (you have ${level})`);
    }
  }

  @RequireModuleScope('revenue', 'read')
  @Get('gateways')
  getGateways(@Param('businessId') businessId: string) {
    return this.ops.getGatewayStatuses(businessId);
  }

  @RequireModuleScope('revenue', 'read')
  @Get('gateways/payables')
  listOpenPayables(@Param('businessId') businessId: string) {
    return this.ops.listOpenPayables(businessId);
  }

  @RequireModuleScope('revenue', 'read')
  @Get('transactions')
  listTransactions(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
  ) {
    const lim = limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50;
    if (q) return this.ops.searchCharges(businessId, { query: q, limit: lim });
    return this.ops.listAllTransactions(businessId, lim);
  }

  @RequireModuleScope('revenue', 'read')
  @Get('links')
  listLinks(@Param('businessId') businessId: string) {
    return this.ops.listAllPaymentLinks(businessId);
  }

  @RequireModuleScope('revenue', 'write')
  @Post('links')
  async createLink(
    @Req() req: ActorRequest,
    @Param('businessId') businessId: string,
    @Body() body: { gateway: string; amount: number; currency: string; description: string; customerEmail?: string },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId);
    const gw = assertGateway(body.gateway);
    return this.ops.createPaymentLink(businessId, gw, {
      amount: Number(body.amount),
      currency: body.currency || 'USD',
      description: body.description,
      customerEmail: body.customerEmail,
    });
  }

  @RequireModuleScope('revenue', 'write')
  @Delete('links/:gateway/:linkId')
  async revokeLink(
    @Req() req: ActorRequest,
    @Param('businessId') businessId: string,
    @Param('gateway') gateway: string,
    @Param('linkId') linkId: string,
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId);
    const gw = assertGateway(gateway);
    return this.ops.revokePaymentLink(businessId, gw, linkId).then(() => ({ ok: true }));
  }

  // Spec-aligned: DELETE /payments/businesses/:businessId/links/:linkId?gateway=stripe
  @RequireModuleScope('revenue', 'write')
  @Delete('links/:linkId')
  async revokeLinkByIdOnly(
    @Req() req: ActorRequest,
    @Param('businessId') businessId: string,
    @Param('linkId') linkId: string,
    @Query('gateway') gateway?: string,
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId);
    if (!gateway) {
      throw new BadRequestException('Missing required query param: gateway');
    }
    const gw = assertGateway(gateway);
    return this.ops.revokePaymentLink(businessId, gw, linkId).then(() => ({ ok: true }));
  }

  @RequireModuleScope('revenue', 'write')
  @Post('refunds')
  async refund(
    @Req() req: ActorRequest,
    @Param('businessId') businessId: string,
    @Body() body: { gateway: string; chargeId: string; amount?: number; reason?: string },
  ) {
    await this.assertSuperAdminMayWriteRevenue(req, businessId);
    const gw = assertGateway(body.gateway);
    // W10-REFUND-CHARGE-DOOR review SEC-RCD-1 (R0-PL-07): the refunder is the
    // authenticated user, never a body field.
    return this.ops.refundCharge(
      businessId,
      gw,
      {
        chargeId: body.chargeId,
        amount: body.amount !== undefined ? Number(body.amount) : undefined,
        reason: body.reason,
      },
      req.user?.id ?? null,
    );
  }

  @RequireModuleScope('revenue', 'read')
  @Get('transactions/:transactionId/link')
  resolveTransactionLink(
    @Param('businessId') businessId: string,
    @Param('transactionId') transactionId: string,
  ) {
    return this.ops.findTransactionLink(businessId, transactionId);
  }
}
