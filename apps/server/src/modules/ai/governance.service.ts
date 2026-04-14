import { Injectable, Logger, Inject, forwardRef, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { AiMemoryService } from './ai-memory.service';
import { getToolByName } from './flow-tool-registry';

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
  mode: 'advisory' | 'assisted' | 'pro_auto' | 'restricted';
  maxAutoTier: RiskTier;
  blockedTools: string[];
  blockedModules: string[];
}

const DEFAULT_AUTONOMY: AutonomySettings = {
  mode: 'assisted',
  maxAutoTier: 1,
  blockedTools: [],
  blockedModules: [],
};


@Injectable()
export class GovernanceService {
  private readonly logger = new Logger(GovernanceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AiExecutionLogService)) private readonly logService: AiExecutionLogService,
    @Inject(forwardRef(() => AiMemoryService)) private readonly memoryService: AiMemoryService,
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
  ): Promise<GovernanceDecision> {
    const tier = this.getToolTier(toolName);
    const settings = await this.getAutonomySettings(businessId);

    const blocked = { allowed: false, requiresQuickConfirm: false, requiresFormalApproval: false, requiresAdminApproval: false, tier };

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

    if (tier === 4) {
      return { ...auto, requiresAdminApproval: true, requiresFormalApproval: true, reason: 'Tier 4 action always requires admin-level approval — cannot be auto-approved' };
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

  async getAutonomySettings(businessId: string): Promise<AutonomySettings> {
    try {
      const memory = await this.prisma.client.aiMemory.findUnique({
        where: { businessId_category_key: { businessId, category: 'settings', key: 'autonomy' } },
      });
      if (memory?.value) {
        const parsed = JSON.parse(memory.value);
        return { ...DEFAULT_AUTONOMY, ...parsed };
      }
    } catch {
    }
    return { ...DEFAULT_AUTONOMY };
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

    if (typeof merged.maxAutoTier !== 'number' || merged.maxAutoTier < 1 || merged.maxAutoTier > 3) {
      merged.maxAutoTier = Math.max(1, Math.min(3, Number(merged.maxAutoTier) || 1)) as RiskTier;
    }
    await this.prisma.client.aiMemory.upsert({
      where: { businessId_category_key: { businessId, category: 'settings', key: 'autonomy' } },
      create: { businessId, category: 'settings', key: 'autonomy', value: JSON.stringify(merged), source: 'user' },
      update: { value: JSON.stringify(merged) },
    });
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
    return this.prisma.client.aiApprovalItem.create({
      data: {
        businessId,
        riskTier: tier,
        toolName: data.toolName,
        module: data.module || this.inferModule(data.toolName),
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

    const membership = await this.prisma.client.membership.findFirst({
      where: { userId: resolvedByUserId, businessId },
    });
    if (!membership) throw new NotFoundException('User is not a member of this business');

    const DEFAULT_TIERS: Record<string, number> = { OWNER: 4, ADMIN: 3, STAFF: 0 };
    const memberTier = (membership.maxApprovalTier !== null && membership.maxApprovalTier !== undefined && membership.maxApprovalTier > 0)
      ? membership.maxApprovalTier
      : (DEFAULT_TIERS[membership.role] ?? 0);
    if (item.riskTier > memberTier) {
      throw new ForbiddenException(`Tier ${item.riskTier} approvals require approval tier ${item.riskTier} or higher (you have tier ${memberTier})`);
    }

    await this.logService.log({
      businessId,
      action: `approval:${resolution}`,
      toolName: item.toolName,
      module: this.inferModule(item.toolName) ?? undefined,
      riskTier: item.riskTier,
      mode: 'governance',
      actor: 'user',
      rationale: `Approval ${approvalId} ${resolution} by user ${resolvedByUserId}`,
      success: true,
    });

    this.memoryService.recordApprovalSignal(businessId, item.toolName, resolution, {
      rationale: item.rationale ?? undefined,
      inputPayload: (item.inputPayload as Record<string, unknown>) ?? undefined,
    }).catch((e: unknown) => {
      this.logger.error(`Failed to record approval signal: ${e instanceof Error ? e.message : String(e)}`);
    });

    return this.prisma.client.aiApprovalItem.update({
      where: { id: approvalId },
      data: {
        status: resolution,
        resolvedAt: new Date(),
        resolvedBy: resolvedByUserId,
        resolvedByUserId,
        resolution,
      },
    });
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

  private inferModule(toolName: string): string | null {
    if (toolName.startsWith('crm_')) return 'crm';
    if (toolName.startsWith('commerce_')) return 'commerce';
    if (toolName.startsWith('bookings_')) return 'bookings';
    if (toolName.startsWith('marketing_')) return 'marketing';
    if (toolName.startsWith('social_')) return 'content';
    if (toolName.startsWith('automations_')) return 'automations';
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
