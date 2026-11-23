import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, UseGuards, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { Request } from 'express';
import { AgentStateMachineService, type AgentStateSnapshot } from './agent-state-machine.service';
import { AgentBusService } from './agent-bus.service';
import { PatternDetectorService } from './pattern-detector.service';
import { UndoService } from './undo.service';
import { CalendarIntelligenceService } from './calendar-intelligence.service';
import { DocumentIntelligenceService } from './document-intelligence.service';
import { SemanticMemoryService } from './semantic-memory.service';
import { aiMemoryRowVisibleTo, readerSearchOptions } from './semantic-memory-sight';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmRateLimit, CrmRateLimitGuard } from '../crm/guards/rate-limit.guard';
import { createAgentTrigger, updateAgentTrigger } from './agent-trigger.service';
import { readersModuleSight, readsDocumentExtractions } from '../key-cortex/key-cortex-prompt-context.service';

interface AuthenticatedRequest extends Request {
  user?: { id: string; email?: string; role?: string };
}

/** W5-AGENT-TRIGGERS-AUTHORITY (D-73): the authenticated member who writes an agent trigger. */
function triggerWriter(req: AuthenticatedRequest): string {
  const id = req.user?.id;
  if (!id) throw new UnauthorizedException('Authentication required');
  return id;
}

/** MEM-SEMANTIC-SIGHT: the most hits GET .../agent/memory/search answers (as a reader's timeline read, MAX_READER_LIMIT). */
const MAX_SEARCH_LIMIT = 500;
/** MEM-SEMANTIC-SIGHT: the longest query GET .../agent/memory/search embeds. */
const MAX_SEARCH_QUERY = 500;

/** FU-PATTERNS-ROUTES-SIGHT: how many patterns GET .../agent/patterns answers, and how many rows it reads at a time. */
const PATTERNS_SHOWN = 50;
const PATTERNS_PAGE = 200;
/**
 * Review round 2 (security F-1): how far back a reader who may not read every pattern reads. Round 1 bounded the rows a
 * request read (2,000), but that bound counted withheld rows, so whether a visible pattern was answered told the reader
 * how many money patterns were newer. A fixed window bounds the read by time instead: what such a reader is answered
 * depends only on the rows they may read in it. (The table grows because PatternDetectorService stores every
 * detection under a new key: a follow-up, outside this route.)
 */
const PATTERNS_WINDOW_DAYS = 30;

/** Whether a reader may read every pattern, whatever it states: a member with revenue and expenses read. */
function readsEveryPattern(who: { reader: string | null; sight: (module: any) => boolean }): boolean {
  return who.reader !== null && readsDocumentExtractions(who.sight, who.reader) && who.sight('expenses');
}

