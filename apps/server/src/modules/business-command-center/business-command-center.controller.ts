import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import { BusinessCommandCenterService } from './business-command-center.service';

/**
 * The cockpit snapshot. Unlike the command-centre item routes and the
 * procurement routes (operations, owner ruling D-40), it names no module scope:
 * it is open to every member of the business and projects each result tile by
 * the member's own crm and revenue scopes (V1-47). It reads no command item and
 * no procurement row. release0-journey.integration.test.ts (step 5) pins a STAFF
 * member with no operations key reading it, and
 * test/ops-scope-command-procurement.integration.test.ts keeps it the one
 * named exception: any other route added here must require operations.
 */
@Controller('business-command-center/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class BusinessCommandCenterController {
  constructor(
    @Inject(BusinessCommandCenterService)
    private readonly commandCenter: BusinessCommandCenterService,
  ) {}

  @Get('snapshot')
  snapshot(@Param('businessId') businessId: string) {
    return this.commandCenter.snapshot(businessId);
  }
}
