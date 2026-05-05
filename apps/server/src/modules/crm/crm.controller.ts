import { BadRequestException, Body, Controller, Delete, Get, HttpException, Inject, Param, Patch, Post, Put, Query, Req, Res, Sse, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { CrmActionsService } from './crm-actions.service';
import { CrmCommunicationService, type ConversationChannel, type ConversationDirection } from './crm-communication.service';
import { ConversationAiService } from './conversation-ai.service';
import { CrmFlowService } from './crm-flow.service';
import { CrmImportService } from './crm-import.service';
import { CrmJourneyService } from './crm-journey.service';
import { CrmPlaybookService } from './crm-playbook.service';
import { CrmRevenueService } from './crm-revenue.service';
import { CrmRelationshipHealthService } from './crm-relationship-health.service';
import { CrmStatsService } from './crm-stats.service';
import { CrmDuplicateDetectionService } from './crm-duplicate-detection.service';
import { CrmTimelineService } from './crm-timeline.service';
import { CrmService } from './crm.service';
import { CrmSavedViewsService } from './crm-saved-views.service';
import {
  CONTACT_RELATIONSHIP_HEALTH_VALUES,
  ContactRelationshipHealth,
  RelationshipHealthThresholds,
} from '@keyflow/shared';
import { BestChannelService } from './best-channel.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { TeamAuditInterceptor, AuditAction } from '../../core/interceptors/team-audit.interceptor';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { LogContactEventDto } from './dto/log-contact-event.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { CrmRateLimitGuard, CrmRateLimit } from './guards/rate-limit.guard';
import { PlanLimitGuard, RequirePlanLimit } from '../subscriptions/plan-limit.guard';
import { FeatureFlagGuard, RequireFeature } from './guards/feature-flag.guard';
import { checkAiRateLimit } from './ai-rate-limit.util';
import { memoryStorage } from 'multer';
import type { Express } from 'express';

@Controller('crm')
@UseGuards(CrmRateLimitGuard)
export class CrmController {
  constructor(
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
    @Inject(CrmStatsService) private readonly crmStats: CrmStatsService,
    @Inject(CrmImportService) private readonly crmImport: CrmImportService,
    @Inject(CrmPlaybookService) private readonly playbook: CrmPlaybookService,
    @Inject(CrmFlowService) private readonly flow: CrmFlowService,
    @Inject(CrmActionsService) private readonly actions: CrmActionsService,
    @Inject(CrmRevenueService) private readonly revenue: CrmRevenueService,
    @Inject(CrmJourneyService) private readonly journey: CrmJourneyService,
    @Inject(CrmDuplicateDetectionService) private readonly duplicates: CrmDuplicateDetectionService,
    @Inject(CrmSavedViewsService) private readonly savedViews: CrmSavedViewsService,
    @Inject(CrmRelationshipHealthService) private readonly relationshipHealth: CrmRelationshipHealthService,
    @Inject(CrmCommunicationService) private readonly communication: CrmCommunicationService,
    @Inject(BestChannelService) private readonly bestChannel: BestChannelService,
    @Inject(ConversationAiService) private readonly conversationAi: ConversationAiService,
  ) {}

  @Get('health')
  async healthCheck() {
    const start = Date.now();
    let dbOk = false;
    try {
      await this.crm.healthPing();
      dbOk = true;
    } catch {}
    const cacheMetrics = this.crmStats.getCacheMetrics();
    const duration = Date.now() - start;
    return {
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk,
      cache: cacheMetrics,
      uptime: Math.round(process.uptime()),
      responseMs: duration,
    };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts')
  listContacts(
    @Param('businessId') businessId: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('hasUnpaidInvoices') hasUnpaidInvoices?: string,
    @Query('hasUpcomingBookings') hasUpcomingBookings?: string,
    @Query('hasOpenDeals') hasOpenDeals?: string,
    @Query('dealStageIds') dealStageIds?: string | string[],
    @Query('staleDays') staleDays?: string,
    @Query('newThisWeek') newThisWeek?: string,
    @Query('tags') tags?: string | string[],
    @Query('ageGroups') ageGroups?: string | string[],
    @Query('relationshipTypes') relationshipTypes?: string | string[],
    @Query('priorities') priorities?: string | string[],
    @Query('relationshipHealth') relationshipHealth?: string | string[],
    @Query('pipelineStages') pipelineStages?: string | string[],
    @Query('bestChannels') bestChannels?: string | string[],
    @Query('bestTimeNow') bestTimeNow?: string,
    @Query('favorite') favorite?: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('cursor') cursor?: string,
    @Query('includeStats') includeStats?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    const validSortBy = ['name', 'newest', 'oldest', 'revenue', 'score', 'lastInteraction'];
    const validSortOrder = ['asc', 'desc'];
    const toArr = (v?: string | string[]) => (Array.isArray(v) ? v : v ? [v] : undefined);
    const wantBestTimeNow = bestTimeNow === 'true';
    return (async () => {
      const bestTimeNowIds = wantBestTimeNow
        ? await this.bestChannel.findContactsBestTimeNow(businessId).catch(() => [])
        : undefined;
      return this.crm.listContacts({
      businessId,
      status,
      search,
      hasUnpaidInvoices: hasUnpaidInvoices === 'true',
      hasUpcomingBookings: hasUpcomingBookings === 'true',
      hasOpenDeals: hasOpenDeals === 'true',
      dealStageIds: toArr(dealStageIds),
      staleDays: staleDays ? Number(staleDays) : undefined,
      newThisWeek: newThisWeek === 'true',
      tags: toArr(tags),
      ageGroups: toArr(ageGroups),
      relationshipTypes: toArr(relationshipTypes),
      priorities: toArr(priorities),
      relationshipHealth: toArr(relationshipHealth),
      pipelineStages: toArr(pipelineStages),
      bestChannels: toArr(bestChannels),
      bestTimeNow: wantBestTimeNow,
      bestTimeNowIds,
      favorite: favorite === 'true' ? true : favorite === 'false' ? false : undefined,
      includeArchived: includeArchived === 'true',
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
      cursor: cursor || undefined,
      includeStats: includeStats === 'true',
      sortBy: sortBy && validSortBy.includes(sortBy) ? sortBy as any : undefined,
      sortOrder: sortOrder && validSortOrder.includes(sortOrder) ? sortOrder as 'asc' | 'desc' : undefined,
    });
    })();
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/best-channel')
  bestChannelExplain(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.bestChannel.explain(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, PlanLimitGuard)
  @RequireModuleScope('crm', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('crm', 'contact_created', 'contact')
  @CrmRateLimit(30, 60_000)
  @RequirePlanLimit('contacts')
  @Post('businesses/:businessId/contacts')
  createContact(
    @Param('businessId') businessId: string,
    @Body() body: CreateContactDto,
  ) {
    return this.crm.createContact({ businessId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/poll')
  getContactsPollState(@Param('businessId') businessId: string) {
    return this.crmStats.getContactsPollState(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/favorites')
  getFavorites(@Param('businessId') businessId: string) {
    return this.crmStats.getFavorites(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId')
  getContactDetail(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.crmStats.contactDetail({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('crm', 'contact_updated', 'contact')
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/contacts/:contactId')
  updateContact(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: UpdateContactDto,
  ) {
    return this.crm.updateContact({
      businessId,
      contactId,
      ...body,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(10, 60_000)
  @Patch('businesses/:businessId/contacts/bulk')
  bulkUpdateContacts(
    @Param('businessId') businessId: string,
    @Body() body: {
      contactIds: string[];
      status?: string;
      addTags?: string[];
      relationshipType?: string | null;
      priority?: string | null;
      favorite?: boolean;
      archived?: boolean;
    },
  ) {
    if (!Array.isArray(body.contactIds) || body.contactIds.length > 100) {
      throw new HttpException('contactIds must be an array of at most 100 items', 400);
    }
    return this.crm.bulkUpdateContacts({
      businessId,
      contactIds: body.contactIds,
      status: body.status,
      addTags: body.addTags,
      relationshipType: body.relationshipType,
      priority: body.priority,
      favorite: body.favorite,
      archived: body.archived,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(10, 60_000)
  @Delete('businesses/:businessId/contacts/bulk')
  bulkDeleteContacts(
    @Param('businessId') businessId: string,
    @Body() body: { contactIds: string[] },
  ) {
    if (!Array.isArray(body.contactIds) || body.contactIds.length > 100) {
      throw new HttpException('contactIds must be an array of at most 100 items', 400);
    }
    return this.crm.bulkDeleteContacts({ businessId, contactIds: body.contactIds });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('crm', 'contact_deleted', 'contact')
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/contacts/:contactId')
  softDeleteContact(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.crm.softDeleteContact({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/merge/:duplicateId')
  mergeContact(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Param('duplicateId') duplicateId: string,
    @Body() body: { fieldOverrides?: Record<string, unknown> } | undefined,
    @Req() req: any,
  ) {
    return this.crm.mergeContacts({
      businessId,
      primaryId: contactId,
      duplicateId,
      fieldOverrides: body?.fieldOverrides,
      actorId: req?.user?.id,
      actorType: req?.user?.id ? 'USER' : 'SYSTEM',
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/duplicates/preview/:primaryId/:duplicateId')
  async previewMerge(
    @Param('businessId') businessId: string,
    @Param('primaryId') primaryId: string,
    @Param('duplicateId') duplicateId: string,
  ) {
    if (primaryId === duplicateId) throw new BadRequestException('primaryId and duplicateId must differ');
    const preview = await this.duplicates.preview({ businessId, primaryId, duplicateId });
    if (!preview) throw new HttpException('Contact pair not found', 404);
    return preview;
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/duplicates/merges/:mergeId/revert')
  revertMerge(
    @Param('businessId') businessId: string,
    @Param('mergeId') mergeId: string,
    @Req() req: any,
  ) {
    return this.crm.revertMerge({
      businessId,
      mergeId,
      actorId: req?.user?.id,
      actorType: req?.user?.id ? 'USER' : 'SYSTEM',
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/notes')
  addNote(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: CreateNoteDto,
    @Req() req: any,
  ) {
    return this.timeline.addNote({
      businessId,
      contactId,
      body: body.body,
      authorId: req?.user?.id,
      source: body.source || 'crm',
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contact-stats')
  getContactStats(@Param('businessId') businessId: string) {
    return this.crmStats.getContactStats(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/segments')
  segmentSummary(@Param('businessId') businessId: string) {
    return this.crmStats.segmentSummary({ businessId });
  }

  // -- Relationship-health (auto-warn) ----------------------------------

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/relationship-health/settings')
  async getRelationshipHealthSettings(@Param('businessId') businessId: string) {
    const thresholds = await this.relationshipHealth.getThresholdsFor(businessId);
    return { thresholds };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(20, 60_000)
  @Patch('businesses/:businessId/relationship-health/settings')
  async updateRelationshipHealthSettings(
    @Param('businessId') businessId: string,
    @Body() body: Partial<RelationshipHealthThresholds> | { reset?: boolean },
  ) {
    if ((body as { reset?: boolean })?.reset) {
      const thresholds = await this.relationshipHealth.setThresholdsFor(businessId, null);
      return { thresholds };
    }
    const thresholds = await this.relationshipHealth.setThresholdsFor(
      businessId,
      body as Partial<RelationshipHealthThresholds>,
    );
    return { thresholds };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/relationship-health/at-risk')
  listAtRisk(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.relationshipHealth.listAtRisk(businessId, {
      limit: limit ? Number(limit) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/relationship-health/recompute')
  recomputeRelationshipHealth(
    @Param('businessId') businessId: string,
    @Body() body?: { dryRun?: boolean },
    @Req() req?: any,
  ) {
    return this.relationshipHealth.recomputeForBusiness(businessId, {
      dryRun: !!body?.dryRun,
      actorId: req?.user?.id,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(60, 60_000)
  @Put('businesses/:businessId/contacts/:contactId/relationship-health')
  setRelationshipHealthOverride(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { value: ContactRelationshipHealth | null },
    @Req() req: any,
  ) {
    if (
      body?.value !== null &&
      !(CONTACT_RELATIONSHIP_HEALTH_VALUES as readonly string[]).includes(body?.value as string)
    ) {
      throw new BadRequestException('Invalid relationship health value');
    }
    return this.relationshipHealth.setManualOverride({
      businessId,
      contactId,
      value: body.value,
      actorId: req?.user?.id ?? null,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(60, 60_000)
  @Delete('businesses/:businessId/contacts/:contactId/relationship-health')
  clearRelationshipHealthOverride(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: any,
  ) {
    return this.relationshipHealth.setManualOverride({
      businessId,
      contactId,
      value: null,
      actorId: req?.user?.id ?? null,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/highlights')
  flowHighlights(@Param('businessId') businessId: string) {
    return this.crmStats.flowHighlights({ businessId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/tasks/due')
  dueTasks(
    @Param('businessId') businessId: string,
    @Query('windowDays') windowDays?: string,
  ) {
    return this.timeline.dueTasks({
      businessId,
      windowDays: windowDays ? Number(windowDays) : 7,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/tasks')
  addTask(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: CreateTaskDto,
    @Req() req: any,
  ) {
    return this.timeline.addTask({
      businessId,
      contactId,
      title: body.title,
      dueDate: body.dueDate,
      priority: body.priority,
      assigneeId: body.assigneeId,
      remindAt: body.remindAt,
      creatorId: req?.user?.id,
      source: body.source || 'crm',
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contact-next-actions')
  listContactNextActions(
    @Param('businessId') businessId: string,
    @Query('windowDays') windowDays?: string,
    @Query('limit') limit?: string,
  ) {
    const parseIntParam = (raw: string | undefined, name: string): number | undefined => {
      if (raw === undefined || raw === null || raw === '') return undefined;
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        throw new BadRequestException(`${name} must be a positive integer`);
      }
      return n;
    };
    return this.crm.listNextActions({
      businessId,
      windowDays: parseIntParam(windowDays, 'windowDays'),
      limit: parseIntParam(limit, 'limit'),
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(60, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/next-action/complete')
  completeContactNextAction(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: any,
  ) {
    return this.crm.completeNextAction({
      businessId,
      contactId,
      actorId: req?.user?.id,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(60, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/next-action/snooze')
  snoozeContactNextAction(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { snoozeUntil?: string; days?: number },
    @Req() req: any,
  ) {
    return this.crm.snoozeNextAction({
      businessId,
      contactId,
      snoozeUntil: body?.snoozeUntil,
      days: body?.days,
      actorId: req?.user?.id,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/tasks/:taskId/complete')
  completeTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.timeline.completeTask({ businessId, taskId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/tasks/:taskId/reopen')
  reopenTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.timeline.reopenTask({ businessId, taskId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/notes/:noteId')
  updateNote(
    @Param('businessId') businessId: string,
    @Param('noteId') noteId: string,
    @Body() body: { body?: string; source?: string },
  ) {
    return this.timeline.updateNote({ businessId, noteId, body: body.body, source: body.source });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/notes/:noteId')
  deleteNote(
    @Param('businessId') businessId: string,
    @Param('noteId') noteId: string,
  ) {
    return this.timeline.deleteNote({ businessId, noteId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/tasks/:taskId')
  updateTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
    @Body() body: { title?: string; dueDate?: string; priority?: string; remindAt?: string },
  ) {
    return this.timeline.updateTask({
      businessId,
      taskId,
      title: body.title,
      dueDate: body.dueDate,
      priority: body.priority,
      remindAt: body.remindAt,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/tasks/:taskId')
  deleteTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.timeline.deleteTask({ businessId, taskId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/autopilot-actions/:actionId/approve')
  approveAutopilotAction(
    @Param('businessId') businessId: string,
    @Param('actionId') actionId: string,
  ) {
    return this.timeline.approveAutopilotAction({ businessId, actionId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/autopilot-actions/:actionId/deny')
  denyAutopilotAction(
    @Param('businessId') businessId: string,
    @Param('actionId') actionId: string,
  ) {
    return this.timeline.denyAutopilotAction({ businessId, actionId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/import/file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async importContactsFromFile(
    @Param('businessId') businessId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('type') type?: string,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('File is required');
    }
    const allowed: Array<'csv' | 'xlsx' | 'pdf' | 'image' | 'vcf'> = ['csv', 'xlsx', 'pdf', 'image', 'vcf'];
    const sourceType = allowed.includes(type as any) ? (type as 'csv' | 'xlsx' | 'pdf' | 'image' | 'vcf') : 'csv';
    return this.crmImport.createFileImport({
      businessId,
      sourceType,
      originalName: file.originalname,
      fileBuffer: file.buffer,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/import/link')
  async importContactsFromLink(@Param('businessId') businessId: string, @Body('url') url?: string) {
    if (!url) {
      throw new BadRequestException('url is required');
    }
    return this.crmImport.createLinkImport({ businessId, sourceUrl: url });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/import/image/ocr')
  async createContactFromOcr(
    @Param('businessId') businessId: string,
    @Body() body: { ocrText?: string; url?: string; type?: string },
  ) {
    if (!body?.ocrText) {
      throw new BadRequestException('ocrText is required');
    }
    return this.crmImport.createContactFromOcr({
      businessId,
      ocrText: body.ocrText,
      mediaUrl: body.url,
      type: body.type,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/import/scan')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async scanContactImage(
    @Param('businessId') businessId: string,
    @UploadedFile() image: Express.Multer.File,
  ) {
    checkAiRateLimit(businessId);
    if (!image || !image.buffer) {
      throw new BadRequestException('Image file is required');
    }
    return this.crmImport.scanContactImage(businessId, image.buffer, image.mimetype);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/imports')
  listImports(@Param('businessId') businessId: string) {
    return this.crmImport.listImports(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/imports/:importId/records')
  listImportRecords(@Param('businessId') businessId: string, @Param('importId') importId: string) {
    return this.crmImport.listImportRecords(businessId, importId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(10, 60000)
  @Post('businesses/:businessId/contacts/check-duplicates')
  checkImportDuplicates(
    @Param('businessId') businessId: string,
    @Body() body: { contacts: Array<{ email?: string; phone?: string; firstName?: string; lastName?: string }> },
  ) {
    if (!Array.isArray(body.contacts) || body.contacts.length === 0) {
      throw new BadRequestException('contacts array is required');
    }
    if (body.contacts.length > 100) {
      throw new BadRequestException('Maximum 100 contacts per check');
    }
    return this.crm.checkDuplicates(businessId, body.contacts);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/duplicates')
  async findDuplicates(
    @Param('businessId') businessId: string,
    @Query('importId') importId?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const min = minConfidence ? Number(minConfidence) : 0.5;
    const max = limit ? Math.min(Number(limit), 200) : 50;
    const off = offset ? Math.max(0, Number(offset)) : 0;
    const { pairs, total } = await this.duplicates.findCandidatesScoped({
      businessId,
      importId,
      minConfidence: Number.isFinite(min) ? min : 0.5,
      limit: Number.isFinite(max) ? max : 50,
      offset: Number.isFinite(off) ? off : 0,
    });
    // Back-compat: also return legacy `groups` shape derived from pairs.
    const legacy = await this.crm.findDuplicates(businessId);
    return { pairs, total, offset: off, limit: max, ...legacy };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/log-communication')
  logCommunication(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { channelType: string; outcome: string; duration?: number; notes?: string },
    @Req() req: any,
  ) {
    if (!body.channelType || !body.outcome) {
      throw new BadRequestException('channelType and outcome are required');
    }
    return this.crm.logCommunication({
      businessId,
      contactId,
      channelType: body.channelType,
      outcome: body.outcome,
      duration: body.duration,
      notes: body.notes,
      actorId: req?.user?.id,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/events')
  createEvent(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: LogContactEventDto,
    @Req() req: any,
  ) {
    return this.crm.logContactEvent({
      businessId,
      contactId,
      type: body.type,
      data: { description: body.description, ...(body.data ?? {}) },
      actorType: 'USER',
      actorId: req?.user?.id,
      source: 'crm',
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/events')
  contactEvents(@Param('businessId') businessId: string, @Param('contactId') contactId: string) {
    return this.crm.listContactEvents({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/notes')
  contactNotes(@Param('businessId') businessId: string, @Param('contactId') contactId: string) {
    return this.crm.listContactNotes({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/tasks')
  listTasks(
    @Param('businessId') businessId: string,
    @Query('contactId') contactId?: string,
    @Query('status') status?: string,
    @Query('dueBefore') dueBefore?: string,
  ) {
    return this.crm.listContactTasks({
      businessId,
      contactId,
      status,
      dueBefore: dueBefore ? new Date(dueBefore) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/playbook')
  getPlaybook(@Param('businessId') businessId: string, @Param('contactId') contactId: string) {
    return this.playbook.getOrCreatePlaybook({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/playbook')
  updatePlaybook(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { data: any; type?: string },
  ) {
    return this.playbook.updatePlaybook({
      businessId,
      contactId,
      data: body.data,
      type: body.type,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/lists')
  listContactLists(@Param('businessId') businessId: string) {
    return this.crm.listContactLists(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/lists')
  createContactList(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; description?: string; color?: string; type?: string; filters?: any; rules?: any; contactIds?: string[] },
  ) {
    return this.crm.createContactList({ businessId, ...body });
  }

  // ---- Per-user contact saved views ---------------------------------

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/saved-views')
  listSavedViews(
    @Param('businessId') businessId: string,
    @Req() req: any,
  ) {
    const userId = req?.user?.id;
    if (!userId) throw new BadRequestException('Authenticated user required');
    return this.savedViews.list(businessId, userId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/saved-views')
  createSavedView(
    @Param('businessId') businessId: string,
    @Body() body: { name: string; filterState: Record<string, unknown>; sort?: { sortBy?: string; sortOrder?: 'asc' | 'desc' } | null; visibleColumns?: string[] },
    @Req() req: any,
  ) {
    const userId = req?.user?.id;
    if (!userId) throw new BadRequestException('Authenticated user required');
    return this.savedViews.create(businessId, userId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/saved-views/:viewId')
  updateSavedView(
    @Param('businessId') businessId: string,
    @Param('viewId') viewId: string,
    @Body() body: { name?: string; filterState?: Record<string, unknown>; sort?: { sortBy?: string; sortOrder?: 'asc' | 'desc' } | null; visibleColumns?: string[] },
    @Req() req: any,
  ) {
    const userId = req?.user?.id;
    if (!userId) throw new BadRequestException('Authenticated user required');
    return this.savedViews.update(businessId, userId, viewId, body);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/saved-views/:viewId')
  deleteSavedView(
    @Param('businessId') businessId: string,
    @Param('viewId') viewId: string,
    @Req() req: any,
  ) {
    const userId = req?.user?.id;
    if (!userId) throw new BadRequestException('Authenticated user required');
    return this.savedViews.delete(businessId, userId, viewId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Put('businesses/:businessId/lists/:listId')
  updateContactList(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
    @Body() body: { name?: string; description?: string; color?: string; type?: string; filters?: any; rules?: any; contactIds?: string[] },
  ) {
    return this.crm.updateContactList({ businessId, listId, ...body });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/lists/:listId')
  deleteContactList(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
  ) {
    return this.crm.deleteContactList({ businessId, listId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/lists/:listId/contacts')
  getContactListContacts(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const lim = limit !== undefined ? Number(limit) : undefined;
    const off = offset !== undefined ? Number(offset) : undefined;
    return this.crm.getContactListContacts({
      businessId,
      listId,
      limit: Number.isFinite(lim as number) ? (lim as number) : undefined,
      offset: Number.isFinite(off as number) ? (off as number) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/lists/:listId/contacts')
  addContactsToList(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
    @Body() body: { contactIds: string[] },
  ) {
    return this.crm.addContactsToList({ businessId, listId, contactIds: body.contactIds });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/lists/:listId/contacts/:contactId')
  removeContactFromList(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.crm.removeContactFromList({ businessId, listId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('insights')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/flow-intelligence')
  getFlowIntelligence(@Param('businessId') businessId: string) {
    return this.flow.getFlowIntelligence(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/next-actions')
  getNextActions(@Param('businessId') businessId: string) {
    return this.actions.getNextActions(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/ai-next-actions')
  getAiNextActions(@Param('businessId') businessId: string) {
    return this.actions.getAiNextActions(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/next-actions/:actionId/complete')
  completeNextAction(
    @Param('businessId') businessId: string,
    @Param('actionId') actionId: string,
  ) {
    return this.actions.completeNextAction(businessId, actionId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/autopilot-actions')
  getAutopilotActions(@Param('businessId') businessId: string) {
    return this.actions.getAutopilotActions(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/predictive-revenue')
  getPredictiveRevenue(@Param('businessId') businessId: string) {
    return this.revenue.getPredictiveRevenue(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/financial-growth')
  getFinancialGrowth(@Param('businessId') businessId: string) {
    return this.revenue.getFinancialGrowth(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/health-metrics')
  getContactHealthMetrics(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.journey.getContactHealthMetrics(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/journey')
  getContactJourney(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.journey.getContactJourney(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/cross-journey')
  getContactCrossJourney(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.journey.getContactCrossJourney(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/story')
  async getContactStory(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Query('filter') filter?: string,
  ) {
    const result = await this.journey.getContactCrossJourney(businessId, contactId);
    if (!filter || filter === 'all') return result;
    const filterFn = (() => {
      switch (filter) {
        case 'comms':
          return (t: string) => t.startsWith('communication.') || t.startsWith('email.') || t.startsWith('whatsapp.') || t.startsWith('campaign.');
        case 'money':
          return (t: string) => t.startsWith('invoice.') || t.startsWith('payment.') || t.startsWith('quote.');
        case 'tasks':
          return (t: string) => t.startsWith('task.');
        case 'notes':
          return (t: string) => t.startsWith('note.');
        case 'bookings':
          return (t: string) => t.startsWith('booking.');
        default:
          return () => true;
      }
    })();
    return {
      ...result,
      timeline: result.timeline.filter((item) => filterFn(item.type)),
    };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/dossier')
  async getContactDossier(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    const [detail, story, insight, health] = await Promise.all([
      this.crmStats.contactDetail({ businessId, contactId }),
      this.journey.getContactCrossJourney(businessId, contactId),
      this.journey.generateAiInsight(businessId, contactId),
      this.journey.getContactHealthMetrics(businessId, contactId),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      contact: detail?.contact ?? null,
      notes: detail?.notes ?? [],
      tasks: detail?.tasks ?? [],
      meta: detail?.meta ?? null,
      health,
      insight,
      summary: story.summary,
      timeline: story.timeline,
    };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/conversation-context')
  getConversationContext(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.journey.getConversationContext(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/favorite')
  toggleFavorite(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.crm.toggleFavorite(businessId, contactId);
  }

  // ---------- M2 Unified Communication Inbox ----------

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/conversations')
  listConversations(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('channel') channel?: string,
    @Query('direction') direction?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    const validChannels: ConversationChannel[] = ['whatsapp', 'email', 'sms', 'call', 'meeting', 'note'];
    const validDirections: ConversationDirection[] = ['in', 'out', 'internal'];
    return this.communication.list({
      businessId,
      contactId,
      cursor: cursor || null,
      limit: limit ? parseInt(limit, 10) : undefined,
      channel: channel && validChannels.includes(channel as ConversationChannel) ? (channel as ConversationChannel) : null,
      direction: direction && validDirections.includes(direction as ConversationDirection) ? (direction as ConversationDirection) : null,
      since: since || null,
      until: until || null,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(60, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/conversations/read')
  async markConversationRead(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: any,
  ) {
    const userId = req?.user?.id;
    if (!userId) throw new BadRequestException('Authenticated user required');
    const state = await this.communication.markRead(businessId, userId, contactId);
    return { ok: true, lastReadAt: state.lastReadAt.toISOString() };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/unread-counts')
  async unreadCounts(
    @Param('businessId') businessId: string,
    @Req() req: any,
  ) {
    const userId = req?.user?.id;
    if (!userId) return { counts: {} };
    const counts = await this.communication.unreadCounts(businessId, userId);
    return { counts };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/conversations/reply')
  async replyConversation(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { channel?: string; body?: string },
    @Req() req: any,
  ) {
    const validChannels: ConversationChannel[] = ['whatsapp', 'email', 'sms', 'call', 'meeting', 'note'];
    if (!body?.channel || !validChannels.includes(body.channel as ConversationChannel)) {
      throw new BadRequestException('Valid channel is required');
    }
    if (!body?.body || !body.body.trim()) {
      throw new BadRequestException('Message body is required');
    }
    return this.communication.reply({
      businessId,
      contactId,
      channel: body.channel as ConversationChannel,
      body: body.body,
      actorId: req?.user?.id,
    });
  }

  // ---------- Conversation AI ----------

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/conversations/summary')
  async getConversationSummary(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Query('refresh') refresh?: string,
  ) {
    const force = refresh === '1' || refresh === 'true';
    const r = await this.conversationAi.summarizeThread(businessId, contactId, { force });
    return { summary: r.insight, cached: r.cached };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(15, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/conversations/summary/regenerate')
  async regenerateConversationSummary(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ) {
    const r = await this.conversationAi.summarizeThread(businessId, contactId, { force: true });
    return { summary: r.insight, cached: r.cached };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(20, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/conversations/suggest-replies')
  async suggestReplies(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { count?: number; preferredChannel?: string; tone?: string },
  ) {
    const replies = await this.conversationAi.suggestReplies(businessId, contactId, {
      count: typeof body?.count === 'number' ? body.count : undefined,
      preferredChannel: typeof body?.preferredChannel === 'string' ? body.preferredChannel : undefined,
      tone: typeof body?.tone === 'string' ? body.tone : undefined,
    });
    return { replies };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/conversations/insights')
  async getConversationInsights(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Query('messageRefs') messageRefs?: string,
  ) {
    const refs = (messageRefs ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
    const [rollup, perMessage] = await Promise.all([
      this.conversationAi.getContactRollup(businessId, contactId),
      refs.length > 0 ? this.conversationAi.getMessageInsights(businessId, contactId, refs) : Promise.resolve({}),
    ]);
    return { rollup, perMessage };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @Sse('businesses/:businessId/contacts/:contactId/conversations/stream')
  conversationStream(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
  ): Observable<{ data: { type: string; contactId: string; eventId?: string } }> {
    const { observable } = this.communication.subscribe(businessId, contactId);
    return observable.asObservable();
  }
}
