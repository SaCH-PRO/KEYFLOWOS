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
  listRates(@Param('businessId') businessId: string) {
    return this.payroll.listRates(businessId);
  }

  @Get('runs')
  @RequireModuleScope('operations', 'read')
  listRuns(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.payroll.listRuns(businessId, {
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('runs/:runId')
  @RequireModuleScope('operations', 'read')
  getRun(@Param('businessId') businessId: string, @Param('runId') runId: string) {
    return this.payroll.getRun(businessId, runId);
  }

  @Post('runs/:runId/approve')
  @RequireModuleScope('operations', 'write')
  approveRun(
    @Param('businessId') businessId: string,
    @Param('runId') runId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.payroll.approveRun(businessId, runId, req.user?.id);
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
  markRunPaid(
    @Param('businessId') businessId: string,
    @Param('runId') runId: string,
    @Body() body: { paymentAccountId?: string; paymentMethod?: string } | undefined,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.payroll.markRunPaid(businessId, runId, {
      paymentAccountId: typeof body?.paymentAccountId === 'string' ? body.paymentAccountId : undefined,
      paymentMethod: typeof body?.paymentMethod === 'string' ? body.paymentMethod : undefined,
      actorId: req?.user?.id ?? null,
    });
  }
}
