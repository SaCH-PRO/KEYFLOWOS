import {
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

  @Post('runs/:runId/mark-paid')
  @RequireModuleScope('operations', 'write')
  markRunPaid(@Param('businessId') businessId: string, @Param('runId') runId: string) {
    return this.payroll.markRunPaid(businessId, runId);
  }
}
