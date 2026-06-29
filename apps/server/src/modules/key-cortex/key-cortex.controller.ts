/**
 * KEY Cortex Controller
 * REST + SSE streaming API for the JARVIS-like AI system.
 *
 * Provides session management, chat (streaming & non-streaming),
 * voice synthesis/recognition, personality management, business
 * insights, profit opportunities, and action execution.
 *
 * v2 -- Integration Layer:
 *   Added command execution, module query, capabilities, full context,
 *   insights (revenue/churn/pipeline), monitors, alerts, batch execution,
 *   rollback, business reports, and AI recommendations.
 *
 * v3 -- Phase 3 & 4 Services:
 *   Added Sandbox (code generation & execution), Flow Studio (workflow
 *   management), External Connectors (third-party integrations), Phone
 *   Agent (voice calls), Document Intelligence (RAG & extraction), and
 *   Self-Evolution (adaptive learning & tuning).
 */

import {
  Controller,
  Post,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  Sse,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Observable, Subject, interval, map } from 'rxjs';

import { KeyCortexReasoningService } from './key-cortex-reasoning.service';
import { KeyCortexConversationService } from './key-cortex-conversation.service';
import { KeyCortexVoiceService } from './key-cortex-voice.service';
import { KeyCortexPersonalityService } from './key-cortex-personality.service';
import { KeyCortexActionsService } from './key-cortex-actions.service';
import { KeyCortexContextService } from './key-cortex-context.service';

// -- v2 Integration Layer Services --
import { KeyCortexConnectorService } from './key-cortex-connector.service';
import { KeyCortexCommandService } from './key-cortex-command.service';
import { KeyCortexExecutorService } from './key-cortex-executor.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { KeyCortexInsightService } from './key-cortex-insight.service';
import { KeyCortexMonitorV2Service } from './key-cortex-monitor-v2.service';

// -- v3 Phase 3 & 4 Services --
import { KeyCortexSandboxService } from './key-cortex-sandbox.service';
import { KeyCortexFlowStudioService } from './key-cortex-flow-studio.service';
import { KeyCortexExternalConnectorService } from './key-cortex-external-connector.service';
import { KeyCortexEvolutionService } from './key-cortex-evolution.service';
import { KeyCortexPhoneService } from './key-cortex-phone.service';
import { KeyCortexDocumentService } from './key-cortex-document.service';

// -- Phase D: Learning & Metacognition --
import { KeyCortexLearningService } from './key-cortex-learning.service';

import {
  CortexQuery,
  CortexPersona,
  CortexVoice,
  CortexProvider,
  CortexStreamChunk,
  CortexResponse,
  CortexSession,
  CortexMessage,
  CortexSessionStatus,
  CortexVoiceRequest,
  CortexSTTRequest,
  CortexInsight,
  CortexProfitOpportunity,
  CortexActionResult,
  CortexPersonalityConfig,
  CortexMood,
} from './key-cortex.types';

import {
  ModuleName,
  ConnectorCommand,
  ConnectorResult,
} from './key-cortex-connector.types';

import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { KeyCortexApprovalOrchestratorService } from './key-cortex-approval-orchestrator.service';
import { KeyAutonomySafetyService } from '../key-autonomy/key-autonomy-safety.service';

/* ------------------------------------------------------------------ */
/*  DTOs  (Legacy)                                                     */
/* ------------------------------------------------------------------ */

class CreateSessionDto {
  businessId: string;
  userId: string;
  persona?: CortexPersona;
  voice?: CortexVoice;
  provider?: CortexProvider;
  title?: string;
}

class UpdateSessionDto {
  persona?: CortexPersona;
  voice?: CortexVoice;
  provider?: CortexProvider;
  mood?: CortexMood;
  title?: string;
  status?: CortexSessionStatus;
}

class ChatQueryDto implements CortexQuery {
  text: string;
  sessionId?: string;
  businessId: string;
  userId: string;
  persona?: CortexPersona;
  voice?: CortexVoice;
  provider?: CortexProvider;
  mood?: CortexMood;
  stream?: boolean;
  enableActions?: boolean;
  enableVoice?: boolean;
  attachments?: Array<{
    type: 'image' | 'document' | 'audio' | 'spreadsheet';
    url: string;
    mimeType: string;
    name: string;
  }>;
}

class VoiceSpeakDto implements CortexVoiceRequest {
  text: string;
  voice?: CortexVoice;
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav';
  speed?: number;
  persona?: CortexPersona;
  instructions?: string;
}

class SwitchPersonalityDto {
  sessionId: string;
  persona: CortexPersona;
}

class ApproveActionDto {
  sessionId: string;
  businessId: string;
  actionId: string;
  approved: boolean;
}

class InsightsQueryDto {
  businessId: string;
  query: string;
}

class FeedbackDto {
  sessionId: string;
  businessId: string;
  userId?: string;
  userResponse: 'accepted' | 'rejected' | 'modified' | 'no_action';
  actualOutcome?: string;
  dismissalReason?: string;
  recommendationId?: string;
  metadata?: Record<string, unknown>;
}

class ProfitOpportunitiesQueryDto {
  businessId: string;
  category?: 'automation' | 'upsell' | 'cost_reduction' | 'new_revenue' | 'retention';
}

class UpdateAutonomyProfileDto {
  globalKillSwitch?: boolean;
  maxDailyAutoActions?: number;
  maxDailySpendTtd?: number;
  maxTierWithoutApproval?: number;
  notifyOnBlock?: boolean;
}

/* ------------------------------------------------------------------ */
/*  DTOs  (v2 Integration Layer)                                       */
/* ------------------------------------------------------------------ */

/** Command execution -- natural language or structured command */
class ExecuteCommandDto {
  /** Natural language command (e.g. "Create an invoice for John for $500") */
  command: string;
  businessId: string;
  userId: string;
  /** Optional structured override -- bypasses NL parsing */
  module?: ModuleName;
  action?: string;
  parameters?: Record<string, unknown>;
  /** Require explicit approval before destructive actions */
  requireApproval?: boolean;
}

/** Direct module query */
class QueryModuleDto {
  module: ModuleName;
  query: string;
  businessId: string;
  parameters?: Record<string, unknown>;
}

/** Business insights request */
class GenerateInsightsDto {
  businessId: string;
  /** Specific insight category or question */
  query?: string;
  /** Limit to specific modules */
  modules?: ModuleName[];
}

/** Monitor creation */
class CreateMonitorDto {
  businessId: string;
  /** Natural language description of what to monitor */
  description: string;
  /** Module to monitor (e.g. 'commerce', 'crm') */
  module?: ModuleName;
  /** Specific condition that triggers the monitor */
  condition?: string;
  /** Notification channels */
  notifyChannels?: Array<'email' | 'sms' | 'push' | 'in_app'>;
  /** Run interval in minutes (default: 60) */
  intervalMinutes?: number;
}

/** Monitor update */
class UpdateMonitorDto {
  description?: string;
  module?: ModuleName;
  condition?: string;
  notifyChannels?: Array<'email' | 'sms' | 'push' | 'in_app'>;
  intervalMinutes?: number;
}

/** Monitor toggle */
class ToggleMonitorDto {
  active: boolean;
}

/** Batch execution */
class ExecuteBatchDto {
  /** Either natural language commands or structured commands */
  commands: Array<
    | { type: 'natural'; command: string }
    | {
        type: 'structured';
        module: ModuleName;
        action: string;
        parameters: Record<string, unknown>;
      }
  >;
  businessId: string;
  userId: string;
  /** Stop execution on first failure */
  stopOnError?: boolean;
  /** Require approval for destructive actions */
  requireApproval?: boolean;
}

/** Rollback request */
class RollbackDto {
  /** The correlationId of the command to roll back */
  correlationId: string;
  businessId: string;
  /** Reason for rollback */
  reason?: string;
}

/* ------------------------------------------------------------------ */
/*  DTOs  (v3 Sandbox)                                                 */
/* ------------------------------------------------------------------ */

class SandboxGenerateDto {
  description: string;
  language?: 'typescript' | 'javascript' | 'python' | 'json' | 'sql';
  businessId: string;
  context?: Record<string, unknown>;
}

class SandboxExecuteDto {
  code: string;
  language?: 'typescript' | 'javascript' | 'python' | 'json' | 'sql';
  businessId: string;
  timeoutMs?: number;
  inputs?: Record<string, unknown>;
}

class SandboxAutoDto {
  description: string;
  language?: 'typescript' | 'javascript' | 'python' | 'json' | 'sql';
  businessId: string;
  execute?: boolean;
  inputs?: Record<string, unknown>;
}

class SandboxApplyDto {
  templateId: string;
  parameters: Record<string, unknown>;
  businessId: string;
}

class SandboxExplainDto {
  code: string;
  language?: string;
  businessId: string;
  detail?: 'brief' | 'detailed' | 'line-by-line';
}

