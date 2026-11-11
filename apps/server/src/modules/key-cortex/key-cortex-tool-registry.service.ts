/**
 * KEY Cortex — Organ Tool Registry
 *
 * The runtime registry for cortex ORGAN tools: organs, muscles, and modules
 * register handlers here at boot, and the cortex executor invokes them.
 *
 * NOTE (ADR-0001 — Flow is the execution substrate): despite the historical
 * "single source of truth" wording, this is NOT the canonical catalogue of
 * everything KEY can do. That is `FLOW_TOOLS` in
 * `apps/server/src/modules/ai/flow-tool-registry.ts`, governed by `ai-oversight`.
 * This registry is being consolidated behind Flow (see the migration ledger in
 * `docs/architecture/ADR-0001-flow-is-the-execution-substrate.md`): its organ
 * tools are reached from Flow via CORTEX_TOOL_BRIDGE, and new tools belong in
 * FLOW_TOOLS, not here.
 *
 * Design principles:
 * - One registry, many adapters (organs register tools at module init).
 * - Every tool declares its schema, risk tier, and approval requirements.
 * - Execution is audited and wrapped with uniform error handling.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { getTenantContext } from '../../core/tenant/tenant-context';
import { KeyAutonomySafetyService } from '../key-autonomy/key-autonomy-safety.service';
import { KeyActionProposalService } from '../key-autonomy/key-action-proposal.service';
import { KeyIdempotencyService, fingerprintToolRequest } from './key-idempotency.service';
import type { IdempotencyCheckResult } from './key-idempotency.service';
import { KeyCortexSagaService } from './key-cortex-saga.service';
import { KeyCortexCompensationService } from './key-cortex-compensation.service';
import { KeyCortexLearningService } from './key-cortex-learning.service';
import { KeyCortexAuditService } from './key-cortex-audit.service';
import { KeyCortexEventBusService } from './key-cortex-event-bus.service';
import { GatewayToolDefinition } from './key-cortex.types';

export interface KeyCortexToolContext {
  businessId: string;
  userId?: string;
  sessionId?: string;
  commandId?: string;
  autonomyLevel?: number;
  correlationId?: string;
  /** The approval proposal this call executes, when it executes one: named on its CortexActionLog row. */
  proposalId?: string;
  /**
   * W10-CORTEX-CHAT-SCOPE (review SEC-W9KCA-3, CR-W9KCA-2): the member a call with no acting user
   * runs for (a plan's member, an on-behalf-of member), named on its CortexActionLog row ONLY. It is
   * never the acting user: the business-event ledger keeps recording the call as KEY's own ('ai',
   * SEC-W9KCA-4), the call's fingerprint and the organ's acting user stay ctx.userId, and no
   * permission is decided from it. ctx.userId, when set, wins.
   */
  auditUserId?: string;
  idempotencyKey?: string;
  sagaId?: string;
  /**
   * Set ONLY when a human has already approved this exact action.
   *
   * checkRisk answers "may KEY do this on its own?" — a question an approved
   * proposal has already answered with human authority, so it is skipped here.
   * Without this, a tier-3 tool could never execute at all: checkRisk refuses
   * tier 3 at EVERY autonomy level, so approving a proposal sent it back
   * through the same gate, which refused it and filed another proposal. An
   * infinite approval loop, and the user never got the action they authorised.
   *
   * It does NOT bypass KeyAutonomySafetyService. The kill switch, the daily
   * action cap and the spend cap still apply — an operator killing autonomy
   * must outrank an approval granted five minutes earlier.
   */
  preApproved?: boolean;
}

export interface KeyCortexToolCompensation {
  action: string;
  payload: Record<string, unknown>;
}

export interface KeyCortexToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  costTtd?: number;
  requiresApproval?: boolean;
  /**
   * The handler did not attempt the tool: something in front of it refused
   * the call or sent it for approval. Not an execution, so the registry does
   * not score it, count it against limits or cache it as an outcome.
   */
  notExecuted?: boolean;
}

export interface KeyCortexToolDefinition {
  /** Fully-qualified tool name, e.g. "cortex.create_task" or "inbox.send_reply" */
  name: string;
  /** Organ/module that owns this tool */
  module: string;
  /** Human-readable description for the AI */
  description: string;
  /** JSON Schema parameters object */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  /** Risk tier: 1=low, 2=medium, 3=high, 4=critical */
  riskTier: 1 | 2 | 3 | 4;
  /** Whether this tool requires explicit user approval before execution */
  requiresApproval: boolean;
  /** Optional tags for grouping/role filtering */
  tags?: string[];
  /** Optional compensation action for rollback */
  compensation?: KeyCortexToolCompensation;
  /** Handler that performs the actual work */
  handler: (
    ctx: KeyCortexToolContext,
    input: Record<string, unknown>,
  ) => Promise<KeyCortexToolResult>;
}

export interface KeyCortexToolMetadata {
  name: string;
  module: string;
  description: string;
  parameters: KeyCortexToolDefinition['parameters'];
  riskTier: KeyCortexToolDefinition['riskTier'];
  requiresApproval: boolean;
  tags?: string[];
}

/**
 * The idempotency claim an execute() call holds (check() answered it 'new'):
 * complete(), fail() and release() name it, so only this call settles or
 * frees the key (V1-19b, SEC-V19-1).
 */
interface OpenClaim {
  businessId: string;
  idempotencyKey: string;
  requestHash: string;
  claimId?: string;
}

/**
 * What the idempotency gate answered a call it did not let run: a replay of a
 * settled key, or a refusal (held by another call, claimed for another
 * request, or a request with no fingerprint). Recorded on its audit event.
 */
type IdempotencyGateAnswer = 'replayed' | 'pending' | 'conflict' | 'unfingerprintable';

export interface KeyCortexToolScore {
  successRate: number;
  avgDurationMs: number;
  totalUses: number;
}

// ---------------------------------------------------------------------------
// What a CortexActionLog row may hold of a call (V1-19c review, SEC-V19c-1)
// ---------------------------------------------------------------------------

