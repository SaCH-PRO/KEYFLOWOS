import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  explicitScopeMap,
  isCanonicalModule,
  LEVEL_RANK,
  memberModuleLevel,
  rankOf,
  type CanonicalModule,
} from '../../core/authority/module-vocabulary';
import {
  financialProposalsWithProvenance,
  financialProposalWithProvenance,
  isFinanceRecommendation,
  isFinanceSignal,
  nonFinancialProposalForReader,
  redactedProposalView,
  type GenomeReader,
  type GenomeRowFields,
  type ProposalFields,
} from '../business-genome/key-genome/genome-finance-scope';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { KeyActionExecutorService } from './key-action-executor.service';
import { KeyActionPolicyService } from './key-action-policy.service';
import { v1ToolRefusalReasonForInvocation } from '../ai/v1-tool-allowlist';
import { KeyActionGenomePolicyService } from './key-action-genome-policy.service';
import { AutonomyOrchestratorService } from './autonomy-orchestrator.service';
import { ActionNotClearedError, KeyActionBoundaryService } from './action-boundary/key-action-boundary.service';
import { resolvePrincipalAuthority, type PrincipalAuthority } from './action-boundary/control-clearance';
import {
  computeProposalCarriesMoney,
  structuredPayloadCarriesMoney,
  structuralTextCarriesMoney,
} from './proposal-money-tag';
import type {
  CreateKeyActionProposalInput,
  KeyActionProposalData,
  KeyActionProposalStatus,
  KeyExecutableActionType,
  ListKeyActionProposalsQuery,
} from './key-action-proposal.types';
import { KEY_ACTION_PROPOSAL_STATUSES } from './key-action-proposal.types';

type ProposalDb = PrismaService['client'];
type ProposalTx = Parameters<Extract<Parameters<ProposalDb['$transaction']>[0], (...args: never[]) => unknown>>[0];
type AuthorityReader = Pick<ProposalTx, 'user' | 'business' | 'membership'>;

/**
 * V1-32 (CF-29): what an approval of a non-boundary proposal records in
 * `resolution`, beside `approvedBy`: the authority it was given under, read
 * when it was given. Execution re-reads the approver and compares.
 */
interface RecordedApproval {
  v: 1;
  kind: 'APPROVAL';
  approvedBy: string | null;
  authority: Pick<PrincipalAuthority, 'basis' | 'membershipId' | 'approvalTier'> | null;
  at: string;
}

/** The authority an approval was recorded under, when it was recorded for this approver. */
function recordedAuthority(resolution: unknown, approvedBy: string): RecordedApproval['authority'] {
  if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) return null;
  const r = resolution as Partial<RecordedApproval>;
  if (r.kind !== 'APPROVAL' || r.approvedBy !== approvedBy || !r.authority) return null;
  const { basis, membershipId, approvalTier } = r.authority;
  if (typeof basis !== 'string' || typeof approvalTier !== 'number') return null;
  return { basis, membershipId: typeof membershipId === 'string' ? membershipId : null, approvalTier };
}

type ClaimOutcome =
  | { kind: 'claimed' }
  | { kind: 'conflict' }
  | { kind: 'lapsed'; reason: string; approvedBy: string | null; recorded: boolean };

/**
 * W11-PROPOSAL-RESULT-READER-SCOPE (SEC-SR-2; D-238, D-140):
 * Resolved read rights of a proposal reader within a business.
 * `isUnscopedOwner` is true ONLY for an `OWNER` with no explicit
 * `permissionScopes` map (D-140: an `OWNER` with an explicit scope map or
 * JSON array is bound by `memberModuleLevel`).
 */
interface ProposalReaderAccess {
  userId: string | null;
  isSuperAdmin: boolean;
  isUnscopedOwner: boolean;
  readsRevenue: boolean;
  canReadModule: (module: CanonicalModule) => boolean;
}

const CLOSED_READER_ACCESS: ProposalReaderAccess = {
  userId: null,
  isSuperAdmin: false,
  isUnscopedOwner: false,
  readsRevenue: false,
  canReadModule: () => false,
};

/**
 * Non-canonical module aliases used by KEY proposal producers mapped to the
 * canonical human-authority module vocabulary (module-vocabulary.ts).
 */
const MODULE_SCOPE_ALIASES: Readonly<Record<string, CanonicalModule>> = {
  contacts: 'crm',
  clients: 'crm',
  calendar: 'bookings',
  appointments: 'bookings',
  tasks: 'projects',
  social: 'content',
  communications: 'content',
  marketing: 'content',
  finance: 'revenue',
  commerce: 'revenue',
  billing: 'revenue',
  invoices: 'revenue',
  payments: 'revenue',
  sales: 'revenue',
  marketplace: 'storefront',
  inventory: 'storefront',
  inbox: 'operations',
  key_inbox: 'operations',
  helpdesk: 'operations',
  documents: 'operations',
  contracts: 'operations',
};

function resolveCanonicalModule(raw: string | null | undefined): CanonicalModule | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (isCanonicalModule(normalized)) return normalized;
  return MODULE_SCOPE_ALIASES[normalized] ?? null;
}

type ResultScopeRequirement =
  | { kind: 'ownerOnly' }
  | { kind: 'modules'; modules: CanonicalModule[]; runMemberOrOwner: boolean }
  | { kind: 'unclassified' };

