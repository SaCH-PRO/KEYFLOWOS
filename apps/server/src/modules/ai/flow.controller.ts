import { Body, Controller, Delete, Get, Inject, Param, Post, Res, UseGuards } from '@nestjs/common';
import { CrmRateLimit, CrmRateLimitGuard } from '../crm/guards/rate-limit.guard';
import { Response } from 'express';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { FlowOrchestratorService, FlowAttachment, FlowPageContext } from './flow-orchestrator.service';

@Controller('ai')
@UseGuards(CrmRateLimitGuard)
export class AiFlowController {
  constructor(
    @Inject(FlowOrchestratorService) private readonly flow: FlowOrchestratorService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Post('businesses/:businessId/flow/chat')
  async flowChat(
    @Param('businessId') businessId: string,
    @Body() body: {
      message: string;
      history?: any[];
      sessionId?: string;
      pageContext?: FlowPageContext;
      attachments?: FlowAttachment[];
      pendingConfirmation?: {
        toolCallId: string;
        confirmed: boolean;
        toolName?: string;
        toolArgs?: Record<string, any>;
      };
    },
  ) {
    const history = body.history || [];
    const result = await this.flow.chat(
      businessId,
      body.message,
      history,
      body.pendingConfirmation,
      body.pageContext,
      undefined,
      body.attachments,
      body.sessionId,
    );
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(120, 60_000)
  @Post('businesses/:businessId/flow/chat/stream')
  async flowChatStream(
    @Param('businessId') businessId: string,
    @Body() body: {
      message: string;
      history?: any[];
      pageContext?: FlowPageContext;
      attachments?: FlowAttachment[];
      sessionId?: string;
    },
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const history = body.history || [];

    try {
      const stream = this.flow.streamChat(businessId, body.message, history, body.pageContext, undefined, body.attachments, body.sessionId);

      for await (const chunk of stream) {
        if (res.destroyed) break;
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    } catch (error: any) {
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: (error as Error).message })}\n\n`);
      }
    } finally {
      if (!res.destroyed) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/flow/sessions')
  async listSessions(@Param('businessId') businessId: string) {
    return this.flow.listSessions(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/flow/sessions/:sessionId/clear')
  async clearSession(
    @Param('businessId') businessId: string,
    @Param('sessionId') sessionId: string,
  ) {
    await this.flow.clearSession(businessId, sessionId);
    return { success: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Delete('businesses/:businessId/flow/sessions/:sessionId')
  async deleteSession(
    @Param('businessId') businessId: string,
    @Param('sessionId') sessionId: string,
  ) {
    await this.flow.deleteSession(businessId, sessionId);
    return { success: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/flow/confirm')
  async confirmAction(
    @Param('businessId') businessId: string,
    @Body() body: {
      toolCallId: string;
      toolName: string;
      toolArgs: Record<string, any>;
      confirmed: boolean;
      message?: string;
    },
  ) {
    const result = await this.flow.chat(
      businessId,
      body.message || (body.confirmed ? 'Yes, proceed.' : 'No, cancel.'),
      [],
      {
        toolCallId: body.toolCallId,
        confirmed: body.confirmed,
        toolName: body.toolName,
        toolArgs: body.toolArgs,
      },
    );
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/flow/execute-plan/:planId')
  async executePlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
  ) {
    return this.flow.executePlan(businessId, planId);
  }
}
