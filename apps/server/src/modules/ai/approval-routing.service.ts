import { Injectable, Logger, Inject } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../core/prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { SystemEmailService } from '../notifications/system-email.service';

export type ApprovalRouteMethod = 'delegation_rule' | 'job_role_match' | 'owner_fallback' | 'unresolved';

export interface ApprovalRouteResult {
  approverAssignmentId: string | null;
  approverMembershipId: string | null;
  approverUserId: string | null;
  displayName: string | null;
  channel: 'whatsapp' | 'sms' | 'email' | null;
  contactPhone: string | null;
  contactEmail: string | null;
  method: ApprovalRouteMethod;
  reason: string;
}

/**
 * Resolves WHO should approve a KEY action requiring sign-off, using the
 * business's org-hierarchy data (DelegationRule -> JobRole default tier ->
 * business owner fallback), and pushes a real-time notification to them on
 * their preferred channel. This is the missing link between the structure
 * module (previously write-only for DelegationRule) and AiOversightService's
 * approval flow.
 */
@Injectable()
export class ApprovalRoutingService {
  private readonly logger = new Logger(ApprovalRoutingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  private getWhatsApp() {
    return this.moduleRef.get(WhatsAppService, { strict: false });
  }

  private getSystemEmail() {
    return this.moduleRef.get(SystemEmailService, { strict: false });
  }

  async resolveApprover(businessId: string, opts: { tier: number; module?: string | null }): Promise<ApprovalRouteResult> {
    const { tier, module } = opts;
    const now = new Date();

    const rules = await this.prisma.client.delegationRule.findMany({
      where: {
        businessId,
        isActive: true,
        maxTier: { gte: tier },
        activeFrom: { lte: now },
        OR: [{ activeUntil: null }, { activeUntil: { gte: now } }],
        ...(module ? { scope: { in: [module, 'ALL'] } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    const rule = rules.find((r) => r.scope === module) ?? rules.find((r) => r.scope === 'ALL') ?? rules[0];
    if (rule) {
      const assignment = await this.prisma.client.orgAssignment.findFirst({
        where: { id: rule.delegateId, businessId, endedAt: null },
        include: { jobRole: true, membership: { include: { user: true } } },
      });
      if (assignment) {
        return this.toResult(assignment, 'delegation_rule', `Delegated via rule "${rule.scope}" (max tier ${rule.maxTier})`);
      }
      this.logger.warn(`DelegationRule ${rule.id} points at a missing/ended OrgAssignment ${rule.delegateId}`);
    }

    const candidate = await this.prisma.client.orgAssignment.findFirst({
      where: { businessId, endedAt: null, jobRole: { defaultApprovalTier: { gte: tier } } },
      include: { jobRole: true, membership: { include: { user: true } } },
      orderBy: [{ jobRole: { defaultApprovalTier: 'asc' } }],
    });
    if (candidate) {
      return this.toResult(candidate, 'job_role_match', `Matched position "${candidate.jobRole?.name}" (approval tier ${candidate.jobRole?.defaultApprovalTier})`);
    }

    const owner = await this.prisma.client.membership.findFirst({
      where: { businessId, role: 'OWNER' },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    if (owner) {
      return {
        approverAssignmentId: null,
        approverMembershipId: owner.id,
        approverUserId: owner.userId,
        displayName: owner.user?.name ?? owner.user?.email ?? 'Business owner',
        channel: owner.user?.phone ? 'whatsapp' : 'email',
        contactPhone: owner.user?.phone ?? null,
        contactEmail: owner.user?.email ?? null,
        method: 'owner_fallback',
        reason: 'No delegation rule or qualifying position found — routed to business owner',
      };
    }

    return {
      approverAssignmentId: null,
      approverMembershipId: null,
      approverUserId: null,
      displayName: null,
      channel: null,
      contactPhone: null,
      contactEmail: null,
      method: 'unresolved',
      reason: 'No delegation rule, qualifying position, or business owner could be found',
    };
  }

  /** Notify the resolved business owner directly — used as an additional tier-4 safety net. */
  async resolveOwner(businessId: string): Promise<ApprovalRouteResult | null> {
    const owner = await this.prisma.client.membership.findFirst({
      where: { businessId, role: 'OWNER' },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) return null;
    return {
      approverAssignmentId: null,
      approverMembershipId: owner.id,
      approverUserId: owner.userId,
      displayName: owner.user?.name ?? owner.user?.email ?? 'Business owner',
      channel: owner.user?.phone ? 'whatsapp' : 'email',
      contactPhone: owner.user?.phone ?? null,
      contactEmail: owner.user?.email ?? null,
      method: 'owner_fallback',
      reason: 'Tier-4 admin-level action — owner notified as a safety net alongside the resolved approver',
    };
  }

  private toResult(
    assignment: {
      id: string;
      membershipId: string | null;
      userId: string | null;
      contactName: string | null;
      contactEmail: string | null;
      contactPhone: string | null;
      preferredChannel: string;
      membership?: { user?: { name: string | null; email: string } | null } | null;
    },
    method: ApprovalRouteMethod,
    reason: string,
  ): ApprovalRouteResult {
    const rawChannel = assignment.preferredChannel ?? 'email';
    return {
      approverAssignmentId: assignment.id,
      approverMembershipId: assignment.membershipId,
      approverUserId: assignment.userId,
      displayName: assignment.contactName ?? assignment.membership?.user?.name ?? assignment.membership?.user?.email ?? null,
      channel: rawChannel === 'none' ? null : (rawChannel as 'whatsapp' | 'sms' | 'email'),
      contactPhone: assignment.contactPhone ?? null,
      contactEmail: assignment.contactEmail ?? assignment.membership?.user?.email ?? null,
      method,
      reason,
    };
  }

  async notifyApprover(
    businessId: string,
    route: ApprovalRouteResult,
    item: { id: string; title: string; description?: string | null; riskTier: number },
  ): Promise<{ sent: boolean; error?: string }> {
    if (!route.channel) return { sent: false, error: 'No notification channel available' };
    const body = `KEY needs your approval (Tier ${item.riskTier}): ${item.title}${item.description ? `\n${item.description}` : ''}\nReply YES to approve or NO to reject, or open the app: /app/approvals`;

    if ((route.channel === 'whatsapp' || route.channel === 'sms') && route.contactPhone) {
      const wa = this.getWhatsApp();
      if (!wa) return { sent: false, error: 'WhatsApp service unavailable' };
      const result = await wa.sendMessage(businessId, { to: route.contactPhone, body });
      return { sent: result.success, error: result.error };
    }
    if (route.channel === 'email' && route.contactEmail) {
      const email = this.getSystemEmail();
      if (!email?.isConfigured()) return { sent: false, error: 'System email not configured' };
      try {
        await email.sendTransactional({
          to: route.contactEmail,
          subject: `Approval needed: ${item.title}`,
          html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
        });
        return { sent: true };
      } catch (err: any) {
        return { sent: false, error: err?.message ?? 'Email send failed' };
      }
    }
    return { sent: false, error: 'No usable contact channel for the resolved approver' };
  }
}
