import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
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
} from './calendar-query.service';
import {
  CALENDAR_SYNC_EVENT_TYPES,
  CalendarSyncService,
  CalendarSyncSettings,
} from './calendar-sync.service';

interface AuthedRequest {
  user?: { id?: string; role?: string };
}

@Controller('calendar')
export class CalendarController {
  constructor(
    @Inject(CalendarQueryService)
    private readonly query: CalendarQueryService,
    @Inject(CalendarSyncService)
    private readonly sync: CalendarSyncService,
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
        `${frontendUrl}/app/settings/connections?calendar=error&reason=invalid_state`,
      );
    }
    try {
      await this.sync.completeOAuth(parsed.businessId, code);
      return res.redirect(`${frontendUrl}/app/settings/connections?calendar=success`);
    } catch {
      return res.redirect(`${frontendUrl}/app/settings/connections?calendar=error`);
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
  ) {
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
  ) {
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
    return this.query.conflicts(
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
    return this.query.insights(
      businessId,
      userId,
      req.user?.role,
      fromDate,
      toDate,
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
