import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CrmRateLimit, CrmRateLimitGuard } from '../crm/guards/rate-limit.guard';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BusinessGraphService } from './business-graph.service';
import { IntentParserService } from './intent-parser.service';
import { PlannerService } from './planner.service';
import { AiOversightService } from './ai-oversight.service';
import { FlowOrchestratorService } from './flow-orchestrator.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import { WorkspaceRecommendationsService } from './workspace-recommendations.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { Request } from 'express';
import { ActionExecutedPayload, ActionBlockedPayload } from '../../core/event-bus/events.types';
import { CanonicalModule, LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import type { Prisma } from '@prisma/client';
import { resolveCrmAccess, visibilityClause } from '../crm/crm-permissions.helper';
import { KEY_PLAN_MODULE_SCOPES, planStepReadsContacts } from '../key-cortex/key-cortex-plan-authority';
import {
  CANONICAL_MODULE_TOOLS,
  CRM_ROW_VISIBILITY_TOOLS,
  CRM_SUBPERMISSION_TOOLS,
  GOVERNED_UNGRANTED,
} from '../structure/job-role-policy.service';
import { getToolByName } from './flow-tool-registry';
import { isMcpToolName } from '../mcp/mcp.types';
import type { BusinessRole } from './role-engine.service';

interface AuthenticatedRequest extends Request {
  user?: { id: string; email?: string; role?: string };
}

/**
 * V1-31b-KEY-ACTION-ROUTES-BIND (V1-31 review SEC-V131-1, M46). The module scope
 * a tool executed from POST actions/businesses/:businessId/execute needs, for a
 * tool NO route governs (one CANONICAL_MODULE_TOOLS does not list; those take
 * the canonical table's module and level, see graphActionModuleScope), by
 * tool-name prefix (an entry ending in '_') or exact name; the first match
 * wins. It is a floor where HTTP has no rule to copy: the executing member must
 * hold it as ModuleScopeGuard computes scopes (a 'read' family tool needs read,
 * every other tool write). A tool that matches nothing is refused: deny by
 * default, so a tool added to the registry is not executable from this route
 * until it is mapped (graphActionRequirement covers every registry tool).
 */
export const GRAPH_ACTION_TOOL_MODULES: ReadonlyArray<readonly [string, CanonicalModule]> = [
  ['fetch_', 'analytics'],
  ['reports_', 'analytics'],
  ['crm_', 'crm'],
  ['deals_', 'crm'],
  ['call_', 'crm'],
  ['sequence_', 'crm'],
  ['segment_contacts', 'crm'],
  ['tag_contact', 'crm'],
  ['create_followup_queue', 'crm'],
  ['draft_followup_message', 'crm'],
  ['commerce_', 'revenue'],
  ['payments_', 'revenue'],
  ['finance_', 'revenue'],
  ['reconcile_', 'revenue'],
  ['retainers_', 'revenue'],
  ['draft_payment_reminder', 'revenue'],
  ['expenses_', 'expenses'],
  ['bookings_', 'bookings'],
  ['calendar_', 'bookings'],
  ['projects_', 'projects'],
  ['time_', 'projects'],
  ['goals_', 'projects'],
  ['draft_project_update', 'projects'],
  ['content_', 'content'],
  ['social_', 'content'],
  ['marketing_', 'content'],
  ['assets_', 'content'],
  ['comms_', 'content'],
  ['community_', 'content'],
  ['seo_', 'content'],
  ['sync_seo_pages', 'content'],
  ['queue_campaign', 'content'],
  ['draft_campaign_bundle', 'content'],
  ['generate_content_brief', 'content'],
  ['automations_', 'automations'],
  ['delegation_', 'automations'],
  ['enable_flow_with_approval', 'automations'],
  ['store_', 'storefront'],
  ['inventory_', 'storefront'],
  ['suppliers_', 'storefront'],
  ['marketplace_', 'storefront'],
  ['apply_storefront_recommendation', 'storefront'],
  ['draft_storefront_copy', 'storefront'],
  ['structure_', 'team'],
  ['people_', 'team'],
  ['performance_', 'operations'],
  ['payroll_', 'operations'],
  ['contracts_', 'operations'],
  ['contract_', 'operations'],
  ['helpdesk_', 'operations'],
  ['inbox_', 'operations'],
  ['approval_', 'operations'],
  ['command_', 'operations'],
  ['procurement_', 'operations'],
  ['governance_', 'operations'],
  ['evidence_', 'operations'],
  ['documents_', 'operations'],
  ['drive_', 'operations'],
  // V1-31b review CR-2: registry tools the prefixes above missed.
  ['keyflow_create_note', 'operations'], // a note on any module's item
  ['portal_', 'crm'], // a contact's client-portal access
  ['present_onboarding_card', 'settings'],
  ['save_onboarding_step', 'settings'],
  ['update_business_blueprint', 'settings'],
  ['send_message_with_approval', 'crm'], // floor; GOVERNED_UNGRANTED, OWNER only (graphActionRequirement)
  ['update_status_with_confirmation', 'crm'], // floor, with revenue; GOVERNED_UNGRANTED, OWNER only
];

/** A module scope a graph action needs, as ModuleScopeGuard reads it. */
export interface GraphActionScope {
  module: CanonicalModule;
  minLevel: 'read' | 'write' | 'admin';
}

/** Exact canonical table: tool -> the module whose routes govern it and the lowest level they accept. */
const CANONICAL_TOOL_SCOPES: ReadonlyMap<string, GraphActionScope> = new Map(
  (Object.entries(CANONICAL_MODULE_TOOLS) as Array<[CanonicalModule, Readonly<Record<string, GraphActionScope['minLevel']>>]>).flatMap(
    ([module, tools]) => Object.entries(tools).map(([tool, minLevel]): [string, GraphActionScope] => [tool, { module, minLevel }]),
  ),
);

/**
 * The module scope a graph action needs, or null when the tool is mapped to none (refused).
 * V1-31b review CR-3: a tool some route governs takes the module and level of
 * CANONICAL_MODULE_TOOLS (the table job-role-tool-families.spec.ts re-derives from the route
 * decorators), exactly as the KEY envelope reads it; only a tool no route governs falls back
 * to GRAPH_ACTION_TOOL_MODULES.
 */
export function graphActionModuleScope(toolName: string): GraphActionScope | null {
  const canonical = CANONICAL_TOOL_SCOPES.get(toolName);
  if (canonical) return canonical;
  const entry = GRAPH_ACTION_TOOL_MODULES.find(([key]) => (key.endsWith('_') ? toolName.startsWith(key) : toolName === key));
  if (!entry) return null;
  return { module: entry[1], minLevel: getToolByName(toolName)?.family === 'read' ? 'read' : 'write' };
}

/**
 * Tools never executed from this route, whoever asks. execute_custom_logic re-enters the
 * dispatcher for any tool (GOVERNED_UNGRANTED), so no single scope bounds it.
 */
export const GRAPH_ACTION_REFUSED: Readonly<Record<string, string>> = {
  execute_custom_logic: GOVERNED_UNGRANTED.execute_custom_logic,
};

/** A second module some tools need beside their own (GOVERNED_UNGRANTED: "needs crm AND revenue"). */
const GRAPH_ACTION_EXTRA_SCOPES: Readonly<Record<string, ReadonlyArray<GraphActionScope>>> = {
  update_status_with_confirmation: [{ module: 'revenue', minLevel: 'write' }],
};

/**
 * Trial-N integration review NEW-4, repair round 2 (CONTACT-READ-ABORT, NEW-4-REST; D-37: KEY
 * contact reads apply the member's visibility). Contact reads the dispatcher bounds by the
 * principal it is handed (FlowOrchestratorService.contactReadAccess: resolveCrmAccess +
 * visibilityClause, as GET contacts and GET duplicates' rows), so a member kept to their own book,
 * or one who may not see another member's PRIVATE contact, reads only what GET contacts shows them.
 * This route always hands the dispatcher the caller, so they run for any member holding crm read.
 * A run with no principal (PlanExecutorService after POST ai/plans/:planId/approve) reads every
 * contact, so there they are the OWNER's only (GraphActionAuthorityOptions.noPrincipal).
 */
export const GRAPH_ACTION_CONTACT_READ_TOOLS: ReadonlySet<string> = new Set([
  'crm_list_contacts',
  'crm_search_contacts',
  'crm_find_duplicates',
  'crm_merge_preview',
]);

const CONTACT_READ_NO_PRINCIPAL =
  "it reads every contact when it runs with no principal (the plan executor), so no visibility clause keeps another member's PRIVATE contact out";

/**
 * KEY-R3b-PLAN-AUTHORITY review SEC-R3b-1: crm tools of a writing family that still read the
 * business's contacts with no member's visibility clause and return them (names, emails, notes):
 * segment_contacts (every contact matching a status or tag), create_followup_queue (stale leads),
 * draft_followup_message (a contact and its notes, into the draft), call_generate_script (a contact
 * and its history, into the script).
 */
const GRAPH_ACTION_CONTACT_READING_WRITES: ReadonlySet<string> = new Set([
  'segment_contacts',
  'create_followup_queue',
  'draft_followup_message',
  'call_generate_script',
]);

/**
 * Whether `toolName` reads the business's contacts, by what it does (KEY-R3b review SEC-R3b-1): a
 * contact list tool (GRAPH_ACTION_CONTACT_READ_TOOLS), any read of the crm module (deals, call
 * tasks, portal access, sequences: each row carries its contact), or a crm tool that reads contacts
 * while it writes (GRAPH_ACTION_CONTACT_READING_WRITES). Run with no principal, none of these keeps
 * another member's PRIVATE contact out, so there they are the OWNER's only, and a run with no
 * member at all runs none of them (D-73; plan-step-authority.ts).
 */
export function graphActionReadsContacts(toolName: string): boolean {
  if (GRAPH_ACTION_CONTACT_READ_TOOLS.has(toolName) || GRAPH_ACTION_CONTACT_READING_WRITES.has(toolName)) return true;
  const scope = graphActionModuleScope(toolName);
  return scope?.module === 'crm' && scope.minLevel === 'read';
}

/** What a member must hold to execute a stored step of `toolName` from this route. */
export interface GraphActionRequirement {
  /** Every module scope, as ModuleScopeGuard reads it. */
  scopes: ReadonlyArray<GraphActionScope>;
  /**
   * Why only the business's OWNER (or a SUPER_ADMIN) may run it (V1-31b review SEC-V131b-1).
   * The dispatcher calls these with no actor, so the HTTP row checks never run:
   * CRM_ROW_VISIBILITY_TOOLS reach any contact (visibilityClause keeps another member's PRIVATE
   * contact from everyone but the OWNER), and GOVERNED_UNGRANTED tools do work beside the
   * governed call that no member route does. JobRolePolicy grants them to no key; here only the
   * principal whose HTTP access is the whole business runs them.
   */
  ownerOnly?: string;
  /**
   * A contact read bounded by the principal's visibility (GRAPH_ACTION_CONTACT_READ_TOOLS): the
   * OWNER's only when the run has no principal, why in this text.
   */
  ownerOnlyWithoutPrincipal?: string;
  /** The CRM sub-permission resolveCrmAccess checks over HTTP (crm_edit / crm_delete), held at 'any' with crm_view 'all'. */
  crmSubPermission?: 'crm_edit' | 'crm_delete';
}

/** The requirement for `toolName`, `{ refused }` when this route never runs it, or null when it is mapped to nothing. */
export function graphActionRequirement(toolName: string): GraphActionRequirement | { refused: string } | null {
  if (Object.prototype.hasOwnProperty.call(GRAPH_ACTION_REFUSED, toolName)) return { refused: GRAPH_ACTION_REFUSED[toolName] };
  const scope = graphActionModuleScope(toolName);
  if (!scope) return null;
  const extra = Object.prototype.hasOwnProperty.call(GRAPH_ACTION_EXTRA_SCOPES, toolName) ? GRAPH_ACTION_EXTRA_SCOPES[toolName] : [];
  const requirement: GraphActionRequirement = { scopes: [scope, ...extra] };
  if (CRM_ROW_VISIBILITY_TOOLS.includes(toolName)) {
    requirement.ownerOnly = 'it writes a contact with no actor, so no visibility clause bounds the row it reaches';
  } else if (GRAPH_ACTION_CONTACT_READ_TOOLS.has(toolName)) {
    requirement.ownerOnlyWithoutPrincipal = CONTACT_READ_NO_PRINCIPAL;
  } else if (Object.prototype.hasOwnProperty.call(GOVERNED_UNGRANTED, toolName)) {
    requirement.ownerOnly = GOVERNED_UNGRANTED[toolName];
  } else if (graphActionReadsContacts(toolName)) {
    // KEY-R3b review SEC-R3b-1: every other contact read, known by what the tool does.
    requirement.ownerOnlyWithoutPrincipal = CONTACT_READ_NO_PRINCIPAL;
  }
  if (CRM_SUBPERMISSION_TOOLS.crm_delete.includes(toolName)) requirement.crmSubPermission = 'crm_delete';
  else if (CRM_SUBPERMISSION_TOOLS.crm_edit.includes(toolName)) requirement.crmSubPermission = 'crm_edit';
  return requirement;
}

/** Who besides a plan's proposer runs one of its steps from POST .../execute: the business OWNER (trial-N review NEW-2). */
const STEP_RUNNER_ROLES: ReadonlySet<string> = new Set(['OWNER']);

/**
 * Trial-N repair round 2 (PLAN-APPROVE): who besides a plan's proposer approves it, so that
 * PlanExecutorService runs its steps: the business OWNER or an ADMIN.
 */
export const PLAN_APPROVER_ROLES: ReadonlySet<string> = new Set(['OWNER', 'ADMIN']);

export interface GraphActionAuthorityOptions {
  /** Membership roles that act on a step of a plan another member proposed (default: the OWNER). */
  proposerOverrideRoles?: ReadonlySet<string>;
  /** The refusal when the member neither proposed the plan nor holds one of those roles. */
  proposerRefusal?: string;
  /**
   * The step will run with no principal (PlanExecutorService after a plan approval), so the
   * contact reads the dispatcher bounds by its principal are the OWNER's only.
   */
  noPrincipal?: boolean;
}

/**
 * Whether the member may have `toolName` run as a stored step of a plan `proposerId` proposed
 * (graphActionRequirement); throws 403 when not. A refused or unmapped tool is 403 for everyone.
 * SUPER_ADMIN passes the rest, except that one who is not a member of the business does not
 * write its invoices (a revenue write; D-46, trial-N review NEW-1): the dispatcher writes as
 * KEY_SYSTEM_ACTOR_ID, so the service membership check that refuses that principal over HTTP
 * never runs. Otherwise: a member of the business; the OWNER alone for an owner-only tool (and,
 * with no principal, for a visibility-bound contact read); every module scope as ModuleScopeGuard
 * computes it (the membership's explicit scope map, else its role's defaults); and, for a contact
 * create / edit / delete, the CRM sub-permission as resolveCrmAccess computes it over HTTP, held
 * for the whole book (crm_view 'all' and the scope 'any'), because the dispatcher passes no actor
 * that could keep the write to the member's own contacts (the rule JobRolePolicy's crmWithheld
 * applies to a KEY envelope). Last, the step must be the member's own: its plan was proposed by
 * them, or they hold one of `proposerOverrideRoles` (trial-N review NEW-2;
 * KeyCortexPlannerService.assertMayExecutePlan's rule for the same ai_plans rows).
 * POST .../execute and the queue's approved steps use the defaults; POST ai/plans/:planId/approve
 * passes PLAN_APPROVER_ROLES and noPrincipal (trial-N repair round 2, PLAN-APPROVE).
 */
export async function assertMayRunGraphAction(
  prisma: PrismaService,
  businessId: string,
  user: { id: string; role?: string },
  toolName: string,
  proposerId: string | null,
  options: GraphActionAuthorityOptions = {},
): Promise<void> {
  const requirement = graphActionRequirement(toolName);
  if (!requirement) {
    throw new ForbiddenException(`Tool "${toolName}" is mapped to no module scope, so it is not executed from this route`);
  }
  if ('refused' in requirement) {
    throw new ForbiddenException(`Tool "${toolName}" is not executed from this route: ${requirement.refused}`);
  }
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId: user.id, businessId } },
    select: { role: true, permissionScopes: true },
  });
  if (user.role === 'SUPER_ADMIN') {
    if (!membership && requirement.scopes.some((s) => s.module === 'revenue' && LEVEL_RANK[s.minLevel] >= LEVEL_RANK.write)) {
      throw new ForbiddenException('Not a member of this business: a platform SUPER_ADMIN who is not a member does not write its invoices (D-46)');
    }
    return;
  }
  if (!membership) throw new ForbiddenException('Not a member of this business');
  const ownerOnly = requirement.ownerOnly ?? (options.noPrincipal ? requirement.ownerOnlyWithoutPrincipal : undefined);
  if (ownerOnly && membership.role !== 'OWNER') {
    throw new ForbiddenException(`Tool "${toolName}" is executed from here only for the business owner: ${ownerOnly}`);
  }
  const scopes: Record<string, string> = isJsonObject(membership.permissionScopes)
    ? (membership.permissionScopes as Record<string, string>)
    : defaultScopesForRole(membership.role);
  for (const { module, minLevel } of requirement.scopes) {
    const level = scopes[module] || 'none';
    if (rankOf(level) < LEVEL_RANK[minLevel]) {
      throw new ForbiddenException(`Insufficient permissions: ${module} requires ${minLevel} access (you have ${level})`);
    }
  }
  if (requirement.crmSubPermission) {
    const access = await resolveCrmAccess(prisma, businessId, user.id);
    const scope = requirement.crmSubPermission === 'crm_delete' ? access.deleteScope : access.editScope;
    if (!access.viewAll || scope !== 'any') {
      throw new ForbiddenException(
        `Insufficient permissions: "${toolName}" needs crm_view all and ${requirement.crmSubPermission} any (you have crm_view ${access.viewAll ? 'all' : 'owned'}, ${requirement.crmSubPermission} ${scope})`,
      );
    }
  }
  const overrideRoles = options.proposerOverrideRoles ?? STEP_RUNNER_ROLES;
  if (!overrideRoles.has(membership.role) && (!proposerId || proposerId !== user.id)) {
    throw new ForbiddenException(options.proposerRefusal ?? 'This plan step is executed only for the member who proposed it or the business owner');
  }
}