/**
 * The longest answer a row stores whole, and the preview kept of a longer one:
 * the bound AiExecutionLogService.sanitizePayload puts on its copy of the same
 * answer, in the same { _truncated, _size, _preview } form. These rows are read
 * into prompts (UnifiedMemoryRetrievalService), so an unbounded answer is
 * stored, and read, whole on every execution.
 */
const AUDIT_STORED_WHOLE_MAX = 5000;
const AUDIT_PREVIEW_CHARS = 500;
/** What stands, in a stored answer or error, where a value of the call's input was. */
const AUDIT_INPUT_REDACTION = '[redacted:input]';
/** An input value at least this long is also taken out of a longer text that quotes it. */
const AUDIT_INPUT_QUOTE_MIN = 6;
/**
 * An input key that names a record (id, contactId, thread_id, contactIds): its
 * values are references, not personal data, and the audit row needs them to
 * say what the call acted on. They are not taken out.
 */
const AUDIT_ID_KEY = /(^id$|Id$|_id$|Ids$|_ids$)/;

/** The string values of a call's input, longest first, minus the record references. */
function auditInputValues(input: unknown): string[] {
  const values = new Set<string>();
  const walk = (value: unknown, key: string | undefined, depth: number): void => {
    if (depth > 10 || values.size >= 500) return;
    if (typeof value === 'string') {
      if (value.trim().length > 0 && !(key && AUDIT_ID_KEY.test(key))) values.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, key, depth + 1);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, k, depth + 1);
    }
  };
  walk(input, undefined, 0);
  // Longest first: a value inside another is not taken out before the one that holds it.
  return [...values].sort((a, b) => b.length - a.length);
}

/** A text with every input value taken out: equal to one, or quoting one long enough to be personal data. */
function redactAuditText(text: string, inputValues: string[]): string {
  let out = text;
  for (const value of inputValues) {
    if (out === value) return AUDIT_INPUT_REDACTION;
    if (value.length >= AUDIT_INPUT_QUOTE_MIN && out.includes(value)) out = out.split(value).join(AUDIT_INPUT_REDACTION);
  }
  return out;
}

function redactAuditValue(value: unknown, inputValues: string[]): unknown {
  if (typeof value === 'string') return redactAuditText(value, inputValues);
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item, inputValues));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactAuditValue(v, inputValues)]),
    );
  }
  return value;
}

/**
 * A tool's answer as a CortexActionLog `result` text (V1-19c): JSON, with every
 * value of the call's input taken out (an answer can echo its input, such as a
 * create tool answering with the record it made, and the input is never stored
 * on the row), bounded as AiExecutionLog bounds its copy. Null when the answer
 * is empty or has no JSON form (a cycle, a BigInt): an unserializable answer
 * must not cost the execution its audit row. Only the stored copy changes; the
 * caller's answer is not touched.
 */
export function auditResultText(data: unknown, input: unknown): string | null {
  if (data === undefined || data === null) return null;
  let plain: unknown;
  try {
    const json = JSON.stringify(data);
    if (json === undefined) return null;
    plain = JSON.parse(json);
  } catch {
    return null;
  }
  const text = JSON.stringify(redactAuditValue(plain, auditInputValues(input)));
  if (text.length <= AUDIT_STORED_WHOLE_MAX) return text;
  return JSON.stringify({ _truncated: true, _size: text.length, _preview: text.slice(0, AUDIT_PREVIEW_CHARS) });
}

/** A tool's error as a CortexActionLog `error` text (V1-19c): input values taken out, bounded. */
export function auditErrorText(error: string | null | undefined, input: unknown): string | null {
  if (error === undefined || error === null) return null;
  const text = redactAuditText(String(error), auditInputValues(input));
  return text.length <= AUDIT_STORED_WHOLE_MAX
    ? text
    : `${text.slice(0, AUDIT_STORED_WHOLE_MAX)}... [${text.length} characters]`;
}

/**
 * How many times a call that filed an approval proposal tries to settle its
 * idempotency key with it, and the pause before each retry (times the attempt
 * number). W10-CLAIM-LEASE review, CR-CL-1: see settleWithProposal().
 */
const PROPOSAL_SETTLE_ATTEMPTS = 3;
const PROPOSAL_SETTLE_BACKOFF_MS = 100;

/**
 * The actor named on a call's CortexActionLog row (V1-19c review, SEC-V19c-2):
 * the one its caller names, else the authenticated member of the request the
 * call runs in, when the TenantInterceptor verified that request's tenant as
 * the call's business. Callers that pass no actor (the chat's bridged organ
 * tools, cortex.execute_tool) otherwise audited a member's action with nobody
 * named. Attribution only: no permission is decided from it. A call outside a
 * request (a job, a queue worker) names nobody, unless its caller names an
 * audit-only actor or it runs inside another registry call that names one
 * (W10-CORTEX-CHAT-SCOPE, below).
 */
function auditActor(ctx: KeyCortexToolContext): string | null {
  if (ctx.userId) return ctx.userId;
  // W10-CORTEX-CHAT-SCOPE (SEC-W9KCA-3, CR-W9KCA-2): the caller's audit-only actor, else the actor of
  // the registry call this one runs inside (a KEY-cortex turn's bridged organ call), both on this row
  // alone. Then the request's member, as before.
  if (ctx.auditUserId) return ctx.auditUserId;
  const enclosing = enclosingCallFor(ctx);
  if (enclosing?.actor) return enclosing.actor;
  const request = getTenantContext();
  return request?.userId && request.businessId === ctx.businessId ? request.userId : null;
}

/**
 * W10-CORTEX-CHAT-SCOPE (review CR-W9KCA-3, SEC-W9KCA-3): the registry call whose handler is running,
 * as its audit row names it. A KEY-cortex turn's bridged flow tool runs its organ tool through the
 * flow dispatcher (KeyCortexEfferentBridgeService -> FlowOrchestratorService.executeBridgedCortexTool
 * -> execute()), which hands the organ call no actor and no command id (it is no principal, and must
 * not become the organ's acting user: SEC-W9KCA-4), so its row named nobody outside a request. The
 * organ call's row now names the enclosing call's actor, and its command id when the organ call is on
 * the same correlation (the bridge carries the turn's session and correlation). Audit row only.
 */
interface EnclosingToolCall {
  businessId: string;
  actor: string | null;
  commandId: string | null;
  correlationId: string | null;
}

