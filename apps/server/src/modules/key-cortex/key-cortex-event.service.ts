import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  filterOutSecretRows,
  getMemoryClassReadMode,
  projectBusinessEventRowsForReader,
  type MemoryReaderContext,
} from './memory-class-read-projection';
import { withoutForgottenPersonalData } from '../business-events/business-event.service';
import { BusinessEvent, BusinessEventType, Prisma } from '@prisma/client';

/**
 * FU-KEY-EVENT-COLUMNS (V1-71, owner ruling D-220): the `source` of every business_events row KEY's event writer
 * writes. It tells KEY's own observations (its decision logs, process logs, alerts, calibration history and cortex
 * claims) from every other writer's row: the readers below read only these, and the prompt's business memory
 * (UnifiedMemoryRetrievalService) leaves them out. No other writer uses it (the analytics adapter's `track` rows are
 * source 'key_cortex', the bus's 'key_cortex_event_bus').
 */
export const KEY_OBSERVATION_SOURCE = 'key_observation';

/**
 * A KEY observation that cannot be kept, or a read that names no business. Thrown before any query, so a write with
 * no business (the reasoning and query pipelines' step logs carry none) or no known event type never reaches the
 * client. The message never quotes the payload.
 */
export class KeyObservationRefusedError extends Error {
  constructor(reason: string) {
    super(`A KEY observation is not kept: ${reason}.`);
    this.name = 'KeyObservationRefusedError';
  }
}

/**
 * FU-KEY-EVENT-COLUMNS: the metadata fields a KEY observation keeps. Each names a number, a flag, a closed-vocabulary
 * token (a capability, a result, a severity, a mode) or an id; none names free text. What a caller sends under any
 * other key (a decision's or an insight's wording, an alert's text, a description, a rationale, a message, a reason,
 * a recipient, an error, a matched entity, a user id) is withheld and named in `withheld`: KEY's conclusions quote the
 * business's customers and figures, and a member's message is theirs (SEC-W11FPS-1), so neither is kept here.
 */
const OBSERVATION_FIELDS: ReadonlySet<string> = new Set([
  // what the observation is about
  'module', 'capability', 'category', 'section', 'kind', 'claimKind', 'claimType', 'decisionKind', 'actionType',
  'patternType', 'matchedEntityType', 'sourceModule', 'sourceEntityType', 'reasoningMode', 'layersUsed',
  'dnaSections', 'actionsTaken', 'errorReason', 'dataType', 'timeHorizon', 'trend',
  // outcomes and flags
  'result', 'status', 'severity', 'acted', 'read', 'approvalRequired', 'requiresApproval', 'ethicalPermitted',
  'genomeSignal',
  // figures about KEY itself (never a business figure)
  'confidence', 'riskScore', 'evidenceStrength', 'rating', 'acceptanceRate', 'interactionCount', 'previousScore',
  'newScore', 'score', 'genomeImpact', 'executionTimeMs', 'reasoningTimeMs', 'syncDurationMs', 'tokensUsed', 'cost',
  'actionCount', 'dnaSectionsUpdated', 'signalsCreated', 'outcomesFed', 'adaptationsMade',
  // ids
  'signalId', 'patternId', 'proposalId', 'actionId', 'parentEventId',
  // nested objects, kept by the same rules
  'parameters', 'details', 'estimatedImpact',
]);

/**
 * FU-KEY-EVENT-COLUMNS review (KEC-COR-1): fields kept only as a single value (a token, number or flag). An action's
 * `result` or `status` is an outcome ('success', 'pending_approval'); an object or list under either is the tool's
 * data, withheld whole. Kept by the nested rules, it kept the parts whose keys KEY uses for its own figures (a tool
 * answering `{ status, cost }` kept the business's cost).
 */
const SCALAR_FIELDS: ReadonlySet<string> = new Set(['result', 'status']);

/**
 * What became of an action KEY reports (FU-KEY-EVENT-COLUMNS review, KEC-COR-1): it ran and worked ('success'), failed
 * ('error') or partly worked ('partial'); or it never ran because it waits for the owner's approval
 * ('pending_approval'), was blocked ('blocked') or was skipped ('skipped').
 */
export type KeyActionResult = 'success' | 'error' | 'partial' | 'pending_approval' | 'blocked' | 'skipped';

