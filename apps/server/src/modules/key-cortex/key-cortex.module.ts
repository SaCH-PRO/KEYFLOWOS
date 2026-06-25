/**
 * KEY Cortex Module
 *
 * The JARVIS Business Brain. This module depends on:
 * - AI Module (ModelGateway, FlowOrchestrator, ExecutionLog)
 * - Business Genome Module (all genome services)
 *
 * Provides: Conversational business intelligence with evidence-backed reasoning.
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { KeyCortexController } from './key-cortex.controller';
import { KeyCortexConversationService } from './key-cortex-conversation.service';
import { KeyCortexReasoningService } from './key-cortex-reasoning.service';
import { KeyCortexActionService } from './key-cortex-action.service';
import { GenomeContextAssembler } from './genome-context-assembler.service';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [KeyCortexController],
  providers: [
    KeyCortexConversationService,
    KeyCortexReasoningService,
    KeyCortexActionService,
    GenomeContextAssembler,
  ],
  exports: [
    KeyCortexConversationService,
    KeyCortexReasoningService,
    KeyCortexActionService,
    GenomeContextAssembler,
  ],
})
export class KeyCortexModule {}