/**
 * Trial-N repair round 2 recheck (APPROVE-NOTOOL): the tool PlanExecutorService dispatches for a
 * stored plan step, which is `step.toolName ?? step.action` (PlannerService stores the model's
 * action verbatim when its tool is not in the registry), or null when that is nothing the
 * dispatcher runs. A step with a toolName dispatches it. A step with none dispatches its action,
 * and FlowOrchestratorService.executeToolAction runs a registry tool or a bridged MCP tool by that
 * name and answers any other name 'Unknown tool' (an 'analyze' step's free text runs nothing).
 */
export function planStepDispatchedTool(step: { toolName: string | null; action: string | null }): string | null {
  if (step.toolName) return step.toolName;
  const name = step.action;
  if (!name) return null;
  return getToolByName(name) || isMcpToolName(name) ? name : null;
}

/**
 * What a viewer may read of the business's KEY plans: QUEUE-READ (trial-N repair round 2) for GET
 * actions/.../queue, the same rule for GET ai/plans and GET ai/plans/:planId (recheck
 * AI-PLANS-READ), and, since KEY-R3a-PLAN-READS (D-74), for GET cortex/plans/:planId: one rule for
 * every plan read route (visiblePlans / visiblePlanSteps apply it).
 * `seesEveryPlan`: every member's plans (the OWNER, an ADMIN, a SUPER_ADMIN), else only the viewer's
 * own. `step`: whether a step of `toolName` is shown (every step for the OWNER and a SUPER_ADMIN;
 * otherwise a step whose tool graphActionRequirement maps, with each of its module scopes held at
 * read as ModuleScopeGuard computes them). `cortexStep`: the same for a KEY-cortex step stored as
 * module.action with no tool (KeyCortexPlannerService), by its module (KEY_PLAN_MODULE_SCOPES; the
 * settings adapter's module is 'settings'). `stepOutput`: whether that step's stored output is shown
 * at all: not, to anyone but the OWNER or a SUPER_ADMIN, for a contact read (graphActionReadsContacts),
 * whose output the plan executor writes from a run with no principal (every contact, another member's
 * PRIVATE ones included). `seesEveryContact`: the OWNER and a SUPER_ADMIN, whom visibilityClause does
 * not restrict. `hiddenContacts` (D-74): the contacts among `ids` the viewer may not open (null when
 * they open every contact), which visiblePlans withholds from every step output at read.
 */
