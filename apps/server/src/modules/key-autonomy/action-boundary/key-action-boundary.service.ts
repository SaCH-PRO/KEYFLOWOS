import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AiExecutionLogService } from '../../ai/ai-execution-log.service';
import { AiOversightService } from '../../ai/ai-oversight.service';
import type { BusinessRole } from '../../ai/role-engine.service';
import { CapabilityContractService, type CapabilityDefinition } from '../../capabilities/capability-contract.service';
import { HelpdeskService } from '../../helpdesk/helpdesk.service';
import { TemporalFlowService } from '../../temporal-flow/temporal-flow.service';
import {
  ActionEnvelopeError,
  HELPDESK_CREATE_TICKET,
  buildHelpdeskCreateTicketEnvelope,
  fingerprintEnvelope,
  isBoundaryCapability,
  parseStoredEnvelope,
  type ActionEnvelope,
} from './action-envelope';
import {
  CONFIRMATION_TTL_MS,
  computeClearance,
  deriveControlRequirement,
  evidenceKindFor,
  isExecutionSurface,
  parseStoredEvidence,
  resolvePrincipalAuthority,
  tenantBindingOf,
  type ClearanceDecision,
  type ClearanceRefusalCode,
  type ControlEvidence,
  type ControlRequirement,
  type ExecutionSurface,
  type KeyAutonomyVerdict,
  type PrincipalAuthority,
} from './control-clearance';
import { compareWithLegacy, type ShadowComparison } from './shadow-parity';

/**
 * The KEY action boundary (KF-EXEC-ACTION-001), first adoption:
 * helpdesk_create_ticket.
 *
 *   CapabilityContract -> ActionEnvelope -> ControlRequirement
 *     -> ControlEvidence -> Clearance -> ExecutionClaim -> effect
 *     -> OutcomeEvidence
 *
 * WHAT IT REPLACES
 *
 * Eleven surfaces reached `executeToolAction` for this capability under five
 * different governance behaviours, two of them none at all. None carried a
 * human principal, a confirmation was a client boolean beside client-supplied
 * arguments, and nothing stopped two executors from each creating a ticket.
 *
 * WHAT IT REUSES
 *
 * No new table and no second registry. The action record is KeyActionProposal,
 * the capability identity is CapabilityContractService, KEY autonomy and
 * policy are AiOversightService, the approval tier is the frozen AUTH-001
 * rule, the execution claim is an IdempotencyKey row, and the ticket is
 * written by HelpdeskService.
 *
 * THE ONE RULE
 *
 * `admit` is the only code that writes a SupportTicket for this capability,
 * and it writes it inside the transaction that inserts the claim, after
 * re-reading on locked rows everything the clearance depends on. A status, an
 * approval flag or an earlier decision is never the clearance.
 */

/** What a surface knows about the action it is handing over. */
export interface ActionContext {
  surface: ExecutionSurface;
  /**
   * The authenticated human the surface established (AuthGuard, or a gateway
   * that verified membership at connect). Never a value from a request body
   * or a model. Absent on surfaces that have no such principal.
   */
  principalUserId?: string | null;
  /** A server-issued action id the caller already holds. */
  actionId?: string | null;
  /** KEY's inferred hats for the turn. They can only narrow autonomy. */
  crew?: readonly BusinessRole[];
  /** What distinguishes this request from an identical one (a tool-call id). */
  sourceId?: string | null;
  planId?: string | null;
  planStepId?: string | null;
  sessionId?: string | null;
  correlationId?: string | null;
}

export type ActionDisposition = 'CLEARABLE' | 'AWAITING_CONFIRMATION' | 'AWAITING_APPROVAL' | 'DENIED';

export interface PreparedAction {
  /** Null when nothing was recorded: a denial writes no row. */
  actionId: string | null;
  capability: string;
  fingerprint: string | null;
  requirement: ControlRequirement;
  disposition: ActionDisposition;
  shadow: ShadowComparison | null;
  /**
   * The request matched an action record that already carries evidence or an
   * outcome (a plan step being run again). Admission is worth attempting even
   * when `disposition` alone says to wait: it will read what is on record.
   */
  resumable: boolean;
}

export interface TicketOutcome {
  id: string;
  title: string;
  status: string;
}

export interface AdmissionOutcome {
  actionId: string;
  ticket: TicketOutcome;
  /** True when the action had already executed and this returned its record. */
  replayed: boolean;
}

export type ActionRefusalCode =
  | ClearanceRefusalCode
  | 'ACTION_NOT_FOUND'
  | 'ACTION_NOT_EXECUTABLE'
  | 'ACTION_ARGUMENTS_MISMATCH'
  | 'ACTION_ALREADY_RESOLVED'
  | 'EXECUTION_FAILED';

/**
 * The action did not execute. Thrown to the tool path, which reports it as a
 * failed tool call; nothing was written to the domain.
 */
export class ActionNotClearedError extends Error {
  /** A retry with the same inputs gives the same answer, so retry loops stop. */
  readonly retryable = false;

