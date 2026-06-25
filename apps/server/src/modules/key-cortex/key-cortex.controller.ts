/**
 * KEY Cortex Controller
 * REST + SSE streaming API for the JARVIS-like AI system.
 *
 * Provides session management, chat (streaming & non-streaming),
 * voice synthesis/recognition, personality management, business
 * insights, profit opportunities, and action execution.
 *
 * v2 — Integration Layer:
 *   Added command execution, module query, capabilities, full context,
 *   insights (revenue/churn/pipeline), monitors, alerts, batch execution,
 *   rollback, business reports, and AI recommendations.
 */

import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  Sse,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Observable, Subject } from 'rxjs';

import { KeyCortexReasoningService } from './key-cortex-reasoning.service';
import { KeyCortexConversationService } from './key-cortex-conversation.service';
import { KeyCortexVoiceService } from './key-cortex-voice.service';
import { KeyCortexPersonalityService } from './key-cortex-personality.service';
import { KeyCortexActionsService } from './key-cortex-actions.service';
import { KeyCortexContextService } from './key-cortex-context.service';

// ── v2 Integration Layer Services ──────────────────────────────────
import { KeyCortexConnectorService } from './key-cortex-connector.service';
import { KeyCortexCommandService } from './key-cortex-command.service';
import { KeyCortexExecutorService } from './key-cortex-executor.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { KeyCortexInsightService } from './key-cortex-insight.service';
import { KeyCortexMonitorV2Service } from './key-cortex-monitor-v2.service';

import {
  CortexQuery,
  CortexPersona,
  CortexVoice,
  CortexProvider,
  CortexStreamChunk,
  CortexResponse,
  CortexSession,
  CortexSessionStatus,
  CortexVoiceRequest,
  CortexSTTRequest,
  CortexInsight,
  CortexProfitOpportunity,
  CortexActionResult,
  CortexPersonalityConfig,
} from './key-cortex.types';

import {
  ModuleName,
  ConnectorCommand,
  ConnectorResult,
} from './key-cortex-connector.types';

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
  mood?: string;
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
  mood?: string;
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
  actionId: string;
  approved: boolean;
}

class InsightsQueryDto {
  businessId: string;
  query: string;
}

class ProfitOpportunitiesQueryDto {
  businessId: string;
  category?: 'automation' | 'upsell' | 'cost_reduction' | 'new_revenue' | 'retention';
}

/* ------------------------------------------------------------------ */
/*  DTOs  (v2 Integration Layer)                                       */
/* ------------------------------------------------------------------ */

/** Command execution — natural language or structured command */
class ExecuteCommandDto {
  /** Natural language command (e.g. "Create an invoice for John for $500") */
  command: string;
  businessId: string;
  userId: string;
  /** Optional structured override — bypasses NL parsing */
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
/*  Controller                                                         */
/* ------------------------------------------------------------------ */

@Controller('api/v1/cortex')
export class KeyCortexController {
  private readonly logger = new Logger(KeyCortexController.name);

  constructor(
    // ── Core (legacy) ──
    private readonly reasoning: KeyCortexReasoningService,
    private readonly conversation: KeyCortexConversationService,
    private readonly voice: KeyCortexVoiceService,
    private readonly personality: KeyCortexPersonalityService,
    private readonly actions: KeyCortexActionsService,
    private readonly context: KeyCortexContextService,

    // ── v2 Integration Layer ──
    private readonly connector: KeyCortexConnectorService,
    private readonly command: KeyCortexCommandService,
    private readonly executor: KeyCortexExecutorService,
    private readonly contextV2: KeyCortexContextV2Service,
    private readonly insight: KeyCortexInsightService,
    private readonly monitorV2: KeyCortexMonitorV2Service,
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
        },
      );

      // Build and attach initial context snapshot
      session.contextSnapshot =
        await this.context.buildContextSnapshot(dto.businessId);

