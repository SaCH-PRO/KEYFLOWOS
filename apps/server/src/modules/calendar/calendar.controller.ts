import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { appUrl } from '../../core/config/runtime-urls';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import {
  ModuleScopeGuard,
  RequireModuleScope,
} from '../../core/auth/module-scope.guard';
import {
  CALENDAR_EVENT_MODULES,
  CALENDAR_EVENT_STATUSES,
  CALENDAR_EVENT_TYPES,
  CALENDAR_SOURCE_TYPES,
  CalendarEventModule,
  CalendarEventStatus,
  CalendarEventType,
  CalendarSourceType,
} from '@keyflow/shared';
import {
  CalendarFilters,
  CalendarQueryService,
  ListResult,
} from './calendar-query.service';
import {
  CALENDAR_SYNC_EVENT_TYPES,
  CalendarSyncService,
  CalendarSyncSettings,
} from './calendar-sync.service';
import { CalendarConflictService } from './calendar-conflict.service';
import { CalendarInsightService } from './calendar-insight.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { GoogleCalendarTemporalSyncService } from './connectors/google-calendar-temporal-sync.service';

interface AuthedRequest {
  user?: { id?: string; role?: string };
}

@Controller('calendar')
export class CalendarController {
  private readonly logger = new Logger(CalendarController.name);

  constructor(
    @Inject(CalendarQueryService)
    private readonly query: CalendarQueryService,
    @Inject(CalendarSyncService)
    private readonly sync: CalendarSyncService,
    @Inject(CalendarConflictService)
    private readonly conflictService: CalendarConflictService,
    @Inject(CalendarInsightService)
    private readonly insightService: CalendarInsightService,
    @Inject(AiUsageService)
    private readonly aiUsage: AiUsageService,
    @Inject(GoogleCalendarTemporalSyncService)
    private readonly temporalSync: GoogleCalendarTemporalSyncService,
  ) {}