/** The callers' status words, by the result KEY keeps (CortexActionResult's, the interaction and evolution services'). */
const ACTION_RESULTS: Readonly<Record<string, KeyActionResult>> = {
  success: 'success',
  error: 'error',
  failure: 'error',
  failed: 'error',
  partial: 'partial',
  pending_approval: 'pending_approval',
  blocked: 'blocked',
  skipped: 'skipped',
};

/** The result KEY keeps for a caller's status word, or undefined when it is not one. */
export function actionResultOf(status: unknown): KeyActionResult | undefined {
  return typeof status === 'string' && Object.prototype.hasOwnProperty.call(ACTION_RESULTS, status)
    ? ACTION_RESULTS[status]
    : undefined;
}

/**
 * The results of an action that ran: the only rows an action success rate counts. An action waiting for approval,
 * blocked or skipped never ran, and a cortex claim about an action is not another run of it. 'failure' is a
 * capability claim's word for a failed run (KeyCortexMetacognitionService.trackCapability).
 */
export const EXECUTED_ACTION_RESULTS: ReadonlySet<string> = new Set(['success', 'error', 'failure', 'partial']);

/** A short closed-vocabulary token or id: a letter first, then letters, digits, '_', '-', '.', ':'; at most 64. */
const TOKEN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
/** A column id (correlation, session): a letter or digit first; at most 128. */
const COLUMN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
/**
 * Token-shaped secrets, refused even where a token is allowed: provider keys (Stripe, GitHub, AWS, Slack, OpenAI,
 * Anthropic, Twilio), a JWT, a PEM header, a long run of hex, and a long run that mixes digits with upper- and
 * lower-case letters the way an encoded key does (an identifier such as 'conscious_process_complete' does not).
 */
const SECRET_SHAPES: readonly RegExp[] = [
  /^(sk|pk|rk)_(live|test)_/i,
  /^(ghp|gho|ghu|ghs|ghr|github_pat)_/i,
  /^AKIA[0-9A-Z]{8,}/,
  /^xox[abprs]-/i,
  /^sk-(ant-|proj-)?[A-Za-z0-9]/,
  /^AC[0-9a-fA-F]{32}$/,
  /^SK[0-9a-fA-F]{32}$/,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /[0-9a-fA-F]{32,}/,
];
const ENCODED_RUN = /[A-Za-z0-9+/=_-]{32,}/g;

function looksSecret(value: string): boolean {
  if (SECRET_SHAPES.some((shape) => shape.test(value))) return true;
  return (value.match(ENCODED_RUN) ?? []).some((run) => /\d/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run));
}
const MAX_ARRAY = 20;
const MAX_DEPTH = 2;
const MAX_READ = 1000;

type Kept = number | boolean | null | string | Kept[] | { [key: string]: Kept };

function isToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value) && !looksSecret(value);
}

function columnId(value: unknown): string | null {
  return typeof value === 'string' && COLUMN_ID.test(value) && !looksSecret(value) ? value : null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** One allowed field's value, or undefined when nothing of it may be kept (the path is then withheld). */
function keepValue(value: unknown, path: string, depth: number, withheld: string[]): Kept | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (isToken(value)) return value;
  if (Array.isArray(value)) {
    const kept: Kept[] = [];
    value.slice(0, MAX_ARRAY).forEach((item, index) => {
      const k = typeof item === 'number' || typeof item === 'boolean' || isToken(item) ? keepValue(item, '', depth, withheld) : undefined;
      if (k === undefined) withheld.push(`${path}[${index}]`);
      else kept.push(k);
    });
    if (value.length > MAX_ARRAY) withheld.push(`${path}[${MAX_ARRAY}..]`);
    return kept;
  }
  if (isPlainObject(value) && depth < MAX_DEPTH) {
    const nested = keepFields(value, `${path}.`, depth + 1, withheld);
    return Object.keys(nested).length ? nested : undefined;
  }
  return undefined;
}

