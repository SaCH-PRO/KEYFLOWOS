/**
 * KEY Cortex Module
 * NestJS module definition for the JARVIS-like AI intelligence layer.
 *
 * Orchestrates multi-provider AI reasoning, voice synthesis/recognition,
 * personality management, conversation state, business context awareness,
 * and action execution — all scoped behind a unified REST + SSE API.
 */

import { Module, forwardRef } from '@nestjs/common';

import { KeyCortexController } from './key-cortex.controller';
import { KeyCortexPersonalityService } from './key-cortex-personality.service';
import { KeyCortexContextService } from './key-cortex-context.service';
import { KeyCortexReasoningService } from './key-cortex-reasoning.service';
import { KeyCortexConversationService } from './key-cortex-conversation.service';
import { KeyCortexActionsService } from './key-cortex-actions.service';
import { KeyCortexVoiceService } from './key-cortex-voice.service';

import { PrismaModule } from '../../core/prisma/prisma.module';
import { RedisModule } from '../../core/redis/redis.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    // Database & cache infrastructure
    PrismaModule,
    RedisModule,

    // AI provider gateway — forwardRef to break any potential circular
    // dependency between KeyCortex and the legacy AiModule.
    forwardRef(() => AiModule),
  ],

  controllers: [
    // REST + SSE surface (see key-cortex.controller.ts)
    KeyCortexController,
  ],

  providers: [
    // Personality engine — voice, tone, persona management
    KeyCortexPersonalityService,

    // Genome context assembler — business DNA & activity snapshotting
    KeyCortexContextService,

    // Reasoning engine — core brain, streaming, provider routing
    KeyCortexReasoningService,

    // Conversation manager — session lifecycle & message history
    KeyCortexConversationService,

    // Action executor — tool calling, approval flow, execution tracking
    KeyCortexActionsService,

    // Voice interface — TTS / STT with personality voice mapping
    KeyCortexVoiceService,
  ],

  exports: [
    // Re-export all services so other modules can compose
    // KeyCortex capabilities (e.g. autopilot, command centre,
    // onboarding concierge) without duplicating providers.
    KeyCortexPersonalityService,
    KeyCortexContextService,
    KeyCortexReasoningService,
    KeyCortexConversationService,
    KeyCortexActionsService,
    KeyCortexVoiceService,
  ],
})
export class KeyCortexModule {}
