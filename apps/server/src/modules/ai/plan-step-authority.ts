import { ForbiddenException } from '@nestjs/common';
import { LEVEL_RANK, memberModuleLevel, rankOf } from '../../core/authority/module-vocabulary';
import type { PrismaService } from '../../core/prisma/prisma.service';
import { CANONICAL_MODULE_TOOLS, GOVERNED_UNGRANTED } from '../structure/job-role-policy.service';
import { keyOrganToolAuthority } from '../key-cortex/key-cortex-organ-tool-authority';
import {
  KEY_BOOKS_MEMBERSHIP_READ_TOOLS,
  NO_MEMBER_LEDGER_WRITE_TOOLS,
  assertMayRunGraphAction,
  graphActionBoundByContactVisibility,
  graphActionExtraScopes,
  graphActionReadsContacts,
  graphActionRequirement,
  isExplicitScopeMap,
  type GraphActionScope,
} from './graph-actions.controller';

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
 * W4-D93-NO-MEMBER-CONTACTS (owner ruling D-93): D-73 stands as written. A plan with no member reads
 * no contacts, the tools only the principal's visibility bounds included (fetch_client_health,
 * sequence_enroll_overdue, sequence_enroll, the calendar and booking reads), which ran in the OWNER's
 * view before (D-88's convention, now narrowed to D-88's own writes). The Pro Auto monitor and every
 * system-created plan run with the business owner as their member instead (systemPlanMember).
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
  // W4-D93-NO-MEMBER-CONTACTS (D-93, D-73): a tool whose contact rows only the principal's visibility
  // bounds (GRAPH_ACTION_VISIBILITY_BOUND_TOOLS) reads every contact with no principal, so a plan or
  // monitor with no member runs none of them either (review SEC-W3CV-2).
  if (graphActionBoundByContactVisibility(toolName)) {
    return `"${toolName}" reads the business's contacts (only a member principal's visibility bounds them), and a KEY plan or monitor with no member principal reads no contacts (D-73, D-93)`;
  }
  // W8-CALL-TASK-NO-MEMBER (D-73; review CR-W7CTC-1): call_create_task names a contact and records the
  // member the run is for as its caller (W7-CALL-TASK-CALLER, D-88), so a run with no member has no
  // caller to record. Its dispatcher case refuses such a run, but only once dispatched, where
  // ActionDispatcherService retries the refusal and counts it toward the tool's circuit breaker, which
  // it keys by tool name alone (five refusals stopped the tool for every business). Refused here, before
  // dispatch, on every surface that reads this gate:
  //   - the plan queue: a plan with no member that is not the daily briefing (D-93);
  //   - the Pro Auto monitor run for no member (a business with no owner). Run for the owner (D-93) it
  //     passes and records the owner as the caller; since this answer is not null, its execution log
  //     row withholds the tool's arguments and answer (the owner's view, SEC-D93-2);
  //   - the proposal executor (review CR-W8CTNM-1, a change on that surface): an AI_PLAN proposal of a
  //     plan with no member, or with no stored plan, ran before for the member who executed it and
  //     recorded them as the caller; it is now refused before dispatch. W4-PROPOSAL-PRINCIPAL: a plan
  //     step's proposal runs as the plan's member, the approver neither widens nor narrows that run, and
  //     a plan with no member has none (D-73). Any other proposal still runs for the member who executes
  //     it (memberToolRunAuthority).
  // Review SEC-W8CTNM-1 (open, outside this gate): only a run with no member is kept out of the breaker.
  // A member's step whose call_create_task is refused inside dispatch (a contact they may not open: 404;
  // an owner by Business.ownerId alone or a SUPER_ADMIN who is no member: 403) still counts toward it.
  if (toolName === 'call_create_task') {
    return `"${toolName}" names a contact and records the member it runs for as the caller, and a KEY plan or monitor with no member principal has no member to record (D-73)`;
  }
  // PR195-PORT (D-73; owner PR #195 part 2): marking a payroll run paid now posts the disbursement to the
  // ledger (PayrollService.markRunPaid -> the ledger door), so it is a money write though its route reads the
  // operations scope; a run with no member principal does not pay payroll. Narrower than before the port.
  if (NO_MEMBER_LEDGER_WRITE_TOOLS.has(toolName)) {
    return `"${toolName}" posts the business's money to the ledger, and a KEY plan or monitor with no member principal writes no money (D-73)`;
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
 *   - a plan with no member (userId null): noMemberToolRefusal (D-73), unless only the system can
 *     have written it (a daily briefing; systemPlanMember, D-93): then the business owner is its
 *     member, as below;
 *   - a member's plan: what that member would need to have the step run with no principal
 *     (assertMayRunGraphAction with noPrincipal, the rule POST ai/plans/:planId/approve applies to
 *     the approver): every module scope of the tool (D-71), the OWNER for an owner-only tool and for
 *     a contact read (graphActionReadsContacts: no visibility clause bounds it with no principal;
 *     D-37), the CRM sub-permission for a contact write, D-46 for a SUPER_ADMIN who is not a member;
 *   - the business owner (an OWNER membership: owner rulings D-116, D-125) runs every tool the
 *     authority map does not map (D-119) and holds every module (the OWNER defaults) unless its
 *     membership carries an explicit scope map, which binds it as it binds any member (review
 *     SEC-W11D116K-1); with no such map it also runs every mapped KEY organ (dotted) tool, the
 *     connector reads whose connect read no role default holds included (W11A-SEAM-REPAIR, D-131
 *     binds members), but a tool the authority map never runs (execute_custom_logic) is refused to
 *     the owner too (KEY-R3b review SEC-R3b-2).
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
 * the business owner for a plan the system stored with no member (systemPlanMember, D-93), null for
 * any other plan with no member or one not of `businessId`. A caller that runs the step as that member
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
  const plan = await prisma.client.aiPlan.findFirst({ where: { id: planId, businessId }, select: SYSTEM_PLAN_MARKERS });
  if (!plan) return { memberId: null, principalId: null, refusal: 'Plan not found in this business' };
  // W4-D93-NO-MEMBER-CONTACTS (D-93): a plan only the system can have stored with no member runs as the owner.
  const memberId = plan.userId ?? (await systemPlanOwner(prisma, businessId, plan));
  if (!memberId) return { memberId: null, principalId: null, refusal: noMemberToolRefusal(toolName) };
  const run = await memberToolRunAuthority(prisma, businessId, memberId, toolName, { asPrincipal: !!options.memberIsPrincipal });
  return { memberId, principalId: run.principal ? memberId : null, refusal: run.refusal };
}