const enclosingToolCall = new AsyncLocalStorage<EnclosingToolCall>();

/** The registry call `ctx`'s call runs inside, when it is one for the same business. */
function enclosingCallFor(ctx: KeyCortexToolContext): EnclosingToolCall | undefined {
  const enclosing = enclosingToolCall.getStore();
  return enclosing && enclosing.businessId === ctx.businessId ? enclosing : undefined;
}

/** The command id named on a call's CortexActionLog row: its own, else its enclosing call's on the same correlation. */
function auditCommandId(ctx: KeyCortexToolContext): string | null {
  if (ctx.commandId) return ctx.commandId;
  const enclosing = enclosingCallFor(ctx);
  return enclosing?.commandId && ctx.correlationId && enclosing.correlationId === ctx.correlationId
    ? enclosing.commandId
    : null;
}

@Injectable()
export class KeyCortexToolRegistryService {
  private readonly logger = new Logger(KeyCortexToolRegistryService.name);
  private readonly tools = new Map<string, KeyCortexToolDefinition>();
  private readonly outcomes = new Map<
    string,
    { successes: number; failures: number; totalDurationMs: number; lastUsedAt: Date }
  >();
  /** CortexActionLog rows this process failed to write (V1-19c): see audit(). */
  private auditWriteFailures = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: KeyAutonomySafetyService,
    private readonly idempotency: KeyIdempotencyService,
    @Inject(forwardRef(() => KeyCortexSagaService)) private readonly saga: KeyCortexSagaService,
    @Optional()
    private readonly learning?: KeyCortexLearningService,
    @Optional()
    private readonly auditService?: KeyCortexAuditService,
    @Optional()
    private readonly eventBus?: KeyCortexEventBusService,
    @Optional() @Inject(forwardRef(() => KeyActionProposalService)) private readonly proposals?: KeyActionProposalService,
    // APPENDED, never inserted. Every spec in this repo constructs services
    // positionally, so adding a parameter mid-list silently shifts every
    // argument after it — which is how peekBody stopped being called once
    // already, with no symptom other than a feature quietly not happening.
    @Optional() @Inject(forwardRef(() => KeyCortexCompensationService)) private readonly compensation?: KeyCortexCompensationService,
  ) {}

  // ========================================================================
  // Registration
  // ========================================================================

  register(tool: KeyCortexToolDefinition): void {
    if (!tool.name || !tool.module) {
      throw new Error(`Tool must have a name and module: ${JSON.stringify(tool)}`);
    }

    const existing = this.tools.get(tool.name);
    if (existing) {
      this.logger.warn(`Tool "${tool.name}" is being overwritten in the canonical registry`);

      // A name collision between tools of DIFFERENT risk is a safety bug, not a
      // duplicate. `cortex.query_database` was registered twice — tier 4 with
      // approval required ("run a raw database query") and tier 2 without
      // ("read-only, allow-listed, business-scoped, capped at 100 rows") — and
      // because this method overwrites, which handler ran AND which safety
      // class applied depended on module initialisation order. Nothing in the
      // system made that order deterministic.
      //
      // Both are legitimate tools; they were never the same tool. They are
      // named apart now. This keeps the failure from recurring silently: on a
      // tier disagreement the registry keeps the HIGHER tier, so an accidental
      // collision can only ever make KEY more cautious, never less.
      if (existing.riskTier !== tool.riskTier) {
        const safest = Math.max(existing.riskTier, tool.riskTier) as KeyCortexToolDefinition['riskTier'];
        this.logger.error(
          `Tool "${tool.name}" registered at conflicting risk tiers ` +
            `(${existing.riskTier} by ${existing.module}, ${tool.riskTier} by ${tool.module}). ` +
            `Keeping tier ${safest}. These are almost certainly two different tools sharing a name.`,
        );
        this.tools.set(tool.name, {
          ...tool,
          riskTier: safest,
          requiresApproval: existing.requiresApproval || tool.requiresApproval,
        });
        return;
      }
    }

    this.tools.set(tool.name, tool);
  }

  registerMany(tools: KeyCortexToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  // ========================================================================
  // Lookup
  // ========================================================================

  getTool(name: string): KeyCortexToolDefinition | undefined {
    return this.tools.get(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  listTools(filter?: { module?: string; tags?: string[] }): KeyCortexToolMetadata[] {
    let tools = Array.from(this.tools.values());
    if (filter?.module) {
      tools = tools.filter((t) => t.module === filter.module);
    }
    if (filter?.tags && filter.tags.length > 0) {
      tools = tools.filter((t) => filter.tags!.some((tag) => t.tags?.includes(tag)));
    }
    return tools.map((t) => this.toMetadata(t));
  }

  listModules(): string[] {
    return Array.from(new Set(Array.from(this.tools.values()).map((t) => t.module)));
  }

  // ========================================================================
  // Execution
  // ========================================================================

  /**
   * How this step would be undone, recorded BEFORE it runs.
   *
   * Two sources, in priority order. A tool that declares its own compensation
   * wins — nothing does today, but the field is part of the definition and a
   * hand-written one should beat a table lookup. Otherwise ask
   * KeyCortexCompensationService what reverses this tool.
   *
   * That second source is the one that was missing, and its absence was total:
   * `tool.compensation` is set by no tool anywhere, and the only code that ever
   * built a compensation from the table lives in KeyCortexSagaExecutorService,
   * which has no callers. So every saga step in production stored
   * `compensationAction: null`, every rollback found nothing to run, and the
   * saga was recorded `compensation_unavailable`. Every limb that moves money,
   * mail or bookings had no undo, and this is the line where that was decided.
   *
   * Recorded before execution rather than after, deliberately: a step that
   * crashes mid-write is exactly the one that needs undoing, and a compensation
   * written on the success path would not exist for it.
   *
   * Returning undefined is a real answer — this tool has no known reversal —
   * and the saga service records that distinctly instead of claiming a rollback.
   */
  private compensationFor(
    name: string,
    ctx: KeyCortexToolContext,
    input: Record<string, unknown>,
  ): { stepName: string; action: string; payload: Record<string, unknown> } | undefined {
    const tool = this.tools.get(name);

    if (tool?.compensation) {
      return {
        stepName: name,
        action: tool.compensation.action,
        payload: tool.compensation.payload,
      };
    }

    const action = this.compensation?.getCompensatingAction(name);
    if (!action) return undefined;

    // businessId LAST so it wins: a tool argument of the same name must not be
    // able to point the rollback at another tenant.
    return { stepName: name, action, payload: { ...input, businessId: ctx.businessId } };
  }

  async execute(
    name: string,
    ctx: KeyCortexToolContext,
    input: Record<string, unknown> = {},
  ): Promise<KeyCortexToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool "${name}" not found in canonical registry` };
    }

    // Phase 0: global autonomy kill switch, safety limits, and tier enforcement
    // are the first gate, ahead of the idempotency gate too: a stored outcome
    // is not handed out past a gate that refuses the call now (V1-19b review,
    // SEC-V19b-4: a replay used to answer while the kill switch was on). A
    // call it refuses has claimed nothing, so there is nothing to give up.
    const safetyCheck = await this.safety.check({
      businessId: ctx.businessId,
      toolName: name,
      riskTier: tool.riskTier,
      mode: ctx.autonomyLevel && ctx.autonomyLevel >= 2 ? 'auto' : 'manual',
      estimatedCostTtd: 0,
    });
    if (!safetyCheck.allowed) {
      this.logger.warn(`[execute][${ctx.businessId}] Safety gate blocked ${name}: ${safetyCheck.reason}`);
      const blocked: KeyCortexToolResult = {
        success: false,
        error: safetyCheck.reason ?? 'Blocked by autonomy safety gate',
        requiresApproval: safetyCheck.requiresApproval,
      };
      await this.emitBusinessEvent(ctx, name, input, blocked, 0).catch((err) => {
        this.logger.warn(`Tool business-event emit failed: ${(err as Error).message}`);
      });
      return blocked;
    }

    // Phase 0: idempotency gate. check() is a claim (V1-19): only the caller
    // answered 'new' runs the tool, and it alone settles the key, by the
    // claimId and request hash it claimed under. A settled key replays its
    // outcome; a key another caller holds ('pending') or claimed for another
    // request ('conflict') is refused without running anything (V1-19b,
    // SEC-V19-2 / CR-V19-1: both used to fall through and run the tool). The
    // request is the tool, its input and the acting user, so another member
    // presenting the key is a 'conflict', never handed this member's outcome;
    // and every answer given here without running the tool is audited, as
    // the safety gate's refusal is (V1-19b review, SEC-V19b-4).
    let claim: OpenClaim | undefined;
    if (ctx.idempotencyKey) {
      let requestHash: string;
      try {
        requestHash = fingerprintToolRequest(name, input, ctx.userId);
      } catch (err) {
        // No fingerprint, nothing to tell this request from another: claiming
        // the key for it would make it every such request's key (SEC-V19-3).
        const refused: KeyCortexToolResult = { success: false, notExecuted: true, error: (err as Error).message };
        // The input has no JSON form, so the audit record carries none.
        await this.auditGateAnswer(ctx, name, {}, refused, 'unfingerprintable');
        return refused;
      }
      const answer = await this.idempotency.check({
        businessId: ctx.businessId,
        idempotencyKey: ctx.idempotencyKey,
        requestHash,
        // What a D-103 takeover of a stranded claim is recorded for on the KEY
        // execution log: this call's actor, tool, session, command and
        // correlation, as its own run row names them (W10-CLAIM-LEASE review,
        // SEC-W10CL-1). Attribution only; the claim is the key and the hash.
        audit: {
          actorId: auditActor(ctx),
          toolName: name,
          sessionId: ctx.sessionId,
          commandId: ctx.commandId,
          correlationId: ctx.correlationId,
        },
      });
      if (answer.status === 'completed' || answer.status === 'failed') {
        const replay = this.replayOf(answer);
        await this.auditGateAnswer(ctx, name, input, replay, 'replayed');
        return replay;
      }
      if (answer.status !== 'new') {
        const refused: KeyCortexToolResult = {
          success: false,
          notExecuted: true,
          error: answer.error ?? `Idempotency key ${ctx.idempotencyKey} is ${answer.status}`,
        };
        await this.auditGateAnswer(ctx, name, input, refused, answer.status);
        return refused;
      }
      claim = { businessId: ctx.businessId, idempotencyKey: ctx.idempotencyKey, requestHash, claimId: answer.claimId };
    }

    // Every path from here that returns without running the tool gives the
    // claim up, so a retry of the key reaches the tool again (V1-19b,
    // CR-V19-2). The one exception files an approval proposal: see below.
    const notRun = async (result: KeyCortexToolResult): Promise<KeyCortexToolResult> => {
      await this.releaseClaim(claim);
      return result;
    };

    const validation = this.validateInput(tool, input);
    if (!validation.valid) {
      return notRun({ success: false, error: validation.error });
    }

    // An approved action skips the autonomy threshold — a human already
    // granted the authority checkRisk exists to withhold. Skipping the whole
    // branch also breaks the loop: re-entering it would file a second proposal
    // for an action that was already approved.
    const riskCheck = ctx.preApproved
      ? { allowed: true as const, reason: undefined }
      : this.checkRisk(tool, ctx.autonomyLevel ?? 0);
    if (!riskCheck.allowed) {
      // A refusal used to end here. The tier-3 message even said the tool
      // "requires explicit user approval" — and then there was no way to ask
      // for any. KEY could decline, never request. That is a brain with an
      // inhibitory gate and no voluntary pathway around it.
      //
      // Tier 4 stays a hard refusal: critical actions are not delegated to a
      // request. Everything else becomes a proposal a human can approve, and
      // approving it now genuinely executes — KeyCortexActionExecutorPlugin
      // dispatches to the right registry with the right payload key, which it
      // did not do until recently.
      if (tool.riskTier < 4) {
        const proposalId = await this.proposeForApproval(tool, ctx, input, riskCheck.reason);
        if (proposalId) {
          const proposed: KeyCortexToolResult = {
            success: false,
            requiresApproval: true,
            error: `${riskCheck.reason} — sent for approval`,
            data: { proposalId } as KeyCortexToolResult['data'],
          };
          // The one no-run path that keeps its key: the key settles with this
          // proposal, so a retry of the request is answered with the same
          // proposal instead of filing another (V1-19b review, SEC-V19b-2: a
          // released key filed one proposal per retry, and approving each ran
          // the tool each time). The approved run is the proposal's own, by
          // its id (KeyCortexActionExecutorPlugin calls execute() preApproved
          // and without a key); a call that presents this key again, approved
          // or not, is a retry of this request and gets this answer.
          if (claim) {
            // The proposal is filed either way. See settleWithProposal(): a
            // settle that fails is tried again, and a key that still cannot be
            // settled stays claimed only until the claim lease runs out (D-103).
            await this.settleWithProposal(claim, proposed, proposalId);
          }
          return proposed;
        }
      }
      return notRun({ success: false, error: riskCheck.reason, requiresApproval: tool.riskTier < 4 });
    }

    const startMs = Date.now();
    let sagaStepIndex: number | undefined;
    let handlerEntered = false;
    try {
      if (ctx.sagaId) {
        sagaStepIndex = Date.now();
        await this.saga.addStep(
          ctx.sagaId,
          sagaStepIndex,
          name,
          input,
          this.compensationFor(name, ctx, input),
        );
      }

      // From here the tool has been attempted. Before it (the saga step
      // above), a throw means the tool never ran (V1-19b review, SEC-V19b-3 /
      // CR-V19b-2): the catch below gives the claim up then, not settle it.
      handlerEntered = true;
      // W10-CORTEX-CHAT-SCOPE (CR-W9KCA-3): a registry call the handler makes is audited as this
      // call's (enclosingToolCall: its row only).
      const result = await enclosingToolCall.run(
        {
          businessId: ctx.businessId,
          actor: auditActor(ctx),
          commandId: auditCommandId(ctx),
          correlationId: ctx.correlationId ?? null,
        },
        () => tool.handler(ctx, validation.parsed),
      );
      const durationMs = Date.now() - startMs;

      // KF-EXEC-ACTION-001. A handler can now answer "not executed": the KEY
      // action boundary sits behind the bridged handler of a capability it has
      // adopted, and refuses or files a proposal there. That is this registry's
      // own pre-handler answer (the checkRisk branch above) arriving from one
      // layer down, and it is treated the same way. Scoring it as a failure
      // would be worse than wrong: ToolOutcomeScore is what
      // AutonomyOrchestratorService reads before a proposal executes, so five
      // refusals would block the tool the approvals are waiting to run.
      if (result.notExecuted && !result.success) {
        if (ctx.sagaId && sagaStepIndex !== undefined) {
          await this.saga.failStep(ctx.sagaId, sagaStepIndex, result.error ?? 'not executed').catch((err) => {
            this.logger.warn(`Saga step failure logging failed: ${(err as Error).message}`);
          });
        }
        return notRun(result);
      }

      this.recordToolOutcome(name, result.success, durationMs, ctx.businessId);
      await this.recordLearningOutcome(ctx, name, result.success, result.error, durationMs).catch((err) => {
        this.logger.warn(`Learning outcome recording failed: ${(err as Error).message}`);
      });

      if (ctx.sagaId && sagaStepIndex !== undefined) {
        await this.saga.completeStep(ctx.sagaId, sagaStepIndex, result as any).catch((err) => {
          this.logger.warn(`Saga step completion failed: ${(err as Error).message}`);
        });
      }

      // Record successful autonomous execution against daily limits.
      if (safetyCheck.allowed) {
        await this.safety
          .recordExecution({
            businessId: ctx.businessId,
            toolName: name,
            riskTier: tool.riskTier,
            mode: ctx.autonomyLevel && ctx.autonomyLevel >= 2 ? 'auto' : 'manual',
            actualCostTtd: result.costTtd,
          })
          .catch((err) => {
            this.logger.warn(`Safety record failed: ${(err as Error).message}`);
          });
      }

      // The key settles with the outcome as it is: a handler that answered
      // { success: false } without throwing failed, and its key is 'failed',
      // not 'completed' (V1-19b review, SEC-V19b-1 / CR-V19b-1: it was stored
      // 'completed' and replayed as a success). The whole answer is stored
      // either way, so a replay answers exactly as this call does.
      if (claim) {
        if (result.success) {
          await this.idempotency.complete(claim, result);
        } else {
          await this.idempotency.fail(claim, result.error ?? `Tool "${name}" failed`, result);
        }
      }

      await this.audit(ctx, name, input, result, startMs, durationMs).catch((err) => {
        this.logger.warn(`Tool audit failed: ${(err as Error).message}`);
      });
      await this.emitBusinessEvent(ctx, name, input, result, durationMs).catch((err) => {
        this.logger.warn(`Tool business-event emit failed: ${(err as Error).message}`);
      });
      return result;
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startMs;
      const result: KeyCortexToolResult = { success: false, error: err.message };

      this.recordToolOutcome(name, false, durationMs, ctx.businessId);
      await this.recordLearningOutcome(ctx, name, false, err.message, durationMs).catch((learnErr) => {
        this.logger.warn(`Learning outcome recording failed: ${(learnErr as Error).message}`);
      });

      if (ctx.sagaId && sagaStepIndex !== undefined) {
        await this.saga.failStep(ctx.sagaId, sagaStepIndex, err.message).catch((sagaErr) => {
          this.logger.warn(`Saga step failure logging failed: ${(sagaErr as Error).message}`);
        });
        if (tool.compensation) {
          await this.saga.compensate(ctx.sagaId).catch((compErr) => {
            this.logger.warn(`Saga compensation failed: ${(compErr as Error).message}`);
          });
        }
      }

      if (claim) {
        if (handlerEntered) {
          await this.idempotency.fail(claim, err.message);
        } else {
          // The saga step could not be recorded and the tool never ran: no
          // outcome to keep, so a retry of the key reaches the tool again.
          await this.releaseClaim(claim);
        }
      }

      await this.audit(ctx, name, input, result, startMs, durationMs).catch((auditErr) => {
        this.logger.warn(`Tool audit failed: ${(auditErr as Error).message}`);
      });
      await this.emitBusinessEvent(ctx, name, input, result, durationMs).catch((err) => {
        this.logger.warn(`Tool business-event emit failed: ${(err as Error).message}`);
      });
      return result;
    }
  }

  // ========================================================================
  // AI Gateway Tool Definitions
  // ========================================================================

  buildGatewayDefinitions(filter?: { module?: string; tags?: string[] }): GatewayToolDefinition[] {
    const tools = this.listTools(filter);
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  // ========================================================================
  // Tool success scoring (Phase D.3)
  // ========================================================================

  recordToolOutcome(toolName: string, success: boolean, durationMs: number, businessId?: string): void {
    const existing = this.outcomes.get(toolName) ?? {
      successes: 0,
      failures: 0,
      totalDurationMs: 0,
      lastUsedAt: new Date(),
    };

    if (success) {
      existing.successes++;
    } else {
      existing.failures++;
    }
    existing.totalDurationMs += durationMs;
    existing.lastUsedAt = new Date();

    this.outcomes.set(toolName, existing);

    if (businessId) {
      this.persistToolOutcomeScore(businessId, toolName, success, durationMs).catch((err) => {
        this.logger.warn(`[recordToolOutcome] Persist failed: ${(err as Error).message}`);
      });
    }
  }

  async getToolScoreForBusiness(
    businessId: string,
    toolName: string,
  ): Promise<KeyCortexToolScore> {
    const row = await this.prisma.client.toolOutcomeScore.findUnique({
      where: { businessId_toolName: { businessId, toolName } },
    });
    if (!row) {
      return { successRate: 0, avgDurationMs: 0, totalUses: 0 };
    }
    const totalUses = row.successCount + row.failureCount;
    return {
      successRate: totalUses > 0 ? row.successCount / totalUses : 0,
      avgDurationMs: row.avgExecutionMs ?? 0,
      totalUses,
    };
  }

  private async persistToolOutcomeScore(
    businessId: string,
    toolName: string,
    success: boolean,
    durationMs: number,
  ): Promise<void> {
    const existing = await this.prisma.client.toolOutcomeScore.findUnique({
      where: { businessId_toolName: { businessId, toolName } },
    });

    const successCount = (existing?.successCount ?? 0) + (success ? 1 : 0);
    const failureCount = (existing?.failureCount ?? 0) + (success ? 0 : 1);
    const totalUses = successCount + failureCount;
    const avgExecutionMs =
      existing?.avgExecutionMs != null
        ? Math.round((existing.avgExecutionMs * (totalUses - 1) + durationMs) / totalUses)
        : durationMs;

    await this.prisma.client.toolOutcomeScore.upsert({
      where: { businessId_toolName: { businessId, toolName } },
      create: {
        businessId,
        toolName,
        successCount,
        failureCount,
        avgExecutionMs,
      },
      update: {
        successCount,
        failureCount,
        avgExecutionMs,
      },
    });
  }

  getToolScore(toolName: string): KeyCortexToolScore {
    const stats = this.outcomes.get(toolName);
    if (!stats) {
      return { successRate: 0, avgDurationMs: 0, totalUses: 0 };
    }

    const totalUses = stats.successes + stats.failures;
    return {
      successRate: totalUses > 0 ? stats.successes / totalUses : 0,
      avgDurationMs: totalUses > 0 ? Math.round(stats.totalDurationMs / totalUses) : 0,
      totalUses,
    };
  }

  getAllToolScores(): Record<string, KeyCortexToolScore> {
    const scores: Record<string, KeyCortexToolScore> = {};
    for (const toolName of this.tools.keys()) {
      scores[toolName] = this.getToolScore(toolName);
    }
    for (const toolName of this.outcomes.keys()) {
      if (!scores[toolName]) {
        scores[toolName] = this.getToolScore(toolName);
      }
    }
    return scores;
  }

  private async recordLearningOutcome(
    ctx: KeyCortexToolContext,
    toolName: string,
    success: boolean,
    error: string | undefined,
    durationMs: number,
  ): Promise<void> {
    if (!this.learning) return;

    await this.learning.recordOutcome({
      businessId: ctx.businessId,
      sessionId: ctx.sessionId ?? ctx.correlationId ?? `tool_${toolName}_${Date.now()}`,
      toolName,
      success,
      error,
      durationMs,
      metadata: {
        commandId: ctx.commandId,
        autonomyLevel: ctx.autonomyLevel,
        sagaId: ctx.sagaId,
      },
    });
  }

  // ========================================================================
  // Risk / Approval helpers
  // ========================================================================

  /**
   * Turn a refusal into a request.
   *
   * The payload shape is the contract KeyCortexActionExecutorPlugin reads back
   * on approval: `toolName` plus `inputPayload`. Getting either wrong means the
   * proposal is approved and then fails silently, which is exactly what used to
   * happen — the plugin read `payload.parameters` while the planner wrote
   * `payload.inputPayload`, so every approved action executed with `{}`.
   *
   * Never throws. A proposal that cannot be filed must degrade to the original
   * refusal, not turn a blocked action into an error the caller cannot read.
   */
  private async proposeForApproval(
    tool: KeyCortexToolDefinition,
    ctx: KeyCortexToolContext,
    input: Record<string, unknown>,
    reason?: string,
  ): Promise<string | null> {
    if (!this.proposals) return null;

    try {
      const proposal = await this.proposals.create(
        ctx.businessId,
        {
          sourceType: 'KEY_CORTEX',
          sourceId: ctx.correlationId ?? ctx.sessionId,
          title: `${tool.name}`,
          summary: tool.description,
          rationale: reason,
          actionType: 'EXECUTE_TOOL',
          toolName: tool.name,
          module: tool.module,
          payload: {
            toolName: tool.name,
            inputPayload: input,
          },
        },
        ctx.userId,
      );

      this.logger.log(
        `[execute][${ctx.businessId}] ${tool.name} exceeded autonomy — proposal ${proposal.id} filed for approval`,
      );
      return proposal.id;
    } catch (err: unknown) {
      this.logger.warn(
        `[execute][${ctx.businessId}] could not file approval for ${tool.name}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  checkRisk(
    tool: KeyCortexToolDefinition,
    autonomyLevel: number,
  ): { allowed: boolean; reason?: string } {
    if (tool.riskTier === 4) {
      return { allowed: false, reason: `CRITICAL risk tool "${tool.name}" is blocked from AI execution` };
    }
    if (tool.riskTier === 3) {
      return { allowed: false, reason: `HIGH risk tool "${tool.name}" requires explicit user approval` };
    }
    if (tool.riskTier === 2 && autonomyLevel < 4) {
      return { allowed: false, reason: `MEDIUM risk tool "${tool.name}" requires TRUSTED_AUTOPILOT autonomy` };
    }
    if (tool.riskTier === 1 && autonomyLevel < 2) {
      return { allowed: false, reason: `LOW risk tool "${tool.name}" requires INTERNAL_EXEC autonomy or higher` };
    }
    return { allowed: true };
  }

  // ========================================================================
  // Statistics
  // ========================================================================

  getStats(): { total: number; byModule: Record<string, number>; byRiskTier: Record<string, number> } {
    const byModule: Record<string, number> = {};
    const byRiskTier: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0 };
    for (const tool of this.tools.values()) {
      byModule[tool.module] = (byModule[tool.module] ?? 0) + 1;
      byRiskTier[tool.riskTier] = (byRiskTier[tool.riskTier] ?? 0) + 1;
    }
    return { total: this.tools.size, byModule, byRiskTier };
  }

  // ========================================================================
  // Private helpers
  // ========================================================================

  private toMetadata(tool: KeyCortexToolDefinition): KeyCortexToolMetadata {
    return {
      name: tool.name,
      module: tool.module,
      description: tool.description,
      parameters: tool.parameters,
      riskTier: tool.riskTier,
      requiresApproval: tool.requiresApproval,
      tags: tool.tags,
    };
  }

  /**
   * Settle the claim of a call that filed an approval proposal with that
   * proposal (V1-19b review, SEC-V19b-2), so a retry of the request is
   * answered with it instead of filing another. Never throws: the proposal is
   * filed, and the caller's answer stands.
   *
   * A settle that throws is tried again, up to PROPOSAL_SETTLE_ATTEMPTS times
   * (W10-CLAIM-LEASE review, CR-CL-1). It is safe to repeat: it writes only the
   * claim this call still holds, so an attempt that did land answers false the
   * next time and nothing is written twice. A key that still cannot be settled
   * stays claimed, and a retry is refused while the claim is younger than the
   * claim lease. Past the lease, owner ruling D-103 lets the next retry take
   * the claim over (an unsettled claim cannot be told from one whose holder
   * crashed), and that retry files another proposal: accepted under D-103, as
   * it is for a tool that ran and whose outcome could not be stored. The
   * takeover is on the KEY execution log, naming the tool and the member, and
   * this logs an error naming the proposal, so the two proposals can be found.
   */
  private async settleWithProposal(claim: OpenClaim, proposed: KeyCortexToolResult, proposalId: string): Promise<void> {
    for (let attempt = 1; attempt <= PROPOSAL_SETTLE_ATTEMPTS; attempt += 1) {
      try {
        // false: the claim is no longer this call's to settle; nothing to retry.
        await this.idempotency.fail(claim, proposed.error as string, proposed);
        return;
      } catch (err) {
        const message = `[execute][${claim.businessId}] could not settle idempotency key ${claim.idempotencyKey} with proposal ${proposalId} (attempt ${attempt} of ${PROPOSAL_SETTLE_ATTEMPTS}): ${(err as Error).message}`;
        if (attempt < PROPOSAL_SETTLE_ATTEMPTS) {
          this.logger.warn(message);
          await new Promise((resolve) => setTimeout(resolve, PROPOSAL_SETTLE_BACKOFF_MS * attempt));
        } else {
          this.logger.error(
            `${message}. The key stays claimed; after the claim lease a retry of this request can take it over and file another proposal (D-103).`,
          );
        }
      }
    }
  }

  /**
   * Give an open idempotency claim up without an outcome: the call returns
   * without running the tool (V1-19b, CR-V19-2). Only a claim check() answered
   * 'new' with a claimId can be released. A failed release is logged, not
   * thrown: the caller's own answer stands, and the claim stays open (refusing
   * retries of the key) rather than freed by a guess.
   */
  private async releaseClaim(claim: OpenClaim | undefined): Promise<void> {
    if (!claim?.claimId) return;
    try {
      await this.idempotency.release({ ...claim, claimId: claim.claimId });
    } catch (err) {
      this.logger.warn(
        `[execute][${claim.businessId}] could not release idempotency claim ${claim.idempotencyKey}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * A settled key's answer, as the call that settled it answered (V1-19b
   * review, SEC-V19b-1 / CR-V19b-1). The registry stores the whole tool
   * result, so that is what is replayed: never wrapped as the `data` of a new
   * success, and a stored { success: false } replays as a failure whatever
   * status it was stored under. A stored response that is not a tool result
   * (another writer's) answers as before: completed is its data, failed is its
   * error.
   */
  private replayOf(answer: IdempotencyCheckResult): KeyCortexToolResult {
    const stored = answer.response;
    if (stored && typeof stored === 'object' && !Array.isArray(stored) && typeof (stored as KeyCortexToolResult).success === 'boolean') {
      return stored as KeyCortexToolResult;
    }
    return answer.status === 'completed'
      ? { success: true, data: stored }
      : { success: false, error: answer.error ?? 'Duplicate request failed previously' };
  }

  /**
   * Audit an answer the idempotency gate gave without running the tool: a
   * replay of a settled key, or a refusal (the key is held, or was claimed for
   * another request, or the request has no fingerprint). Recorded on the
   * business-event ledger as the safety gate's refusal is, naming the actor
   * and the key (V1-19b review, SEC-V19b-4: these answers left no record, and
   * a key reused for another request only a log line). Never throws.
   */
  private async auditGateAnswer(
    ctx: KeyCortexToolContext,
    name: string,
    input: Record<string, unknown>,
    result: KeyCortexToolResult,
    answer: IdempotencyGateAnswer,
  ): Promise<void> {
    await this.emitBusinessEvent(ctx, name, input, result, 0, answer).catch((err) => {
      this.logger.warn(`Tool business-event emit failed: ${(err as Error).message}`);
    });
  }

  private validateInput(
    tool: KeyCortexToolDefinition,
    input: Record<string, unknown>,
  ): { valid: true; parsed: Record<string, unknown> } | { valid: false; error: string } {
    const required = tool.parameters.required ?? [];
    const missing = required.filter((key) => input[key] === undefined);
    if (missing.length > 0) {
      return { valid: false, error: `Missing required parameters: ${missing.join(', ')}` };
    }
    return { valid: true, parsed: input };
  }

  /**
   * The CortexActionLog row of one tool execution (V1-19c). Written through
   * the typed client, so a field the model lacks is a compile error: the
   * untyped write named `metadata`, which CortexActionLog has no column for,
   * so Prisma refused every row and no execution was ever audited.
   *
   * Only the model's columns are written. Dropped, because no column holds
   * them: the tool input (it can carry personal data and is never stored
   * here) and the autonomy level. Since an answer or an error can quote the
   * input, both are stored with the input's values taken out, and bounded
   * (auditResultText, auditErrorText: V1-19c review, SEC-V19c-1). The actor
   * is the caller's, else the request member's (auditActor, SEC-V19c-2).
   *
   * Never throws: a row that cannot be written costs the record, not the
   * tool's answer. It is logged at error with the business id and counted.
   */
  private async audit(
    ctx: KeyCortexToolContext,
    toolName: string,
    input: Record<string, unknown>,
    result: KeyCortexToolResult,
    startMs: number,
    durationMs: number,
  ): Promise<void> {
    try {
      const error = auditErrorText(result.error, input);
      await this.prisma.client.cortexActionLog.create({
        data: {
          businessId: ctx.businessId,
          userId: auditActor(ctx),
          sessionId: ctx.sessionId ?? ctx.correlationId ?? 'unknown',
          commandId: auditCommandId(ctx),
          correlationId: ctx.correlationId ?? null,
          proposalId: ctx.proposalId ?? null,
          actionType: toolName,
          status: result.success ? 'success' : 'error',
          description: result.success
            ? `Executed tool ${toolName}`
            : `Tool ${toolName} failed: ${error ?? 'unknown error'}`,
          result: auditResultText(result.data, input),
          error,
          requiresApproval: this.tools.get(toolName)?.requiresApproval ?? false,
          startedAt: new Date(startMs),
          completedAt: new Date(startMs + durationMs),
          durationMs,
          createdAt: new Date(),
        },
      });
    } catch (err: unknown) {
      this.auditWriteFailures += 1;
      this.logger.error(
        `[audit][${ctx.businessId}] CortexActionLog row for ${toolName} not written ` +
          `(${this.auditWriteFailures} audit write failure(s) in this process): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** How many CortexActionLog rows this process failed to write (V1-19c). */
  getAuditWriteFailureCount(): number {
    return this.auditWriteFailures;
  }

  /**
   * Emit a canonical BusinessEvent for every tool execution attempt.
   * Prefers KeyCortexAuditService (unified audit ledger) and falls back to
   * the KeyCortexEventBusService if the audit service is unavailable.
   */
  private async emitBusinessEvent(
    ctx: KeyCortexToolContext,
    toolName: string,
    input: Record<string, unknown>,
    result: KeyCortexToolResult,
    durationMs: number,
    gateAnswer?: IdempotencyGateAnswer,
  ): Promise<void> {
    const actorId = ctx.userId ?? 'key_ai';
    // A replay ran nothing: it is its own event, never counted as an execution.
    const replayed = gateAnswer === 'replayed';
    const metadata: Record<string, unknown> = {
      module: toolName.split('.')[0] ?? 'cortex',
      input,
      durationMs,
      autonomyLevel: ctx.autonomyLevel,
      riskTier: this.tools.get(toolName)?.riskTier,
      requiresApproval: result.requiresApproval ?? false,
      ...(ctx.idempotencyKey
        ? { idempotency: { key: ctx.idempotencyKey, ...(gateAnswer ? { answer: gateAnswer } : {}) } }
        : {}),
    };

    if (this.auditService) {
      await this.auditService.emit(
        replayed ? 'ACTION_REPLAYED' : result.success ? 'ACTION_EXECUTED' : 'ACTION_FAILED',
        toolName,
        'tool_execution',
        ctx.commandId ?? ctx.correlationId ?? ctx.sessionId ?? toolName,
        {
          businessId: ctx.businessId,
          actorType: ctx.userId ? 'human' : 'ai',
          actorId,
          source: 'ai',
          sessionId: ctx.sessionId,
          commandId: ctx.commandId,
          correlationId: ctx.correlationId,
          proposalId: ctx.proposalId,
          metadata,
        },
        { status: 'attempted' },
        {
          status: result.success ? 'success' : 'error',
          result: result.data,
          error: result.error,
          durationMs,
        },
      );
      // No `return` here. It used to sit inside this branch, and the audit
      // service is registered in the module — so it is always present, so the
      // event-bus emit below was unreachable in every real configuration and
      // tool.executed / tool.failed never reached the bus.
      //
      // These are two different sinks with two different jobs: the audit log is
      // the durable compliance record, the bus is how other cortex services
      // react in the moment. Doing one INSTEAD of the other was never the
      // intent — the branch is about whether the audit service exists, not
      // about suppressing the bus.
      //
      // Nothing subscribes to these events today, so this is the pathway being
      // correct rather than an outage being fixed. It matters when something
      // does: a subscriber added later would have failed silently and looked
      // like the subscriber's bug.
    }

    if (this.eventBus) {
      this.eventBus.emit({
        source: 'key_cortex_tool_registry',
        type: replayed ? 'tool.replayed' : result.success ? 'tool.executed' : 'tool.failed',
        businessId: ctx.businessId,
        userId: actorId,
        payload: {
          toolName,
          success: result.success,
          result: result.data,
          error: result.error,
          input,
          durationMs,
        },
        metadata: {
          correlationId: ctx.correlationId,
          sessionId: ctx.sessionId,
          commandId: ctx.commandId,
          entityType: 'tool_execution',
          entityId: ctx.commandId ?? ctx.correlationId ?? ctx.sessionId ?? toolName,
        },
      });
    }
  }
}