/** The allowed fields of `payload`, their values kept by keepValue; every other key's path is added to `withheld`. */
function keepFields(payload: Record<string, unknown>, prefix: string, depth: number, withheld: string[]): Record<string, Kept> {
  const kept: Record<string, Kept> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    const path = `${prefix}${TOKEN.test(key) ? key : '<key>'}`;
    if (!OBSERVATION_FIELDS.has(key) || (SCALAR_FIELDS.has(key) && (Array.isArray(value) || isPlainObject(value)))) {
      withheld.push(path);
      continue;
    }
    const k = keepValue(value, path, depth, withheld);
    if (k === undefined) {
      // An emptied nested object names only what it withheld inside it.
      if (!(isPlainObject(value) && depth < MAX_DEPTH)) withheld.push(path);
      continue;
    }
    kept[key] = k;
  }
  return kept;
}

/**
 * FU-KEY-EVENT-COLUMNS: what a KEY observation keeps in business_events.metadata: its module, the allowed fields of its
 * payload (OBSERVATION_FIELDS, values by keepValue), its genome flags, and the sorted names of what it withheld. No
 * free text, no personal data, no secret.
 */
export function observationMetadata(
  module: string,
  payload: Record<string, unknown> | undefined,
  extra: Record<string, unknown> = {},
): Record<string, Kept> {
  const withheld: string[] = [];
  const kept = keepFields({ ...(isPlainObject(payload) ? payload : {}), ...extra }, '', 0, withheld);
  const metadata: Record<string, Kept> = { ...kept, module: isToken(module) ? module : 'key_cortex' };
  if (withheld.length) metadata.withheld = [...new Set(withheld)].sort();
  return metadata;
}

/** The claim kinds KEY records (D-220), by the business_events type each is kept under. */
const CLAIM_EVENT_TYPES: Readonly<Record<string, BusinessEventType>> = {
  capability: BusinessEventType.ACTION_EXECUTED,
  action_outcome: BusinessEventType.ACTION_EXECUTED,
  cortex_action: BusinessEventType.ACTION_EXECUTED,
  pattern_detection: BusinessEventType.INSIGHT_GENERATED,
  user_feedback_positive: BusinessEventType.USER_INTERACTION,
  dna_influence_proposal: BusinessEventType.GENOME_EVOLUTION,
};

const EVENT_TYPES: ReadonlySet<string> = new Set(Object.values(BusinessEventType));

export interface KeyObservation {
  businessId: string;
  type: BusinessEventType;
  /** The KEY module or business module the observation concerns (metadata.module). */
  module: string;
  /** The organ that observed it (actor_id), e.g. 'metacognition', 'ethics', 'consciousness_orchestrator'. */
  source: string;
  action: string;
  /** Kept by observationMetadata: allowed fields only, free text withheld by name. */
  payload: Record<string, unknown>;
  /** What the observation is about (subject_type / subject_id); KEY itself ('key_cortex' / the module) by default. */
  subject?: { type: string; id: string };
  genomeSignal?: boolean;
  genomeImpact?: number;
  /** Not a business_events column, and not kept: an observation is KEY's, not the member's. */
  userId?: string;
  sessionId?: string;
  correlationId?: string;
  parentEventId?: string;
}

export interface KeyCortexClaim {
  /** pattern_detection, action_outcome, capability, ... (metadata.claimKind; the event type by CLAIM_EVENT_TYPES). */
  kind: string;
  /** The organ that makes the claim (actor_id). */
  source?: string;
  action?: string;
  module?: string;
  subject?: { type: string; id: string };
  /** Kept by observationMetadata. */
  details?: Record<string, unknown>;
  sessionId?: string;
  correlationId?: string;
}

export interface KeyObservationFilters {
  type?: BusinessEventType;
  module?: string;
  /** The organ that observed it (actor_id). */
  source?: string;
  /** What the observation is about (subject_type / subject_id). */
  subject?: { type: string; id: string };
  startDate?: Date;
  endDate?: Date;
  genomeSignal?: boolean;
  limit?: number;
  offset?: number;
}

function requireBusiness(businessId: unknown): string {
  if (typeof businessId !== 'string' || !businessId.trim() || businessId === 'system') {
    throw new KeyObservationRefusedError('it names no business');
  }
  return businessId;
}