/** What systemPlanOwner reads of a stored plan: its member and the markers its source writes. */
const SYSTEM_PLAN_MARKERS = { userId: true, objective: true, rawInput: true, scope: true } as const;

/**
 * W4-D93-NO-MEMBER-CONTACTS (owner ruling D-93): the member a plan stored with no member runs as,
 * when only the system can have written it, or null. The Pro Auto monitor and every system-created
 * plan run with the business owner (Business.ownerId, read now, so an ownership transfer is followed)
 * as their member. Since D-93 the system writers record the owner on the plan they write
 * (AgentTriggerService for a default rule, JourneyOrchestratorService for a journey an event the
 * system emitted starts, MorningBriefingService); a plan stored with no member before D-93 is resolved
 * to the owner when it runs, rather than by migrating rows, only when its stored markers are ones no
 * member can have shaped: the daily briefing's scope, objective prefix and raw input, which only
 * MorningBriefingService writes, over cards it computes itself.
 *
 * Review SEC-D93-1 and SEC-D93-3: a memberless journey plan or a plan with a default rule's objective
 * and raw input is not taken as the system's. A journey's plan may come from POST
 * journeys/:key/trigger, whose client payload becomes its steps' arguments, and a plan with a default
 * rule's markers may come from a member's copy of the rule at a higher risk tier, another condition
 * or with auto-approval; the stored plan tells neither apart from the system's, so D-73 holds for them.
 * Any other plan with no member (a trigger a member created that records no creator, a KEY-cortex plan
 * no member created) has none, and D-73 holds for it, as it does for a plan that names a member (this
 * answers null for it: its member is the one it names) or is not of `businessId`.
 */
export async function systemPlanMember(prisma: PrismaService, businessId: string, planId: string): Promise<string | null> {
  const plan = await prisma.client.aiPlan.findFirst({ where: { id: planId, businessId }, select: SYSTEM_PLAN_MARKERS });
  if (!plan || plan.userId) return null;
  return systemPlanOwner(prisma, businessId, plan);
}

/**
 * systemPlanMember for a plan already read. Review CR-D93-1: a row is judged by the markers it holds,
 * so a partial row (a caller's mock that holds only `userId`) is no system plan rather than a TypeError.
 */
async function systemPlanOwner(
  prisma: PrismaService,
  businessId: string,
  plan: { objective?: string | null; rawInput?: string | null; scope?: readonly string[] | null },
): Promise<string | null> {
  // Imported at call time, as this file is: the briefing service sits on the orchestrator's import graph.
  const { BRIEFING_OBJECTIVE_PREFIX, BRIEFING_RAW_INPUT, BRIEFING_SCOPE } = await import('./morning-briefing.service');
  const briefing =
    (plan.scope ?? []).includes(BRIEFING_SCOPE) &&
    (plan.objective ?? '').startsWith(BRIEFING_OBJECTIVE_PREFIX) &&
    plan.rawInput === BRIEFING_RAW_INPUT;
  if (!briefing) return null;
  const business = await prisma.client.business.findUnique({ where: { id: businessId }, select: { ownerId: true } });
  return business?.ownerId ?? null;
}

