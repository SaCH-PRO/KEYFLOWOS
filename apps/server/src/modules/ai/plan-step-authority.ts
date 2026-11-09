import { ForbiddenException } from '@nestjs/common';
import { LEVEL_RANK } from '../../core/authority/module-vocabulary';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { assertMayRunGraphAction, graphActionReadsContacts, graphActionRequirement } from './graph-actions.controller';

/**
 * KEY-R3b-PLAN-AUTHORITY (owner rulings D-71 and D-73, 2026-11-03; D-46): who a stored ai plan step
 * runs as, and what it may do, on the surfaces that run tools with no principal for the dispatcher:
 * the plan queue (QueueService.processPlanStep, PLAN_QUEUE, which also runs the plans
 * JourneyOrchestratorService, AgentTriggerService and MorningBriefingService write with no userId and
 * approve) and PRO_AUTO_MONITOR (FlowOrchestratorService.autoExecuteToolForMonitoring).
 *
 * D-73: a KEY plan always runs as a member, and one with no member principal may not write money or
 * invoices and may not read contacts. NOPRINCIPAL-SURFACES: with no principal the dispatcher's
 * contact reads (contactReadAccess) read every contact, PRIVATE ones included, and money writes ran
 * for no member.
 *
 * Kept in its own file, imported by the queue worker and (at call time) by the flow orchestrator,
 * which graph-actions.controller.ts itself imports.
 */

/**
 * Why a tool may not run with no member principal (D-73), or null when it may.
 *
 * KEY-R3b review: a contact read is known by what the tool does (graphActionReadsContacts: the
 * contact list tools, every crm-module read, and the crm tools that read contacts while they write,
 * such as segment_contacts), not by the four contact-list tools alone (SEC-R3b-1). And the gate
 * denies by default (SEC-R3b-2): a tool the authority map never runs (execute_custom_logic, which
 * re-enters the dispatcher for any tool) or maps to no module scope (an MCP tool, an unknown name)
 * is refused, as assertMayRunGraphAction refuses it to every member.
 */
export function noMemberToolRefusal(toolName: string): string | null {
  const requirement = graphActionRequirement(toolName);
  if (!requirement) {
    return `"${toolName}" is mapped to no module scope, so a KEY plan or monitor with no member principal does not run it (D-73: denied by default)`;
  }
  if ('refused' in requirement) {
    return `"${toolName}" is not executed for a KEY plan or monitor, whoever asks: ${requirement.refused} (D-73)`;
  }
  if (graphActionReadsContacts(toolName)) {
    return `"${toolName}" reads the business's contacts, and a KEY plan or monitor with no member principal reads no contacts (D-73)`;
  }
  const money = requirement.scopes.find(
    (s) => (s.module === 'revenue' || s.module === 'expenses') && LEVEL_RANK[s.minLevel] >= LEVEL_RANK.write,
  );
  if (money) {
    return `"${toolName}" writes the business's money or invoices (${money.module} write), and a KEY plan or monitor with no member principal writes neither (D-73)`;
  }
  return null;
}

/**
 * Why the plan queue may not run a step of `toolName` from plan `planId` now, or null when it may.
 * Checked when the worker runs the step (D-71: at run time), against the plan as stored:
 *   - a plan with no member (userId null): noMemberToolRefusal (D-73);
 *   - a member's plan: what that member would need to have the step run with no principal
 *     (assertMayRunGraphAction with noPrincipal, the rule POST ai/plans/:planId/approve applies to
 *     the approver): every module scope of the tool (D-71), the OWNER for an owner-only tool and for
 *     a contact read (graphActionReadsContacts: no visibility clause bounds it with no principal;
 *     D-37), the CRM sub-permission for a contact write, D-46 for a SUPER_ADMIN who is not a member;
 *   - the business owner by Business.ownerId holds every module, but a tool the authority map never
 *     runs (execute_custom_logic) is refused to the owner too (KEY-R3b review SEC-R3b-2).
 * A plan not of `businessId` is refused as not found.
 */
export async function planStepRunRefusal(
  prisma: PrismaService,
  businessId: string,
  planId: string,
  toolName: string,
): Promise<string | null> {
  return (await planStepRunAuthority(prisma, businessId, planId, toolName)).refusal;
}

