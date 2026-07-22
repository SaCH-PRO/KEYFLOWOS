import { Module } from '@nestjs/common';
import { StructureService } from './structure.service';
import { StructureController } from './structure.controller';
import { StaffChatBridgeService } from './staff-chat-bridge.service';
import { JobRolePolicyService } from './job-role-policy.service';

@Module({
  controllers: [StructureController],
  providers: [StructureService, StaffChatBridgeService, JobRolePolicyService],
  exports: [StructureService, StaffChatBridgeService, JobRolePolicyService],
})
export class StructureModule {}