function extractProposalToolName(
  proposal: Pick<KeyActionProposalData, 'toolName' | 'payload' | 'inputPayload'>,
): string | null {
  if (typeof proposal.toolName === 'string' && proposal.toolName.trim()) {
    return proposal.toolName.trim();
  }
  for (const container of [proposal.payload, proposal.inputPayload]) {
    if (container && typeof container === 'object' && !Array.isArray(container)) {
      const candidate = (container as Record<string, unknown>).toolName;
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }
  return null;
}

/**
 * Resolve the read-scope requirement for a proposal's stored `executionResult`:
 *   - Non-empty `toolName` (top-level or in payload/inputPayload) is resolved
 *     through `graphActionRequirement` (covering dotted organ tools, twins,
 *     snake_case FLOW tools, `GRAPH_ACTION_EXTRA_SCOPES`, refused, and
 *     owner-only tools). Unmapped, refused, or `ownerOnly` tools fail closed
 *     to `{ kind: 'ownerOnly' }` (never weakened by `proposal.module` or
 *     `executedBy`). Tools with `ownerOnlyWithoutPrincipal` (CRM visibility-
 *     bounded contact reads) require both the tool's module scopes AND that
 *     the reader is the run's member (`executedBy`) or an unscoped owner.
 *   - Non-empty `proposal.module` is unioned with tool-derived modules; an
 *     unrecognized non-empty module fails closed to `{ kind: 'ownerOnly' }`.
 *   - `{ kind: 'unclassified' }` is returned ONLY when neither `toolName` nor
 *     `proposal.module` is declared.
 */
type GraphActionRequirementFn = typeof import('../ai/graph-actions.controller').graphActionRequirement;
let cachedGraphActionRequirement: GraphActionRequirementFn | null = null;
async function loadGraphActionRequirement(): Promise<GraphActionRequirementFn> {
  if (!cachedGraphActionRequirement) {
    // Imported at call time: graph-actions.controller sits on the AiController ->
    // KeyActionProposalService -> GraphActionsController -> AiOversightService cycle.
    const mod = await import('../ai/graph-actions.controller');
    cachedGraphActionRequirement = mod.graphActionRequirement;
  }
  return cachedGraphActionRequirement;
}

function resolveResultScopeRequirement(
  proposal: Pick<KeyActionProposalData, 'toolName' | 'module' | 'payload' | 'inputPayload'>,
  graphActionReq: GraphActionRequirementFn,
): ResultScopeRequirement {
  const modules = new Set<CanonicalModule>();
  let runMemberOrOwner = false;

  const tool = extractProposalToolName(proposal);
  if (tool) {
    const req = graphActionReq(tool);
    if (!req || 'refused' in req || req.ownerOnly) {
      return { kind: 'ownerOnly' };
    }
    for (const scope of req.scopes) {
      modules.add(scope.module);
    }
    if (req.ownerOnlyWithoutPrincipal) {
      runMemberOrOwner = true;
    }
  }

  const rawModule = typeof proposal.module === 'string' ? proposal.module.trim() : '';
  if (rawModule) {
    const directModule = resolveCanonicalModule(rawModule);
    if (!directModule) {
      return { kind: 'ownerOnly' };
    }
    modules.add(directModule);
  }

  if (modules.size > 0) {
    return { kind: 'modules', modules: [...modules], runMemberOrOwner };
  }
  return { kind: 'unclassified' };
}

async function resolveProposalReaderAccess(
  prisma: PrismaService,
  businessId: string,
  reader: GenomeReader,
): Promise<ProposalReaderAccess> {
  if (reader?.role === 'SUPER_ADMIN') {
    return {
      userId: reader.id ?? null,
      isSuperAdmin: true,
      isUnscopedOwner: false,
      readsRevenue: true,
      canReadModule: () => true,
    };
  }
  if (!reader?.id) return CLOSED_READER_ACCESS;
  if (reader.role === undefined) {
    let platformRole: string | undefined;
    try {
      platformRole = (await prisma.client.user?.findUnique({ where: { id: reader.id }, select: { role: true } }))?.role;
    } catch {
      platformRole = undefined;
    }
    if (platformRole === 'SUPER_ADMIN') {
      return {
        userId: reader.id,
        isSuperAdmin: true,
        isUnscopedOwner: false,
        readsRevenue: true,
        canReadModule: () => true,
      };
    }
  }
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId: reader.id, businessId } },
    select: { role: true, permissionScopes: true },
  });
  if (!membership) return CLOSED_READER_ACCESS;
  // D-140: an OWNER with an explicit permissionScopes map (or JSON array) is bound by it.
  const isUnscopedOwner = membership.role === 'OWNER' && explicitScopeMap(membership.permissionScopes) === null;
  const canReadModule = (mod: CanonicalModule) => rankOf(memberModuleLevel(membership, mod)) >= LEVEL_RANK.read;
  return {
    userId: reader.id,
    isSuperAdmin: false,
    isUnscopedOwner,
    readsRevenue: canReadModule('revenue'),
    canReadModule,
  };
}

const MAX_RESULT_WALK_DEPTH = 8;
const MAX_RESULT_WALK_NODES = 200;

/**
 * Keys referencing other finance-capable genome entities (facts, memory events,
 * recommendation outcomes, financial snapshots/metrics) that fail closed when
 * `!readsRevenue`.
 */
const OPAQUE_FINANCE_CAPABLE_GENOME_KEYS: ReadonlySet<string> = new Set([
  'factId',
  'fact_id',
  'factIds',
  'fact_ids',
  'facts',
  'memoryEventId',
  'memory_event_id',
  'memoryEventIds',
  'memory_event_ids',
  'memoryEvents',
  'memory_events',
  'outcomeId',
  'outcome_id',
  'outcomeIds',
  'outcome_ids',
  'snapshotId',
  'snapshot_id',
  'metricId',
  'metric_id',
]);

interface ExtractedGenomeRefs {
  recIds: string[];
  sigIds: string[];
  failClosed: boolean;
}

/**
 * Extract genome recommendation and signal IDs referenced inside a stored
 * `executionResult` (camelCase + snake_case, singular objects, string/object
 * arrays; bounded depth/nodes with accounting on ID arrays; truncated or
 * opaque finance-capable genome refs fail closed).
 */
