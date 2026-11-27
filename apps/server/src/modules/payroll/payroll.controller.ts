import {
  Body,
  Controller,
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
import { PayrollService } from './payroll.service';

@Controller('payroll/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class PayrollController {
  constructor(@Inject(PayrollService) private readonly payroll: PayrollService) {}

  @Get('rates')
  @RequireModuleScope('operations', 'read')
  async listRates(
    @Param('businessId') businessId: string,
    @Req() req?: { user?: { id?: string } },
  ) {
    const includeMoney = await this.payroll.canReadPayrollMoney(businessId, req?.user?.id ?? null);
    return this.payroll.listRates(businessId, { includeMoney });
  }

  @Get('runs')
  @RequireModuleScope('operations', 'read')
  async listRuns(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Req() req?: { user?: { id?: string } },
  ) {
    const includeMoney = await this.payroll.canReadPayrollMoney(businessId, req?.user?.id ?? null);
    return this.payroll.listRuns(businessId, {
      status,
      limit: limit ? Number(limit) : undefined,
      includeMoney,
    });
  }

  @Get('runs/:runId')
  @RequireModuleScope('operations', 'read')
  async getRun(
    @Param('businessId') businessId: string,
    @Param('runId') runId: string,
    @Req() req?: { user?: { id?: string } },
  ) {
    const includeMoney = await this.payroll.canReadPayrollMoney(businessId, req?.user?.id ?? null);
    return this.payroll.getRun(businessId, runId, { includeMoney });
  }

  @Post('runs/:runId/approve')
  @RequireModuleScope('operations', 'write')
  async approveRun(
    @Param('businessId') businessId: string,
    @Param('runId') runId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    const includeMoney = await this.payroll.canReadPayrollMoney(businessId, req?.user?.id ?? null);
    return this.payroll.approveRun(businessId, runId, req?.user?.id, { includeMoney });
  }

  /**
   * PR195-PORT (owner PR #195 part 2): marking a run paid posts it to the ledger
   * (PayrollService.markRunPaid). The body names the account or method the money
   * left by; the posting's actor is the signed-in member, never a body field.
   * The guard is unchanged (operations write): the port widens no authority.
   * Review repair: the service also refuses 403 a caller with no Membership of
   * the business (a platform SUPER_ADMIN who is not a member included;
   * SEC-P195-1, D-46) or without expenses write (SEC-P195-3, the restrictive
   * pick pending an owner ruling), before anything is read or written.
   */
  @Post('runs/:runId/mark-paid')
  @RequireModuleScope('operations', 'write')
  async markRunPaid(
    @Param('businessId') businessId: string,
    @Param('runId') runId: string,
    @Body() body: { paymentAccountId?: string; paymentMethod?: string } | undefined,
    @Req() req: { user?: { id?: string } },
  ) {
    const includeMoney = await this.payroll.canReadPayrollMoney(businessId, req?.user?.id ?? null);
    return this.payroll.markRunPaid(businessId, runId, {
      paymentAccountId: typeof body?.paymentAccountId === 'string' ? body.paymentAccountId : undefined,
      paymentMethod: typeof body?.paymentMethod === 'string' ? body.paymentMethod : undefined,
      actorId: req?.user?.id ?? null,
      includeMoney,
    });
  }

  /**
   * V1-65 (TOF-PAYROLL-DISCARD, D-144): discard an unposted DRAFT run, or an
   * unposted legacy DRAFT/APPROVED run in a non-business currency, to VOID
   * with the server-verified member as actor (never read from body) and an
   * optional reason. Releases the safe-to-spend payroll reserve now that the
   * Payroll page is hidden in v1.
   */
  @Post('runs/:runId/discard')
  @RequireModuleScope('operations', 'write')
  async discardRun(
    @Param('businessId') businessId: string,
    @Param('runId') runId: string,
    @Body() body: { reason?: unknown } | undefined,
    @Req() req: { user?: { id?: string } },
  ) {
    const includeMoney = await this.payroll.canReadPayrollMoney(businessId, req?.user?.id ?? null);
    return this.payroll.discardRun(businessId, runId, {
      reason: body?.reason,
      actorId: req?.user?.id ?? null,
      includeMoney,
    });
  }
}
