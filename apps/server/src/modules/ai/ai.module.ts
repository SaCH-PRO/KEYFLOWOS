import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiListener } from './ai.listener';
import { AiAdvisorService } from './ai-advisor.service';
import { PrismaModule } from '../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AiController],
  providers: [AiListener, AiAdvisorService],
  exports: [AiAdvisorService],
})
export class AiModule {}
