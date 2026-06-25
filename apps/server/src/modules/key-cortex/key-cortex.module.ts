/**
 * KEY Cortex Module
 * NestJS module definition for the JARVIS-like AI intelligence layer.
 *
 * Orchestrates multi-provider AI reasoning, voice synthesis/recognition,
 * personality management, conversation state, business context awareness,
 * and action execution — all scoped behind a unified REST + SSE API.
 *
 * v2 — Integration Layer:
 *   Added universal connector, command parser, action executor, context v2,
 *   insight engine, and background monitor integration. All wired with
 *   forwardRef to break circular dependency chains with domain modules.
 */

import { Module, forwardRef } from '@nestjs/common';

import { KeyCortexController } from './key-cortex.controller';

// ── Core (legacy) ──
import { KeyCortexPersonalityService } from './key-cortex-personality.service';
import { KeyCortexContextService } from './key-cortex-context.service';
import { KeyCortexReasoningService } from './key-cortex-reasoning.service';
import { KeyCortexConversationService } from './key-cortex-conversation.service';
import { KeyCortexActionsService } from './key-cortex-actions.service';
import { KeyCortexVoiceService } from './key-cortex-voice.service';

// ── v2 Integration Layer ──
import { KeyCortexConnectorService } from './key-cortex-connector.service';
import { KeyCortexCommandService } from './key-cortex-command.service';
import { KeyCortexExecutorService } from './key-cortex-executor.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { KeyCortexInsightService } from './key-cortex-insight.service';
import { KeyCortexMonitorV2Service } from './key-cortex-monitor-v2.service';

// ── Infrastructure ──
import { PrismaModule } from '../../core/prisma/prisma.module';
import { RedisModule } from '../../core/redis/redis.module';

// ── AI Gateway ──
import { AiModule } from '../ai/ai.module';

// ── Domain modules (forwardRef to break circular deps) ──
import { CrmModule } from '../crm/crm.module';
import { CommerceModule } from '../commerce/commerce.module';
import { BookingsModule } from '../bookings/bookings.module';
import { ContentModule } from '../content/content.module';
import { CommunicationsModule } from '../communications/communications.module';
import { FlowModule } from '../flow/flow.module';
import { AutopilotModule } from '../autopilot/autopilot.module';
import { TemporalFlowModule } from '../temporal-flow/temporal-flow.module';
import { KeyInboxModule } from '../key-inbox/key-inbox.module';
import { BusinessGenomeModule } from '../genome/genome.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsModule } from '../projects/projects.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [
    // Database & cache infrastructure
    PrismaModule,
    RedisModule,

    // AI provider gateway — forwardRef to break any potential circular
    // dependency between KeyCortex and the legacy AiModule.
    forwardRef(() => AiModule),

    // ── v2: Domain module adapters ──
    // The universal connector needs to call services in each of these
    // modules.  forwardRef prevents circular dependency issues at
    // bootstrap time (e.g. CrmModule → AiModule → KeyCortexModule →
    // CrmModule).
    forwardRef(() => CrmModule),
    forwardRef(() => CommerceModule),
    forwardRef(() => BookingsModule),
    forwardRef(() => ContentModule),
    forwardRef(() => CommunicationsModule),
    forwardRef(() => FlowModule),
    forwardRef(() => AutopilotModule),
    forwardRef(() => TemporalFlowModule),
    forwardRef(() => KeyInboxModule),
    forwardRef(() => BusinessGenomeModule),
    forwardRef(() => NotificationsModule),
    forwardRef(() => ProjectsModule),
    forwardRef(() => ActivityModule),
  ],

  controllers: [
    // REST + SSE surface (see key-cortex.controller.ts)
    KeyCortexController,
  ],

  providers: [
    // ── Core (legacy) ──
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

    // ── v2: Integration Layer ──
    // Universal connector — knows how to talk to every KeyFlowOS module
    KeyCortexConnectorService,

    // NL → Command parser — converts natural language to structured commands
    KeyCortexCommandService,

    // Action executor — real execution with error handling, rollback, audit
    KeyCortexExecutorService,

    // Full context assembler — aggregates context from all 90+ modules
    KeyCortexContextV2Service,

    // Business insight engine — profit, revenue, churn, pipeline analysis
    KeyCortexInsightService,

    // Background monitor integration — autonomous loop management
    KeyCortexMonitorV2Service,
  ],

  exports: [
    // ── Core (legacy) ──
    // Re-export all services so other modules can compose
    // KeyCortex capabilities (e.g. autopilot, command centre,
    // onboarding concierge) without duplicating providers.
    KeyCortexPersonalityService,
    KeyCortexContextService,
    KeyCortexReasoningService,
    KeyCortexConversationService,
    KeyCortexActionsService,
    KeyCortexVoiceService,

    // ── v2: Integration Layer ──
    // These are the primary services other modules will consume.
    // Connector + Executor form the "command API" surface.
    // ContextV2 + Insight provide the "query API" surface.
    KeyCortexConnectorService,
    KeyCortexExecutorService,
    KeyCortexContextV2Service,
    KeyCortexInsightService,
  ],
})
export class KeyCortexModule {}
