/**
 * KEY Cortex Controller
 * REST + SSE streaming API for the JARVIS-like AI system.
 *
 * Provides session management, chat (streaming & non-streaming),
 * voice synthesis/recognition, personality management, business
 * insights, profit opportunities, and action execution.
 *
 * v2 -- Integration Layer:
 *   Added command execution, module query, capabilities, full context,
 *   insights (revenue/churn/pipeline), monitors, alerts, batch execution,
 *   rollback, business reports, and AI recommendations.
 *
 * v3 -- Phase 3 & 4 Services:
 *   Added Sandbox (code generation & execution), Flow Studio (workflow
 *   management), External Connectors (third-party integrations), Phone
 *   Agent (voice calls), Document Intelligence (RAG & extraction), and
 *   Self-Evolution (adaptive learning & tuning).
 */

import {
  Controller,
  Post,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  Sse,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  Logger,
  Inject,
  Injectable,
  Optional,
  createParamDecorator,
  forwardRef,
  type CallHandler,
  type CanActivate,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { KeyCortexSessionService } from './key-cortex-session.service';
import {
  KeyCortexConsciousnessService,
  type ConsciousPhaseEvent,
} from './key-cortex-consciousness.service';
import {
  KeyCortexAwarenessService,
  AWARENESS_TYPES,
} from './key-cortex-awareness.service';
import {
  Allow,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import { Observable, Subject, interval, map, from, of, catchError, concatWith, defer, switchMap, throwError } from 'rxjs';

import { KeyCortexReasoningService } from './key-cortex-reasoning.service';
import { KeyCortexConversationService } from './key-cortex-conversation.service';
import { KeyCortexVoiceService } from './key-cortex-voice.service';
import { KeyCortexPersonalityService } from './key-cortex-personality.service';
import { KeyCortexActionsService, isUsableAutonomyVerdict } from './key-cortex-actions.service';
import { KeyCortexContextService } from './key-cortex-context.service';
import { KeyCortexCapabilityRegistryService } from './key-cortex-capability-registry.service';
import { randomUUID } from 'crypto';

// -- v2 Integration Layer Services --
import { KeyCortexConnectorService } from './key-cortex-connector.service';
import { KeyCortexCommandService } from './key-cortex-command.service';
import { KeyCortexExecutorService, type ExecutionRecord } from './key-cortex-executor.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { KeyCortexInsightService } from './key-cortex-insight.service';
import { KeyCortexMonitorV2Service } from './key-cortex-monitor-v2.service';

// -- v3 Phase 3 & 4 Services --
import { KeyCortexSandboxService } from './key-cortex-sandbox.service';
import { KeyCortexFlowStudioService } from './key-cortex-flow-studio.service';
import type { FlowTemplate, NodeRegistryEntry } from './key-cortex-flow-studio.types';
import { KeyCortexEvolutionService } from './key-cortex-evolution.service';
import { KeyCortexPhoneService } from './key-cortex-phone.service';
import { KeyCortexDocumentService } from './key-cortex-document.service';

// -- Phase D: Learning & Metacognition --
import { KeyCortexLearningService } from './key-cortex-learning.service';

import {
  CortexQuery,
  CortexPersona,
  CortexVoice,
  CortexProvider,
  CortexStreamChunk,
  CortexResponse,
  CortexSession,
  CortexMessage,
  CortexSessionStatus,
  CortexVoiceRequest,
  CortexSTTRequest,
  CortexInsight,
  CortexProfitOpportunity,
  CortexActionResult,
  CortexPersonalityConfig,
  CortexMood,
} from './key-cortex.types';

import {
  ModuleName,
  ConnectorCommand,
  ConnectorResult,
} from './key-cortex-connector.types';

import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard, type BusinessGuardedRequest } from '../../core/auth/business.guard';
import { GuardedBusinessId, resolveRequestBusinessId } from '../../core/auth/request-business-id';
import { PrismaService } from '../../core/prisma/prisma.service';
import { membershipApprovalTier } from '../../core/authority/approval-tier';
import {
  DEFAULT_APPROVAL_TIERS,
  LEVEL_RANK,
  MAX_APPROVAL_TIER,
  defaultScopesForRole,
  rankOf,
  type CanonicalModule,
} from '../../core/authority/module-vocabulary';
import { CurrentUser, type AuthenticatedUser } from '../../core/decorators/current-user.decorator';
import { KeyCortexApprovalOrchestratorService } from './key-cortex-approval-orchestrator.service';
import { KeyAutonomySafetyService } from '../key-autonomy/key-autonomy-safety.service';
import { AutonomyOrchestratorService } from '../key-autonomy/autonomy-orchestrator.service';

/**
 * R0-07a / R0-34b (COST-LEDGER-001 section 7 item 7): the structured 503 an
 * optional AI provider answers when it is not configured or every credential's
 * circuit is open. A voice handler rethrows it unchanged, so the body keeps its
 * code; every other failure keeps the handler's own 503.
 */
function isAiProviderUnavailable(err: unknown): err is HttpException {
  if (!(err instanceof HttpException) || err.getStatus() !== HttpStatus.SERVICE_UNAVAILABLE) return false;
  const body = err.getResponse();
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
  return code === 'provider_not_configured' || code === 'provider_unavailable';
}

/**
 * R0-34b: the tenant a multipart (FileInterceptor) handler acts on.
 *
 * multer parses a multipart body inside FileInterceptor, after the guards ran,
 * so BusinessGuard resolved and checked the tenant from the path and query
 * only. @GuardedBusinessId() resolves again when the handler is called, and by
 * then `req.body` holds the multipart fields: a `businessId` field the guard
 * never saw would win over the query it checked. BusinessGuard attaches the
 * tenant it verified (`req.guardedBusinessId`); the handler acts on exactly
 * that one and refuses a request whose fields name another. When nothing is
 * attached (SUPER_ADMIN, whom the guard admits without a check) the resolved
 * tenant stands.
 */
function multipartTenant(resolved: string | undefined, req: BusinessGuardedRequest | undefined): string | undefined {
  const checked = req?.guardedBusinessId;
  if (typeof checked !== 'string' || checked.length === 0) return resolved;
  if (resolved !== checked) {
    throw new ForbiddenException('businessId does not match the business this request was authorized for');
  }
  return checked;
}

/**
 * R0-09c-KEY-ACTOR-BINDING (R0-09-ID-HARDEN review R09-ST-4; R0-34b review
 * ST-3): the human a KEY request acts for.
 *
 * It is the principal AuthGuard admitted (`req.user`, read with
 * @CurrentUser()), never a body or query `userId`: those were read here, so a
 * STAFF member attributed a command to the OWNER (POST execute and batch built
 * the ConnectorCommand with `dto.userId ?? 'system'`), and a member of A wrote
 * CortexSession rows under A attributed to a user outside A. A request `userId`
 * is now IGNORED, not refused: the DTOs still accept it as an optional string
 * so existing clients keep working, and no handler reads it. With no
 * authenticated user the handler answers 401 instead of acting for 'system',
 * 'key_user' or nobody (AuthGuard already refuses such a request; this keeps a
 * handler reached any other way from running unattributed).
 */
function requestActorId(user: AuthenticatedUser | undefined): string {
  const id = user?.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new UnauthorizedException('Authenticated user required');
  }
  return id;
}

/* ------------------------------------------------------------------ */
/*  V1-31c-KEY-ACTION-WEB-AND-OPEN-ROUTES: the direct-action principle  */
/* ------------------------------------------------------------------ */

/**
 * V1-31c (M46 / ACTION-001; owner rulings D-17, D-40). POST execute, POST batch
 * and a flow's effect nodes run a member-initiated direct command: a connector
 * module and action with client parameters. Such a command runs only when the
 * member holds the action's own module write scope, read here deny by default:
 *
 *   - the action must be one the KEY capability registry lists as an ACTION of
 *     that module (KeyCortexCapabilityRegistryService, the catalogue the
 *     connector routes by); anything else is refused by name;
 *   - the connector module must map to a canonical module scope below; an
 *     unmapped module is refused;
 *   - crm is the OWNER's only: the crm adapter writes contacts with no actor,
 *     so neither row visibility (V1-08, V1-17) nor the crm sub-permissions can
 *     apply (the rule V1-31b's graphActionRequirement keeps for the contact
 *     writes the dispatcher makes);
 *   - settings is enforced by its adapter on the command's actor
 *     (SettingsAdapterService, R0-09c review CR-3, CR-1, ST-6: the D-11 owner
 *     rule on the profile and branding, connect write for integrations, the
 *     team rules for members); the executor's own blocked actions
 *     (EXECUTE_TOOL, QUERY_DATABASE, UPDATE_RECORD) are refused by the executor,
 *     which writes that refusal's audit row (R0-09e).
 *
 * Every action of a mapped module needs write: a registry action mutates state
 * (ModuleAction); reads go through POST query.
 */
type CortexModuleRule =
  | { scope: CanonicalModule; ownerOnly?: string }
  | { adapterEnforced: string }
  | { refused: string };

const CRM_OWNER_ONLY =
  'the crm adapter writes contacts with no actor, so row visibility and the crm sub-permissions cannot be applied';

const CORTEX_MODULE_RULES: Readonly<Record<string, CortexModuleRule>> = {
  crm: { scope: 'crm', ownerOnly: CRM_OWNER_ONLY },
  commerce: { scope: 'revenue' },
  finance: { scope: 'expenses' },
  bookings: { scope: 'bookings' },
  content: { scope: 'content' },
  social: { scope: 'content' },
  communications: { scope: 'content' },
  projects: { scope: 'projects' },
  analytics: { scope: 'analytics' },
  intelligence: { scope: 'analytics' },
  flow: { scope: 'automations' },
  autopilot: { scope: 'automations' },
  inbox: { scope: 'operations' },
  notifications: { scope: 'operations' },
  temporal: { scope: 'ai' },
  settings: {
    adapterEnforced:
      "SettingsAdapterService applies the actor's own authority per action (the D-11 owner rule, connect write, the team rules)",
  },
  genome: { refused: 'the business genome is changed through its own routes, not by a direct command' },
  activity: { refused: 'the audit trail is not written, exported or pruned by a direct command' },
};

/** The actions KeyCortexExecutorService refuses itself (its BLOCKED_ACTIONS), writing the refusal's audit row. */
const EXECUTOR_REFUSED_ACTIONS = new Set(['EXECUTE_TOOL', 'QUERY_DATABASE', 'UPDATE_RECORD']);

const CORTEX_CAPABILITIES = new KeyCortexCapabilityRegistryService().getAllCapabilities();

/** The actions the KEY capability registry lists, per connector module. */
const CORTEX_REGISTRY_ACTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  CORTEX_CAPABILITIES.map((capability) => [capability.module as string, new Set(capability.actions.map((a) => a.name))]),
);

/** The read-only queries the KEY capability registry lists, per connector module (V1-31c review SEC-V131c-2). */
const CORTEX_REGISTRY_QUERIES: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  CORTEX_CAPABILITIES.map((capability) => [capability.module as string, new Set(capability.queries.map((q) => q.name))]),
);

const CRM_READ_OWNER_ONLY =
  'the crm adapter reads contacts with no actor, so row visibility (a private contact stays its owner\'s) cannot be applied';

export type CortexCommandRequirement =
  | { scope: CanonicalModule; ownerOnly?: string }
  | { adapterEnforced: string }
  | { executorRefused: string }
  | { refused: string };

/** What a direct command `module.action` needs from the member (see CORTEX_MODULE_RULES). */
export function cortexCommandRequirement(module: unknown, action: unknown): CortexCommandRequirement {
  if (typeof action === 'string' && EXECUTOR_REFUSED_ACTIONS.has(action)) {
    return { executorRefused: `"${action}" is refused by KeyCortexExecutorService` };
  }
  if (typeof module !== 'string' || typeof action !== 'string' || module.length === 0 || action.length === 0) {
    return { refused: 'A direct command names a module and an action' };
  }
  const rule = Object.prototype.hasOwnProperty.call(CORTEX_MODULE_RULES, module) ? CORTEX_MODULE_RULES[module] : undefined;
  if (!rule) return { refused: `Module "${module}" is mapped to no module scope, so it is not run as a direct command` };
  if ('refused' in rule) return { refused: `Module "${module}" is not run as a direct command: ${rule.refused}` };
  if (!CORTEX_REGISTRY_ACTIONS.get(module)?.has(action)) {
    return { refused: `"${module}.${action}" is not an action the KEY capability registry lists, so it is not run` };
  }
  return rule;
}

/**
 * The member a direct command acts for, in the tenant BusinessGuard checked,
 * as CortexMemberAuthorityGuard loaded it: the membership role and its scopes
 * as ModuleScopeGuard computes them (the explicit scope map, else the role's
 * defaults), or the SUPER_ADMIN platform bypass.
 */
export interface CortexMemberAuthority {
  userId: string;
  businessId: string;
  role: string;
  superAdmin: boolean;
  scopes: Record<string, string>;
}

/** Why `authority` may not run `module.action` as a direct command, or null when it may. */
export function cortexCommandRefusal(authority: CortexMemberAuthority, module: unknown, action: unknown): string | null {
  const requirement = cortexCommandRequirement(module, action);
  if ('refused' in requirement) return requirement.refused;
  if ('executorRefused' in requirement || 'adapterEnforced' in requirement) return null;
  if (authority.superAdmin) return null;
  if (requirement.ownerOnly && authority.role !== 'OWNER') {
    return `"${String(module)}.${String(action)}" is run as a direct command only for the business owner: ${requirement.ownerOnly}`;
  }
  const level = authority.scopes[requirement.scope] || 'none';
  if (rankOf(level) < LEVEL_RANK.write) {
    return `Insufficient permissions: ${requirement.scope} requires write access (you have ${level})`;
  }
  return null;
}

/** True when `module` is one whose adapter applies the actor's own authority per action (settings). */
export function cortexModuleAdapterEnforced(module: unknown): boolean {
  if (typeof module !== 'string' || !Object.prototype.hasOwnProperty.call(CORTEX_MODULE_RULES, module)) return false;
  return 'adapterEnforced' in CORTEX_MODULE_RULES[module];
}

/**
 * V1-31c review SEC-V131c-2: why `authority` may not run `module.query` through
 * POST query, or null when it may. connector.query hands any name to the module
 * adapter as a command (connector.execute), so the route is bounded, deny by
 * default, to what it says it is:
 *   - a READ the KEY capability registry lists as a QUERY of that module, under
 *     the module's canonical scope at read (crm reads are the OWNER's only:
 *     the crm adapter reads with no actor, so row visibility cannot apply);
 *   - settings, whose adapter applies the actor's own authority per action;
 *     the route runs it as POST execute does (the executor's autonomy gate,
 *     blocked actions and audit row);
 *   - nothing else: an action (a write) runs through POST execute, which checks
 *     it (cortexCommandRefusal), gates it and audits it; an unmapped or refused
 *     module, and the executor's blocked actions, are refused by name.
 */
export function cortexQueryRefusal(authority: CortexMemberAuthority, module: unknown, query: unknown): string | null {
  if (typeof query === 'string' && EXECUTOR_REFUSED_ACTIONS.has(query)) {
    return `"${query}" is refused by KeyCortexExecutorService and is not run as a query`;
  }
  if (typeof module !== 'string' || typeof query !== 'string' || module.length === 0 || query.length === 0) {
    return 'A query names a module and a query';
  }
  const rule = Object.prototype.hasOwnProperty.call(CORTEX_MODULE_RULES, module) ? CORTEX_MODULE_RULES[module] : undefined;
  if (!rule) return `Module "${module}" is mapped to no module scope, so it is not queried directly`;
  if ('refused' in rule) return `Module "${module}" is not queried directly: ${rule.refused}`;
  if ('adapterEnforced' in rule) return null;
  if (!CORTEX_REGISTRY_QUERIES.get(module)?.has(query)) {
    return `"${module}.${query}" is not a query the KEY capability registry lists for ${module}; an action runs through POST execute, which checks, gates and audits it`;
  }
  if (authority.superAdmin) return null;
  if (rule.scope === 'crm' && authority.role !== 'OWNER') {
    return `"${module}.${query}" is queried directly only by the business owner: ${CRM_READ_OWNER_ONLY}`;
  }
  const level = authority.scopes[rule.scope] || 'none';
  if (rankOf(level) < LEVEL_RANK.read) {
    return `Insufficient permissions: ${rule.scope} requires read access (you have ${level})`;
  }
  return null;
}

/** A flow node's effect, as a direct command (or a module scope), or null when the node has none of its own. */
function cortexFlowNodeEffect(node: { type?: unknown; data?: Record<string, unknown> }):
  | { module: unknown; action: unknown }
  | { scope: CanonicalModule }
  | { refused: string }
  | null {
  switch (node.type) {
    case 'action':
      return { module: node.data?.module, action: node.data?.action };
    case 'notification':
      return { module: 'notifications', action: 'send_notification' };
    case 'ai_decision':
      return { scope: 'ai' };
    case 'trigger':
    case 'condition':
    case 'delay':
    case 'merge':
    case 'split':
    case 'wait_for':
    case 'loop':
    case 'error_handler':
    case 'transform':
    case 'filter':
      return null;
    default:
      return { refused: `A flow node of type "${String(node.type)}" is not run from this route` };
  }
}

/** V1-31c: what sandbox/execute, sandbox/apply and sandbox/auto answer (410). */
const SANDBOX_REFUSED =
  'Client code is not executed: the cortex sandbox is not bounded to your own data. This route is no longer available.';

/** V1-31c: the flow engine's own context keys (`_userId` names the actor of every node); a client input never sets one. */
const FLOW_ENGINE_KEY = /^_/;