export interface GraphPlanReadScope {
  seesEveryPlan: boolean;
  step: (toolName: string | null | undefined) => boolean;
  cortexStep: (module: string) => boolean;
  stepOutput: (toolName: string) => boolean;
  seesEveryContact: boolean;
  hiddenContacts: ((ids: Iterable<string>) => Promise<ReadonlySet<string>>) | null;
}

/** The ids one contact lookup of hiddenContacts reads at most (bind parameters stay well under Postgres' limit). */
const HIDDEN_CONTACT_LOOKUP_CHUNK = 5000;

export async function graphPlanReadScope(
  prisma: PrismaService,
  businessId: string,
  viewer: { id: string; role?: string },
): Promise<GraphPlanReadScope> {
  const everything: GraphPlanReadScope = {
    seesEveryPlan: true,
    step: () => true,
    cortexStep: () => true,
    stepOutput: () => true,
    seesEveryContact: true,
    hiddenContacts: null,
  };
  if (viewer.role === 'SUPER_ADMIN') return everything;
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId: viewer.id, businessId } },
    select: { role: true, permissionScopes: true },
  });
  if (!membership) {
    return {
      seesEveryPlan: false,
      step: () => false,
      cortexStep: () => false,
      stepOutput: () => false,
      seesEveryContact: false,
      hiddenContacts: async (ids) => new Set(ids),
    };
  }
  if (membership.role === 'OWNER') return everything;
  const scopes: Record<string, string> = isJsonObject(membership.permissionScopes)
    ? (membership.permissionScopes as Record<string, string>)
    : defaultScopesForRole(membership.role);
  const reads = (module: string) => rankOf(scopes[module] || 'none') >= LEVEL_RANK.read;
  // D-74 / D-37: the contacts the viewer may open, by the rule GET contacts/:id applies
  // (resolveCrmAccess + visibilityClause; an ADMIN does not open another member's PRIVATE contact).
  const clause = visibilityClause(await resolveCrmAccess(prisma, businessId, viewer.id), viewer.id) as Prisma.ContactWhereInput | null;
  return {
    seesEveryPlan: PLAN_APPROVER_ROLES.has(membership.role),
    step: (toolName) => {
      if (!toolName) return false;
      const requirement = graphActionRequirement(toolName);
      if (!requirement || 'refused' in requirement) return false;
      return requirement.scopes.every(({ module }) => reads(module));
    },
    cortexStep: (module) => {
      const scope = Object.prototype.hasOwnProperty.call(KEY_PLAN_MODULE_SCOPES, module) ? KEY_PLAN_MODULE_SCOPES[module] : null;
      if (!scope) return true;
      return reads(scope === 'adapter' ? 'settings' : scope);
    },
    // KEY-R3b review SEC-R3b-1: every contact read, known by what the tool does.
    stepOutput: (toolName) => !graphActionReadsContacts(toolName),
    seesEveryContact: !clause,
    hiddenContacts: clause ? (ids) => hiddenBusinessContacts(prisma, businessId, clause, ids) : null,
  };
}

