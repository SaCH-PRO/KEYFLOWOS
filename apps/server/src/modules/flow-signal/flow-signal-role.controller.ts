import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { getAllRoleDefinitions } from './flow-role-subscriptions.config';
import { RoleFlowService } from './role-flow.service';

@Controller('flow-signals')
export class FlowSignalRoleController {
  constructor(private readonly roleFlowService: RoleFlowService) {}

  /**
   * Static directory of all KEY FLOWS roles and their subscriptions.
   */
  @Get('roles')
  getRoles() {
    return getAllRoleDefinitions().map((role) => ({
      key: role.key,
      label: role.label,
      flowTypes: Array.from(new Set(role.subscriptions.map((s) => s.flowType))),
      subscriptions: role.subscriptions.length,
    }));
  }
}

@Controller('flow-signals/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class FlowSignalBusinessRoleController {
  constructor(private readonly roleFlowService: RoleFlowService) {}

  /**
   * Per-business summary of every KEY FLOWS role queue.
   */
  @Get('roles')
  async getBusinessRoles(@Param('businessId') businessId: string) {
    return this.roleFlowService.getAllRoleQueues(businessId);
  }
}