/**
 * KeyCortexEventService — KEY's own observations, kept in business_events (owner ruling D-220).
 *
 * Every decision, insight, alert, autonomy exercise, process log and cortex claim a KEY organ records is one
 * business_events row of the business it concerns, on the table's real columns (FU-KEY-EVENT-COLUMNS):
 *   event_type      the BusinessEventType (refused before any query when it is not one)
 *   subject_*       what it is about: a capability, a pattern, a cortex action; KEY itself ('key_cortex' / module)
 *   actor_type/id   'ai' / the organ that observed it ('metacognition', 'ethics', 'consciousness_orchestrator', ...)
 *   action          what happened ('decision', 'capability_tracked', 'claim_recorded', ...)
 *   source          KEY_OBSERVATION_SOURCE, so KEY's readers read only these rows
 *   metadata        observationMetadata: the module, allowed fields with numbers, flags and tokens, the genome flags,
 *                   and the names of what was withheld; never free text, personal data or a secret
 *   session_id, correlation_id   when given as ids
 * This writer used to send `type`, `module`, `payload`, `genomeSignal`, `genomeImpact`, `userId` and `parentEventId`,
 * none of which the table has, so the real client refused every observation, and its readers filtered on the same
 * missing columns (review UCS-COR-3; W1F-KEY-EVIDENCE-WRITE made those failures survivable, this keeps them).
 * Every reader is business-scoped and reads only KEY's observations of that business.
 */