/** A stored pattern's fields: a JSON object's own (PatternDetectorService), else the text as its description. */
function patternFieldsOf(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Plain text (summarizePatterns, the delegation loop).
  }
  return { description: value };
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

  /** SWEEP-P0-FOLLOWUP (staffkeyplans): 404 unless the plan is this business's. */
  private async assertOwnPlan(businessId: string, planId: string): Promise<void> {
    const plan = await this.prisma.client.aiPlan.findFirst({ where: { id: planId, businessId }, select: { id: true } });
    if (!plan) throw new NotFoundException('Plan not found');
  }

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

  /**
   * SWEEP-P0-FOLLOWUP, staffkeyplans ruling (recommended option; REST scope census owner question 5): pausing,
   * resuming or aborting a KEY plan needs ai write (owners and admins by role default; STAFF only when given KEY
   * access). They checked membership only. And a plan is controlled only through its own business: the routes
   * took any plan id, so a member of one business paused or aborted another business's plan (assertOwnPlan, 404).
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('ai', 'write')
  @Post('businesses/:businessId/agent/states/:planId/pause')
  async pausePlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) return { error: 'Authentication required' };
    await this.assertOwnPlan(businessId, planId);
    const ok = await this.stateMachine.pausePlan(planId, userId);
    return { success: ok };
  }

  // SWEEP-P0-FOLLOWUP (staffkeyplans): ai write, and the plan of this business only; see pausePlan.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('ai', 'write')
  @Post('businesses/:businessId/agent/states/:planId/resume')
  async resumePlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) return { error: 'Authentication required' };
    await this.assertOwnPlan(businessId, planId);
    const ok = await this.stateMachine.resumePlan(planId, userId);
    return { success: ok };
  }

  // SWEEP-P0-FOLLOWUP (staffkeyplans): ai write, and the plan of this business only; see pausePlan.
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('ai', 'write')
  @Post('businesses/:businessId/agent/states/:planId/abort')
  async abortPlan(
    @Param('businessId') businessId: string,
    @Param('planId') planId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) return { error: 'Authentication required' };
    await this.assertOwnPlan(businessId, planId);
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

  /**
   * FU-PATTERNS-ROUTES-SIGHT (D-100, D-234, D-146): the newest PATTERNS_SHOWN patterns the caller may read: each row by
   * aiMemoryRowVisibleTo for the caller and their membership's module sight (a pattern stating money only with revenue
   * read, one stating an expense only with expenses read; a SUPER_ADMIN who is no member has no module). Rows are read
   * in pages until PATTERNS_SHOWN are kept, so a withheld pattern takes no place: a reader's patterns are the same
   * whatever money patterns are newer. A pattern stored as plain text (summarizePatterns' "Peak activity hour: 9AM")
   * is answered as its description, where JSON.parse used to answer 500.
   * Review round 1 (security F-1/F-4, correctness COR-FUPRS-1/2): keyset pages on (createdAt, id), so a pattern written
   * between two pages neither repeats nor drops a row. Review round 2 (security F-1): bounded by PATTERNS_WINDOW_DAYS,
   * not by a row count, for a reader who may not read every pattern; the owner's one read is unchanged.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/agent/patterns')
  async getDetectedPatterns(@Param('businessId') businessId: string, @Req() req?: AuthenticatedRequest) {
    const who = await this.memoryReaderOf(businessId, req, 'agentPatterns');
    const select = { id: true, category: true, key: true, value: true, createdAt: true, confidence: true } as const;
    const orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
    type PatternRow = { id: string; key: string; value: string; category: string; createdAt: Date; confidence: number };
    const kept: PatternRow[] = [];
    if (readsEveryPattern(who)) {
      // Review round 2 (COR-R2-2): a reader who may read every pattern (revenue and expenses read: the owner) reads the
      // newest PATTERNS_SHOWN in one read, as before.
      const rows: PatternRow[] = await this.prisma.client.aiMemory.findMany({ where: { businessId, category: 'patterns' }, orderBy, take: PATTERNS_SHOWN, select });
      kept.push(...rows.filter((row) => aiMemoryRowVisibleTo(row, who)));
    } else {
      const since = new Date(Date.now() - PATTERNS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      let after: { createdAt: Date; id: string } | null = null;
      while (kept.length < PATTERNS_SHOWN) {
        const page: PatternRow[] = await this.prisma.client.aiMemory.findMany({
          where: {
            businessId,
            category: 'patterns',
            createdAt: { gte: since },
            ...(after ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] } : {}),
          },
          orderBy,
          take: PATTERNS_PAGE,
          select,
        });
        for (const row of page) {
          if (kept.length < PATTERNS_SHOWN && aiMemoryRowVisibleTo(row, who)) kept.push(row);
        }
        if (page.length < PATTERNS_PAGE) break;
        const last = page[page.length - 1];
        after = { createdAt: last.createdAt, id: last.id };
      }
    }

    return {
      patterns: kept.map((m) => ({
        id: m.id,
        ...patternFieldsOf(m.value),
        detectedAt: m.createdAt,
        confidence: m.confidence,
      })),
    };
  }

  /**
   * FU-PATTERNS-ROUTES-SIGHT review round 1 (security O-1; D-100, D-234): the scan stores every pattern it finds (the
   * owner reads them all on GET .../agent/patterns) and answers the caller only those they may read, by the rule GET
   * reads the stored row by (aiMemoryRowVisibleTo over the row PatternDetectorService stores: key
   * `pattern_<category>_...`, the pattern as JSON). entitiesScanned counts the invoices read (sales volume, D-234), so
   * only a member with revenue read is told it.
   */
  // Review round 2 (security O-2): each scan stores a row per pattern found; rate limited as summarize-patterns is.
  @UseGuards(AuthGuard, BusinessGuard, CrmRateLimitGuard)
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/agent/patterns/scan')
  async triggerPatternScan(@Param('businessId') businessId: string, @Req() req?: AuthenticatedRequest) {
    const who = await this.memoryReaderOf(businessId, req, 'agentPatternScan');
    const result = await this.patternDetector.scanBusiness(businessId);
    const patterns = result.patterns.filter((pattern) =>
      aiMemoryRowVisibleTo({ category: 'patterns', key: `pattern_${pattern.category}`, value: JSON.stringify(pattern) }, who),
    );
    return readsDocumentExtractions(who.sight, who.reader) ? { ...result, patterns } : { patterns, scanDurationMs: result.scanDurationMs };
  }

  /** FU-PATTERNS-ROUTES-SIGHT: the caller and their membership's module sight (a SUPER_ADMIN who is no member: none). */
  private async memoryReaderOf(businessId: string, req: AuthenticatedRequest | undefined, logTag: string) {
    const reader = req?.user?.id ?? null;
    return { reader, sight: await readersModuleSight(this.prisma, businessId, reader, undefined, logTag) };
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
    @Req() req: AuthenticatedRequest,
  ) {
    // W5-AGENT-TRIGGERS-AUTHORITY (D-73, D-93; CV-08m): the rule records the member who created it,
    // and its plans run as them; a member's word-for-word copy of a default rule is theirs, not the system's.
    return createAgentTrigger(this.prisma, businessId, triggerWriter(req), body);
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
      schedule: string | null;
    }>,
    @Req() req: AuthenticatedRequest,
  ) {
    // W5-AGENT-TRIGGERS-AUTHORITY (D-93, D-73; CV-08m; review SEC-W5AT-1..3, CR-W5AT-1): only the
    // business owner switches on, switches off or edits a default rule that runs as the owner (403
    // AGENT_TRIGGER_OWNER_ONLY), schedules a rule or changes a scheduled one (403
    // AGENT_TRIGGER_SCHEDULE_OWNER_ONLY); a rule a member created is theirs and the owner's to write (403
    // AGENT_TRIGGER_CREATOR_ONLY) and keeps its creator, whoever writes it. Only the member-writable
    // fields of the body are written.
    return updateAgentTrigger(this.prisma, businessId, triggerId, triggerWriter(req), body);
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

  /**
   * V1-42b-UNDO-TENANT-SCOPE review SEC-V42B-3: only the actions req.user may
   * undo, by the rule POST agent/undo/:undoId applies (UndoService
   * getUndoableActionsFor): no entity ids of a module below write, of a
   * contact they cannot see, or of a type no one may undo.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/agent/undo')
  async getUndoableActions(@Param('businessId') businessId: string, @Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    if (!userId) return { error: 'Authentication required' };
    const actions = await this.undoService.getUndoableActionsFor(businessId, userId);
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

  /**
   * V1-42b-UNDO-TENANT-SCOPE (SEC-V42-1): the undo id is the client's; the
   * service resolves it only inside the guarded business (404 otherwise, the
   * same as an unknown id) and requires req.user to hold write on the module of
   * what is undone. No canUndo pre-check here: it read the record before the
   * tenant check and told another business's id apart from an unknown one.
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/agent/undo/:undoId')
  async undoAction(
    @Param('businessId') businessId: string,
    @Param('undoId') undoId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) return { error: 'Authentication required' };

    const result = await this.undoService.undo(undoId, userId, businessId);
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

  /**
   * MEM-SEMANTIC-SIGHT: the backfill copies every AiMemory row of the business (document extractions included) into the
   * semantic store, through the embedding provider, on the business's AI credits: a business-wide AI setting, so it
   * needs settings admin (owners and admins by role defaults), as the connectors' backfills and PUT .../ai/preferences
   * do. It ran for any member.
   */
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('settings', 'admin')
  @Post('businesses/:businessId/agent/memory/backfill')
  async backfillSemanticMemory(@Param('businessId') businessId: string) {
    const count = await this.semanticMemory.backfillFromAiMemory(businessId);
    return { backfilled: count };
  }

  /**
   * MEM-SEMANTIC-SIGHT (D-234, D-257): the caller's hits only, by each hit's source (semanticHitsVisibleTo): the reader
   * is the caller, with their membership's module sight (readersModuleSight: a SUPER_ADMIN who is no member has none).
   * Withheld hits are dropped before the limit is cut. The limit is at most MAX_SEARCH_LIMIT (default 5).
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/agent/memory/search')
  async searchSemanticMemory(
    @Param('businessId') businessId: string,
    @Query('q') query: string,
    @Query('limit') limit?: string,
    @Req() req?: AuthenticatedRequest,
  ) {
    if (!query) return { results: [] };
    // MEM-SEMANTIC-SIGHT acceptance review: a bounded query (every search costs an embedding of it), and one string (a
    // repeated or bracketed q parses to an array, whose length counts its items).
    if (typeof query !== 'string') throw new BadRequestException('q must be one string');
    if (query.length > MAX_SEARCH_QUERY) throw new BadRequestException(`q must be at most ${MAX_SEARCH_QUERY} characters`);
    // MEM-DOC-EXTRACTION-SIGHT (D-234; orchestrator review COR-MDX-1): the copies of document extractions only for a
    // member with revenue read (readersModuleSight, the rule KEY's prompts read them by); the search leaves them out
    // before its limit for anyone else. MEM-SEMANTIC-SIGHT: and every other hit only as its source allows
    // (readerSearchOptions), filtered before the limit; the limit is at most MAX_SEARCH_LIMIT.
    const reader = req?.user?.id ?? null;
    const sight = await readersModuleSight(this.prisma, businessId, reader, undefined, 'memorySearch');
    const asked = limit ? parseInt(limit, 10) : 5;
    const results = await this.semanticMemory.search({
      businessId,
      query,
      limit: Number.isFinite(asked) ? Math.min(Math.max(asked, 0), MAX_SEARCH_LIMIT) : 5,
      ...readerSearchOptions(this.prisma, businessId, { reader, sight }),
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
