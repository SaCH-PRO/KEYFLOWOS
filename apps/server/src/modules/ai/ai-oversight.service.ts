import { Injectable, Logger, Inject, forwardRef, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { AiMemoryService } from './ai-memory.service';
import { getToolByName } from './flow-tool-registry';
import { RoleEngineService, BusinessRole } from './role-engine.service';
import { ApprovalRoutingService } from './approval-routing.service';

export type RiskTier = 1 | 2 | 3 | 4;

export interface GovernanceDecision {
  allowed: boolean;
  requiresQuickConfirm: boolean;
  requiresFormalApproval: boolean;
  requiresAdminApproval: boolean;
  tier: RiskTier;
  reason: string;
}

export interface AutonomySettings {
  mode: 'advisory' | 'assisted' | 'pro_auto' | 'restricted' | 'autopilot';
  maxAutoTier: RiskTier;
  blockedTools: string[];
  blockedModules: string[];
  autonomyLevel: number;
  approvedTools: string[];
  approvalTimeoutHours: number;
}

const DEFAULT_AUTONOMY: AutonomySettings = {
  mode: 'assisted',
  maxAutoTier: 1,
  blockedTools: [],
  blockedModules: [],
  autonomyLevel: 0,
  approvedTools: [],
  approvalTimeoutHours: 24,
};


@Injectable()
export class AiOversightService {
  private readonly logger = new Logger(AiOversightService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AiExecutionLogService)) private readonly logService: AiExecutionLogService,
    @Inject(forwardRef(() => AiMemoryService)) private readonly memoryService: AiMemoryService,
    @Inject(RoleEngineService) private readonly roleEngine: RoleEngineService,
    @Inject(ApprovalRoutingService) private readonly approvalRouting: ApprovalRoutingService,
  ) {}

  getToolTier(toolName: string): RiskTier {
    const tool = getToolByName(toolName);
    if (tool && tool.riskTier) {
      return tool.riskTier as RiskTier;
    }
    if (tool) {
      switch (tool.riskLevel) {
        case 'low': return 1;
        case 'medium': return 2;
        case 'high': return 3;
      }
    }
    return 2;
  }

  async evaluate(
    businessId: string,
    toolName: string,
    mode?: string,
    role?: BusinessRole,
  ): Promise<GovernanceDecision> {
    const tier = this.getToolTier(toolName);
    const settings = await this.getAutonomySettings(businessId);

    const blocked = { allowed: false, requiresQuickConfirm: false, requiresFormalApproval: false, requiresAdminApproval: false, tier };

    // Role-based tool filtering
    if (role && !this.roleEngine.isToolAllowed(role, toolName)) {
      return { ...blocked, reason: `Tool "${toolName}" is not available to the ${role} role` };
    }

    if (settings.blockedTools.includes(toolName)) {
      return { ...blocked, reason: `Tool "${toolName}" is blocked by business settings` };
    }

    const module = this.inferModule(toolName);
    if (module && settings.blockedModules.includes(module)) {
      return { ...blocked, reason: `Module "${module}" is blocked by business settings` };
    }

    const effectiveMode = (mode as AutonomySettings['mode']) || settings.mode;

    if (effectiveMode === 'restricted') {
      return { ...blocked, reason: 'AI is in restricted mode — no actions allowed' };
    }

    if (effectiveMode === 'advisory') {
      return { ...blocked, reason: 'AI is in advisory mode — suggestions only, no execution' };
    }

    const auto = { allowed: true, requiresQuickConfirm: false, requiresFormalApproval: false, requiresAdminApproval: false, tier };

    // Tier 4 hard stop — unless L4 autopilot with authority grant
    if (tier === 4) {
      const hasGrant = await this.hasValidAuthorityGrant(businessId, toolName);
      if (settings.autonomyLevel >= 5 && hasGrant && settings.approvedTools.includes(toolName)) {
        return { ...auto, reason: `Tier 4 auto-approved (autopilot mode + authority grant)` };
      }
      return { ...auto, requiresAdminApproval: true, requiresFormalApproval: true, reason: 'Tier 4 action requires admin-level approval — enable autopilot mode with authority grant to bypass' };
    }

    // AutopilotSettings-based auto-approval overrides
    if (settings.autonomyLevel >= 4 && tier <= 2) {
      return { ...auto, reason: `Tier ${tier} auto-approved (autonomy level 4)` };
    }
    if (settings.autonomyLevel >= 3 && tier === 1) {
      return { ...auto, reason: `Tier ${tier} auto-approved (autonomy level 3)` };
    }
    if (settings.approvedTools.includes(toolName)) {
      return { ...auto, reason: `Tool "${toolName}" is in the approved-tools list` };
    }

    if (tier <= settings.maxAutoTier) {
      return { ...auto, reason: `Tier ${tier} auto-approved (max auto tier: ${settings.maxAutoTier})` };
    }

    if (tier === 2) {
      return { ...auto, requiresQuickConfirm: true, reason: 'Tier 2 action requires quick confirmation before execution' };
    }

    if (tier === 3) {
      return { ...auto, requiresFormalApproval: true, reason: 'Tier 3 action requires explicit approval before execution' };
    }

    return { ...auto, requiresQuickConfirm: true, reason: `Tier ${tier} exceeds auto-execute threshold (${settings.maxAutoTier}), requires confirmation` };
  }

  async evaluateAutoApproval(
    businessId: string,
    toolName: string,
    opts?: { confidence?: number; timeoutHours?: number; role?: BusinessRole; planStepId?: string },
  ): Promise<GovernanceDecision & { autoApproved: boolean }> {
    const decision = await this.evaluate(businessId, toolName, undefined, opts?.role);
    if (!decision.allowed) return { ...decision, autoApproved: false };

    // Check if this step was pre-approved via aiApprovalItem
    if (opts?.planStepId) {
      const approvedItem = await this.prisma.client.aiApprovalItem.findFirst({
        where: { planStepId: opts.planStepId, status: 'approved' },
      });
      if (approvedItem) {
        return { ...decision, autoApproved: true, reason: 'Step pre-approved by user' };
      }
    }

    if (decision.requiresAdminApproval || decision.requiresFormalApproval) return { ...decision, autoApproved: false };

    const settings = await this.getAutonomySettings(businessId);

    // High confidence override
    if (opts?.confidence && opts.confidence > 0.9 && decision.tier <= 2) {
      return { ...decision, autoApproved: true, reason: `${decision.reason} (high confidence: ${Math.round(opts.confidence * 100)}%)` };
    }

    // Time-based auto-approval for quick-confirm items
    if (decision.requiresQuickConfirm && settings.autonomyLevel >= 2) {
      return { ...decision, autoApproved: true, requiresQuickConfirm: false, reason: `${decision.reason} — auto-approved by autonomy level ${settings.autonomyLevel}` };
    }

    return { ...decision, autoApproved: !decision.requiresQuickConfirm };
  }

  async getAutonomySettings(businessId: string): Promise<AutonomySettings> {
    // Try typed AutopilotSettings first
    try {
      const typed = await this.prisma.client.autopilotSettings.findUnique({
        where: { businessId },
      });
      if (typed) {
        return {
          mode: this.inferModeFromLevel(typed.autonomyLevel),
          maxAutoTier: Math.max(1, Math.min(4, typed.autonomyLevel)) as RiskTier,
          blockedTools: typed.blockedTools,
          blockedModules: [],
          autonomyLevel: typed.autonomyLevel,
          approvedTools: typed.approvedTools,
          approvalTimeoutHours: typed.approvalTimeoutHours,
        };
      }
    } catch {
      /* table may not exist yet */
    }

    // Fallback to AiMemory
    try {
      const memory = await this.prisma.client.aiMemory.findUnique({
        where: { businessId_category_key: { businessId, category: 'settings', key: 'autonomy' } },
      });
      if (memory?.value) {
        const parsed = JSON.parse(memory.value);
        return { ...DEFAULT_AUTONOMY, ...parsed };
      }
    } catch {
      /* intentionally empty */
    }
    return { ...DEFAULT_AUTONOMY };
  }

  private inferModeFromLevel(level: number): AutonomySettings['mode'] {
    if (level <= 0) return 'advisory';
    if (level <= 1) return 'assisted';
    if (level <= 3) return 'pro_auto';
    if (level >= 5) return 'autopilot';
    return 'pro_auto';
  }

  async updateAutonomySettings(businessId: string, updates: Partial<AutonomySettings>, userId?: string): Promise<AutonomySettings> {
    if (userId) {
      const user = await this.prisma.client.user.findUnique({ where: { id: userId } });
      const membership = await this.prisma.client.membership.findFirst({
        where: { userId, businessId },
      });
      const isAdmin = user?.role === 'SUPER_ADMIN' || membership?.role === 'OWNER' || membership?.role === 'ADMIN';
      if (!isAdmin) {
        throw new ForbiddenException('Only admins can update AI governance settings');
      }
    }

    const current = await this.getAutonomySettings(businessId);
    const merged = { ...current, ...updates };

    if (typeof merged.maxAutoTier !== 'number' || merged.maxAutoTier < 1 || merged.maxAutoTier > 4) {
      merged.maxAutoTier = Math.max(1, Math.min(4, Number(merged.maxAutoTier) || 1)) as RiskTier;
    }
    await this.prisma.client.aiMemory.upsert({
      where: { businessId_category_key: { businessId, category: 'settings', key: 'autonomy' } },
      create: { businessId, category: 'settings', key: 'autonomy', value: JSON.stringify(merged), source: 'user' },
      update: { value: JSON.stringify(merged) },
    });

    if (userId) {
      this.prisma.client.teamActivityLog.create({
        data: {
          businessId,
          userId,
          module: 'settings',
          action: 'ai_governance_updated',
          entityType: 'aiSettings',
          title: `Updated AI governance settings (mode: ${merged.mode}, max tier: ${merged.maxAutoTier})`,
          meta: { mode: merged.mode, maxAutoTier: merged.maxAutoTier },
        },
      }).catch((e: unknown) => {
        this.logger.warn(`Failed to log governance settings change: ${e instanceof Error ? e.message : String(e)}`);
      });
    }

    return merged;
  }

  async createApprovalItem(businessId: string, data: {
    toolName: string;
    title: string;
    description?: string;
    rationale?: string;
    expectedBenefit?: string;
    risks?: string;
    inputPayload?: any;
    affectedEntities?: any;
    planId?: string;
    planStepId?: string;
    module?: string;
  }) {
    const tier = this.getToolTier(data.toolName);
    const module = data.module || this.inferModule(data.toolName);
    const item = await this.prisma.client.aiApprovalItem.create({
      data: {
        businessId,
        riskTier: tier,
        toolName: data.toolName,
        module,
        title: data.title,
        description: data.description,
        rationale: data.rationale,
        expectedBenefit: data.expectedBenefit,
        risks: data.risks,
        inputPayload: data.inputPayload,
        affectedEntities: data.affectedEntities,
        planId: data.planId,
        planStepId: data.planStepId,
      },
    });

    this.routeAndNotify(businessId, item, tier, module).catch((e: unknown) => {
      this.logger.error(`Approval routing failed for item ${item.id}: ${e instanceof Error ? e.message : String(e)}`);
    });

    return item;
  }

  /**
   * Resolve who should approve this item from the business's org-hierarchy
   * data (DelegationRule -> JobRole default tier -> business owner), record
   * the resolution, and push a real-time notification. Fire-and-forget from
   * createApprovalItem — an unresolved/failed route just means the item sits
   * in the existing shared queue with no proactive ping, nothing is lost.
   */
  private async routeAndNotify(
    businessId: string,
    item: { id: string; title: string; description: string | null },
    tier: RiskTier,
    module: string | null,
  ): Promise<void> {
    const route = await this.approvalRouting.resolveApprover(businessId, { tier, module });
    await this.prisma.client.aiApprovalItem.update({
      where: { id: item.id },
      data: { approverAssignmentId: route.approverAssignmentId, approverMethod: route.method },
    });

    if (route.method === 'unresolved') {
      this.logger.warn(`Approval item ${item.id} (tier ${tier}) has no resolvable approver — sits in the shared queue.`);
      return;
    }

    const notifyResult = await this.approvalRouting.notifyApprover(businessId, route, { id: item.id, title: item.title, description: item.description, riskTier: tier });
    if (notifyResult.sent) {
      await this.prisma.client.aiApprovalItem.update({ where: { id: item.id }, data: { notifiedAt: new Date() } });
    } else if (notifyResult.error) {
      this.logger.warn(`Failed to notify approver for item ${item.id}: ${notifyResult.error}`);
    }

    // Tier-4 (admin-level) actions always additionally notify the business
    // owner as a safety net, even when a different position was correctly
    // resolved — guards against a misconfigured JobRole.defaultApprovalTier.
    if (tier === 4 && route.method !== 'owner_fallback') {
      const ownerRoute = await this.approvalRouting.resolveOwner(businessId);
      if (ownerRoute) {
        const ownerNotify = await this.approvalRouting.notifyApprover(businessId, ownerRoute, { id: item.id, title: item.title, description: item.description, riskTier: tier });
        if (!ownerNotify.sent && ownerNotify.error) {
          this.logger.warn(`Failed to CC owner for tier-4 item ${item.id}: ${ownerNotify.error}`);
        }
      }
    }
  }

  async resolveApproval(
    approvalId: string,
    businessId: string,
    resolution: 'approved' | 'rejected' | 'deferred',
    resolvedByUserId: string,
  ) {
    const item = await this.prisma.client.aiApprovalItem.findFirst({
      where: { id: approvalId, businessId },
    });
    if (!item) throw new NotFoundException(`Approval item ${approvalId} not found for business ${businessId}`);

    if (item.status !== 'pending') {
      throw new BadRequestException(`Approval item is already resolved (status: "${item.status}") — cannot re-resolve`);
    }

    const user = await this.prisma.client.user.findUnique({ where: { id: resolvedByUserId } });
    const isSuperAdmin = user?.role === 'SUPER_ADMIN';

    const membership = await this.prisma.client.membership.findFirst({
      where: { userId: resolvedByUserId, businessId },
    });
    if (!membership && !isSuperAdmin) throw new NotFoundException('User is not a member of this business');

    if (!isSuperAdmin) {
      const DEFAULT_TIERS: Record<string, number> = { OWNER: 4, ADMIN: 3, STAFF: 0 };
      const hasCustomScopes = membership!.permissionScopes !== null && membership!.permissionScopes !== undefined;
      const memberTier = (membership!.maxApprovalTier !== null && membership!.maxApprovalTier !== undefined && (hasCustomScopes || membership!.maxApprovalTier !== 0))
        ? membership!.maxApprovalTier
        : (DEFAULT_TIERS[membership!.role] ?? 0);
      if (item.riskTier > memberTier) {
        throw new ForbiddenException(`Tier ${item.riskTier} approvals require approval tier ${item.riskTier} or higher (you have tier ${memberTier})`);
      }
    }

    return this.finalizeResolution(item, businessId, resolution, {
      resolvedByUserId,
      teamActivityUserId: resolvedByUserId,
    });
  }

  /**
   * Reply-based approval for a staff position resolved as the item's approver
   * (see ApprovalRoutingService). Unlike resolveApproval, this does NOT
   * require a Membership — contact-only positions (no login) authorize
   * purely off their JobRole.defaultApprovalTier, gated on autoApprovalViaReply
   * being explicitly on for that position.
   */
  async resolveApprovalByAssignment(
    approvalId: string,
    businessId: string,
    assignmentId: string,
    resolution: 'approved' | 'rejected' | 'deferred',
  ) {
    const item = await this.prisma.client.aiApprovalItem.findFirst({
      where: { id: approvalId, businessId },
    });
    if (!item) throw new NotFoundException(`Approval item ${approvalId} not found for business ${businessId}`);
    if (item.status !== 'pending') {
      throw new BadRequestException(`Approval item is already resolved (status: "${item.status}") — cannot re-resolve`);
    }
    if (item.approverAssignmentId !== assignmentId) {
      throw new ForbiddenException('This position is not the resolved approver for this item');
    }

    const assignment = await this.prisma.client.orgAssignment.findFirst({
      where: { id: assignmentId, businessId, endedAt: null },
      include: { jobRole: true },
    });
    if (!assignment) throw new NotFoundException('Approver assignment not found or ended');
    if (!assignment.autoApprovalViaReply) {
      throw new ForbiddenException('This position is not authorized for reply-based approval');
    }

    const effectiveTier = assignment.jobRole?.defaultApprovalTier ?? 0;
    if (item.riskTier > effectiveTier) {
      throw new ForbiddenException(`Tier ${item.riskTier} approvals require approval tier ${item.riskTier} or higher (position has tier ${effectiveTier})`);
    }

    return this.finalizeResolution(item, businessId, resolution, {
      resolvedByUserId: assignment.userId ?? null,
      teamActivityUserId: assignment.userId ?? undefined,
    });
  }

  /** Shared tail for both resolveApproval() and resolveApprovalByAssignment(). */
  private async finalizeResolution(
    item: { id: string; toolName: string; riskTier: number; rationale: string | null; inputPayload: unknown; planStepId: string | null },
    businessId: string,
    resolution: 'approved' | 'rejected' | 'deferred',
    opts: { resolvedByUserId: string | null; teamActivityUserId?: string },
  ) {
    await this.logService.log({
      businessId,
      action: `approval:${resolution}`,
      toolName: item.toolName,
      module: this.inferModule(item.toolName) ?? undefined,
      riskTier: item.riskTier,
      mode: 'governance',
      actor: 'user',
      rationale: `Approval ${item.id} ${resolution} by ${opts.resolvedByUserId ?? 'delegated staff position'}`,
      success: true,
    });

    this.memoryService.recordApprovalSignal(businessId, item.toolName, resolution, {
      rationale: item.rationale ?? undefined,
      inputPayload: (item.inputPayload as Record<string, unknown>) ?? undefined,
    }).catch((e: unknown) => {
      this.logger.error(`Failed to record approval signal: ${e instanceof Error ? e.message : String(e)}`);
    });

    // TeamActivityLog.userId is non-nullable — a contact-only approver (no
    // Membership/User) has no real user id to attach here, so skip the log
    // rather than write a bogus value. The AiApprovalItem row + execution
    // log above still give a full audit trail.
    if (opts.teamActivityUserId) {
      this.prisma.client.teamActivityLog.create({
        data: {
          businessId,
          userId: opts.teamActivityUserId,
          module: 'ai',
          action: `approval_${resolution}`,
          entityType: 'aiApprovalItem',
          entityId: item.id,
          title: `${resolution.charAt(0).toUpperCase() + resolution.slice(1)} AI approval: ${item.toolName} (tier ${item.riskTier})`,
          detail: item.rationale ?? null,
          meta: { toolName: item.toolName, riskTier: item.riskTier, resolution },
        },
      }).catch((e: unknown) => {
        this.logger.warn(`Failed to log team activity for approval: ${e instanceof Error ? e.message : String(e)}`);
      });
    }

    const updated = await this.prisma.client.aiApprovalItem.update({
      where: { id: item.id },
      data: {
        status: resolution,
        resolvedAt: new Date(),
        resolvedBy: opts.resolvedByUserId ?? 'key_delegate',
        resolvedByUserId: opts.resolvedByUserId,
        resolution,
      },
    });

    // If approved and linked to a plan step, update the step status so it can be executed
    if (resolution === 'approved' && item.planStepId) {
      await this.prisma.client.aiPlanStep.update({
        where: { id: item.planStepId },
        data: { status: 'pending' },
      });
    }

    return updated;
  }

  async getPendingApprovals(businessId: string, limit = 20) {
    return this.prisma.client.aiApprovalItem.findMany({
      where: { businessId, status: 'pending' },
      orderBy: [{ riskTier: 'desc' }, { createdAt: 'asc' }],
      take: limit,
    });
  }

  async getApprovalHistory(businessId: string, limit = 50) {
    return this.prisma.client.aiApprovalItem.findMany({
      where: { businessId, status: { not: 'pending' } },
      orderBy: { resolvedAt: 'desc' },
      take: limit,
    });
  }

  async resolveApprovalsBatch(
    businessId: string,
    approvalIds: string[],
    resolution: 'approved' | 'rejected',
    resolvedByUserId: string,
  ) {
    const results = await Promise.allSettled(
      approvalIds.map((id) => this.resolveApproval(id, businessId, resolution, resolvedByUserId)),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    return { succeeded, failed, total: approvalIds.length };
  }

  async escalateStaleApprovals(businessId: string): Promise<number> {
    const settings = await this.getAutonomySettings(businessId);
    const cutoff = new Date(Date.now() - settings.approvalTimeoutHours * 60 * 60 * 1000);

    const stale = await this.prisma.client.aiApprovalItem.findMany({
      where: {
        businessId,
        status: 'pending',
        createdAt: { lt: cutoff },
      },
    });

    let escalated = 0;
    for (const item of stale) {
      // For tier 1-2 items, auto-resolve as approved if autonomy level >= 3
      if (item.riskTier <= 2 && settings.autonomyLevel >= 3) {
        await this.prisma.client.aiApprovalItem.update({
          where: { id: item.id },
          data: {
            status: 'approved',
            resolvedAt: new Date(),
            resolution: 'Auto-approved after timeout by autonomy level 3+',
          },
        });
        if (item.planStepId) {
          await this.prisma.client.aiPlanStep.update({
            where: { id: item.planStepId },
            data: { status: 'pending' },
          });
        }
        escalated++;
      } else {
        // Otherwise mark as escalated
        await this.prisma.client.aiApprovalItem.update({
          where: { id: item.id },
          data: {
            status: 'escalated',
            resolution: `Auto-escalated after ${settings.approvalTimeoutHours} hours without resolution`,
          },
        });
        escalated++;
      }
    }

    return escalated;
  }

  private async hasValidAuthorityGrant(businessId: string, toolName: string): Promise<boolean> {
    try {
      const scope = this.inferAuthorityScope(toolName);
      if (!scope) return false;

      const grant = await this.prisma.client.authorityGrant.findFirst({
        where: {
          businessId,
          granteeType: 'KEY',
          granteeId: 'key_ai',
          scope,
          revokedAt: null,
          validFrom: { lte: new Date() },
          OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
        },
      });
      return !!grant;
    } catch {
      return false;
    }
  }

  private inferAuthorityScope(toolName: string): string | null {
    if (toolName.startsWith('marketing_send_') || toolName.startsWith('social_publish_')) return 'tier4_publishing';
    if (toolName.startsWith('commerce_') || toolName.startsWith('approval_')) return 'tier4_financial';
    if (toolName.startsWith('content_deliver_') || toolName.startsWith('content_upload_')) return 'tier4_operations';
    return null;
  }

  private inferModule(toolName: string): string | null {
    if (toolName.startsWith('crm_')) return 'crm';
    if (toolName.startsWith('commerce_')) return 'commerce';
    if (toolName.startsWith('bookings_')) return 'bookings';
    if (toolName.startsWith('marketing_')) return 'marketing';
    if (toolName.startsWith('social_')) return 'content';
    if (toolName.startsWith('automations_')) return 'automations';
    if (toolName.startsWith('delegation_')) return 'autopilot';
    if (toolName.startsWith('structure_')) return 'structure';
    if (toolName.startsWith('procurement_')) return 'procurement';
    if (toolName.startsWith('fetch_')) return 'intelligence';
    if (toolName.startsWith('draft_')) return 'drafts';
    if (toolName.startsWith('create_') || toolName.startsWith('tag_') || toolName.startsWith('segment_') || toolName.startsWith('schedule_')) return 'organize';
    if (toolName.startsWith('queue_') || toolName.startsWith('send_') || toolName.startsWith('apply_') || toolName.startsWith('enable_') || toolName.startsWith('update_status')) return 'execute';
    return null;
  }

  getTierDescription(tier: RiskTier): string {
    switch (tier) {
      case 1: return 'Safe — auto-execute (read, create drafts, tag, organize)';
      case 2: return 'Quick confirm — brief user acknowledgment (create invoices, reschedule, toggle automations)';
      case 3: return 'Explicit approval — user reviews details before proceeding (delete, cancel, irreversible changes)';
      case 4: return 'Admin override — requires admin-level approval (send campaigns, publish content, financial commits)';
    }
  }
}
