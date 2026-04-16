import { Module } from '@nestjs/common';
import { AutopilotController } from './autopilot.controller';
import { AutopilotService } from './autopilot.service';
import { AutopilotAiService } from './autopilot-ai.service';
import { DelegationLoopService } from './delegation-loop.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, AiModule, NotificationsModule],
  controllers: [AutopilotController],
  providers: [AutopilotService, AutopilotAiService, DelegationLoopService],
  exports: [AutopilotService, AutopilotAiService, DelegationLoopService],
})
export class AutopilotModule {}
