import { Controller, Get, Param, Post, Body, Query, UseGuards, ParseEnumPipe, Inject } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { FlowSignalService } from './flow-signal.service';
import { RoleFlowService } from './role-flow.service';
import { FlowSignalQuery } from './flow-signal.types';
import { FlowType } from '@prisma/client';

@Controller('flow-signals/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class FlowSignalController {
  constructor(
    @Inject(FlowSignalService) private readonly flowSignalService: FlowSignalService,
    @Inject(RoleFlowService) private readonly roleFlowService: RoleFlowService,
  ) {}

  @Get()
  async list(
    @Param('businessId') businessId: string,
    @Query('flow') flow?: FlowType,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('ownerRoleHint') ownerRoleHint?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const query: FlowSignalQuery = {
      ...(flow && { flows: flow }),
      ...(type && { type }),
      ...(status && { status: status.split(',') as any }),
      ...(ownerRoleHint && { ownerRoleHint }),
      ...(limit && { limit: Number(limit) }),
      ...(offset && { offset: Number(offset) }),
    };
    return this.flowSignalService.list(businessId, query);
  }

  @Get('role/:roleKey')
  async getRoleQueue(
    @Param('businessId') businessId: string,
    @Param('roleKey') roleKey: string,
  ) {
    return this.roleFlowService.getRoleQueue(businessId, roleKey);
  }

  @Post(':id/resolve')
  async resolve(
    @Param('businessId') businessId: string,
    @Param('id') signalId: string,
  ) {
    return this.flowSignalService.markResolved(businessId, signalId);
  }

  @Post(':id/action-required')
  async actionRequired(
    @Param('businessId') businessId: string,
    @Param('id') signalId: string,
  ) {
    return this.flowSignalService.markActionRequired(businessId, signalId);
  }

  @Post(':id/snooze')
  async snooze(
    @Param('businessId') businessId: string,
    @Param('id') signalId: string,
    @Body('until') until: string,
  ) {
    return this.flowSignalService.snooze(businessId, signalId, new Date(until));
  }
}
