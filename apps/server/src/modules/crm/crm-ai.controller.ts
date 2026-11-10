import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CrmAiService, type ContactScope } from './crm-ai.service';
import { CrmJourneyService } from './crm-journey.service';
import { ContactInsightService } from './contact-insight.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmRateLimitGuard, CrmRateLimit } from './guards/rate-limit.guard';
import { FeatureFlagGuard, RequireFeature } from './guards/feature-flag.guard';
import { checkAiRateLimit } from './ai-rate-limit.util';
import { assertContactVisible, contactVisibilityFilter, resolveCrmAccess, visibilityClause } from './crm-permissions.helper';
import { contactWhereBase, contactWhereWithId } from './crm.helpers';

/**
 * The ai-execute actions that rewrite the contact row's own fields: status
 * (change_status) and tags (toggle_favorite), which PATCH crm
 * contacts/:contactId otherwise writes. They hold that route's edit scope
 * (V1-89 (d), review SEC-V89-1). The other single-contact actions write a
 * child row or a membership of the contact (add_note, add_task,
 * log_communication, the list and sequence actions) and keep the rule of
 * their own routes (POST contacts/:contactId/notes, tasks, log-communication,
 * the list and sequence routes): record visibility.
 */
const CONTACT_EDIT_ACTIONS: ReadonlySet<string> = new Set(['change_status', 'toggle_favorite']);

/**
 * Every route requires CRM module scope (ModuleScopeGuard): crm write where the
 * handler writes a contact or business row (ai-score, ai-analyze/execute, POST
 * ai-guidelines, ai-execute), crm read otherwise. A route that names a contact
 * in its path answers only for a contact the caller may open by the GET crm
 * contacts/:contactId rule (V1-08 assertContactVisible): a hidden contact gets
 * the same 404 'Contact not found' as an unknown id, before the AI rate limit
 * is counted and before any service runs (FOLLOW3-D3).
 *
 * The routes that take a contact id in the body hold the same rule (review
 * ST-2): ai-execute answers 404 for a hidden contactId before the action runs
 * (its change_status and toggle_favorite also hold PATCH contacts/:contactId's
 * edit scope, CONTACT_EDIT_ACTIONS; V1-89 review SEC-V89-1), ai-analyze
 * answers 404 when one of its contactIds is a contact the caller
 * cannot open, exactly as for an unknown id, before the AI rate limit is
 * counted (V1-89), and ai-analyze/execute creates tasks only for the contacts
 * the caller may open, counting a hidden contact as failed exactly like an
 * unknown one.
 *
 * Everything else that reads the business's contacts reads only those the
 * caller may open (V1-89, FOLLOW3-D3 residual ST-2): the caller's visibility
 * clause (crm-permissions.helper visibilityClause, the GET crm contacts rule)
 * is handed to CrmAiService, which applies it to the AI prompts (ai-command,
 * ai-analyze, ai-churn-risk, ai-search) and to the deterministic scans
 * (ai-data-quality, ai-duplicates, ai-reengagement, ai-revenue-opportunities),
 * so their lists and their aggregate counts leave hidden contacts out. The
 * OWNER and SUPER_ADMIN have no clause and read as before. ai-execute's
 * bulk_status_change changes only the matching contacts the caller may open
 * and edit, the rule PATCH crm contacts/bulk applies (V1-89 (d)): a caller
 * whose crm_edit is 'none' is refused 403, and a matching contact outside the
 * caller's reach is left as it is and is not counted. It writes through
 * CrmService.bulkUpdateContacts as that route does (audit entry, timeline
 * event and cache invalidation; review SEC-V89-2), with its params checked
 * first (review SEC-V89-3).
 *
 * W8-MONEY-SIGNALS (owner ruling D-100; review SEC-W7CMV-2): GET
 * contacts/:contactId/ai-insight and the insight card (GET insight-card, POST
 * insight-card/recompute) are read for the session member (sessionMember: no
 * member is 401, never the owner's view). A member without revenue read gets
 * the insight without its payment sentence or 'high-value' tag
 * (CrmJourneyService.generateAiInsight) and the card without money
 * (ContactInsightService.getSnapshot, which serves such a member, or a call
 * naming none, the money-free card instead of the cached one).
 */
