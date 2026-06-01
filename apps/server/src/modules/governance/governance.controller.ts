import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { GovernanceService } from './governance.service';
import { CreateRiskDto } from './dto/create-risk.dto';

@Controller('governance/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class GovernanceController {
  constructor(
    @Inject(GovernanceService) private readonly governance: GovernanceService,
  ) {}

  @Post('risks')
  async createRisk(@Param('businessId') businessId: string, @Body() dto: CreateRiskDto) {
    return this.governance.createRisk(businessId, dto);
  }

  @Get('risks')
  async listRisks(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
  ) {
    return this.governance.findRisks(businessId, { status, category });
  }

  @Get('risks/:id')
  async getRisk(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.governance.findOneRisk(businessId, id);
  }

  @Patch('risks/:id')
  async updateRisk(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: Partial<CreateRiskDto>) {
    return this.governance.updateRisk(businessId, id, dto);
  }

  @Delete('risks/:id')
  async deleteRisk(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.governance.deleteRisk(businessId, id);
  }

  @Get('summary')
  async summary(@Param('businessId') businessId: string) {
    return this.governance.summary(businessId);
  }
}