  // ----- Google Calendar sync (platform connection) ---------------------

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/sync/status')
  async syncStatus(@Param('businessId') businessId: string) {
    return this.sync.getStatus(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/sync/settings')
  async getSyncSettings(@Param('businessId') businessId: string) {
    return this.sync.getSettings(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Patch('businesses/:businessId/sync/settings')
  async patchSyncSettings(
    @Param('businessId') businessId: string,
    @Body() body: Partial<CalendarSyncSettings>,
  ) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body required');
    }
    const allowedKeys = new Set<string>([
      ...CALENDAR_SYNC_EVENT_TYPES,
      'pullExternal',
      'defaultVisibility',
      'calendarId',
      'syncDirection',
      'syncEnabled',
    ]);
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (allowedKeys.has(k)) {
        filtered[k] = v;
      }
    }
    return this.sync.patchSettings(
      businessId,
      filtered as Partial<CalendarSyncSettings> & {
        calendarId?: string | null;
        syncDirection?: string;
        syncEnabled?: boolean;
      },
    );
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('businesses/:businessId/sync/calendars')
  async listSyncCalendars(@Param('businessId') businessId: string) {
    return this.sync.listAvailableCalendars(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/sync/google/connect')
  syncConnect(@Param('businessId') businessId: string) {
    return { url: this.sync.getAuthUrl(businessId) };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/sync/google/disconnect')
  async syncDisconnect(@Param('businessId') businessId: string) {
    await this.sync.disconnect(businessId);
    return { success: true };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/sync/google/resync')
  async syncResync(@Param('businessId') businessId: string) {
    return this.sync.manualResync(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/sync/google/temporal-flow')
  async syncGoogleCalendarToTemporalFlow(@Param('businessId') businessId: string) {
    return this.temporalSync.syncBusiness(businessId);
  }

  /**
   * Platform-owned Google OAuth callback. Replaces the bookings-scoped one
   * so the connection lives under CalendarModule. The `state` param is
   * signed in CalendarSyncService.getAuthUrl and carries the businessId.
   */
  @Get('sync/google/callback')
  async syncOauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const frontendUrl = appUrl();
    const parsed = this.sync.verifyState(state);
    if (!parsed) {
      return res.redirect(
        `${frontendUrl}/app/key-connect?calendar=error&reason=invalid_state`,
      );
    }
    try {
      await this.sync.completeOAuth(parsed.businessId, code);
      return res.redirect(`${frontendUrl}/app/key-connect?calendar=success`);
    } catch {
      return res.redirect(`${frontendUrl}/app/key-connect?calendar=error`);
    }
  }

  // ----- Read -----------------------------------------------------------

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'read')
  @Get('businesses/:businessId/events')
  async list(
    @Param('businessId') businessId: string,
    @Req() req: AuthedRequest,
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('modules') modules?: string,
    @Query('types') types?: string,
    @Query('statuses') statuses?: string,
    @Query('contactId') contactId?: string,
    @Query('staffId') staffId?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('sourceType') sourceType?: string,
    @Query('sourceId') sourceId?: string,
    @Query('hasRevenue') hasRevenue?: string,
    @Query('synced') synced?: string,
    @Query('view') view?: string,
    @Query('includeTimeline') includeTimeline?: string,
    @Query('includeExternal') includeExternal?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<ListResult> {
    const userId = requireUser(req);
    const filters: CalendarFilters = {
      start: parseDate(start, 'start'),
      end: parseDate(end, 'end'),
      modules: parseEnumList(modules, CALENDAR_EVENT_MODULES, 'modules') as
        | CalendarEventModule[]
        | undefined,
      types: parseEnumList(types, CALENDAR_EVENT_TYPES, 'types') as
        | CalendarEventType[]
        | undefined,
      statuses: parseEnumList(
        statuses,
        CALENDAR_EVENT_STATUSES,
        'statuses',
      ) as CalendarEventStatus[] | undefined,
      contactId: contactId || undefined,
      staffId: staffId || undefined,
      assigneeId: assigneeId || undefined,
      sourceType: sourceType
        ? (parseEnumValue(sourceType, CALENDAR_SOURCE_TYPES, 'sourceType') as
            | CalendarSourceType
            | undefined)
        : undefined,
      sourceId: sourceId || undefined,
      hasRevenue: parseBool(hasRevenue),
      synced: parseBool(synced),
      view: view as CalendarFilters['view'],
      includeTimeline: parseBool(includeTimeline),
      includeExternal: parseBool(includeExternal),
      limit: parseLimit(limit),
      cursor: cursor || undefined,
    };

    return this.query.listEvents(businessId, userId, req.user?.role, filters);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'read')
  @Get('businesses/:businessId/agenda')
  async agenda(
    @Param('businessId') businessId: string,
    @Req() req: AuthedRequest,
    @Query('day') day?: string,
  ): Promise<ListResult> {
    if (!day) throw new BadRequestException('day is required');
    const userId = requireUser(req);
    return this.query.agenda(businessId, userId, req.user?.role, day);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'read')
  @Get('businesses/:businessId/conflicts')
  async conflicts(
    @Param('businessId') businessId: string,
    @Req() req: AuthedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = parseDate(from, 'from');
    const toDate = parseDate(to, 'to');
    if (!fromDate || !toDate) {
      throw new BadRequestException('from and to are required');
    }
    const userId = requireUser(req);
    return this.conflictService.detect(
      businessId,
      userId,
      req.user?.role,
      fromDate,
      toDate,
    );
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'read')
  @Get('businesses/:businessId/insights')
  async insights(
    @Param('businessId') businessId: string,
    @Req() req: AuthedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = parseDate(from, 'from');
    const toDate = parseDate(to, 'to');
    if (!fromDate || !toDate) {
      throw new BadRequestException('from and to are required');
    }
    const userId = requireUser(req);
    const [base, conflictResult] = await Promise.all([
      this.query.insights(businessId, userId, req.user?.role, fromDate, toDate),
      this.conflictService.detect(
        businessId,
        userId,
        req.user?.role,
        fromDate,
        toDate,
      ),
    ]);
    const hints = conflictResult.conflicts.slice(0, 8).map((c) => ({
      kind: c.kind,
      message: c.message,
    }));
    return { ...base, hints, conflicts: conflictResult.conflicts };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'read')
  @Get('businesses/:businessId/daily-plan')
  async dailyPlan(
    @Param('businessId') businessId: string,
    @Req() req: AuthedRequest,
    @Query('day') day?: string,
    @Query('refresh') refresh?: string,
  ) {
    const userId = requireUser(req);
    const target = day ? parseDate(day, 'day') : new Date();
    if (!target) throw new BadRequestException('day must be a valid date');
    return this.insightService.generateDailyPlan(
      businessId,
      userId,
      req.user?.role,
      target,
      { force: refresh === '1' || refresh === 'true' },
    );
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'read')
  @Get('businesses/:businessId/weekly-capacity')
  async weeklyCapacity(
    @Param('businessId') businessId: string,
    @Req() req: AuthedRequest,
    @Query('weekStart') weekStart?: string,
    @Query('refresh') refresh?: string,
  ) {
    const userId = requireUser(req);
    let start: Date;
    if (weekStart) {
      const parsed = parseDate(weekStart, 'weekStart');
      if (!parsed) throw new BadRequestException('weekStart must be valid');
      start = parsed;
    } else {
      const now = new Date();
      now.setUTCHours(0, 0, 0, 0);
      now.setUTCDate(now.getUTCDate() - now.getUTCDay());
      start = now;
    }
    return this.insightService.generateWeeklyCapacity(
      businessId,
      userId,
      req.user?.role,
      start,
      { force: refresh === '1' || refresh === 'true' },
    );
  }

  // ----- Write ----------------------------------------------------------

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Post('businesses/:businessId/events')
  async create(
    @Param('businessId') businessId: string,
    @Req() req: AuthedRequest,
    @Body()
    body: {
      title: string;
      description?: string | null;
      type: CalendarEventType;
      module?: CalendarEventModule;
      startAt: string;
      endAt?: string | null;
      allDay?: boolean;
      timezone?: string | null;
      priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
      visibility?: 'PRIVATE' | 'TEAM' | 'PUBLIC';
      color?: string | null;
      contactId?: string | null;
      assigneeId?: string | null;
      meta?: Record<string, unknown> | null;
    },
  ) {
    const userId = requireUser(req);
    if (!body?.title || !body.startAt || !body.type) {
      throw new BadRequestException('title, type, and startAt are required');
    }
    return this.query.createManualEvent(businessId, userId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Patch('businesses/:businessId/events/:eventId')
  async patch(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
    @Req() req: AuthedRequest,
    @Body()
    body: {
      startAt?: string;
      endAt?: string | null;
      status?: CalendarEventStatus;
      title?: string;
      description?: string | null;
    },
  ) {
    const userId = requireUser(req);
    return this.query.patchEvent(
      businessId,
      userId,
      req.user?.role,
      eventId,
      body ?? {},
    );
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Delete('businesses/:businessId/events/:eventId')
  async cancel(
    @Param('businessId') businessId: string,
    @Param('eventId') eventId: string,
    @Req() req: AuthedRequest,
  ) {
    const userId = requireUser(req);
    return this.query.cancelEvent(
      businessId,
      userId,
      req.user?.role,
      eventId,
    );
  }

  /* ---------- KEY Talk Pipeline ---------- */

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/key/interpret')
  async keyInterpretCalendar(
    @Param('businessId') businessId: string,
    @Req() req: AuthedRequest,
    @Body() body: { intent: string },
  ) {
    if (!body.intent?.trim()) {
      return { success: false, error: 'Intent is required' };
    }
    const userId = requireUser(req);
    try {
      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'key_calendar_interpret',
        {
          messages: [
            {
              role: 'system',
              content: `You are KEY, the AI calendar assistant for KeyFlowOS, a Caribbean business platform.

The user is describing a calendar or scheduling task in plain English. Your job is to:
1. Interpret what they REALLY want (read between the lines)
2. Determine the action type: CREATE_EVENT, FIND_TIME, CHECK_CONFLICTS, RESCHEDULE, or GET_AGENDA
3. Extract all relevant details: title, date, time, duration, attendees, priority, type
4. Provide confidence score and alternatives

Available event types: BOOKING, TASK, MILESTONE, REMINDER, MEETING, DEADLINE, FOLLOW_UP, CAMPAIGN_SEND, EXTERNAL_GOOGLE_EVENT
Available modules: BOOKINGS, CRM, PROJECTS, MARKETING, MANUAL
Available priorities: LOW, NORMAL, HIGH, URGENT

Return ONLY valid JSON in this exact format:
{
  "interpretation": "What the user wants in my own words",
  "actionType": "CREATE_EVENT",
  "recommendation": "Why this approach is best",
  "confidence": 0.92,
  "proposedEvent": {
    "title": "Event title",
    "type": "MEETING",
    "module": "MANUAL",
    "startAt": "2026-05-20T14:00:00Z",
    "endAt": "2026-05-20T15:00:00Z",
    "allDay": false,
    "priority": "NORMAL",
    "description": "Details",
    "color": "#4f46e5"
  },
  "alternatives": [
    {"label": "Brief label", "description": "Why this alternative"}
  ]
}`,
            },
            { role: 'user', content: body.intent },
          ],
          maxTokens: 1200,
          temperature: 0.3,
        },
      );
      const content = response.content?.trim() ?? '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { success: false, error: 'Could not parse AI interpretation' };
      }
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        success: true,
        interpretation: parsed.interpretation || '',
        actionType: parsed.actionType || 'CREATE_EVENT',
        recommendation: parsed.recommendation || '',
        confidence: parsed.confidence ?? 0,
        proposedEvent: parsed.proposedEvent || null,
        alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
      };
    } catch (err: any) {
      this.logger?.error?.('KEY calendar interpretation failed', err);
      return { success: false, error: err?.message || 'Interpretation failed' };
    }
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Post('businesses/:businessId/key/build')
  async keyBuildCalendar(
    @Param('businessId') businessId: string,
    @Req() req: AuthedRequest,
    @Body() body: { proposedEvent: any },
  ) {
    const userId = requireUser(req);
    try {
      const ev = body.proposedEvent;
      if (!ev?.title || !ev?.startAt) {
        return { success: false, error: 'proposedEvent with title and startAt is required' };
      }
      const row = await this.query.createManualEvent(businessId, userId, {
        title: ev.title,
        description: ev.description ?? null,
        type: ev.type || 'MEETING',
        module: ev.module || 'MANUAL',
        startAt: ev.startAt,
        endAt: ev.endAt ?? null,
        allDay: ev.allDay ?? false,
        priority: ev.priority || 'NORMAL',
        color: ev.color ?? null,
        meta: ev.meta ?? { keyGenerated: true },
      });
      return {
        success: true,
        eventId: row.id,
        event: row,
      };
    } catch (err: any) {
      this.logger?.error?.('KEY calendar build failed', err);
      return { success: false, error: err?.message || 'Build failed' };
    }
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('businesses/:businessId/key/execute')
  async keyExecuteCalendar(
    @Param('businessId') businessId: string,
    @Body() body: { eventId: string },
  ) {
    try {
      const event = await this.query.getEvent(businessId, body.eventId);
      if (!event) {
        return { success: false, error: 'Event not found' };
      }
      return {
        success: true,
        executed: true,
        event,
        proof: {
          createdAt: event.createdAt,
          sourceType: event.sourceType,
          status: event.status,
        },
      };
    } catch (err: any) {
      this.logger?.error?.('KEY calendar execution failed', err);
      return { success: false, error: err?.message || 'Execution failed' };
    }
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('bookings', 'write')
  @Post('businesses/:businessId/key/talk')
  async keyTalkCalendar(
    @Param('businessId') businessId: string,
    @Req() req: AuthedRequest,
    @Body() body: { intent: string; autoExecute?: boolean },
  ) {
    const interpretResult = await this.keyInterpretCalendar(businessId, req, { intent: body.intent });
    if (!interpretResult.success || !interpretResult.proposedEvent) {
      return interpretResult;
    }

    const buildResult = await this.keyBuildCalendar(businessId, req, { proposedEvent: interpretResult.proposedEvent });
    if (!buildResult.success) {
      return { ...interpretResult, buildError: buildResult.error };
    }

    let executionResult = null;
    if (body.autoExecute && buildResult.eventId) {
      executionResult = await this.keyExecuteCalendar(businessId, { eventId: buildResult.eventId });
    }

    return {
      success: true,
      interpretation: interpretResult.interpretation,
      recommendation: interpretResult.recommendation,
      confidence: interpretResult.confidence,
      event: buildResult.event,
      executionProof: executionResult,
    };
  }
}

function requireUser(req: AuthedRequest): string {
  const id = req.user?.id;
  if (!id) throw new BadRequestException('Authentication required');
  return id;
}

function parseDate(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Invalid date for ${name}`);
  }
  return d;
}

function parseEnumList<T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  name: string,
): T[number][] | undefined {
  if (!value) return undefined;
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (!allowed.includes(p as T[number])) {
      throw new BadRequestException(
        `Unsupported value "${p}" for ${name}. Allowed: ${allowed.join(', ')}`,
      );
    }
  }
  return parts as T[number][];
}

function parseEnumValue<T extends readonly string[]>(
  value: string,
  allowed: T,
  name: string,
): T[number] {
  if (!allowed.includes(value as T[number])) {
    throw new BadRequestException(
      `Unsupported value "${value}" for ${name}. Allowed: ${allowed.join(', ')}`,
    );
  }
  return value as T[number];
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException('limit must be a positive integer');
  }
  return Math.min(Math.floor(n), 1000);
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}
