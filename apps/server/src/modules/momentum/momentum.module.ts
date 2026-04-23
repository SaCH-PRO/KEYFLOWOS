import { Module, forwardRef } from '@nestjs/common';
import { MomentumController } from './momentum.controller';
import { ClientMomentumService } from './client-momentum.service';
import { MomentumAiService } from './momentum-ai.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { AutopilotModule } from '../autopilot/autopilot.module';

@Module({
  imports: [PrismaModule, AiModule, forwardRef(() => AutopilotModule)],
  controllers: [MomentumController],
  providers: [ClientMomentumService, MomentumAiService],
  exports: [ClientMomentumService, MomentumAiService],
})
export class MomentumModule {}
