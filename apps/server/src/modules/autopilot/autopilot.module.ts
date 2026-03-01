import { Module } from '@nestjs/common';
import { AutopilotController } from './autopilot.controller';
import { AutopilotService } from './autopilot.service';
import { AutopilotAiService } from './autopilot-ai.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [AutopilotController],
  providers: [AutopilotService, AutopilotAiService],
  exports: [AutopilotService, AutopilotAiService],
})
export class AutopilotModule {}