@Controller('crm')
@UseGuards(CrmRateLimitGuard)
export class CrmAiController {
  constructor(
    @Inject(CrmAiService) private readonly crmAi: CrmAiService,
    @Inject(CrmJourneyService) private readonly journey: CrmJourneyService,
    @Inject(ContactInsightService) private readonly contactInsight: ContactInsightService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/insight-card')
  async getInsightCard(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user: { id: string } },
  ) {
    const member = this.sessionMember(req);
    await assertContactVisible(this.prisma, businessId, contactId, member);
    return this.contactInsight.getSnapshot(businessId, contactId, { viewerUserId: member });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/insight-card/recompute')
  async recomputeInsightCard(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user: { id: string } },
  ) {
    const member = this.sessionMember(req);
    await assertContactVisible(this.prisma, businessId, contactId, member);
    checkAiRateLimit(businessId);
    await this.contactInsight.recompute(businessId, contactId);
    // The card just cached, as GET insight-card serves it to this member (D-100).
    return this.contactInsight.getSnapshot(businessId, contactId, { viewerUserId: member });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/contacts/:contactId/ai-insight')
  async getAiInsight(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user: { id: string } },
  ) {
    const member = this.sessionMember(req);
    await assertContactVisible(this.prisma, businessId, contactId, member);
    checkAiRateLimit(businessId);
    return this.journey.generateAiInsight(businessId, contactId, member);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/ai-tags')
  async aiSuggestTags(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user: { id: string } },
  ) {
    await assertContactVisible(this.prisma, businessId, contactId, req.user.id);
    checkAiRateLimit(businessId);
    return this.crmAi.suggestTags(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/ai-prep-brief')
  async aiPrepBrief(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user: { id: string } },
  ) {
    await assertContactVisible(this.prisma, businessId, contactId, req.user.id);
    checkAiRateLimit(businessId);
    return this.crmAi.generatePrepBrief(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-command')
  async aiCommand(
    @Param('businessId') businessId: string,
    @Body() body: { command: string },
    @Req() req: { user: { id: string } },
  ) {
    if (!body.command || typeof body.command !== 'string') {
      throw new BadRequestException('command is required');
    }
    if (body.command.length > 500) {
      throw new BadRequestException('command must be 500 characters or less');
    }
    const scope = await this.contactScope(businessId, req.user.id);
    checkAiRateLimit(businessId);
    return this.crmAi.interpretCommand(businessId, body.command, scope);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-analyze')
  async aiAnalyze(
    @Param('businessId') businessId: string,
    @Body() body: { prompt: string; contactIds?: string[] },
    @Req() req: { user: { id: string } },
  ) {
    if (!body.prompt || typeof body.prompt !== 'string') {
      throw new BadRequestException('prompt is required');
    }
    if (body.prompt.length > 2000) {
      throw new BadRequestException('prompt must be 2000 characters or less');
    }
    if (Array.isArray(body.contactIds) && body.contactIds.length > 100) {
      throw new BadRequestException('Maximum 100 contactIds per request');
    }
    const scope = await this.contactScope(businessId, req.user.id);
    const contactIds = Array.isArray(body.contactIds) && body.contactIds.length > 0 ? body.contactIds.map(String) : undefined;
    if (contactIds) await this.assertEveryContactVisible(businessId, contactIds, scope);
    checkAiRateLimit(businessId);
    return this.crmAi.analyzeContacts(businessId, body.prompt, contactIds, scope);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'write')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-analyze/execute')
  async aiExecuteTasks(
    @Param('businessId') businessId: string,
    @Req() req: any,
    @Body() body: { tasks: Array<{ contactId: string; contactName?: string; title: string; dueDate: string; priority: 'HIGH' | 'NORMAL' | 'LOW' }> },
  ) {
    if (!Array.isArray(body.tasks) || body.tasks.length === 0) {
      throw new BadRequestException('tasks array is required');
    }
    if (body.tasks.length > 100) {
      throw new BadRequestException('Maximum 100 tasks per request');
    }
    const userId = req.user?.id ?? req.user?.sub ?? 'system';
    const canOpen = await this.visibleContacts(businessId, req.user.id, body.tasks.map((t) => t?.contactId));
    if (!canOpen) return this.crmAi.executeTasks(businessId, userId, body.tasks);
    // A task on a contact the caller cannot open is not created and counts as
    // failed, exactly like a task on an unknown contact id.
    const visible = body.tasks.filter((t) => typeof t?.contactId === 'string' && canOpen(t.contactId));
    const hidden = body.tasks.length - visible.length;
    if (visible.length === 0) return { created: 0, failed: hidden };
    const result = await this.crmAi.executeTasks(businessId, userId, visible);
    return { created: result.created, failed: result.failed + hidden };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(120, 60_000)
  @Get('businesses/:businessId/ai-guidelines')
  getAiGuidelines(@Param('businessId') businessId: string) {
    return this.crmAi.getGuidelines(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'write')
  @RequireFeature('ai_tools')
  @CrmRateLimit(30, 60_000)
  @Post('businesses/:businessId/ai-guidelines')
  saveAiGuidelines(
    @Param('businessId') businessId: string,
    @Body() body: { guidelines: string[] },
  ) {
    if (!Array.isArray(body.guidelines)) {
      throw new BadRequestException('guidelines array is required');
    }
    return this.crmAi.saveGuidelines(businessId, body.guidelines);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/ai-summary')
  async aiContactSummary(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user: { id: string } },
  ) {
    await assertContactVisible(this.prisma, businessId, contactId, req.user.id);
    checkAiRateLimit(businessId);
    return this.crmAi.summarizeContact(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'write')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/ai-score')
  async aiLeadScore(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user: { id: string } },
  ) {
    await assertContactVisible(this.prisma, businessId, contactId, req.user.id);
    checkAiRateLimit(businessId);
    return this.crmAi.scoreContactWithAi(businessId, contactId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/ai-note-analysis')
  async aiNoteAnalysis(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Body() body: { noteBody: string; noteId?: string },
    @Req() req: { user: { id: string } },
  ) {
    if (!body.noteBody || typeof body.noteBody !== 'string') {
      throw new BadRequestException('noteBody is required');
    }
    if (body.noteBody.length > 5000) {
      throw new BadRequestException('Note too long (max 5000 chars)');
    }
    await assertContactVisible(this.prisma, businessId, contactId, req.user.id);
    checkAiRateLimit(businessId);
    return this.crmAi.analyzeNote(businessId, contactId, body.noteBody, body.noteId);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai-churn-risk')
  async aiChurnDetection(@Param('businessId') businessId: string, @Req() req: { user: { id: string } }) {
    const scope = await this.contactScope(businessId, req.user.id);
    checkAiRateLimit(businessId);
    return this.crmAi.detectChurnRisk(businessId, scope);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-search')
  async aiNaturalLanguageSearch(
    @Param('businessId') businessId: string,
    @Body() body: { query: string },
    @Req() req: { user: { id: string } },
  ) {
    if (!body.query || typeof body.query !== 'string') {
      throw new BadRequestException('query is required');
    }
    if (body.query.length > 500) {
      throw new BadRequestException('Query too long (max 500 chars)');
    }
    const scope = await this.contactScope(businessId, req.user.id);
    checkAiRateLimit(businessId);
    // W9-MONEY-RANKING (D-100): the viewer, so no money signal orders a revenue-none member's search.
    return this.crmAi.naturalLanguageSearch(businessId, body.query, scope, req.user.id);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'write')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-execute')
  async aiExecuteCommand(
    @Param('businessId') businessId: string,
    @Req() req: any,
    @Body() body: { action: string; contactId?: string; params?: Record<string, unknown> },
  ) {
    if (!body.action || typeof body.action !== 'string') {
      throw new BadRequestException('action is required');
    }
    if (body.contactId !== undefined && body.contactId !== null && body.contactId !== '') {
      if (CONTACT_EDIT_ACTIONS.has(body.action)) {
        await this.assertContactEditable(businessId, String(body.contactId), req.user.id);
      } else {
        await assertContactVisible(this.prisma, businessId, String(body.contactId), req.user.id);
      }
    }
    const editableScope = body.action === 'bulk_status_change' ? await this.editableScope(businessId, req.user.id) : null;
    const userId = req.user?.id ?? req.user?.sub ?? 'system';
    return this.crmAi.executeAiCommand(businessId, userId, {
      action: body.action,
      contactId: body.contactId ?? null,
      params: body.params ?? {},
    }, editableScope);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai-data-quality')
  async aiDataQuality(@Param('businessId') businessId: string, @Req() req: { user: { id: string } }) {
    return this.crmAi.dataQualityScan(businessId, await this.contactScope(businessId, req.user.id));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai-duplicates')
  async aiFindDuplicates(@Param('businessId') businessId: string, @Req() req: { user: { id: string } }) {
    // Clusters are formed from the contacts the caller may open only: a
    // cluster is two or more of them.
    return this.crmAi.findDuplicatesAi(businessId, await this.contactScope(businessId, req.user.id));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai-reengagement')
  async aiReengagement(@Param('businessId') businessId: string, @Req() req: { user: { id: string } }) {
    return this.crmAi.bulkReengagementSuggestions(businessId, await this.contactScope(businessId, req.user.id));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai-revenue-opportunities')
  async aiRevenueOpportunities(@Param('businessId') businessId: string, @Req() req: { user: { id: string } }) {
    return this.crmAi.revenueOpportunityScan(businessId, await this.contactScope(businessId, req.user.id));
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/contacts/:contactId/ai-follow-up-draft')
  async aiFollowUpDraft(
    @Param('businessId') businessId: string,
    @Param('contactId') contactId: string,
    @Req() req: { user: { id: string } },
  ) {
    await assertContactVisible(this.prisma, businessId, contactId, req.user.id);
    checkAiRateLimit(businessId);
    return this.crmAi.generateFollowUpDraft(businessId, contactId);
  }

  /**
   * The session member a money-bearing read is served for (W8-MONEY-SIGNALS,
   * D-100). Fails closed: a request without one is 401, so these reads never
   * fall back to the owner's view (the guards already refuse such a request).
   */
  private sessionMember(req: { user?: { id?: string } } | undefined): string {
    const member = req?.user?.id;
    if (!member) throw new UnauthorizedException('Authentication required');
    return member;
  }

  /**
   * The caller's CRM visibility clause (visibilityClause, the GET crm contacts
   * rule) for CrmAiService's contact reads; null when nothing is hidden from
   * the caller (OWNER, SUPER_ADMIN), whose reads are left as they were (V1-89).
   */
  private async contactScope(businessId: string, actorUserId: string): Promise<ContactScope> {
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    return visibilityClause(access, actorUserId) as Prisma.ContactWhereInput | null;
  }

  /**
   * ai-analyze's named contacts: every one must be a live contact of the
   * business the caller may open, or the call answers 404 'Contact not found'
   * exactly as for an unknown id, before the AI is called (V1-89).
   */
  private async assertEveryContactVisible(businessId: string, contactIds: string[], scope: ContactScope): Promise<void> {
    const ids = [...new Set(contactIds)];
    const where: Prisma.ContactWhereInput = { ...contactWhereBase(businessId), id: { in: ids } };
    if (scope) where.AND = [scope];
    const found = await this.prisma.client.contact.count({ where });
    if (found !== ids.length) throw new NotFoundException('Contact not found');
  }

  /**
   * The edit gate of an ai-execute action that rewrites the contact row's own
   * fields (CONTACT_EDIT_ACTIONS), in the order PATCH crm contacts/:contactId
   * applies it (CrmService.assertCanEditContact; V1-89 (d), review
   * SEC-V89-1): a caller whose crm_edit is 'none' is refused 403 before the
   * contact is looked up; a contact the caller cannot open answers 404 'Contact
   * not found' like an unknown id; a visible contact outside crm_edit 'owned'
   * (neither owned by nor shared with the caller) is refused 403. The OWNER
   * and SUPER_ADMIN pass on any live contact of the business.
   */
  private async assertContactEditable(businessId: string, contactId: string, actorUserId: string): Promise<void> {
    const editable = await this.editableScope(businessId, actorUserId);
    await assertContactVisible(this.prisma, businessId, contactId, actorUserId);
    if (!editable) return;
    const found = await this.prisma.client.contact.count({ where: { ...contactWhereWithId(businessId, contactId), AND: [editable] } });
    if (found === 0) throw new ForbiddenException('You can only edit contacts you own');
  }

  /**
   * The contacts the caller may edit (V1-89 (d)): the rule PATCH crm
   * contacts/bulk applies (CrmService.editableContactClause): those the
   * caller may open (visibilityClause) and, for crm_edit 'owned', owns or has
   * been shared. A caller whose crm_edit is 'none' is refused 403 as that
   * route refuses it. Null for the OWNER and SUPER_ADMIN. bulk_status_change
   * changes only these; assertContactEditable gates a single contact on it.
   */
  private async editableScope(businessId: string, actorUserId: string): Promise<ContactScope> {
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    if (access.isOwner || access.isSuperAdmin) return null;
    if (access.editScope === 'none') {
      throw new ForbiddenException('You do not have permission to edit contacts');
    }
    const clauses: Prisma.ContactWhereInput[] = [];
    const visClause = visibilityClause(access, actorUserId);
    if (visClause) clauses.push(visClause as Prisma.ContactWhereInput);
    if (access.editScope !== 'any') {
      clauses.push({ OR: [{ ownerId: actorUserId }, { shares: { some: { userId: actorUserId } } }] });
    }
    return clauses.length > 0 ? { AND: clauses } : null;
  }

  /**
   * Which of `contactIds` the caller may open, by the GET contacts/:contactId
   * rule (contactVisibilityFilter); null when nothing is hidden from the caller
   * (OWNER, SUPER_ADMIN), whose answers are left exactly as they were.
   */
  private async visibleContacts(
    businessId: string,
    actorUserId: string,
    contactIds: Iterable<string | null | undefined>,
  ): Promise<((contactId: string) => boolean) | null> {
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    return contactVisibilityFilter(this.prisma, businessId, access, actorUserId, contactIds);
  }
}
