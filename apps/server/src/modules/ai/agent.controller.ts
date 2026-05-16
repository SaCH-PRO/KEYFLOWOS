import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { Request } from 'express';
import { AgentStateMachineService, type AgentStateSnapshot } from './agent-state-machine.service';
import { AgentBusService } from './agent-bus.service';
import { PatternDetectorService } from './pattern-detector.service';
import { UndoService } from './undo.service';
import { CalendarIntelligenceService } from './calendar-intelligence.service';
import { DocumentIntelligenceService } from './document-intelligence.service';
import { SemanticMemoryService } from './semantic-memory.service';
import { PrismaService } from '../../core/prisma/prisma.service';

interface AuthenticatedRequest extends Request {
  user?: { id: string; email?: string; role?: string };
}

@Controller('ai')
export class AgentController {
  constructor(
    @Inject(AgentStateMachineService) private readonly stateMachine: AgentStateMachineService,
    @Inject(AgentBusService) private readonly agentBus: AgentBusService,
    @Inject(PatternDetectorService) private readonly patternDetector: PatternDetectorService,
    @Inject(UndoService) private readonly undoService: UndoService,
    @Inject(CalendarIntelligenceService) private readonly calendarIntel: CalendarIntelligenceService,
    @Inject(DocumentIntelligenceService) private readonly docIntel: DocumentIntelligenceService,
    @Inject(SemanticMemoryService) private readonly semanticMemory: SemanticMemoryService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/agent/states')
  async getActiveAgentStates(@Param('businessId') businessId: string) {
    return this.stateMachine.getAllActiveSnapshots(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/agent/states/:planId')
  async getAgentState(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
  ) {
    const snapshot = await this.stateMachine.getSnapshot(planId);
    if (!snapshot || snapshot.businessId !== businessId) {
      return { error: 'Plan not found' };
    }
    return snapshot;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/agent/states/:planId/pause')
  async pausePlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) return { error: 'Authentication required' };
    const ok = await this.stateMachine.pausePlan(planId, userId);
    return { success: ok };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/agent/states/:planId/resume')
  async resumePlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) return { error: 'Authentication required' };
    const ok = await this.stateMachine.resumePlan(planId, userId);
    return { success: ok };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/agent/states/:planId/abort')
  async abortPlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) return { error: 'Authentication required' };
    const ok = await this.stateMachine.abortPlan(planId, userId);
    return { success: ok };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/agent/messages')
  async getAgentMessages(
    @Param('businessId') businessId: string,
    @Query('topic') topic?: string,
  ) {
    return this.agentBus.getPendingMessages(businessId, topic);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/agent/messages/:messageId/processed')
  async markMessageProcessed(
    @Param('businessId') businessId: string,
    @Param('messageId') messageId: string,
  ) {
    const count = await this.agentBus.markProcessed([messageId]);
    return { processed: count };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/agent/patterns')
  async getDetectedPatterns(@Param('businessId') businessId: string) {
    const memories = await this.prisma.client.aiMemory.findMany({
      where: { businessId, category: 'patterns' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return {
      patterns: memories.map((m) => ({
        id: m.id,
        ...JSON.parse(m.value),
        detectedAt: m.createdAt,
        confidence: m.confidence,
      })),
    };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/agent/patterns/scan')
  async triggerPatternScan(@Param('businessId') businessId: string) {
    const result = await this.patternDetector.scanBusiness(businessId);
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/agent/triggers')
  async getAgentTriggers(@Param('businessId') businessId: string) {
    return this.prisma.client.agentTrigger.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/agent/triggers')
  async createAgentTrigger(
    @Param('businessId') businessId: string,
    @Body() body: {
      name: string;
      eventPattern: string;
      condition?: Record<string, any>;
      objective: string;
      autoExecute?: boolean;
      maxRiskTier?: number;
    },
  ) {
    return this.prisma.client.agentTrigger.create({
      data: {
        businessId,
        name: body.name,
        eventPattern: body.eventPattern,
        condition: (body.condition ?? undefined) as any,
        objective: body.objective,
        autoExecute: body.autoExecute ?? false,
        maxRiskTier: body.maxRiskTier ?? 2,
      },
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Put('businesses/:businessId/agent/triggers/:triggerId')
  async updateAgentTrigger(
    @Param('businessId') businessId: string,
    @Param('triggerId') triggerId: string,
    @Body() body: Partial<{
      name: string;
      eventPattern: string;
      condition: Record<string, any> | null;
      objective: string;
      enabled: boolean;
      autoExecute: boolean;
      maxRiskTier: number;
    }>,
  ) {
    return this.prisma.client.agentTrigger.update({
      where: { id: triggerId, businessId },
      data: body as any,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/agent/calendar/availability')
  async checkCalendarAvailability(
    @Param('businessId') businessId: string,
    @Query('start') start: string,
    @Query('end') end: string,
    @Query('ignoreEventId') ignoreEventId?: string,
  ) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return { error: 'Invalid date format' };
    }
    return this.calendarIntel.checkAvailability(businessId, startDate, endDate, { ignoreEventId });
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/agent/calendar/slots')
  async findCalendarSlots(
    @Param('businessId') businessId: string,
    @Query('after') after: string,
    @Query('duration') duration: string,
    @Query('maxSlots') maxSlots?: string,
  ) {
    const afterDate = new Date(after);
    const durationMinutes = parseInt(duration, 10);
    if (isNaN(afterDate.getTime()) || isNaN(durationMinutes)) {
      return { error: 'Invalid parameters' };
    }
    return this.calendarIntel.findAlternativeSlots(
      businessId,
      afterDate,
      durationMinutes,
      'UTC',
      { daysAhead: 14, maxSlots: maxSlots ? parseInt(maxSlots, 10) : 5, businessHoursOnly: true },
    );
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/agent/undo')
  async getUndoableActions(@Param('businessId') businessId: string) {
    const actions = await this.undoService.getRecentActions(businessId);
    return {
      actions: actions.map((a) => ({
        id: a.id,
        actionType: a.actionType,
        entityType: a.entityType,
        entityId: a.entityId,
        createdAt: a.createdAt,
        canUndo: this.undoService.canUndo(a.id).canUndo,
      })),
    };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/agent/undo/:undoId')
  async undoAction(
    @Param('businessId') businessId: string,
    @Param('undoId') undoId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) return { error: 'Authentication required' };

    const check = this.undoService.canUndo(undoId);
    if (!check.canUndo) {
      return { success: false, message: check.reason };
    }

    const result = await this.undoService.undo(undoId, userId);
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/agent/documents/process')
  async processDocument(
    @Param('businessId') businessId: string,
    @Body() body: {
      filename: string;
      mimeType: string;
      base64Content?: string;
      url?: string;
    },
  ) {
    if (!body.base64Content && !body.url) {
      throw new BadRequestException('Either base64Content or url is required');
    }

    const result = await this.docIntel.extractFromDocument({
      businessId,
      source: 'upload',
      mimeType: body.mimeType,
      url: body.url,
      base64Content: body.base64Content,
      filename: body.filename,
    });

    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/agent/memory/backfill')
  async backfillSemanticMemory(@Param('businessId') businessId: string) {
    const count = await this.semanticMemory.backfillFromAiMemory(businessId);
    return { backfilled: count };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/agent/memory/search')
  async searchSemanticMemory(
    @Param('businessId') businessId: string,
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    if (!query) return { results: [] };
    const results = await this.semanticMemory.search({
      businessId,
      query,
      limit: limit ? parseInt(limit, 10) : 5,
    });
    return { results };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/agent/queue/stats')
  async getQueueStats(@Param('businessId') businessId: string) {
    const stats = await this.prisma.client.aiExecutionLog.groupBy({
      by: ['success'],
      where: {
        businessId,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      _count: { success: true },
    });
    return {
      today: {
        total: stats.reduce((sum, s) => sum + s._count.success, 0),
        success: stats.find((s) => s.success)?._count.success ?? 0,
        failed: stats.find((s) => !s.success)?._count.success ?? 0,
      },
    };
  }
}
