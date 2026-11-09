import { Injectable, Logger, Inject } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../core/prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { SystemEmailService } from '../notifications/system-email.service';
import { redactAddresses } from '../../core/security/redaction';

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
 * A phone-shaped number in free text: an optional '+', then at least seven
 * digits with at most two separators (space, parenthesis, dot or hyphen)
 * between any two of them.
 */
const PHONE_PATTERN = /\+?\d(?:[\s().-]{0,2}\d){6,}/g;

/**
 * W6-LOG-ADDRESSES-AND-DOCS repair (9B-D2, review SEC-W6LOG-1): free text with
 * every address-shaped token (`<address>`, the shared redactAddresses) and
 * every phone-shaped number (`<phone>`) replaced. The approval notify-failure
 * text carries no recipient on either leg: notifyApprover returns it this way,
 * and AiOversightService.routeAndNotify's two notify-failure lines log through
 * it. Short numbers such as a provider error code stay.
 */
export function redactContactDetails(text: string): string {
  return redactAddresses(text).replace(PHONE_PATTERN, '<phone>');
}

/**
 * The error code in a provider's JSON error body (Twilio `code`, Meta
 * `error.code`): '' for a JSON body with none, undefined for text that is not
 * a JSON object.
 */
function providerErrorCode(text: string): string | undefined {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!body || typeof body !== 'object') return undefined;
  const record = body as { code?: unknown; error?: unknown };
  const nested = record.error && typeof record.error === 'object' ? (record.error as { code?: unknown }).code : undefined;
  const code = record.code ?? nested;
  if (typeof code === 'number' && Number.isFinite(code)) return redactContactDetails(String(code));
  if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,32}$/.test(code)) return redactContactDetails(code);
  return '';
}

/**
 * W6-LOG-ADDRESSES-AND-DOCS repair (9B-D2, review SEC-W6LOG-1): the WhatsApp
 * leg's failure as notifyApprover returns it. WhatsAppService.sendMessage
 * returns the provider's raw response body as `error` when Twilio or Meta
 * refuse a send (sendViaTwilio, sendViaMeta), and that body can quote the
 * recipient's number (Twilio's invalid-To text names `whatsapp:+...`). A
 * provider body leaves as its error code only, never its text; any other text
 * (WhatsAppService's own reasons, a transport error, a body that is not JSON)
 * keeps its words with every phone number and address redacted.
 */
function whatsAppFailure(error: string | undefined): string {
  if (!error) return 'WhatsApp send failed';
  const code = providerErrorCode(error);
  if (code === undefined) return redactContactDetails(error);
  return code ? `WhatsApp provider refused the send (code ${code})` : 'WhatsApp provider refused the send (no error code)';
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
      // W6-LOG-ADDRESSES-AND-DOCS repair (9B-D2, review SEC-W6LOG-1): the
      // provider's response body can quote the recipient's number, and this
      // text is only ever logged (routeAndNotify), so it leaves as the
      // provider code, or redacted (whatsAppFailure). The message itself and
      // the conversation history row are unchanged.
      return result.success ? { sent: true } : { sent: false, error: whatsAppFailure(result.error) };
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
        // W6-LOG-ADDRESSES-AND-DOCS (9B-D2, review SEC-W5SEC-1): this text is
        // only ever logged (AiOversightService.routeAndNotify), and the system
        // email sender's error can quote the recipient, so it leaves here with
        // every address redacted (and, since the repair for SEC-W6LOG-1, every
        // phone-shaped number, as on the WhatsApp leg).
        return { sent: false, error: redactContactDetails(String(err?.message ?? 'Email send failed')) };
      }
    }
    return { sent: false, error: 'No usable contact channel for the resolved approver' };
  }
}