export interface PlanStepRunOptions {
  /**
   * W4-PROPOSAL-PRINCIPAL (D-73; review SEC-W3CV-3): the step runs with the plan's member as its
   * principal (an approved AI_PLAN EXECUTE_TOOL proposal, KeyCortexActionExecutorPlugin, surface
   * PROPOSAL), so the dispatcher bounds its contact reads by that member's visibility clause
   * (contactReadAccess) and the member is held to the rule POST .../execute applies to a caller
   * (assertMayRunGraphAction with the member as principal: every module scope (D-71), the OWNER for an
   * owner-only tool, the CRM sub-permission, D-46) rather than the no-principal one. Default false:
   * the plan queue dispatches with no principal.
   */
  memberIsPrincipal?: boolean;
}

/**
 * planStepRunRefusal's answer and the member it judged: the plan's stored member (`AiPlan.userId`),
 * null for a plan with no member or not of `businessId`. A caller that runs the step as that member
 * (W4-PROPOSAL-PRINCIPAL) takes both from this one read of the plan, and `principalId`: the member
 * the dispatcher may take as the run's principal (memberIsPrincipal only; memberToolRunAuthority
 * says when), null when the step runs with no principal.
 */
export async function planStepRunAuthority(
  prisma: PrismaService,
  businessId: string,
  planId: string,
  toolName: string,
  options: PlanStepRunOptions = {},
): Promise<{ memberId: string | null; principalId: string | null; refusal: string | null }> {
  const plan = await prisma.client.aiPlan.findFirst({ where: { id: planId, businessId }, select: { userId: true } });
  if (!plan) return { memberId: null, principalId: null, refusal: 'Plan not found in this business' };
  if (!plan.userId) return { memberId: null, principalId: null, refusal: noMemberToolRefusal(toolName) };
  const memberId = plan.userId;
  const run = await memberToolRunAuthority(prisma, businessId, memberId, toolName, { asPrincipal: !!options.memberIsPrincipal });
  return { memberId, principalId: run.principal ? memberId : null, refusal: run.refusal };
}

/**
 * Why `memberId` may not run `toolName` in `businessId` now, or null when they may, and whether the
 * dispatcher may take them as the run's principal. The rule the plan queue applies to a plan's member
 * (planStepRunAuthority), shared with KeyCortexActionExecutorPlugin for the member an approved
 * proposal that is no plan step runs for (W4-PROPOSAL-PRINCIPAL review SEC-W4PP-2):
 *   - the business owner by Business.ownerId, the arm IdentityService.assertBusinessOwner admits beside
 *     the OWNER membership, holds every module (D-71), as the OWNER membership does, but a tool the
 *     authority map never runs (execute_custom_logic) is refused to the owner too (KEY-R3b review
 *     SEC-R3b-2). Review CR-W4PP-2: that owner is a principal only with a membership row. The
 *     dispatcher's CRM reads resolve the principal's access (resolveCrmAccess), which refuses a
 *     non-member, so an owner by Business.ownerId alone runs with no principal: the whole book, which
 *     is the owner's own view, as the plan queue runs their steps;
 *   - any other member: assertMayRunGraphAction with the member as the caller, either with no
 *     principal (`asPrincipal` false: the rule POST ai/plans/:planId/approve applies, so a contact read
 *     no visibility clause bounds is the OWNER's only) or as the principal (`asPrincipal`: the rule
 *     POST .../execute applies to its caller); module scopes (D-71), the CRM sub-permission, D-46 for a
 *     SUPER_ADMIN who is not a member.
 */
export async function memberToolRunAuthority(
  prisma: PrismaService,
  businessId: string,
  memberId: string,
  toolName: string,
  options: { asPrincipal?: boolean } = {},
): Promise<{ refusal: string | null; principal: boolean }> {
  const owned = await prisma.client.business.findFirst({ where: { id: businessId, ownerId: memberId }, select: { id: true } });
  if (owned) {
    const requirement = graphActionRequirement(toolName);
    const refusal = requirement && 'refused' in requirement ? `Tool "${toolName}" is not executed for a KEY plan, whoever asks: ${requirement.refused}` : null;
    const membership = options.asPrincipal
      ? await prisma.client.membership.findUnique({ where: { userId_businessId: { userId: memberId, businessId } }, select: { id: true } })
      : null;
    return { refusal, principal: !!membership };
  }
  const user = await prisma.client.user.findUnique({ where: { id: memberId }, select: { role: true } });
  try {
    await assertMayRunGraphAction(prisma, businessId, { id: memberId, role: user?.role ?? undefined }, toolName, memberId, {
      noPrincipal: !options.asPrincipal,
    });
    return { refusal: null, principal: !!options.asPrincipal };
  } catch (err) {
    if (err instanceof ForbiddenException) return { refusal: err.message, principal: false };
    throw err;
  }
}
