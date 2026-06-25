/**
 * KEY Cortex Controller
 *
 * The API surface for JARVIS. Exposes:
 * - POST /key-cortex/chat — Main conversation endpoint
 * - POST /key-cortex/stream — Streaming conversation
 * - POST /key-cortex/approve — Approve a pending action
 * - GET  /key-cortex/pending — Get pending approvals
 * - GET  /key-cortex/health — Health check
 * - POST /key-cortex/personality — Switch personality
 */

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { KeyCortexConversationService } from './key-cortex-conversation.service';
import { KeyCortexReasoningService } from './key-cortex-reasoning.service';
import { KeyCortexActionService } from './key-cortex-action.service';
import { GenomeContextAssembler } from './genome-context-assembler.service';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { interval } from 'rxjs';
import type {
  CortexChatRequest,
  CortexChatResponse,
  CortexPersonality,
  CortexStreamChunk,
  CortexHealthCheck,
  DEFAULT_CORTEX_CONFIG,
} from './key-cortex.types';

@Controller('key-cortex/businesses/:businessId')
@UseGuards(AuthGuard, BusinessGuard)
export class KeyCortexController {
  constructor(
    @Inject(KeyCortexConversationService) private readonly conversation: KeyCortexConversationService,
    @Inject(KeyCortexReasoningService) private readonly reasoning: KeyCortexReasoningService,
    @Inject(KeyCortexActionService) private readonly actionService: KeyCortexActionService,
    @Inject(GenomeContextAssembler) private readonly assembler: GenomeContextAssembler,
  ) {}

  /**
   * Main chat endpoint. Ask KEY anything about your business.
   *
   * POST /key-cortex/businesses/{id}/chat
   * Body: { "message": "What are my margins?", "personality": "SHARK" }
   */
  @Post('chat')
  async chat(
    @Param('businessId') businessId: string,
    @Body() body: CortexChatRequest,
    @Req() req: Request & { user?: { id?: string } },
  ): Promise<CortexChatResponse> {
    const userId = req.user?.id ?? 'unknown';
    const config = DEFAULT_CORTEX_CONFIG;

    // Get or create session
    const session = await this.conversation.getOrCreateSession(
      businessId,
      userId,
      body.sessionId,
      body.personality ?? config.personality,
    );

    // Update personality if requested
    if (body.personality && body.personality !== session.personality) {
      this.conversation.updatePersonality(session, body.personality);
    }

    // Add user message
    await this.conversation.addMessage(session, 'user', body.message);

    // Assemble genome context
    const genomeContext = await this.assembler.assemble(businessId, config);

    // Reason
    const reasoningResult = await this.reasoning.reason(session, body.message, {
      ...config,
      personality: session.personality,
    });

    // Execute any auto-approved actions
    const actionResults = await Promise.all(
      reasoningResult.actionsProposed.map(async (action) => {
        if (!action.requiresApproval) {
          return this.actionService.execute(businessId, action, genomeContext);
        }
        return null;
      }),
    );

    // Add assistant response
    const assistantMessage = await this.conversation.addMessage(
      session,
      'assistant',
      reasoningResult.response,
      {
        intent: reasoningResult.intent,
        confidence: reasoningResult.confidence,
        toolsUsed: reasoningResult.toolsCalled.map(t => t.toolName),
        provider: reasoningResult.provider,
        model: reasoningResult.model,
        latencyMs: reasoningResult.latencyMs,
        tokensUsed: reasoningResult.tokensUsed,
      },
    );

    return {
      message: assistantMessage,
      session,
      actions: reasoningResult.actionsProposed,
      evidence: reasoningResult.evidence,
      genomeSnapshot: genomeContext,
      suggestedFollowUps: reasoningResult.followUpQuestions,
    };
  }