/**
 * Why `memberId` may not run `toolName` in `businessId` now, or null when they may, and whether the
 * dispatcher may take them as the run's principal. The rule the plan queue applies to a plan's member
 * (planStepRunAuthority), shared with KeyCortexActionExecutorPlugin for the member an approved
 * proposal that is no plan step runs for (W4-PROPOSAL-PRINCIPAL review SEC-W4PP-2):
 *   - the business owner runs every tool the authority map does not map (a dotted organ or legacy
 *     cortex tool, D-119: the owner's only), but a tool the authority map never runs
 *     (execute_custom_logic) is refused to the owner too (KEY-R3b review SEC-R3b-2). W11-D116-KEY-OWNER
 *     (owner rulings D-116, D-125): the business owner is whoever holds an OWNER membership of this
 *     business, the recorded owner (Business.ownerId) or a co-owner; Business.ownerId grants nothing on
 *     its own, and a recorded owner holding only an ADMIN or STAFF membership is that role (the next
 *     arm). The owner is a member, so the dispatcher may take them as the run's principal when asked
 *     (review CR-W4PP-2: resolveCrmAccess refuses a non-member). A tool the map maps is the next arm's
 *     for the owner too (review SEC-W11D116K-1): an OWNER with no explicit scope map holds every module
 *     there (D-71: the OWNER defaults) and every owner-only tool, and an explicit map on an OWNER
 *     membership binds it, as ModuleScopeGuard and POST .../execute read it. W11A-SEAM-REPAIR (D-119,
 *     D-131): the exception is a mapped KEY organ (dotted) tool, which an OWNER with no explicit map runs
 *     in this arm, as it ran every dotted tool before D-131 mapped them: the OWNER defaults hold no
 *     connect (no role default does), so through the next arm the owner alone would be refused the
 *     connector reads D-131 opens to members holding connect read;
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
  // W11-D116-KEY-OWNER (owner rulings D-116, D-125; D-119): the owner arm is the OWNER membership, the
  // recorded owner's or a co-owner's, never Business.ownerId (D-104 had admitted the recorded owner
  // holding any membership, so one holding ADMIN ran D-119's owner-only tools).
  // Review SEC-W11D116K-1 (D-125, D-71): the owner arm takes only a tool the authority map does not map
  // (D-119: the owner's only) or never runs. A mapped tool goes through assertMayRunGraphAction below,
  // so an OWNER membership's explicit permissionScopes map binds it there as ModuleScopeGuard and POST
  // .../execute read it; an OWNER with no map holds every module (the OWNER defaults), as before.
  //
  // W11A-SEAM-REPAIR (seam of C0 W11-D116-KEY-OWNER x B1 W11-KEY-ORGAN-AUTHORITY-MAP; D-119, D-125, D-131, D-71):
  // a mapped KEY organ (dotted) tool is the owner arm's too while the OWNER membership carries no explicit scope
  // map. D-119 made every dotted tool the owner's; D-131's entries open them to members and take none from the
  // owner. B1 maps the KEY connector reads to connect read, which no role default holds (the OWNER defaults
  // included: module-vocabulary CONNECT_DEFAULT), so through assertMayRunGraphAction the owner was refused them
  // while running the far wider unmapped key_connector.execute_internal. For an OWNER with no map every other
  // check there passes for any organ tool (owner-only, the CRM sub-permission, the proposer), so connect is the
  // only difference. An explicit map on an OWNER membership still binds it on every mapped tool, organ tools
  // included (review SEC-W11D116K-1 stays closed), and a FLOW tool keeps assertMayRunGraphAction's answer, which
  // POST .../execute and ModuleScopeGuard give the owner too.
  const requirement = graphActionRequirement(toolName);
  const organ = keyOrganToolAuthority(toolName) !== null;
  if (!requirement || 'refused' in requirement || organ) {
    const membership = await prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: memberId, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (membership?.role === 'OWNER') {
      if (!requirement || 'refused' in requirement) {
        const refusal = requirement ? `Tool "${toolName}" is not executed for a KEY plan, whoever asks: ${requirement.refused}` : null;
        return { refusal, principal: !!options.asPrincipal };
      }
      if (!isExplicitScopeMap(membership.permissionScopes)) return { refusal: null, principal: !!options.asPrincipal };
    }
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

/**
 * W8-KEY-REVENUE-GATE (owner ruling D-98, 2026-11-10; review residuals SEC-W7IAR-2, SEC-W7KMP-2): the
 * revenue level the web routes require for KEY's money-writing tool `toolName`, or null for any other
 * tool. D-98: when a member drives KEY, KEY's money-writing tools (mark an invoice paid, update an
 * invoice, record a payment) need that member's own revenue write, as the web routes do.
 *
 * KEY's money-writing tools, read off the tables the routes are derived into, never chosen here:
 *   - CANONICAL_MODULE_TOOLS.revenue at write or above (job-role-tool-families.spec.ts re-derives it
 *     from the route decorators): commerce_mark_invoice_paid, commerce_update_invoice, the invoice and
 *     quote create, convert and delete tools, the payment link writes and payments_refund_charge;
 *   - a governed tool whose governed part is a revenue write (GOVERNED_UNGRANTED, with the revenue
 *     scope graphActionRequirement gives it): commerce_send_invoice (CommerceService.updateInvoiceStatus
 *     to SENT) and update_status_with_confirmation's invoice moves (bulk SENT, VOID and PAID; "needs crm
 *     AND revenue"). W8-KEY-REVENUE-GATE review CR-W8KRG-1: that tool also bulk-moves contact statuses,
 *     which is no money write (PATCH crm contacts/bulk needs crm:write alone), so its call is judged by
 *     its arguments (REVENUE_WRITE_ARGUMENTS) and its contact moves are left as they were.
 * A tool no route governs (a GRAPH_ACTION_TOOL_MODULES prefix floor such as finance_* or retainers_*)
 * has no web route to copy, so D-98 leaves it as it was; the same narrowest reading as D-40's
 * operations gate (CANONICAL_MODULE_TOOLS.operations only).
 *
 * `args`: the call's arguments, when the tool's money write depends on them; omitted, such a tool is
 * read as writing money (fail closed). The tool menu asks keyRevenueMenuLevel instead.
 *
 * One rule for every surface a member drives KEY on (D-98: "chat or a plan"). Refused with
 * memberRevenueWriteRefusal, from FlowOrchestratorService.memberScopeRefusal (executeTool,
 * governToolCall, execute_custom_logic's inner calls) and its tool menu, for: the member's own chat
 * turn (CHAT, CHAT_STREAM, CHAT_CONFIRM: its principal); a plan run over HTTP (PLAN_HTTP, POST
 * ai/businesses/:b/flow/execute-plan/:planId: the calling member, its principal; review SEC-W8KRG-1);
 * a KEY-cortex turn's bridged flow tool (CORTEX_BRIDGE: the member the turn runs for; review
 * SEC-W8KRG-2). A plan step on the plan queue and an approved proposal are held to every module scope
 * of the tool before dispatch instead (memberToolRunAuthority: assertMayRunGraphAction, D-71), this
 * revenue scope included; a run with no member writes no money at all (noMemberToolRefusal, D-73).
 */
