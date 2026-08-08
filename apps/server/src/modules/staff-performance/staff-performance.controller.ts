import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { StaffPerformanceService } from './staff-performance.service';

function defaultPeriod(periodStart?: string, periodEnd?: string): { start: Date; end: Date } {
  const now = new Date();
  return {
    start: periodStart ? new Date(periodStart) : new Date(now.getFullYear(), now.getMonth(), 1),
    end: periodEnd ? new Date(periodEnd) : now,
  };
}

@Controller('staff-performance/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class StaffPerformanceController {
  constructor(@Inject(StaffPerformanceService) private readonly performance: StaffPerformanceService) {}

  @Get('team-summary')
  @RequireModuleScope('operations', 'read')
  teamSummary(
    @Param('businessId') businessId: string,
    @Query('periodStart') periodStart?: string,
    @Query('periodEnd') periodEnd?: string,
  ) {
    const { start, end } = defaultPeriod(periodStart, periodEnd);
    return this.performance.teamSummary(businessId, start, end);
  }

  @Get('scorecard')
  @RequireModuleScope('operations', 'read')
  scorecard(
    @Param('businessId') businessId: string,
    @Query('assignmentId') assignmentId?: string,
    @Query('periodStart') periodStart?: string,
    @Query('periodEnd') periodEnd?: string,
  ) {
    if (!assignmentId) throw new BadRequestException('assignmentId is required');
    const { start, end } = defaultPeriod(periodStart, periodEnd);
    return this.performance.computeScorecard(businessId, assignmentId, start, end);
  }

  @Get('trend')
  @RequireModuleScope('operations', 'read')
  trend(
    @Param('businessId') businessId: string,
    @Query('assignmentId') assignmentId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!assignmentId) throw new BadRequestException('assignmentId is required');
    return this.performance.trend(businessId, assignmentId, limit ? Number(limit) : undefined);
  }

  @Post('snapshot')
  @RequireModuleScope('operations', 'write')
  takeSnapshot(
    @Param('businessId') businessId: string,
    @Body() body: { assignmentId?: string; periodStart?: string; periodEnd?: string },
  ) {
    if (!body?.assignmentId) throw new BadRequestException('assignmentId is required');
    const { start, end } = defaultPeriod(body.periodStart, body.periodEnd);
    return this.performance.takeSnapshot(businessId, body.assignmentId, start, end);
  }
}
