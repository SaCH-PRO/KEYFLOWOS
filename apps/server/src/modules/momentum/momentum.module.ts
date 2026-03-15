import { Module } from '@nestjs/common';
import { MomentumController } from './momentum.controller';
import { ClientMomentumService } from './client-momentum.service';
import { MomentumAiService } from './momentum-ai.service';
import { MomentumSchedulerService } from './momentum-scheduler.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { AutopilotModule } from '../autopilot/autopilot.module';

@Module({
  imports: [PrismaModule, AiModule, AutopilotModule],
  controllers: [MomentumController],
  providers: [ClientMomentumService, MomentumAiService, MomentumSchedulerService],
  exports: [ClientMomentumService, MomentumAiService],
})
export class MomentumModule {}