export function keyRevenueWriteLevel(toolName: string, args?: unknown): 'write' | 'admin' | null {
  const level = revenueWriteLevelOfTool(toolName);
  if (!level) return null;
  if (args !== undefined && Object.prototype.hasOwnProperty.call(REVENUE_WRITE_ARGUMENTS, toolName) && !REVENUE_WRITE_ARGUMENTS[toolName](args)) {
    return null;
  }
  return level;
}

/**
 * W8-KEY-REVENUE-GATE review (CR-W8KRG-1; D-98): a money-writing tool whose call writes money only for
 * some arguments, and the test of whether these arguments do. update_status_with_confirmation moves
 * invoices (SENT, VOID, PAID: money) or contacts (CrmService.bulkUpdateContacts: no money; PATCH crm
 * contacts/bulk needs crm:write alone). The test is the dispatcher's own branch
 * (flow-orchestrator.service.ts, `entityType === 'contact'`), read the other way round, so anything but
 * the contact branch counts as money (fail closed; an unknown entity type is refused there anyway).
 */
const REVENUE_WRITE_ARGUMENTS: Readonly<Record<string, (args: unknown) => boolean>> = {
  update_status_with_confirmation: (args) =>
    !(args && typeof args === 'object' && (args as { entityType?: unknown }).entityType === 'contact'),
};

/**
 * W8-KEY-REVENUE-GATE review (CR-W8KRG-1; D-98): the revenue level a member needs to be offered
 * `toolName` on KEY's tool menu (FlowOrchestratorService.selectToolsForRequest). A tool whose money
 * write depends on its arguments (REVENUE_WRITE_ARGUMENTS) stays offered: the call is judged by its
 * arguments when it runs (keyRevenueWriteLevel), so a crm:write member below revenue:write still moves
 * contact statuses with update_status_with_confirmation, as PATCH crm contacts/bulk lets them.
 */
export function keyRevenueMenuLevel(toolName: string): 'write' | 'admin' | null {
  if (Object.prototype.hasOwnProperty.call(REVENUE_WRITE_ARGUMENTS, toolName)) return null;
  return keyRevenueWriteLevel(toolName);
}

/** keyRevenueWriteLevel's tool-level answer, read off the route tables (whatever the arguments). */
function revenueWriteLevelOfTool(toolName: string): 'write' | 'admin' | null {
  const own = (table: object) => Object.prototype.hasOwnProperty.call(table, toolName);
  if (own(CANONICAL_MODULE_TOOLS.revenue)) {
    const level = CANONICAL_MODULE_TOOLS.revenue[toolName];
    return level === 'write' || level === 'admin' ? level : null;
  }
  if (!own(GOVERNED_UNGRANTED)) return null;
  const requirement = graphActionRequirement(toolName);
  if (!requirement || 'refused' in requirement) return null;
  const revenue = requirement.scopes.find((s) => s.module === 'revenue' && LEVEL_RANK[s.minLevel] >= LEVEL_RANK.write);
  return revenue && revenue.minLevel !== 'read' ? revenue.minLevel : null;
}

/**
 * W8-KEY-REVENUE-GATE (D-98): `userId`'s revenue level in `businessId`, read as the routes' money
 * writes read it (CommerceService.assertActorMayWriteRevenue, behind ModuleScopeGuard revenue write on
 * PATCH .../paid): the membership's explicit permissionScopes map, where a missing key is none, else
 * its role's defaults (OWNER and ADMIN admin, STAFF read); one helper with ModuleScopeGuard
 * (memberModuleLevel). No membership is none, a platform SUPER_ADMIN included (D-46: one who is not a
 * member does not write the business's invoices). This is the membership's own level: what KEY does for
 * a SUPER_ADMIN who IS a member depends on the tool's web door (memberRevenueReader).
 */
export async function memberRevenueLevel(prisma: PrismaService, businessId: string, userId: string): Promise<string> {
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId, businessId } },
    select: { role: true, permissionScopes: true },
  });
  return membership ? memberModuleLevel(membership, 'revenue') : 'none';
}