  constructor(
    readonly code: ActionRefusalCode,
    message: string,
    readonly actionId: string | null,
    readonly disposition: ActionDisposition,
    readonly requirement: ControlRequirement | null = null,
  ) {
    super(message);
    this.name = 'ActionNotClearedError';
  }
}

/** Raised inside the claim transaction to roll it back with a reason. */
class AdmissionRefused extends Error {
  constructor(
    readonly code: ActionRefusalCode,
    message: string,
    readonly reevaluate: boolean,
    readonly requirement: ControlRequirement | null,
  ) {
    super(message);
    this.name = 'AdmissionRefused';
  }
}

/** Raised inside the claim transaction when the domain write itself fails. */
class EffectFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EffectFailed';
  }
}

const EXECUTABLE_STATUSES = ['PENDING', 'APPROVED'];

/** Never read: a refusal for an untrusted tenant binding precedes the read. */
const UNEVALUATED_AUTONOMY: KeyAutonomyVerdict = {
  allowed: false,
  requiresQuickConfirm: false,
  requiresFormalApproval: false,
  requiresAdminApproval: false,
  tier: 0,
  reason: 'KEY autonomy was not evaluated',
};

/**
 * The claim identity of one business action. `idempotency_keys` is unique on
 * (business_id, idempotency_key), so inserting this row is the claim: it
 * either succeeds or fails, and there is no read before it.
 */
export function executionClaimKey(actionId: string): string {
  return `key-action-claim:${actionId}`;
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'P2002';
}

/**
 * Prisma "known request" codes are P2xxx. Three of them describe the
 * connection or the transaction, not the row: a pool timeout (P2024), a
 * transaction API error (P2028) and a write conflict or deadlock (P2034).
 * Those can succeed on a retry, so they are not a verdict on the action.
 */
const TRANSIENT_PRISMA_CODES: ReadonlySet<string> = new Set(['P2024', 'P2028', 'P2034']);

function isDeterministicWriteRejection(err: unknown): boolean {
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^P2\d{3}$/.test(code) && !TRANSIENT_PRISMA_CODES.has(code);
}

type BoundaryDb = PrismaService['client'];
type BoundaryTx = Parameters<Extract<Parameters<BoundaryDb['$transaction']>[0], (...args: any[]) => any>>[0];

interface FreshState {
  capability: CapabilityDefinition;
  envelope: ActionEnvelope;
  recomputedFingerprint: string;
  autonomy: KeyAutonomyVerdict;
  requirement: ControlRequirement;
  principals: Map<string, PrincipalAuthority>;
  approvalTimeoutHours: number;
}

