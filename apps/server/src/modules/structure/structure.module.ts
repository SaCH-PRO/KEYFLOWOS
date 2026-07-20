import { Module } from '@nestjs/common';
import { StructureService } from './structure.service';
import { StructureController } from './structure.controller';
import { StaffChatBridgeService } from './staff-chat-bridge.service';

@Module({
  controllers: [StructureController],
  providers: [StructureService, StaffChatBridgeService],
  exports: [StructureService, StaffChatBridgeService],
})
export class StructureModule {}