/* ------------------------------------------------------------------ */
/*  DTOs  (v3 Flow Studio)                                             */
/* ------------------------------------------------------------------ */

class FlowGenerateDto {
  description: string;
  businessId: string;
  trigger?: string;
  context?: Record<string, unknown>;
}

class FlowCreateDto {
  name: string;
  businessId: string;
  description?: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  trigger?: Record<string, unknown>;
  isActive?: boolean;
}

class FlowUpdateDto {
  name?: string;
  description?: string;
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
  trigger?: Record<string, unknown>;
}

class FlowApplyTemplateDto {
  templateId: string;
  name: string;
  businessId: string;
  parameters?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  DTOs  (v3 External Connectors)                                     */
/* ------------------------------------------------------------------ */

class ConnectorConnectDto {
  connectorType: string;
  businessId: string;
  config: Record<string, unknown>;
  label?: string;
}

class ConnectorExecuteDto {
  action: string;
  parameters?: Record<string, unknown>;
}

class ConnectorCustomDto {
  name: string;
  type: 'rest' | 'graphql' | 'grpc' | 'webhook';
  baseUrl: string;
  auth?: Record<string, unknown>;
  endpoints?: Array<Record<string, unknown>>;
  businessId: string;
}

class WebhookRegisterDto {
  event: string;
  url: string;
  businessId: string;
  secret?: string;
  metadata?: Record<string, unknown>;
}

class WebhookReceiveDto {
  payload: Record<string, unknown>;
  signature?: string;
}

/* ------------------------------------------------------------------ */
/*  DTOs  (v3 Phone Agent)                                             */
/* ------------------------------------------------------------------ */

class PhoneCallDto {
  phoneNumber: string;
  businessId: string;
  script?: string;
  context?: Record<string, unknown>;
  record?: boolean;
}

class PhoneScriptDto {
  objective: string;
  businessId: string;
  tone?: 'professional' | 'friendly' | 'urgent' | 'casual';
  context?: Record<string, unknown>;
}

class PhoneAnalyzeDto {
  transcript: string;
  businessId: string;
  objective?: string;
}

/* ------------------------------------------------------------------ */
/*  DTOs  (v3 Document Intelligence)                                   */
/* ------------------------------------------------------------------ */

class DocumentAskDto {
  question: string;
  businessId: string;
  documentIds?: string[];
  filters?: Record<string, unknown>;
}

class DocumentExtractDto {
  documentId: string;
  businessId: string;
  schema: Record<string, unknown>;
  prompt?: string;
}

class DocumentCompareDto {
  documentIdA: string;
  documentIdB: string;
  businessId: string;
  aspects?: string[];
}

/* ------------------------------------------------------------------ */
/*  DTOs  (v3 Self-Evolution)                                          */
/* ------------------------------------------------------------------ */

class EvolutionTuneDto {
  businessId: string;
  scope?: 'global' | 'module' | 'user';
  targetModule?: string;
  force?: boolean;
}

class EvolutionExplainDto {
  decisionId: string;
  businessId: string;
  detail?: 'summary' | 'full' | 'technical';
}

/* ------------------------------------------------------------------ */
/*  Controller                                                         */
/* ------------------------------------------------------------------ */

@Controller('api/v1/cortex')
@UseGuards(AuthGuard, BusinessGuard)
export class KeyCortexController {
  private readonly logger = new Logger(KeyCortexController.name);

  constructor(
    // -- Core (legacy) --
    private readonly reasoning: KeyCortexReasoningService,
    private readonly conversation: KeyCortexConversationService,
    private readonly voice: KeyCortexVoiceService,
    private readonly personality: KeyCortexPersonalityService,
    private readonly actions: KeyCortexActionsService,
    private readonly context: KeyCortexContextService,

    // -- v2 Integration Layer --
    private readonly connector: KeyCortexConnectorService,
    private readonly command: KeyCortexCommandService,
    private readonly executor: KeyCortexExecutorService,
    private readonly contextV2: KeyCortexContextV2Service,
    private readonly insight: KeyCortexInsightService,
    private readonly monitorV2: KeyCortexMonitorV2Service,

    // -- v3 Phase 3 & 4 Services --
    // TODO: replace `any` with real service types once controller/service
    // method signatures are aligned in the integration hardening follow-up.
    private readonly sandbox: any,
    private readonly flowStudio: any,
    private readonly externalConnector: any,
    private readonly evolution: any,
    private readonly phone: any,
    private readonly document: any,

    // -- Phase D: Learning & Metacognition --
    private readonly learning: KeyCortexLearningService,

    // -- Phase 0.6: Unified approval orchestrator / autonomy safety --
    private readonly safety: KeyAutonomySafetyService,
    private readonly approvalOrchestrator: KeyCortexApprovalOrchestratorService,
  ) {}