      return session;
    } catch (err) {
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
    } catch (err) {
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
      return await this.conversation.updateSession(sessionId, dto);
    } catch (err) {
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
    } catch (err) {
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
   * Non-streaming chat — returns a complete CortexResponse.
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
      const response = await this.reasoning.processQuery(query);
      return response;
    } catch (err) {
      this.logger.error(`Chat error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Cortex reasoning engine unavailable');
    }
  }

  /**
   * POST /api/v1/cortex/chat/stream
   * SSE streaming chat — returns a reactive stream of CortexStreamChunks.
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
        const stream = this.reasoning.streamQuery(query);
        for await (const chunk of stream) {
          subject.next(chunk);
        }
        subject.complete();
      } catch (err) {
        this.logger.error(`Stream error: ${err.message}`, err.stack);
        subject.error(err);
      }
    })();

    return subject.asObservable();
  }

  /* ================================================================== */
  /*  VOICE                                                             */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/voice/speak
   * Text-to-Speech — synthesises audio and returns it as a binary buffer.
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
    } catch (err) {
      this.logger.error(`TTS error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Voice synthesis unavailable');
    }
  }

  /**
   * POST /api/v1/cortex/voice/listen
   * Speech-to-Text — accepts a multipart audio upload and returns transcript.
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
    } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
      this.logger.error(`List tools error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list available tools');
    }
  }

  /**
   * POST /api/v1/cortex/actions/approve
   * Approve (or reject) a pending action that requires user confirmation.
   */
  @Post('actions/approve')
  @HttpCode(HttpStatus.OK)
  async approveAction(
    @Body() dto: ApproveActionDto,
  ): Promise<{ result: CortexActionResult }> {
    if (!dto.sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    if (!dto.actionId) {
      throw new BadRequestException('actionId is required');
    }

    try {
      // Build a partial action result to pass to the approval flow
      const action: CortexActionResult = {
        actionType: 'EXECUTE_TOOL',
        status: dto.approved ? 'success' : 'error',
        description: dto.approved
          ? `Action ${dto.actionId} approved`
          : `Action ${dto.actionId} rejected`,
        requiresApproval: false,
      };

      const approved = await this.actions.requestApproval(action);

      const result: CortexActionResult = {
        ...action,
        status: approved ? 'success' : 'error',
        result: { approved, actionId: dto.actionId, sessionId: dto.sessionId },
      };

      return { result };
    } catch (err) {
      this.logger.error(`Action approval error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to process action approval');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v2 — COMMAND EXECUTION  (KEY Integration Layer)                   */
  /* ═══════════════════════════════════════════════════════════════════ */

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
          requireApproval: dto.requireApproval ?? false,
        });
        return result;
      }

      // Otherwise, parse natural language into structured commands
      const capabilities = this.connector.getAllCapabilities();
      const context = await this.contextV2.getFullContext(dto.businessId);

      const parsedIntents = await this.command.parseIntent(dto.command, {
        businessId: dto.businessId,
        userId: dto.userId,
        capabilities,
        context,
      });

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
        requireApproval: dto.requireApproval ?? topIntent.requiresApproval,
      });

      return {
        ...result,
        intent: topIntent.intent,
        confidence: topIntent.confidence,
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Execute error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Command execution failed');
    }
  }

  /**
   * POST /api/v1/cortex/query
   * Direct module query — no NL parsing, hits the module directly.
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
      const result = await this.connector.query(
        dto.module,
        dto.query,
        dto.parameters ?? {},
        dto.businessId,
      );
      return result;
    } catch (err) {
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
    } catch (err) {
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

      return { context, formatted };
    } catch (err) {
      this.logger.error(`Context error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to assemble business context');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v2 — INSIGHTS                                                     */
  /* ═══════════════════════════════════════════════════════════════════ */

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
      const insights = await this.insight.generateInsights(
        dto.businessId,
        dto.query ?? '',
        dto.modules,
      );

      return {
        insights,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
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
      return { opportunities };
    } catch (err) {
      this.logger.error(`Profit opportunities error: ${err.message}`, err.stack);
      // Fallback to legacy
      try {
        const opportunities = await this.reasoning.findProfitOpportunities(businessId);
        return { opportunities };
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
      return { analysis, period: period ?? 'last_30_days' };
    } catch (err) {
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
      return { risks, summary: { totalAtRisk: risks.length } };
    } catch (err) {
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
      return { pipeline };
    } catch (err) {
      this.logger.error(`Pipeline analysis error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to analyze pipeline');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v2 — MONITORS                                                     */
  /* ═══════════════════════════════════════════════════════════════════ */

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
        },
      );
      return monitor;
    } catch (err) {
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
      return { monitors };
    } catch (err) {
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
      return monitor;
    } catch (err) {
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
    } catch (err) {
      this.logger.error(`Toggle monitor error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to toggle monitor');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v2 — ALERTS                                                       */
  /* ═══════════════════════════════════════════════════════════════════ */

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
      return { alerts };
    } catch (err) {
      this.logger.error(`Alerts error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve alerts');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v2 — BATCH EXECUTION                                              */
  /* ═══════════════════════════════════════════════════════════════════ */

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
          });
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

      const results = await this.executor.executeBatch(connectorCommands, {
        stopOnError: dto.stopOnError ?? false,
        requireApproval: dto.requireApproval ?? false,
      });

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      return {
        results,
        summary: {
          total: results.length,
          succeeded,
          failed,
          executionTimeMs: Date.now() - start,
        },
      };
    } catch (err) {
      this.logger.error(`Batch execution error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Batch execution failed');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v2 — ROLLBACK                                                     */
  /* ═══════════════════════════════════════════════════════════════════ */

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
    } catch (err) {
      this.logger.error(`Rollback error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException(
        `Rollback failed: ${err.message}`,
      );
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v2 — BUSINESS REPORT                                              */
  /* ═══════════════════════════════════════════════════════════════════ */

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
      return report;
    } catch (err) {
      this.logger.error(`Business report error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to generate business report');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v2 — RECOMMENDATIONS                                              */
  /* ═══════════════════════════════════════════════════════════════════ */

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
        recommendations,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.error(`Recommendations error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to generate recommendations');
    }
  }

  /* ================================================================== */
  /*  v2 — PROFIT OPPORTUNITIES (legacy compat)                         */
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
    } catch (err) {
      this.logger.error(
        `Profit opportunities error: ${err.message}`,
        err.stack,
      );
      throw new ServiceUnavailableException(
        'Unable to find profit opportunities',
      );
    }
  }

  /* ================================================================== */
  /*  Helpers                                                           */
  /* ================================================================== */

  private generateCorrelationId(): string {
    return `kc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
