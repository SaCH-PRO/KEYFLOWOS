/**
 * KEY Cortex Controller
 * REST + SSE streaming API for the JARVIS-like AI system.
 *
 * Provides session management, chat (streaming & non-streaming),
 * voice synthesis/recognition, personality management, business
 * insights, profit opportunities, and action execution.
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

/* ------------------------------------------------------------------ */
/*  DTOs                                                               */
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
/*  Controller                                                         */
/* ------------------------------------------------------------------ */

@Controller('api/v1/cortex')
export class KeyCortexController {
  private readonly logger = new Logger(KeyCortexController.name);

  constructor(
    private readonly reasoning: KeyCortexReasoningService,
    private readonly conversation: KeyCortexConversationService,
    private readonly voice: KeyCortexVoiceService,
    private readonly personality: KeyCortexPersonalityService,
    private readonly actions: KeyCortexActionsService,
    private readonly context: KeyCortexContextService,
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
  /*  INSIGHTS                                                          */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/insights
   * Generate business insights based on the current business context.
   */
  @Post('insights')
  @HttpCode(HttpStatus.OK)
  async generateInsights(
    @Body() dto: InsightsQueryDto,
  ): Promise<{ insights: CortexInsight[] }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      const insights = await this.reasoning.generateInsights(
        dto.businessId,
        dto.query ?? '',
      );
      return { insights };
    } catch (err) {
      this.logger.error(`Insights error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to generate insights');
    }
  }

  /**
   * POST /api/v1/cortex/profit-opportunities
   * Find profit opportunities for the business.
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
}
