import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CrmAiService } from './crm-ai.service';
import { CrmJourneyService } from './crm-journey.service';
import { ContactInsightService } from './contact-insight.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmRateLimitGuard, CrmRateLimit } from './guards/rate-limit.guard';
import { FeatureFlagGuard, RequireFeature } from './guards/feature-flag.guard';
import { checkAiRateLimit } from './ai-rate-limit.util';
import { assertContactVisible, contactVisibilityFilter, resolveCrmAccess } from './crm-permissions.helper';

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
 * ST-2): ai-execute answers 404 for a hidden contactId before the action runs,
 * and ai-analyze/execute creates tasks only for the contacts the caller may
 * open, counting a hidden contact as failed exactly like an unknown one.
 * ai-execute's bulk_status_change rewrites every matching contact of the
 * business, which the service cannot narrow to a member's visible rows, so it
 * is refused (403) to a caller whose CRM visibility is restricted. The
 * deterministic business scans (ai-data-quality, ai-duplicates,
 * ai-reengagement, ai-revenue-opportunities, ai-search) drop each entry that
 * names a contact the caller cannot open. Residual (CrmAiService, outside this
 * write set): the AI routes' prompt context and the scans' aggregate counts
 * are still built over every contact of the business.
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
    await assertContactVisible(this.prisma, businessId, contactId, req.user.id);
    return this.contactInsight.getSnapshot(businessId, contactId);
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
    await assertContactVisible(this.prisma, businessId, contactId, req.user.id);
    checkAiRateLimit(businessId);
    return this.contactInsight.recompute(businessId, contactId);
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
    await assertContactVisible(this.prisma, businessId, contactId, req.user.id);
    checkAiRateLimit(businessId);
    return this.journey.generateAiInsight(businessId, contactId);
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
  aiCommand(
    @Param('businessId') businessId: string,
    @Body() body: { command: string },
  ) {
    if (!body.command || typeof body.command !== 'string') {
      throw new BadRequestException('command is required');
    }
    if (body.command.length > 500) {
      throw new BadRequestException('command must be 500 characters or less');
    }
    checkAiRateLimit(businessId);
    return this.crmAi.interpretCommand(businessId, body.command);
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-analyze')
  aiAnalyze(
    @Param('businessId') businessId: string,
    @Body() body: { prompt: string; contactIds?: string[] },
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
    checkAiRateLimit(businessId);
    return this.crmAi.analyzeContacts(businessId, body.prompt, body.contactIds);
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
  aiChurnDetection(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.crmAi.detectChurnRisk(businessId);
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
    checkAiRateLimit(businessId);
    const result = await this.crmAi.naturalLanguageSearch(businessId, body.query);
    const canOpen = await this.visibleContacts(businessId, req.user.id, result.contacts.map((c) => c.id));
    if (!canOpen) return result;
    const contacts = result.contacts.filter((c) => canOpen(c.id));
    return { ...result, contacts, totalResults: contacts.length };
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
      await assertContactVisible(this.prisma, businessId, String(body.contactId), req.user.id);
    }
    if (body.action === 'bulk_status_change') {
      const access = await resolveCrmAccess(this.prisma, businessId, req.user.id);
      if (!access.isOwner && !access.isSuperAdmin) {
        throw new ForbiddenException(
          'Bulk status change by AI command reaches every contact of the business, so it is limited to the business owner',
        );
      }
    }
    const userId = req.user?.id ?? req.user?.sub ?? 'system';
    return this.crmAi.executeAiCommand(businessId, userId, {
      action: body.action,
      contactId: body.contactId ?? null,
      params: body.params ?? {},
    });
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai-data-quality')
  async aiDataQuality(@Param('businessId') businessId: string, @Req() req: { user: { id: string } }) {
    const scan = await this.crmAi.dataQualityScan(businessId);
    const canOpen = await this.visibleContacts(businessId, req.user.id, scan.topIssues.map((i) => i.contactId));
    if (!canOpen) return scan;
    return { ...scan, topIssues: scan.topIssues.filter((i) => canOpen(i.contactId)) };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai-duplicates')
  async aiFindDuplicates(@Param('businessId') businessId: string, @Req() req: { user: { id: string } }) {
    const result = await this.crmAi.findDuplicatesAi(businessId);
    const canOpen = await this.visibleContacts(
      businessId,
      req.user.id,
      result.duplicateClusters.flatMap((cluster) => cluster.contacts.map((c) => c.id)),
    );
    if (!canOpen) return result;
    // A cluster keeps the contacts the caller may open, and is a cluster only
    // while two of them remain.
    const duplicateClusters = result.duplicateClusters
      .map((cluster) => ({ ...cluster, contacts: cluster.contacts.filter((c) => canOpen(c.id)) }))
      .filter((cluster) => cluster.contacts.length > 1);
    return {
      ...result,
      duplicateClusters,
      estimatedDuplicates: duplicateClusters.reduce((sum, cluster) => sum + cluster.contacts.length - 1, 0),
    };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai-reengagement')
  async aiReengagement(@Param('businessId') businessId: string, @Req() req: { user: { id: string } }) {
    const result = await this.crmAi.bulkReengagementSuggestions(businessId);
    const canOpen = await this.visibleContacts(businessId, req.user.id, result.suggestions.map((s) => s.contactId));
    if (!canOpen) return result;
    const suggestions = result.suggestions.filter((s) => canOpen(s.contactId));
    return { ...result, suggestions, totalStale: suggestions.length };
  }

  @UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard, FeatureFlagGuard)
  @RequireModuleScope('crm', 'read')
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Get('businesses/:businessId/ai-revenue-opportunities')
  async aiRevenueOpportunities(@Param('businessId') businessId: string, @Req() req: { user: { id: string } }) {
    const result = await this.crmAi.revenueOpportunityScan(businessId);
    const canOpen = await this.visibleContacts(businessId, req.user.id, result.opportunities.map((o) => o?.contactId));
    if (!canOpen) return result;
    return { ...result, opportunities: result.opportunities.filter((o) => o != null && canOpen(o.contactId)) };
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