/**
 * The contacts of the business among `ids` that `clause` does not admit (D-74). Each lookup goes
 * through the business's `contacts` relation, as timeline-visibility's hiddenContacts does: the
 * soft-delete extension adds deletedAt null only to a top-level Contact read, so a soft-deleted
 * contact is judged by its visibility too. An id that is no contact of the business is not one.
 */
async function hiddenBusinessContacts(
  prisma: PrismaService,
  businessId: string,
  clause: Prisma.ContactWhereInput,
  ids: Iterable<string>,
): Promise<ReadonlySet<string>> {
  const all = [...new Set(ids)];
  const hidden = new Set<string>();
  for (let i = 0; i < all.length; i += HIDDEN_CONTACT_LOOKUP_CHUNK) {
    const chunk = all.slice(i, i + HIDDEN_CONTACT_LOOKUP_CHUNK);
    const [named, open] = await Promise.all([
      prisma.client.business.findFirst({
        where: { id: businessId },
        select: { contacts: { where: { id: { in: chunk } }, select: { id: true } } },
      }),
      prisma.client.business.findFirst({
        where: { id: businessId },
        select: { contacts: { where: { id: { in: chunk }, AND: [clause] }, select: { id: true } } },
      }),
    ]);
    const visible = new Set((open?.contacts ?? []).map((c: { id: string }) => c.id));
    for (const c of named?.contacts ?? []) if (!visible.has(c.id)) hidden.add(c.id);
  }
  return hidden;
}

/** A stored plan step as the plan read routes answer it. */
export interface PlanStepView {
  toolName: string | null;
  action: string | null;
  module?: string | null;
  inputPayload?: unknown;
  outputResult?: unknown;
}

/** The step type of a plan read with its steps. */
type PlanStepsOf<T> = T extends { steps?: readonly (infer S)[] | null } ? S : never;

/** Separates an id from the text around it inside a string ('Updated contact <id>', a URL). */
const ID_TOKEN_SEPARATOR = /[^A-Za-z0-9_-]+/;
/** The shortest token of a longer string that is looked up as a contact id (cuid, uuid and test ids are longer). */
const MIN_EMBEDDED_ID_LENGTH = 8;
/** The longest string looked up whole as a contact id (Contact.id is a cuid). */
const MAX_WHOLE_ID_LENGTH = 191;

function stringTokens(value: string): string[] {
  return value.split(ID_TOKEN_SEPARATOR).filter((t) => t.length >= MIN_EMBEDDED_ID_LENGTH && t.length <= MAX_WHOLE_ID_LENGTH);
}

/** Every string of `value` (and every object key) that might be a contact id, whole or as a token. */
function collectIdCandidates(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (value.length > 0 && value.length <= MAX_WHOLE_ID_LENGTH) into.add(value);
    for (const t of stringTokens(value)) into.add(t);
  } else if (Array.isArray(value)) {
    for (const v of value) collectIdCandidates(v, into);
  } else if (isJsonObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      collectIdCandidates(k, into);
      collectIdCandidates(v, into);
    }
  }
}

function stringNamesHidden(value: string, hidden: ReadonlySet<string>): boolean {
  return hidden.has(value) || stringTokens(value).some((t) => hidden.has(t));
}

function namesHiddenContact(value: unknown, hidden: ReadonlySet<string>): boolean {
  if (typeof value === 'string') return stringNamesHidden(value, hidden);
  if (Array.isArray(value)) return value.some((v) => namesHiddenContact(v, hidden));
  if (isJsonObject(value)) return Object.entries(value).some(([k, v]) => stringNamesHidden(k, hidden) || namesHiddenContact(v, hidden));
  return false;
}

const WITHHELD_ROW: unique symbol = Symbol('withheld row');

/**
 * `value` without the rows that name a hidden contact (D-74): an array element that names one is
 * dropped, an object key that names one is dropped with its value, and an object that names one in
 * any other place is itself such a row (WITHHELD_ROW: dropped by the nearest array that holds it, or
 * the whole output withheld when no array holds it).
 */
function withholdHiddenRows(value: unknown, hidden: ReadonlySet<string>): unknown {
  if (typeof value === 'string') return stringNamesHidden(value, hidden) ? WITHHELD_ROW : value;
  if (Array.isArray(value)) return value.map((v) => withholdHiddenRows(v, hidden)).filter((v) => v !== WITHHELD_ROW);
  if (isJsonObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (stringNamesHidden(k, hidden)) continue;
      const kept = withholdHiddenRows(v, hidden);
      if (kept === WITHHELD_ROW) return WITHHELD_ROW;
      out[k] = kept;
    }
    return out;
  }
  return value;
}