/**
 * PR195-BOOKS-DOORS (review findings SEC-P195JS-5, CRR-P195JS-1): KEY's revenue-write tools whose web
 * door is a Books write on FinanceController: ModuleScopeGuard revenue write, which admits a platform
 * SUPER_ADMIN whatever its membership's scopes, and ensureAccess, which requires a membership (D-46). So
 * a SUPER_ADMIN who IS a member posts a journal or matches a bank line over REST whatever its own
 * revenue scope, and KEY admits them to these tools as the route does (memberRevenueReader), as
 * memberExtraScopeReader admits them to payroll_mark_paid as PayrollService does. Every other revenue
 * write (the invoice, quote and payment tools) keeps D-98's reading: their web doors hold a SUPER_ADMIN
 * member to its membership's revenue write (FOLLOW3-A1/A2: CommerceController and PaymentsOpsController
 * assertSuperAdminMayWriteRevenue, CommerceService.assertActorMayWriteRevenue), so KEY does too.
 * flow-chat-books-gate.spec.ts pins the partition: every revenue write of the derived table is either
 * here (a finance.controller door) or a commerce or payments door.
 */
export const KEY_BOOKS_REVENUE_TOOLS: ReadonlySet<string> = new Set([
  'finance_post_journal_entry',
  'finance_auto_match_bank',
  'reconcile_run_auto_match',
  'reconcile_match_line',
]);

/**
 * PR195-BOOKS-DOORS: reads `userId`'s membership of `businessId` (and whether they are a platform
 * SUPER_ADMIN) once, and answers, for a tool and the revenue level it requires, why KEY may not run it
 * for them, or null. A membership's level is memberRevenueLevel's; no membership is none (D-46); a
 * SUPER_ADMIN who is a member passes a Books tool (KEY_BOOKS_REVENUE_TOOLS), as ModuleScopeGuard and
 * PayrollService pass them, and is held to its membership's level for every other tool, as the invoice
 * and payment doors hold them. The words start as ModuleScopeGuard's, so a member and the model read
 * KEY's refusal as the route's. Used for the FLOW chat menu (one read per turn) and each call.
 */
export async function memberRevenueReader(
  prisma: PrismaService,
  businessId: string,
  userId: string,
): Promise<(toolName: string, required: 'write' | 'admin' | null) => string | null> {
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId, businessId } },
    select: { role: true, permissionScopes: true },
  });
  const level = membership ? memberModuleLevel(membership, 'revenue') : 'none';
  // The platform role matters only to a member whose own level reaches less than every revenue write
  // (admin); the user row is read then alone, so a member at admin costs no second query.
  const user = membership && rankOf(level) < LEVEL_RANK.admin
    ? await prisma.client.user.findUnique({ where: { id: userId }, select: { role: true } })
    : null;
  const superAdminMember = Boolean(membership) && user?.role === 'SUPER_ADMIN';
  return (toolName, required) => {
    if (!required) return null;
    if (superAdminMember && KEY_BOOKS_REVENUE_TOOLS.has(toolName)) return null;
    if (rankOf(level) >= LEVEL_RANK[required]) return null;
    return `Insufficient permissions: revenue requires ${required} access (you have ${level}); KEY runs "${toolName}" for a member only with the revenue access the routes require (D-98)`;
  };
}

/**
 * W8-KEY-REVENUE-GATE (D-98): why KEY may not run the money-writing tool `toolName` for `memberId`
 * in `businessId`, or null when it may (or this call writes no money: keyRevenueWriteLevel, judged with
 * the call's `args` for a tool whose money write depends on them; review CR-W8KRG-1). The answer starts
 * with the words ModuleScopeGuard and the service answer the same member's PATCH .../paid with, so a
 * member and the model read KEY's refusal as the route's. PR195-BOOKS-DOORS: through memberRevenueReader,
 * so a SUPER_ADMIN who is a member is held as the tool's web door holds them.
 */
export async function memberRevenueWriteRefusal(
  prisma: PrismaService,
  businessId: string,
  memberId: string,
  toolName: string,
  args?: unknown,
): Promise<string | null> {
  const required = keyRevenueWriteLevel(toolName, args);
  if (!required) return null;
  return (await memberRevenueReader(prisma, businessId, memberId))(toolName, required);
}

/**
 * PR195-BOOKS-DOORS (review finding SEC-P195JS-4; D-73: KEY writes money only for a member): why a
 * member-driven surface (member chat, a plan run over HTTP, a KEY-cortex turn's bridged call) that names
 * no member may not run `toolName`, or null. A chat turn with no principal is real: the Chatwoot support
 * desk calls FlowOrchestratorService.chat with no user, so customer-written text drives it, and the
 * revenue gate (memberRevenueWriteRefusal) and the extra-scope gate (memberExtraScopeRefusal) both need a
 * member to read. Refused, fail closed: a revenue write (keyRevenueWriteLevel with the call's arguments,
 * so a contact move of update_status_with_confirmation still runs), a tool whose authority map entry
 * names an extra scope (keyMemberExtraScopes: payroll_mark_paid), a tool that posts the ledger outside
 * the revenue scope (NO_MEMBER_LEDGER_WRITE_TOOLS), and any other tool the authority map holds at
 * revenue or expenses write (finance_pay_bill, expenses_create: what noMemberToolRefusal refuses a plan
 * with no member for the same reason). `args` omitted (the menu) reads every such tool as a money write.
 */