@Injectable()
export class KeyActionBoundaryService {
  private readonly logger = new Logger(KeyActionBoundaryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  // Resolved at call time, like every other cross-module edge on the tool
  // path: AiModule, KeyAutonomyModule and KeyCortexModule forwardRef each other.
  private get capabilities(): CapabilityContractService {
    return this.moduleRef.get(CapabilityContractService, { strict: false });
  }
  private get oversight(): AiOversightService {
    return this.moduleRef.get(AiOversightService, { strict: false });
  }
  private get helpdesk(): HelpdeskService {
    return this.moduleRef.get(HelpdeskService, { strict: false });
  }

  /** Whether a tool name is governed here. */
  adopts(toolName: string | null | undefined): boolean {
    return isBoundaryCapability(toolName);
  }

  /**
   * The tool invocation a proposal-shaped record names.
   *
   * The identity is the tool, never `actionType`: an EXECUTE_TOOL proposal for
   * helpdesk_create_ticket is helpdesk_create_ticket. `payload.inputPayload`
   * is what PlanExecutorService writes and `payload.parameters` the older
   * key, in the order the executor plugin reads them.
   */
  resolveInvocation(record: {
    actionType?: string | null;
    toolName?: string | null;
    capabilityName?: string | null;
    payload?: unknown;
    inputPayload?: unknown;
  }): { toolName: string | null; args: unknown } {
    const payload =
      record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
        ? (record.payload as Record<string, unknown>)
        : {};
    const fromPayload = typeof payload.toolName === 'string' ? payload.toolName : null;
    const toolName = record.capabilityName ?? fromPayload ?? record.toolName ?? null;
    const args = payload.inputPayload ?? payload.parameters ?? record.inputPayload ?? {};
    return { toolName, args };
  }

  /** Whether a KeyActionProposal row is an action record of this boundary. */
  governs(record: {
    actionType?: string | null;
    toolName?: string | null;
    capabilityName?: string | null;
    payload?: unknown;
    inputPayload?: unknown;
  }): boolean {
    if (record.capabilityName) return this.adopts(record.capabilityName);
    if (record.actionType !== 'EXECUTE_TOOL') return false;
    return this.adopts(this.resolveInvocation(record).toolName);
  }

  private resolveCapability(name: string): CapabilityDefinition {
    const capability = this.adopts(name) ? this.capabilities.get(name) : null;
    if (!capability) {
      throw new ActionNotClearedError(
        'UNKNOWN_CAPABILITY',
        `No CapabilityContract resolves "${name}" at the action boundary`,
        null,
        'DENIED',
      );
    }
    return capability;
  }

  // ------------------------------------------------------------------ prepare

  /**
   * Record an action and say what control it needs. Never executes.
   */
  async prepare(
    businessId: string,
    capabilityName: string,
    rawArgs: unknown,
    ctx: ActionContext,
  ): Promise<PreparedAction> {
    const capability = this.resolveCapability(capabilityName);
    const surface = ctx.surface;

    if (tenantBindingOf(surface) === 'untrusted') {
      // Nothing is read or written for a tenant nobody proved: not the policy,
      // not a proposal row.
      const requirement = deriveControlRequirement({
        capability,
        surface,
        principal: null,
        autonomy: UNEVALUATED_AUTONOMY,
      });
      this.logger.warn(`[boundary] ${capability.name} refused on ${surface}: ${requirement.reason}`);
      return { actionId: null, capability: capability.name, fingerprint: null, requirement, disposition: 'DENIED', shadow: null, resumable: false };
    }

    const envelope = this.buildEnvelope(businessId, capability, rawArgs);
    const fingerprint = fingerprintEnvelope(envelope);

    const principal = ctx.principalUserId
      ? await this.readPrincipal(this.prisma.client, businessId, ctx.principalUserId)
      : null;
    const crew = ctx.crew?.length ? [...ctx.crew] : [];
    const autonomy = await this.oversight.evaluate(businessId, capability.name, undefined, crew.length ? crew : undefined);
    const requirement = deriveControlRequirement({ capability, surface, principal, autonomy });
    const shadow = compareWithLegacy(surface, autonomy, requirement);
    if (shadow.parity !== 'SAME') {
      this.logger.log(
        `[boundary][shadow] ${capability.name} on ${surface}: legacy ${shadow.legacy}, boundary ${shadow.boundary} (${shadow.parity})`,
      );
    }

    if (requirement.kind === 'DENY') {
      return { actionId: null, capability: capability.name, fingerprint, requirement, disposition: 'DENIED', shadow, resumable: false };
    }

    const recordedRequirement = { ...requirement, derivedAt: new Date().toISOString(), crew, shadow };
    const requestedBy = principal?.userId ?? null;

    // The action record this request already has, if it has one.
    //
    // A plan step is one action, whichever surface runs the step and however
    // often. Its record is found again whether it is waiting, cleared or
    // executed, so a step run again after its approval admits the approved
    // action, and a step run again after execution is given the recorded
    // ticket. Without this the plan runner's own resume (approve the proposal,
    // set the step pending, run it again) would file a fresh proposal every
    // time round and the approved action would never run.
    //
    // Anything else is matched only while it is still waiting, and only to the
    // same surface, requester and source: a surface that retries must not fill
    // the approval queue, and that is all this branch is for.
    const existing = await this.prisma.client.keyActionProposal.findFirst({
      where: ctx.planStepId
        ? {
            businessId,
            capabilityName: capability.name,
            actionFingerprint: fingerprint,
            planStepId: ctx.planStepId,
            status: { in: ['PENDING', 'APPROVED', 'EXECUTED'] },
          }
        : {
            businessId,
            capabilityName: capability.name,
            actionFingerprint: fingerprint,
            executionSurface: surface,
            status: 'PENDING',
            requestedBy,
            sourceId: ctx.sourceId ?? null,
            planStepId: null,
          },
      orderBy: { createdAt: 'desc' },
    });

    let actionId: string;
    let resumable = false;
    if (existing) {
      actionId = existing.id;
      // Evidence or an outcome is already on record. Admission decides what it
      // is worth now; this only says there is something there for it to read.
      resumable = existing.status !== 'PENDING';
      if (!resumable) {
        await this.prisma.client.keyActionProposal.update({
          where: { id: existing.id },
          data: { controlRequirement: recordedRequirement as unknown as Prisma.InputJsonValue },
        });
      }
    } else {
      const row = await this.prisma.client.keyActionProposal.create({
        data: {
          businessId,
          userId: requestedBy,
          sourceType: this.sourceTypeFor(surface),
          sourceId: ctx.sourceId ?? null,
          sourceMode: surface,
          title: `Create support ticket: ${envelope.material.title}`,
          summary: envelope.material.description,
          rationale: requirement.reason,
          actionType: 'EXECUTE_TOOL',
          payload: { toolName: capability.name, inputPayload: envelope.material } as unknown as Prisma.InputJsonValue,
          toolName: capability.name,
          module: capability.ownerModule,
          inputPayload: envelope.material as unknown as Prisma.InputJsonValue,
          planId: ctx.planId ?? null,
          planStepId: ctx.planStepId ?? null,
          sessionId: ctx.sessionId ?? null,
          correlationId: ctx.correlationId ?? null,
          riskLevel: capability.riskLevel.toUpperCase(),
          status: 'PENDING',
          requiresApproval: requirement.kind !== 'NONE',
          capabilityName: capability.name,
          capabilityVersion: capability.version,
          executionSurface: surface,
          actionEnvelope: envelope as unknown as Prisma.InputJsonValue,
          actionFingerprint: fingerprint,
          controlRequirement: recordedRequirement as unknown as Prisma.InputJsonValue,
          requestedBy,
          // The model proposed it on every surface but the graph route, where
          // the authenticated caller named the tool and its arguments.
          proposedBy: surface === 'GRAPH_ACTION' && requestedBy ? requestedBy : 'key_ai',
        },
      });
      actionId = row.id;
      if (requirement.kind === 'HUMAN_APPROVAL') this.announceProposal(businessId, actionId, surface);
    }

    return {
      actionId,
      capability: capability.name,
      fingerprint,
      requirement,
      disposition: this.dispositionOf(requirement),
      shadow,
      resumable,
    };
  }

  /**
   * The boundary columns for a proposal some other producer is creating
   * (a plan step, the pro-auto monitor, the cortex). Such a proposal has no
   * trusted requester, so it can only be cleared by a human approval.
   * Returns null when the proposal is not for an adopted capability.
   */
  sealProposal(
    businessId: string,
    record: { actionType?: string | null; toolName?: string | null; payload?: unknown; inputPayload?: unknown },
    proposedBy: string | null,
  ): Record<string, unknown> | null {
    if (!this.governs(record)) return null;
    const { toolName, args } = this.resolveInvocation(record);
    const capability = this.resolveCapability(toolName as string);
    const base = {
      capabilityName: capability.name,
      capabilityVersion: capability.version,
      executionSurface: 'PROPOSAL' satisfies ExecutionSurface,
      requestedBy: null,
      proposedBy: proposedBy ?? 'key_ai',
    };
    try {
      const envelope = this.buildEnvelope(businessId, capability, args);
      return {
        ...base,
        actionEnvelope: envelope as unknown as Prisma.InputJsonValue,
        actionFingerprint: fingerprintEnvelope(envelope),
      };
    } catch (err: unknown) {
      if (!(err instanceof ActionEnvelopeError)) throw err;
      // Recorded without an envelope. It can be seen and rejected; it can
      // never clear, because there is no fingerprint for evidence to name.
      this.logger.warn(`[boundary] proposal for ${capability.name} has no valid envelope: ${err.message}`);
      return base;
    }
  }

  // ----------------------------------------------------------------- evidence

  /**
   * Record ControlEvidence: `principalUserId` confirms or approves this exact
   * action. The principal is the authenticated caller, the fingerprint is the
   * server's, and the giver's authority is read here on locked rows.
   */
  async recordEvidence(businessId: string, actionId: string, principalUserId: string) {
    if (!principalUserId) throw new ForbiddenException('An authenticated user is required to confirm or approve');

    return this.prisma.client
      .$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM key_action_proposals WHERE id = ${actionId} AND business_id = ${businessId} FOR UPDATE`;
      const found = await tx.keyActionProposal.findFirst({ where: { id: actionId, businessId } });
      if (!found || !this.governs(found)) throw new NotFoundException('Action not found');
      if (!EXECUTABLE_STATUSES.includes(found.status)) {
        throw new ConflictException(`This action is already ${found.status.toLowerCase()}`);
      }
      const record = await this.sealIfUnsealed(tx, found);

      const fresh = await this.readFresh(tx, businessId, record, [principalUserId]);
      const giver = fresh.principals.get(principalUserId) as PrincipalAuthority;
      const admissible = evidenceKindFor(fresh.requirement, giver, {
        requesterUserId: record.requestedBy,
        capabilityTier: fresh.capability.riskTier,
      });
      if ('refused' in admissible) throw new ForbiddenException(admissible.refused);

      const now = new Date();
      const ttlMs =
        admissible.kind === 'CONFIRMATION' ? CONFIRMATION_TTL_MS : fresh.approvalTimeoutHours * 60 * 60 * 1000;
      const expiresAt = new Date(now.getTime() + ttlMs);
      const evidence: ControlEvidence = {
        v: 1,
        kind: admissible.kind,
        fingerprint: fresh.recomputedFingerprint,
        principalUserId,
        issuedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        assumptions: {
          basis: giver.basis,
          membershipId: giver.membershipId,
          approvalTier: giver.approvalTier,
        },
      };

      return tx.keyActionProposal.update({
        where: { id: actionId },
        data: {
          status: 'APPROVED',
          approvedBy: principalUserId,
          approvedAt: now,
          resolvedByUserId: principalUserId,
          controlEvidence: evidence as unknown as Prisma.InputJsonValue,
          evidenceExpiresAt: expiresAt,
        },
      });
      })
      .catch((err: unknown) => {
        // readFresh refuses an unreadable or foreign envelope; here that is a
        // request that cannot be honoured, not an admission.
        if (err instanceof AdmissionRefused) throw new BadRequestException(err.message);
        throw err;
      });
  }

  /**
   * Reject or cancel an action. It takes the same claim an execution takes, so
   * exactly one of executed, rejected and cancelled can ever be recorded.
   */
  async voidAction(
    businessId: string,
    actionId: string,
    resolution: 'REJECTED' | 'CANCELLED',
    by: string | null,
    reason?: string | null,
    opts: { onlyIfRequestedBy?: string } = {},
  ) {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        await tx.idempotencyKey.create({
          data: { businessId, idempotencyKey: executionClaimKey(actionId), status: 'voided', error: resolution },
        });
        const record = await tx.keyActionProposal.findFirst({ where: { id: actionId, businessId } });
        if (!record || !this.governs(record)) throw new NotFoundException('Action not found');
        if (opts.onlyIfRequestedBy && record.requestedBy !== opts.onlyIfRequestedBy) {
          // Not-found, not forbidden: the id of someone else's action is not
          // confirmed to exist.
          throw new NotFoundException('Action not found');
        }
        if (!EXECUTABLE_STATUSES.includes(record.status)) {
          throw new ConflictException(`This action is already ${record.status.toLowerCase()}`);
        }
        const now = new Date();
        return tx.keyActionProposal.update({
          where: { id: actionId },
          data:
            resolution === 'REJECTED'
              ? { status: 'REJECTED', rejectedBy: by, rejectedAt: now, rejectionReason: reason ?? null }
              : { status: 'CANCELLED' },
        });
      });
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('This action has already been executed or resolved');
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------- admit

  /**
   * The claim transaction. The only writer of a SupportTicket for this
   * capability.
   */
  async admit(
    businessId: string,
    actionId: string,
    opts: {
      executedBy?: string | null;
      expectedArgs?: unknown;
      /**
       * Write the AiExecutionLog row for this execution. The tool path does
       * not ask for it, because `executeTool` writes that row itself; the
       * confirm route and the proposal route do, because they no longer pass
       * through `executeTool` and the row would otherwise disappear.
       */
      log?: boolean;
    } = {},
  ): Promise<AdmissionOutcome> {
    const startedAt = Date.now();
    let committed: { ticket: any; material: ActionEnvelope['material'] };
    try {
      committed = await this.prisma.client.$transaction(async (tx) => {
        // 1. The claim. Insert-or-fail on the unique (business, action) key; a
        //    concurrent executor waits on the index and then fails here.
        const claimKey = executionClaimKey(actionId);
        await tx.idempotencyKey.create({
          data: { businessId, idempotencyKey: claimKey, status: 'claimed' },
        });

        // 2. The action record, as committed.
        const record = await tx.keyActionProposal.findFirst({ where: { id: actionId, businessId } });
        if (!record || !this.governs(record)) {
          throw new AdmissionRefused('ACTION_NOT_FOUND', 'Action not found', false, null);
        }
        if (!EXECUTABLE_STATUSES.includes(record.status)) {
          throw new AdmissionRefused(
            'ACTION_NOT_EXECUTABLE',
            `This action is ${record.status.toLowerCase()} and cannot be executed`,
            false,
            null,
          );
        }

        // 3. Everything the clearance depends on, re-read on locked rows.
        const evidence = parseStoredEvidence(record.controlEvidence);
        const fresh = await this.readFresh(tx, businessId, record, evidence ? [evidence.principalUserId] : []);
        const evidencePrincipal = evidence ? (fresh.principals.get(evidence.principalUserId) ?? null) : null;

        if (opts.expectedArgs !== undefined) {
          const presented = fingerprintEnvelope(this.buildEnvelope(businessId, fresh.capability, opts.expectedArgs));
          if (presented !== fresh.recomputedFingerprint) {
            throw new AdmissionRefused(
              'ACTION_ARGUMENTS_MISMATCH',
              'The arguments presented are not the ones recorded for this action',
              false,
              fresh.requirement,
            );
          }
        }

        // 4. Clearance, now.
        const clearance: ClearanceDecision = computeClearance({
          requirement: fresh.requirement,
          storedFingerprint: record.actionFingerprint,
          recomputedFingerprint: fresh.recomputedFingerprint,
          evidence,
          evidencePrincipal,
          now: new Date(),
        });
        if (!clearance.cleared) {
          throw new AdmissionRefused(clearance.code, clearance.reason, clearance.reevaluate, clearance.requirement);
        }

        // 5. The effect, on this transaction.
        const material = fresh.envelope.material;
        if (material.contactId) {
          const contact = await tx.contact.findFirst({
            where: { id: material.contactId, businessId },
            select: { id: true },
          });
          if (!contact) throw new EffectFailed('The contact for this ticket does not exist in this business');
        }
        let ticket: any;
        try {
          ticket = await this.helpdesk.createTicketRow(tx, businessId, {
            title: material.title,
            description: material.description ?? undefined,
            contactId: material.contactId ?? undefined,
            priority: material.priority,
            source: material.source,
          });
        } catch (err: unknown) {
          // Only a write the database deterministically rejected is a FAILED
          // outcome. Anything else (a dropped connection, a timeout, the
          // process dying) says nothing about the action: it rolls back with
          // the claim and the action stays executable.
          if (isDeterministicWriteRejection(err)) {
            throw new EffectFailed(err instanceof Error ? err.message : String(err));
          }
          throw err;
        }

        // 6. Outcome evidence, written with the effect it describes.
        const now = new Date();
        const executedBy = opts.executedBy ?? clearance.approvedBy ?? record.requestedBy ?? 'key_ai';
        const principalChain = {
          requestedBy: record.requestedBy,
          proposedBy: record.proposedBy,
          approvedBy: clearance.approvedBy,
          // On whose authority it ran: the human who cleared it, else the
          // requester KEY autonomy acted for.
          executedFor: clearance.approvedBy ?? record.requestedBy,
          executedBy,
        };
        const outcomeEvidence = {
          v: 1,
          status: 'SUCCEEDED',
          capability: fresh.capability.name,
          fingerprint: fresh.recomputedFingerprint,
          claimKey,
          clearance: clearance.basis,
          entity: { type: 'supportTicket', id: ticket.id },
          principalChain,
          committedAt: now.toISOString(),
        };
        await tx.keyActionProposal.update({
          where: { id: actionId },
          data: {
            status: 'EXECUTED',
            approvedBy: principalChain.approvedBy,
            executedFor: principalChain.executedFor,
            executedBy,
            executedAt: now,
            executionResult: { id: ticket.id, title: ticket.title, status: ticket.status },
            failureReason: null,
            outcomeEvidence: outcomeEvidence as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.idempotencyKey.update({
          where: { businessId_idempotencyKey: { businessId, idempotencyKey: claimKey } },
          data: {
            status: 'completed',
            requestHash: fresh.recomputedFingerprint,
            response: { actionId, supportTicketId: ticket.id } as Prisma.InputJsonValue,
          },
        });

        return { ticket, material };
      });
    } catch (err: unknown) {
      if (isUniqueViolation(err)) return this.replayOrRefuse(businessId, actionId);
      if (err instanceof AdmissionRefused) throw await this.recordRefusal(businessId, actionId, err);
      if (err instanceof EffectFailed) throw await this.recordFailure(businessId, actionId, err.message);
      // Anything else (a lost connection, a crash) rolled the claim back with
      // the rest. Nothing is recorded, so the action is still executable.
      throw err;
    }

    // After the commit, never before: an event for a ticket that rolled back
    // would be an event for a ticket that never existed.
    try {
      this.helpdesk.emitTicketCreated(businessId, committed.ticket, {
        contactId: committed.material.contactId ?? undefined,
        priority: committed.material.priority,
      });
    } catch (err: unknown) {
      this.logger.warn(`[boundary] supportTicket.created emit failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const { id, title, status } = committed.ticket;
    if (opts.log) this.logExecution(businessId, committed.material, { id, title, status }, Date.now() - startedAt);
    return { actionId, ticket: { id, title, status }, replayed: false };
  }

  /**
   * The supplementary AiExecutionLog row. Best effort, as it is on the tool
   * path: the outcome evidence written with the ticket is the record.
   */
  private logExecution(
    businessId: string,
    material: ActionEnvelope['material'],
    ticket: TicketOutcome,
    durationMs: number,
  ): void {
    try {
      const log = this.moduleRef.get(AiExecutionLogService, { strict: false });
      void log
        .logToolExecution(businessId, HELPDESK_CREATE_TICKET, { ...material }, ticket, true, durationMs, {
          riskTier: this.capabilities.get(HELPDESK_CREATE_TICKET)?.riskTier,
        })
        .catch((err: unknown) =>
          this.logger.warn(`[boundary] execution log failed: ${err instanceof Error ? err.message : String(err)}`),
        );
    } catch (err: unknown) {
      this.logger.warn(`[boundary] execution log unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** The claim already exists: return what it recorded, or say why not. */
  private async replayOrRefuse(businessId: string, actionId: string): Promise<AdmissionOutcome> {
    const record = await this.prisma.client.keyActionProposal.findFirst({ where: { id: actionId, businessId } });
    const result = record?.executionResult as Partial<TicketOutcome> | null | undefined;
    if (record?.status === 'EXECUTED' && result?.id) {
      return {
        actionId,
        ticket: { id: result.id, title: String(result.title ?? ''), status: String(result.status ?? '') },
        replayed: true,
      };
    }
    throw new ActionNotClearedError(
      'ACTION_ALREADY_RESOLVED',
      `This action has already been ${record ? record.status.toLowerCase() : 'resolved'}`,
      actionId,
      'DENIED',
    );
  }

  private async recordRefusal(businessId: string, actionId: string, refusal: AdmissionRefused): Promise<ActionNotClearedError> {
    // A caller that presented the wrong arguments learns nothing and changes
    // nothing: the action it named is still whatever it was.
    const leavesRecordAlone: ActionRefusalCode[] = ['ACTION_NOT_FOUND', 'ACTION_NOT_EXECUTABLE', 'ACTION_ARGUMENTS_MISMATCH'];
    if (!leavesRecordAlone.includes(refusal.code)) {
      // Bookkeeping, outside the rolled-back transaction and guarded by
      // status so it cannot overwrite a concurrent execution.
      await this.prisma.client.keyActionProposal
        .updateMany({
          where: { id: actionId, businessId, status: { in: EXECUTABLE_STATUSES } },
          data: refusal.reevaluate
            ? // The evidence on record no longer clears it: back to waiting.
              { status: 'PENDING', failureReason: refusal.message }
            : { status: 'BLOCKED', failureReason: refusal.message },
        })
        .catch((e: unknown) =>
          this.logger.warn(`[boundary] could not record refusal for ${actionId}: ${e instanceof Error ? e.message : String(e)}`),
        );
    }
    const requirement = refusal.requirement;
    const disposition: ActionDisposition = refusal.reevaluate && requirement ? this.dispositionOf(requirement, true) : 'DENIED';
    return new ActionNotClearedError(refusal.code, refusal.message, actionId, disposition, requirement);
  }

  private async recordFailure(businessId: string, actionId: string, message: string): Promise<ActionNotClearedError> {
    await this.prisma.client.keyActionProposal
      .updateMany({
        where: { id: actionId, businessId, status: { in: EXECUTABLE_STATUSES } },
        data: {
          status: 'FAILED',
          failureReason: message,
          outcomeEvidence: { v: 1, status: 'FAILED', reason: message, entity: null } as Prisma.InputJsonValue,
        },
      })
      .catch((e: unknown) =>
        this.logger.warn(`[boundary] could not record failure for ${actionId}: ${e instanceof Error ? e.message : String(e)}`),
      );
    return new ActionNotClearedError('EXECUTION_FAILED', message, actionId, 'DENIED');
  }

  // --------------------------------------------------------- surface entries

  /**
   * The tool path. `FlowOrchestratorService.executeToolAction` calls this for
   * the capability and nothing else, so every surface that reaches the
   * executor reaches the boundary.
   */
  async executeFromTool(
    businessId: string,
    capabilityName: string,
    rawArgs: unknown,
    ctx?: ActionContext | null,
  ): Promise<TicketOutcome> {
    const context: ActionContext = ctx && isExecutionSurface(ctx.surface) ? ctx : { surface: 'UNDECLARED' };

    if (context.actionId) {
      // A server-issued id. The arguments that came with it must be the ones
      // recorded for it, or it is a different action wearing this id.
      const outcome = await this.admit(businessId, context.actionId, {
        executedBy: context.principalUserId ?? null,
        expectedArgs: rawArgs,
      });
      return outcome.ticket;
    }

    const prepared = await this.prepare(businessId, capabilityName, rawArgs, context);
    if (!prepared.actionId || !(prepared.disposition === 'CLEARABLE' || prepared.resumable)) {
      throw this.notCleared(prepared);
    }
    const outcome = await this.admit(businessId, prepared.actionId, { executedBy: context.principalUserId ?? null });
    return outcome.ticket;
  }

  /**
   * E3. The caller presents a server-issued confirmation id and nothing else;
   * the action is the one the server recorded under it.
   */
  async confirmAndExecute(businessId: string, actionId: string, principalUserId: string): Promise<AdmissionOutcome> {
    await this.recordEvidence(businessId, actionId, principalUserId);
    return this.admit(businessId, actionId, { executedBy: principalUserId, log: true });
  }

  notCleared(prepared: PreparedAction): ActionNotClearedError {
    const { requirement } = prepared;
    const code: ActionRefusalCode = requirement.kind === 'DENY' ? requirement.code : 'CONTROL_EVIDENCE_REQUIRED';
    const message =
      requirement.kind === 'DENY'
        ? `Not executed: ${requirement.reason}`
        : requirement.kind === 'HUMAN_APPROVAL'
          ? `Not executed: this ticket has been sent for approval (proposal ${prepared.actionId}). ${requirement.reason}`
          : `Not executed: this ticket needs confirmation before it is created (action ${prepared.actionId}). ${requirement.reason}`;
    return new ActionNotClearedError(code, message, prepared.actionId, prepared.disposition, requirement);
  }

  // ---------------------------------------------------------------- internals

  /**
   * The same 'key.action.proposed' event KeyActionProposalService emits for a
   * proposal it creates, so a human proposal filed here reaches the people who
   * can approve it. Best effort: the proposal row is the record either way.
   */
  private announceProposal(businessId: string, actionId: string, surface: ExecutionSurface): void {
    try {
      const temporal = this.moduleRef.get(TemporalFlowService, { strict: false });
      void temporal
        .emit({
          businessId,
          source: 'KEY',
          type: 'key.action.proposed',
          module: 'key-autonomy',
          entityType: 'key_action_proposal',
          entityId: actionId,
          title: 'KEY action proposed',
          summary: 'Action EXECUTE_TOOL',
          importance: 'NORMAL',
          payload: { actionType: 'EXECUTE_TOOL', sourceMode: surface, requiresApproval: true },
        })
        .catch((err: unknown) =>
          this.logger.warn(`[boundary] proposal announce failed: ${err instanceof Error ? err.message : String(err)}`),
        );
    } catch (err: unknown) {
      this.logger.warn(`[boundary] proposal announce unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private dispositionOf(requirement: ControlRequirement, evidenceWasInsufficient = false): ActionDisposition {
    switch (requirement.kind) {
      case 'DENY':
        return 'DENIED';
      case 'HUMAN_APPROVAL':
        return 'AWAITING_APPROVAL';
      case 'PRINCIPAL_CONFIRMATION':
        return 'AWAITING_CONFIRMATION';
      case 'NONE':
        return evidenceWasInsufficient ? 'AWAITING_CONFIRMATION' : 'CLEARABLE';
    }
  }

  private sourceTypeFor(surface: ExecutionSurface): string {
    if (surface === 'PLAN_HTTP' || surface === 'PLAN_QUEUE') return 'PLAN_STEP';
    if (surface === 'PRO_AUTO_MONITOR') return 'PRO_AUTO';
    return 'KEY_CORTEX';
  }

  private buildEnvelope(businessId: string, capability: CapabilityDefinition, rawArgs: unknown): ActionEnvelope {
    try {
      return buildHelpdeskCreateTicketEnvelope({ businessId, capabilityVersion: capability.version, rawArgs });
    } catch (err: unknown) {
      if (err instanceof ActionEnvelopeError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /**
   * A proposal created before it could be sealed (an older row, or a producer
   * that bypassed KeyActionProposalService.create). Sealed once, from its
   * stored payload, before any evidence is bound to it.
   */
  private async sealIfUnsealed(tx: BoundaryTx, record: any): Promise<any> {
    if (record.actionFingerprint && record.capabilityName) return record;
    const sealed = this.sealProposal(record.businessId, record, record.userId ?? null);
    if (!sealed || !('actionFingerprint' in sealed)) {
      throw new BadRequestException('This action has no valid parameters and cannot be approved');
    }
    return tx.keyActionProposal.update({ where: { id: record.id }, data: sealed as Prisma.KeyActionProposalUncheckedUpdateInput });
  }

  private async readPrincipal(
    client: Pick<BoundaryTx, 'user' | 'business' | 'membership'>,
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
   * Lock, then read, everything a clearance depends on: the policy rows, the
   * business, and for each principal the user and the membership.
   *
   * FOR SHARE, so a revocation or a policy change that has committed is what
   * the read returns, and one that has not committed waits for this
   * transaction. A principal's authority at admission is therefore the
   * authority that is current when the claim commits.
   */
  private async readFresh(tx: BoundaryTx, businessId: string, record: any, evidenceGivers: string[]): Promise<FreshState> {
    const { toolName } = this.resolveInvocation(record);
    const capability = this.resolveCapability(toolName as string);

    let envelope: ActionEnvelope;
    try {
      envelope = parseStoredEnvelope(record.actionEnvelope);
    } catch (err: unknown) {
      throw new AdmissionRefused(
        'ENVELOPE_MUTATED',
        err instanceof Error ? err.message : 'The stored action envelope is unreadable',
        false,
        null,
      );
    }
    if (envelope.businessId !== businessId || envelope.capability !== capability.name) {
      throw new AdmissionRefused('ENVELOPE_MUTATED', 'The stored action envelope names another business or capability', false, null);
    }
    const recomputedFingerprint = fingerprintEnvelope(envelope);

    const userIds = [...new Set([record.requestedBy, ...evidenceGivers].filter((id): id is string => !!id))].sort();

    await tx.$queryRaw`SELECT id FROM autopilot_settings WHERE business_id = ${businessId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM ai_memories WHERE business_id = ${businessId} AND category = 'settings' AND key = 'autonomy' FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM businesses WHERE id = ${businessId} FOR SHARE`;
    for (const userId of userIds) {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM memberships WHERE user_id = ${userId} AND business_id = ${businessId} FOR SHARE`;
    }

    const principals = new Map<string, PrincipalAuthority>();
    for (const userId of userIds) {
      principals.set(userId, await this.readPrincipal(tx, businessId, userId));
    }

    const stored = (record.controlRequirement ?? {}) as { crew?: unknown };
    const crew = Array.isArray(stored.crew) ? (stored.crew.filter((r) => typeof r === 'string') as BusinessRole[]) : [];
    const autonomy = await this.oversight.evaluate(
      businessId,
      capability.name,
      undefined,
      crew.length ? crew : undefined,
      undefined,
      tx,
    );
    const settings = await this.oversight.getAutonomySettings(businessId, tx);

    const surface: ExecutionSurface = isExecutionSurface(record.executionSurface) ? record.executionSurface : 'UNDECLARED';
    const requirement = deriveControlRequirement({
      capability,
      surface,
      principal: record.requestedBy ? (principals.get(record.requestedBy) ?? null) : null,
      autonomy,
    });

    return {
      capability,
      envelope,
      recomputedFingerprint,
      autonomy,
      requirement,
      principals,
      approvalTimeoutHours: Number(settings.approvalTimeoutHours) > 0 ? Number(settings.approvalTimeoutHours) : 24,
    };
  }
}
