import { BadRequestException, Body, Controller, Delete, Get, HttpException, Inject, NotFoundException, Param, Patch, Post, Put, Query, Req, Res, Sse, UnauthorizedException, UploadedFile, UseGuards, UseInterceptors, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { CrmActionsService } from './crm-actions.service';
import { CrmCommunicationService, type ConversationChannel, type ConversationDirection } from './crm-communication.service';
import { ConversationAiService } from './conversation-ai.service';
import { ContactInsightService } from './contact-insight.service';
import { CrmFlowService } from './crm-flow.service';
import { CrmImportService } from './crm-import.service';
import { CrmJourneyService } from './crm-journey.service';
import { CrmNetworkService } from './crm-network.service';
import type { ContactRelationshipEdgeType } from '@keyflow/shared';
import { CrmPlaybookService } from './crm-playbook.service';
import { CrmRevenueService } from './crm-revenue.service';
import { CrmRelationshipHealthService } from './crm-relationship-health.service';
import { CrmStatsService, timelineEntryCarriesMoney } from './crm-stats.service';
import { CrmDuplicateDetectionService } from './crm-duplicate-detection.service';
import { CrmDataQualityService } from './crm-data-quality.service';
import { DATA_QUALITY_KINDS, type DataQualityKind } from './crm-data-quality.util';
import { CrmTimelineService } from './crm-timeline.service';
import { CrmService, withoutListMoney, withoutStoredMoney, type AuditContext } from './crm.service';
import { resolveTimelineViewer } from '../timeline/timeline-visibility';
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
import type { Prisma } from '@prisma/client';
import { PickType } from '@nestjs/mapped-types';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  assertContactVisible,
  contactVisibilityFilter,
  resolveCrmAccess,
  visibilityClause,
  visibleNeighbourhood,
  visibleRelationshipGraph,
  type CrmAccess,
} from './crm-permissions.helper';
import { contactWhereBase } from './crm.helpers';

type FlowHighlights = Awaited<ReturnType<CrmStatsService['flowHighlights']>>;

/**
 * W8-MONEY-SIGNALS review repair SEC-W8MS-3 (owner ruling D-100): GET
 * .../highlights as a member without revenue read is served it. The payload
 * (CrmStatsService.flowHighlights, cached for the whole business) is read as
 * it is and projected here, so the cache never holds the withheld view and an
 * owner's read never gets it:
 * - overdueReminders (picked and ranked by the outstanding balance) is empty;
 * - highPotential is the one CrmStatsService.flowHighlights ranked for that
 *   member (readsRevenue false; W9-MONEY-RANKING, D-100): by the money-free
 *   lead score, from the contacts that member may open (review repair
 *   SEC-W9MR-1), each card with no balance or unpaid count (W8 served it
 *   empty: the cached cards are ranked by the score with its invoice terms);
 * - serviceAffinity keeps its bookings, its revenue figure is 0;
 * - the 'cold-with-unpaid' segment (its members are the contacts with an
 *   unpaid invoice) is left out, and every other segment's contacts are
 *   served as GET contacts serves that member a row (withoutListMoney);
 * - the timeline drops its invoice rows ('Total <amount> <currency>') and the
 *   ContactEvent rows of a money type (timelineEntryCarriesMoney); flowHighlights
 *   already left them out before its cut to 20 (SEC-W9MR-2);
 * - nextActions drops the unpaid-invoice follow-ups (flowHighlights already
 *   worked them out with none before its cap of 6, SEC-W9MR-2), aiNextActions
 *   the payment reminders.
 */
function withoutHighlightsMoney(payload: FlowHighlights): FlowHighlights {
  return {
    ...payload,
    highlights: {
      highPotential: payload.highlights.highPotential,
      overdueReminders: [],
      serviceAffinity: payload.highlights.serviceAffinity.map((service) => ({ ...service, revenue: 0 })),
    },
    segments: payload.segments
      .filter((segment) => segment.key !== 'cold-with-unpaid')
      .map((segment) => ({ ...segment, contacts: segment.contacts.map((contact) => withoutListMoney(contact)) })),
    timeline: payload.timeline.filter((entry) => !timelineEntryCarriesMoney(entry)),
    nextActions: payload.nextActions.filter((action) => action.trigger !== 'invoice-unpaid'),
    aiNextActions: payload.aiNextActions.filter((action) => action.type !== 'payment_reminder'),
  };
}

/**
 * The PATCH contacts/bulk body. status, relationshipType, priority and favorite
 * carry UpdateContactDto's own rules (PickType copies its validation metadata),
 * so the global ValidationPipe refuses with 400 any value the single PATCH
 * refuses; null, which the web sends to clear relationshipType or priority,
 * passes as IsOptional lets it. contactIds and addTags must be arrays of
 * strings, so a malformed id or tag is a 400 here instead of a Prisma
 * validation error (500). A class, not an inline type: tsc emits it as the
 * parameter's design:paramtypes, which is what the pipe validates against (an
 * inline type is emitted as Object and passes unchecked). The 100-id cap stays
 * in the handler with its own message. Declared before CrmController, whose
 * decorator metadata names it when the class is defined.
 */
