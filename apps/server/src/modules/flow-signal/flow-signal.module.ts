import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { FlowSignalService } from './flow-signal.service';
import { FlowRouterService } from './flow-router.service';
import { RoleFlowService } from './role-flow.service';
import { FlowSignalController } from './flow-signal.controller';
import { FlowSignalRoleController, FlowSignalBusinessRoleController } from './flow-signal-role.controller';

@Module({
  imports: [PrismaModule],
  providers: [FlowSignalService, FlowRouterService, RoleFlowService],
  controllers: [FlowSignalController, FlowSignalRoleController, FlowSignalBusinessRoleController],
  exports: [FlowSignalService, FlowRouterService, RoleFlowService],
})
export class FlowSignalModule {}
