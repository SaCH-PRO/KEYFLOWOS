import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { GatewayId, PaymentsOpsService } from './payments-ops.service';

const VALID_GATEWAYS: GatewayId[] = ['stripe', 'paypal', 'wipay'];

function assertGateway(id: string): GatewayId {
  if (!VALID_GATEWAYS.includes(id as GatewayId)) {
    throw new BadRequestException(`Invalid gateway: ${id}`);
  }
  return id as GatewayId;
}

@Controller('payments/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class PaymentsOpsController {
  constructor(@Inject(PaymentsOpsService) private readonly ops: PaymentsOpsService) {}

  @RequireModuleScope('revenue', 'read')
  @Get('gateways')
  getGateways(@Param('businessId') businessId: string) {
    return this.ops.getGatewayStatuses(businessId);
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
  createLink(
    @Param('businessId') businessId: string,
    @Body() body: { gateway: string; amount: number; currency: string; description: string; customerEmail?: string },
  ) {
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
  revokeLink(
    @Param('businessId') businessId: string,
    @Param('gateway') gateway: string,
    @Param('linkId') linkId: string,
  ) {
    const gw = assertGateway(gateway);
    return this.ops.revokePaymentLink(businessId, gw, linkId).then(() => ({ ok: true }));
  }

  // Spec-aligned: DELETE /payments/businesses/:businessId/links/:linkId?gateway=stripe
  @RequireModuleScope('revenue', 'write')
  @Delete('links/:linkId')
  revokeLinkByIdOnly(
    @Param('businessId') businessId: string,
    @Param('linkId') linkId: string,
    @Query('gateway') gateway?: string,
  ) {
    if (!gateway) {
      throw new BadRequestException('Missing required query param: gateway');
    }
    const gw = assertGateway(gateway);
    return this.ops.revokePaymentLink(businessId, gw, linkId).then(() => ({ ok: true }));
  }

  @RequireModuleScope('revenue', 'write')
  @Post('refunds')
  refund(
    @Param('businessId') businessId: string,
    @Body() body: { gateway: string; chargeId: string; amount?: number; reason?: string },
  ) {
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