/** The flow engine's parameter template syntax (KeyCortexFlowStudioService.interpolateTemplate). */
const FLOW_PLACEHOLDER = /\{\{\s*([^}]+)\s*\}\}/g;

/** KeyCortexFlowStudioService.resolveParameters: the engine resolves a node's parameters against the run context with it. */
type FlowParameterResolver = (params: Record<string, unknown>, context: Record<string, unknown>) => Record<string, unknown>;

type CortexMemberRequest = BusinessGuardedRequest & {
  user?: { id?: string; role?: string };
  cortexMemberAuthority?: CortexMemberAuthority;
};

/**
 * V1-31c: loads the member a direct command acts for (CortexMemberAuthority)
 * in the tenant BusinessGuard checked, and leaves it on the request for the
 * handler (@CortexMember()). It runs as a route guard after the class guards,
 * so the handler signatures key-cortex-tenant-binding.spec.ts and the
 * real-database suites pin keep their first parameters; it refuses nothing
 * BusinessGuard admitted except a request with no user or no tenant.
 */
@Injectable()
export class CortexMemberAuthorityGuard implements CanActivate {
  // One line on purpose: key-cortex-conscious-surface.spec.ts reads the controller's constructor by text.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CortexMemberRequest>();
    const user = req?.user;
    if (typeof user?.id !== 'string' || user.id.length === 0) {
      throw new UnauthorizedException('Authenticated user required');
    }
    const guarded = req.guardedBusinessId;
    const businessId = typeof guarded === 'string' && guarded.length > 0 ? guarded : resolveRequestBusinessId(req);
    if (!businessId) throw new BadRequestException('businessId is required');
    if (user.role === 'SUPER_ADMIN') {
      req.cortexMemberAuthority = { userId: user.id, businessId, role: 'SUPER_ADMIN', superAdmin: true, scopes: {} };
      return true;
    }
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: user.id, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (!membership) throw new ForbiddenException('Not a member of this business');
    const explicit = membership.permissionScopes;
    const scopes: Record<string, string> =
      explicit && typeof explicit === 'object' && !Array.isArray(explicit)
        ? (explicit as Record<string, string>)
        : defaultScopesForRole(membership.role);
    req.cortexMemberAuthority = { userId: user.id, businessId, role: membership.role, superAdmin: false, scopes };
    return true;
  }
}

/**
 * The CortexMemberAuthority the route's CortexMemberAuthorityGuard loaded. Over
 * HTTP it is always there (the guard runs first); a route that declares this
 * parameter without the guard is refused rather than run unchecked.
 */
export const CortexMember = createParamDecorator((_data: unknown, ctx: ExecutionContext): CortexMemberAuthority => {
  const authority = ctx.switchToHttp().getRequest<CortexMemberRequest>()?.cortexMemberAuthority;
  if (!authority) throw new ForbiddenException('The member this command acts for was not established');
  return authority;
});

/** The membership roles that may write the KEY autonomy profile (V1-03). */
const AUTONOMY_PROFILE_WRITER_ROLES = new Set(['OWNER', 'ADMIN']);

/** The BusinessAutonomyProfile columns PATCH autonomy-profile writes. */
export interface AutonomyProfileSettings {
  globalKillSwitch: boolean;
  maxDailyAutoActions: number;
  maxDailySpendTtd: number;
  maxTierWithoutApproval: number;
  notifyOnBlock: boolean;
}

const AUTONOMY_BOOLEAN_FIELDS = ['globalKillSwitch', 'notifyOnBlock'] as const;
const AUTONOMY_NUMBER_FIELDS = ['maxDailyAutoActions', 'maxDailySpendTtd', 'maxTierWithoutApproval'] as const;
const AUTONOMY_PROFILE_FIELDS: readonly (keyof AutonomyProfileSettings)[] = [
  'globalKillSwitch', 'maxDailyAutoActions', 'maxDailySpendTtd', 'maxTierWithoutApproval', 'notifyOnBlock',
];

/** The five settings of a stored profile (or a handler's answer), without its id and timestamps. */
function autonomySettingsOf(row: AutonomyProfileSettings): AutonomyProfileSettings {
  return {
    globalKillSwitch: row.globalKillSwitch,
    maxDailyAutoActions: row.maxDailyAutoActions,
    maxDailySpendTtd: row.maxDailySpendTtd,
    maxTierWithoutApproval: row.maxTierWithoutApproval,
    notifyOnBlock: row.notifyOnBlock,
  };
}

/**
 * The settings a PATCH body sets, read from the raw body (the ValidationPipe
 * runs after the guards). A field that is absent or null sets nothing (the
 * DTO's @IsOptional() admits both; updateProfile skips an absent one and
 * Prisma refuses a null for these required columns). A field of the
 * wrong type is 400 here, so it can never be misread as "no change" and slip
 * past the comparison below.
 */
function requestedAutonomySettings(body: unknown): Partial<AutonomyProfileSettings> {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const out: Partial<AutonomyProfileSettings> = {};
  for (const field of AUTONOMY_BOOLEAN_FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'boolean') throw new BadRequestException(`${field} must be a boolean`);
    out[field] = value;
  }
  for (const field of AUTONOMY_NUMBER_FIELDS) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new BadRequestException(`${field} must be a number`);
    out[field] = value;
  }
  return out;
}

/**
 * A daily spend cap as a limit: KeyAutonomySafetyService.check enforces it only
 * when it is above 0, so 0 (the default) or below means no limit.
 */
const spendLimit = (ttd: number) => (ttd > 0 ? ttd : Number.POSITIVE_INFINITY);

/**
 * The settings a write LOOSENS against the stored profile: each lets KEY act
 * more, or with less oversight, than it does now. Releasing the kill switch,
 * raising the tier ceiling or the daily action cap, lifting or removing the
 * spend cap (0 is unlimited) and turning block notices off. A field sent with
 * its stored value is not a change (the web form, apps/web settings/autonomy,
 * sends every field on every save), and tightening a field never needs tier.
 */
export function loosenedAutonomySettings(
  stored: AutonomyProfileSettings,
  requested: Partial<AutonomyProfileSettings>,
): (keyof AutonomyProfileSettings)[] {
  const out: (keyof AutonomyProfileSettings)[] = [];
  if (requested.globalKillSwitch === false && stored.globalKillSwitch) out.push('globalKillSwitch');
  if (requested.maxDailyAutoActions !== undefined && requested.maxDailyAutoActions > stored.maxDailyAutoActions) out.push('maxDailyAutoActions');
  if (requested.maxDailySpendTtd !== undefined && spendLimit(requested.maxDailySpendTtd) > spendLimit(stored.maxDailySpendTtd)) {
    out.push('maxDailySpendTtd');
  }
  if (requested.maxTierWithoutApproval !== undefined && requested.maxTierWithoutApproval > stored.maxTierWithoutApproval) {
    out.push('maxTierWithoutApproval');
  }
  if (requested.notifyOnBlock === false && stored.notifyOnBlock) out.push('notifyOnBlock');
  return out;
}

/**
 * What AutonomyProfileWriteGuard decided, left on the request for
 * AutonomyProfileAuditInterceptor: who wrote, at what tier, and the stored
 * profile the write was judged against (the audit row's `before`).
 */
export interface AutonomyProfileWriteDecision {
  businessId: string;
  actorId: string;
  actorTier: number;
  before: AutonomyProfileSettings;
  loosened: (keyof AutonomyProfileSettings)[];
}

export type AutonomyProfileWriteRequest = BusinessGuardedRequest & {
  user?: { id?: string; role?: string };
  autonomyProfileWrite?: AutonomyProfileWriteDecision;
};

/**
 * V1-03-KEY-CORTEX-PRINCIPAL (build map CF-28, M47; owner ruling D-17): who
 * may write the KEY autonomy profile, the global kill switch and the tier
 * ceiling included.
 *
 * PATCH autonomy-profile sat behind AuthGuard and BusinessGuard only, so any
 * member (STAFF included) could switch the kill switch off or raise
 * maxTierWithoutApproval, the tier above which KEY always asks a human. Now:
 *
 *   - the writer is an OWNER or ADMIN membership of the tenant, the owner of
 *     record (Business.ownerId, the second arm IdentityService.assertBusinessOwner
 *     admits, at the OWNER tier), or SUPER_ADMIN (the platform bypass
 *     BusinessGuard grants, at the maximum tier); everyone else is 403;
 *   - the write is judged against the profile it leaves behind, not the one
 *     value it names (review V1-03 ST-1, CR-V103-1). A write that LOOSENS any
 *     setting (loosenedAutonomySettings: releasing the kill switch, raising the
 *     tier ceiling or a daily cap, lifting the spend cap, turning block notices
 *     off) needs the caller's own approval tier (the Membership rule in
 *     core/authority/approval-tier.ts: OWNER 4, ADMIN 3 by default, or the
 *     tier an explicit scope map pins) to reach the tier ceiling the profile
 *     will hold: the one the body sets, else the stored one. So an ADMIN at
 *     tier 3 cannot let KEY run tier-4 tools unapproved, whether by raising the
 *     ceiling, releasing the kill switch over an OWNER's ceiling of 4 or
 *     lifting its caps; an ADMIN restricted to tier 0 loosens nothing while
 *     KEY may run tools above tier 0. Tightening (switching the kill switch on,
 *     lowering the ceiling or a cap) is open to every writer, and a field sent
 *     with its stored value is no change: the web form resubmits every field
 *     on each save, as R0-09f's finance tax rate rule treats a resubmitted
 *     rate (finance-settings.service.ts assertTaxRateOwner);
 *   - a field of the wrong type is 400 here, before it could slip past the
 *     comparison.
 *
 * The stored profile is the one KeyAutonomySafetyService.ensureProfile
 * returns, the same call GET and updateProfile make (a business with no row
 * gets its default row, as a GET would create it). The tenant is the one
 * BusinessGuard checked (`guardedBusinessId`; for SUPER_ADMIN, whom the guard
 * admits without one, the same resolver), which is the tenant
 * @GuardedBusinessId() hands the handler, so a body businessId naming another
 * tenant cannot borrow the caller's role there. It runs as a route guard,
 * after the class guards, so the handler's signature (and the parameter types
 * key-cortex-tenant-binding.spec.ts pins) is unchanged; it reads the raw body,
 * which the ValidationPipe validates afterwards. The decision is left on the
 * request (`autonomyProfileWrite`) for the write AutonomyProfileAuditInterceptor
 * binds.
 *
 * The decision holds only for the profile it was judged against, which is
 * read here, before the handler runs, without a lock. So the write is a
 * compare-and-set on that profile (review SEC-V103-1): it lands only while the
 * stored row still equals `before`, and answers 409 otherwise. A stale request
 * (a resubmitted ceiling of 4, or a kill-switch release judged before an
 * OWNER raised the ceiling) can no longer overwrite a change made after it was
 * judged.
 */
@Injectable()
export class AutonomyProfileWriteGuard implements CanActivate {
  // One line on purpose: key-cortex-conscious-surface.spec.ts reads the controller's
  // constructor from the first `  constructor(` in this file to the first `\n  ) {`.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(KeyAutonomySafetyService) private readonly safety: KeyAutonomySafetyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AutonomyProfileWriteRequest>();
    const user = req?.user;
    if (typeof user?.id !== 'string' || user.id.length === 0) {
      throw new UnauthorizedException('Authenticated user required');
    }
    const guarded = req.guardedBusinessId;
    const businessId = typeof guarded === 'string' && guarded.length > 0 ? guarded : resolveRequestBusinessId(req);
    if (!businessId) {
      throw new BadRequestException('businessId is required');
    }

    const tier = await this.writerTier(businessId, { id: user.id, role: user.role });
    if (tier === null) {
      throw new ForbiddenException('Only an owner or admin of this business can change the KEY autonomy profile');
    }

    const requested = requestedAutonomySettings(req.body);
    const before = await this.storedSettings(businessId);
    const loosened = loosenedAutonomySettings(before, requested);
    const ceiling = requested.maxTierWithoutApproval ?? before.maxTierWithoutApproval;
    if (loosened.length > 0 && ceiling > tier) {
      if (loosened.includes('maxTierWithoutApproval')) {
        throw new ForbiddenException(
          `Setting maxTierWithoutApproval to ${ceiling} requires approval tier ${ceiling}; you have tier ${tier}`,
        );
      }
      throw new ForbiddenException(
        `Loosening ${loosened.join(', ')} while KEY may run tier-${ceiling} tools without approval requires approval tier ${ceiling}; you have tier ${tier}`,
      );
    }

    req.autonomyProfileWrite = { businessId, actorId: user.id, actorTier: tier, before, loosened };
    return true;
  }

  /** The approval tier of an autonomy-profile writer in `businessId`, or null for anyone else. */
  private async writerTier(businessId: string, user: { id: string; role?: string }): Promise<number | null> {
    if (user.role === 'SUPER_ADMIN') return MAX_APPROVAL_TIER;
    try {
      // Membership is not tenant-scoped by the Prisma extension: the compound
      // key's businessId is what keeps this read inside the tenant.
      const membership = await this.prisma.client.membership.findUnique({
        where: { userId_businessId: { userId: user.id, businessId } },
        select: { role: true, maxApprovalTier: true, permissionScopes: true },
      });
      if (membership && AUTONOMY_PROFILE_WRITER_ROLES.has(membership.role)) {
        return membershipApprovalTier(membership);
      }
      const owned = await this.prisma.client.business.findFirst({
        where: { id: businessId, ownerId: user.id },
        select: { id: true },
      });
      return owned ? DEFAULT_APPROVAL_TIERS.OWNER : null;
    } catch {
      // Fail closed, as BusinessGuard does when its lookup fails.
      throw new ForbiddenException('Unable to verify autonomy-profile authority');
    }
  }

  /** The profile the write will change, as KeyAutonomySafetyService holds it. */
  private async storedSettings(businessId: string): Promise<AutonomyProfileSettings> {
    try {
      return autonomySettingsOf(await this.safety.ensureProfile(businessId));
    } catch {
      // Fail closed: a write that cannot be compared with the stored profile is not judged.
      throw new ForbiddenException('Unable to verify autonomy-profile authority');
    }
  }
}

/** A value for an audit title. */
const auditValue = (field: keyof AutonomyProfileSettings, value: unknown) =>
  field === 'maxDailySpendTtd' && typeof value === 'number' && value <= 0 ? 'unlimited' : String(value);

/** A stored BusinessAutonomyProfile row, as KeyAutonomySafetyService returns it. */
type StoredAutonomyProfile = Awaited<ReturnType<KeyAutonomySafetyService['ensureProfile']>>;

/**
 * The settings a write sets that differ from the profile it was judged
 * against. A field sent with its stored value is left out, so it is never
 * written back over a change that landed after the request was judged
 * (review SEC-V103-1).
 */
function changedAutonomySettings(
  before: AutonomyProfileSettings,
  requested: Partial<AutonomyProfileSettings>,
): Partial<AutonomyProfileSettings> {
  const out: Partial<AutonomyProfileSettings> = {};
  for (const field of AUTONOMY_PROFILE_FIELDS) {
    const value = requested[field];
    if (value !== undefined && value !== before[field]) Object.assign(out, { [field]: value });
  }
  return out;
}

/**
 * The team_activity_logs row of one autonomy-profile write: the writer, their
 * tier, the profile the write replaced (`before`, which the compare-and-set
 * guarantees is the stored row), the profile it left (`after`), and the
 * settings that changed and that loosened.
 */
function autonomyProfileAuditRow(decision: AutonomyProfileWriteDecision, row: StoredAutonomyProfile) {
  const after = autonomySettingsOf(row);
  const changed = AUTONOMY_PROFILE_FIELDS.filter((field) => decision.before[field] !== after[field]);
  const title = changed.length === 0
    ? 'Saved the KEY autonomy profile (no setting changed)'
    : `Changed the KEY autonomy profile: ${changed
      .map((field) => `${field} ${auditValue(field, decision.before[field])} -> ${auditValue(field, after[field])}`)
      .join(', ')}`;
  return {
    businessId: decision.businessId,
    userId: decision.actorId,
    module: 'settings',
    action: 'key_autonomy_profile_updated',
    entityType: 'businessAutonomyProfile',
    entityId: row.id,
    title,
    meta: {
      before: { ...decision.before },
      after: { ...after },
      changed: [...changed],
      loosened: [...decision.loosened],
      actorTier: decision.actorTier,
    },
  };
}

/**
 * The write the PATCH handler makes for one admitted request, bound by
 * AutonomyProfileAuditInterceptor.
 */
type AutonomyProfileWrite = (businessId: string, dto: UpdateAutonomyProfileDto) => Promise<StoredAutonomyProfile>;

/**
 * Carries the bound write from AutonomyProfileAuditInterceptor to the handler
 * for the length of one request. The handler's parameters stay (dto,
 * businessId), the types key-cortex-tenant-binding.spec.ts pins against tsc's
 * output, so the request's decision reaches it this way and not as a parameter.
 */
const autonomyProfileWriteScope = new AsyncLocalStorage<AutonomyProfileWrite>();