export function noMemberMoneyWriteRefusal(toolName: string, args?: unknown, surface = 'KEY'): string | null {
  const argumentBound = Object.prototype.hasOwnProperty.call(REVENUE_WRITE_ARGUMENTS, toolName);
  // An extra scope at write level (payroll_mark_paid's expenses write); a read beside the module (a money read's
  // revenue or expenses read, SEC-P195KG-1) is no write.
  let money =
    keyRevenueWriteLevel(toolName, args) !== null ||
    NO_MEMBER_LEDGER_WRITE_TOOLS.has(toolName) ||
    keyMemberExtraScopes(toolName).some((s) => LEVEL_RANK[s.minLevel] >= LEVEL_RANK.write);
  if (!money && !argumentBound) {
    const requirement = graphActionRequirement(toolName);
    money = Boolean(
      requirement &&
        !('refused' in requirement) &&
        requirement.scopes.some((s) => (s.module === 'revenue' || s.module === 'expenses') && LEVEL_RANK[s.minLevel] >= LEVEL_RANK.write),
    );
  }
  if (!money) return null;
  return `"${toolName}" writes the business's money or books, and this ${surface} turn names no member it runs for, so KEY does not run it (D-73)`;
}

/**
 * PR195-JOURNAL-SCOPE (the PR195-PORT repair's open item; review SEC-P195-3): the module scopes a member
 * driving KEY needs for `toolName` beyond the two the chat gates already read (the operations scope, D-40;
 * the revenue write of KEY's money-writing tools, D-98, which keyRevenueWriteLevel judges with the call's
 * arguments): the authority map's extra scopes (graphActionExtraScopes) other than revenue. Today one:
 * payroll_mark_paid needs expenses write beside its route's operations write, since marking a run paid
 * posts it to the ledger (PayrollService holds REST and every KEY dispatch to the same pair). Empty for
 * every other tool.
 */
export function keyMemberExtraScopes(toolName: string): ReadonlyArray<GraphActionScope> {
  return graphActionExtraScopes(toolName).filter((s) => s.module !== 'revenue');
}

/**
 * PR195-JOURNAL-SCOPE: reads `userId`'s membership of `businessId` once and answers, for any tool, why
 * KEY may not run it for them for want of an extra scope (keyMemberExtraScopes), or null. The rule is
 * PayrollService.markRunPaid's for the member a run is for: a Membership of this business (D-46: a
 * platform SUPER_ADMIN who is not a member is refused; one who is a member passes, as ModuleScopeGuard
 * lets one through, and as memberRevenueReader passes one to the Books tools: PR195-BOOKS-DOORS, review
 * SEC-P195JS-5 / CRR-P195JS-1, each reader following its tools' web doors), and each extra scope at its
 * level, read as ModuleScopeGuard reads a membership
 * (memberModuleLevel: the explicit map, a missing key being none, else the role's defaults). The words
 * are the guard's, so a member and the model read KEY's refusal as the service's. Used for the FLOW
 * chat menu (FlowOrchestratorService.selectToolsForRequest), so one turn reads the membership once.
 */
export async function memberExtraScopeReader(
  prisma: PrismaService,
  businessId: string,
  userId: string,
): Promise<(toolName: string) => string | null> {
  const [membership, user] = await Promise.all([
    prisma.client.membership.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { role: true, permissionScopes: true },
    }),
    prisma.client.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ]);
  return (toolName: string) => {
    const extra = keyMemberExtraScopes(toolName);
    if (!extra.length) return null;
    if (!membership) {
      return `Not a member of this business: KEY runs "${toolName}" only for a member of the business whose books it writes (D-46)`;
    }
    if (user?.role === 'SUPER_ADMIN') return null;
    for (const { module, minLevel } of extra) {
      const level = memberModuleLevel(membership, module);
      if (rankOf(level) < LEVEL_RANK[minLevel]) {
        return `Insufficient permissions: ${module} requires ${minLevel} access (you have ${level}); KEY runs "${toolName}" for a member only with every module scope its authority map names`;
      }
    }
    return null;
  };
}

/**
 * PR195-JOURNAL-SCOPE: memberExtraScopeReader's answer for one call, read from the database only when
 * the tool has an extra scope. FlowOrchestratorService.memberScopeRefusal asks it for the member a
 * member-driven surface runs the call for (memberRevenueGateMember: member chat, a plan run over HTTP, a
 * KEY-cortex turn's bridged call), so the call is refused before dispatch, as the menu withholds it.
 */
export async function memberExtraScopeRefusal(
  prisma: PrismaService,
  businessId: string,
  memberId: string,
  toolName: string,
): Promise<string | null> {
  if (!keyMemberExtraScopes(toolName).length) return null;
  return (await memberExtraScopeReader(prisma, businessId, memberId))(toolName);
}