@Injectable()
export class KeyCortexEventService {
  private readonly logger = new Logger(KeyCortexEventService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Keep one KEY observation: one business_events row of `businessId`, on the real columns. Refused by name, before
   * any query, when it names no business or no BusinessEventType.
   */
  async logEvent(params: KeyObservation): Promise<BusinessEvent> {
    const businessId = requireBusiness(params?.businessId);
    if (!EVENT_TYPES.has(params.type as string)) {
      throw new KeyObservationRefusedError('its event type is not a BusinessEventType');
    }
    const module = isToken(params.module) ? params.module : 'key_cortex';
    const subject =
      params.subject && isToken(params.subject.type) && columnId(params.subject.id)
        ? params.subject
        : { type: 'key_cortex', id: module };
    const genome: Record<string, unknown> = {};
    if (params.genomeSignal !== undefined) genome.genomeSignal = params.genomeSignal;
    if (params.genomeImpact !== undefined) genome.genomeImpact = params.genomeImpact;
    if (params.parentEventId !== undefined) genome.parentEventId = params.parentEventId;
    const metadata = observationMetadata(module, params.payload, genome);
    const action = isToken(params.action) ? params.action : 'observation';

    // Codex #226 census: the subject is a token the caller names, so it can be
    // a contact; an observation about a forgotten one keeps no fields (the same
    // write-time erasure check as BusinessEventService.emit).
    const checked = await withoutForgottenPersonalData(this.prisma.client, {
      businessId,
      eventType: params.type,
      subjectType: subject.type,
      subjectId: subject.id,
      metadata: metadata as unknown,
    });
    const event = await this.prisma.client.businessEvent.create({
      data: {
        businessId,
        eventType: params.type,
        subjectType: subject.type,
        subjectId: subject.id,
        actorType: 'ai',
        actorId: isToken(params.source) ? params.source : 'key_cortex',
        action,
        source: KEY_OBSERVATION_SOURCE,
        metadata: (checked.metadata ?? {}) as Prisma.InputJsonValue,
        sessionId: columnId(params.sessionId),
        correlationId: columnId(params.correlationId),
      },
    });
    this.logger.debug(`[Event] ${event.actorId}/${module}: ${action} (${params.type})`);
    return event;
  }

  /**
   * D-220: keep one of KEY's cortex claims (capability tracking, pattern detection, action outcomes, ...) as a KEY
   * observation. The `evidence` table is the business's proof list and refuses them
   * (KeyCortexEvidenceService.createEvidence); this is where they are kept.
   */
  async recordClaim(businessId: string, claim: KeyCortexClaim): Promise<BusinessEvent> {
    const kind = isToken(claim?.kind) ? claim.kind : 'cortex_claim';
    return this.logEvent({
      businessId,
      type: CLAIM_EVENT_TYPES[kind] ?? BusinessEventType.SYSTEM_EVENT,
      module: claim.module ?? 'key_cortex',
      source: claim.source ?? 'key_cortex',
      action: claim.action ?? 'claim_recorded',
      subject: claim.subject ?? { type: 'key_claim', id: kind },
      payload: { claimKind: kind, ...(claim.details ?? {}) },
      sessionId: claim.sessionId,
      correlationId: claim.correlationId,
    });
  }

  /**
   * Gateway-compatible alias: a named event, fire-and-forget. Kept as a SYSTEM_EVENT of the payload's business; with
   * no business it is not kept (and no write is attempted). The payload's message, user and timestamp are not kept.
   */
  emit(eventName: string, payload: Record<string, unknown>): void {
    const businessId = payload?.businessId;
    if (typeof businessId !== 'string' || !businessId.trim()) {
      this.logger.debug(`[Event] ${isToken(eventName) ? eventName : 'event'} not kept: it names no business`);
      return;
    }
    const rest = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'businessId'));
    this.logEvent({
      businessId,
      type: BusinessEventType.SYSTEM_EVENT,
      module: 'gateway',
      source: 'gateway',
      action: eventName,
      payload: rest,
    }).catch((err: Error) => this.logger.warn(`Emit failed: ${err.message}`));
  }

  /**
   * Log an action execution — the most common event type.
   * Captures parameters, result, and execution time for performance tracking. `result` is what became of the action
   * (KeyActionResult): an action that waits for approval, was blocked or was skipped is kept as that, not as a failure.
   */
  async logActionExecuted(
    businessId: string,
    params: {
      module: string;
      source: string;
      action: string;
      parameters: Record<string, unknown>;
      result: KeyActionResult;
      executionTimeMs: number;
      correlationId?: string;
      userId?: string;
    },
  ): Promise<BusinessEvent> {
    return this.logEvent({
      businessId,
      type: BusinessEventType.ACTION_EXECUTED,
      module: params.module,
      source: params.source,
      action: params.action,
      payload: {
        parameters: params.parameters,
        result: params.result,
        executionTimeMs: params.executionTimeMs,
      },
      correlationId: params.correlationId,
    });
  }

  /**
   * Log a decision made by KEY Cortex, autopilot, or the delegation loop.
   * Decisions are always marked as genome signals since they represent
   * autonomous reasoning that should influence DNA evolution. The decision's
   * wording and rationale are withheld (they quote the business's customers and
   * figures); its kind, the token before ':' ('ethical_evaluation'), is kept.
   */
  async logDecision(
    businessId: string,
    params: {
      decision: string;
      rationale: string;
      confidence: number;
      source: string;
      correlationId?: string;
      genomeSignal?: boolean;
    },
  ): Promise<BusinessEvent> {
    const decisionKind = typeof params.decision === 'string' ? params.decision.split(':')[0] : undefined;
    return this.logEvent({
      businessId,
      type: BusinessEventType.DECISION_MADE,
      module: 'key_cortex',
      source: params.source,
      action: 'decision',
      payload: {
        decision: params.decision,
        rationale: params.rationale,
        confidence: params.confidence,
        ...(isToken(decisionKind) ? { decisionKind } : {}),
      },
      correlationId: params.correlationId,
      genomeSignal: params.genomeSignal ?? true,
    });
  }

  /**
   * Log a recommendation — either offered to the user or acted upon.
   * When acted=true, the event type becomes RECOMMENDATION_ACTED which
   * is a strong positive signal for genome evolution.
   */
  async logRecommendation(
    businessId: string,
    params: {
      recommendation: string;
      category: string;
      confidence: number;
      estimatedImpact?: Record<string, unknown>;
      acted?: boolean;
      correlationId?: string;
      userId?: string;
    },
  ): Promise<BusinessEvent> {
    return this.logEvent({
      businessId,
      type: params.acted
        ? BusinessEventType.RECOMMENDATION_ACTED
        : BusinessEventType.RECOMMENDATION_OFFERED,
      module: 'key_cortex',
      source: 'key_cortex',
      action: 'recommend',
      payload: {
        recommendation: params.recommendation,
        category: params.category,
        confidence: params.confidence,
        estimatedImpact: params.estimatedImpact,
        acted: params.acted ?? false,
      },
      correlationId: params.correlationId,
    });
  }

  /**
   * Log an insight generated by the KEY Cortex insight engine.
   * Insights are genome signals because they represent new understanding
   * about the business that should influence DNA scores.
   */
  async logInsight(
    businessId: string,
    params: {
      insight: string;
      category: string;
      confidence: number;
      details?: Record<string, unknown>;
      correlationId?: string;
    },
  ): Promise<BusinessEvent> {
    return this.logEvent({
      businessId,
      type: BusinessEventType.INSIGHT_GENERATED,
      module: 'key_cortex',
      source: 'key_cortex',
      action: 'insight',
      payload: {
        insight: params.insight,
        category: params.category,
        confidence: params.confidence,
        details: params.details,
      },
      correlationId: params.correlationId,
      genomeSignal: true,
    });
  }

  /**
   * Log an alert triggered by the system, autopilot monitor, or governance. `subject` names what it is about (a
   * signal, a churn risk), so a caller can tell an alert already raised for it (getEvents' `subject` filter).
   */
  async logAlert(
    businessId: string,
    params: {
      alert: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      module: string;
      source: string;
      details?: Record<string, unknown>;
      correlationId?: string;
      subject?: { type: string; id: string };
    },
  ): Promise<BusinessEvent> {
    return this.logEvent({
      businessId,
      type: BusinessEventType.ALERT_TRIGGERED,
      module: params.module,
      source: params.source,
      action: 'alert',
      subject: params.subject,
      payload: {
        alert: params.alert,
        severity: params.severity,
        details: params.details,
      },
      correlationId: params.correlationId,
      genomeSignal: params.severity === 'high' || params.severity === 'critical',
    });
  }

  /**
   * Log autonomy being exercised — when KEY Cortex or autopilot takes
   * action without human approval. This is a critical genome signal.
   */
  async logAutonomy(
    businessId: string,
    params: {
      action: string;
      module: string;
      result: 'success' | 'error' | 'partial';
      approvalRequired: boolean;
      details?: Record<string, unknown>;
      correlationId?: string;
    },
  ): Promise<BusinessEvent> {
    return this.logEvent({
      businessId,
      type: BusinessEventType.AUTONOMY_EXERCISED,
      module: params.module,
      source: 'autopilot',
      action: params.action,
      payload: {
        result: params.result,
        approvalRequired: params.approvalRequired,
        details: params.details,
      },
      correlationId: params.correlationId,
      genomeSignal: true,
    });
  }

  /**
   * Log a governance decision — when the delegation loop or governance
   * system changes autonomy settings, approval thresholds, etc.
   */
  async logGovernance(
    businessId: string,
    params: {
      decision: string;
      previousState: Record<string, unknown>;
      newState: Record<string, unknown>;
      decidedBy: string;
      correlationId?: string;
    },
  ): Promise<BusinessEvent> {
    return this.logEvent({
      businessId,
      type: BusinessEventType.GOVERNANCE_DECISION,
      module: 'key_cortex',
      source: 'delegation_loop',
      action: 'governance',
      payload: {
        decision: params.decision,
        previousState: params.previousState,
        newState: params.newState,
        decidedBy: params.decidedBy,
      },
      correlationId: params.correlationId,
      genomeSignal: true,
    });
  }

  /**
   * Log a genome evolution event — when DNA scores change based on
   * accumulated signals. This closes the feedback loop.
   */
  async logGenomeEvolution(
    businessId: string,
    params: {
      section: string;
      previousScore: number;
      newScore: number;
      signals: string[];
      correlationId?: string;
    },
  ): Promise<BusinessEvent> {
    return this.logEvent({
      businessId,
      type: BusinessEventType.GENOME_EVOLUTION,
      module: 'genome',
      source: 'genome_engine',
      action: 'evolve',
      payload: {
        section: params.section,
        previousScore: params.previousScore,
        newScore: params.newScore,
        signals: params.signals,
      },
      correlationId: params.correlationId,
      genomeSignal: true,
      genomeImpact: params.newScore - params.previousScore,
    });
  }

  /** The WHERE of KEY's observations of one business, by the filters' real columns. */
  private observationsWhere(businessId: string, filters: KeyObservationFilters = {}): Prisma.BusinessEventWhereInput {
    const where: Prisma.BusinessEventWhereInput = { businessId: requireBusiness(businessId), source: KEY_OBSERVATION_SOURCE };
    if (filters.type) where.eventType = filters.type;
    if (filters.source) where.actorId = filters.source;
    if (filters.subject) {
      where.subjectType = filters.subject.type;
      where.subjectId = filters.subject.id;
    }
    const json: Prisma.BusinessEventWhereInput[] = [];
    if (filters.module) json.push({ metadata: { path: ['module'], equals: filters.module } });
    if (filters.genomeSignal !== undefined) json.push({ metadata: { path: ['genomeSignal'], equals: filters.genomeSignal } });
    if (json.length) where.AND = json;
    if (filters.startDate || filters.endDate) {
      where.createdAt = {
        ...(filters.startDate ? { gte: filters.startDate } : {}),
        ...(filters.endDate ? { lte: filters.endDate } : {}),
      };
    }
    return where;
  }

  /**
   * KEY's observations of one business, newest first, with flexible filtering: the type (event_type), the observing
   * organ (actor_id), the module and genome flag (metadata), a time window, and a limit (at most 1000) and offset.
   */
  async getEvents(
    businessId: string,
    filters: KeyObservationFilters = {},
    readerContext?: MemoryReaderContext,
  ): Promise<BusinessEvent[]> {
    const limit = Math.min(Math.max(filters.limit ?? 100, 0), MAX_READ);
    const offset = Math.max(filters.offset ?? 0, 0);
    const raw = await this.prisma.client.businessEvent.findMany({
      where: this.observationsWhere(businessId, filters),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: readerContext ? Math.min(limit + offset + 200, MAX_READ) : limit,
      skip: readerContext ? 0 : offset,
    });
    if (!readerContext) {
      return filterOutSecretRows(raw, (e) => ({
        dataClass: null,
        texts: [e.eventType, e.subjectType, e.action, JSON.stringify(e.after ?? null), JSON.stringify(e.metadata ?? null)],
      }));
    }
    return projectBusinessEventRowsForReader(raw, readerContext, {
      businessId,
      path: 'KeyCortexEventService.getEvents',
      logger: this.logger,
    }).slice(offset, offset + limit);
  }

  /**
   * The event chain of one correlation id in one business, oldest first: every business_events row of `businessId`
   * that carries it (KEY's and the bus's alike). It used to read the correlation id across every business.
   */
  async getEventChain(
    businessId: string,
    correlationId: string,
    readerContext?: MemoryReaderContext,
  ): Promise<BusinessEvent[]> {
    const raw = await this.prisma.client.businessEvent.findMany({
      where: { businessId: requireBusiness(businessId), correlationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_READ,
    });
    if (!readerContext) {
      return filterOutSecretRows(raw, (e) => ({
        dataClass: null,
        texts: [e.eventType, e.subjectType, e.action, JSON.stringify(e.after ?? null), JSON.stringify(e.metadata ?? null)],
      }));
    }
    return projectBusinessEventRowsForReader(raw, readerContext, {
      businessId,
      path: 'KeyCortexEventService.getEventChain',
      logger: this.logger,
    });
  }

  /**
   * KEY's observations of one business in a period, counted by event type.
   * Used by dashboards and the genome engine.
   */
  async getEventStats(
    businessId: string,
    period: 'day' | 'week' | 'month',
    readerContext?: MemoryReaderContext,
  ): Promise<Record<string, number>> {
    const start = new Date();
    if (period === 'day') start.setDate(start.getDate() - 1);
    else if (period === 'week') start.setDate(start.getDate() - 7);
    else start.setMonth(start.getMonth() - 1);

    if (readerContext && getMemoryClassReadMode() === 'ACTIVE') {
      const visible = await this.getEvents(businessId, { startDate: start, limit: MAX_READ }, readerContext);
      const tally: Record<string, number> = {};
      for (const ev of visible) {
        tally[ev.eventType] = (tally[ev.eventType] ?? 0) + 1;
      }
      return tally;
    }

    const counts = await this.prisma.client.businessEvent.groupBy({
      by: ['eventType'],
      where: this.observationsWhere(businessId, { startDate: start }),
      _count: { _all: true },
    });

    return Object.fromEntries(counts.map((e) => [e.eventType, e._count._all]));
  }

  /**
   * The most recent of KEY's genome signals for a business.
   * Used by the genome engine to process signal accumulation.
   */
  async getGenomeSignals(
    businessId: string,
    limit = 100,
  ): Promise<BusinessEvent[]> {
    return this.getEvents(businessId, { genomeSignal: true, limit });
  }

  /**
   * KEY's observations of one module of a business within a time range.
   */
  async getModuleEvents(
    businessId: string,
    module: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<BusinessEvent[]> {
    return this.getEvents(businessId, { ...options, module });
  }
}
