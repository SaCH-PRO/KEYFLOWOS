import { Module } from '@nestjs/common';
import { ConsciousnessModule } from './consciousness/consciousness.module';
import { GenomeContextAssembler } from './services/genome-context-assembler.service';
import { KeyCortexReasoning } from './services/key-cortex-reasoning.service';
import { KeyCortexConversation } from './services/key-cortex-conversation.service';
import { KeyCortexAction } from './services/key-cortex-action.service';
import { ModelGateway } from './services/model-gateway.service';
import { KeyCortexController } from './key-cortex.controller';

/**
 * =============================================================================
 * KeyCortexModule — KEY Business Consciousness Module
 * =============================================================================
 * Top-level NestJS module that wires together:
 *
 *   • ConsciousnessModule    — 9-layer consciousness system (22 providers)
 *   • GenomeContextAssembler — Business DNA / genome context assembly
 *   • KeyCortexReasoning     — ReAct reasoning bridge
 *   • KeyCortexConversation  — Session management
 *   • KeyCortexAction        — Action execution engine
 *   • ModelGateway           — Multi-AI provider routing
 *   • KeyCortexController    — HTTP API surface
 *
 * Exports:
 *   • ConsciousnessModule    — for downstream consciousness consumers
 *   • GenomeContextAssembler — for business context queries
 *   • KeyCortexReasoning     — for direct reasoning access
 *   • ModelGateway           — for AI generation needs
 * =============================================================================
 */
@Module({
  imports: [ConsciousnessModule],
  controllers: [KeyCortexController],
  providers: [
    GenomeContextAssembler,
    KeyCortexReasoning,
    KeyCortexConversation,
    KeyCortexAction,
    ModelGateway,
  ],
  exports: [
    ConsciousnessModule,
    GenomeContextAssembler,
    KeyCortexReasoning,
    ModelGateway,
  ],
})
export class KeyCortexModule {}
