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
   * FOLLOW3-A2-D46-PAYMENTS-OPS (D-46): a platform SUPER_ADMIN who is not a
   * member of the business stays out of its writes. BusinessGuard and
   * ModuleScopeGuard both admit SUPER_ADMIN to every tenant, so the gateway
   * writes below (refund, payment-link create and revoke) require a Membership
   * in :businessId for that role, checked before any gateway call: a refused
   * request costs no provider traffic and moves no money. Every other caller
   * is unchanged (the guards already require a member holding revenue:write);
   * a SUPER_ADMIN who is a member keeps the platform bypass of the module
   * scope. The reads are not affected.
   */
  private async assertSuperAdminIsMember(req: ActorRequest, businessId: string): Promise<void> {
    const user = req.user;
    if (user?.role !== 'SUPER_ADMIN') return;
    const membership = user.id
      ? await this.prisma.client.membership.findUnique({
          where: { userId_businessId: { userId: user.id, businessId } },
          select: { id: true },
        })
      : null;
    if (!membership) throw new ForbiddenException('Not a member of this business');
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
    await this.assertSuperAdminIsMember(req, businessId);
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
    await this.assertSuperAdminIsMember(req, businessId);
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
    await this.assertSuperAdminIsMember(req, businessId);
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
    await this.assertSuperAdminIsMember(req, businessId);
    const gw = assertGateway(body.gateway);
    return this.ops.refundCharge(businessId, gw, {
      chargeId: body.chargeId,
      amount: body.amount !== undefined ? Number(body.amount) : undefined,
      reason: body.reason,
    });
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
