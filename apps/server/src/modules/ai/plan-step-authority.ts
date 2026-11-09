import { ForbiddenException } from '@nestjs/common';
import { LEVEL_RANK } from '../../core/authority/module-vocabulary';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { GRAPH_ACTION_CONTACT_READ_TOOLS, assertMayRunGraphAction, graphActionRequirement } from './graph-actions.controller';

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

/** Why a tool may not run with no member principal (D-73), or null when it may. */
export function noMemberToolRefusal(toolName: string): string | null {
  if (GRAPH_ACTION_CONTACT_READ_TOOLS.has(toolName)) {
    return `"${toolName}" reads the business's contacts, and a KEY plan or monitor with no member principal reads no contacts (D-73)`;
  }
  const requirement = graphActionRequirement(toolName);
  if (requirement && !('refused' in requirement)) {
    const money = requirement.scopes.find(
      (s) => (s.module === 'revenue' || s.module === 'expenses') && LEVEL_RANK[s.minLevel] >= LEVEL_RANK.write,
    );
    if (money) {
      return `"${toolName}" writes the business's money or invoices (${money.module} write), and a KEY plan or monitor with no member principal writes neither (D-73)`;
    }
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
 *     a contact read (no visibility clause bounds it with no principal; D-37), the CRM
 *     sub-permission for a contact write, D-46 for a SUPER_ADMIN who is not a member.
 * A plan not of `businessId` is refused as not found.
 */
export async function planStepRunRefusal(
  prisma: PrismaService,
  businessId: string,
  planId: string,
  toolName: string,
): Promise<string | null> {
  const plan = await prisma.client.aiPlan.findFirst({ where: { id: planId, businessId }, select: { userId: true } });
  if (!plan) return 'Plan not found in this business';
  if (!plan.userId) return noMemberToolRefusal(toolName);
  // The business owner by Business.ownerId, the arm IdentityService.assertBusinessOwner admits beside
  // the OWNER membership, holds every module (D-71), as the OWNER membership does below.
  const owned = await prisma.client.business.findFirst({ where: { id: businessId, ownerId: plan.userId }, select: { id: true } });
  if (owned) return null;
  const user = await prisma.client.user.findUnique({ where: { id: plan.userId }, select: { role: true } });
  try {
    await assertMayRunGraphAction(prisma, businessId, { id: plan.userId, role: user?.role ?? undefined }, toolName, plan.userId, {
      noPrincipal: true,
    });
    return null;
  } catch (err) {
    if (err instanceof ForbiddenException) return err.message;
    throw err;
  }
}