/**
 * Whether `scope` shows a step, and its stored output, before D-74's row filter. A step is judged by
 * the tool the executor dispatches for it (planStepDispatchedTool: a step with no toolName whose
 * action names a tool is that tool). A KEY-cortex step with no tool (module.action, the step
 * KeyCortexPlannerService runs) is judged by its module, and its output, when it reads contacts
 * (planStepReadsContacts: every crm read), is the OWNER's and a SUPER_ADMIN's only, as a registry
 * contact read's is (KEY-R3a, PLANREAD-TOOLLESS-OUTPUT). A step that dispatches nothing and names
 * no KEY module (an 'analyze' step) is shown with its plan.
 */
function planStepReadRule(step: PlanStepView, scope: GraphPlanReadScope): { shown: boolean; output: boolean } {
  const tool = planStepDispatchedTool(step);
  if (tool !== null) {
    return scope.step(tool) ? { shown: true, output: scope.stepOutput(tool) } : { shown: false, output: false };
  }
  const module = step.module;
  if (module && Object.prototype.hasOwnProperty.call(KEY_PLAN_MODULE_SCOPES, module)) {
    if (!scope.cortexStep(module)) return { shown: false, output: false };
    return { shown: true, output: scope.seesEveryContact || !planStepReadsContacts(module, step.action ?? '') };
  }
  return { shown: true, output: true };
}

/**
 * Plans as `scope` lets its viewer read them (KEY-R3a-PLAN-READS: the rule of every plan read route).
 * Each plan keeps the steps planStepReadRule shows; a step whose output the viewer may not read is
 * shown with outputResult null. D-74: a step output is then filtered by the viewer's CRM visibility
 * at read time, whatever tool or module.action produced it and whoever approved the step: the output
 * of a step whose input names a contact the viewer may not open is withheld (null: it is about that
 * row, even when it names no contact itself, as a note's text), and every other output loses the rows
 * that name such a contact (withholdHiddenRows; null when the output itself is such a row). One
 * contact lookup serves every plan.
 */
export async function visiblePlans<T extends { steps?: readonly PlanStepView[] | null }>(
  plans: readonly T[],
  scope: GraphPlanReadScope,
): Promise<Array<T & { steps: Array<PlanStepsOf<T>> }>> {
  const judged: PlanStepView[][] = plans.map((plan) =>
    (plan.steps ?? [])
      .map((step) => ({ step, rule: planStepReadRule(step, scope) }))
      .filter(({ rule }) => rule.shown)
      .map(({ step, rule }) => (rule.output ? step : { ...step, outputResult: null })),
  );
  let hidden: ReadonlySet<string> = new Set();
  if (scope.hiddenContacts) {
    const candidates = new Set<string>();
    for (const steps of judged) {
      for (const step of steps) {
        if (step.outputResult === null || step.outputResult === undefined) continue;
        collectIdCandidates(step.inputPayload, candidates);
        collectIdCandidates(step.outputResult, candidates);
      }
    }
    if (candidates.size > 0) hidden = await scope.hiddenContacts(candidates);
  }
  return plans.map((plan, i) => ({
    ...plan,
    steps: judged[i].map((step) => {
      if (hidden.size === 0 || step.outputResult === null || step.outputResult === undefined) return step;
      if (namesHiddenContact(step.inputPayload, hidden)) return { ...step, outputResult: null };
      if (!namesHiddenContact(step.outputResult, hidden)) return step;
      const kept = withholdHiddenRows(step.outputResult, hidden);
      return { ...step, outputResult: kept === WITHHELD_ROW ? null : kept };
    }) as Array<PlanStepsOf<T>>,
  }));
}

/** One plan's steps as `scope` lets its viewer read them (visiblePlans). */
export async function visiblePlanSteps<S extends PlanStepView>(steps: readonly S[], scope: GraphPlanReadScope): Promise<S[]> {
  const [plan] = await visiblePlans([{ steps }], scope);
  return plan.steps;
}

/**
 * The plan states whose pending steps this route may still execute: the ones
 * PlanExecutorService does not drive (it enqueues the steps of approved and
 * executing plans with no compare-and-set of its own; V1-31b review SEC-V131b-2).
 */
const OPEN_PLAN_STATUSES = ['draft', 'pending'] as const;
const OPEN_PLAN_STATUS_SET: ReadonlySet<string> = new Set(OPEN_PLAN_STATUSES);

/** What a caller is told when it sends a tool name and arguments instead of a stored step. */
const UNBOUND_GRAPH_ACTION =
  'An action is executed only as a plan step the server holds: send planId and planStepId (from POST actions/businesses/:businessId/plan). A tool name and arguments sent by the client are not executed.';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const n = parseInt(val, 10);
  return Number.isNaN(n) || n < 0 ? fallback : n;
}

@Controller()
@UseGuards(CrmRateLimitGuard)
export class GraphActionsController {
  private readonly logger = new Logger(GraphActionsController.name);

