import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { StructureService } from './structure.service';
import { CreateOrgUnitDto } from './dto/create-org-unit.dto';
import { UpdateOrgUnitDto } from './dto/update-org-unit.dto';
import { CreateJobRoleDto } from './dto/create-job-role.dto';
import { UpdateJobRoleDto } from './dto/update-job-role.dto';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { CreateDelegationRuleDto } from './dto/create-delegation-rule.dto';
import { UpdateDelegationRuleDto } from './dto/update-delegation-rule.dto';

@Controller('structure')
@UseGuards(AuthGuard)
export class StructureController {
  constructor(
    @Inject(StructureService) private readonly service: StructureService,
  ) {
    if (!this.service) {
      throw new Error("StructureService was not injected into StructureController");
    }
  }

  // ─── Org Units ───
  @Get('businesses/:businessId/org-units')
  @UseGuards(BusinessGuard)
  async listOrgUnits(@Param('businessId') businessId: string) {
    return this.service.listOrgUnits(businessId);
  }

  @Post('businesses/:businessId/org-units')
  @UseGuards(BusinessGuard)
  async createOrgUnit(@Param('businessId') businessId: string, @Body() dto: CreateOrgUnitDto) {
    return this.service.createOrgUnit(businessId, dto);
  }

  @Get('businesses/:businessId/org-units/:id')
  @UseGuards(BusinessGuard)
  async getOrgUnit(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.getOrgUnit(businessId, id);
  }

  @Patch('businesses/:businessId/org-units/:id')
  @UseGuards(BusinessGuard)
  async updateOrgUnit(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateOrgUnitDto) {
    return this.service.updateOrgUnit(businessId, id, dto);
  }

  @Delete('businesses/:businessId/org-units/:id')
  @UseGuards(BusinessGuard)
  async deleteOrgUnit(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.deleteOrgUnit(businessId, id);
  }

  // ─── Job Roles ───
  @Get('businesses/:businessId/job-roles')
  @UseGuards(BusinessGuard)
  async listJobRoles(@Param('businessId') businessId: string) {
    return this.service.listJobRoles(businessId);
  }

  @Post('businesses/:businessId/job-roles')
  @UseGuards(BusinessGuard)
  async createJobRole(@Param('businessId') businessId: string, @Body() dto: CreateJobRoleDto) {
    return this.service.createJobRole(businessId, dto);
  }

  @Get('businesses/:businessId/job-roles/:id')
  @UseGuards(BusinessGuard)
  async getJobRole(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.getJobRole(businessId, id);
  }

  @Patch('businesses/:businessId/job-roles/:id')
  @UseGuards(BusinessGuard)
  async updateJobRole(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateJobRoleDto) {
    return this.service.updateJobRole(businessId, id, dto);
  }

  @Delete('businesses/:businessId/job-roles/:id')
  @UseGuards(BusinessGuard)
  async deleteJobRole(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.deleteJobRole(businessId, id);
  }

  // ─── Assignments ───
  @Get('businesses/:businessId/assignments')
  @UseGuards(BusinessGuard)
  async listAssignments(@Param('businessId') businessId: string) {
    return this.service.listAssignments(businessId);
  }

  @Post('businesses/:businessId/assignments')
  @UseGuards(BusinessGuard)
  async createAssignment(@Param('businessId') businessId: string, @Body() dto: CreateAssignmentDto) {
    return this.service.createAssignment(businessId, dto);
  }

  @Get('businesses/:businessId/assignments/:id')
  @UseGuards(BusinessGuard)
  async getAssignment(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.getAssignment(businessId, id);
  }

  @Patch('businesses/:businessId/assignments/:id')
  @UseGuards(BusinessGuard)
  async updateAssignment(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateAssignmentDto) {
    return this.service.updateAssignment(businessId, id, dto);
  }

  @Delete('businesses/:businessId/assignments/:id')
  @UseGuards(BusinessGuard)
  async deleteAssignment(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.deleteAssignment(businessId, id);
  }

  // ─── Delegation Rules ───
  @Get('businesses/:businessId/delegation-rules')
  @UseGuards(BusinessGuard)
  async listDelegationRules(@Param('businessId') businessId: string) {
    return this.service.listDelegationRules(businessId);
  }

  @Post('businesses/:businessId/delegation-rules')
  @UseGuards(BusinessGuard)
  async createDelegationRule(@Param('businessId') businessId: string, @Body() dto: CreateDelegationRuleDto) {
    return this.service.createDelegationRule(businessId, dto);
  }

  @Get('businesses/:businessId/delegation-rules/:id')
  @UseGuards(BusinessGuard)
  async getDelegationRule(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.getDelegationRule(businessId, id);
  }

  @Patch('businesses/:businessId/delegation-rules/:id')
  @UseGuards(BusinessGuard)
  async updateDelegationRule(@Param('businessId') businessId: string, @Param('id') id: string, @Body() dto: UpdateDelegationRuleDto) {
    return this.service.updateDelegationRule(businessId, id, dto);
  }

  @Delete('businesses/:businessId/delegation-rules/:id')
  @UseGuards(BusinessGuard)
  async deleteDelegationRule(@Param('businessId') businessId: string, @Param('id') id: string) {
    return this.service.deleteDelegationRule(businessId, id);
  }

  // ─── Org Tree ───
  @Get('businesses/:businessId/tree')
  @UseGuards(BusinessGuard)
  async getOrgTree(@Param('businessId') businessId: string) {
    return this.service.getOrgTree(businessId);
  }

  // ─── Stats ───
  @Get('businesses/:businessId/stats')
  @UseGuards(BusinessGuard)
  async getStats(@Param('businessId') businessId: string) {
    return this.service.getStats(businessId);
  }
}
