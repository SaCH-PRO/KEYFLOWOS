import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import { TodayService } from './today.service';

/**
 * P79 — V1-65 (TODAY-AGGREGATE, P0, D-96, D-57): one per-member-scoped read
 * for the Today screen (`GET /business-command-center/businesses/:businessId/today`).
 *
 * Lives on its own controller (rather than `BusinessCommandCenterController`)
 * so R0 `test/ops-scope-command-procurement.integration.test.ts` (`[OPS-C02]` /
 * `[OPS-C03]`, which pins `BusinessCommandCenterController` to `snapshot` alone)
 * stays intact. Every block in the response is filtered by the caller's own
 * module scopes, and Pulse is gated strictly on `revenue:read` (D-57).
 */
@Controller('business-command-center/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class TodayController {
  constructor(
    @Inject(TodayService)
    private readonly todayService: TodayService,
  ) {}

  @Get('today')
  getToday(
    @Param('businessId') businessId: string,
    @Req() req?: { user?: { id?: string; role?: string } },
  ) {
    return this.todayService.getToday(
      businessId,
      req?.user?.id ? { id: req.user.id, role: req.user.role } : null,
    );
  }
}
