import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { BusinessEventModule } from '../business-events/business-event.module';
import { KeyInboxActionService } from './key-inbox-action.service';
import { KeyInboxAnalysisService } from './key-inbox-analysis.service';
import { KeyInboxController } from './key-inbox.controller';
import { KeyInboxService } from './key-inbox.service';
import { KeyInboxTemporalEmitterService } from './key-inbox-temporal-emitter.service';
import { KeyInboxActionExecutorService } from './key-inbox-action-executor.service';

@Module({
  imports: [PrismaModule, AiModule, BusinessEventModule],
  controllers: [KeyInboxController],
  providers: [
    KeyInboxService,
    KeyInboxAnalysisService,
    KeyInboxActionService,
    KeyInboxTemporalEmitterService,
    KeyInboxActionExecutorService,
  ],
  exports: [
    KeyInboxService,
    KeyInboxAnalysisService,
    KeyInboxActionService,
    KeyInboxTemporalEmitterService,
    KeyInboxActionExecutorService,
  ],
})
export class KeyInboxModule {}
