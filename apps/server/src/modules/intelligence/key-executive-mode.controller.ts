import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import { KeyExecutiveModeService } from './key-executive-mode.service';

@Controller('intelligence/businesses/:businessId/key-modes')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class KeyExecutiveModeController {
  constructor(
    @Inject(KeyExecutiveModeService) private readonly modes: KeyExecutiveModeService,
  ) {}

  @Get()
  listModes() {
    return this.modes.listModes();
  }

  @Get(':mode')
  modeBrief(
    @Param('businessId') businessId: string,
    @Param('mode') mode: string,
  ) {
    return this.modes.generateModeBrief(businessId, mode);
  }
}