/**
 * PR195-KEY-GATES (review findings SEC-P195BW-3, SEC-P195BW-5, CRR-P195BD-2; owner rulings D-40, D-57, D-98, D-114,
 * D-140, D-146): the one gate a member driving KEY is held to on the surfaces they drive it on (their own chat turn:
 * CHAT, CHAT_STREAM, CHAT_CONFIRM; an approved plan run over HTTP: PLAN_HTTP; a KEY-cortex turn's bridged call:
 * CORTEX_BRIDGE), on the tool menu and at dispatch: the SAME module scopes the tool's REST routes require, for reads
 * and writes. Before, member chat checked only three special cases (operations, D-40; revenue writes, D-98; payroll's
 * extra scope), so an expenses-read member ran expenses_create, finance_pay_bill and
 * inventory_advance_purchase_order, which REST refuses them, and a revenue-none member read receivables and the
 * P&L. Each special case is a case of this gate.
 *
 * Derived, not chosen, from the tables the authority map already reads:
 *   - CANONICAL_MODULE_TOOLS: the module whose routes govern the tool and the lowest level they accept
 *     (job-role-tool-families.spec.ts re-derives it from the route decorators on every run);
 *   - a GOVERNED_UNGRANTED tool: its governed floor (graphActionRequirement; commerce_send_invoice's revenue write,
 *     the crm write of update_status_with_confirmation and send_message_with_approval). execute_custom_logic carries
 *     none of its own: each inner call is judged as a call of the member who ran the snippet;
 *   - the authority map's extra scopes beside the tool's own (GRAPH_ACTION_EXTRA_SCOPES: payroll_mark_paid's expenses
 *     write, update_status_with_confirmation's revenue write).
 * update_status_with_confirmation does the work of one of two routes, chosen by its arguments (REVENUE_WRITE_ARGUMENTS):
 * an invoice move needs PATCH commerce invoices/bulk's revenue write, a contact move PATCH crm contacts/bulk's crm write
 * (omitted arguments: both, fail closed). The menu offers it to every member (review CR-W8KRG-1) and the call is judged.
 * A tool no route governs needs nothing here (D-98's narrowest reading; the plan queue, approved proposals and the
 * graph route keep their prefix floor through graphActionRequirement).
 */
const CANONICAL_TOOL_SCOPE: ReadonlyMap<string, GraphActionScope> = new Map(
  (Object.entries(CANONICAL_MODULE_TOOLS) as Array<[GraphActionScope['module'], Readonly<Record<string, GraphActionScope['minLevel']>>]>).flatMap(
    ([module, tools]) => Object.entries(tools).map(([tool, minLevel]): [string, GraphActionScope] => [tool, { module, minLevel }]),
  ),
);

function memberToolScopes(toolName: string, args: unknown, mode: 'call' | 'menu'): GraphActionScope[] {
  const scopes: GraphActionScope[] = [];
  const add = (s: GraphActionScope) => {
    if (!scopes.some((x) => x.module === s.module && x.minLevel === s.minLevel)) scopes.push(s);
  };
  const canonical = CANONICAL_TOOL_SCOPE.get(toolName);
  if (canonical) {
    add(canonical);
  } else if (Object.prototype.hasOwnProperty.call(GOVERNED_UNGRANTED, toolName)) {
    const requirement = graphActionRequirement(toolName);
    if (requirement && !('refused' in requirement)) add(requirement.scopes[0]);
  }
  for (const extra of graphActionExtraScopes(toolName)) add(extra);
  if (Object.prototype.hasOwnProperty.call(REVENUE_WRITE_ARGUMENTS, toolName)) {
    // update_status_with_confirmation does one of two routes' work, chosen by its arguments: an invoice move is
    // PATCH commerce invoices/bulk's (revenue write), a contact move PATCH crm contacts/bulk's (crm write). The call
    // needs the scope of the branch it takes; omitted arguments need both (fail closed). The menu offers the tool
    // (review CR-W8KRG-1) and the call is judged when it runs.
    if (mode === 'menu') return [];
    if (args === undefined) return scopes;
    const isMoney = (s: GraphActionScope) => s.module === 'revenue' && LEVEL_RANK[s.minLevel] >= LEVEL_RANK.write;
    return REVENUE_WRITE_ARGUMENTS[toolName](args) ? scopes.filter(isMoney) : scopes.filter((s) => !isMoney(s));
  }
  return scopes;
}

/** The module scopes a member needs for a call of `toolName` with `args` (omitted: every scope the tool can need, fail closed). */
export function keyMemberToolScopes(toolName: string, args?: unknown): GraphActionScope[] {
  return memberToolScopes(toolName, args, 'call');
}

/** The module scopes a member needs to be offered `toolName` on KEY's menu (an argument-bound money write judged at the call). */
export function keyMemberMenuScopes(toolName: string): GraphActionScope[] {
  return memberToolScopes(toolName, undefined, 'menu');
}

/**
 * The modules this gate can ask for: those the canonical table grants a tool of, and the governed floors and extra
 * scopes beside them (crm, revenue, expenses, operations). A module no KEY tool needs (connect today) is not one.
 */
const GATED_MODULES: readonly string[] = Array.from(
  new Set([
    ...(Object.entries(CANONICAL_MODULE_TOOLS) as Array<[string, Readonly<Record<string, string>>]>).filter(([, tools]) => Object.keys(tools).length > 0).map(([m]) => m),
    'crm',
    'revenue',
    'expenses',
    'operations',
  ]),
);

