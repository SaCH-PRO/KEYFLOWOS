import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { OsService } from './os.service';

@Controller('os/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class OsController {
  constructor(
    @Inject(OsService) private readonly osService: OsService,
  ) {}

  @Get('command-center')
  async commandCenter(@Param('businessId') businessId: string) {
    return this.osService.getCommandCenter(businessId);
  }
}