export class BulkUpdateContactsDto extends PickType(UpdateContactDto, ['status', 'relationshipType', 'priority', 'favorite'] as const) {
  @IsArray()
  @IsString({ each: true })
  contactIds!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  addTags?: string[];

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

@Controller('crm')
@UseGuards(CrmRateLimitGuard)
export class CrmController {
  private readonly logger = new Logger(CrmController.name);
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
    @Inject(CrmDataQualityService) private readonly dataQuality: CrmDataQualityService,
    @Inject(CrmSavedViewsService) private readonly savedViews: CrmSavedViewsService,
    @Inject(CrmRelationshipHealthService) private readonly relationshipHealth: CrmRelationshipHealthService,
    @Inject(CrmCommunicationService) private readonly communication: CrmCommunicationService,
    @Inject(BestChannelService) private readonly bestChannel: BestChannelService,
    @Inject(ConversationAiService) private readonly conversationAi: ConversationAiService,
    @Inject(CrmNetworkService) private readonly network: CrmNetworkService,
    @Inject(ContactInsightService) private readonly contactInsight: ContactInsightService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * The authenticated member as the audit actor of a contact mutation, so the
   * ContactEvent and ContactAuditEntry the service writes name that member
   * instead of SYSTEM or nobody. The guards already refuse a request without a
   * user; this keeps a member's edit from being recorded as SYSTEM if they
   * ever do not.
   */
  private userAuditContext(req: { user?: { id?: string } } | undefined): AuditContext {
    const actorUserId = req?.user?.id;
    if (!actorUserId) {
      throw new UnauthorizedException('Authentication required');
    }
    return { actor: { type: 'USER', id: actorUserId } };
  }

  /**
   * The authenticated member, for a service call that applies that member's
   * CRM permissions (the import routes). The guards already refuse a request
   * without a user; this keeps such a call from running unscoped, as a system
   * caller, if they ever do not.
   */
  private requireActorUserId(req: { user?: { id?: string } } | undefined): string {
    const actorUserId = req?.user?.id;
    if (!actorUserId) {
      throw new UnauthorizedException('Authentication required');
    }
    return actorUserId;
  }

  /**
   * W8-MONEY-SIGNALS review repairs (owner ruling D-100): whether the session
   * member reads revenue, by the module rule every W7 money view applies
   * (resolveTimelineViewer). A request without a member is 401.
   */
  private async readsRevenue(businessId: string, req: { user?: { id?: string } } | undefined): Promise<boolean> {
    const viewer = await resolveTimelineViewer(this.prisma, businessId, this.requireActorUserId(req));
    return viewer.readable.has('revenue');
  }

  /**
   * W8-MONEY-SIGNALS review repairs SEC-W8MS-1 / SEC-W8MS-4 (owner ruling
   * D-100): CrmStatsService.contactDetail withholds the stored amounts and the
   * invoice-derived signals from a member without revenue read (V55-13h /
   * V55-13i) and works out meta with no invoice read, but serves the stored
   * leadScore, which carries the invoice terms (+10 a paid, -5 an unpaid
   * invoice), and the other stored fields worked out from the invoices
   * (nextBestAction, followUpPriority, conversionProbability,
   * referralLikelihood, responsivenessScore). For that member the contact is
   * served as GET contacts serves its row (withoutStoredMoney), its leadScore
   * the meta.leadScore of the same response. GET contacts/:contactId and the
   * dossier; the owner and a member with revenue read get the detail as it is.
   */
  private async detailFor<D extends Awaited<ReturnType<CrmStatsService['contactDetail']>>>(
    businessId: string,
    req: { user?: { id?: string } } | undefined,
    detail: D,
  ): Promise<D> {
    if (!detail?.contact || (await this.readsRevenue(businessId, req))) return detail;
    return { ...detail, contact: withoutStoredMoney(detail.contact, detail.meta?.leadScore ?? null) };
  }

  /**
   * The record-visibility gate of the contact-scoped sibling reads (events,
   * notes, journey, cross-journey, story, revenue-summary, health-metrics,
   * relationships, network, data-quality, playbook, conversations,
   * conversation-context, best-channel). Their collaborators check the tenant
   * only, so each handler awaits this before calling one: the session member
   * must be able to open the contact itself, by the rule GET
   * contacts/:contactId applies. A contact outside that rule answers that
   * route's 404 for an unknown id and no child row is read; a request without
   * a member is 401 (V1-08, M13). It also gates both ends of a relationship
   * write (POST relationships, POST refer), and the other routes that name a
   * contact by its path: the contact-scoped writes (notes, tasks, events,
   * log-communication, favorite, playbook, next-action, data-quality
   * mark-verified, relationship-health, list removal, both contacts of a
   * merge) and the conversation routes (read, reply, summary, regenerate,
   * suggest-replies, insights), whose collaborators also check the tenant
   * only (FOLLOW3-D2, review ST-4). The merge preview and DELETE
   * relationships check both of their contacts with contactVisibilityFilter,
   * and the note and task routes keyed by the row's own id go through
   * assertVisibleChildRow. Not gated yet (follow-up): the
   * conversations/stream SSE route and GET tasks?contactId=. It returns the
   * member and their CRM access, which the relationship and network reads use
   * to drop the neighbours the member cannot open (review ST-1).
   */
  private async assertVisibleContact(
    businessId: string,
    contactId: string,
    req: { user?: { id?: string } } | undefined,
  ): Promise<{ actorUserId: string; access: CrmAccess }> {
    const actorUserId = this.requireActorUserId(req);
    const access = await assertContactVisible(this.prisma, businessId, contactId, actorUserId);
    return { actorUserId, access };
  }

  /**
   * The record-visibility gate of the routes that name a contact's note or task
   * by the row's own id (PATCH/DELETE notes/:noteId, PATCH/DELETE
   * tasks/:taskId, tasks/:taskId complete and reopen; review ST-D2-3). The row
   * is looked up in the business and its contact checked by the rule GET
   * contacts/:contactId applies: a row of a contact the member cannot open
   * answers the collaborator's own 404 for an unknown row id and is left as it
   * is. A row outside this business is left to the collaborator, which answers
   * that same 404. No restriction for OWNER/SUPER_ADMIN (contactVisibilityFilter
   * returns null).
   */
  private async assertVisibleChildRow(
    businessId: string,
    kind: 'note' | 'task',
    rowId: string,
    req: { user?: { id?: string } } | undefined,
  ): Promise<void> {
    const actorUserId = this.requireActorUserId(req);
    const where = { id: rowId, businessId };
    const row: { contactId: string } | null =
      kind === 'note'
        ? await this.prisma.client.contactNote.findFirst({ where, select: { contactId: true } })
        : await this.prisma.client.contactTask.findFirst({ where, select: { contactId: true } });
    if (!row) return;
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    const canOpen = await contactVisibilityFilter(this.prisma, businessId, access, actorUserId, [row.contactId]);
    if (canOpen && !canOpen(row.contactId)) {
      throw new NotFoundException(kind === 'note' ? 'Note not found' : 'Task not found');
    }
  }