function extractGenomeRefs(value: unknown): ExtractedGenomeRefs {
  if (value === null || value === undefined || typeof value !== 'object') {
    return { recIds: [], sigIds: [], failClosed: false };
  }
  const recIds = new Set<string>();
  const sigIds = new Set<string>();
  let visited = 0;
  let failClosed = false;

  const charge = (): boolean => {
    if (failClosed) return false;
    if (++visited > MAX_RESULT_WALK_NODES) {
      failClosed = true;
      return false;
    }
    return true;
  };

  const pushString = (target: Set<string>, v: unknown) => {
    if (!charge()) return;
    if (typeof v === 'string' && v.trim().length > 0) target.add(v.trim());
  };

  const extractRefOrWalk = (target: Set<string>, val: unknown, depth: number) => {
    if (typeof val === 'string') {
      pushString(target, val);
    } else if (val && typeof val === 'object') {
      if (!Array.isArray(val)) {
        const objId = (val as Record<string, unknown>).id;
        if (typeof objId === 'string') pushString(target, objId);
      }
      walk(val, depth + 1);
    }
  };

  const extractArrayRefs = (target: Set<string>, arr: unknown[], depth: number) => {
    for (const entry of arr) {
      if (failClosed) return;
      if (typeof entry === 'string') {
        pushString(target, entry);
      } else if (entry && typeof entry === 'object') {
        if (!Array.isArray(entry)) {
          const objId = (entry as Record<string, unknown>).id;
          if (typeof objId === 'string') pushString(target, objId);
        }
        walk(entry, depth + 1);
      } else {
        charge();
      }
    }
  };

  const walk = (node: unknown, depth: number): void => {
    if (failClosed || node === null || node === undefined || typeof node !== 'object') return;
    if (depth > MAX_RESULT_WALK_DEPTH || !charge()) {
      failClosed = true;
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (failClosed) return;
      if (OPAQUE_FINANCE_CAPABLE_GENOME_KEYS.has(key) && val !== null && val !== undefined) {
        if (!Array.isArray(val) || val.length > 0) {
          failClosed = true;
          return;
        }
        continue;
      }
      if (key === 'recommendationId' || key === 'recommendation_id' || key === 'recommendation') {
        extractRefOrWalk(recIds, val, depth);
      } else if (key === 'signalId' || key === 'signal_id' || key === 'signal') {
        extractRefOrWalk(sigIds, val, depth);
      } else if (
        (key === 'recommendationIds' || key === 'recommendation_ids' || key === 'recommendations') &&
        Array.isArray(val)
      ) {
        extractArrayRefs(recIds, val, depth);
      } else if ((key === 'signalIds' || key === 'signal_ids' || key === 'signals') && Array.isArray(val)) {
        extractArrayRefs(sigIds, val, depth);
      } else if (val && typeof val === 'object') {
        walk(val, depth + 1);
      }
    }
  };

  walk(value, 0);
  return { recIds: [...recIds], sigIds: [...sigIds], failClosed };
}

/**
 * SEC-SR-2: batch-checks whether any proposal's `executionResult` references a
 * FINANCIAL genome recommendation or signal by ID in `businessId` (fail closed
 * on missing rows, truncated/opaque payloads, or DB errors). Selects every
 * D-234 column inspected by `isFinanceRecommendation` and `isFinanceSignal`.
 */
async function executionResultsReferenceFinanceGenome(
  prisma: PrismaService,
  businessId: string,
  proposals: ReadonlyArray<Pick<KeyActionProposalData, 'executionResult'>>,
): Promise<boolean[]> {
  const extracted = proposals.map((p) => extractGenomeRefs(p.executionResult));
  const wantedRecIds = [...new Set(extracted.flatMap((e) => (e.failClosed ? [] : e.recIds)))];
  const wantedSigIds = [...new Set(extracted.flatMap((e) => (e.failClosed ? [] : e.sigIds)))];
  if (wantedRecIds.length === 0 && wantedSigIds.length === 0) {
    return extracted.map((e) => e.failClosed);
  }

  let recMap: Map<string, GenomeRowFields> | null = new Map();
  let sigMap: Map<string, GenomeRowFields> | null = new Map();
  if (wantedRecIds.length > 0) {
    try {
      const recs = ((await prisma.client.genomeRecommendation?.findMany({
        where: { businessId, id: { in: wantedRecIds } },
        select: { id: true, domain: true, title: true, diagnosis: true },
      })) ?? []) as Array<{ id: string } & GenomeRowFields>;
      recMap = new Map(recs.map((r) => [r.id, r]));
    } catch {
      recMap = null;
    }
  }
  if (wantedSigIds.length > 0) {
    try {
      const sigs = ((await prisma.client.genomeSignal?.findMany({
        where: { businessId, id: { in: wantedSigIds } },
        select: {
          id: true,
          sourceModule: true,
          sourceEntityType: true,
          section: true,
          domain: true,
          signalType: true,
          field: true,
          reason: true,
          evidence: true,
          proposedValue: true,
        },
      })) ?? []) as Array<{ id: string } & GenomeRowFields>;
      sigMap = new Map(sigs.map((s) => [s.id, s]));
    } catch {
      sigMap = null;
    }
  }

  return extracted.map(({ recIds, sigIds, failClosed }) => {
    if (failClosed) return true;
    if (recIds.length > 0) {
      if (!recMap) return true;
      for (const id of recIds) {
        const rec = recMap.get(id);
        if (!rec || isFinanceRecommendation(rec)) return true;
      }
    }
    if (sigIds.length > 0) {
      if (!sigMap) return true;
      for (const id of sigIds) {
        const sig = sigMap.get(id);
        if (!sig || isFinanceSignal(sig)) return true;
      }
    }
    return false;
  });
}

/**
 * SEC-SR-2: project a proposal's stored `executionResult` for the reader.
 * Simplest correct rule:
 *   - No `executionResult` -> unchanged.
 *   - `SUPER_ADMIN` or unscoped `OWNER` (D-140) -> keeps `executionResult`.
 *   - Referenced finance genome row (or opaque/truncated genome ref) without
 *     `revenue:read` -> withhold (`null`).
 *   - `ownerOnly` / refused / unmapped tool or unrecognized non-empty module ->
 *     withhold (`null`).
 *   - Canonical module scopes -> reader must hold `read` on every required
 *     module (and, for CRM visibility-bounded reads, also be `executedBy`),
 *     else withhold (`null`).
 *   - Truly unclassified proposal (no tool and no module) -> only the run's
 *     member (`executedBy === reader.id`) keeps `executionResult`, else `null`.
 */
function projectExecutionResultForReader<T extends KeyActionProposalData>(
  proposal: T,
  access: ProposalReaderAccess,
  referencesFinanceGenome: boolean,
  graphActionReq: GraphActionRequirementFn,
): T {
  if (proposal.executionResult === null || proposal.executionResult === undefined) return proposal;
  if (access.isSuperAdmin || access.isUnscopedOwner) return proposal;
  if (!access.readsRevenue && referencesFinanceGenome) {
    return { ...proposal, executionResult: null };
  }
  const req = resolveResultScopeRequirement(proposal, graphActionReq);
  if (req.kind === 'ownerOnly') {
    return { ...proposal, executionResult: null };
  }
  const isRunMember = Boolean(access.userId && proposal.executedBy && access.userId === proposal.executedBy);
  if (req.kind === 'modules') {
    const hasModules = req.modules.every((mod) => access.canReadModule(mod));
    if (!hasModules) return { ...proposal, executionResult: null };
    if (req.runMemberOrOwner && !isRunMember) return { ...proposal, executionResult: null };
    return proposal;
  }
  return isRunMember ? proposal : { ...proposal, executionResult: null };
}