  /**
   * Streaming chat endpoint for real-time responses.
   *
   * GET /key-cortex/businesses/{id}/stream?message=...
   */
  @Get('stream')
  async streamChat(
    @Param('businessId') businessId: string,
    @Query('message') message: string,
    @Query('sessionId') sessionId?: string,
    @Query('personality') personality?: string,
    @Req() req: Request & { user?: { id?: string } },
    @Res() res: Response,
  ): Promise<void> {
    const userId = req.user?.id ?? 'unknown';
    const config = DEFAULT_CORTEX_CONFIG;

    const session = await this.conversation.getOrCreateSession(
      businessId,
      userId,
      sessionId,
      (personality as CortexPersonality) ?? config.personality,
    );

    await this.conversation.addMessage(session, 'user', message);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = this.reasoning.streamReason(session, message, {
      ...config,
      personality: session.personality,
    });

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      if (chunk.type === 'DONE') break;
    }

    res.write('data: [DONE]\n\n');
    res.end();
  }

  /**
   * Approve or reject a pending action.
   *
   * POST /key-cortex/businesses/{id}/approve
   * Body: { "actionId": "...", "approve": true }
   */
  @Post('approve')
  async approveAction(
    @Param('businessId') _businessId: string,
    @Body() body: { actionId: string; approve: boolean },
    @Req() req: Request & { user?: { id?: string } },
  ) {
    const result = await this.actionService.approveAction(
      body.actionId,
      body.approve,
      req.user?.id,
    );
    return result;
  }

  /**
   * Get pending action approvals.
   *
   * GET /key-cortex/businesses/{id}/pending
   */
  @Get('pending')
  async getPendingApprovals(@Param('businessId') businessId: string) {
    return this.actionService.getPendingApprovals(businessId);
  }

  /**
   * Switch personality for the session.
   *
   * POST /key-cortex/businesses/{id}/personality
   * Body: { "personality": "SHARK" }
   */
  @Post('personality')
  async switchPersonality(
    @Param('businessId') businessId: string,
    @Body() body: { personality: CortexPersonality; sessionId?: string },
    @Req() req: Request & { user?: { id?: string } },
  ) {
    const session = await this.conversation.getOrCreateSession(
      businessId,
      req.user?.id ?? 'unknown',
      body.sessionId,
    );

    this.conversation.updatePersonality(session, body.personality);

    return {
      sessionId: session.id,
      personality: session.personality,
      message: `Personality switched to ${body.personality}. How can I help?`,
    };
  }

  /**
   * Health check for the cortex system.
   *
   * GET /key-cortex/businesses/{id}/health
   */
  @Get('health')
  async healthCheck(@Param('businessId') businessId: string): Promise<CortexHealthCheck> {
    const stats = this.conversation.getStats();

    // Check genome data freshness
    const financeSnapshot = await this.assembler.loadLatestFinanceSnapshot?.(businessId) ?? null;
    const now = Date.now();
    let genomeDataFreshness: 'FRESH' | 'STALE' | 'CRITICAL' = 'FRESH';

    if (financeSnapshot) {
      const age = now - new Date(financeSnapshot.computedAt).getTime();
      if (age > 7 * 24 * 60 * 60 * 1000) genomeDataFreshness = 'CRITICAL';
      else if (age > 24 * 60 * 60 * 1000) genomeDataFreshness = 'STALE';
    }

    return {
      cortexStatus: stats.activeSessions > 0 ? 'OPERATIONAL' : 'OPERATIONAL',
      genomeDataFreshness,
      primaryProvider: 'kimi',
      providerAvailable: !!process.env.KIMI_API_KEY,
      lastReasoningAt: stats.activeSessions > 0 ? new Date() : null,
      totalConversations: stats.activeSessions,
      avgLatencyMs: 0, // Would track historically
    };
  }

  /**
   * SSE endpoint for proactive alerts (morning brief, urgent alerts).
   *
   * GET /key-cortex/businesses/{id}/alerts
   */
  @Sse('alerts')
  alerts(@Param('businessId') businessId: string): Observable<any> {
    // Emit pending approvals every 30 seconds
    return interval(30000).pipe(
      map(() => {
        const pending = this.actionService.getPendingApprovals(businessId);
        return {
          type: 'pending_approvals',
          count: pending.length,
          items: pending,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
