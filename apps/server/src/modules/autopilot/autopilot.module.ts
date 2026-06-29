import { Module, forwardRef } from '@nestjs/common';
import { AutopilotController } from './autopilot.controller';
import { AutopilotService } from './autopilot.service';
import { AutopilotAiService } from './autopilot-ai.service';
import { DelegationLoopService } from './delegation-loop.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MomentumModule } from '../momentum/momentum.module';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [PrismaModule, forwardRef(() => AiModule), NotificationsModule, forwardRef(() => MomentumModule), forwardRef(() => CrmModule)],
  controllers: [AutopilotController],
  providers: [AutopilotService, AutopilotAiService, DelegationLoopService],
  exports: [AutopilotService, AutopilotAiService, DelegationLoopService],
})
export class AutopilotModule {}