  // ---------------------------------------------------------------------------
  // Relationship graph (M5)
  // ---------------------------------------------------------------------------

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/relationships')
  async listContactRelationships(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    const { actorUserId, access } = await this.assertVisibleContact(businessId, contactId, req);
    const relationships = await this.network.listForContact(businessId, contactId);
    // Each row carries the other contact's full row: keep only the rows whose
    // other contact the member may open (review ST-1).
    const canOpen = await contactVisibilityFilter(this.prisma, businessId, access, actorUserId, [
      ...relationships.outgoing.map((r) => r.toContactId),
      ...relationships.incoming.map((r) => r.fromContactId),
    ]);
    if (!canOpen) return relationships;
    return {
      ...relationships,
      outgoing: relationships.outgoing.filter((r) => canOpen(r.toContactId)),
      incoming: relationships.incoming.filter((r) => canOpen(r.fromContactId)),
    };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/network')
  async getContactNetwork(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
    @Query('depth') depth?: string,
  ) {
    const { actorUserId, access } = await this.assertVisibleContact(businessId, contactId, req);
    const d = depth ? Math.max(1, Math.min(2, Number(depth) || 2)) : 2;
    const graph = await this.network.getNeighbourhood(businessId, contactId, d);
    // Neighbours the member cannot open leave the graph with their edges and
    // what is reached only through them (review ST-1).
    const canOpen = await contactVisibilityFilter(this.prisma, businessId, access, actorUserId, [
      ...graph.nodes.map((n) => n.id),
      ...graph.edges.flatMap((e) => [e.fromContactId, e.toContactId]),
    ].filter((id) => id !== contactId));
    return canOpen ? visibleNeighbourhood(graph, d, canOpen) : graph;
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/network')
  async getNetworkGraph(
    @Param('businessId') businessId: string,
    @Req() req: { user?: { id?: string } },
    @Query('type') type?: string,
    @Query('relationshipHealth') relationshipHealth?: string,
    @Query('minDealValue') minDealValue?: string,
    @Query('search') search?: string,
  ) {
    // The business graph names every related contact: it shows only the ones
    // the session member may open, by the rule GET detail applies (review ST-3).
    const actorUserId = this.requireActorUserId(req);
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    const graph = await this.network.listGraphForBusiness(businessId, {
      type: type as ContactRelationshipEdgeType | undefined,
      relationshipHealth: relationshipHealth || undefined,
      minDealValue: minDealValue ? Number(minDealValue) : undefined,
      search: search || undefined,
    });
    const canOpen = await contactVisibilityFilter(
      this.prisma,
      businessId,
      access,
      actorUserId,
      graph.nodes.map((n) => n.id),
    );
    return canOpen ? visibleRelationshipGraph(graph, canOpen) : graph;
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/relationships')
  async createContactRelationship(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
    @Body() body: { toContactId: string; type: string; since?: string | null; note?: string | null },
  ) {
    if (!body?.toContactId || typeof body.toContactId !== 'string' || !body?.type) {
      throw new BadRequestException('toContactId and type are required');
    }
    // Both ends: a member relates only contacts they may open. A hidden end
    // answers GET detail's 404 for an unknown id and nothing is written, not
    // even the inverse edge on the hidden contact (review ST-2).
    await this.assertVisibleContact(businessId, contactId, req);
    await this.assertVisibleContact(businessId, body.toContactId, req);
    return this.network.createRelationship({
      businessId,
      fromContactId: contactId,
      toContactId: body.toContactId,
      type: body.type,
      since: body.since ?? null,
      note: body.note ?? null,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/relationships/:relationshipId')
  async deleteContactRelationship(
    @Param('businessId') businessId: string,
    @Param('relationshipId') relationshipId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    // Both ends, as POST relationships (review ST-2 residual): an edge with an
    // end the member cannot open answers the 404 of an unknown relationship id
    // and nothing is deleted. An id outside this business is left to the
    // service, which answers that same 404.
    const actorUserId = this.requireActorUserId(req);
    const edge = await this.prisma.client.contactRelationship.findFirst({
      where: { id: relationshipId, businessId },
      select: { fromContactId: true, toContactId: true },
    });
    if (edge) {
      const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
      const canOpen = await contactVisibilityFilter(this.prisma, businessId, access, actorUserId, [
        edge.fromContactId,
        edge.toContactId,
      ]);
      if (canOpen && !(canOpen(edge.fromContactId) && canOpen(edge.toContactId))) {
        throw new NotFoundException('Relationship not found');
      }
    }
    return this.network.deleteRelationship(businessId, relationshipId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, PlanLimitGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/refer')
  async referContact(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
    @Body() body: {
      contactId?: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      note?: string | null;
    },
  ) {
    if (!body?.contactId && !body?.firstName && !body?.lastName && !body?.email && !body?.phone) {
      throw new BadRequestException('Provide an existing contactId or referral details (name/email/phone)');
    }
    if (body.contactId != null && typeof body.contactId !== 'string') {
      throw new BadRequestException('contactId must be a string');
    }
    // The other relationship write, gated like POST relationships (review
    // ST-2): the referrer and an existing target must be contacts the member
    // may open. Otherwise it would bump a hidden referrer's lead score, log on
    // its timeline and copy its name into a new contact's sourceDetail.
    await this.assertVisibleContact(businessId, contactId, req);
    if (body.contactId) await this.assertVisibleContact(businessId, body.contactId, req);
    return this.network.referContact({
      businessId,
      referrerContactId: contactId,
      target: {
        contactId: body.contactId,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
      },
      note: body.note ?? null,
    });
  }

  @Get('health')
  async healthCheck() {
    const start = Date.now();
    let dbOk = false;
    try {
      await this.crm.healthPing();
      dbOk = true;
    } catch (err: any) {
        this.logger.warn(`Silent catch: ${err instanceof Error ? err.message : err}`);
      }
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
    @Query('ownedByMe') ownedByMe?: string,
    @Query('minRevenue') minRevenue?: string,
    @Req() req?: any,
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
      actorUserId: req?.user?.id,
      ownedByActor: ownedByMe === 'true',
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
      minRevenue: minRevenue ? Number(minRevenue) : undefined,
    });
    })();
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/best-channel')
  async bestChannelExplain(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
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
    @Req() req: { user?: { id?: string } },
  ) {
    const audit = this.userAuditContext(req);
    // The actor bounds what a duplicate-identity 409 may name: the existing
    // holder's id is disclosed only when this member could open that contact.
    return this.crm.createContact({ ...body, businessId, actorUserId: req?.user?.id }, audit);
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

  // Declared before its contacts/:contactId sibling: Express answers the first
  // route that matches, so declared after it this route was never reached (M15;
  // core/config/route-shadowing.spec.ts keeps every controller in this order).
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
    return { counts: await this.visibleCounts(businessId, userId, counts) };
  }

  /**
   * `counts` (contact id -> number) cut to the live contacts `userId` can see:
   * the tenant predicate with deletedAt null plus the visibility clause GET
   * contacts/:contactId applies (resolveCrmAccess + visibilityClause).
   * CrmCommunicationService.unreadCounts counts every contact of the tenant
   * with inbound activity, so without this a member would receive the ids of
   * another member's PRIVATE contacts, of TEAM contacts outside a 'my book'
   * scope and of deleted contacts, all of which GET answers 404; with it such
   * an id is left out exactly like an id with no inbound activity.
   */
  private async visibleCounts(
    businessId: string,
    userId: string,
    counts: Record<string, number>,
  ): Promise<Record<string, number>> {
    const ids = Object.keys(counts);
    if (ids.length === 0) return {};
    const access = await resolveCrmAccess(this.prisma, businessId, userId);
    const where: Prisma.ContactWhereInput = { ...contactWhereBase(businessId), id: { in: ids } };
    const visClause = visibilityClause(access, userId);
    if (visClause) where.AND = [visClause as Prisma.ContactWhereInput];
    const visible = new Set(
      (await this.prisma.client.contact.findMany({ where, select: { id: true } })).map((c) => c.id),
    );
    const result: Record<string, number> = {};
    for (const id of ids) {
      if (visible.has(id)) result[id] = counts[id];
    }
    return result;
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId')
  async getContactDetail(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    // The caller's identity bounds the lookup: the detail row must satisfy the
    // same CRM visibility the list applies. The guards above already refuse a
    // request without a user; this keeps the route closed if they ever do not.
    const actorUserId = req?.user?.id;
    if (!actorUserId) {
      throw new UnauthorizedException('Authentication required');
    }
    // W8-MONEY-SIGNALS review repairs SEC-W8MS-1 / SEC-W8MS-4 (D-100): the
    // stored lead score and invoice-derived fields as the list serves them.
    return this.detailFor(businessId, req, await this.crmStats.contactDetail({ businessId, contactId, actorUserId }));
  }

  // Declared before its contacts/:contactId sibling: Express answers the first
  // route that matches, so declared after it this route was never reached (M15;
  // core/config/route-shadowing.spec.ts keeps every controller in this order).
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(10, 60_000)
  @Patch('businesses/:businessId/contacts/bulk')
  bulkUpdateContacts(
    @Param('businessId') businessId: string,
    @Body() body: BulkUpdateContactsDto,
    @Req() req: any,
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
      actorUserId: req?.user?.id,
    });
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
    @Req() req: any,
  ) {
    const audit = this.userAuditContext(req);
    return this.crm.updateContact({ ...body, businessId,
      contactId,
      actorUserId: req?.user?.id,
    }, audit);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @UseInterceptors(TeamAuditInterceptor)
  @AuditAction('crm', 'contact_reassigned', 'contact')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/bulk/reassign')
  bulkReassignContacts(
    @Param('businessId') businessId: string,
    @Body() body: { contactIds: string[]; newOwnerId: string },
    @Req() req: any,
  ) {
    if (!Array.isArray(body.contactIds) || body.contactIds.length === 0 || body.contactIds.length > 200) {
      throw new HttpException('contactIds must be an array of 1..200 items', 400);
    }
    if (!body.newOwnerId || typeof body.newOwnerId !== 'string') {
      throw new HttpException('newOwnerId is required', 400);
    }
    return this.crm.reassignContacts({
      businessId,
      contactIds: body.contactIds,
      newOwnerId: body.newOwnerId,
      actorUserId: req?.user?.id,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(10, 60_000)
  @Delete('businesses/:businessId/contacts/bulk')
  bulkDeleteContacts(
    @Param('businessId') businessId: string,
    @Body() body: { contactIds: string[] },
    @Req() req: any,
  ) {
    if (!Array.isArray(body.contactIds) || body.contactIds.length > 100) {
      throw new HttpException('contactIds must be an array of at most 100 items', 400);
    }
    const audit = this.userAuditContext(req);
    return this.crm.bulkDeleteContacts({ businessId, contactIds: body.contactIds, actorUserId: req?.user?.id }, audit);
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
    @Req() req: any,
  ) {
    const audit = this.userAuditContext(req);
    return this.crm.softDeleteContact({ businessId, contactId, actorUserId: req?.user?.id }, audit);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/merge/:duplicateId')
  async mergeContact(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Param('duplicateId') duplicateId: string,
    @Body() body: { fieldOverrides?: Record<string, unknown> } | undefined,
    @Req() req: any,
  ) {
    // Both contacts: a merge reads the duplicate into the primary and deletes it.
    await this.assertVisibleContact(businessId, contactId, req);
    await this.assertVisibleContact(businessId, duplicateId, req);
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
    @Req() req: { user?: { id?: string } },
  ) {
    if (primaryId === duplicateId) throw new BadRequestException('primaryId and duplicateId must differ');
    // Both contacts, as the merge it previews (review ST-D2-2): the preview
    // returns both full rows, so a pair with a contact the member cannot open
    // answers the 404 of an unknown pair and neither row is read. No
    // restriction for OWNER/SUPER_ADMIN (contactVisibilityFilter returns null).
    const actorUserId = this.requireActorUserId(req);
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    const canOpen = await contactVisibilityFilter(this.prisma, businessId, access, actorUserId, [primaryId, duplicateId]);
    if (canOpen && !(canOpen(primaryId) && canOpen(duplicateId))) {
      throw new HttpException('Contact pair not found', 404);
    }
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

  // ---------------------------------------------------------------------------
  // M6: Data quality engine
  // ---------------------------------------------------------------------------
  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/data-quality/stats')
  dqStats(@Param('businessId') businessId: string) {
    return this.dataQuality.getStats(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/data-quality/issues')
  dqIssues(
    @Param('businessId') businessId: string,
    @Query('kinds') kinds?: string | string[],
    @Query('severities') severities?: string | string[],
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const toArr = (v?: string | string[]) => (Array.isArray(v) ? v : v ? v.split(',') : undefined);
    const allowedKinds = new Set<string>(DATA_QUALITY_KINDS);
    const filteredKinds = (toArr(kinds) ?? []).filter((k) => allowedKinds.has(k)) as DataQualityKind[];
    const filteredSeverities = (toArr(severities) ?? []).filter((s) => ['low', 'medium', 'high'].includes(s)) as Array<'low' | 'medium' | 'high'>;
    const allowedStatus = ['open', 'resolved', 'dismissed'] as const;
    const safeStatus = allowedStatus.find((s) => s === status) ?? 'open';
    return this.dataQuality.listIssues({
      businessId,
      kinds: filteredKinds.length ? filteredKinds : undefined,
      severities: filteredSeverities.length ? filteredSeverities : undefined,
      status: safeStatus,
      search: search?.trim() || undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/data-quality/wizard')
  dqWizard(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
  ) {
    return this.dataQuality.wizardQueue(businessId, limit ? Number(limit) : 25);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/data-quality')
  async dqContactIssues(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
    return this.dataQuality.getContactIssues(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/data-quality/scan')
  async dqScan(@Param('businessId') businessId: string) {
    return this.dataQuality.scanBusiness(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(60, 60_000)
  @Post('businesses/:businessId/data-quality/issues/:issueId/apply')
  dqApply(
    @Param('businessId') businessId: string,
    @Param('issueId') issueId: string,
    @Body() body: { override?: Record<string, unknown> } | undefined,
    @Req() req: any,
  ) {
    return this.dataQuality.applyFix({ businessId, issueId, override: body?.override, actorId: req?.user?.id });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(60, 60_000)
  @Post('businesses/:businessId/data-quality/issues/:issueId/dismiss')
  dqDismiss(
    @Param('businessId') businessId: string,
    @Param('issueId') issueId: string,
    @Req() req: any,
  ) {
    return this.dataQuality.dismissIssue({ businessId, issueId, actorId: req?.user?.id });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(20, 60_000)
  @Post('businesses/:businessId/data-quality/bulk-apply')
  dqBulkApply(
    @Param('businessId') businessId: string,
    @Body() body: { issueIds: string[] },
    @Req() req: any,
  ) {
    if (!body?.issueIds || !Array.isArray(body.issueIds)) {
      throw new BadRequestException('issueIds is required');
    }
    return this.dataQuality.bulkApplyFix({ businessId, issueIds: body.issueIds, actorId: req?.user?.id });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(20, 60_000)
  @Patch('businesses/:businessId/data-quality/settings')
  dqUpdateSettings(
    @Param('businessId') businessId: string,
    @Body() body: { staleDays?: number },
  ) {
    return this.dataQuality.updateSettings({ businessId, staleDays: body?.staleDays });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/data-quality/mark-verified')
  async dqMarkVerified(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
    return this.dataQuality.markContactVerified(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/notes')
  async addNote(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: CreateNoteDto,
    @Req() req: any,
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
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
  async segmentSummary(@Param('businessId') businessId: string, @Req() req: { user?: { id?: string } }) {
    const summary = await this.crmStats.segmentSummary({ businessId });
    // W8-MONEY-SIGNALS review repair SEC-W8MS-3 (owner ruling D-100): the
    // unpaid count (contacts with a SENT or OVERDUE invoice) is a money
    // signal; a member without revenue read is served it as 0, the shape and
    // every other count kept. Projected after the business-wide cache.
    return (await this.readsRevenue(businessId, req)) ? summary : { ...summary, unpaid: 0 };
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
  @Get('businesses/:businessId/intelligence')
  async getIntelligenceSummary(@Param('businessId') businessId: string) {
    return this.contactInsight.getIntelligenceSummary(businessId);
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
  async setRelationshipHealthOverride(
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
    await this.assertVisibleContact(businessId, contactId, req);
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
  async clearRelationshipHealthOverride(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: any,
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
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
  async flowHighlights(@Param('businessId') businessId: string, @Req() req: { user?: { id?: string } }) {
    // W8-MONEY-SIGNALS review repair SEC-W8MS-3 (owner ruling D-100): a member
    // without revenue read gets no amount and no ranking by money; W9-MONEY-RANKING
    // (D-100): the viewer's revenue read is passed, so their highPotential is
    // ranked by the money-free lead score; its review repairs SEC-W9MR-1 / SEC-W9MR-2
    // pass the viewer too, so their cards and next actions come from the contacts
    // they may open, with no invoice follow-up before the cap.
    const readsRevenue = await this.readsRevenue(businessId, req);
    const payload = await this.crmStats.flowHighlights({ businessId, readsRevenue, viewerUserId: this.requireActorUserId(req) });
    return readsRevenue ? payload : withoutHighlightsMoney(payload);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/tasks/due')
  async dueTasks(
    @Param('businessId') businessId: string,
    @Req() req: { user?: { id?: string } },
    @Query('windowDays') windowDays?: string,
  ) {
    // W9-CRM-RESIDUALS (review SEC-L81-3, D-37): only the tasks of contacts the
    // member may open by the rule GET contacts/:contactId applies.
    return this.timeline.dueTasks({
      businessId,
      windowDays: windowDays ? Number(windowDays) : 7,
      visibility: await this.memberVisibility(businessId, req),
    });
  }

  /**
   * W9-CRM-RESIDUALS (review SEC-L81-3, SEC-W9CR-1; D-37): the session member's
   * CRM visibility clause, by the rule GET contacts/:contactId applies
   * (resolveCrmAccess + visibilityClause), for the business-wide reads that
   * name contacts (tasks/due, contact-next-actions, next-actions,
   * autopilot-actions, ai-next-actions): null for the OWNER and SUPER_ADMIN, so
   * their reads are unchanged. A request without a member is 401, a non-member
   * 403 (resolveCrmAccess).
   */
  private async memberVisibility(businessId: string, req: { user?: { id?: string } } | undefined): Promise<Prisma.ContactWhereInput | null> {
    const actorUserId = this.requireActorUserId(req);
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    return visibilityClause(access, actorUserId) as Prisma.ContactWhereInput | null;
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/tasks')
  async addTask(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: CreateTaskDto,
    @Req() req: any,
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
    return this.timeline.addTask({
      businessId,
      contactId,
      title: body.title,
      dueDate: body.dueDate,
      priority: body.priority,
      assigneeId: body.assigneeId,
      assigneeType: body.assigneeType,
      remindAt: body.remindAt,
      creatorId: req?.user?.id,
      source: body.source || 'crm',
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contact-next-actions')
  async listContactNextActions(
    @Param('businessId') businessId: string,
    @Req() req: { user?: { id?: string } },
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
    const parsed = { windowDays: parseIntParam(windowDays, 'windowDays'), limit: parseIntParam(limit, 'limit') };
    // W9-CRM-RESIDUALS review SEC-W9CR-1 (D-37): only the contacts the member may open.
    return this.crm.listNextActions({ businessId, ...parsed, visibility: await this.memberVisibility(businessId, req) });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(60, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/next-action/complete')
  async completeContactNextAction(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: any,
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
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
  async snoozeContactNextAction(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { snoozeUntil?: string; days?: number },
    @Req() req: any,
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
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
  async completeTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
    @Body() body: { evidenceIds?: string[] },
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleChildRow(businessId, 'task', taskId, req);
    return this.timeline.completeTask({ businessId, taskId, evidenceIds: body.evidenceIds });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/tasks/:taskId/reopen')
  async reopenTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleChildRow(businessId, 'task', taskId, req);
    return this.timeline.reopenTask({ businessId, taskId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/notes/:noteId')
  async updateNote(
    @Param('businessId') businessId: string,
    @Param('noteId') noteId: string,
    @Body() body: { body?: string; source?: string },
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleChildRow(businessId, 'note', noteId, req);
    return this.timeline.updateNote({ businessId, noteId, body: body.body, source: body.source });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Delete('businesses/:businessId/notes/:noteId')
  async deleteNote(
    @Param('businessId') businessId: string,
    @Param('noteId') noteId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleChildRow(businessId, 'note', noteId, req);
    return this.timeline.deleteNote({ businessId, noteId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Patch('businesses/:businessId/tasks/:taskId')
  async updateTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
    @Body() body: { title?: string; dueDate?: string; priority?: string; remindAt?: string },
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleChildRow(businessId, 'task', taskId, req);
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
  async deleteTask(
    @Param('businessId') businessId: string,
    @Param('taskId') taskId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleChildRow(businessId, 'task', taskId, req);
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
    @Req() req: { user?: { id?: string } },
    @Query('type') type?: string,
  ) {
    const actorUserId = this.requireActorUserId(req);
    if (!file || !file.buffer) {
      throw new BadRequestException('File is required');
    }
    const allowed: Array<'csv' | 'xlsx' | 'pdf' | 'image' | 'vcf'> = ['csv', 'xlsx', 'pdf', 'image', 'vcf'];
    const sourceType = allowed.includes(type as any) ? (type as 'csv' | 'xlsx' | 'pdf' | 'image' | 'vcf') : 'csv';
    // The importing member's edit scope and visibility apply to every row.
    return this.crmImport.createFileImport({
      businessId,
      sourceType,
      originalName: file.originalname,
      fileBuffer: file.buffer,
      actorUserId,
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/import/link')
  async importContactsFromLink(
    @Param('businessId') businessId: string,
    @Req() req: { user?: { id?: string } },
    @Body('url') url?: string,
  ) {
    const actorUserId = this.requireActorUserId(req);
    if (!url) {
      throw new BadRequestException('url is required');
    }
    return this.crmImport.createLinkImport({ businessId, sourceUrl: url, actorUserId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(5, 60_000)
  @Post('businesses/:businessId/import/image/ocr')
  async createContactFromOcr(
    @Param('businessId') businessId: string,
    @Body() body: { ocrText?: string; url?: string; type?: string },
    @Req() req: { user?: { id?: string } },
  ) {
    const actorUserId = this.requireActorUserId(req);
    if (!body?.ocrText) {
      throw new BadRequestException('ocrText is required');
    }
    return this.crmImport.createContactFromOcr({
      businessId,
      ocrText: body.ocrText,
      mediaUrl: body.url,
      type: body.type,
      actorUserId,
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
    @Req() req: { user?: { id?: string } },
  ) {
    const actorUserId = this.requireActorUserId(req);
    checkAiRateLimit(businessId);
    if (!image || !image.buffer) {
      throw new BadRequestException('Image file is required');
    }
    return this.crmImport.scanContactImage(businessId, image.buffer, image.mimetype, actorUserId);
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
  listImportRecords(
    @Param('businessId') businessId: string,
    @Param('importId') importId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    // A row linked to a contact is listed only when this member may open it.
    const actorUserId = this.requireActorUserId(req);
    return this.crmImport.listImportRecords(businessId, importId, actorUserId);
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
    @Req() req: { user?: { id?: string } },
    @Query('importId') importId?: string,
    @Query('minConfidence') minConfidence?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const min = minConfidence ? Number(minConfidence) : 0.5;
    const max = limit ? Math.min(Number(limit), 200) : 50;
    const off = offset ? Math.max(0, Number(offset)) : 0;
    const pageLimit = Number.isFinite(max) ? max : 50;
    const pageOffset = Number.isFinite(off) ? off : 0;
    // Trial-N repair round 2 recheck (CRM-DUP-HTTP, D-37): a pair, and a legacy group, names
    // contacts by id and row, so only the contacts the member may open by the rule GET detail
    // applies (resolveCrmAccess + visibilityClause) are answered, as the KEY dispatcher's
    // crm_find_duplicates does: a pair only when the member may open both contacts, a group only
    // with the two or more of its contacts they may open. Every pair is read and the page is cut
    // here, so total and the page count only the pairs they may see (the service sorts, then
    // slices, so for the OWNER the answer is the same as asking it for the page).
    const actorUserId = this.requireActorUserId(req);
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    const all = await this.duplicates.findCandidatesScoped({
      businessId,
      importId,
      minConfidence: Number.isFinite(min) ? min : 0.5,
      limit: Number.MAX_SAFE_INTEGER,
      offset: 0,
    });
    // Back-compat: also return legacy `groups` shape derived from pairs.
    const legacy = await this.crm.findDuplicates(businessId);
    const canOpen = await contactVisibilityFilter(this.prisma, businessId, access, actorUserId, [
      ...all.pairs.flatMap((pair) => [pair.primaryId, pair.duplicateId]),
      ...legacy.groups.flatMap((group) => group.contacts.map((c) => c.id)),
    ]);
    const pairs = canOpen ? all.pairs.filter((pair) => canOpen(pair.primaryId) && canOpen(pair.duplicateId)) : all.pairs;
    const groups = canOpen
      ? legacy.groups
          .map((group) => ({ ...group, contacts: group.contacts.filter((c) => canOpen(c.id)) }))
          .filter((group) => group.contacts.length > 1)
      : legacy.groups;
    return { pairs: pairs.slice(pageOffset, pageOffset + pageLimit), total: pairs.length, offset: off, limit: max, groups };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/log-communication')
  async logCommunication(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { channelType: string; outcome: string; duration?: number; notes?: string },
    @Req() req: any,
  ) {
    if (!body.channelType || !body.outcome) {
      throw new BadRequestException('channelType and outcome are required');
    }
    await this.assertVisibleContact(businessId, contactId, req);
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
  async createEvent(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: LogContactEventDto,
    @Req() req: any,
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
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
  async contactEvents(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    const { actorUserId } = await this.assertVisibleContact(businessId, contactId, req);
    // W6-CONTACT-EVENTS-MONEY (SEC-W5FC-1; D-90 / D-63): the reading member,
    // so CrmTimelineService.listContactEvents withholds the money events from a
    // member without revenue read. CrmService.listContactEvents hands these
    // params to it unchanged.
    const query: Parameters<CrmTimelineService['listContactEvents']>[0] = { businessId, contactId, viewerUserId: actorUserId };
    return this.crm.listContactEvents(query);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/notes')
  async contactNotes(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
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
  async getPlaybook(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    // Before getOrCreatePlaybook, which creates a row for any id it is given.
    await this.assertVisibleContact(businessId, contactId, req);
    return this.playbook.getOrCreatePlaybook({ businessId, contactId });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/playbook')
  async updatePlaybook(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { data: any; type?: string },
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
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
    return this.crm.createContactList({ ...body, businessId });
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
    return this.crm.updateContactList({ ...body, businessId, listId });
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
  async removeContactFromList(
    @Param('businessId') businessId: string,
    @Param('listId') listId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
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
  async getNextActions(@Param('businessId') businessId: string, @Req() req: { user?: { id?: string } }) {
    // W9-CRM-RESIDUALS review SEC-W9CR-1 (D-37): the tasks, quotes, invoices,
    // bookings, contacts and enrollments of contacts the member may open only.
    return this.actions.getNextActions(businessId, await this.memberVisibility(businessId, req));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/ai-next-actions')
  async getAiNextActions(@Param('businessId') businessId: string, @Req() req: { user?: { id?: string } }) {
    // W9-CRM-RESIDUALS review SEC-W9CR-1 (D-37): the prompt profiles, and so the
    // answer, only the contacts the member may open.
    return this.actions.getAiNextActions(businessId, await this.memberVisibility(businessId, req));
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
  async getAutopilotActions(@Param('businessId') businessId: string, @Req() req: { user?: { id?: string } }) {
    // W9-CRM-RESIDUALS review SEC-W9CR-1 (D-37): only the contacts the member may open.
    return this.actions.getAutopilotActions(businessId, await this.memberVisibility(businessId, req));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/predictive-revenue')
  getPredictiveRevenue(@Param('businessId') businessId: string, @Req() req: { user?: { id?: string } }) {
    // W8-MONEY-SIGNALS (owner ruling D-100; SEC-W7CMV-1): read for the session
    // member, so one without revenue read gets the shape with no figure in it.
    return this.revenue.getPredictiveRevenue(businessId, this.requireActorUserId(req));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/financial-growth')
  getFinancialGrowth(@Param('businessId') businessId: string, @Req() req: { user?: { id?: string } }) {
    // W8-MONEY-SIGNALS (owner ruling D-100; SEC-W7CMV-1): as predictive-revenue.
    return this.revenue.getFinancialGrowth(businessId, this.requireActorUserId(req));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/revenue-summary')
  async getContactRevenueSummary(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    const { actorUserId } = await this.assertVisibleContact(businessId, contactId, req);
    // W7-CONTACT-MONEY-VIEWS (V55-13g; D-90 / D-63): the reading member, so a
    // member without revenue read gets the summary with no figure in it.
    return this.revenue.getContactRevenueSummary(businessId, contactId, actorUserId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/health-metrics')
  async getContactHealthMetrics(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    const { actorUserId } = await this.assertVisibleContact(businessId, contactId, req);
    // W8-MONEY-SIGNALS (owner ruling D-100; SEC-W7CMV-3): the reading member, so
    // a member without revenue read gets no payment-health ratio.
    return this.journey.getContactHealthMetrics(businessId, contactId, actorUserId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/journey')
  async getContactJourney(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    const { actorUserId } = await this.assertVisibleContact(businessId, contactId, req);
    // W7-CONTACT-MONEY-VIEWS (V55-13g; D-90 / D-63): the reading member, so a
    // member without revenue read gets no quote or payment milestone.
    return this.journey.getContactJourney(businessId, contactId, actorUserId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/cross-journey')
  async getContactCrossJourney(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    const { actorUserId } = await this.assertVisibleContact(businessId, contactId, req);
    // W7-CONTACT-MONEY-VIEWS (V55-13f; D-90 / D-63): the reading member, so a
    // member without revenue read gets no money row and no money figure.
    return this.journey.getContactCrossJourney(businessId, contactId, actorUserId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/story')
  async getContactStory(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
    @Query('filter') filter?: string,
  ) {
    const { actorUserId } = await this.assertVisibleContact(businessId, contactId, req);
    // W7-CONTACT-MONEY-VIEWS (V55-13f; D-90 / D-63): the story is the reading
    // member's cross-journey, so ?filter=money finds no money row for a member
    // without revenue read.
    const result = await this.journey.getContactCrossJourney(businessId, contactId, actorUserId);
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
    @Req() req: { user?: { id?: string } },
  ) {
    const actorUserId = req?.user?.id;
    if (!actorUserId) {
      throw new UnauthorizedException('Authentication required');
    }
    // Authorization and the visible row come first. A request the caller may
    // not make never starts the journey, AI-insight or health lookups, which
    // read the same contact's related data.
    // W7-CONTACT-MONEY-VIEWS (V55-13f / V55-13h; D-90 / D-63): every part is
    // read for this member, so one without revenue read gets no money row and no
    // money figure in the contact, meta, timeline, summary or insight.
    // W8-MONEY-SIGNALS (owner ruling D-100; review SEC-W7CMV-3): so is
    // health.payment, the paid / total invoice ratio GET .../health-metrics
    // also serves: it is left out for that member (the web readers average and
    // draw the metrics served, review repair CR-W8MS-1). Review repairs
    // SEC-W8MS-1 / SEC-W8MS-4: the contact's stored lead score and
    // invoice-derived fields as GET contacts/:contactId serves them (detailFor).
    const detail = await this.detailFor(businessId, req, await this.crmStats.contactDetail({ businessId, contactId, actorUserId }));
    const [story, insight, health] = await Promise.all([
      this.journey.getContactCrossJourney(businessId, contactId, actorUserId),
      this.journey.generateAiInsight(businessId, contactId, actorUserId),
      this.journey.getContactHealthMetrics(businessId, contactId, actorUserId),
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
  async getConversationContext(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
    return this.journey.getConversationContext(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'write')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/favorite')
  async toggleFavorite(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
    return this.crm.toggleFavorite(businessId, contactId);
  }

  // ---------- M2 Unified Communication Inbox ----------

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
  @RequireModuleScope('crm', 'read')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/conversations')
  async listConversations(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user?: { id?: string } },
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('channel') channel?: string,
    @Query('direction') direction?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
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
    await this.assertVisibleContact(businessId, contactId, req);
    const state = await this.communication.markRead(businessId, userId, contactId);
    return { ok: true, lastReadAt: state.lastReadAt.toISOString() };
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
    await this.assertVisibleContact(businessId, contactId, req);
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
    @Req() req: { user?: { id?: string } },
    @Query('refresh') refresh?: string,
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
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
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
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
    @Req() req: { user?: { id?: string } },
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
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
    @Req() req: { user?: { id?: string } },
    @Query('messageRefs') messageRefs?: string,
  ) {
    await this.assertVisibleContact(businessId, contactId, req);
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
