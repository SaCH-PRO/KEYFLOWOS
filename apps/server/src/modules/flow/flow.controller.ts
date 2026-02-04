import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { FlowService } from './flow.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('flow')
export class FlowController {
  constructor(@Inject(FlowService) private readonly flowService: FlowService) {}

  @Get('health')
  health() {
    return { status: 'ok', module: 'flow' };
  }

  @Get('businesses/:businessId/cockpit')
  @UseGuards(AuthGuard, BusinessGuard)
  async getCockpitSummary(@Param('businessId') businessId: string) {
    return this.flowService.getCockpitSummary(businessId);
  }
}