/** A write of money or of the Books by its scopes: revenue or expenses at write or above, or a tool that posts the ledger. */
function moneyWriteScope(toolName: string, scopes: ReadonlyArray<GraphActionScope>): GraphActionScope | null {
  const money = scopes.find((s) => (s.module === 'revenue' || s.module === 'expenses') && LEVEL_RANK[s.minLevel] >= LEVEL_RANK.write);
  if (money) return money;
  return NO_MEMBER_LEDGER_WRITE_TOOLS.has(toolName) && scopes.length ? scopes[0] : null;
}

/**
 * PR195-KEY-GATES: reads `userId`'s membership of `businessId` and whether they are a platform SUPER_ADMIN once,
 * and answers, for a tool and the scopes it needs (keyMemberToolScopes / keyMemberMenuScopes), why KEY may not run
 * it for them, or null. As ModuleScopeGuard and each tool's door hold the same person:
 *   - a member: every scope at its level, read as ModuleScopeGuard reads it (memberModuleLevel: the explicit map,
 *     a missing key being none, OWNER maps included, D-140; else the role's defaults; an ADMIN's explicit 'none'
 *     binds it, D-114);
 *   - a platform SUPER_ADMIN who is a member: ModuleScopeGuard passes them every scope, so KEY does, except on the
 *     invoice, quote and payment writes, whose doors hold them to their membership's own revenue write (FOLLOW3-A2;
 *     the Books tools, KEY_BOOKS_REVENUE_TOOLS, admit them as their finance.controller doors do: memberRevenueReader's
 *     reading, kept);
 *   - a platform SUPER_ADMIN who is not a member: passes what ModuleScopeGuard passes, but writes none of the
 *     business's money or Books, its expenses and bill payments included (D-46; review SEC-P195BW-7), as
 *     assertMayRunGraphAction refuses them, and reads none of the Books whose FinanceController doors require a
 *     Membership (KEY_BOOKS_MEMBERSHIP_READ_TOOLS: ensureAccess, D-104; review SEC-P195KG-3), in ensureAccess's
 *     words.
 * The words start as ModuleScopeGuard's (ensureAccess's for a Books read with no membership), so a member and the
 * model read KEY's refusal as the route's.
 */
export async function memberToolScopeReader(
  prisma: PrismaService,
  businessId: string,
  userId: string,
): Promise<(toolName: string, scopes: ReadonlyArray<GraphActionScope>) => string | null> {
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId, businessId } },
    select: { role: true, permissionScopes: true },
  });
  // The platform role matters only to someone this gate could refuse: no membership, or a membership short of admin
  // on some module. A member at admin everywhere (an OWNER on role defaults) costs no second query.
  const couldBeShort = !membership || GATED_MODULES.some((m) => rankOf(memberModuleLevel(membership, m)) < LEVEL_RANK.admin);
  const user = couldBeShort ? await prisma.client.user.findUnique({ where: { id: userId }, select: { role: true } }) : null;
  const superAdmin = user?.role === 'SUPER_ADMIN';
  return (toolName, scopes) => {
    if (!scopes.length) return null;
    if (superAdmin && !membership) {
      if (KEY_BOOKS_MEMBERSHIP_READ_TOOLS.has(toolName)) {
        return `No access to this business: KEY runs "${toolName}" only for a member of the business, as its finance door requires a membership (D-104)`;
      }
      const money = moneyWriteScope(toolName, scopes);
      if (!money) return null;
      return `Insufficient permissions: ${money.module} requires ${money.minLevel} access (you have none). Not a member of this business: a platform SUPER_ADMIN who is not a member writes none of its money or books (D-46)`;
    }
    // A money scope (revenue, expenses) a member falls short of is named first, as D-98's gate named it.
    const ordered = [...scopes].sort((a, b) => Number(b.module === 'revenue' || b.module === 'expenses') - Number(a.module === 'revenue' || a.module === 'expenses'));
    for (const { module, minLevel } of ordered) {
      if (superAdmin) {
        const heldToMembership =
          module === 'revenue' && LEVEL_RANK[minLevel] >= LEVEL_RANK.write && !KEY_BOOKS_REVENUE_TOOLS.has(toolName);
        if (!heldToMembership) continue;
      }
      const level = membership ? memberModuleLevel(membership, module) : 'none';
      if (rankOf(level) < LEVEL_RANK[minLevel]) {
        return `Insufficient permissions: ${module} requires ${minLevel} access (you have ${level}); KEY runs "${toolName}" for a member only with the module access its routes require (D-98)`;
      }
    }
    return null;
  };
}

/**
 * PR195-KEY-GATES: memberToolScopeReader's answer for one call of `toolName` with `args`, reading the database only
 * when the tool needs a scope. FlowOrchestratorService.memberScopeRefusal asks it for the member a member-driven
 * surface runs the call for (member chat, PLAN_HTTP, CORTEX_BRIDGE), before dispatch, as the menu withholds it.
 */
export async function memberToolScopeRefusal(
  prisma: PrismaService,
  businessId: string,
  memberId: string,
  toolName: string,
  args?: unknown,
): Promise<string | null> {
  const scopes = keyMemberToolScopes(toolName, args);
  if (!scopes.length) return null;
  return (await memberToolScopeReader(prisma, businessId, memberId))(toolName, scopes);
}
