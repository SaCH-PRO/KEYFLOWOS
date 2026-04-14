import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { FlowOrchestratorService } from './flow-orchestrator.service';

@Controller('ai')
export class FlowController {
  constructor(
    @Inject(FlowOrchestratorService) private readonly flow: FlowOrchestratorService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/flow/chat')
  async flowChat(
    @Param('businessId') businessId: string,
    @Body() body: {
      message: string;
      history?: any[];
      sessionId?: string;
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
    );
    return result;
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