/**
 * V1-03 review ST-2, SEC-V103-1..3: every autonomy-profile write is a
 * compare-and-set on the profile AutonomyProfileWriteGuard judged, committed
 * in one transaction with the audit row naming its writer.
 *
 * Neither the handler nor KeyAutonomySafetyService.updateProfile wrote an
 * audit row, and the global BusinessEventInterceptor takes the tenant only
 * from params or body, so a write naming the tenant in the query string (which
 * BusinessGuard and the handler accept) left no trace. The first repair wrote
 * the row after the handler answered, which left three gaps the review ran:
 *
 *   - SEC-V103-1: the handler wrote every DTO field over whatever was stored,
 *     though the guard judged the write against a profile it had read
 *     earlier. A field resubmitted with its stored value counts as no change,
 *     so a tier-3 ADMIN's stale `{maxTierWithoutApproval: 4}` was admitted
 *     and then overwrote the same ADMIN's concurrent release of the kill
 *     switch with the ceiling lowered to 3: the kill switch ended OFF under a
 *     ceiling of 4, a state the guard refuses to any single request from that ADMIN.
 *   - SEC-V103-2: the audit row recorded the guard's snapshot as `before`, not
 *     the row the write replaced, so that ceiling going from 3 back to 4 was
 *     in no audit row.
 *   - SEC-V103-3: the profile change committed before the audit row was
 *     inserted, so a failed insert answered 500 over a change that stayed.
 *
 * Now the interceptor binds, for the request the guard admitted, a write the
 * handler runs (autonomyProfileWriteScope). It writes only the settings that
 * differ from the judged profile (changedAutonomySettings), with an UPDATE
 * whose WHERE is that whole profile, so it lands only while the stored row
 * still equals it; 0 rows is 409 and nothing is written. In the same
 * transaction it reads the row it left and inserts the audit row
 * (autonomyProfileAuditRow): `before` is the row the write replaced and
 * `after` the row it left. When the insert fails the transaction rolls back,
 * so the request answers 500 and the profile is unchanged.
 *
 * A request with no guard decision never reaches the handler (500), and a
 * handler that answers without running the bound write is answered 500, so no
 * success is ever answered for an unaudited change. A refused write never
 * reaches the handler, so it writes no row.
 */
