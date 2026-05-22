import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import {
  ModuleScopeGuard,
  RequireModuleScope,
} from '../../core/auth/module-scope.guard';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { AiSettingsService } from './ai-settings.service';
import { CreateSkillDto } from './dto/create-skill.dto';
import { CreateAuthorityGrantDto } from './dto/create-authority-grant.dto';
import { UpdateWorkloadConfigDto, UpdateStaffWorkloadConfigDto } from './dto/update-workload-config.dto';

@Controller('ai')
@UseGuards(AuthGuard, BusinessGuard, RateLimitGuard, ModuleScopeGuard)
export class AiSettingsController {
  constructor(private readonly aiSettings: AiSettingsService) {}

  @Get('businesses/:businessId/ai/settings/workload-config')
  @RateLimit(60, 60_000)
  @RequireModuleScope('operations', 'read')
  async getWorkloadConfig(@Param('businessId') businessId: string) {
    return this.aiSettings.getWorkloadConfig(businessId);
  }

  @Patch('businesses/:businessId/ai/settings/workload-config/:membershipId')
  @RateLimit(20, 60_000)
  @RequireModuleScope('operations', 'write')
  async updateWorkloadConfig(
    @Param('businessId') businessId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: UpdateWorkloadConfigDto,
  ) {
    return this.aiSettings.updateWorkloadConfig(businessId, membershipId, {
      dailyCapacityHours: body.dailyCapacityHours,
      skillIds: body.skillIds,
    });
  }

  @Patch('businesses/:businessId/ai/settings/staff-workload-config/:staffId')
  @RateLimit(20, 60_000)
  @RequireModuleScope('operations', 'write')
  async updateStaffWorkloadConfig(
    @Param('businessId') businessId: string,
    @Param('staffId') staffId: string,
    @Body() body: UpdateStaffWorkloadConfigDto,
  ) {
    return this.aiSettings.updateStaffWorkloadConfig(businessId, staffId, {
      maxHoursPerWeek: body.maxHoursPerWeek,
      hourlyRate: body.hourlyRate,
    });
  }

  @Get('businesses/:businessId/ai/settings/skills')
  @RateLimit(60, 60_000)
  @RequireModuleScope('operations', 'read')
  async listSkills() {
    return this.aiSettings.listSkills();
  }

  @Post('businesses/:businessId/ai/settings/skills')
  @RateLimit(20, 60_000)
  @RequireModuleScope('operations', 'write')
  async createSkill(@Body() body: CreateSkillDto) {
    return this.aiSettings.createSkill(body);
  }

  @Delete('businesses/:businessId/ai/settings/skills/:id')
  @RateLimit(20, 60_000)
  @RequireModuleScope('operations', 'write')
  async deleteSkill(@Param('id') id: string) {
    return this.aiSettings.deleteSkill(id);
  }

  @Post('businesses/:businessId/ai/settings/memberships/:membershipId/skills/:skillId')
  @RateLimit(20, 60_000)
  @RequireModuleScope('operations', 'write')
  async assignSkillToMembership(
    @Param('membershipId') membershipId: string,
    @Param('skillId') skillId: string,
  ) {
    return this.aiSettings.assignSkillToMembership(membershipId, skillId);
  }

  @Delete('businesses/:businessId/ai/settings/memberships/:membershipId/skills/:skillId')
  @RateLimit(20, 60_000)
  @RequireModuleScope('operations', 'write')
  async removeSkillFromMembership(
    @Param('membershipId') membershipId: string,
    @Param('skillId') skillId: string,
  ) {
    return this.aiSettings.removeSkillFromMembership(membershipId, skillId);
  }

  @Post('businesses/:businessId/ai/settings/staff/:staffId/skills/:skillId')
  @RateLimit(20, 60_000)
  @RequireModuleScope('operations', 'write')
  async assignSkillToStaff(
    @Param('staffId') staffId: string,
    @Param('skillId') skillId: string,
  ) {
    return this.aiSettings.assignSkillToStaff(staffId, skillId);
  }

  @Delete('businesses/:businessId/ai/settings/staff/:staffId/skills/:skillId')
  @RateLimit(20, 60_000)
  @RequireModuleScope('operations', 'write')
  async removeSkillFromStaff(
    @Param('staffId') staffId: string,
    @Param('skillId') skillId: string,
  ) {
    return this.aiSettings.removeSkillFromStaff(staffId, skillId);
  }

  @Get('businesses/:businessId/ai/settings/authority-grants')
  @RateLimit(60, 60_000)
  @RequireModuleScope('operations', 'read')
  async listAuthorityGrants(@Param('businessId') businessId: string) {
    return this.aiSettings.listAuthorityGrants(businessId);
  }

  @Post('businesses/:businessId/ai/settings/authority-grants')
  @RateLimit(20, 60_000)
  @RequireModuleScope('operations', 'write')
  async createAuthorityGrant(
    @Param('businessId') businessId: string,
    @Body() body: CreateAuthorityGrantDto,
    @Request() req: ExpressRequest & { user?: { id: string } },
  ) {
    return this.aiSettings.createAuthorityGrant(businessId, {
      grantorId: body.grantorId ?? req.user?.id ?? 'system',
      granteeType: body.granteeType,
      granteeId: body.granteeId,
      scope: body.scope,
      maxAmount: body.maxAmount,
      validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
    });
  }

  @Delete('businesses/:businessId/ai/settings/authority-grants/:id')
  @RateLimit(20, 60_000)
  @RequireModuleScope('operations', 'write')
  async revokeAuthorityGrant(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.aiSettings.revokeAuthorityGrant(businessId, id);
  }

  @Get('businesses/:businessId/ai/settings/team-capacity')
  @RateLimit(60, 60_000)
  @RequireModuleScope('operations', 'read')
  async getTeamCapacity(@Param('businessId') businessId: string) {
    return this.aiSettings.getTeamCapacity(businessId);
  }
}