@Injectable()
export class KeyActionProposalService {
  private readonly logger = new Logger(KeyActionProposalService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TemporalFlowService) private readonly temporal: TemporalFlowService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(KeyActionPolicyService) private readonly policy: KeyActionPolicyService,
    @Inject(KeyActionExecutorService) private readonly executor: KeyActionExecutorService,
    @Inject(KeyActionGenomePolicyService) private readonly genomePolicy: KeyActionGenomePolicyService,
    @Inject(forwardRef(() => AutonomyOrchestratorService)) private readonly autonomyOrchestrator: AutonomyOrchestratorService,
    @Inject(KeyActionBoundaryService) private readonly boundary: KeyActionBoundaryService,
  ) {}

  async create(
    businessId: string,
    input: CreateKeyActionProposalInput,
    userId?: string,
  ): Promise<KeyActionProposalData> {
    const v1Refusal = v1ToolRefusalReasonForInvocation(input.toolName ?? input.actionType, input);
    if (v1Refusal) {
      throw new ForbiddenException(v1Refusal);
    }
    this.policy.getPolicy(input.actionType);
    const riskLevel = this.policy.riskLevel(input.actionType);
    // KF-EXEC-ACTION-001: a proposal for a capability the action boundary has
    // adopted is that capability's action record, whoever produced it. It is
    // sealed here (real capability identity, frozen envelope, fingerprint) so
    // that an approval has something exact to name. No producer supplies a
    // trusted requester, so it can only ever be cleared by a human approval.
    const boundaryColumns = this.boundary.sealProposal(businessId, input, userId ?? null);
    const requiresApproval = boundaryColumns ? true : this.policy.requiresApproval(input.actionType);

    // FU-PROPOSAL-MONEY-TAG (V1-88, D-238, D-227): compute the authoritative structural
    // money tag before persisting. If the proposal references a genome recommendation,
    // verify its provenance in this business (fail closed when missing or financial).
    let recFinancial = false;
    if (input.carriesMoney !== true) {
      const recId = this.extractRecommendationId(input.payload, input.inputPayload);
      if (recId) {
        try {
          const rec = await this.prisma.client.genomeRecommendation?.findFirst({
            where: { id: recId, businessId },
            select: {
              domain: true,
              title: true,
              diagnosis: true,
              insight: true,
              recommendation: true,
              expectedGain: true,
            },
          });
          recFinancial = !rec || isFinanceRecommendation(rec as GenomeRowFields);
        } catch {
          recFinancial = true;
        }
      }
    }
    const carriesMoney = computeProposalCarriesMoney({
      ...input,
      carriesMoney: input.carriesMoney === true || recFinancial ? true : undefined,
    });

    const row = await this.prisma.client.keyActionProposal.create({
      data: {
        businessId,
        userId: userId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        sourceMode: input.sourceMode ?? null,
        title: input.title,
        summary: input.summary ?? null,
        rationale: input.rationale ?? null,
        evidence: (input.evidence ?? []) as Prisma.InputJsonValue,
        actionType: input.actionType,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        planId: input.planId ?? null,
        planStepId: input.planStepId ?? null,
        correlationId: input.correlationId ?? null,
        commandId: input.commandId ?? null,
        sessionId: input.sessionId ?? null,
        businessEventId: input.businessEventId ?? null,
        toolName: input.toolName ?? null,
        module: input.module ?? null,
        description: input.description ?? null,
        expectedBenefit: input.expectedBenefit ?? null,
        risks: input.risks ?? null,
        inputPayload: (input.inputPayload ?? undefined) as Prisma.InputJsonValue | undefined,
        affectedEntities: (input.affectedEntities ?? undefined) as Prisma.InputJsonValue | undefined,
        multiStepParentId: input.multiStepParentId ?? null,
        riskLevel,
        status: 'PENDING',
        requiresApproval,
        carriesMoney,
        ...(boundaryColumns ?? {}),
      },
    });

    await this.emitLifecycleEvent(businessId, row.id, input.actionType, 'key.action.proposed', 'NORMAL', {
      sourceType: input.sourceType,
      sourceMode: input.sourceMode,
      riskLevel,
      requiresApproval,
    });

    return this.serialize(row);
  }

  async list(
    businessId: string,
    query: ListKeyActionProposalsQuery = {},
  ): Promise<KeyActionProposalData[]> {
    const rows = await this.prisma.client.keyActionProposal.findMany({
      where: {
        businessId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.sourceType ? { sourceType: query.sourceType } : {}),
        ...(query.actionType ? { actionType: query.actionType } : {}),
        ...(query.createdAfter ? { createdAt: { gte: query.createdAfter } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.serialize(row));
  }

  /**
   * FU-PROPOSAL-REVENUE-SIGHT (owner ruling D-238; security review BLOCKING-1) &
   * W11-PROPOSAL-RESULT-READER-SCOPE (SEC-SR-2): the proposals a reader is served
   * over REST (GET actions/proposals, ai/approvals and its history).
   * - Without revenue read: financial proposals are omitted (isFinancialProposal
   *   + bridged recommendation provenance), and non-financial proposals have
   *   money failure/evidence blanked and finance-referencing `executionResult`
   *   withheld.
   * - For every returned proposal with a stored `executionResult`: the result is
   *   projected for the reader's module read rights (or run membership when the
   *   proposal's module is unclassified).
   */
  async listForReader(businessId: string, query: ListKeyActionProposalsQuery, reader: GenomeReader | null): Promise<KeyActionProposalData[]> {
    const [rows, access, graphActionReq] = await Promise.all([
      this.list(businessId, query),
      resolveProposalReaderAccess(this.prisma, businessId, reader ?? undefined),
      loadGraphActionRequirement(),
    ]);
    if (access.readsRevenue) {
      return rows.map((row) => projectExecutionResultForReader(row, access, false, graphActionReq));
    }
    // One query for the recommendations the rows were bridged from (round-4 correctness minor 5).
    const financial = await financialProposalsWithProvenance(this.prisma, businessId, rows as unknown as ProposalFields[]);
    const visible = rows.filter((_row, i) => !financial[i]).map((row) => nonFinancialProposalForReader(row));
    const refsFin = await executionResultsReferenceFinanceGenome(this.prisma, businessId, visible);
    return visible.map((row, i) => projectExecutionResultForReader(row, access, refsFin[i], graphActionReq));
  }

  /**
   * D-238 + W11-PROPOSAL-RESULT-READER-SCOPE (SEC-SR-2): a financial proposal
   * does not exist for a reader without revenue read (404), and any visible
   * proposal's stored `executionResult` is projected for the reader's scope.
   */
  async getForReader(businessId: string, proposalId: string, reader: GenomeReader | null): Promise<KeyActionProposalData> {
    const [proposal, access, graphActionReq] = await Promise.all([
      this.get(businessId, proposalId),
      resolveProposalReaderAccess(this.prisma, businessId, reader ?? undefined),
      loadGraphActionRequirement(),
    ]);
    if (access.readsRevenue) {
      return projectExecutionResultForReader(proposal, access, false, graphActionReq);
    }
    if (await this.isFinancial(businessId, proposal)) throw new NotFoundException('Action proposal not found');
    const safe = nonFinancialProposalForReader(proposal);
    const [refsFin] = await executionResultsReferenceFinanceGenome(this.prisma, businessId, [safe]);
    return projectExecutionResultForReader(safe, access, refsFin, graphActionReq);
  }

  /**
   * D-238 (round 3) + W11-PROPOSAL-RESULT-READER-SCOPE (SEC-SR-2): what an
   * action on a proposal (approve, reject, cancel, execute, a legacy resolve)
   * answers the actor. The action stays governed by the existing authority
   * (risk tiers, D-140, D-119); a reader without revenue read is answered a
   * financial proposal's redacted view, and any non-redacted proposal's stored
   * `executionResult` is projected for the reader's module scope.
   */
  async viewForReader<T extends KeyActionProposalData>(businessId: string, proposal: T, reader: GenomeReader | null): Promise<T | ReturnType<typeof redactedProposalView>> {
    if (!proposal || typeof proposal !== 'object' || typeof (proposal as { id?: unknown }).id !== 'string') return proposal;
    // The action has committed: a failed read answers the redacted view (fail closed), never an error for an action that
    // took effect (round-4 correctness minor 7).
    const [access, graphActionReq] = await Promise.all([
      resolveProposalReaderAccess(this.prisma, businessId, reader ?? undefined).catch(
        () => CLOSED_READER_ACCESS,
      ),
      loadGraphActionRequirement().catch(() => null),
    ]);
    if (!access.readsRevenue) {
      const financial = await this.isFinancial(businessId, proposal).catch(() => true);
      if (financial) return redactedProposalView(proposal);
    }
    const base = access.readsRevenue ? proposal : nonFinancialProposalForReader(proposal);
    if (!graphActionReq) {
      return access.isSuperAdmin || access.isUnscopedOwner
        ? base
        : { ...base, executionResult: null };
    }
    const [refsFin] = access.readsRevenue
      ? [false]
      : await executionResultsReferenceFinanceGenome(this.prisma, businessId, [base]).catch(() => [true]);
    return projectExecutionResultForReader(base, access, refsFin, graphActionReq);
  }

  /** D-238: whether a proposal of `businessId` is financial, by its own fields or the recommendation it was bridged from. */
  isFinancial(businessId: string, proposal: KeyActionProposalData): Promise<boolean> {
    return financialProposalWithProvenance(this.prisma, businessId, proposal as unknown as ProposalFields);
  }

  async get(businessId: string, proposalId: string): Promise<KeyActionProposalData> {
    const row = await this.prisma.client.keyActionProposal.findFirst({
      where: { id: proposalId, businessId },
    });
    if (!row) throw new NotFoundException('Action proposal not found');
    return this.serialize(row);
  }

  async getById(proposalId: string): Promise<KeyActionProposalData> {
    const row = await this.prisma.client.keyActionProposal.findUnique({
      where: { id: proposalId },
    });
    if (!row) throw new NotFoundException('Action proposal not found');
    return this.serialize(row);
  }

  async approve(
    businessId: string,
    proposalId: string,
    approvedBy?: string,
  ): Promise<KeyActionProposalData> {
    const existing = await this.get(businessId, proposalId);
    if (existing.status !== 'PENDING') {
      throw new NotFoundException('Proposal is not pending approval');
    }

    // KF-EXEC-ACTION-001: for an adopted capability an approval is control
    // evidence, not a status. The boundary binds it to the action fingerprint
    // and to this approver, whose authority it reads on locked rows; an
    // approval nobody can be named for is not one.
    let row;
    if (this.boundary.governs(existing)) {
      if (!approvedBy) throw new ForbiddenException('An authenticated approver is required for this action');
      row = await this.boundary.recordEvidence(businessId, proposalId, approvedBy);
    } else {
      // V1-32: the approval records the authority it was given under, so that
      // execution can tell an approver who has since been removed or
      // downgraded. The write is conditional on PENDING: an unconditional one
      // could put an executing proposal back to APPROVED and let it be claimed
      // a second time. It clears a failure reason left by an approval that
      // lapsed: the approval it described has been replaced by this one.
      const now = new Date();
      const authority = approvedBy
        ? await this.readApproverAuthority(this.prisma.client, businessId, approvedBy)
        : null;
      const recorded: RecordedApproval = {
        v: 1,
        kind: 'APPROVAL',
        approvedBy: approvedBy ?? null,
        authority: authority
          ? { basis: authority.basis, membershipId: authority.membershipId, approvalTier: authority.approvalTier }
          : null,
        at: now.toISOString(),
      };
      const { count } = await this.prisma.client.keyActionProposal.updateMany({
        where: { id: proposalId, businessId, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          approvedBy: approvedBy ?? null,
          approvedAt: now,
          failureReason: null,
          resolution: recorded as unknown as Prisma.InputJsonValue,
        },
      });
      if (count !== 1) throw new NotFoundException('Proposal is not pending approval');
      row = await this.prisma.client.keyActionProposal.findFirst({ where: { id: proposalId, businessId } });
    }

    await this.emitLifecycleEvent(
      businessId,
      proposalId,
      existing.actionType,
      'key.action.approved',
      'NORMAL',
      { approvedBy },
    );

    const proposal = this.serialize(row);
    this.events.emit('key.action.approved', {
      proposalId,
      businessId,
      proposal,
    });

    return proposal;
  }

  async reject(
    businessId: string,
    proposalId: string,
    rejectedBy?: string,
    reason?: string,
  ): Promise<KeyActionProposalData> {
    const existing = await this.get(businessId, proposalId);
    if (existing.status !== 'PENDING') {
      throw new NotFoundException('Proposal is not pending approval');
    }

    // For an adopted capability a rejection takes the action's execution
    // claim, so it cannot land beside an execution of the same action. For
    // any other proposal the write is conditional on the status just read
    // (V1-32, SEC-V32-1): a proposal approved again and claimed in between is
    // not overwritten.
    const reasonCarriesMoney = typeof reason === 'string' && structuralTextCarriesMoney(reason);
    const row = this.boundary.governs(existing)
      ? await this.boundary.voidAction(businessId, proposalId, 'REJECTED', rejectedBy ?? null, reason)
      : await this.writeIfStatus(businessId, proposalId, existing.status, {
          status: 'REJECTED',
          rejectedBy: rejectedBy ?? null,
          rejectedAt: new Date(),
          rejectionReason: reason ?? null,
          ...(reasonCarriesMoney ? { carriesMoney: true } : {}),
        });
    if (!row) throw new ConflictException('This proposal is no longer pending approval');

    await this.emitLifecycleEvent(
      businessId,
      proposalId,
      existing.actionType,
      'key.action.rejected',
      'NORMAL',
      { rejectedBy, reason },
    );

    const proposal = this.serialize(row);
    this.events.emit('key.action.rejected', {
      proposalId,
      businessId,
      proposal,
      reason,
    });

    return proposal;
  }

  async cancel(businessId: string, proposalId: string): Promise<KeyActionProposalData> {
    const existing = await this.get(businessId, proposalId);
    if (existing.status !== 'PENDING' && existing.status !== 'APPROVED') {
      throw new NotFoundException('Proposal cannot be cancelled');
    }

    // Conditional on the status just read (V1-32, SEC-V32-1): a cancel that
    // read APPROVED and lost the race to an execution's claim is refused, not
    // recorded over a proposal that is executing.
    const row = this.boundary.governs(existing)
      ? await this.boundary.voidAction(businessId, proposalId, 'CANCELLED', null)
      : await this.writeIfStatus(businessId, proposalId, existing.status, { status: 'CANCELLED' });
    if (!row) {
      throw new ConflictException(
        `This proposal is no longer ${existing.status.toLowerCase()}; it is being executed or has been resolved`,
      );
    }

    await this.emitLifecycleEvent(
      businessId,
      proposalId,
      existing.actionType,
      'key.action.cancelled',
      'NORMAL',
      { previousStatus: existing.status },
    );

    return this.serialize(row);
  }

  async execute(
    businessId: string,
    proposalId: string,
    executedBy?: string,
    confirm = false,
    confirmGenomeRisk = false,
  ): Promise<KeyActionProposalData> {
    const proposal = await this.get(businessId, proposalId);

    if (proposal.status !== 'APPROVED') {
      throw new NotFoundException('Proposal must be approved before execution');
    }

    if (!this.policy.isExecutable(proposal.actionType)) {
      throw new NotFoundException(`Action ${proposal.actionType} is not executable`);
    }

    const v1Refusal = v1ToolRefusalReasonForInvocation(proposal.toolName ?? proposal.actionType, proposal);
    if (v1Refusal) {
      throw new ForbiddenException(v1Refusal);
    }

    if ((proposal.riskLevel === 'HIGH' || proposal.riskLevel === 'CRITICAL') && !confirm) {
      throw new NotFoundException('High-risk action requires explicit confirmation');
    }

    // KF-EXEC-ACTION-001: an EXECUTE_TOOL proposal for an adopted capability
    // is governed as that capability. Evaluating the wrapper name here meant
    // the tool's own blocklist entry, module and tier were never consulted.
    const governed = this.boundary.governs(proposal);
    const actionKey = governed
      ? (this.boundary.resolveInvocation(proposal).toolName as string)
      : `key_autonomy.${proposal.actionType}`;
    const autonomyVerdict = await this.autonomyOrchestrator.evaluateAction(
      businessId,
      actionKey,
      (proposal.payload as Record<string, unknown>) ?? {},
      { proposedBy: executedBy, proposalId: proposal.id },
    );

    if (!autonomyVerdict.allowed) {
      if (await this.recordBlocked(businessId, proposalId, executedBy, autonomyVerdict.reason)) {
        await this.emitLifecycleEvent(
          businessId,
          proposalId,
          proposal.actionType,
          'key.action.blocked_by_autonomy',
          'HIGH',
          {
            executedBy,
            reason: autonomyVerdict.reason,
            ruleTrace: autonomyVerdict.ruleTrace,
          },
        );
      }

      throw new BadRequestException(autonomyVerdict.reason);
    }

    if (autonomyVerdict.requiresApproval && !confirm) {
      throw new BadRequestException(autonomyVerdict.reason);
    }

    const genomeDecision = await this.genomePolicy.evaluateExecution(businessId, proposal);

    if (!genomeDecision.allowed) {
      if (await this.recordBlocked(businessId, proposalId, executedBy, genomeDecision.message)) {
        await this.emitLifecycleEvent(
          businessId,
          proposalId,
          proposal.actionType,
          'key.action.blocked_by_genome',
          'HIGH',
          {
            executedBy,
            module: genomeDecision.module,
            readinessScore: genomeDecision.readinessScore,
            riskLevel: genomeDecision.riskLevel,
            blockedReasons: genomeDecision.blockedReasons,
            missingFacts: genomeDecision.missingFacts,
          },
        );
      }

      throw new BadRequestException(genomeDecision.message);
    }

    if (genomeDecision.requiresExtraConfirmation && !confirmGenomeRisk) {
      throw new BadRequestException(genomeDecision.message);
    }

    if (governed) {
      return this.executeThroughBoundary(businessId, proposal, executedBy);
    }

    // V1-32 (M46): the claim. Only the execute that wins it goes on to the
    // executor; every other one is refused here, before it emits or runs.
    await this.claimForExecution(businessId, proposal, executedBy);

    if (genomeDecision.requiresExtraConfirmation) {
      await this.emitLifecycleEvent(
        businessId,
        proposalId,
        proposal.actionType,
        'key.action.genome_risk_confirmed',
        'NORMAL',
        {
          executedBy,
          module: genomeDecision.module,
          readinessScore: genomeDecision.readinessScore,
          riskLevel: genomeDecision.riskLevel,
        },
      );
    }

    await this.emitLifecycleEvent(
      businessId,
      proposalId,
      proposal.actionType,
      'key.action.executing',
      'NORMAL',
      { executedBy },
    );

    const outcome = await this.executor.execute(businessId, proposal, executedBy);

    if (outcome.success) {
      const { row, recorded } = await this.recordOutcome(businessId, proposalId, {
        status: 'EXECUTED',
        executedBy: executedBy ?? null,
        executedAt: new Date(),
        executionResult: outcome.result as Prisma.InputJsonValue,
        // As the action boundary's EXECUTED write does: no failure reason
        // survives a successful execution.
        failureReason: null,
      });

      await this.emitLifecycleEvent(
        businessId,
        proposalId,
        proposal.actionType,
        'key.action.executed',
        'HIGH',
        { executedBy, executionResult: outcome.result, ...(recorded ? {} : { outcomeRecorded: false }) },
      );

      return this.serialize(row);
    }

    const { row, recorded } = await this.recordOutcome(businessId, proposalId, {
      status: 'FAILED',
      executedBy: executedBy ?? null,
      executedAt: new Date(),
      failureReason: outcome.error ?? 'Execution failed',
    });

    await this.emitLifecycleEvent(
      businessId,
      proposalId,
      proposal.actionType,
      'key.action.failed',
      'HIGH',
      { executedBy, failureReason: outcome.error, ...(recorded ? {} : { outcomeRecorded: false }) },
    );

    return this.serialize(row);
  }

  /**
   * V1-32 (SEC-V32-1): a write conditional on the status the caller decided
   * on. The row it wrote, or null when the proposal had moved on.
   */
  private async writeIfStatus(
    businessId: string,
    proposalId: string,
    status: string,
    data: Prisma.KeyActionProposalUpdateManyMutationInput,
  ) {
    const { count } = await this.prisma.client.keyActionProposal.updateMany({
      where: { id: proposalId, businessId, status },
      data,
    });
    if (count !== 1) return null;
    return this.prisma.client.keyActionProposal.findFirst({ where: { id: proposalId, businessId } });
  }

  /**
   * V1-32 (SEC-V32-1): an execution's outcome, written only over its own claim
   * (status EXECUTING). Nothing in this service moves a claimed proposal on;
   * if something else has, the status it was moved to stands, and the outcome
   * is reported by the lifecycle event and the log, not written over it.
   */
  private async recordOutcome(
    businessId: string,
    proposalId: string,
    data: Prisma.KeyActionProposalUpdateManyMutationInput & { status: 'EXECUTED' | 'FAILED' },
  ) {
    const resultCarriesMoney =
      data.executionResult !== undefined &&
      data.executionResult !== null &&
      structuredPayloadCarriesMoney(data.executionResult);
    const writeData = resultCarriesMoney ? { ...data, carriesMoney: true } : data;
    const written = await this.writeIfStatus(businessId, proposalId, 'EXECUTING', writeData);
    if (written) return { row: written, recorded: true };
    const current = await this.prisma.client.keyActionProposal.findFirst({ where: { id: proposalId, businessId } });
    if (!current) throw new NotFoundException('Action proposal not found');
    this.logger.error(
      `[execute] proposal ${proposalId} was moved from EXECUTING to ${current.status} while it ran; ` +
        `its ${data.status} outcome was not written over that`,
    );
    return { row: current, recorded: false };
  }

  /**
   * V1-32 (M46, CF-29, KEY-PROPOSAL-CLAIM-001). The EXECUTING write is the
   * execution claim: one conditional write (updateMany on {id, businessId,
   * status 'APPROVED'}) that only one caller can win (count === 1). The status
   * check in `execute` was a separate read, so two concurrent executes both
   * passed it and both ran the executor; a proposal cancelled after that read
   * ran anyway.
   *
   * In the same transaction, before the claim, the approver is re-read on
   * locked rows (FOR SHARE, as the action boundary's readFresh does): a
   * revocation that has committed is what the read returns, and one that has
   * not waits for the claim. An approver who no longer has authority in the
   * business, or whose authority is less than the one recorded when they
   * approved, means the approval no longer stands. The proposal goes back to
   * PENDING with the reason, as the boundary does for a revoked or changed
   * evidence principal, so someone who holds the authority can approve again.
   */
  private async claimForExecution(
    businessId: string,
    proposal: KeyActionProposalData,
    executedBy?: string,
  ): Promise<void> {
    const proposalId = proposal.id;
    const outcome: ClaimOutcome = await this.prisma.client.$transaction(async (tx) => {
      const current = await tx.keyActionProposal.findFirst({
        where: { id: proposalId, businessId },
        select: { status: true, approvedBy: true, resolution: true },
      });
      if (!current || current.status !== 'APPROVED') return { kind: 'conflict' };

      // Conditional on the approval just checked, as well as on the status.
      const sameApproval = { id: proposalId, businessId, status: 'APPROVED', approvedBy: current.approvedBy };

      const lapse = await this.approvalLapse(tx, businessId, current.approvedBy, current.resolution);
      if (lapse) {
        const { count } = await tx.keyActionProposal.updateMany({
          where: sameApproval,
          data: {
            status: 'PENDING',
            approvedBy: null,
            approvedAt: null,
            failureReason: lapse,
            resolution: {
              v: 1,
              kind: 'APPROVAL_LAPSED',
              approvedBy: current.approvedBy,
              reason: lapse,
              at: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        return { kind: 'lapsed', reason: lapse, approvedBy: current.approvedBy, recorded: count === 1 };
      }

      const { count } = await tx.keyActionProposal.updateMany({
        where: sameApproval,
        data: { status: 'EXECUTING', executedBy: executedBy ?? null },
      });
      return count === 1 ? { kind: 'claimed' } : { kind: 'conflict' };
    });

    if (outcome.kind === 'claimed') return;
    if (outcome.kind === 'conflict') {
      throw new ConflictException('This proposal is already being executed or is no longer approved');
    }
    if (outcome.recorded) {
      await this.emitLifecycleEvent(businessId, proposalId, proposal.actionType, 'key.action.approval_lapsed', 'HIGH', {
        executedBy,
        approvedBy: outcome.approvedBy,
        reason: outcome.reason,
      });
    }
    throw new ForbiddenException(`${outcome.reason}; it needs to be approved again before it can be executed`);
  }

  /** Why the approval on record no longer stands, or null when it does. */
  private async approvalLapse(
    tx: ProposalTx,
    businessId: string,
    approvedBy: string | null,
    resolution: unknown,
  ): Promise<string | null> {
    if (!approvedBy) return 'The approval on record names no approver';

    await tx.$queryRaw`SELECT id FROM users WHERE id = ${approvedBy} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM memberships WHERE user_id = ${approvedBy} AND business_id = ${businessId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR SHARE`;
    const now = await this.readApproverAuthority(tx, businessId, approvedBy);

    if (now.basis === 'none') return 'The approver of this proposal no longer has authority in this business';
    // An approval recorded before V1-32 carries no authority: it is held to
    // the rule above only.
    const given = recordedAuthority(resolution, approvedBy);
    if (
      given &&
      (now.basis !== given.basis || now.membershipId !== given.membershipId || now.approvalTier < given.approvalTier)
    ) {
      return 'The authority of the approver of this proposal has changed since they approved it';
    }
    return null;
  }

  /**
   * The approver's authority, by the rule the action boundary applies to an
   * evidence giver (resolvePrincipalAuthority: SUPER_ADMIN, or a Membership
   * with its approval tier). The recorded owner field grants nothing on its
   * own (owner rulings D-104, D-125, W11-ACTION-BOUNDARY-OWNER-ARM): an
   * approval recorded under the retired 'owner_without_membership' basis
   * lapses here, because its approver now resolves to 'none'.
   */
  private async readApproverAuthority(
    client: AuthorityReader,
    businessId: string,
    userId: string,
  ): Promise<PrincipalAuthority> {
    const [user, business, membership] = await Promise.all([
      client.user.findUnique({ where: { id: userId }, select: { role: true, deletedAt: true, bannedAt: true } }),
      client.business.findFirst({ where: { id: businessId }, select: { ownerId: true } }),
      client.membership.findUnique({
        where: { userId_businessId: { userId, businessId } },
        select: { id: true, role: true, maxApprovalTier: true, permissionScopes: true },
      }),
    ]);
    return resolvePrincipalAuthority({ userId, user, business, membership });
  }

  /**
   * A refusal recorded on a proposal that is still APPROVED. Conditional, so
   * it cannot overwrite a concurrent execution that has claimed the proposal.
   */
  private async recordBlocked(
    businessId: string,
    proposalId: string,
    executedBy: string | undefined,
    reason: string,
  ): Promise<boolean> {
    const { count } = await this.prisma.client.keyActionProposal.updateMany({
      where: { id: proposalId, businessId, status: 'APPROVED' },
      data: {
        status: 'BLOCKED',
        executedBy: executedBy ?? null,
        executedAt: new Date(),
        failureReason: reason,
      },
    });
    return count === 1;
  }

  /**
   * Execute an adopted capability's proposal. There is no EXECUTING write and
   * no executor plugin: the boundary's claim transaction admits the action,
   * writes the effect and records the outcome, or refuses and writes nothing.
   */
  private async executeThroughBoundary(
    businessId: string,
    proposal: KeyActionProposalData,
    executedBy?: string,
  ): Promise<KeyActionProposalData> {
    await this.emitLifecycleEvent(businessId, proposal.id, proposal.actionType, 'key.action.executing', 'NORMAL', {
      executedBy,
    });

    try {
      await this.boundary.admit(businessId, proposal.id, { executedBy: executedBy ?? null, log: true });
    } catch (err: unknown) {
      if (!(err instanceof ActionNotClearedError)) throw err;
      await this.emitLifecycleEvent(businessId, proposal.id, proposal.actionType, 'key.action.failed', 'HIGH', {
        executedBy,
        failureReason: err.message,
        code: err.code,
      });
      throw new BadRequestException(err.message);
    }

    const executed = await this.get(businessId, proposal.id);
    await this.emitLifecycleEvent(businessId, proposal.id, proposal.actionType, 'key.action.executed', 'HIGH', {
      executedBy,
      executionResult: executed.executionResult,
    });
    return executed;
  }

  private async emitLifecycleEvent(
    businessId: string,
    proposalId: string,
    actionType: KeyExecutableActionType,
    type: string,
    importance: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL',
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.temporal
      .emit({
        businessId,
        source: 'KEY',
        type,
        module: 'key-autonomy',
        entityType: 'key_action_proposal',
        entityId: proposalId,
        title: `KEY action ${type.replace('key.action.', '')}`,
        summary: `Action ${actionType}`,
        importance,
        payload: { actionType, ...payload },
      })
      .catch((err) => this.logger.warn(`Temporal emit failed: ${(err as Error).message}`));
  }

  private serialize(row: any): KeyActionProposalData {
    return {
      id: row.id,
      businessId: row.businessId,
      userId: row.userId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceMode: row.sourceMode,
      title: row.title,
      summary: row.summary,
      rationale: row.rationale,
      evidence: (row.evidence ?? []) as string[],
      actionType: row.actionType as KeyExecutableActionType,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      planId: row.planId,
      planStepId: row.planStepId,
      correlationId: row.correlationId,
      commandId: row.commandId,
      sessionId: row.sessionId,
      businessEventId: row.businessEventId,
      toolName: row.toolName,
      module: row.module,
      description: row.description,
      expectedBenefit: row.expectedBenefit,
      risks: row.risks,
      inputPayload: (row.inputPayload ?? null) as Record<string, unknown> | null,
      affectedEntities: (row.affectedEntities ?? null) as Record<string, unknown> | null,
      multiStepParentId: row.multiStepParentId,
      riskLevel: row.riskLevel,
      status: row.status as KeyActionProposalStatus,
      requiresApproval: row.requiresApproval,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt?.toISOString(),
      rejectedBy: row.rejectedBy,
      rejectedAt: row.rejectedAt?.toISOString(),
      rejectionReason: row.rejectionReason,
      executedBy: row.executedBy,
      executedAt: row.executedAt?.toISOString(),
      executionResult: (row.executionResult ?? null) as Record<string, unknown> | null,
      failureReason: row.failureReason,
      capabilityName: row.capabilityName ?? null,
      capabilityVersion: row.capabilityVersion ?? null,
      executionSurface: row.executionSurface ?? null,
      actionFingerprint: row.actionFingerprint ?? null,
      controlRequirement: (row.controlRequirement ?? null) as Record<string, unknown> | null,
      evidenceExpiresAt: row.evidenceExpiresAt?.toISOString() ?? null,
      requestedBy: row.requestedBy ?? null,
      proposedBy: row.proposedBy ?? null,
      executedFor: row.executedFor ?? null,
      outcomeEvidence: (row.outcomeEvidence ?? null) as Record<string, unknown> | null,
      carriesMoney: typeof row.carriesMoney === 'boolean' ? row.carriesMoney : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private extractRecommendationId(payload: unknown, inputPayload: unknown): string | null {
    for (const source of [payload, inputPayload]) {
      if (source && typeof source === 'object' && !Array.isArray(source)) {
        const id = (source as Record<string, unknown>).recommendationId;
        if (typeof id === 'string' && id.trim()) return id.trim();
      }
    }
    return null;
  }
}