  /* ================================================================== */
  /*  SESSION MANAGEMENT                                                */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/sessions
   * Create a new chat session with optional persona, voice, and provider.
   */
  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  async createSession(@Body() dto: CreateSessionDto): Promise<CortexSession> {
    this.logger.debug(`Creating session for business=${dto.businessId}`);

    try {
      const session = await this.conversation.createSession(
        dto.businessId,
        dto.userId,
        {
          persona: dto.persona ?? 'jarvis',
          voice: dto.voice,
          provider: dto.provider,
          title: dto.title,
        } as any,
      );

      // Build and attach initial context snapshot
      session.contextSnapshot =
        await this.context.buildContextSnapshot(dto.businessId);

      return session;
    } catch (err: any) {
      this.logger.error(`Failed to create session: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to create Cortex session');
    }
  }

  /**
   * GET /api/v1/cortex/sessions
   * List sessions for the authenticated user / business.
   */
  @Get('sessions')
  async listSessions(
    @Query('businessId') businessId: string,
    @Query('userId') userId?: string,
  ): Promise<CortexSession[]> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.conversation.listSessions(businessId, userId);
    } catch (err: any) {
      this.logger.error(`Failed to list sessions: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list sessions');
    }
  }

  /**
   * GET /api/v1/cortex/sessions/:id
   * Retrieve a single session including its messages.
   */
  @Get('sessions/:id')
  async getSession(
    @Param('id') sessionId: string,
  ): Promise<CortexSession> {
    const session = await this.conversation.getSession(sessionId);
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
    return session;
  }

  /**
   * PATCH /api/v1/cortex/sessions/:id
   * Update session metadata (persona, voice, provider, mood, title, status).
   */
  @Patch('sessions/:id')
  async updateSession(
    @Param('id') sessionId: string,
    @Body() dto: UpdateSessionDto,
  ): Promise<CortexSession> {
    try {
      return await this.conversation.updateSession(sessionId, dto as any);
    } catch (err: any) {
      this.logger.error(
        `Failed to update session ${sessionId}: ${err.message}`,
        err.stack,
      );
      throw new ServiceUnavailableException('Unable to update session');
    }
  }

  /**
   * DELETE /api/v1/cortex/sessions/:id
   * Delete a session and all associated messages.
   */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSession(@Param('id') sessionId: string): Promise<void> {
    try {
      await this.conversation.deleteSession(sessionId);
    } catch (err: any) {
      this.logger.error(
        `Failed to delete session ${sessionId}: ${err.message}`,
        err.stack,
      );
      throw new ServiceUnavailableException('Unable to delete session');
    }
  }

  /* ================================================================== */
  /*  CHAT                                                              */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/chat
   * Non-streaming chat -- returns a complete CortexResponse.
   */
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async chat(@Body() query: ChatQueryDto): Promise<CortexResponse> {
    if (!query.text?.trim()) {
      throw new BadRequestException('Query text is required');
    }
    if (!query.businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      const response = await this.reasoning.processQuery(query as any);
      return response;
    } catch (err: any) {
      this.logger.error(`Chat error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Cortex reasoning engine unavailable');
    }
  }

  /**
   * POST /api/v1/cortex/chat/stream
   * SSE streaming chat -- returns a reactive stream of CortexStreamChunks.
   */
  @Sse('chat/stream')
  async streamChat(
    @Body() query: ChatQueryDto,
  ): Promise<Observable<CortexStreamChunk>> {
    if (!query.text?.trim()) {
      throw new BadRequestException('Query text is required');
    }
    if (!query.businessId) {
      throw new BadRequestException('businessId is required');
    }

    const subject = new Subject<CortexStreamChunk>();

    // Run the async generator in a background micro-task so the
    // SSE connection is established immediately.
    (async () => {
      try {
        const stream = this.reasoning.streamQuery(query as any);
        for await (const chunk of stream) {
          subject.next(chunk);
        }
        subject.complete();
      } catch (err: any) {
        this.logger.error(`Stream error: ${err.message}`, err.stack);
        subject.error(err);
      }
    })();

    return subject.asObservable();
  }

  /**
   * GET /api/v1/cortex/messages
   * Retrieve recent messages for a session.
   */
  @Get('messages')
  async getMessages(
    @Query('businessId') businessId: string,
    @Query('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ): Promise<{ messages: CortexMessage[] }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }
    if (!sessionId) {
      throw new BadRequestException('sessionId query parameter is required');
    }

    const session = await this.conversation.getSession(sessionId);
    if (!session || session.businessId !== businessId) {
      throw new NotFoundException('Session not found');
    }

    const messages = session.messages ?? [];
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return { messages: messages.slice(-parsedLimit) };
  }

  /**
   * GET /api/v1/cortex/stream
   * General SSE event stream for live Cortex updates.
   */
  @Sse('stream')
  streamEvents(
    @Query('businessId') businessId: string,
  ): Observable<{ data: Record<string, unknown> }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    return interval(15000).pipe(
      map((tick) => ({
        data: {
          type: 'heartbeat',
          businessId,
          tick,
          timestamp: new Date().toISOString(),
        },
      })),
    );
  }

  /* ================================================================== */
  /*  AUTONOMY PROFILE                                                  */
  /* ================================================================== */

  /**
   * GET /api/v1/cortex/autonomy-profile
   */
  @Get('autonomy-profile')
  async getAutonomyProfile(@Query('businessId') businessId: string) {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }
    return this.safety.ensureProfile(businessId);
  }

  /**
   * PATCH /api/v1/cortex/autonomy-profile
   */
  @Patch('autonomy-profile')
  async updateAutonomyProfile(
    @Body() dto: UpdateAutonomyProfileDto & { businessId: string },
  ) {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    return this.safety.updateProfile(dto.businessId, dto);
  }

  /* ================================================================== */
  /*  FEEDBACK & LEARNING                                               */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/feedback
   * Record user feedback on a recommendation so KEY can learn.
   */
  @Post('feedback')
  @HttpCode(HttpStatus.OK)
  async recordFeedback(@Body() dto: FeedbackDto): Promise<{ success: boolean }> {
    if (!dto.sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.userResponse) {
      throw new BadRequestException('userResponse is required');
    }

    await this.learning.recordFeedback(dto);
    return { success: true };
  }

  /* ================================================================== */
  /*  VOICE                                                             */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/voice/speak
   * Text-to-Speech -- synthesises audio and returns it as a binary buffer.
   */
  @Post('voice/speak')
  @HttpCode(HttpStatus.OK)
  async speak(
    @Body() dto: VoiceSpeakDto,
    @Query('businessId') businessId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Buffer> {
    if (!dto.text?.trim()) {
      throw new BadRequestException('Text is required for TTS');
    }
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const audioBuffer = await this.voice.synthesize(dto, businessId);

      const contentTypeMap: Record<string, string> = {
        mp3: 'audio/mpeg',
        opus: 'audio/opus',
        aac: 'audio/aac',
        flac: 'audio/flac',
        wav: 'audio/wav',
      };

      const format = dto.format ?? 'mp3';
      res.setHeader('Content-Type', contentTypeMap[format] ?? 'audio/mpeg');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="cortex-speak.${format}"`,
      );

      return audioBuffer;
    } catch (err: any) {
      this.logger.error(`TTS error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Voice synthesis unavailable');
    }
  }

  /**
   * POST /api/v1/cortex/voice/listen
   * Speech-to-Text -- accepts a multipart audio upload and returns transcript.
   */
  @Post('voice/listen')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('audio'))
  async listen(
    @UploadedFile() audioFile: Express.Multer.File,
    @Query('businessId') businessId: string,
    @Query('language') language?: string,
    @Query('prompt') prompt?: string,
  ): Promise<{ transcript: string; confidence?: number }> {
    if (!audioFile) {
      throw new BadRequestException('Audio file is required (field name: audio)');
    }
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const sttRequest: CortexSTTRequest = {
        audioBuffer: audioFile.buffer,
        mimeType: audioFile.mimetype,
        language,
        prompt,
      };

      const transcript = await this.voice.transcribe(sttRequest, businessId);

      return { transcript };
    } catch (err: any) {
      this.logger.error(`STT error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Speech transcription unavailable');
    }
  }

  /**
   * GET /api/v1/cortex/voice/voices
   * List all available TTS voices with descriptions.
   */
  @Get('voice/voices')
  async listVoices(): Promise<
    Array<{ id: CortexVoice; name: string; description: string; sampleUrl?: string }>
  > {
    try {
      return await this.voice.getAvailableVoices();
    } catch (err: any) {
      this.logger.error(`List voices error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve voice list');
    }
  }

  /* ================================================================== */
  /*  PERSONALITY                                                       */
  /* ================================================================== */

  /**
   * GET /api/v1/cortex/personalities
   * List all available personalities with their full configurations.
   */
  @Get('personalities')
  async listPersonalities(): Promise<{
    personalities: CortexPersonalityConfig[];
  }> {
    const allPersonas: CortexPersona[] = [
      'jarvis',
      'friday',
      'jarvis_dark',
      'nova',
      'titan',
      'ghost',
      'mentor',
      'hustler',
    ];

    const personalities = allPersonas.map((persona) =>
      this.personality.getPersonalityConfig(persona),
    );

    return { personalities };
  }

  /**
   * POST /api/v1/cortex/personalities/switch
   * Switch personality mid-session.
   */
  @Post('personalities/switch')
  @HttpCode(HttpStatus.OK)
  async switchPersonality(
    @Body() dto: SwitchPersonalityDto,
  ): Promise<CortexSession> {
    if (!dto.sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    if (!dto.persona) {
      throw new BadRequestException('persona is required');
    }

    try {
      const session = await this.conversation.getSession(dto.sessionId);
      if (!session) {
        throw new NotFoundException(`Session ${dto.sessionId} not found`);
      }

      const updatedSession = await this.personality.switchPersona(
        session,
        dto.persona,
      );

      return updatedSession;
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(
        `Personality switch error: ${err.message}`,
        err.stack,
      );
      throw new ServiceUnavailableException('Unable to switch personality');
    }
  }

  /* ================================================================== */
  /*  ACTIONS                                                           */
  /* ================================================================== */

  /**
   * GET /api/v1/cortex/actions/tools
   * List all available tools/actions the Cortex can execute.
   */
  @Get('actions/tools')
  async listTools(
    @Query('businessId') businessId: string,
  ): Promise<{
    tools: Array<{ name: string; description: string; params: object }>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const tools = await this.actions.getAvailableTools(businessId);
      return { tools };
    } catch (err: any) {
      this.logger.error(`List tools error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list available tools');
    }
  }

  /**
   * POST /api/v1/cortex/actions/approve
   * Approve (or reject) a pending action that requires user confirmation.
   *
   * Phase 0.6: This endpoint now delegates to the unified approval orchestrator
   * using `dto.actionId` as the canonical KeyActionProposal id. The response
   * `result` field now contains a KeyActionProposalData shape instead of the
   * legacy CortexActionResult.
   */
  @Post('actions/approve')
  @HttpCode(HttpStatus.OK)
  async approveAction(
    @Body() dto: ApproveActionDto,
    @Req() req: { user?: { id?: string } },
  ): Promise<{ result: CortexActionResult }> {
    if (!dto.sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.actionId) {
      throw new BadRequestException('actionId is required');
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException('Authenticated user required');
    }

    try {
      const proposal = dto.approved
        ? await this.approvalOrchestrator.approve({
            proposalId: dto.actionId,
            businessId: dto.businessId,
            userId,
            autoExecute: false,
          })
        : await this.approvalOrchestrator.reject({
            proposalId: dto.actionId,
            businessId: dto.businessId,
            userId,
          });

      return { result: proposal as unknown as CortexActionResult };
    } catch (err: any) {
      this.logger.error(`Action approval error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to process action approval');
    }
  }

  /* ================================================================== */
  /*  v2 -- COMMAND EXECUTION  (KEY Integration Layer)                   */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/execute
   * Parse natural language intent and execute via the connector.
   */
  @Post('execute')
  @HttpCode(HttpStatus.OK)
  async executeCommand(
    @Body() dto: ExecuteCommandDto,
  ): Promise<ConnectorResult & { intent?: string; confidence?: number }> {
    if (!dto.command?.trim() && !dto.module) {
      throw new BadRequestException('command (natural language) or module+action is required');
    }
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      // If a structured command is provided, execute directly
      if (dto.module && dto.action) {
        const connectorCommand: ConnectorCommand = {
          module: dto.module,
          action: dto.action,
          parameters: dto.parameters ?? {},
          businessId: dto.businessId,
          userId: dto.userId ?? 'system',
          source: 'key_cortex',
          timestamp: new Date(),
          correlationId: this.generateCorrelationId(),
        };

        const result = await this.executor.execute(connectorCommand, {
          skipApproval: !(dto.requireApproval ?? false),
        });
        return result as any;
      }

      // Otherwise, parse natural language into structured commands
      const capabilities = this.connector.getAllCapabilities();
      const context = await this.contextV2.getFullContext(dto.businessId);

      const parsedIntents = await this.command.parseIntent(dto.command, {
        businessId: dto.businessId,
        userId: dto.userId,
        capabilities,
        context,
      } as any);

      if (!parsedIntents || parsedIntents.length === 0) {
        throw new BadRequestException(
          'Unable to parse command. Try rephrasing or use structured execution.',
        );
      }

      const topIntent = parsedIntents[0];
      const connectorCommand = this.command.toConnectorCommand(
        topIntent,
        dto.businessId,
        dto.userId ?? 'system',
      );

      const result = await this.executor.execute(connectorCommand, {
        skipApproval: !(dto.requireApproval ?? topIntent.requiresApproval),
      });

      return {
        ...result,
        intent: topIntent.intent,
        confidence: topIntent.confidence,
      } as any;
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Execute error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Command execution failed');
    }
  }

  /**
   * POST /api/v1/cortex/query
   * Direct module query -- no NL parsing, hits the module directly.
   */
  @Post('query')
  @HttpCode(HttpStatus.OK)
  async queryModule(
    @Body() dto: QueryModuleDto,
  ): Promise<ConnectorResult> {
    if (!dto.module) {
      throw new BadRequestException('module is required');
    }
    if (!dto.query) {
      throw new BadRequestException('query is required');
    }
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      const result = await (this.connector as any).query(
        dto.module,
        dto.query,
        dto.parameters ?? {},
        dto.businessId,
      );
      return result;
    } catch (err: any) {
      this.logger.error(`Query error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException(`Module query failed: ${err.message}`);
    }
  }

  /**
   * GET /api/v1/cortex/capabilities
   * Return all available module capabilities.
   */
  @Get('capabilities')
  @HttpCode(HttpStatus.OK)
  async getCapabilities(
    @Query('modules') modules?: string,
  ): Promise<{
    capabilities: ReturnType<KeyCortexConnectorService['getAllCapabilities']>;
    formatted: string;
  }> {
    try {
      const moduleList = modules
        ? (modules.split(',') as ModuleName[])
        : undefined;

      const capabilities = moduleList
        ? this.connector.getCapabilities(moduleList)
        : this.connector.getAllCapabilities();

      const formatted = this.connector.formatCapabilitiesForPrompt();

      return { capabilities, formatted };
    } catch (err: any) {
      this.logger.error(`Capabilities error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve capabilities');
    }
  }

  /**
   * GET /api/v1/cortex/context
   * Return full business context assembled from all modules.
   */
  @Get('context')
  @HttpCode(HttpStatus.OK)
  async getContext(
    @Query('businessId') businessId: string,
  ): Promise<{
    context: Record<string, unknown>;
    formatted: string;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const context = await this.contextV2.getFullContext(businessId);
      const formatted = this.contextV2.formatContextForPrompt(context);

      return { context: context as any, formatted };
    } catch (err: any) {
      this.logger.error(`Context error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to assemble business context');
    }
  }

  /* ================================================================== */
  /*  v2 -- INSIGHTS                                                     */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/insights
   * Generate business insights using the v2 insight engine.
   */
  @Post('insights')
  @HttpCode(HttpStatus.OK)
  async generateInsights(
    @Body() dto: GenerateInsightsDto,
  ): Promise<{
    insights: CortexInsight[];
    generatedAt: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      // Use v2 insight service for richer, cross-module insights
      const insights = await (this.insight as any).generateInsights(
        dto.businessId,
        dto.query ?? '',
        dto.modules,
      );

      return {
        insights: insights as any,
        generatedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      this.logger.error(`Insights v2 error: ${err.message}`, err.stack);
      // Fallback to legacy reasoning service
      try {
        const legacyInsights = await this.reasoning.generateInsights(
          dto.businessId,
          dto.query ?? '',
        );
        return { insights: legacyInsights, generatedAt: new Date().toISOString() };
      } catch {
        throw new ServiceUnavailableException('Unable to generate insights');
      }
    }
  }

  /**
   * GET /api/v1/cortex/insights/profit
   * Profit opportunities across all modules.
   */
  @Get('insights/profit')
  @HttpCode(HttpStatus.OK)
  async getProfitOpportunities(
    @Query('businessId') businessId: string,
  ): Promise<{
    opportunities: CortexProfitOpportunity[];
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const opportunities = await this.insight.findProfitOpportunities(businessId);
      return { opportunities: opportunities as any };
    } catch (err: any) {
      this.logger.error(`Profit opportunities error: ${err.message}`, err.stack);
      // Fallback to legacy
      try {
        const opportunities = await this.reasoning.findProfitOpportunities(businessId);
        return { opportunities: opportunities as any };
      } catch {
        throw new ServiceUnavailableException('Unable to find profit opportunities');
      }
    }
  }

  /**
   * GET /api/v1/cortex/insights/revenue
   * Revenue analysis for a given period.
   */
  @Get('insights/revenue')
  @HttpCode(HttpStatus.OK)
  async analyzeRevenue(
    @Query('businessId') businessId: string,
    @Query('period') period?: string,
  ): Promise<{
    analysis: Record<string, unknown>;
    period: string;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const analysis = await this.insight.analyzeRevenue(
        businessId,
        period ?? 'last_30_days',
      );
      return { analysis: analysis as any, period: period ?? 'last_30_days' };
    } catch (err: any) {
      this.logger.error(`Revenue analysis error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to analyze revenue');
    }
  }

  /**
   * GET /api/v1/cortex/insights/churn
   * Churn risk analysis from CRM and engagement data.
   */
  @Get('insights/churn')
  @HttpCode(HttpStatus.OK)
  async analyzeChurnRisk(
    @Query('businessId') businessId: string,
  ): Promise<{
    risks: Array<Record<string, unknown>>;
    summary: Record<string, unknown>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const risks = await this.insight.analyzeChurnRisk(businessId);
      return { risks: risks as any, summary: { totalAtRisk: risks.length } };
    } catch (err: any) {
      this.logger.error(`Churn analysis error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to analyze churn risk');
    }
  }

  /**
   * GET /api/v1/cortex/insights/pipeline
   * Sales pipeline analysis.
   */
  @Get('insights/pipeline')
  @HttpCode(HttpStatus.OK)
  async analyzePipeline(
    @Query('businessId') businessId: string,
  ): Promise<{
    pipeline: Record<string, unknown>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const pipeline = await this.insight.analyzePipeline(businessId);
      return { pipeline: pipeline as any };
    } catch (err: any) {
      this.logger.error(`Pipeline analysis error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to analyze pipeline');
    }
  }

  /* ================================================================== */
  /*  v2 -- MONITORS                                                     */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/monitors
   * Create an autonomous monitor.
   */
  @Post('monitors')
  @HttpCode(HttpStatus.CREATED)
  async createMonitor(
    @Body() dto: CreateMonitorDto,
  ): Promise<Record<string, unknown>> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.description?.trim()) {
      throw new BadRequestException('description is required');
    }

    try {
      const monitor = await this.monitorV2.createMonitor(
        dto.businessId,
        dto.description,
        {
          module: dto.module,
          condition: dto.condition,
          notifyChannels: dto.notifyChannels,
          intervalMinutes: dto.intervalMinutes ?? 60,
        } as any,
      );
      return monitor as any;
    } catch (err: any) {
      this.logger.error(`Create monitor error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to create monitor');
    }
  }

  /**
   * GET /api/v1/cortex/monitors
   * List all monitors for a business.
   */
  @Get('monitors')
  @HttpCode(HttpStatus.OK)
  async getMonitors(
    @Query('businessId') businessId: string,
  ): Promise<{
    monitors: Array<Record<string, unknown>>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const monitors = await this.monitorV2.getActiveMonitors(businessId);
      return { monitors: monitors as any };
    } catch (err: any) {
      this.logger.error(`List monitors error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list monitors');
    }
  }

  /**
   * PATCH /api/v1/cortex/monitors/:id
   * Update an existing monitor.
   */
  @Patch('monitors/:id')
  @HttpCode(HttpStatus.OK)
  async updateMonitor(
    @Param('id') monitorId: string,
    @Body() dto: UpdateMonitorDto,
    @Query('businessId') businessId?: string,
  ): Promise<Record<string, unknown>> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const monitor = await this.monitorV2.updateMonitor(
        businessId,
        monitorId,
        dto,
      );
      return monitor as any;
    } catch (err: any) {
      this.logger.error(`Update monitor error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to update monitor');
    }
  }

  /**
   * POST /api/v1/cortex/monitors/:id/toggle
   * Enable or disable a monitor.
   */
  @Post('monitors/:id/toggle')
  @HttpCode(HttpStatus.OK)
  async toggleMonitor(
    @Param('id') monitorId: string,
    @Body() dto: ToggleMonitorDto,
    @Query('businessId') businessId?: string,
  ): Promise<{ monitorId: string; active: boolean }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      await this.monitorV2.setMonitorActive(
        businessId,
        monitorId,
        dto.active,
      );
      return { monitorId, active: dto.active };
    } catch (err: any) {
      this.logger.error(`Toggle monitor error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to toggle monitor');
    }
  }

  /* ================================================================== */
  /*  v2 -- ALERTS                                                       */
  /* ================================================================== */

  /**
   * GET /api/v1/cortex/alerts
   * Recent alerts across all monitors.
   */
  @Get('alerts')
  @HttpCode(HttpStatus.OK)
  async getAlerts(
    @Query('businessId') businessId: string,
    @Query('limit') limit?: number,
  ): Promise<{
    alerts: Array<Record<string, unknown>>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const alerts = await this.monitorV2.getRecentAlerts(
        businessId,
        limit ? Number(limit) : 20,
      );
      return { alerts: alerts as any };
    } catch (err: any) {
      this.logger.error(`Alerts error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve alerts');
    }
  }

  /* ================================================================== */
  /*  v2 -- BATCH EXECUTION                                              */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/batch
   * Execute multiple commands in a single batch.
   */
  @Post('batch')
  @HttpCode(HttpStatus.OK)
  async executeBatch(
    @Body() dto: ExecuteBatchDto,
  ): Promise<{
    results: ConnectorResult[];
    summary: {
      total: number;
      succeeded: number;
      failed: number;
      executionTimeMs: number;
    };
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.commands || dto.commands.length === 0) {
      throw new BadRequestException('commands array is required and must not be empty');
    }
    if (dto.commands.length > 50) {
      throw new BadRequestException('Maximum 50 commands per batch');
    }

    const start = Date.now();

    try {
      // Convert mixed commands to structured ConnectorCommands
      const connectorCommands: ConnectorCommand[] = [];

      for (const cmd of dto.commands) {
        if (cmd.type === 'natural') {
          const capabilities = this.connector.getAllCapabilities();
          const context = await this.contextV2.getFullContext(dto.businessId);
          const parsed = await this.command.parseIntent(cmd.command, {
            businessId: dto.businessId,
            userId: dto.userId,
            capabilities,
            context,
          } as any);
          if (parsed && parsed.length > 0) {
            connectorCommands.push(
              this.command.toConnectorCommand(
                parsed[0],
                dto.businessId,
                dto.userId ?? 'system',
              ),
            );
          }
        } else {
          connectorCommands.push({
            module: cmd.module,
            action: cmd.action,
            parameters: cmd.parameters,
            businessId: dto.businessId,
            userId: dto.userId ?? 'system',
            source: 'key_cortex',
            timestamp: new Date(),
            correlationId: this.generateCorrelationId(),
          });
        }
      }

      const batchResult = await this.executor.executeBatch(connectorCommands, {
        stopOnError: dto.stopOnError ?? false,
        skipApproval: !(dto.requireApproval ?? false),
      });

      const results = batchResult.results;
      const succeeded = results.filter((r) => r.result.success).length;
      const failed = results.filter((r) => !r.result.success).length;

      return {
        results: results.map((r) => r.result),
        summary: {
          total: results.length,
          succeeded,
          failed,
          executionTimeMs: Date.now() - start,
        },
      };
    } catch (err: any) {
      this.logger.error(`Batch execution error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Batch execution failed');
    }
  }

  /* ================================================================== */
  /*  v2 -- ROLLBACK                                                     */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/rollback
   * Rollback a previously executed command.
   */
  @Post('rollback')
  @HttpCode(HttpStatus.OK)
  async rollback(
    @Body() dto: RollbackDto,
  ): Promise<{
    success: boolean;
    correlationId: string;
    message: string;
  }> {
    if (!dto.correlationId) {
      throw new BadRequestException('correlationId is required');
    }
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      // Build a minimal result object for the rollback
      const mockResult: ConnectorResult = {
        success: true,
        executionTimeMs: 0,
        command: {
          module: 'crm',
          action: 'rollback',
          parameters: { correlationId: dto.correlationId, reason: dto.reason },
          businessId: dto.businessId,
          userId: 'system',
          source: 'key_cortex',
          timestamp: new Date(),
          correlationId: dto.correlationId,
        },
      };

      await this.executor.rollback(mockResult);

      return {
        success: true,
        correlationId: dto.correlationId,
        message: `Command ${dto.correlationId} rolled back successfully`,
      };
    } catch (err: any) {
      this.logger.error(`Rollback error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException(
        `Rollback failed: ${err.message}`,
      );
    }
  }

  /* ================================================================== */
  /*  v2 -- BUSINESS REPORT                                              */
  /* ================================================================== */

  /**
   * GET /api/v1/cortex/report
   * Generate a comprehensive business report.
   */
  @Get('report')
  @HttpCode(HttpStatus.OK)
  async getBusinessReport(
    @Query('businessId') businessId: string,
    @Query('scope') scope: 'daily' | 'weekly' | 'monthly' = 'daily',
  ): Promise<Record<string, unknown>> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const report = await this.insight.generateBusinessReport(businessId, scope);
      return report as unknown as Record<string, unknown>;
    } catch (err: any) {
      this.logger.error(`Business report error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to generate business report');
    }
  }

  /* ================================================================== */
  /*  v2 -- RECOMMENDATIONS                                              */
  /* ================================================================== */

  /**
   * GET /api/v1/cortex/recommendations
   * AI-generated recommendations based on full business context.
   */
  @Get('recommendations')
  @HttpCode(HttpStatus.OK)
  async getRecommendations(
    @Query('businessId') businessId: string,
  ): Promise<{
    recommendations: Array<Record<string, unknown>>;
    generatedAt: string;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const recommendations = await this.insight.generateRecommendations(businessId);
      return {
        recommendations: recommendations as unknown as Array<Record<string, unknown>>,
        generatedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      this.logger.error(`Recommendations error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to generate recommendations');
    }
  }

  /* ================================================================== */
  /*  v2 -- PROFIT OPPORTUNITIES (legacy compat)                         */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/profit-opportunities
   * Find profit opportunities for the business.
   *
   * @deprecated Use GET /api/v1/cortex/insights/profit instead.
   */
  @Post('profit-opportunities')
  @HttpCode(HttpStatus.OK)
  async findProfitOpportunities(
    @Body() dto: ProfitOpportunitiesQueryDto,
  ): Promise<{ opportunities: CortexProfitOpportunity[] }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      const opportunities = await this.reasoning.findProfitOpportunities(
        dto.businessId,
      );

      // Optional category filter applied in-memory if provided
      const filtered = dto.category
        ? opportunities.filter((o) => o.category === dto.category)
        : opportunities;

      return { opportunities: filtered };
    } catch (err: any) {
      this.logger.error(
        `Profit opportunities error: ${err.message}`,
        err.stack,
      );
      throw new ServiceUnavailableException(
        'Unable to find profit opportunities',
      );
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v3 -- SANDBOX  (Code Generation & Execution)                      */
  /* ═══════════════════════════════════════════════════════════════════ */

  /**
   * POST /api/v1/cortex/sandbox/generate
   * Generate code from a natural language description.
   */
  @Post('sandbox/generate')
  @HttpCode(HttpStatus.OK)
  async sandboxGenerate(
    @Body() dto: SandboxGenerateDto,
  ): Promise<{
    code: string;
    language: string;
    explanation?: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.description?.trim()) {
      throw new BadRequestException('description is required');
    }

    try {
      return await this.sandbox.generate(dto.description, {
        language: dto.language,
        context: dto.context,
        businessId: dto.businessId,
      });
    } catch (err: any) {
      this.logger.error(`Sandbox generate error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Code generation failed');
    }
  }

  /**
   * POST /api/v1/cortex/sandbox/execute
   * Execute code in a sandboxed environment.
   */
  @Post('sandbox/execute')
  @HttpCode(HttpStatus.OK)
  async sandboxExecute(
    @Body() dto: SandboxExecuteDto,
  ): Promise<{
    output: string;
    exitCode: number;
    executionTimeMs: number;
    logs?: string[];
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.code?.trim()) {
      throw new BadRequestException('code is required');
    }

    try {
      return await this.sandbox.execute(dto.code, {
        language: dto.language,
        inputs: dto.inputs,
        timeoutMs: dto.timeoutMs,
        businessId: dto.businessId,
      });
    } catch (err: any) {
      this.logger.error(`Sandbox execute error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Code execution failed');
    }
  }

  /**
   * POST /api/v1/cortex/sandbox/auto
   * Generate code from description and optionally execute it.
   */
  @Post('sandbox/auto')
  @HttpCode(HttpStatus.OK)
  async sandboxAuto(
    @Body() dto: SandboxAutoDto,
  ): Promise<{
    code: string;
    executed: boolean;
    output?: string;
    exitCode?: number;
    explanation?: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.description?.trim()) {
      throw new BadRequestException('description is required');
    }

    try {
      return await this.sandbox.auto(dto.description, {
        language: dto.language,
        execute: dto.execute ?? true,
        inputs: dto.inputs,
        businessId: dto.businessId,
      });
    } catch (err: any) {
      this.logger.error(`Sandbox auto error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Auto code generation failed');
    }
  }

  /**
   * GET /api/v1/cortex/sandbox/templates
   * List available code templates.
   */
  @Get('sandbox/templates')
  @HttpCode(HttpStatus.OK)
  async sandboxTemplates(
    @Query('language') language?: string,
    @Query('category') category?: string,
  ): Promise<{
    templates: Array<{
      id: string;
      name: string;
      description: string;
      language: string;
      category: string;
    }>;
  }> {
    try {
      return await this.sandbox.listTemplates({ language, category });
    } catch (err: any) {
      this.logger.error(`Sandbox templates error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list templates');
    }
  }

  /**
   * POST /api/v1/cortex/sandbox/apply
   * Apply a template with parameters.
   */
  @Post('sandbox/apply')
  @HttpCode(HttpStatus.OK)
  async sandboxApply(
    @Body() dto: SandboxApplyDto,
  ): Promise<{
    code: string;
    templateId: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.templateId) {
      throw new BadRequestException('templateId is required');
    }

    try {
      return await this.sandbox.applyTemplate(dto.templateId, dto.parameters, {
        businessId: dto.businessId,
      });
    } catch (err: any) {
      this.logger.error(`Sandbox apply error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Template application failed');
    }
  }

  /**
   * POST /api/v1/cortex/sandbox/explain
   * Explain what a piece of code does.
   */
  @Post('sandbox/explain')
  @HttpCode(HttpStatus.OK)
  async sandboxExplain(
    @Body() dto: SandboxExplainDto,
  ): Promise<{
    explanation: string;
    complexity?: string;
    suggestions?: string[];
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.code?.trim()) {
      throw new BadRequestException('code is required');
    }

    try {
      return await this.sandbox.explain(dto.code, {
        language: dto.language,
        detail: dto.detail ?? 'detailed',
        businessId: dto.businessId,
      });
    } catch (err: any) {
      this.logger.error(`Sandbox explain error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Code explanation failed');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v3 -- FLOW STUDIO  (Workflow Management)                          */
  /* ═══════════════════════════════════════════════════════════════════ */

  /**
   * POST /api/v1/cortex/flows/generate
   * Generate a flow from a natural language description.
   */
  @Post('flows/generate')
  @HttpCode(HttpStatus.OK)
  async flowGenerate(
    @Body() dto: FlowGenerateDto,
  ): Promise<{
    flow: Record<string, unknown>;
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.description?.trim()) {
      throw new BadRequestException('description is required');
    }

    try {
      return await this.flowStudio.generate(dto.description, {
        businessId: dto.businessId,
        trigger: dto.trigger,
        context: dto.context,
      });
    } catch (err: any) {
      this.logger.error(`Flow generate error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Flow generation failed');
    }
  }

  /**
   * POST /api/v1/cortex/flows
   * Create a new flow.
   */
  @Post('flows')
  @HttpCode(HttpStatus.CREATED)
  async flowCreate(
    @Body() dto: FlowCreateDto,
  ): Promise<Record<string, unknown>> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!dto.nodes || dto.nodes.length === 0) {
      throw new BadRequestException('nodes array is required');
    }

    try {
      return await this.flowStudio.create(dto.businessId, {
        name: dto.name,
        description: dto.description,
        nodes: dto.nodes,
        edges: dto.edges,
        trigger: dto.trigger,
        isActive: dto.isActive ?? false,
      });
    } catch (err: any) {
      this.logger.error(`Flow create error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Flow creation failed');
    }
  }

  /**
   * GET /api/v1/cortex/flows
   * List all flows for a business.
   */
  @Get('flows')
  @HttpCode(HttpStatus.OK)
  async flowList(
    @Query('businessId') businessId: string,
    @Query('status') status?: string,
  ): Promise<{
    flows: Array<Record<string, unknown>>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.flowStudio.list(businessId, { status });
    } catch (err: any) {
      this.logger.error(`Flow list error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list flows');
    }
  }

  /**
   * GET /api/v1/cortex/flows/:id
   * Get a single flow by ID.
   */
  @Get('flows/:id')
  @HttpCode(HttpStatus.OK)
  async flowGet(
    @Param('id') flowId: string,
    @Query('businessId') businessId?: string,
  ): Promise<Record<string, unknown>> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.flowStudio.get(flowId, businessId);
    } catch (err: any) {
      this.logger.error(`Flow get error: ${err.message}`, err.stack);
      if (err instanceof NotFoundException) throw err;
      throw new ServiceUnavailableException('Unable to retrieve flow');
    }
  }

  /**
   * PUT /api/v1/cortex/flows/:id
   * Update an existing flow.
   */
  @Put('flows/:id')
  @HttpCode(HttpStatus.OK)
  async flowUpdate(
    @Param('id') flowId: string,
    @Body() dto: FlowUpdateDto,
    @Query('businessId') businessId?: string,
  ): Promise<Record<string, unknown>> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.flowStudio.update(flowId, businessId, dto);
    } catch (err: any) {
      this.logger.error(`Flow update error: ${err.message}`, err.stack);
      if (err instanceof NotFoundException) throw err;
      throw new ServiceUnavailableException('Flow update failed');
    }
  }

  /**
   * DELETE /api/v1/cortex/flows/:id
   * Delete a flow.
   */
  @Delete('flows/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async flowDelete(
    @Param('id') flowId: string,
    @Query('businessId') businessId?: string,
  ): Promise<void> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      await this.flowStudio.delete(flowId, businessId);
    } catch (err: any) {
      this.logger.error(`Flow delete error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Flow deletion failed');
    }
  }

  /**
   * POST /api/v1/cortex/flows/:id/execute
   * Execute a flow by ID.
   */
  @Post('flows/:id/execute')
  @HttpCode(HttpStatus.OK)
  async flowExecute(
    @Param('id') flowId: string,
    @Body() body: { inputs?: Record<string, unknown>; businessId?: string },
    @Query('businessId') queryBusinessId?: string,
  ): Promise<{
    executionId: string;
    status: string;
    results?: Array<Record<string, unknown>>;
  }> {
    const businessId = body.businessId ?? queryBusinessId;
    if (!businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      return await this.flowStudio.execute(flowId, businessId, body.inputs);
    } catch (err: any) {
      this.logger.error(`Flow execute error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Flow execution failed');
    }
  }

  /**
   * POST /api/v1/cortex/flows/:id/toggle
   * Activate or deactivate a flow.
   */
  @Post('flows/:id/toggle')
  @HttpCode(HttpStatus.OK)
  async flowToggle(
    @Param('id') flowId: string,
    @Body() dto: { active: boolean },
    @Query('businessId') businessId?: string,
  ): Promise<{ flowId: string; active: boolean }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      await this.flowStudio.toggle(flowId, businessId, dto.active);
      return { flowId, active: dto.active };
    } catch (err: any) {
      this.logger.error(`Flow toggle error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Flow toggle failed');
    }
  }

  /**
   * GET /api/v1/cortex/flows/templates
   * List available flow templates.
   */
  @Get('flows/templates')
  @HttpCode(HttpStatus.OK)
  async flowTemplates(
    @Query('category') category?: string,
  ): Promise<{
    templates: Array<Record<string, unknown>>;
  }> {
    try {
      return await this.flowStudio.listTemplates(category);
    } catch (err: any) {
      this.logger.error(`Flow templates error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list flow templates');
    }
  }

  /**
   * POST /api/v1/cortex/flows/apply-template
   * Apply a template to create a new flow.
   */
  @Post('flows/apply-template')
  @HttpCode(HttpStatus.CREATED)
  async flowApplyTemplate(
    @Body() dto: FlowApplyTemplateDto,
  ): Promise<Record<string, unknown>> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.templateId) {
      throw new BadRequestException('templateId is required');
    }
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }

    try {
      return await this.flowStudio.applyTemplate(
        dto.templateId,
        dto.businessId,
        {
          name: dto.name,
          parameters: dto.parameters,
        },
      );
    } catch (err: any) {
      this.logger.error(`Flow apply template error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Template application failed');
    }
  }

  /**
   * GET /api/v1/cortex/flows/nodes
   * Get the node registry (available node types).
   */
  @Get('flows/nodes')
  @HttpCode(HttpStatus.OK)
  async flowNodes(): Promise<{
    nodes: Array<{
      type: string;
      name: string;
      description: string;
      inputs: Array<Record<string, unknown>>;
      outputs: Array<Record<string, unknown>>;
      configSchema?: Record<string, unknown>;
    }>;
  }> {
    try {
      return await this.flowStudio.getNodeRegistry();
    } catch (err: any) {
      this.logger.error(`Flow nodes error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve node registry');
    }
  }
  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v3 -- EXTERNAL CONNECTORS  (Third-party Integrations)             */
  /* ═══════════════════════════════════════════════════════════════════ */

  /**
   * GET /api/v1/cortex/connectors
   * List available connector definitions.
   */
  @Get('connectors')
  @HttpCode(HttpStatus.OK)
  async connectorDefinitions(
    @Query('category') category?: string,
  ): Promise<{
    connectors: Array<{
      type: string;
      name: string;
      description: string;
      category: string;
      authType: string;
    }>;
  }> {
    try {
      return await this.externalConnector.listDefinitions(category);
    } catch (err: any) {
      this.logger.error(`Connector definitions error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list connector definitions');
    }
  }

  /**
   * POST /api/v1/cortex/connectors/connect
   * Connect a third-party service.
   */
  @Post('connectors/connect')
  @HttpCode(HttpStatus.CREATED)
  async connectorConnect(
    @Body() dto: ConnectorConnectDto,
  ): Promise<{
    instanceId: string;
    status: string;
    connectedAt: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.connectorType) {
      throw new BadRequestException('connectorType is required');
    }
    if (!dto.config) {
      throw new BadRequestException('config is required');
    }

    try {
      return await this.externalConnector.connect(
        dto.connectorType,
        dto.businessId,
        dto.config,
        { label: dto.label },
      );
    } catch (err: any) {
      this.logger.error(`Connector connect error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Failed to connect service');
    }
  }

  /**
   * GET /api/v1/cortex/connectors/instances
   * List all connected service instances.
   */
  @Get('connectors/instances')
  @HttpCode(HttpStatus.OK)
  async connectorInstances(
    @Query('businessId') businessId: string,
  ): Promise<{
    instances: Array<Record<string, unknown>>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.externalConnector.listInstances(businessId);
    } catch (err: any) {
      this.logger.error(`Connector instances error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list connected services');
    }
  }

  /**
   * DELETE /api/v1/cortex/connectors/:id
   * Disconnect a connected service.
   */
  @Delete('connectors/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async connectorDisconnect(
    @Param('id') instanceId: string,
    @Query('businessId') businessId?: string,
  ): Promise<void> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      await this.externalConnector.disconnect(instanceId, businessId);
    } catch (err: any) {
      this.logger.error(`Connector disconnect error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Failed to disconnect service');
    }
  }

  /**
   * POST /api/v1/cortex/connectors/:id/execute
   * Execute an action on a connected service.
   */
  @Post('connectors/:id/execute')
  @HttpCode(HttpStatus.OK)
  async connectorExecute(
    @Param('id') instanceId: string,
    @Body() dto: ConnectorExecuteDto,
    @Query('businessId') businessId?: string,
  ): Promise<{
    success: boolean;
    data?: Record<string, unknown>;
    executionTimeMs: number;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }
    if (!dto.action) {
      throw new BadRequestException('action is required');
    }

    try {
      return await this.externalConnector.execute(
        instanceId,
        businessId,
        dto.action,
        dto.parameters ?? {},
      );
    } catch (err: any) {
      this.logger.error(`Connector execute error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Connector action execution failed');
    }
  }

  /**
   * GET /api/v1/cortex/connectors/:id/status
   * Check the status of a connected service.
   */
  @Get('connectors/:id/status')
  @HttpCode(HttpStatus.OK)
  async connectorStatus(
    @Param('id') instanceId: string,
    @Query('businessId') businessId?: string,
  ): Promise<{
    status: string;
    healthy: boolean;
    lastChecked: string;
    details?: Record<string, unknown>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.externalConnector.checkStatus(instanceId, businessId);
    } catch (err: any) {
      this.logger.error(`Connector status error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to check connector status');
    }
  }

  /**
   * POST /api/v1/cortex/connectors/custom
   * Create a custom connector definition.
   */
  @Post('connectors/custom')
  @HttpCode(HttpStatus.CREATED)
  async connectorCustom(
    @Body() dto: ConnectorCustomDto,
  ): Promise<{
    connectorId: string;
    name: string;
    type: string;
    status: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!dto.baseUrl?.trim()) {
      throw new BadRequestException('baseUrl is required');
    }

    try {
      return await this.externalConnector.createCustom(dto.businessId, {
        name: dto.name,
        type: dto.type,
        baseUrl: dto.baseUrl,
        auth: dto.auth,
        endpoints: dto.endpoints,
      });
    } catch (err: any) {
      this.logger.error(`Connector custom error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Custom connector creation failed');
    }
  }

  /**
   * POST /api/v1/cortex/webhooks
   * Register a webhook for an event.
   */
  @Post('webhooks')
  @HttpCode(HttpStatus.CREATED)
  async webhookRegister(
    @Body() dto: WebhookRegisterDto,
  ): Promise<{
    webhookId: string;
    event: string;
    url: string;
    status: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.event?.trim()) {
      throw new BadRequestException('event is required');
    }
    if (!dto.url?.trim()) {
      throw new BadRequestException('url is required');
    }

    try {
      return await this.externalConnector.registerWebhook(
        dto.businessId,
        dto.event,
        dto.url,
        { secret: dto.secret, metadata: dto.metadata },
      );
    } catch (err: any) {
      this.logger.error(`Webhook register error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Webhook registration failed');
    }
  }

  /**
   * POST /api/v1/cortex/webhooks/:id/receive
   * Receive a webhook payload.
   */
  @Post('webhooks/:id/receive')
  @HttpCode(HttpStatus.OK)
  async webhookReceive(
    @Param('id') webhookId: string,
    @Body() dto: WebhookReceiveDto,
  ): Promise<{
    received: boolean;
    processed: boolean;
    eventId?: string;
  }> {
    try {
      return await this.externalConnector.receiveWebhook(
        webhookId,
        dto.payload,
        dto.signature,
      );
    } catch (err: any) {
      this.logger.error(`Webhook receive error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Webhook processing failed');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v3 -- PHONE AGENT  (Voice Calls)                                  */
  /* ═══════════════════════════════════════════════════════════════════ */

  /**
   * POST /api/v1/cortex/phone/call
   * Make a phone call.
   */
  @Post('phone/call')
  @HttpCode(HttpStatus.OK)
  async phoneCall(
    @Body() dto: PhoneCallDto,
  ): Promise<{
    callId: string;
    status: string;
    startedAt: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.phoneNumber?.trim()) {
      throw new BadRequestException('phoneNumber is required');
    }

    try {
      return await this.phone.call(dto.phoneNumber, dto.businessId, {
        script: dto.script,
        context: dto.context,
        record: dto.record ?? false,
      });
    } catch (err: any) {
      this.logger.error(`Phone call error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Failed to initiate call');
    }
  }

  /**
   * GET /api/v1/cortex/phone/history
   * Get call history.
   */
  @Get('phone/history')
  @HttpCode(HttpStatus.OK)
  async phoneHistory(
    @Query('businessId') businessId: string,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
  ): Promise<{
    calls: Array<Record<string, unknown>>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.phone.getHistory(businessId, {
        limit: limit ? Number(limit) : 20,
        status,
      });
    } catch (err: any) {
      this.logger.error(`Phone history error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve call history');
    }
  }

  /**
   * POST /api/v1/cortex/phone/script
   * Generate a call script.
   */
  @Post('phone/script')
  @HttpCode(HttpStatus.OK)
  async phoneScript(
    @Body() dto: PhoneScriptDto,
  ): Promise<{
    script: string;
    talkingPoints: string[];
    estimatedDuration: number;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.objective?.trim()) {
      throw new BadRequestException('objective is required');
    }

    try {
      return await this.phone.generateScript(dto.objective, dto.businessId, {
        tone: dto.tone ?? 'professional',
        context: dto.context,
      });
    } catch (err: any) {
      this.logger.error(`Phone script error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Script generation failed');
    }
  }

  /**
   * POST /api/v1/cortex/phone/analyze
   * Analyze a call transcript.
   */
  @Post('phone/analyze')
  @HttpCode(HttpStatus.OK)
  async phoneAnalyze(
    @Body() dto: PhoneAnalyzeDto,
  ): Promise<{
    sentiment: string;
    outcomes: Array<Record<string, unknown>>;
    summary: string;
    followUps: string[];
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.transcript?.trim()) {
      throw new BadRequestException('transcript is required');
    }

    try {
      return await this.phone.analyzeTranscript(
        dto.transcript,
        dto.businessId,
        { objective: dto.objective },
      );
    } catch (err: any) {
      this.logger.error(`Phone analyze error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Transcript analysis failed');
    }
  }

  /**
   * GET /api/v1/cortex/phone/status
   * Get phone service status.
   */
  @Get('phone/status')
  @HttpCode(HttpStatus.OK)
  async phoneStatus(
    @Query('businessId') businessId?: string,
  ): Promise<{
    available: boolean;
    provider: string;
    region: string;
    capabilities: string[];
  }> {
    try {
      return await this.phone.getStatus(businessId);
    } catch (err: any) {
      this.logger.error(`Phone status error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve phone status');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v3 -- DOCUMENT INTELLIGENCE  (RAG & Extraction)                   */
  /* ═══════════════════════════════════════════════════════════════════ */

  /**
   * POST /api/v1/cortex/documents
   * Upload a document.
   */
  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async documentUpload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { businessId: string; metadata?: Record<string, unknown> },
    @Query('businessId') queryBusinessId?: string,
  ): Promise<{
    documentId: string;
    status: string;
    uploadedAt: string;
  }> {
    const businessId = body.businessId ?? queryBusinessId;
    if (!businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!file) {
      throw new BadRequestException('file is required (field name: file)');
    }

    try {
      return await this.document.upload(file.buffer, file.originalname, file.mimetype, businessId, {
        metadata: body.metadata,
      });
    } catch (err: any) {
      this.logger.error(`Document upload error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Document upload failed');
    }
  }

  /**
   * GET /api/v1/cortex/documents
   * List documents for a business.
   */
  @Get('documents')
  @HttpCode(HttpStatus.OK)
  async documentList(
    @Query('businessId') businessId: string,
    @Query('type') type?: string,
    @Query('limit') limit?: number,
  ): Promise<{
    documents: Array<Record<string, unknown>>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.document.list(businessId, {
        type,
        limit: limit ? Number(limit) : 50,
      });
    } catch (err: any) {
      this.logger.error(`Document list error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list documents');
    }
  }

  /**
   * GET /api/v1/cortex/documents/:id
   * Get a single document.
   */
  @Get('documents/:id')
  @HttpCode(HttpStatus.OK)
  async documentGet(
    @Param('id') documentId: string,
    @Query('businessId') businessId?: string,
  ): Promise<Record<string, unknown>> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.document.get(documentId, businessId);
    } catch (err: any) {
      this.logger.error(`Document get error: ${err.message}`, err.stack);
      if (err instanceof NotFoundException) throw err;
      throw new ServiceUnavailableException('Unable to retrieve document');
    }
  }

  /**
   * DELETE /api/v1/cortex/documents/:id
   * Delete a document.
   */
  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async documentDelete(
    @Param('id') documentId: string,
    @Query('businessId') businessId?: string,
  ): Promise<void> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      await this.document.delete(documentId, businessId);
    } catch (err: any) {
      this.logger.error(`Document delete error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Document deletion failed');
    }
  }

  /**
   * POST /api/v1/cortex/documents/ask
   * Ask a question across documents (RAG).
   */
  @Post('documents/ask')
  @HttpCode(HttpStatus.OK)
  async documentAsk(
    @Body() dto: DocumentAskDto,
  ): Promise<{
    answer: string;
    sources: Array<{
      documentId: string;
      documentName: string;
      chunks: Array<{ text: string; score: number }>;
    }>;
    confidence: number;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.question?.trim()) {
      throw new BadRequestException('question is required');
    }

    try {
      return await this.document.ask(dto.question, dto.businessId, {
        documentIds: dto.documentIds,
        filters: dto.filters,
      });
    } catch (err: any) {
      this.logger.error(`Document ask error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Document question failed');
    }
  }

  /**
   * POST /api/v1/cortex/documents/extract
   * Extract structured data from a document.
   */
  @Post('documents/extract')
  @HttpCode(HttpStatus.OK)
  async documentExtract(
    @Body() dto: DocumentExtractDto,
  ): Promise<{
    documentId: string;
    extracted: Record<string, unknown>;
    confidence: number;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.documentId) {
      throw new BadRequestException('documentId is required');
    }
    if (!dto.schema || Object.keys(dto.schema).length === 0) {
      throw new BadRequestException('schema is required');
    }

    try {
      return await this.document.extract(dto.documentId, dto.businessId, {
        schema: dto.schema,
        prompt: dto.prompt,
      });
    } catch (err: any) {
      this.logger.error(`Document extract error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Document extraction failed');
    }
  }

  /**
   * POST /api/v1/cortex/documents/compare
   * Compare two documents.
   */
  @Post('documents/compare')
  @HttpCode(HttpStatus.OK)
  async documentCompare(
    @Body() dto: DocumentCompareDto,
  ): Promise<{
    similarities: Array<Record<string, unknown>>;
    differences: Array<Record<string, unknown>>;
    summary: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.documentIdA) {
      throw new BadRequestException('documentIdA is required');
    }
    if (!dto.documentIdB) {
      throw new BadRequestException('documentIdB is required');
    }

    try {
      return await this.document.compare(
        dto.documentIdA,
        dto.documentIdB,
        dto.businessId,
        { aspects: dto.aspects },
      );
    } catch (err: any) {
      this.logger.error(`Document compare error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Document comparison failed');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v3 -- SELF-EVOLUTION  (Adaptive Learning & Tuning)                */
  /* ═══════════════════════════════════════════════════════════════════ */

  /**
   * GET /api/v1/cortex/evolution/profile
   * Get the preference profile for a business.
   */
  @Get('evolution/profile')
  @HttpCode(HttpStatus.OK)
  async evolutionProfile(
    @Query('businessId') businessId: string,
    @Query('userId') userId?: string,
  ): Promise<{
    profile: Record<string, unknown>;
    generatedAt: string;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.evolution.getProfile(businessId, { userId });
    } catch (err: any) {
      this.logger.error(`Evolution profile error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve preference profile');
    }
  }

  /**
   * GET /api/v1/cortex/evolution/patterns
   * Get detected usage patterns.
   */
  @Get('evolution/patterns')
  @HttpCode(HttpStatus.OK)
  async evolutionPatterns(
    @Query('businessId') businessId: string,
    @Query('module') moduleName?: string,
    @Query('timeRange') timeRange?: string,
  ): Promise<{
    patterns: Array<{
      type: string;
      description: string;
      frequency: number;
      confidence: number;
    }>;
    generatedAt: string;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.evolution.getPatterns(businessId, {
        module: moduleName,
        timeRange,
      });
    } catch (err: any) {
      this.logger.error(`Evolution patterns error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve patterns');
    }
  }

  /**
   * POST /api/v1/cortex/evolution/tune
   * Trigger self-tuning.
   */
  @Post('evolution/tune')
  @HttpCode(HttpStatus.OK)
  async evolutionTune(
    @Body() dto: EvolutionTuneDto,
  ): Promise<{
    tuned: boolean;
    scope: string;
    adjustments: Array<Record<string, unknown>>;
    appliedAt: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      return await this.evolution.tune(dto.businessId, {
        scope: dto.scope ?? 'global',
        targetModule: dto.targetModule,
        force: dto.force ?? false,
      });
    } catch (err: any) {
      this.logger.error(`Evolution tune error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Self-tuning failed');
    }
  }

  /**
   * GET /api/v1/cortex/evolution/report
   * Get the learning report.
   */
  @Get('evolution/report')
  @HttpCode(HttpStatus.OK)
  async evolutionReport(
    @Query('businessId') businessId: string,
    @Query('period') period?: string,
  ): Promise<{
    report: Record<string, unknown>;
    generatedAt: string;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.evolution.getReport(businessId, { period });
    } catch (err: any) {
      this.logger.error(`Evolution report error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to generate learning report');
    }
  }

  /**
   * GET /api/v1/cortex/evolution/decision
   * Explain a specific decision made by the AI.
   */
  @Get('evolution/decision')
  @HttpCode(HttpStatus.OK)
  async evolutionExplainDecision(
    @Query('businessId') businessId: string,
    @Query('decisionId') decisionId?: string,
  ): Promise<{
    explanation: string;
    factors: Array<{ name: string; weight: number; value: unknown }>;
    confidence: number;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }
    if (!decisionId) {
      throw new BadRequestException('decisionId query parameter is required');
    }

    try {
      return await this.evolution.explainDecision(decisionId, businessId);
    } catch (err: any) {
      this.logger.error(`Evolution explain error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to explain decision');
    }
  }

  /* ================================================================== */
  /*  Helpers                                                           */
  /* ================================================================== */

  private generateCorrelationId(): string {
    return `kc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
