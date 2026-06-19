import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import { BusinessCommandCenterService } from './business-command-center.service';

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