@Injectable()
export class AutonomyProfileAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AutonomyProfileAuditInterceptor.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AutonomyProfileWriteRequest>();
    const decision = req?.autonomyProfileWrite;
    if (!decision) {
      this.logger.error('An autonomy-profile write reached the handler without a guard decision; refusing it');
      return throwError(() => new InternalServerErrorException('The KEY autonomy profile change could not be audited'));
    }
    let written = false;
    const write: AutonomyProfileWrite = async (businessId, dto) => {
      const profile = await this.write(decision, businessId, dto);
      written = true;
      return profile;
    };
    // Subscribed inside the scope, so the handler (which Nest calls on subscription) runs in it.
    return new Observable<unknown>((subscriber) =>
      autonomyProfileWriteScope.run(write, () => next.handle().subscribe(subscriber)),
    ).pipe(
      map((profile) => {
        if (!written) {
          this.logger.error(`An autonomy-profile write for ${decision.businessId} answered without its audited write; refusing to answer success`);
          throw new InternalServerErrorException('The KEY autonomy profile change could not be audited');
        }
        return profile;
      }),
    );
  }

  /** The compare-and-set write and its audit row, in one transaction. */
  private async write(
    decision: AutonomyProfileWriteDecision,
    businessId: string,
    dto: UpdateAutonomyProfileDto,
  ): Promise<StoredAutonomyProfile> {
    if (businessId !== decision.businessId) {
      throw new ForbiddenException('businessId does not match the business this request was authorized for');
    }
    const changes = changedAutonomySettings(decision.before, requestedAutonomySettings(dto));
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        // updatedAt is set explicitly so a save that changes nothing still runs
        // the UPDATE (Prisma skips one with no data) and is checked like any other.
        const { count } = await tx.businessAutonomyProfile.updateMany({
          where: { businessId, ...decision.before },
          data: { ...changes, updatedAt: new Date() },
        });
        if (count !== 1) {
          throw new ConflictException('The KEY autonomy profile changed while this request was being checked; reload it and try again');
        }
        const row = await tx.businessAutonomyProfile.findUniqueOrThrow({ where: { businessId } });
        await tx.teamActivityLog.create({ data: autonomyProfileAuditRow(decision, row) });
        return row;
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `Failed to write the KEY autonomy profile change for ${businessId} by ${decision.actorId} with its audit row: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new InternalServerErrorException('The KEY autonomy profile change could not be written with its audit row; nothing was changed');
    }
  }
}

/* ------------------------------------------------------------------ */
/*  DTOs  (Legacy)                                                     */
/* ------------------------------------------------------------------ */

// The DTOs below that test/key-cortex-actor-binding.integration.test.ts writes as
// handler parameter types (vitest emits none) are exported for that reason only.
// Each optional `userId` is accepted and ignored: the actor is requestActorId().

export class CreateSessionDto {
  @IsString()
  businessId: string;
  @IsOptional()
  @IsString()
  userId?: string;
  @IsOptional()
  @Allow()
  persona?: CortexPersona;
  @IsOptional()
  @Allow()
  voice?: CortexVoice;
  @IsOptional()
  @Allow()
  provider?: CortexProvider;
  @IsOptional()
  @IsString()
  title?: string;
}

class UpdateSessionDto {
  @IsOptional()
  @Allow()
  persona?: CortexPersona;
  @IsOptional()
  @Allow()
  voice?: CortexVoice;
  @IsOptional()
  @Allow()
  provider?: CortexProvider;
  @IsOptional()
  @Allow()
  mood?: CortexMood;
  @IsOptional()
  @IsString()
  title?: string;
  @IsOptional()
  @Allow()
  status?: CortexSessionStatus;
}

// The query the handler builds carries the authenticated actor as its userId,
// so the body's own userId is optional (and ignored).
export class ChatQueryDto implements Omit<CortexQuery, 'userId'> {
  @IsString()
  text: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsString()
  businessId: string;

  @IsOptional()
  @IsString()
  userId?: string;

  // @Allow() rather than @IsObject()/@IsIn(): these carry union and structured
  // shapes validated downstream. @Allow contributes the metadata that keeps
  // whitelist:true from deleting them, without asserting a shape here that
  // would reject legitimate payloads.
  @IsOptional()
  @Allow()
  persona?: CortexPersona;

  @IsOptional()
  @Allow()
  voice?: CortexVoice;

  @IsOptional()
  @Allow()
  provider?: CortexProvider;

  @IsOptional()
  @Allow()
  mood?: CortexMood;

  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  @IsOptional()
  @IsBoolean()
  enableActions?: boolean;

  @IsOptional()
  @IsBoolean()
  enableVoice?: boolean;

  @IsOptional()
  @IsArray()
  attachments?: Array<{
    type: 'image' | 'document' | 'audio' | 'spreadsheet';
    url: string;
    mimeType: string;
    name: string;
  }>;
}

export class VoiceSpeakDto implements CortexVoiceRequest {
  @IsString()
  text: string;

  @IsOptional()
  @Allow()
  voice?: CortexVoice;

  @IsOptional()
  @IsIn(['mp3', 'opus', 'aac', 'flac', 'wav'])
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav';

  @IsOptional()
  @IsNumber()
  speed?: number;

  @IsOptional()
  @Allow()
  persona?: CortexPersona;

  @IsOptional()
  @IsString()
  instructions?: string;
}

class SwitchPersonalityDto {
  @IsString()
  sessionId: string;
  @Allow()
  persona: CortexPersona;
}

class ApproveActionDto {
  @IsString()
  sessionId: string;
  @IsString()
  businessId: string;
  @IsString()
  actionId: string;
  @IsBoolean()
  approved: boolean;
}

class InsightsQueryDto {
  @IsString()
  businessId: string;
  @IsString()
  query: string;
}

export class FeedbackDto {
  @IsString()
  sessionId: string;
  @IsString()
  businessId: string;
  @IsOptional()
  @IsString()
  userId?: string;
  @IsIn(['accepted', 'rejected', 'modified', 'no_action'])
  userResponse: 'accepted' | 'rejected' | 'modified' | 'no_action';
  @IsOptional()
  @IsString()
  actualOutcome?: string;
  @IsOptional()
  @IsString()
  dismissalReason?: string;
  @IsOptional()
  @IsString()
  recommendationId?: string;
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class ProfitOpportunitiesQueryDto {
  @IsString()
  businessId: string;
  @IsOptional()
  @IsIn(['automation', 'upsell', 'cost_reduction', 'new_revenue', 'retention'])
  category?: 'automation' | 'upsell' | 'cost_reduction' | 'new_revenue' | 'retention';
}

// Exported only so test/key-cortex-tenant-binding.integration.test.ts can write the parameter types tsc emits.
export class UpdateAutonomyProfileDto {
  @IsOptional()
  @IsBoolean()
  globalKillSwitch?: boolean;
  @IsOptional()
  @IsNumber()
  maxDailyAutoActions?: number;
  @IsOptional()
  @IsNumber()
  maxDailySpendTtd?: number;
  @IsOptional()
  @IsNumber()
  maxTierWithoutApproval?: number;
  @IsOptional()
  @IsBoolean()
  notifyOnBlock?: boolean;
}

/* ------------------------------------------------------------------ */
/*  DTOs  (v2 Integration Layer)                                       */
/* ------------------------------------------------------------------ */

/** Command execution -- natural language or structured command */
export class ExecuteCommandDto {
  /** Natural language command (e.g. "Create an invoice for John for $500") */
  @IsString()
  command: string;
  @IsString()
  businessId: string;
  /** Accepted and ignored: the command's actor is the authenticated principal. */
  @IsOptional()
  @IsString()
  userId?: string;
  /** Optional structured override -- bypasses NL parsing */
  @IsOptional()
  @Allow()
  module?: ModuleName;
  @IsOptional()
  @IsString()
  action?: string;
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
  /** Require explicit approval before destructive actions */
  @IsOptional()
  @IsBoolean()
  requireApproval?: boolean;
}

/** Direct module query */
export class QueryModuleDto {
  @Allow()
  module: ModuleName;
  @IsString()
  query: string;
  @IsString()
  businessId: string;
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}

/** Business insights request */
class GenerateInsightsDto {
  @IsString()
  businessId: string;
  /** Specific insight category or question */
  @IsOptional()
  @IsString()
  query?: string;
  /** Limit to specific modules */
  @IsOptional()
  @IsArray()
  modules?: ModuleName[];
}

/** Monitor creation */
class CreateMonitorDto {
  @IsString()
  businessId: string;
  /** Natural language description of what to monitor */
  @IsString()
  description: string;
  /** Module to monitor (e.g. 'commerce', 'crm') */
  @IsOptional()
  @Allow()
  module?: ModuleName;
  /** Specific condition that triggers the monitor */
  @IsOptional()
  @IsString()
  condition?: string;
  /** Notification channels */
  @IsOptional()
  @IsArray()
  notifyChannels?: Array<'email' | 'sms' | 'push' | 'in_app'>;
  /** Run interval in minutes (default: 60) */
  @IsOptional()
  @IsNumber()
  intervalMinutes?: number;
}

/** Monitor update */
class UpdateMonitorDto {
  @IsOptional()
  @IsString()
  description?: string;
  @IsOptional()
  @Allow()
  module?: ModuleName;
  @IsOptional()
  @IsString()
  condition?: string;
  @IsOptional()
  @IsArray()
  notifyChannels?: Array<'email' | 'sms' | 'push' | 'in_app'>;
  @IsOptional()
  @IsNumber()
  intervalMinutes?: number;
}

/** Monitor toggle */
class ToggleMonitorDto {
  @IsBoolean()
  active: boolean;
}

/** Batch execution */
export class ExecuteBatchDto {
  /** Either natural language commands or structured commands */
  @IsArray()
  commands: Array<
    | { type: 'natural'; command: string }
    | {
        type: 'structured';
        module: ModuleName;
        action: string;
        parameters: Record<string, unknown>;
      }
  >;
  @IsString()
  businessId: string;
  /** Accepted and ignored: every command's actor is the authenticated principal. */
  @IsOptional()
  @IsString()
  userId?: string;
  /** Stop execution on first failure */
  @IsOptional()
  @IsBoolean()
  stopOnError?: boolean;
  /** Require approval for destructive actions */
  @IsOptional()
  @IsBoolean()
  requireApproval?: boolean;
}

/** Rollback request */
export class RollbackDto {
  /** The correlationId of the command to roll back */
  @IsString()
  correlationId: string;
  @IsString()
  businessId: string;
  /** Reason for rollback */
  @IsOptional()
  @IsString()
  reason?: string;
}

/* ------------------------------------------------------------------ */
/*  DTOs  (v3 Sandbox)                                                 */
/* ------------------------------------------------------------------ */

class SandboxGenerateDto {
  @IsString()
  description: string;
  @IsOptional()
  @IsIn(['typescript', 'javascript', 'python', 'json', 'sql'])
  language?: 'typescript' | 'javascript' | 'python' | 'json' | 'sql';
  @IsString()
  businessId: string;
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

export class ConsciousChatDto {
  @IsString()
  text: string;

  @IsString()
  businessId: string;

  // Optional: AuthGuard already establishes who the caller is, and the session
  // is created for that principal (R0-09c), never for this field. Requiring it
  // here would 400 every client that does not happen to know its own user id —
  // including this repo's own web hook.
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;
}

class SandboxExecuteDto {
  @IsString()
  code: string;
  @IsOptional()
  @IsIn(['typescript', 'javascript', 'python', 'json', 'sql'])
  language?: 'typescript' | 'javascript' | 'python' | 'json' | 'sql';
  @IsString()
  businessId: string;
  // @IsInt rather than @IsNumber: a timeout in milliseconds is an integer, and
  // this is the stricter of the two sides.
  @IsOptional()
  @IsInt()
  timeoutMs?: number;
  @IsOptional()
  @IsObject()
  inputs?: Record<string, unknown>;
}

class SandboxAutoDto {
  @IsString()
  description: string;
  @IsOptional()
  @IsIn(['typescript', 'javascript', 'python', 'json', 'sql'])
  language?: 'typescript' | 'javascript' | 'python' | 'json' | 'sql';
  @IsString()
  businessId: string;
  @IsOptional()
  @IsBoolean()
  execute?: boolean;
  @IsOptional()
  @IsObject()
  inputs?: Record<string, unknown>;
}

class SandboxApplyDto {
  @IsString()
  templateId: string;
  @IsObject()
  parameters: Record<string, unknown>;
  @IsString()
  businessId: string;
}

class SandboxExplainDto {
  @IsString()
  code: string;
  @IsOptional()
  @IsString()
  language?: string;
  @IsString()
  businessId: string;
  @IsOptional()
  @IsIn(['brief', 'detailed', 'line-by-line'])
  detail?: 'brief' | 'detailed' | 'line-by-line';
}

/* ------------------------------------------------------------------ */
/*  DTOs  (v3 Flow Studio)                                             */
/* ------------------------------------------------------------------ */

class FlowGenerateDto {
  @IsString()
  description: string;
  @IsString()
  businessId: string;
  @IsOptional()
  @IsString()
  trigger?: string;
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

class FlowCreateDto {
  @IsString()
  name: string;
  @IsString()
  businessId: string;
  @IsOptional()
  @IsString()
  description?: string;
  @IsArray()
  nodes: Array<Record<string, unknown>>;
  @IsArray()
  edges: Array<Record<string, unknown>>;
  @IsOptional()
  @IsObject()
  trigger?: Record<string, unknown>;
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class FlowUpdateDto {
  @IsOptional()
  @IsString()
  name?: string;
  @IsOptional()
  @IsString()
  description?: string;
  @IsOptional()
  @IsArray()
  nodes?: Array<Record<string, unknown>>;
  @IsOptional()
  @IsArray()
  edges?: Array<Record<string, unknown>>;
  @IsOptional()
  @IsObject()
  trigger?: Record<string, unknown>;
}

class FlowApplyTemplateDto {
  @IsString()
  templateId: string;
  @IsString()
  name: string;
  @IsString()
  businessId: string;
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  DTOs  (v3 External Connectors)                                     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  DTOs  (v3 Phone Agent)                                             */
/* ------------------------------------------------------------------ */

class PhoneCallDto {
  @IsString()
  phoneNumber: string;
  @IsString()
  businessId: string;
  @IsOptional()
  @IsString()
  script?: string;
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
  @IsOptional()
  @IsBoolean()
  record?: boolean;
}

class PhoneScriptDto {
  @IsString()
  objective: string;
  @IsString()
  businessId: string;
  @IsOptional()
  @IsIn(['professional', 'friendly', 'urgent', 'casual'])
  tone?: 'professional' | 'friendly' | 'urgent' | 'casual';
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

class PhoneAnalyzeDto {
  @IsString()
  transcript: string;
  @IsString()
  businessId: string;
  @IsOptional()
  @IsString()
  objective?: string;
}

/* ------------------------------------------------------------------ */
/*  DTOs  (v3 Document Intelligence)                                   */
/* ------------------------------------------------------------------ */

class DocumentAskDto {
  @IsString()
  question: string;
  @IsString()
  businessId: string;
  @IsOptional()
  @IsArray()
  documentIds?: string[];
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;
}

class DocumentExtractDto {
  @IsString()
  documentId: string;
  @IsString()
  businessId: string;
  @IsObject()
  schema: Record<string, unknown>;
  @IsOptional()
  @IsString()
  prompt?: string;
}

class DocumentCompareDto {
  @IsString()
  documentIdA: string;
  @IsString()
  documentIdB: string;
  @IsString()
  businessId: string;
  @IsOptional()
  @IsArray()
  aspects?: string[];
}

/* ------------------------------------------------------------------ */
/*  DTOs  (v3 Self-Evolution)                                          */
/* ------------------------------------------------------------------ */

class EvolutionTuneDto {
  @IsString()
  businessId: string;
  @IsOptional()
  @IsIn(['global', 'module', 'user'])
  scope?: 'global' | 'module' | 'user';
  @IsOptional()
  @IsString()
  targetModule?: string;
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

class EvolutionExplainDto {
  @IsString()
  decisionId: string;
  @IsString()
  businessId: string;
  @IsOptional()
  @IsIn(['summary', 'full', 'technical'])
  detail?: 'summary' | 'full' | 'technical';
}

/* ------------------------------------------------------------------ */
/*  Controller                                                         */
/* ------------------------------------------------------------------ */

/**
 * Mounted at `/api/v1/cortex` with no `:businessId` path segment, so the tenant
 * is named by the request and BusinessGuard resolves and checks it from params,
 * then body, then query (core/auth/request-business-id.ts).
 *
 * R0-34b-KEY-TENANT-BINDING (R0-07a review ST-1): 36 handlers here read
 * `@Query('businessId')` and conscious/stream read it from a whole `@Query()`,
 * so a member of A sending the JSON body `{businessId: A}` with `?businessId=B`
 * passed the guard for A and the handler acted on B. Every handler that reads
 * the tenant from the request now takes `@GuardedBusinessId()`, the resolver
 * the guard ran (the R0-34 pattern in key-cortex-audit.controller.ts); the two
 * multipart handlers also go through `multipartTenant`. A handler that reads
 * `dto.businessId` from a whole JSON `@Body()` reads the field the guard
 * resolves first on these paths, so a non-empty string there is the tenant the
 * guard checked, but only because its DTO is a class that validates businessId
 * as a string. A `@Body()` typed `Dto & { businessId }` is emitted as `Object`,
 * which the global ValidationPipe skips, so a non-string businessId (which the
 * guard skips) reached the service raw (review ST-2): PATCH autonomy-profile
 * takes its class DTO and @GuardedBusinessId() now.
 *
 * Review ST-1: the session services read the Redis entry
 * `cortex:session:<id>` before the database and check no tenant there (the
 * Prisma tenant extension scopes only the database fallback). Every handler
 * that takes a client session id (messages, chat, chat/stream, stream,
 * conscious/chat, conscious/stream, and since R0-09c review ST-1..ST-4 also
 * GET/PATCH/DELETE sessions/:id, personalities/switch and feedback) goes
 * through `ownSession` first, which also refuses another member's session.
 *
 * R0-09c-KEY-ACTOR-BINDING (R0-09 review R09-ST-4; R0-34b review ST-3): the
 * ACTOR is bound the same way. Every handler that hands a user to a service
 * takes it from @CurrentUser() (the principal AuthGuard admitted) through
 * `requestActorId`, never from a body or query `userId`, which is ignored; with
 * no authenticated user it answers 401 rather than acting as 'system',
 * 'key_user' or nobody.
 */
@Controller('api/v1/cortex')
@UseGuards(AuthGuard, BusinessGuard)
export class KeyCortexController {
  private readonly logger = new Logger(KeyCortexController.name);

  constructor(
    // -- Core (legacy) --
    private readonly reasoning: KeyCortexReasoningService,
    private readonly conversation: KeyCortexConversationService,
    private readonly voice: KeyCortexVoiceService,
    private readonly personality: KeyCortexPersonalityService,
    private readonly actions: KeyCortexActionsService,
    private readonly context: KeyCortexContextService,

    // -- v2 Integration Layer --
    private readonly connector: KeyCortexConnectorService,
    private readonly command: KeyCortexCommandService,
    private readonly executor: KeyCortexExecutorService,
    private readonly contextV2: KeyCortexContextV2Service,
    private readonly insight: KeyCortexInsightService,
    private readonly monitorV2: KeyCortexMonitorV2Service,

    // -- v3 Phase 3 & 4 Services --
    @Inject(KeyCortexSandboxService) private readonly sandbox: any,
    @Inject(KeyCortexFlowStudioService) private readonly flowStudio: any,
    @Inject(KeyCortexEvolutionService) private readonly evolution: any,
    @Inject(KeyCortexPhoneService) private readonly phone: any,
    @Inject(KeyCortexDocumentService) private readonly document: any,

    // -- Phase D: Learning & Metacognition --
    private readonly learning: KeyCortexLearningService,

    // -- Phase 0.6: Unified approval orchestrator / autonomy safety --
    private readonly safety: KeyAutonomySafetyService,
    private readonly approvalOrchestrator: KeyCortexApprovalOrchestratorService,
    private readonly consciousness: KeyCortexConsciousnessService,
    private readonly sessionService: KeyCortexSessionService,
    // Appended, never inserted: specs construct this controller positionally.
    private readonly awareness: KeyCortexAwarenessService,
    // V1-31c: the autonomy authority POST flows/:id/execute asks before a flow
    // runs (a flow's nodes reach the connector without the executor's gate).
    // KeyCortexModule and KeyAutonomyModule import each other (see the executor),
    // hence forwardRef. Optional only so the specs that build this controller for
    // other routes need not provide it: the route refuses (503) when it is absent.
    @Optional() @Inject(forwardRef(() => AutonomyOrchestratorService)) private readonly autonomy?: AutonomyOrchestratorService,
  ) {}

  /* ================================================================== */
  /*  SESSION MANAGEMENT                                                */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/sessions
   * Create a new chat session with optional persona, voice, and provider.
   */
  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @Body() dto: CreateSessionDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<CortexSession> {
    const actorId = requestActorId(user);
    this.logger.debug(`Creating session for business=${dto.businessId}`);

    try {
      const session = await this.conversation.createSession(
        dto.businessId,
        actorId,
        {
          persona: dto.persona ?? 'jarvis',
          voice: dto.voice,
          provider: dto.provider,
          title: dto.title,
        } as any,
      );

      // Build and attach initial context snapshot
      session.contextSnapshot =
        await this.context.buildContextSnapshot(dto.businessId);

      return session;
    } catch (err: any) {
      this.logger.error(`Failed to create session: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to create Cortex session');
    }
  }

  /**
   * GET /api/v1/cortex/sessions
   * List the authenticated user's sessions in the business. A `?userId` naming
   * another member is ignored (R0-09c): it used to list that member's sessions.
   */
  @Get('sessions')
  async listSessions(
    @GuardedBusinessId() businessId: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<CortexSession[]> {
    const actorId = requestActorId(user);
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.conversation.listSessions(businessId, actorId);
    } catch (err: any) {
      this.logger.error(`Failed to list sessions: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list sessions');
    }
  }

  /**
   * GET /api/v1/cortex/sessions/:id
   * Retrieve a single session including its messages: only the authenticated
   * user's own session in the business the guard checked (R0-09c review ST-1,
   * ST-3). Another tenant's session (cached or not) and another member's
   * session are not found, exactly like an unknown id (`ownSession`).
   */
  @Get('sessions/:id')
  async getSession(
    @Param('id') sessionId: string,
    @GuardedBusinessId() businessId?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<CortexSession> {
    const actorId = requestActorId(user);
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }
    const session = await this.ownSession(businessId, actorId, sessionId);
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
    return session;
  }

  /**
   * PATCH /api/v1/cortex/sessions/:id
   * Update session metadata (persona, voice, provider, mood, title, status) of
   * the authenticated user's own session (R0-09c review ST-3, `ownSession`).
   */
  @Patch('sessions/:id')
  async updateSession(
    @Param('id') sessionId: string,
    @Body() dto: UpdateSessionDto,
    @GuardedBusinessId() businessId?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<CortexSession> {
    await this.requireOwnSession(businessId, user, sessionId);
    try {
      return await this.conversation.updateSession(sessionId, dto as any);
    } catch (err: any) {
      this.logger.error(
        `Failed to update session ${sessionId}: ${err.message}`,
        err.stack,
      );
      throw new ServiceUnavailableException('Unable to update session');
    }
  }

  /**
   * DELETE /api/v1/cortex/sessions/:id
   * Delete (archive) the authenticated user's own session (R0-09c review ST-3,
   * `ownSession`).
   */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSession(
    @Param('id') sessionId: string,
    @GuardedBusinessId() businessId?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<void> {
    await this.requireOwnSession(businessId, user, sessionId);
    try {
      await this.conversation.deleteSession(sessionId);
    } catch (err: any) {
      this.logger.error(
        `Failed to delete session ${sessionId}: ${err.message}`,
        err.stack,
      );
      throw new ServiceUnavailableException('Unable to delete session');
    }
  }

  /* ================================================================== */
  /*  CHAT                                                              */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/chat
   * Non-streaming chat -- returns a complete CortexResponse.
   */
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async chat(
    @Body() query: ChatQueryDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<CortexResponse> {
    const actorId = requestActorId(user);
    if (!query.text?.trim()) {
      throw new BadRequestException('Query text is required');
    }
    if (!query.businessId) {
      throw new BadRequestException('businessId is required');
    }
    const sessionId = await this.ownSessionId(query.businessId, actorId, query.sessionId);

    try {
      // The actor overrides any body userId (R0-09c).
      const response = await this.reasoning.processQuery({ ...query, userId: actorId, sessionId } as any);
      return response;
    } catch (err: any) {
      this.logger.error(`Chat error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Cortex reasoning engine unavailable');
    }
  }

  /**
   * GET /api/v1/cortex/chat/stream
   * SSE streaming chat -- returns a reactive stream of CortexStreamChunks.
   *
   * This route was previously documented and written as a POST taking @Body().
   * It could never have worked: Nest's @Sse registers RequestMethod.GET (see
   * @nestjs/common/decorators/http/sse.decorator.js), so a POST 404'd, and a GET
   * carries no body, so @Body() arrived empty and the guard clause below threw
   * 400 on every request. It was dead in both directions.
   *
   * Parameters therefore come from the query string, matching the sibling
   * `stream` and `conscious/stream` routes. Only the scalar fields are accepted:
   * the object-valued fields on ChatQueryDto (persona, attachments) have no
   * sensible query-string encoding, and callers needing those should use the
   * non-streaming POST /chat.
   *
   * A session id naming another tenant's session is refused before the stream
   * starts (review ST-1, `ownSessionId`), and so is another member's
   * (R0-09c review ST-2). The query streams for the authenticated user; a
   * `?userId` is ignored (R0-09c).
   */
  @Sse('chat/stream')
  async streamChat(
    @GuardedBusinessId() businessId: string,
    @Query('text') text: string,
    @CurrentUser() user?: AuthenticatedUser,
    @Query('sessionId') requestedSessionId?: string,
  ): Promise<Observable<CortexStreamChunk>> {
    const userId = requestActorId(user);
    if (!text?.trim()) {
      throw new BadRequestException('text query parameter is required');
    }
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }
    const sessionId = await this.ownSessionId(businessId, userId, requestedSessionId);

    const subject = new Subject<CortexStreamChunk>();

    // Run the async generator in a background micro-task so the
    // SSE connection is established immediately.
    void (async () => {
      try {
        const stream = this.reasoning.streamQuery({
          text,
          businessId,
          userId,
          sessionId,
        } as unknown as CortexQuery);
        for await (const chunk of stream) {
          subject.next(chunk);
        }
        subject.complete();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        this.logger.error(`Stream error: ${message}`);
        subject.error(err);
      }
    })();

    return subject.asObservable();
  }

  /**
   * GET /api/v1/cortex/messages
   * Retrieve recent messages of one of the authenticated user's own sessions.
   * If no sessionId is provided, the user's most recent session in the
   * business is used (R0-09c review ST-3: it was the business's most recent
   * session, whoever owned it).
   */
  @Get('messages')
  async getMessages(
    @GuardedBusinessId() businessId: string,
    @Query('sessionId') sessionId?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ messages: Array<{
    id: string;
    sender: 'user' | 'key' | 'system';
    content: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
  }> }> {
    const actorId = requestActorId(user);
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    let session: CortexSession | null;
    if (sessionId) {
      // Review ST-1: getSession reads the session cache before the tenant-scoped
      // database, so another tenant's cached session came back here; another
      // member's session is refused the same way (R0-09c review ST-3).
      session = await this.ownSession(businessId, actorId, sessionId);
    } else {
      const sessions = await this.conversation.listSessions(businessId, actorId);
      session = sessions[0] ?? null;
    }

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const rawMessages = (session.messages ?? []).slice(-parsedLimit);

    const messages = rawMessages.map((msg) => ({
      id: msg.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      sender: msg.role === 'assistant' ? 'key' : (msg.role as 'user' | 'key' | 'system'),
      content: msg.content ?? '',
      timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString(),
      metadata: (msg.metadata ?? {}) as Record<string, unknown>,
    }));

    return { messages };
  }

  /**
   * GET /api/v1/cortex/stream
   * General SSE event stream for live Cortex updates.
   * When a `message` query param is supplied, streams the reasoning response
   * for the authenticated user (a `?userId` is ignored and there is no
   * 'key_user' default, R0-09c); otherwise sends a periodic heartbeat.
   */
  @Sse('stream')
  streamEvents(
    @GuardedBusinessId() businessId: string,
    @Query('message') message?: string,
    @CurrentUser() user?: AuthenticatedUser,
    @Query('sessionId') sessionId?: string,
    @Query('persona') persona?: string,
  ): Observable<{ data: Record<string, unknown> }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    if (!message) {
      return interval(15000).pipe(
        map((tick) => ({
          data: {
            type: 'heartbeat',
            businessId,
            tick,
            timestamp: new Date().toISOString(),
          },
        })),
      );
    }

    const userId = requestActorId(user);
    const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const query: CortexQuery = {
      businessId,
      userId,
      text: message,
      sessionId,
      persona: persona as any,
      enableActions: true,
    };

    // Review ST-1: a session id naming another tenant's session ends the stream
    // with an error event before the reasoning engine runs, and so does another
    // member's (`ownSessionId`).
    const chunks = defer(() => this.ownSessionId(businessId, userId, sessionId)).pipe(
      switchMap((checkedSessionId) => from(this.reasoning.streamQuery({ ...query, sessionId: checkedSessionId }))),
    );

    return chunks.pipe(
      map((chunk) => ({ data: this.mapStreamChunk(chunk, messageId) })),
      catchError((err: Error) =>
        of({
          data: {
            type: 'error',
            messageId,
            content: err.message || 'Stream failed',
          },
        }),
      ),
      concatWith(of({ data: { type: 'complete', messageId } })),
    );
  }

  private mapStreamChunk(
    chunk: CortexStreamChunk,
    messageId: string,
  ): Record<string, unknown> {
    switch (chunk.type) {
      case 'text_delta':
        return { type: 'chunk', messageId, content: chunk.content ?? '' };
      case 'thought':
        return { type: 'status', messageId, status: 'thinking' };
      case 'tool_call':
      case 'action_delta':
        return { type: 'status', messageId, status: 'executing' };
      case 'error':
        return { type: 'error', messageId, content: chunk.error ?? 'Stream error' };
      case 'done':
        return { type: 'complete', messageId };
      default:
        return { type: 'heartbeat', messageId };
    }
  }

  /* ================================================================== */
  /*  AUTONOMY PROFILE                                                  */
  /* ================================================================== */

  /**
   * GET /api/v1/cortex/autonomy-profile
   */
  @Get('autonomy-profile')
  async getAutonomyProfile(@GuardedBusinessId() businessId: string) {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }
    return this.safety.ensureProfile(businessId);
  }

  /**
   * PATCH /api/v1/cortex/autonomy-profile
   *
   * Review ST-2: the body was typed `UpdateAutonomyProfileDto & { businessId }`,
   * which tsc emits as `Object`, so the ValidationPipe never validated it and a
   * non-string `businessId` reached the service raw. The body is the class DTO
   * now (the pipe validates the fields and strips `businessId`, which the guard
   * read from the raw body first), and the tenant is the one the guard checked.
   *
   * V1-03 (CF-28): only an OWNER or ADMIN of that tenant (or its owner of
   * record, or SUPER_ADMIN) may write it, and a write that loosens any setting
   * needs the caller's own approval tier to reach the tier ceiling the profile
   * keeps (AutonomyProfileWriteGuard). The write is a compare-and-set on the
   * profile the guard judged, committed with a team activity row naming its
   * writer (AutonomyProfileAuditInterceptor binds it for the request; review
   * ST-2, SEC-V103-1..3). Any member still reads it (GET).
   *
   * Called directly, outside a request (the unit specs), no write is bound and
   * no guard ran either: the service's own write stands, as it did before V1-03.
   */
  @Patch('autonomy-profile')
  @UseGuards(AutonomyProfileWriteGuard)
  @UseInterceptors(AutonomyProfileAuditInterceptor)
  async updateAutonomyProfile(
    @Body() dto: UpdateAutonomyProfileDto,
    @GuardedBusinessId() businessId: string,
  ) {
    if (!businessId) {
      throw new BadRequestException('businessId is required');
    }
    const write = autonomyProfileWriteScope.getStore();
    return write ? write(businessId, dto) : this.safety.updateProfile(businessId, dto);
  }

  /* ================================================================== */
  /*  FEEDBACK & LEARNING                                               */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/feedback
   * Record user feedback on a recommendation so KEY can learn. The feedback is
   * the authenticated user's; a body `userId` is ignored (R0-09c).
   */
  @Post('feedback')
  @HttpCode(HttpStatus.OK)
  async recordFeedback(
    @Body() dto: FeedbackDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ success: boolean }> {
    const actorId = requestActorId(user);
    if (!dto.sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.userResponse) {
      throw new BadRequestException('userResponse is required');
    }
    // R0-09c review ST-4: recordFeedback rewrites the newest cognition memory of
    // the session in place (its userResponse and lessons) and attributes nothing
    // to the caller there, so feedback on another member's session (or another
    // tenant's) is refused as not found. An id that names no session still
    // records a new row for the caller, as before.
    await this.ownSession(dto.businessId, actorId, dto.sessionId);

    await this.learning.recordFeedback({ ...dto, userId: actorId });
    return { success: true };
  }

  /* ================================================================== */
  /*  VOICE                                                             */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/voice/speak
   * Text-to-Speech -- synthesises audio and returns it as a binary buffer.
   */
  @Post('voice/speak')
  @HttpCode(HttpStatus.OK)
  async speak(
    @Body() dto: VoiceSpeakDto,
    @GuardedBusinessId() businessId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Buffer> {
    if (!dto.text?.trim()) {
      throw new BadRequestException('Text is required for TTS');
    }
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const audioBuffer = await this.voice.synthesize(dto, businessId);

      const contentTypeMap: Record<string, string> = {
        mp3: 'audio/mpeg',
        opus: 'audio/opus',
        aac: 'audio/aac',
        flac: 'audio/flac',
        wav: 'audio/wav',
      };

      const format = dto.format ?? 'mp3';
      res.setHeader('Content-Type', contentTypeMap[format] ?? 'audio/mpeg');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="cortex-speak.${format}"`,
      );

      return audioBuffer;
    } catch (err: any) {
      // The structured 503 (provider_not_configured / provider_unavailable) keeps its code.
      if (isAiProviderUnavailable(err)) throw err;
      this.logger.error(`TTS error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Voice synthesis unavailable');
    }
  }

  /**
   * POST /api/v1/cortex/voice/listen
   * Speech-to-Text -- accepts a multipart audio upload and returns transcript.
   * The tenant is the one BusinessGuard checked (path and query; see
   * multipartTenant), never a multipart field.
   */
  @Post('voice/listen')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('audio'))
  async listen(
    @UploadedFile() audioFile: Express.Multer.File,
    @GuardedBusinessId() resolvedBusinessId: string,
    @Query('language') language?: string,
    @Query('prompt') prompt?: string,
    @Req() req?: BusinessGuardedRequest,
  ): Promise<{ transcript: string; confidence?: number }> {
    if (!audioFile) {
      throw new BadRequestException('Audio file is required (field name: audio)');
    }
    const businessId = multipartTenant(resolvedBusinessId, req);
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const sttRequest: CortexSTTRequest = {
        audioBuffer: audioFile.buffer,
        mimeType: audioFile.mimetype,
        language,
        prompt,
      };

      const transcript = await this.voice.transcribe(sttRequest, businessId);

      return { transcript };
    } catch (err: any) {
      // The structured 503 (provider_not_configured / provider_unavailable) keeps its code.
      if (isAiProviderUnavailable(err)) throw err;
      this.logger.error(`STT error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Speech transcription unavailable');
    }
  }

  /**
   * GET /api/v1/cortex/voice/voices
   * List all available TTS voices with descriptions.
   */
  @Get('voice/voices')
  async listVoices(): Promise<
    Array<{ id: CortexVoice; name: string; description: string; sampleUrl?: string }>
  > {
    try {
      return await this.voice.getAvailableVoices();
    } catch (err: any) {
      this.logger.error(`List voices error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve voice list');
    }
  }

  /* ================================================================== */
  /*  PERSONALITY                                                       */
  /* ================================================================== */

  /**
   * GET /api/v1/cortex/personalities
   * List all available personalities with their full configurations.
   */
  @Get('personalities')
  async listPersonalities(): Promise<{
    personalities: CortexPersonalityConfig[];
  }> {
    const allPersonas: CortexPersona[] = [
      'jarvis',
      'friday',
      'jarvis_dark',
      'nova',
      'titan',
      'ghost',
      'mentor',
      'hustler',
    ];

    const personalities = allPersonas.map((persona) =>
      this.personality.getPersonalityConfig(persona),
    );

    return { personalities };
  }

  /**
   * POST /api/v1/cortex/personalities/switch
   * Switch personality mid-session, on the authenticated user's own session in
   * the business the guard checked (R0-09c review ST-1: this handler takes a
   * client session id too, and answered with that session, messages included,
   * whichever tenant or member it belonged to).
   */
  @Post('personalities/switch')
  @HttpCode(HttpStatus.OK)
  async switchPersonality(
    @Body() dto: SwitchPersonalityDto,
    @GuardedBusinessId() businessId?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<CortexSession> {
    const actorId = requestActorId(user);
    if (!dto.sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    if (!dto.persona) {
      throw new BadRequestException('persona is required');
    }
    if (!businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      const session = await this.ownSession(businessId, actorId, dto.sessionId);
      if (!session) {
        throw new NotFoundException(`Session ${dto.sessionId} not found`);
      }

      const updatedSession = await this.personality.switchPersona(
        session,
        dto.persona,
      );

      return updatedSession;
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(
        `Personality switch error: ${err.message}`,
        err.stack,
      );
      throw new ServiceUnavailableException('Unable to switch personality');
    }
  }

  /* ================================================================== */
  /*  ACTIONS                                                           */
  /* ================================================================== */

  /**
   * GET /api/v1/cortex/actions/tools
   * List all available tools/actions the Cortex can execute.
   */
  @Get('actions/tools')
  async listTools(
    @GuardedBusinessId() businessId: string,
  ): Promise<{
    tools: Array<{ name: string; description: string; params: object }>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const tools = await this.actions.getAvailableTools(businessId);
      return { tools };
    } catch (err: any) {
      this.logger.error(`List tools error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list available tools');
    }
  }

  /**
   * POST /api/v1/cortex/actions/approve
   * Approve (or reject) a pending action that requires user confirmation.
   *
   * Phase 0.6: This endpoint now delegates to the unified approval orchestrator
   * using `dto.actionId` as the canonical KeyActionProposal id. The response
   * `result` field now contains a KeyActionProposalData shape instead of the
   * legacy CortexActionResult.
   */
  @Post('actions/approve')
  @HttpCode(HttpStatus.OK)
  async approveAction(
    @Body() dto: ApproveActionDto,
    @Req() req: { user?: { id?: string } },
  ): Promise<{ result: CortexActionResult }> {
    if (!dto.sessionId) {
      throw new BadRequestException('sessionId is required');
    }
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.actionId) {
      throw new BadRequestException('actionId is required');
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException('Authenticated user required');
    }

    try {
      const proposal = dto.approved
        ? await this.approvalOrchestrator.approve({
            proposalId: dto.actionId,
            businessId: dto.businessId,
            userId,
            autoExecute: false,
          })
        : await this.approvalOrchestrator.reject({
            proposalId: dto.actionId,
            businessId: dto.businessId,
            userId,
          });

      return { result: proposal as unknown as CortexActionResult };
    } catch (err: any) {
      this.logger.error(`Action approval error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to process action approval');
    }
  }

  /* ================================================================== */
  /*  v2 -- COMMAND EXECUTION  (KEY Integration Layer)                   */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/execute
   * Parse natural language intent and execute via the connector.
   *
   * R0-09c (review R09-ST-4): the command is the authenticated user's. It was
   * built with `userId: dto.userId ?? 'system'`, so a STAFF member attributed
   * it to the OWNER, or to nobody; a body `userId` is now ignored, and with no
   * authenticated user the request is 401 before anything is parsed or run.
   *
   * V1-31c: a member-initiated direct command. The command, structured or
   * parsed from the member's words, runs only when the member may run it as a
   * direct command (cortexCommandRefusal: the action's own module write scope,
   * deny by default); a refusal is 403 with an audit row naming the member.
   * The executor then runs its autonomy gate and audits the run.
   */
  @Post('execute')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CortexMemberAuthorityGuard)
  async executeCommand(
    @Body() dto: ExecuteCommandDto,
    @CurrentUser() user?: AuthenticatedUser,
    @CortexMember() member?: CortexMemberAuthority,
  ): Promise<ConnectorResult & { intent?: string; confidence?: number }> {
    const actorId = requestActorId(user);
    if (!dto.command?.trim() && !dto.module) {
      throw new BadRequestException('command (natural language) or module+action is required');
    }
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      // If a structured command is provided, execute directly
      if (dto.module && dto.action) {
        const connectorCommand: ConnectorCommand = {
          module: dto.module,
          action: dto.action,
          parameters: dto.parameters ?? {},
          businessId: dto.businessId,
          userId: actorId,
          source: 'key_cortex',
          timestamp: new Date(),
          correlationId: this.generateCorrelationId(),
        };

        await this.assertDirectCommands(member, [connectorCommand]);
        const result = await this.executor.execute(connectorCommand, {
          skipApproval: !(dto.requireApproval ?? false),
        });
        return result as any;
      }

      // Otherwise, parse natural language into structured commands
      const capabilities = this.connector.getAllCapabilities();
      const context = await this.contextV2.getFullContext(dto.businessId);

      const parsedIntents = await this.command.parseIntent(dto.command, {
        businessId: dto.businessId,
        userId: actorId,
        capabilities,
        context,
      } as any);

      if (!parsedIntents || parsedIntents.length === 0) {
        throw new BadRequestException(
          'Unable to parse command. Try rephrasing or use structured execution.',
        );
      }

      const topIntent = parsedIntents[0];
      const connectorCommand = this.command.toConnectorCommand(
        topIntent,
        dto.businessId,
        actorId,
      );

      await this.assertDirectCommands(member, [connectorCommand]);
      const result = await this.executor.execute(connectorCommand, {
        skipApproval: !(dto.requireApproval ?? topIntent.requiresApproval),
      });

      return {
        ...result,
        intent: topIntent.intent,
        confidence: topIntent.confidence,
      } as any;
    } catch (err: any) {
      if (err instanceof BadRequestException || err instanceof ForbiddenException) throw err;
      this.logger.error(`Execute error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Command execution failed');
    }
  }

  /**
   * POST /api/v1/cortex/query
   * Direct module query -- no NL parsing, hits the module directly.
   *
   * R0-09c: the connector routes `query` to the module adapter as a command
   * like any other (settings.update_business_profile included), and this
   * handler named no actor at all. It names the authenticated user now.
   *
   * V1-31c review SEC-V131c-2: connector.query runs ANY name as a command
   * (connector.execute), so every command POST execute refuses ran here with
   * no scope check, no autonomy gate, no blocked-action check and no audit
   * row. The route is bounded now (cortexQueryRefusal, deny by default): it
   * runs a query the KEY capability registry lists for the module, under the
   * module's scope at read; settings, whose adapter applies the actor's own
   * authority, runs through the executor exactly as POST execute runs it
   * (autonomy gate, blocked actions, audit row); anything else is 403 with an
   * ai_execution_logs row naming the member.
   */
  @Post('query')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CortexMemberAuthorityGuard)
  async queryModule(
    @Body() dto: QueryModuleDto,
    @CurrentUser() user?: AuthenticatedUser,
    @CortexMember() member?: CortexMemberAuthority,
  ): Promise<ConnectorResult> {
    const actorId = requestActorId(user);
    if (!dto.module) {
      throw new BadRequestException('module is required');
    }
    if (!dto.query) {
      throw new BadRequestException('query is required');
    }
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }

    const command: ConnectorCommand = {
      module: dto.module,
      action: dto.query,
      parameters: dto.parameters ?? {},
      businessId: dto.businessId,
      userId: actorId,
      source: 'key_cortex',
      timestamp: new Date(),
      correlationId: this.generateCorrelationId(),
    };
    // `member` is always there over HTTP (see assertDirectCommands).
    if (member) {
      const refusal = command.businessId !== member.businessId
        ? 'businessId does not match the business this request was authorized for'
        : cortexQueryRefusal(member, command.module, command.action);
      if (refusal) {
        await this.auditDirectCommand(command, { success: false, error: refusal });
        throw new ForbiddenException(refusal);
      }
    }

    try {
      if (cortexModuleAdapterEnforced(command.module)) {
        // A query reports, it does not compensate: no rollback of a refused command.
        const record = await this.executor.execute(command, { skipApproval: true, rollbackOnFailure: false });
        return record.result;
      }
      const result = await this.connector.query(
        command.module,
        command.action,
        command.parameters,
        command.businessId,
        actorId,
      );
      return result;
    } catch (err: any) {
      this.logger.error(`Query error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException(`Module query failed: ${err.message}`);
    }
  }

  /**
   * GET /api/v1/cortex/capabilities
   * Return all available module capabilities.
   */
  @Get('capabilities')
  @HttpCode(HttpStatus.OK)
  async getCapabilities(
    @Query('modules') modules?: string,
  ): Promise<{
    capabilities: ReturnType<KeyCortexConnectorService['getAllCapabilities']>;
    formatted: string;
  }> {
    try {
      const moduleList = modules
        ? (modules.split(',') as ModuleName[])
        : undefined;

      const capabilities = moduleList
        ? this.connector.getCapabilities(moduleList)
        : this.connector.getAllCapabilities();

      const formatted = this.connector.formatCapabilitiesForPrompt();

      return { capabilities, formatted };
    } catch (err: any) {
      this.logger.error(`Capabilities error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve capabilities');
    }
  }

  /**
   * GET /api/v1/cortex/context
   * Return full business context assembled from all modules.
   */
  @Get('context')
  @HttpCode(HttpStatus.OK)
  async getContext(
    @GuardedBusinessId() businessId: string,
  ): Promise<{
    context: Record<string, unknown>;
    formatted: string;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const context = await this.contextV2.getFullContext(businessId);
      const formatted = this.contextV2.formatContextForPrompt(context);

      return { context: context as any, formatted };
    } catch (err: any) {
      this.logger.error(`Context error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to assemble business context');
    }
  }

  /* ================================================================== */
  /*  v2 -- INSIGHTS                                                     */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/insights
   * Generate business insights using the v2 insight engine.
   */
  @Post('insights')
  @HttpCode(HttpStatus.OK)
  async generateInsights(
    @Body() dto: GenerateInsightsDto,
  ): Promise<{
    insights: CortexInsight[];
    generatedAt: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      // Use v2 insight service for richer, cross-module insights
      const insights = await (this.insight as any).generateInsights(
        dto.businessId,
        dto.query ?? '',
        dto.modules,
      );

      return {
        insights: insights as any,
        generatedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      this.logger.error(`Insights v2 error: ${err.message}`, err.stack);
      // Fallback to legacy reasoning service
      try {
        const legacyInsights = await this.reasoning.generateInsights(
          dto.businessId,
          dto.query ?? '',
        );
        return { insights: legacyInsights, generatedAt: new Date().toISOString() };
      } catch {
        throw new ServiceUnavailableException('Unable to generate insights');
      }
    }
  }

  /**
   * GET /api/v1/cortex/insights/profit
   * Profit opportunities across all modules.
   */
  @Get('insights/profit')
  @HttpCode(HttpStatus.OK)
  async getProfitOpportunities(
    @GuardedBusinessId() businessId: string,
  ): Promise<{
    opportunities: CortexProfitOpportunity[];
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const opportunities = await this.insight.findProfitOpportunities(businessId);
      return { opportunities: opportunities as any };
    } catch (err: any) {
      this.logger.error(`Profit opportunities error: ${err.message}`, err.stack);
      // Fallback to legacy
      try {
        const opportunities = await this.reasoning.findProfitOpportunities(businessId);
        return { opportunities: opportunities as any };
      } catch {
        throw new ServiceUnavailableException('Unable to find profit opportunities');
      }
    }
  }

  /**
   * GET /api/v1/cortex/insights/revenue
   * Revenue analysis for a given period.
   */
  @Get('insights/revenue')
  @HttpCode(HttpStatus.OK)
  async analyzeRevenue(
    @GuardedBusinessId() businessId: string,
    @Query('period') period?: string,
  ): Promise<{
    analysis: Record<string, unknown>;
    period: string;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const analysis = await this.insight.analyzeRevenue(
        businessId,
        period ?? 'last_30_days',
      );
      return { analysis: analysis as any, period: period ?? 'last_30_days' };
    } catch (err: any) {
      this.logger.error(`Revenue analysis error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to analyze revenue');
    }
  }

  /**
   * GET /api/v1/cortex/insights/churn
   * Churn risk analysis from CRM and engagement data.
   */
  @Get('insights/churn')
  @HttpCode(HttpStatus.OK)
  async analyzeChurnRisk(
    @GuardedBusinessId() businessId: string,
  ): Promise<{
    risks: Array<Record<string, unknown>>;
    summary: Record<string, unknown>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const risks = await this.insight.analyzeChurnRisk(businessId);
      return { risks: risks as any, summary: { totalAtRisk: risks.length } };
    } catch (err: any) {
      this.logger.error(`Churn analysis error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to analyze churn risk');
    }
  }

  /**
   * GET /api/v1/cortex/insights/pipeline
   * Sales pipeline analysis.
   */
  @Get('insights/pipeline')
  @HttpCode(HttpStatus.OK)
  async analyzePipeline(
    @GuardedBusinessId() businessId: string,
  ): Promise<{
    pipeline: Record<string, unknown>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const pipeline = await this.insight.analyzePipeline(businessId);
      return { pipeline: pipeline as any };
    } catch (err: any) {
      this.logger.error(`Pipeline analysis error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to analyze pipeline');
    }
  }

  /* ================================================================== */
  /*  v2 -- MONITORS                                                     */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/monitors
   * Create an autonomous monitor.
   */
  @Post('monitors')
  @HttpCode(HttpStatus.CREATED)
  async createMonitor(
    @Body() dto: CreateMonitorDto,
  ): Promise<Record<string, unknown>> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.description?.trim()) {
      throw new BadRequestException('description is required');
    }

    try {
      const monitor = await this.monitorV2.createMonitor(
        dto.businessId,
        dto.description,
        {
          module: dto.module,
          condition: dto.condition,
          notifyChannels: dto.notifyChannels,
          intervalMinutes: dto.intervalMinutes ?? 60,
        } as any,
      );
      return monitor as any;
    } catch (err: any) {
      this.logger.error(`Create monitor error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to create monitor');
    }
  }

  /**
   * GET /api/v1/cortex/monitors
   * List all monitors for a business.
   */
  @Get('monitors')
  @HttpCode(HttpStatus.OK)
  async getMonitors(
    @GuardedBusinessId() businessId: string,
  ): Promise<{
    monitors: Array<Record<string, unknown>>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const monitors = await this.monitorV2.getActiveMonitors(businessId);
      return { monitors: monitors as any };
    } catch (err: any) {
      this.logger.error(`List monitors error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list monitors');
    }
  }

  /**
   * PATCH /api/v1/cortex/monitors/:id
   * Update an existing monitor.
   */
  @Patch('monitors/:id')
  @HttpCode(HttpStatus.OK)
  async updateMonitor(
    @Param('id') monitorId: string,
    @Body() dto: UpdateMonitorDto,
    @GuardedBusinessId() businessId?: string,
  ): Promise<Record<string, unknown>> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const monitor = await this.monitorV2.updateMonitor(
        businessId,
        monitorId,
        dto,
      );
      return monitor as any;
    } catch (err: any) {
      this.logger.error(`Update monitor error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to update monitor');
    }
  }

  /**
   * POST /api/v1/cortex/monitors/:id/toggle
   * Enable or disable a monitor.
   */
  @Post('monitors/:id/toggle')
  @HttpCode(HttpStatus.OK)
  async toggleMonitor(
    @Param('id') monitorId: string,
    @Body() dto: ToggleMonitorDto,
    @GuardedBusinessId() businessId?: string,
  ): Promise<{ monitorId: string; active: boolean }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      await this.monitorV2.setMonitorActive(
        businessId,
        monitorId,
        dto.active,
      );
      return { monitorId, active: dto.active };
    } catch (err: any) {
      this.logger.error(`Toggle monitor error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to toggle monitor');
    }
  }

  /* ================================================================== */
  /*  v2 -- ALERTS                                                       */
  /* ================================================================== */

  /**
   * GET /api/v1/cortex/alerts
   * Recent alerts across all monitors.
   */
  @Get('alerts')
  @HttpCode(HttpStatus.OK)
  async getAlerts(
    @GuardedBusinessId() businessId: string,
    @Query('limit') limit?: number,
  ): Promise<{
    alerts: Array<Record<string, unknown>>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const alerts = await this.monitorV2.getRecentAlerts(
        businessId,
        limit ? Number(limit) : 20,
      );
      return { alerts: alerts as any };
    } catch (err: any) {
      this.logger.error(`Alerts error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve alerts');
    }
  }

  /* ================================================================== */
  /*  v2 -- BATCH EXECUTION                                              */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/batch
   * Execute multiple commands in a single batch. Every command, structured or
   * parsed, is the authenticated user's (R0-09c; it was `dto.userId ?? 'system'`).
   *
   * V1-31c: every command, structured or parsed, is checked as POST execute
   * checks one (cortexCommandRefusal) before any of them runs; one refusal
   * refuses the whole batch (403), each refused command on record.
   */
  @Post('batch')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CortexMemberAuthorityGuard)
  async executeBatch(
    @Body() dto: ExecuteBatchDto,
    @CurrentUser() user?: AuthenticatedUser,
    @CortexMember() member?: CortexMemberAuthority,
  ): Promise<{
    results: ConnectorResult[];
    summary: {
      total: number;
      succeeded: number;
      failed: number;
      executionTimeMs: number;
    };
  }> {
    const actorId = requestActorId(user);
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.commands || dto.commands.length === 0) {
      throw new BadRequestException('commands array is required and must not be empty');
    }
    if (dto.commands.length > 50) {
      throw new BadRequestException('Maximum 50 commands per batch');
    }

    const start = Date.now();

    try {
      // Convert mixed commands to structured ConnectorCommands
      const connectorCommands: ConnectorCommand[] = [];

      for (const cmd of dto.commands) {
        if (cmd.type === 'natural') {
          const capabilities = this.connector.getAllCapabilities();
          const context = await this.contextV2.getFullContext(dto.businessId);
          const parsed = await this.command.parseIntent(cmd.command, {
            businessId: dto.businessId,
            userId: actorId,
            capabilities,
            context,
          } as any);
          if (parsed && parsed.length > 0) {
            connectorCommands.push(
              this.command.toConnectorCommand(
                parsed[0],
                dto.businessId,
                actorId,
              ),
            );
          }
        } else {
          connectorCommands.push({
            module: cmd.module,
            action: cmd.action,
            parameters: cmd.parameters,
            businessId: dto.businessId,
            userId: actorId,
            source: 'key_cortex',
            timestamp: new Date(),
            correlationId: this.generateCorrelationId(),
          });
        }
      }

      await this.assertDirectCommands(member, connectorCommands);
      const batchResult = await this.executor.executeBatch(connectorCommands, {
        stopOnError: dto.stopOnError ?? false,
        skipApproval: !(dto.requireApproval ?? false),
      });

      const results = batchResult.results;
      const succeeded = results.filter((r) => r.result.success).length;
      const failed = results.filter((r) => !r.result.success).length;

      return {
        results: results.map((r) => r.result),
        summary: {
          total: results.length,
          succeeded,
          failed,
          executionTimeMs: Date.now() - start,
        },
      };
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      this.logger.error(`Batch execution error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Batch execution failed');
    }
  }

  /* ================================================================== */
  /*  v2 -- ROLLBACK                                                     */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/rollback
   * Rollback a previously executed command, as the authenticated user (R0-09c;
   * it was 'system').
   */
  @Post('rollback')
  @HttpCode(HttpStatus.OK)
  async rollback(
    @Body() dto: RollbackDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{
    success: boolean;
    correlationId: string;
    message: string;
  }> {
    const actorId = requestActorId(user);
    if (!dto.correlationId) {
      throw new BadRequestException('correlationId is required');
    }
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      // Build a minimal result object for the rollback
      const mockResult: ConnectorResult = {
        success: true,
        executionTimeMs: 0,
        command: {
          module: 'crm',
          action: 'rollback',
          parameters: { correlationId: dto.correlationId, reason: dto.reason },
          businessId: dto.businessId,
          userId: actorId,
          source: 'key_cortex',
          timestamp: new Date(),
          correlationId: dto.correlationId,
        },
      };

      await this.executor.rollback(mockResult);

      return {
        success: true,
        correlationId: dto.correlationId,
        message: `Command ${dto.correlationId} rolled back successfully`,
      };
    } catch (err: any) {
      this.logger.error(`Rollback error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException(
        `Rollback failed: ${err.message}`,
      );
    }
  }

  /* ================================================================== */
  /*  v2 -- BUSINESS REPORT                                              */
  /* ================================================================== */

  /**
   * GET /api/v1/cortex/report
   * Generate a comprehensive business report.
   */
  @Get('report')
  @HttpCode(HttpStatus.OK)
  async getBusinessReport(
    @GuardedBusinessId() businessId: string,
    @Query('scope') scope: 'daily' | 'weekly' | 'monthly' = 'daily',
  ): Promise<Record<string, unknown>> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const report = await this.insight.generateBusinessReport(businessId, scope);
      return report as unknown as Record<string, unknown>;
    } catch (err: any) {
      this.logger.error(`Business report error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to generate business report');
    }
  }

  /* ================================================================== */
  /*  v2 -- RECOMMENDATIONS                                              */
  /* ================================================================== */

  /**
   * GET /api/v1/cortex/recommendations
   * AI-generated recommendations based on full business context.
   */
  @Get('recommendations')
  @HttpCode(HttpStatus.OK)
  async getRecommendations(
    @GuardedBusinessId() businessId: string,
  ): Promise<{
    recommendations: Array<Record<string, unknown>>;
    generatedAt: string;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      const recommendations = await this.insight.generateRecommendations(businessId);
      return {
        recommendations: recommendations as unknown as Array<Record<string, unknown>>,
        generatedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      this.logger.error(`Recommendations error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to generate recommendations');
    }
  }

  /* ================================================================== */
  /*  v2 -- PROFIT OPPORTUNITIES (legacy compat)                         */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/profit-opportunities
   * Find profit opportunities for the business.
   *
   * @deprecated Use GET /api/v1/cortex/insights/profit instead.
   */
  @Post('profit-opportunities')
  @HttpCode(HttpStatus.OK)
  async findProfitOpportunities(
    @Body() dto: ProfitOpportunitiesQueryDto,
  ): Promise<{ opportunities: CortexProfitOpportunity[] }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      const opportunities = await this.reasoning.findProfitOpportunities(
        dto.businessId,
      );

      // Optional category filter applied in-memory if provided
      const filtered = dto.category
        ? opportunities.filter((o) => o.category === dto.category)
        : opportunities;

      return { opportunities: filtered };
    } catch (err: any) {
      this.logger.error(
        `Profit opportunities error: ${err.message}`,
        err.stack,
      );
      throw new ServiceUnavailableException(
        'Unable to find profit opportunities',
      );
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v3 -- SANDBOX  (Code Generation & Execution)                      */
  /* ═══════════════════════════════════════════════════════════════════ */

  /**
   * POST /api/v1/cortex/sandbox/generate
   * Generate code from a natural language description.
   */
  @Post('sandbox/generate')
  @HttpCode(HttpStatus.OK)
  async sandboxGenerate(
    @Body() dto: SandboxGenerateDto,
  ): Promise<{
    code: string;
    language: string;
    explanation?: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.description?.trim()) {
      throw new BadRequestException('description is required');
    }

    try {
      return await this.sandbox.generate(dto.description, {
        language: dto.language,
        context: dto.context,
        businessId: dto.businessId,
      });
    } catch (err: any) {
      this.logger.error(`Sandbox generate error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Code generation failed');
    }
  }

  /**
   * POST /api/v1/cortex/sandbox/execute
   *
   * V1-31c: REFUSED (410) for everyone. It ran the member's own code in
   * KeyCortexSandboxService, which is not a bounded sandbox: JavaScript runs in
   * node:vm with host intrinsics (Object, Array, ...) in scope, so the code
   * reaches the host process and every tenant's data through it (the packet
   * suite's SB-03 does it with code that passes the sandbox's own audit), and
   * Python runs as a child process outside production. Client code runs again
   * only in a sandbox bounded to the caller's own read scopes. No web screen
   * calls this route.
   */
  @Post('sandbox/execute')
  @HttpCode(HttpStatus.OK)
  async sandboxExecute(
    @Body() _dto: SandboxExecuteDto,
  ): Promise<{
    output: string;
    exitCode: number;
    executionTimeMs: number;
    logs?: string[];
  }> {
    throw new GoneException(SANDBOX_REFUSED);
  }

  /**
   * POST /api/v1/cortex/sandbox/auto
   *
   * V1-31c review SEC-V131c-3: REFUSED (410) for everyone, as sandbox/execute
   * is. It generated code from the member's own description and ran it
   * (execute defaulted to true) in the same KeyCortexSandboxService.execute
   * that sandbox/execute reached, so a member steering the description reached
   * the host process (SB-03) with no scope check. Code generation without a
   * run stays on POST sandbox/generate. No web screen calls this route.
   */
  @Post('sandbox/auto')
  @HttpCode(HttpStatus.OK)
  async sandboxAuto(
    @Body() _dto: SandboxAutoDto,
  ): Promise<{
    code: string;
    executed: boolean;
    output?: string;
    exitCode?: number;
    explanation?: string;
  }> {
    throw new GoneException(SANDBOX_REFUSED);
  }

  /**
   * GET /api/v1/cortex/sandbox/templates
   * List available code templates.
   */
  @Get('sandbox/templates')
  @HttpCode(HttpStatus.OK)
  async sandboxTemplates(
    @Query('language') language?: string,
    @Query('category') category?: string,
  ): Promise<{
    templates: Array<{
      id: string;
      name: string;
      description: string;
      language: string;
      category: string;
    }>;
  }> {
    try {
      return await this.sandbox.listTemplates({ language, category });
    } catch (err: any) {
      this.logger.error(`Sandbox templates error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list templates');
    }
  }

  /**
   * POST /api/v1/cortex/sandbox/apply
   *
   * V1-31c: REFUSED (410) for everyone. The template is a built-in one by id,
   * but applyTemplate writes every client parameter into the template's code
   * text (a parameter the template does not declare lands outside any string
   * literal: the packet suite's SB-04) and runs it in the same unbounded
   * sandbox as sandbox/execute. No web screen calls this route.
   */
  @Post('sandbox/apply')
  @HttpCode(HttpStatus.OK)
  async sandboxApply(
    @Body() _dto: SandboxApplyDto,
  ): Promise<{
    code: string;
    templateId: string;
  }> {
    throw new GoneException(SANDBOX_REFUSED);
  }

  /**
   * POST /api/v1/cortex/sandbox/explain
   * Explain what a piece of code does.
   */
  @Post('sandbox/explain')
  @HttpCode(HttpStatus.OK)
  async sandboxExplain(
    @Body() dto: SandboxExplainDto,
  ): Promise<{
    explanation: string;
    complexity?: string;
    suggestions?: string[];
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.code?.trim()) {
      throw new BadRequestException('code is required');
    }

    try {
      return await this.sandbox.explain(dto.code, {
        language: dto.language,
        detail: dto.detail ?? 'detailed',
        businessId: dto.businessId,
      });
    } catch (err: any) {
      this.logger.error(`Sandbox explain error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Code explanation failed');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v3 -- FLOW STUDIO  (Workflow Management)                          */
  /* ═══════════════════════════════════════════════════════════════════ */

  /**
   * POST /api/v1/cortex/flows/generate
   * Generate a flow from a natural language description.
   */
  @Post('flows/generate')
  @HttpCode(HttpStatus.OK)
  async flowGenerate(
    @Body() dto: FlowGenerateDto,
  ): Promise<{
    flow: Record<string, unknown>;
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.description?.trim()) {
      throw new BadRequestException('description is required');
    }

    try {
      return await this.flowStudio.generate(dto.description, {
        businessId: dto.businessId,
        trigger: dto.trigger,
        context: dto.context,
      });
    } catch (err: any) {
      this.logger.error(`Flow generate error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Flow generation failed');
    }
  }

  /**
   * POST /api/v1/cortex/flows
   * Create a new flow.
   */
  @Post('flows')
  @HttpCode(HttpStatus.CREATED)
  async flowCreate(
    @Body() dto: FlowCreateDto,
  ): Promise<Record<string, unknown>> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!dto.nodes || dto.nodes.length === 0) {
      throw new BadRequestException('nodes array is required');
    }

    try {
      return await this.flowStudio.create(dto.businessId, {
        name: dto.name,
        description: dto.description,
        nodes: dto.nodes,
        edges: dto.edges,
        trigger: dto.trigger,
        isActive: dto.isActive ?? false,
      });
    } catch (err: any) {
      this.logger.error(`Flow create error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Flow creation failed');
    }
  }

  /**
   * GET /api/v1/cortex/flows
   * List all flows for a business.
   */
  @Get('flows')
  @HttpCode(HttpStatus.OK)
  async flowList(
    @GuardedBusinessId() businessId: string,
    @Query('status') status?: string,
  ): Promise<{
    flows: Array<Record<string, unknown>>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.flowStudio.list(businessId, { status });
    } catch (err: any) {
      this.logger.error(`Flow list error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list flows');
    }
  }

  /*
   * R0-13g-KEY-FLOWS-ROUTES: GET flows/templates and flows/nodes are declared
   * before GET flows/:id. Express answers with the first route that matches, so
   * while they sat below it flowGet answered them as flow 'templates' and
   * 'nodes' (src/core/config/route-shadowing.spec.ts keeps the order). Both run
   * behind the class guards, as flowGet does, and read no tenant and no actor:
   * they answer the flow studio's built-in catalogues, which are the same for
   * every tenant (test/key-cortex-flows-routes.integration.test.ts).
   */

  /**
   * GET /api/v1/cortex/flows/templates
   * List the built-in flow templates, optionally narrowed to one category
   * (matched without regard to case). A repeated `category` is 400.
   * `category` is typed `unknown` so tsc emits Object for it and the
   * ValidationPipe passes a repeated value through as an array (typed `string`,
   * the pipe would join it into one string) for the check below to refuse.
   */
  @Get('flows/templates')
  @HttpCode(HttpStatus.OK)
  async flowTemplates(
    @Query('category') category?: unknown,
  ): Promise<{ templates: FlowTemplate[] }> {
    if (category !== undefined && typeof category !== 'string') {
      throw new BadRequestException('category must be a single string');
    }
    const studio: KeyCortexFlowStudioService = this.flowStudio;
    try {
      const templates = studio.getTemplates();
      const wanted = category?.trim().toLowerCase();
      return { templates: wanted ? templates.filter((t) => t.category.toLowerCase() === wanted) : templates };
    } catch (err: any) {
      this.logger.error(`Flow templates error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list flow templates');
    }
  }

  /**
   * GET /api/v1/cortex/flows/nodes
   * Get the node registry (available node types).
   */
  @Get('flows/nodes')
  @HttpCode(HttpStatus.OK)
  async flowNodes(): Promise<{ nodes: NodeRegistryEntry[] }> {
    const studio: KeyCortexFlowStudioService = this.flowStudio;
    try {
      return { nodes: studio.getNodeRegistry() };
    } catch (err: any) {
      this.logger.error(`Flow nodes error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve node registry');
    }
  }

  /**
   * GET /api/v1/cortex/flows/:id
   * Get a single flow by ID.
   */
  @Get('flows/:id')
  @HttpCode(HttpStatus.OK)
  async flowGet(
    @Param('id') flowId: string,
    @GuardedBusinessId() businessId?: string,
  ): Promise<Record<string, unknown>> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.flowStudio.get(flowId, businessId);
    } catch (err: any) {
      this.logger.error(`Flow get error: ${err.message}`, err.stack);
      if (err instanceof NotFoundException) throw err;
      throw new ServiceUnavailableException('Unable to retrieve flow');
    }
  }

  /**
   * PUT /api/v1/cortex/flows/:id
   * Update an existing flow.
   */
  @Put('flows/:id')
  @HttpCode(HttpStatus.OK)
  async flowUpdate(
    @Param('id') flowId: string,
    @Body() dto: FlowUpdateDto,
    @GuardedBusinessId() businessId?: string,
  ): Promise<Record<string, unknown>> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.flowStudio.update(flowId, businessId, dto);
    } catch (err: any) {
      this.logger.error(`Flow update error: ${err.message}`, err.stack);
      if (err instanceof NotFoundException) throw err;
      throw new ServiceUnavailableException('Flow update failed');
    }
  }

  /**
   * DELETE /api/v1/cortex/flows/:id
   * Delete a flow.
   */
  @Delete('flows/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async flowDelete(
    @Param('id') flowId: string,
    @GuardedBusinessId() businessId?: string,
  ): Promise<void> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      await this.flowStudio.delete(flowId, businessId);
    } catch (err: any) {
      this.logger.error(`Flow delete error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Flow deletion failed');
    }
  }

  /**
   * POST /api/v1/cortex/flows/:id/execute
   * Execute a stored flow by ID.
   *
   * V1-31c: it called `flowStudio.execute`, a method the flow studio does not
   * have, so every call was 503 and nothing ran. Now it runs ONLY the stored
   * FlowDefinition by id in the business the guard checked (another tenant's
   * flow is the same 404 as an unknown id), and only when:
   *   - the inputs are data: a plain object, no engine key (`_userId` would
   *     name the actor of every node; the actor is the authenticated member);
   *   - the member holds automations write (running a flow is flow.trigger_flow)
   *     and may run every effect node as a direct command (cortexCommandRefusal:
   *     an action node's module write scope, notifications for a notification,
   *     ai for an AI decision; an unknown node type is refused);
   *   - the autonomy authority answers a usable verdict that allows each action
   *     without approval (V1-02 isUsableAutonomyVerdict; fail closed: an
   *     unusable verdict, an error or no authority is 503, a deny or an approval
   *     requirement 403). A flow's nodes reach the connector directly, without
   *     the executor's gate, and there is no approval queue for a flow run.
   *     Review SEC-V131c-4 / CRR-2: the gate is asked once per effect node, with
   *     the parameters that node will run with (flowNodeGateParameters); a node
   *     whose parameters are filled only while the flow runs is refused.
   * Review SEC-V131c-1: the run's `businessId` is the flow's own tenant, set
   * after the inputs (an AI decision bills and keys its model call by it).
   * Every refusal after the flow is found, and the run, write one
   * ai_execution_logs row naming the member (the executor's audit door).
   */
  @Post('flows/:id/execute')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CortexMemberAuthorityGuard)
  async flowExecute(
    @Param('id') flowId: string,
    @Body() body: { inputs?: unknown },
    // The tenant the guard checked: the body's businessId when it names one, else the query's.
    @GuardedBusinessId() businessId?: string,
    @CurrentUser() user?: AuthenticatedUser,
    @CortexMember() member?: CortexMemberAuthority,
  ): Promise<{
    executionId: string;
    status: string;
    results?: Array<Record<string, unknown>>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId is required');
    }
    const actorId = requestActorId(user);
    if (!member || member.userId !== actorId || member.businessId !== businessId) {
      throw new ForbiddenException('The member this flow runs for was not established');
    }
    const inputs = body?.inputs ?? {};
    if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) {
      throw new BadRequestException('inputs must be an object');
    }
    const engineKeys = Object.keys(inputs).filter((k) => FLOW_ENGINE_KEY.test(k));
    if (engineKeys.length > 0) {
      throw new BadRequestException(`inputs may not set the flow engine's own keys (${engineKeys.join(', ')})`);
    }

    const flow = await this.flowStudio.loadFlow(flowId);
    if (!flow || flow.businessId !== businessId) {
      throw new NotFoundException('Flow not found');
    }

    // The run, as the command the audit row records (the executor's audit door).
    const command = (): ConnectorCommand => ({
      module: 'flow',
      action: 'trigger_flow',
      parameters: { flowId: flow.id, inputKeys: Object.keys(inputs) },
      businessId,
      userId: actorId,
      source: 'key_cortex',
      timestamp: new Date(),
      correlationId: this.generateCorrelationId(),
    });
    const refuse = async (exception: HttpException, reason: string): Promise<never> => {
      await this.auditDirectCommand(command(), { success: false, error: reason });
      throw exception;
    };

    // What the run starts from: the inputs as data, then the keys the server
    // sets. `businessId` is the flow's own tenant AFTER the spread: the engine
    // reads context.businessId as the tenant of an AI decision's model call
    // (its preferences, BYOK keys, budget and cost row), so a client input
    // never names it (V1-31c review SEC-V131c-1). `_userId` is the member.
    const runContext: Record<string, unknown> = {
      ...(inputs as Record<string, unknown>),
      businessId: flow.businessId,
      _userId: actorId,
    };

    // Scope: running the flow, then every effect node. Each effect node is gated
    // on its own, with the parameters it will run with (V1-31c review
    // SEC-V131c-4 / CRR-2): the engine's own resolver over the context the
    // run starts from (stored parameters, inputs filled in), as POST execute
    // gates a command with its parameters.
    const gates: Array<{ key: string; parameters: Record<string, unknown> }> = [
      { key: 'flow.trigger_flow', parameters: { flowId: flow.id, inputs } },
    ];
    const flowRefusal = cortexCommandRefusal(member, 'flow', 'trigger_flow');
    if (flowRefusal) return refuse(new ForbiddenException(flowRefusal), flowRefusal);
    const engine = this.flowStudio as unknown as { resolveParameters?: unknown };
    if (typeof engine.resolveParameters !== 'function') {
      const reason = "The flow engine's parameter resolver is unavailable; the flow was not run";
      return refuse(new ServiceUnavailableException(reason), reason);
    }
    const resolve = (engine.resolveParameters as FlowParameterResolver).bind(this.flowStudio);
    for (const node of (flow.nodes ?? []) as Array<{ id?: unknown; type?: unknown; data?: Record<string, unknown> }>) {
      const effect = cortexFlowNodeEffect(node);
      if (!effect) continue;
      let refusal: string | null = null;
      if ('refused' in effect) {
        refusal = effect.refused;
      } else if ('scope' in effect) {
        const level = member.superAdmin ? 'admin' : member.scopes[effect.scope] || 'none';
        if (rankOf(level) < LEVEL_RANK.write) refusal = `Insufficient permissions: ${effect.scope} requires write access (you have ${level})`;
      } else {
        refusal = cortexCommandRefusal(member, effect.module, effect.action);
        if (!refusal) {
          const parameters = this.flowNodeGateParameters(resolve, node, { ...runContext, _trigger: flow.trigger });
          if ('unresolved' in parameters) {
            refusal = `${parameters.unresolved.map((p) => `{{${p}}}`).join(', ')} is filled only while the flow runs, so the autonomy gate cannot check this node's parameters before the run`;
          } else {
            gates.push({ key: `${String(effect.module)}.${String(effect.action)}`, parameters: parameters.resolved });
          }
        }
      }
      if (refusal) {
        const reason = `Flow node ${String(node.id)}: ${refusal}`;
        return refuse(new ForbiddenException(reason), reason);
      }
    }

    // The autonomy gate, fail closed.
    for (const { key, parameters } of gates) {
      if (!this.autonomy) {
        const reason = 'The autonomy authority is unavailable; the flow was not run';
        return refuse(new ServiceUnavailableException(reason), reason);
      }
      let verdict: unknown;
      try {
        verdict = await this.autonomy.evaluateAction(businessId, key, parameters, { proposedBy: actorId });
      } catch (err: unknown) {
        this.logger.error(`[flowExecute] autonomy gate error for ${key}: ${err instanceof Error ? err.message : String(err)}`);
        const reason = 'Autonomy gate unavailable; execution blocked for safety.';
        return refuse(new ServiceUnavailableException(reason), reason);
      }
      if (!isUsableAutonomyVerdict(verdict)) {
        const reason = `Unusable autonomy verdict for ${key}; execution blocked for safety.`;
        return refuse(new ServiceUnavailableException(reason), reason);
      }
      const v = verdict as { allowed: boolean; requiresApproval: boolean; tier: string; reason?: string };
      if (!v.allowed) {
        const reason = v.reason || `Blocked by the autonomy authority: ${key}`;
        return refuse(new ForbiddenException(reason), reason);
      }
      if (v.requiresApproval || v.tier === 'manual') {
        const reason = `${key} needs approval; a flow runs here only when every action is allowed without approval${v.reason ? ` (${v.reason})` : ''}`;
        return refuse(new ForbiddenException(reason), reason);
      }
    }

    try {
      const execution = await this.flowStudio.executeFlow(flow.id, runContext);
      await this.auditDirectCommand(command(), {
        success: execution.status === 'completed',
        error: execution.error,
        data: { executionId: execution.id, status: execution.status },
      });
      return {
        executionId: execution.id,
        status: execution.status,
        results: execution.results as unknown as Array<Record<string, unknown>>,
      };
    } catch (err: any) {
      this.logger.error(`Flow execute error: ${err.message}`, err.stack);
      await this.auditDirectCommand(command(), { success: false, error: err?.message ?? 'Flow execution failed' });
      throw new ServiceUnavailableException('Flow execution failed');
    }
  }

  /**
   * POST /api/v1/cortex/flows/:id/toggle
   * Activate or deactivate a flow.
   */
  @Post('flows/:id/toggle')
  @HttpCode(HttpStatus.OK)
  async flowToggle(
    @Param('id') flowId: string,
    @Body() dto: { active: boolean },
    @GuardedBusinessId() businessId?: string,
  ): Promise<{ flowId: string; active: boolean }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      await this.flowStudio.toggle(flowId, businessId, dto.active);
      return { flowId, active: dto.active };
    } catch (err: any) {
      this.logger.error(`Flow toggle error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Flow toggle failed');
    }
  }

  /**
   * POST /api/v1/cortex/flows/apply-template
   * Apply a template to create a new flow.
   */
  @Post('flows/apply-template')
  @HttpCode(HttpStatus.CREATED)
  async flowApplyTemplate(
    @Body() dto: FlowApplyTemplateDto,
  ): Promise<Record<string, unknown>> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.templateId) {
      throw new BadRequestException('templateId is required');
    }
    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }

    try {
      return await this.flowStudio.applyTemplate(
        dto.templateId,
        dto.businessId,
        {
          name: dto.name,
          parameters: dto.parameters,
        },
      );
    } catch (err: any) {
      this.logger.error(`Flow apply template error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Template application failed');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v3 -- PHONE AGENT  (Voice Calls)                                  */
  /* ═══════════════════════════════════════════════════════════════════ */

  /**
   * POST /api/v1/cortex/phone/call
   * Make a phone call.
   */
  @Post('phone/call')
  @HttpCode(HttpStatus.OK)
  async phoneCall(
    @Body() dto: PhoneCallDto,
  ): Promise<{
    callId: string;
    status: string;
    startedAt: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.phoneNumber?.trim()) {
      throw new BadRequestException('phoneNumber is required');
    }

    try {
      return await this.phone.call(dto.phoneNumber, dto.businessId, {
        script: dto.script,
        context: dto.context,
        record: dto.record ?? false,
      });
    } catch (err: any) {
      this.logger.error(`Phone call error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Failed to initiate call');
    }
  }

  /**
   * GET /api/v1/cortex/phone/history
   * Get call history.
   */
  @Get('phone/history')
  @HttpCode(HttpStatus.OK)
  async phoneHistory(
    @GuardedBusinessId() businessId: string,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
  ): Promise<{
    calls: Array<Record<string, unknown>>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.phone.getHistory(businessId, {
        limit: limit ? Number(limit) : 20,
        status,
      });
    } catch (err: any) {
      this.logger.error(`Phone history error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve call history');
    }
  }

  /**
   * POST /api/v1/cortex/phone/script
   * Generate a call script.
   */
  @Post('phone/script')
  @HttpCode(HttpStatus.OK)
  async phoneScript(
    @Body() dto: PhoneScriptDto,
  ): Promise<{
    script: string;
    talkingPoints: string[];
    estimatedDuration: number;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.objective?.trim()) {
      throw new BadRequestException('objective is required');
    }

    try {
      return await this.phone.generateScript(dto.objective, dto.businessId, {
        tone: dto.tone ?? 'professional',
        context: dto.context,
      });
    } catch (err: any) {
      this.logger.error(`Phone script error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Script generation failed');
    }
  }

  /**
   * POST /api/v1/cortex/phone/analyze
   * Analyze a call transcript.
   */
  @Post('phone/analyze')
  @HttpCode(HttpStatus.OK)
  async phoneAnalyze(
    @Body() dto: PhoneAnalyzeDto,
  ): Promise<{
    sentiment: string;
    outcomes: Array<Record<string, unknown>>;
    summary: string;
    followUps: string[];
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.transcript?.trim()) {
      throw new BadRequestException('transcript is required');
    }

    try {
      return await this.phone.analyzeTranscript(
        dto.transcript,
        dto.businessId,
        { objective: dto.objective },
      );
    } catch (err: any) {
      this.logger.error(`Phone analyze error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Transcript analysis failed');
    }
  }

  /**
   * GET /api/v1/cortex/phone/status
   * Get phone service status.
   */
  @Get('phone/status')
  @HttpCode(HttpStatus.OK)
  async phoneStatus(
    @GuardedBusinessId() businessId?: string,
  ): Promise<{
    available: boolean;
    provider: string;
    region: string;
    capabilities: string[];
  }> {
    // BusinessGuard refuses a request naming no tenant; SUPER_ADMIN, whom it admits
    // without one, is refused here rather than handing the service `undefined`.
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }
    try {
      return await this.phone.getStatus(businessId);
    } catch (err: any) {
      this.logger.error(`Phone status error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve phone status');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v3 -- DOCUMENT INTELLIGENCE  (RAG & Extraction)                   */
  /* ═══════════════════════════════════════════════════════════════════ */

  /**
   * POST /api/v1/cortex/documents
   * Upload a document. The tenant is the one BusinessGuard checked (path and
   * query; see multipartTenant), never a multipart field: this handler used to
   * prefer `body.businessId`, a field multer parses after the guard ran.
   */
  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async documentUpload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { metadata?: Record<string, unknown> },
    @GuardedBusinessId() resolvedBusinessId?: string,
    @Req() req?: BusinessGuardedRequest,
  ): Promise<{
    documentId: string;
    status: string;
    uploadedAt: string;
  }> {
    const businessId = multipartTenant(resolvedBusinessId, req);
    if (!businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!file) {
      throw new BadRequestException('file is required (field name: file)');
    }

    try {
      return await this.document.upload(file.buffer, file.originalname, file.mimetype, businessId, {
        metadata: body.metadata,
      });
    } catch (err: any) {
      this.logger.error(`Document upload error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Document upload failed');
    }
  }

  /**
   * GET /api/v1/cortex/documents
   * List documents for a business.
   */
  @Get('documents')
  @HttpCode(HttpStatus.OK)
  async documentList(
    @GuardedBusinessId() businessId: string,
    @Query('type') type?: string,
    @Query('limit') limit?: number,
  ): Promise<{
    documents: Array<Record<string, unknown>>;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.document.list(businessId, {
        type,
        limit: limit ? Number(limit) : 50,
      });
    } catch (err: any) {
      this.logger.error(`Document list error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to list documents');
    }
  }

  /**
   * GET /api/v1/cortex/documents/:id
   * Get a single document.
   */
  @Get('documents/:id')
  @HttpCode(HttpStatus.OK)
  async documentGet(
    @Param('id') documentId: string,
    @GuardedBusinessId() businessId?: string,
  ): Promise<Record<string, unknown>> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.document.get(documentId, businessId);
    } catch (err: any) {
      this.logger.error(`Document get error: ${err.message}`, err.stack);
      if (err instanceof NotFoundException) throw err;
      throw new ServiceUnavailableException('Unable to retrieve document');
    }
  }

  /**
   * DELETE /api/v1/cortex/documents/:id
   * Delete a document.
   */
  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async documentDelete(
    @Param('id') documentId: string,
    @GuardedBusinessId() businessId?: string,
  ): Promise<void> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      await this.document.delete(documentId, businessId);
    } catch (err: any) {
      this.logger.error(`Document delete error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Document deletion failed');
    }
  }

  /**
   * POST /api/v1/cortex/documents/ask
   * Ask a question across documents (RAG).
   */
  @Post('documents/ask')
  @HttpCode(HttpStatus.OK)
  async documentAsk(
    @Body() dto: DocumentAskDto,
  ): Promise<{
    answer: string;
    sources: Array<{
      documentId: string;
      documentName: string;
      chunks: Array<{ text: string; score: number }>;
    }>;
    confidence: number;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.question?.trim()) {
      throw new BadRequestException('question is required');
    }

    try {
      return await this.document.ask(dto.question, dto.businessId, {
        documentIds: dto.documentIds,
        filters: dto.filters,
      });
    } catch (err: any) {
      this.logger.error(`Document ask error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Document question failed');
    }
  }

  /**
   * POST /api/v1/cortex/documents/extract
   * Extract structured data from a document.
   */
  @Post('documents/extract')
  @HttpCode(HttpStatus.OK)
  async documentExtract(
    @Body() dto: DocumentExtractDto,
  ): Promise<{
    documentId: string;
    extracted: Record<string, unknown>;
    confidence: number;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.documentId) {
      throw new BadRequestException('documentId is required');
    }
    if (!dto.schema || Object.keys(dto.schema).length === 0) {
      throw new BadRequestException('schema is required');
    }

    try {
      return await this.document.extract(dto.documentId, dto.businessId, {
        schema: dto.schema,
        prompt: dto.prompt,
      });
    } catch (err: any) {
      this.logger.error(`Document extract error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Document extraction failed');
    }
  }

  /**
   * POST /api/v1/cortex/documents/compare
   * Compare two documents.
   */
  @Post('documents/compare')
  @HttpCode(HttpStatus.OK)
  async documentCompare(
    @Body() dto: DocumentCompareDto,
  ): Promise<{
    similarities: Array<Record<string, unknown>>;
    differences: Array<Record<string, unknown>>;
    summary: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }
    if (!dto.documentIdA) {
      throw new BadRequestException('documentIdA is required');
    }
    if (!dto.documentIdB) {
      throw new BadRequestException('documentIdB is required');
    }

    try {
      return await this.document.compare(
        dto.documentIdA,
        dto.documentIdB,
        dto.businessId,
        { aspects: dto.aspects },
      );
    } catch (err: any) {
      this.logger.error(`Document compare error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Document comparison failed');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  v3 -- SELF-EVOLUTION  (Adaptive Learning & Tuning)                */
  /* ═══════════════════════════════════════════════════════════════════ */

  /**
   * GET /api/v1/cortex/evolution/profile
   * Get the authenticated user's preference profile for a business (a
   * `?userId` naming another member is ignored, R0-09c).
   */
  @Get('evolution/profile')
  @HttpCode(HttpStatus.OK)
  async evolutionProfile(
    @GuardedBusinessId() businessId: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{
    profile: Record<string, unknown>;
    generatedAt: string;
  }> {
    const userId = requestActorId(user);
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.evolution.getProfile(businessId, { userId });
    } catch (err: any) {
      this.logger.error(`Evolution profile error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve preference profile');
    }
  }

  /**
   * GET /api/v1/cortex/evolution/patterns
   * Get detected usage patterns.
   */
  @Get('evolution/patterns')
  @HttpCode(HttpStatus.OK)
  async evolutionPatterns(
    @GuardedBusinessId() businessId: string,
    @Query('module') moduleName?: string,
    @Query('timeRange') timeRange?: string,
  ): Promise<{
    patterns: Array<{
      type: string;
      description: string;
      frequency: number;
      confidence: number;
    }>;
    generatedAt: string;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.evolution.getPatterns(businessId, {
        module: moduleName,
        timeRange,
      });
    } catch (err: any) {
      this.logger.error(`Evolution patterns error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to retrieve patterns');
    }
  }

  /**
   * POST /api/v1/cortex/evolution/tune
   * Trigger self-tuning.
   */
  @Post('evolution/tune')
  @HttpCode(HttpStatus.OK)
  async evolutionTune(
    @Body() dto: EvolutionTuneDto,
  ): Promise<{
    tuned: boolean;
    scope: string;
    adjustments: Array<Record<string, unknown>>;
    appliedAt: string;
  }> {
    if (!dto.businessId) {
      throw new BadRequestException('businessId is required');
    }

    try {
      return await this.evolution.tune(dto.businessId, {
        scope: dto.scope ?? 'global',
        targetModule: dto.targetModule,
        force: dto.force ?? false,
      });
    } catch (err: any) {
      this.logger.error(`Evolution tune error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Self-tuning failed');
    }
  }

  /**
   * GET /api/v1/cortex/evolution/report
   * Get the learning report.
   */
  @Get('evolution/report')
  @HttpCode(HttpStatus.OK)
  async evolutionReport(
    @GuardedBusinessId() businessId: string,
    @Query('period') period?: string,
  ): Promise<{
    report: Record<string, unknown>;
    generatedAt: string;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }

    try {
      return await this.evolution.getReport(businessId, { period });
    } catch (err: any) {
      this.logger.error(`Evolution report error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to generate learning report');
    }
  }

  /**
   * GET /api/v1/cortex/evolution/decision
   * Explain a specific decision made by the AI.
   */
  @Get('evolution/decision')
  @HttpCode(HttpStatus.OK)
  async evolutionExplainDecision(
    @GuardedBusinessId() businessId: string,
    @Query('decisionId') decisionId?: string,
  ): Promise<{
    explanation: string;
    factors: Array<{ name: string; weight: number; value: unknown }>;
    confidence: number;
  }> {
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }
    if (!decisionId) {
      throw new BadRequestException('decisionId query parameter is required');
    }

    try {
      return await this.evolution.explainDecision(decisionId, businessId);
    } catch (err: any) {
      this.logger.error(`Evolution explain error: ${err.message}`, err.stack);
      throw new ServiceUnavailableException('Unable to explain decision');
    }
  }

  /* ================================================================== */
  /*  Helpers                                                           */
  /* ================================================================== */

  /* ================================================================== */
  /*  CONSCIOUS CHAT — the CNS surface                                    */
  /* ================================================================== */

  /**
   * POST /api/v1/cortex/conscious/chat
   *
   * Routes a query through all nine cognitive organs and returns the answer
   * together with the reasoning that produced it. Until now processConsciously
   * had no caller anywhere in the repo — the organs were registered and
   * injectable but nothing drove them. The session is the authenticated
   * user's; a body `userId` is ignored (R0-09c).
   */
  @Post('conscious/chat')
  @HttpCode(HttpStatus.OK)
  async consciousChat(
    @Body() dto: ConsciousChatDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{
    text: string;
    phases: ConsciousPhaseEvent[];
    reasoningMode: string;
    confidence: number;
    permitted: boolean;
    actions: unknown[];
    meta: Record<string, unknown>;
  }> {
    const actorId = requestActorId(user);
    if (!dto.text?.trim()) throw new BadRequestException('text is required');
    if (!dto.businessId) throw new BadRequestException('businessId is required');

    const session = await this.sessionService.getOrCreateSession({
      text: dto.text,
      businessId: dto.businessId,
      userId: actorId,
      sessionId: await this.ownSessionId(dto.businessId, actorId, dto.sessionId),
    } as CortexQuery);

    // Collect the phases the pipeline actually emits. Deriving them from
    // response.meta would only ever recover timings, losing what each layer
    // concluded — and would silently produce [] if meta ever stopped carrying
    // *Ms keys. This way the phase list cannot drift from the pipeline.
    const phases: ConsciousPhaseEvent[] = [];
    const response = await this.consciousness.processConsciously(
      dto.text,
      session,
      (phase) => phases.push(phase),
    );

    return {
      text: response.text,
      phases,
      reasoningMode: response.reasoning?.bestChain?.mode ?? 'unknown',
      confidence: response.confidence?.confidence ?? 0,
      permitted: response.ethical?.permitted ?? true,
      actions: response.actions ?? [],
      meta: (response.meta ?? {}) as unknown as Record<string, unknown>,
    };
  }

  /**
   * SSE /api/v1/cortex/conscious/stream
   *
   * The same pipeline, but each cognitive step is pushed to the client the
   * moment it completes rather than after all ten finish. This is what makes
   * KEY's thinking watchable: the client sees "Reading emotional state →
   * frustrated (82%)" while reasoning is still running.
   *
   * Event types:
   *   phase  — one cognitive step completed, with what that layer concluded
   *   answer — the synthesized response
   *   error  — pipeline failed; the pipeline itself degrades gracefully, so
   *            this fires only for setup failures (e.g. session creation)
   *
   * Parameters come from the QUERY STRING, not the body. Nest's @Sse registers
   * a GET (see sse.decorator.js: METHOD_METADATA = RequestMethod.GET), and the
   * browser EventSource API cannot send a request body on a GET. A body-taking
   * SSE route is therefore uncallable from any standard client — which is the
   * bug the pre-existing `chat/stream` route has.
   *
   * The tenant is the one BusinessGuard checked (R0-34b), not the query's
   * `businessId` field of the DTO: a GET can still carry a JSON body, which the
   * guard resolves before the query. A session id naming another tenant's
   * session is refused before the stream starts (review ST-1,
   * `ownSessionId`), and so is another member's (R0-09c review ST-2). The
   * session it writes is the authenticated user's, never the query's `userId`
   * (R0-09c, R0-34b review ST-3).
   */
  @Sse('conscious/stream')
  async consciousStream(
    @Query() dto: ConsciousChatDto,
    @GuardedBusinessId() businessId?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Observable<{
    type: string;
    data: Record<string, unknown>;
  }>> {
    const actorId = requestActorId(user);
    if (!dto.text?.trim()) throw new BadRequestException('text is required');
    if (!businessId) throw new BadRequestException('businessId is required');
    const sessionId = await this.ownSessionId(businessId, actorId, dto.sessionId);

    const subject = new Subject<{ type: string; data: Record<string, unknown> }>();

    // Run in a background micro-task so the SSE connection is established
    // before the first phase lands — otherwise early phases are emitted into a
    // stream with no subscriber and are lost.
    void (async () => {
      try {
        const session = await this.sessionService.getOrCreateSession({
          text: dto.text,
          businessId,
          userId: actorId,
          sessionId,
        } as CortexQuery);

        const response = await this.consciousness.processConsciously(
          dto.text,
          session,
          (phase) =>
            subject.next({
              type: 'phase',
              data: phase as unknown as Record<string, unknown>,
            }),
        );

        subject.next({
          type: 'answer',
          data: {
            text: response.text,
            reasoningMode: response.reasoning?.bestChain?.mode ?? 'unknown',
            confidence: response.confidence?.confidence ?? 0,
            permitted: response.ethical?.permitted ?? true,
            actions: response.actions ?? [],
          },
        });
        subject.complete();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        this.logger.error(`Conscious stream error: ${message}`);
        subject.next({ type: 'error', data: { message } });
        subject.complete();
      }
    })();

    return subject.asObservable();
  }

  /**
   * GET /api/v1/cortex/awareness
   *
   * Everything KEY has noticed on its own: weak signals, churn predictions,
   * ideas and reflection cycles. Until now the proactive layers recorded all of
   * this and nothing read it back — KEY was noticing into a drawer nobody opens.
   */
  @Get('awareness')
  async getAwareness(
    @GuardedBusinessId() businessId: string,
    @Query('kinds') kinds?: string,
    @Query('sinceDays') sinceDays?: string,
  ): Promise<{
    items: unknown[];
    counts: Record<string, number>;
    latestAt: string | null;
  }> {
    if (!businessId) throw new BadRequestException('businessId is required');

    // Only accept kind names we actually store; an unknown one is a client bug
    // worth surfacing rather than silently returning everything.
    const valid = Object.keys(AWARENESS_TYPES);
    const requested = kinds
      ? kinds.split(',').map((k) => k.trim()).filter(Boolean)
      : [];
    const unknown = requested.filter((k) => !valid.includes(k));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `unknown kinds: ${unknown.join(', ')} (valid: ${valid.join(', ')})`,
      );
    }

    const days = sinceDays ? Number(sinceDays) : undefined;
    if (sinceDays !== undefined && (!Number.isFinite(days) || days! <= 0)) {
      throw new BadRequestException('sinceDays must be a positive number');
    }

    const summary = await this.awareness.getAwareness(businessId, {
      kinds: requested as Array<keyof typeof AWARENESS_TYPES>,
      sinceDays: days,
    });

    return {
      items: summary.items,
      counts: summary.counts,
      latestAt: summary.latestAt ? summary.latestAt.toISOString() : null,
    };
  }

  private generateCorrelationId(): string {
    return `kc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * V1-31c: refuses (403) when any of `commands` is one the member may not run
   * as a direct command (cortexCommandRefusal, or a tenant other than the one
   * the guard checked), before any of them runs, and puts each refused command
   * on record through the executor's audit door (one ai_execution_logs row
   * naming the member).
   *
   * `member` comes from @CortexMember(), which over HTTP always supplies it (the
   * route's CortexMemberAuthorityGuard loads it, and the decorator refuses a
   * request it is missing from). It is undefined only when a handler is called
   * directly as a method, as the unit specs that pin the actor binding do; no
   * request reaches a handler that way.
   */
  private async assertDirectCommands(member: CortexMemberAuthority | undefined, commands: ConnectorCommand[]): Promise<void> {
    if (!member) return;
    const refused: Array<{ command: ConnectorCommand; reason: string }> = [];
    for (const command of commands) {
      const reason = command.businessId !== member.businessId
        ? 'businessId does not match the business this request was authorized for'
        : cortexCommandRefusal(member, command.module, command.action);
      if (reason) refused.push({ command, reason });
    }
    if (refused.length === 0) return;
    for (const { command, reason } of refused) {
      await this.auditDirectCommand(command, { success: false, error: reason });
    }
    throw new ForbiddenException(refused.map((r) => r.reason).join('; '));
  }

  /**
   * V1-31c review SEC-V131c-4 / CRR-2: the parameters an effect node of a flow
   * will run with, for the autonomy gate. They are resolved by the flow
   * engine's own resolver (`resolve`, KeyCortexFlowStudioService.resolveParameters)
   * over the context the run starts from, so the gate sees what the engine
   * will compute, not a copy of its rules. A placeholder that context does not
   * fill (another node's output, a loop item, an error) is filled only while
   * the flow runs, after the gate: it comes back as `unresolved` and the route
   * refuses the flow (fail closed).
   *
   * An action node runs with its `data.parameters`; a notification node with
   * what KeyCortexFlowStudioService.executeNotification sends: the recipient
   * (the member by default), the title and body templates, and the priority.
   */
  private flowNodeGateParameters(
    resolve: FlowParameterResolver,
    node: { type?: unknown; data?: Record<string, unknown> },
    context: Record<string, unknown>,
  ): { resolved: Record<string, unknown> } | { unresolved: string[] } {
    const data = node.data ?? {};
    const literal: Record<string, unknown> = {};
    let templated: Record<string, unknown>;
    if (node.type === 'notification') {
      literal.userId = data.notificationRecipient || context._userId || 'system';
      literal.priority = data.notificationPriority || 'normal';
      templated = { title: data.notificationTitle || 'Flow Notification', body: data.notificationBody || '' };
    } else {
      const params = data.parameters;
      templated = params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
    }
    const unresolved = new Set<string>();
    for (const value of Object.values(templated)) {
      if (typeof value !== 'string') continue;
      for (const match of value.matchAll(FLOW_PLACEHOLDER)) {
        const placeholder = match[1].trim();
        if (resolve({ value: `{{${placeholder}}}` }, context).value === undefined) unresolved.add(placeholder);
      }
    }
    if (unresolved.size > 0) return { unresolved: [...unresolved] };
    return { resolved: { ...resolve(templated, context), ...literal } };
  }

  /**
   * V1-31c: one ai_execution_logs row for a direct command this controller
   * decided (a refusal, or a flow run), written by the executor's own audit door
   * (KeyCortexExecutorService.logExecution), so it reads like every executed
   * command's row. A failed write is logged and never changes the answer.
   */
  private async auditDirectCommand(
    command: ConnectorCommand,
    outcome: { success: boolean; error?: string; data?: unknown },
  ): Promise<void> {
    const now = new Date();
    const record: ExecutionRecord = {
      id: randomUUID(),
      command,
      result: { success: outcome.success, error: outcome.error, data: outcome.data, executionTimeMs: 0, command },
      startedAt: command.timestamp ?? now,
      finishedAt: now,
      durationMs: Math.max(0, now.getTime() - (command.timestamp ?? now).getTime()),
      traceId: command.correlationId ?? this.generateCorrelationId(),
      rolledBack: false,
    };
    try {
      await this.executor.logExecution(record);
    } catch (err: unknown) {
      this.logger.error(`[V1-31c] audit row for ${command.module}.${command.action} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Review ST-1, and R0-09c review ST-1..ST-4: the authenticated user's own
   * session `sessionId` in `businessId`, the tenant the guard checked, or null
   * when no session has that id.
   *
   * KeyCortexConversationService.getSession and
   * KeyCortexSessionService.getOrCreateSession read the Redis entry
   * `cortex:session:<id>` before the database and check no tenant there; the
   * Prisma tenant extension scopes only the database fallback. So a member of
   * A naming B's session id, once B's own traffic had cached it, read B's
   * messages and ran chat, the streams and the conscious pipeline on B's
   * session (appending A's turns to B's cached session). Within one tenant the
   * services check no owner either, so a STAFF member naming the OWNER's
   * session id read the OWNER's conversation (GET sessions/:id, GET messages),
   * renamed or archived it (PATCH, DELETE), ran the reasoning engine and the
   * conscious pipeline on it (the pipeline then acted for session.userId, the
   * OWNER) and rewrote the OWNER's feedback on it.
   *
   * A session is its creator's: POST sessions and the session services create
   * it for the authenticated actor (R0-09c), and GET sessions lists only the
   * actor's own. A session of another tenant, or of another member of this
   * one, is refused as not found, like an unknown id on the routes that read
   * one (an `error` event once an SSE stream is committed); there is no
   * cross-member read here, SUPER_ADMIN included.
   */
  private async ownSession(businessId: string, actorId: string, sessionId: string): Promise<CortexSession | null> {
    const session = await this.conversation.getSession(sessionId);
    if (!session) return null;
    if (session.businessId !== businessId || session.userId !== actorId) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  /**
   * The session id a handler may hand the session services (chat, the
   * streams, the conscious pipeline): one of the actor's own sessions in this
   * tenant (`ownSession`), or `undefined` when no session has that id, so the
   * services start a new session for the actor under `businessId` exactly as
   * they did for an unknown id; the caller's id never reaches their cache
   * read, so a session cached after this check cannot be picked up. Sessions
   * never change tenant or owner, so an id returned here stays the actor's.
   */
  private async ownSessionId(businessId: string, actorId: string, sessionId: string | undefined): Promise<string | undefined> {
    if (!sessionId) return undefined;
    return (await this.ownSession(businessId, actorId, sessionId)) ? sessionId : undefined;
  }

  /** PATCH and DELETE sessions/:id: the session must exist and be the actor's own (`ownSession`). */
  private async requireOwnSession(
    businessId: string | undefined,
    user: AuthenticatedUser | undefined,
    sessionId: string,
  ): Promise<void> {
    const actorId = requestActorId(user);
    if (!businessId) {
      throw new BadRequestException('businessId query parameter is required');
    }
    if (!(await this.ownSession(businessId, actorId, sessionId))) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
  }
}