  constructor(
    @Inject(BusinessGraphService) private readonly businessGraph: BusinessGraphService,
    @Inject(IntentParserService) private readonly intentParser: IntentParserService,
    @Inject(PlannerService) private readonly planner: PlannerService,
    @Inject(AiOversightService) private readonly governance: AiOversightService,
    @Inject(FlowOrchestratorService) private readonly orchestrator: FlowOrchestratorService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(WorkspaceRecommendationsService) private readonly workspaceRecs: WorkspaceRecommendationsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(20, 60_000)
  @Get('graph/business/:businessId')
  async getGraph(
    @Param('businessId') businessId: string,
    @Query('refresh') refresh?: string,
  ) {
    const forceRefresh = refresh === 'true' || refresh === '1';
    const snapshot = await this.businessGraph.getSnapshot(businessId, forceRefresh);
    return {
      snapshot,
      generatedAt: new Date().toISOString(),
      linkCount: snapshot.links.length,
      entityCounts: {
        topContacts: snapshot.entities.topContacts.length,
        overdueInvoices: snapshot.entities.overdueInvoices.length,
        catalogProducts: snapshot.entities.catalogProducts.length,
      },
    };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Post('actions/businesses/:businessId/plan')
  async planAction(
    @Param('businessId') businessId: string,
    @Body() body: { input: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!body.input?.trim()) {
      throw new BadRequestException('Input is required');
    }
    const userId = req?.user?.id;
    const intent = await this.intentParser.parse(businessId, body.input);
    if (intent.clarificationNeeded) {
      return { intent, plan: null, clarificationNeeded: true };
    }
    const created = await this.planner.createPlan(businessId, intent, userId);
    // V1-31b: the stored plan, with the step ids POST .../execute takes
    // (createPlan answers its steps without ids).
    const plan = (await this.planner.getPlan(created.id, businessId)) ?? created;

    const snapshot = await this.businessGraph.getSnapshot(businessId);
    const affectedModules = intent.modules;
    const riskAssessment = {
      maxTier: plan.maxRiskTier,
      requiresApproval: plan.maxRiskTier >= 2,
      affectedModules,
      estimatedImpact: this.estimateImpact(plan.steps, snapshot),
    };

    return { intent, plan, clarificationNeeded: false, riskAssessment };
  }

  /**
   * V1-31b-KEY-ACTION-ROUTES-BIND (V1-31 review SEC-V131-1, M46). Executes one
   * plan step the server holds, looked up by planId and planStepId inside the
   * guarded business: the step's own tool and stored arguments, never a tool
   * name or arguments the client sends (those are ignored beside the ids, and
   * refused 400 without them). A step of another business, of another plan
   * or that does not exist is the same 404. The executing member must hold
   * what graphActionRequirement names (module scopes, the CRM sub-permission,
   * OWNER for the tools no grant reaches; an unmapped tool is refused). Only
   * a step of a plan PlanExecutorService does not drive (draft, pending) runs
   * here. The step is claimed pending -> executing (or awaiting_approval) by
   * one compare-and-set that also requires the plan to be open, so a replay,
   * a concurrent call or an approval of the plan in between is 409 and runs
   * nothing. Confirming a stored step by its id is the quick confirmation; a
   * step that needs formal approval is queued once, with the stored payload,
   * requested by the caller. A step the action boundary holds for a
   * confirmation or an approval is given back (pending): asking again reaches
   * the boundary, which answers the same action for the same step, or, once it
   * ran, its recorded outcome. Every run is recorded under the caller's id.
   *
   * Trial-N integration review: a step runs for the member who proposed its
   * plan or the business OWNER (NEW-2, the rule KeyCortexPlannerService
   * applies to a KEY plan), a platform SUPER_ADMIN who is not a member does
   * not write the business's invoices (NEW-1, D-46), and a step queued for
   * approval runs once its approval item is approved (correctness NEW-3:
   * finalizeResolution gives the step back as pending "so it can be
   * executed"; asking again no longer queues a second item).
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Post('actions/businesses/:businessId/execute')
  async executeAction(
    @Param('businessId') businessId: string,
    @Body() body: { planId?: unknown; planStepId?: unknown; toolName?: unknown; args?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const user = req?.user;
    const userId = user?.id;
    if (!user || !userId) throw new UnauthorizedException('Authenticated user required');
    const planId = typeof body?.planId === 'string' && body.planId.length > 0 ? body.planId : null;
    const planStepId = typeof body?.planStepId === 'string' && body.planStepId.length > 0 ? body.planStepId : null;
    if (!planId || !planStepId) throw new BadRequestException(UNBOUND_GRAPH_ACTION);

    const step = await this.prisma.client.aiPlanStep.findFirst({
      where: { id: planStepId, planId, plan: { businessId } },
      include: { plan: { select: { status: true, role: true, userId: true } } },
    });
    if (!step) throw new NotFoundException('Plan step not found');
    if (body.toolName !== undefined || body.args !== undefined) {
      this.logger.warn(`Plan step ${step.id} was sent with a client tool name or arguments; only the stored step is considered`);
    }
    const toolName = step.toolName;
    if (!toolName) throw new BadRequestException('This plan step has no action to execute');
    if (!OPEN_PLAN_STATUS_SET.has(step.plan.status)) {
      throw new ConflictException(`This plan is ${step.plan.status}; its steps are executed by the plan, not from here`);
    }
    await assertMayRunGraphAction(this.prisma, businessId, { id: userId, role: user.role }, toolName, step.plan.userId);

    const spent = () => new ConflictException('This plan step was already executed or is being executed');
    if (step.status !== 'pending') throw spent();

    const args: Record<string, unknown> = isJsonObject(step.inputPayload) ? { ...step.inputPayload } : {};
    const role = (step.role ?? step.plan.role ?? undefined) as BusinessRole | undefined;
    const decision = await this.governance.evaluate(businessId, toolName, undefined, role);
    /**
     * The claim: true when this call moved the step out of 'pending' while its plan is still one
     * the executor does not drive (an approval of the plan in between loses the claim).
     */
    const claim = async (status: string) => {
      const { count } = await this.prisma.client.aiPlanStep.updateMany({
        where: { id: step.id, planId, status: 'pending', plan: { businessId, status: { in: [...OPEN_PLAN_STATUSES] } } },
        data: { status, ...(status === 'executing' ? { startedAt: new Date() } : {}) },
      });
      return count === 1;
    };
    /** The audit row naming the member this route ran the step for (V1-31b review SEC-V131b-5). */
    const audit = (action: string, outcome: { success: boolean; rationale: string; errorMessage?: string; durationMs?: number }) =>
      this.executionLog.log({
        businessId,
        action,
        toolName,
        module: this.inferModule(toolName) ?? undefined,
        riskTier: decision.tier,
        mode: 'assisted',
        actor: 'user',
        userId,
        planId,
        planStepId: step.id,
        ...outcome,
      });

    if (!decision.allowed) {
      // Nothing is claimed: the step can run once policy allows it.
      const blockedPayload: ActionBlockedPayload = {
        businessId,
        toolName,
        reason: decision.reason ?? 'Governance policy',
        riskTier: decision.tier,
      };
      this.eventEmitter.emit('action.blocked', blockedPayload);
      return { success: false, blocked: true, reason: decision.reason, tier: decision.tier };
    }

    // An approval item for this step that a member approved (finalizeResolution then gives the
    // step back as pending): the approval it asked for is given, so the step runs.
    const approved =
      decision.requiresFormalApproval || decision.requiresAdminApproval
        ? await this.prisma.client.aiApprovalItem.findFirst({
            where: { businessId, planStepId: step.id, status: 'approved' },
            select: { id: true },
          })
        : null;
    if ((decision.requiresFormalApproval || decision.requiresAdminApproval) && !approved) {
      if (!(await claim('awaiting_approval'))) throw spent();
      let approval: { id: string };
      try {
        approval = await this.governance.createApprovalItem(businessId, {
          toolName,
          title: step.action || `Execute ${toolName}`,
          description: step.description ?? `Plan step ${step.order}`,
          inputPayload: args,
          planId,
          planStepId: step.id,
        });
      } catch (err: unknown) {
        // Nothing was queued: give the step back so it can be asked again.
        await this.prisma.client.aiPlanStep
          .updateMany({ where: { id: step.id, planId, status: 'awaiting_approval' }, data: { status: 'pending' } })
          .catch(() => undefined);
        throw err;
      }
      // createApprovalItem takes no requester; name the member who asked (as V1-31 does for Flow).
      await this.prisma.client.aiApprovalItem
        .updateMany({ where: { id: approval.id, businessId }, data: { userId } })
        .catch((e: unknown) => this.logger.warn(`Could not name the requester of approval item ${approval.id}: ${e instanceof Error ? e.message : String(e)}`));
      await audit('approval_queued_graph_action', {
        success: true,
        rationale: `Plan step ${step.id} queued for approval ${approval.id} (Tier ${decision.tier}) at the request of ${userId}`,
      });
      return {
        success: false,
        requiresApproval: true,
        approvalId: approval.id,
        tier: decision.tier,
        reason: decision.reason,
      };
    }

    if (!(await claim('executing'))) throw spent();
    const startedAt = Date.now();
    try {
      const result = await this.orchestrator.executeToolDirect(
        businessId,
        toolName,
        args,
        planId,
        step.id,
        // KF-EXEC-ACTION-001: the authenticated caller is the principal.
        { surface: 'GRAPH_ACTION', principalUserId: userId, planId, planStepId: step.id },
      );
      if (result.notCleared) {
        // The action boundary recorded the action and is waiting for it to be
        // confirmed or approved by its server-issued id. Nothing ran. The step
        // is given back (V1-31b review CR-5): the boundary keeps one action per
        // plan step, so asking again answers the same id while it waits and the
        // recorded outcome once it ran, and the step is then settled here. The
        // boundary's action record names the caller as its requester.
        await this.prisma.client.aiPlanStep
          .updateMany({ where: { id: step.id, planId, status: 'executing' }, data: { status: 'pending', startedAt: null } })
          .catch((e: unknown) => this.logger.warn(`Could not give back plan step ${step.id}: ${e instanceof Error ? e.message : String(e)}`));
        return {
          success: false,
          requiresConfirmation: result.notCleared.disposition === 'AWAITING_CONFIRMATION',
          requiresApproval: result.notCleared.disposition === 'AWAITING_APPROVAL',
          confirmationId: result.notCleared.actionId,
          reason: result.error,
          tier: decision.tier,
        };
      }
      const durationMs = Date.now() - startedAt;
      await this.planner.updateStepStatus(
        step.id,
        result.success ? 'completed' : 'failed',
        result.success && isJsonObject(result.result) ? result.result : null,
        result.success ? undefined : result.error,
        durationMs,
      );
      await audit('graph_action:execute', {
        success: result.success,
        rationale: `Plan step ${step.id} executed by ${userId}${approved ? ` (approval ${approved.id})` : ''}`,
        errorMessage: result.success ? undefined : result.error,
        durationMs,
      });
      const executedPayload: ActionExecutedPayload = {
        businessId,
        toolName,
        module: this.inferModule(toolName),
        riskTier: decision.tier,
        success: result.success,
        changedEntities: result.changedEntities,
      };
      this.eventEmitter.emit('action.executed', executedPayload);
      return {
        success: result.success,
        result: result.result,
        changedEntities: result.changedEntities,
        followOnSuggestions: result.followOnSuggestions,
        tier: decision.tier,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startedAt;
      await this.planner
        .updateStepStatus(step.id, 'failed', null, message, durationMs)
        .catch((e: unknown) => this.logger.warn(`Could not record the failure of plan step ${step.id}: ${e instanceof Error ? e.message : String(e)}`));
      await audit('graph_action:execute', { success: false, rationale: `Plan step ${step.id} executed by ${userId}`, errorMessage: message, durationMs });
      const failPayload: ActionExecutedPayload = {
        businessId,
        toolName,
        module: null,
        riskTier: decision.tier,
        success: false,
      };
      this.eventEmitter.emit('action.executed', failPayload);
      return {
        success: false,
        error: message,
        tier: decision.tier,
      };
    }
  }

  /**
   * The action queue: pending approvals, plans, recent executions and (D-70) approved steps.
   *
   * Trial-N repair round 2 (QUEUE-READ): it returned every plan of the business with its steps,
   * step ids and inputPayload to any member. A viewer now sees a plan only when they proposed it
   * or are the business OWNER or an ADMIN (or a SUPER_ADMIN), and within it only the steps whose
   * tool's module scopes they hold at read (the OWNER and a SUPER_ADMIN see every step); a pending
   * approval item and an execution-history row likewise (its tool's modules at read, and their own
   * request, plan or run unless OWNER/ADMIN). Another member's inputPayload is never in the answer.
   *
   * D-70 (2026-11-03): an approval item a member approved for a stored plan step that has not run
   * yet (the step pending in a plan this route still runs) is listed as an 'approved_step' item
   * with its stored planId and planStepId, for a viewer who may run that step (the rule POST
   * .../execute applies: assertMayRunGraphAction). The control tower's Run action posts exactly
   * those ids to POST .../execute, which runs the stored step once with no re-planning.
   *
   * KEY-R3a-PLAN-READS (D-74): the plans are read for the viewer in the query (QUEUE-PLAN-WINDOW)
   * and answered by the rule of every plan read route (visiblePlans).
   */
  @UseGuards(AuthGuard, BusinessGuard)
  @Get('actions/businesses/:businessId/queue')
  async getActionQueue(
    @Param('businessId') businessId: string,
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const user = req?.user;
    if (!user?.id) throw new UnauthorizedException('Authenticated user required');
    const viewer = { id: user.id, role: user.role };
    const take = safeInt(limit, 30);

    // KEY-R3a (QUEUE-PLAN-WINDOW): the plans are read for the viewer, as GET ai/plans reads them
    // (only their own unless they see every plan), so a member's plans do not fall out of the
    // newest `take` plans of the business when other members have newer ones.
    const mayRead = await graphPlanReadScope(this.prisma, businessId, viewer);
    const [pendingApprovals, recentLogs, listedPlans, approvedItems] = await Promise.all([
      this.governance.getPendingApprovals(businessId, take),
      this.executionLog.getHistory(businessId, {}, take, 0),
      this.planner.listPlans(businessId, status || undefined, take, mayRead.seesEveryPlan ? undefined : viewer.id),
      this.prisma.client.aiApprovalItem.findMany({
        where: { businessId, status: 'approved', planStepId: { not: null } },
        orderBy: { resolvedAt: 'desc' },
        take,
      }),
    ]);

    // Who proposed each plan a pending approval item names (the listed plans, else one read).
    const proposerOf = new Map<string, string | null>();
    for (const p of listedPlans ?? []) proposerOf.set(p.id, p.userId ?? null);
    const unlisted = [...new Set(pendingApprovals.map((a) => a.planId).filter((id): id is string => !!id && !proposerOf.has(id)))];
    if (unlisted.length > 0) {
      const rows = await this.prisma.client.aiPlan.findMany({ where: { id: { in: unlisted }, businessId }, select: { id: true, userId: true } });
      for (const row of rows) proposerOf.set(row.id, row.userId ?? null);
    }
    const isOwn = (requesterId: string | null | undefined) => mayRead.seesEveryPlan || (!!requesterId && requesterId === viewer.id);

    // Recheck AI-PLANS-READ and KEY-R3a (D-74): each step judged by the tool the executor dispatches
    // for it (or its KEY-cortex module), a contact read's output withheld from all but the OWNER,
    // and every other output filtered by the viewer's contact visibility (visiblePlans).
    const activePlans = await visiblePlans((listedPlans ?? []).filter((p) => isOwn(p.userId)), mayRead);

    const pending = pendingApprovals
      .filter((a) => mayRead.step(a.toolName) && isOwn(a.planId ? proposerOf.get(a.planId) : a.userId))
      .map((a: any) => ({
      id: a.id,
      type: 'pending_approval' as const,
      toolName: a.toolName,
      title: a.title,
      description: a.description,
      riskTier: a.riskTier,
      module: a.module ?? this.inferModule(a.toolName),
      status: 'pending' as const,
      createdAt: a.createdAt,
      affectedEntities: a.inputPayload ? this.extractAffectedEntities(a.inputPayload) : [],
    }));

    // The same rule for the execution history: another member's run (its rationale names their
    // plan and step) is shown to the OWNER and an ADMIN only, and a run only under its tool's read scope.
    const logs = (recentLogs.logs ?? recentLogs ?? [])
      .filter((l: { userId: string | null; toolName: string | null }) =>
        isOwn(l.userId) && (l.toolName ? mayRead.step(l.toolName) : mayRead.seesEveryPlan))
      .map((l: any) => ({
      id: l.id,
      type: 'executed' as const,
      toolName: l.toolName,
      title: l.action ?? l.toolName,
      description: l.rationale ?? null,
      riskTier: l.riskTier ?? 1,
      module: l.module ?? this.inferModule(l.toolName),
      status: l.success ? ('completed' as const) : ('failed' as const),
      createdAt: l.createdAt,
      affectedEntities: l.outputSummary?.changedEntities ?? [],
    }));

    const planItems = activePlans
      .filter((p: any) => ['pending', 'in_progress', 'approved'].includes(p.status))
      .map((p: any) => ({
        id: p.id,
        type: 'scheduled' as const,
        toolName: p.steps?.[0]?.toolName ?? 'plan',
        title: p.objective,
        description: `${p.steps?.length ?? 0} step plan`,
        riskTier: p.maxRiskTier ?? 1,
        module: p.modules?.[0] ?? null,
        status: p.status === 'in_progress' ? ('active' as const) : ('scheduled' as const),
        createdAt: p.createdAt,
        affectedEntities: p.modules ?? [],
      }));

    const approved = await this.approvedRunnableSteps(businessId, viewer, approvedItems);

    let items = [...approved, ...pending, ...planItems, ...logs];
    if (status) {
      items = items.filter(i => i.status === status);
    }
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      items: items.slice(0, take),
      counts: {
        pending: pending.length,
        approved: approved.length,
        scheduled: planItems.filter((p: any) => p.status === 'scheduled').length,
        active: planItems.filter((p: any) => p.status === 'active').length,
        completed: logs.filter((l: any) => l.status === 'completed').length,
        failed: logs.filter((l: any) => l.status === 'failed').length,
      },
      plans: activePlans,
    };
  }

  /**
   * D-70: the approved approval items whose stored plan step has not run yet (pending, in a plan
   * this route runs) and that the viewer may run (assertMayRunGraphAction, as POST .../execute
   * checks it), as queue items carrying the stored planId and planStepId; one item per step.
   */
  private async approvedRunnableSteps(
    businessId: string,
    viewer: { id: string; role?: string },
    approvedItems: Array<{
      id: string;
      planId: string | null;
      planStepId: string | null;
      title: string;
      description: string | null;
      riskTier: number;
      module: string | null;
      createdAt: Date;
      resolvedAt: Date | null;
    }>,
  ) {
    const stepIds = [...new Set(approvedItems.map((a) => a.planStepId).filter((id): id is string => !!id))];
    if (stepIds.length === 0) return [];
    const steps = await this.prisma.client.aiPlanStep.findMany({
      where: { id: { in: stepIds }, status: 'pending', plan: { businessId, status: { in: [...OPEN_PLAN_STATUSES] } } },
      select: { id: true, planId: true, toolName: true, inputPayload: true, plan: { select: { userId: true } } },
    });
    const byId = new Map(steps.map((st) => [st.id, st]));
    const seen = new Set<string>();
    const out = [];
    for (const item of approvedItems) {
      const step = item.planStepId ? byId.get(item.planStepId) : undefined;
      if (!step || !step.toolName || seen.has(step.id) || (item.planId && item.planId !== step.planId)) continue;
      try {
        await assertMayRunGraphAction(this.prisma, businessId, viewer, step.toolName, step.plan.userId);
      } catch (err: unknown) {
        if (err instanceof ForbiddenException) continue;
        throw err;
      }
      seen.add(step.id);
      out.push({
        id: item.id,
        type: 'approved_step' as const,
        toolName: step.toolName,
        title: item.title,
        description: item.description ?? null,
        riskTier: item.riskTier,
        module: item.module ?? this.inferModule(step.toolName),
        status: 'approved' as const,
        createdAt: item.resolvedAt ?? item.createdAt,
        affectedEntities: isJsonObject(step.inputPayload) ? this.extractAffectedEntities(step.inputPayload) : [],
        planId: step.planId,
        planStepId: step.id,
        approvalId: item.id,
      });
    }
    return out;
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @Get('autopilot/businesses/:businessId/coverage')
  async getAutopilotCoverage(@Param('businessId') businessId: string) {
    const [coverage, settings, snapshot] = await Promise.all([
      this.workspaceRecs.getAutomationCoverage(businessId),
      this.governance.getAutonomySettings(businessId),
      this.businessGraph.getSnapshot(businessId),
    ]);

    const recentExecCount = await this.prisma.client.aiExecutionLog.count({
      where: {
        businessId,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });

    const pendingApprovalCount = await this.prisma.client.aiApprovalItem.count({
      where: { businessId, status: 'pending' },
    });

    const moduleGaps: Array<{ module: string; gap: string; severity: 'high' | 'medium' | 'low' }> = [];
    for (const mod of coverage.modules) {
      if (mod.coveragePct < 20) {
        moduleGaps.push({ module: mod.module, gap: `Only ${mod.coveragePct}% automated`, severity: 'high' });
      } else if (mod.coveragePct < 50) {
        moduleGaps.push({ module: mod.module, gap: `${mod.coveragePct}% automated`, severity: 'medium' });
      }
    }

    return {
      overallCoverage: coverage.overallPct,
      modules: coverage.modules,
      gaps: moduleGaps,
      governance: {
        mode: settings.mode,
        maxAutoTier: settings.maxAutoTier,
        blockedToolCount: settings.blockedTools.length,
        blockedModuleCount: settings.blockedModules.length,
      },
      activity: {
        executionsLast7Days: recentExecCount,
        pendingApprovals: pendingApprovalCount,
        activeFlows: snapshot.automations.activeCount,
        disabledFlows: snapshot.automations.disabledCount,
      },
    };
  }

  private inferModule(toolName: string | null): string | null {
    if (!toolName) return null;
    const lower = toolName.toLowerCase();
    if (lower.includes('contact') || lower.includes('client') || lower.includes('lead')) return 'crm';
    if (lower.includes('invoice') || lower.includes('payment') || lower.includes('revenue')) return 'revenue';
    if (lower.includes('booking') || lower.includes('calendar') || lower.includes('schedule')) return 'calendar';
    if (lower.includes('campaign') || lower.includes('content') || lower.includes('post')) return 'content';
    if (lower.includes('project') || lower.includes('task')) return 'projects';
    if (lower.includes('expense') || lower.includes('budget')) return 'expenses';
    if (lower.includes('flow') || lower.includes('automation')) return 'flows';
    if (lower.includes('store') || lower.includes('product') || lower.includes('storefront')) return 'store';
    return null;
  }

  private extractAffectedEntities(inputPayload: Record<string, any>): string[] {
    const entities: string[] = [];
    for (const key of ['contactId', 'invoiceId', 'bookingId', 'projectId', 'productId', 'campaignId']) {
      if (inputPayload[key]) entities.push(`${key.replace('Id', '')}:${inputPayload[key]}`);
    }
    return entities;
  }

  private estimateImpact(
    steps: Array<{ riskTier: number; module: string | null }>,
    snapshot: any,
  ): string {
    const highRisk = steps.filter(s => s.riskTier >= 3).length;
    const modules = [...new Set(steps.map(s => s.module).filter(Boolean))];
    if (highRisk > 0) {
      return `${highRisk} high-risk step${highRisk > 1 ? 's' : ''} across ${modules.length} module${modules.length > 1 ? 's' : ''}`;
    }
    return `${steps.length} step${steps.length > 1 ? 's' : ''} across ${modules.length} module${modules.length > 1 ? 's' : ''}`;
  }
}
