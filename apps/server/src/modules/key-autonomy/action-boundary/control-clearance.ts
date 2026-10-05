import { MAX_APPROVAL_TIER } from '../../../core/authority/module-vocabulary';
import { resolveMembershipApprovalTier } from '../../../core/authority/approval-tier';

/**
 * ControlRequirement, ControlEvidence and Clearance (KF-EXEC-ACTION-001).
 *
 * Everything here is a pure function of values the caller read. The boundary
 * service runs them twice: once when an action is recorded, to tell the caller
 * what control it needs, and once inside the claim transaction, on rows it has
 * just locked. Only the second run admits anything.
 *
 * THREE THINGS THAT WERE ONE
 *
 * The risk tier used to be the control requirement (tier 2 meant "quick
 * confirm" on every surface, for every caller), and a client boolean used to
 * be the clearance. They are separate here:
 *
 *   ControlRequirement  what control this action needs, from the capability,
 *                       the principal's authority, KEY autonomy and policy,
 *                       and the surface it arrived on.
 *   ControlEvidence     that the control happened: server-issued, bound to the
 *                       action fingerprint and to the principal who gave it.
 *   Clearance           whether the evidence satisfies the requirement NOW.
 */

/** Where an action entered. Names follow the characterization's E1 to E11. */
export const EXECUTION_SURFACES = [
  'CHAT', // E1
  'CHAT_STREAM', // E2
  'CHAT_CONFIRM', // E3
  'PHONE_STREAM', // E4
  'INBOUND_CONVERSATION', // E5
  'PLAN_HTTP', // E6
  'PLAN_QUEUE', // E7
  'PROPOSAL', // E8
  'CORTEX_BRIDGE', // E9
  'GRAPH_ACTION', // E10
  'CUSTOM_LOGIC', // E11
  'PRO_AUTO_MONITOR',
  'UNDECLARED',
] as const;
export type ExecutionSurface = (typeof EXECUTION_SURFACES)[number];

export function isExecutionSurface(value: unknown): value is ExecutionSurface {
  return typeof value === 'string' && (EXECUTION_SURFACES as readonly string[]).includes(value);
}

/**
 * Surfaces whose business id nobody proved.
 *
 * PHONE_STREAM takes its tenant from the query string of an unauthenticated
 * WebSocket upgrade (finding D1, open under VOICE). UNDECLARED is a caller
 * that passed no action context at all: a surface added later without one
 * lands here and is refused, which is the safe direction to forget in.
 */
const UNTRUSTED_TENANT_SURFACES: ReadonlySet<ExecutionSurface> = new Set(['PHONE_STREAM', 'UNDECLARED']);

export function tenantBindingOf(surface: ExecutionSurface): 'trusted' | 'untrusted' {
  return UNTRUSTED_TENANT_SURFACES.has(surface) ? 'untrusted' : 'trusted';
}

// ---------------------------------------------------------------- principal

export interface PrincipalRows {
  userId: string;
  /** Null when no such user row exists. */
  user: { role: string | null; deletedAt: Date | null; bannedAt: Date | null } | null;
  /** Null when the business does not exist or is deleted. */
  business: { ownerId: string } | null;
  membership: { id: string; role: string; maxApprovalTier: number | null; permissionScopes: unknown } | null;
}

export interface PrincipalAuthority {
  userId: string;
  /**
   * The manual-equivalent rule, which is what BusinessGuard enforces on the
   * human helpdesk route: SUPER_ADMIN, a Membership, or Business.ownerId.
   */
  basis: 'super_admin' | 'membership' | 'owner_without_membership' | 'none';
  membershipId: string | null;
  membershipRole: string | null;
  /**
   * The frozen AUTH-001 rule for a Membership. SUPER_ADMIN is the maximum, as
   * AiOversightService.resolveApproval treats it. An owner with no Membership
   * row is 0: that same method refuses an approver who has no Membership.
   */
  approvalTier: number;
}

export function resolvePrincipalAuthority(rows: PrincipalRows): PrincipalAuthority {
  const none: PrincipalAuthority = {
    userId: rows.userId,
    basis: 'none',
    membershipId: null,
    membershipRole: null,
    approvalTier: 0,
  };
  if (!rows.user || rows.user.deletedAt || rows.user.bannedAt) return none;
  if (!rows.business) return none;

  if (rows.user.role === 'SUPER_ADMIN') {
    return { ...none, basis: 'super_admin', approvalTier: MAX_APPROVAL_TIER };
  }
  if (rows.membership) {
    return {
      userId: rows.userId,
      basis: 'membership',
      membershipId: rows.membership.id,
      membershipRole: rows.membership.role,
      approvalTier: resolveMembershipApprovalTier(rows.membership).tier,
    };
  }
  if (rows.business.ownerId === rows.userId) {
    return { ...none, basis: 'owner_without_membership' };
  }
  return none;
}

// --------------------------------------------------------- control requirement

/** AiOversightService's decision, evaluated for the real capability name. */
export interface KeyAutonomyVerdict {
  allowed: boolean;
  requiresQuickConfirm: boolean;
  requiresFormalApproval: boolean;
  requiresAdminApproval: boolean;
  tier: number;
  reason: string;
}

export type ControlDenialCode =
  | 'UNKNOWN_CAPABILITY'
  | 'UNTRUSTED_TENANT_BINDING'
  | 'BLOCKED_BY_POLICY'
  | 'PRINCIPAL_NOT_AUTHORIZED';

export type ControlRequirement =
  | { kind: 'DENY'; code: ControlDenialCode; reason: string }
  | { kind: 'NONE'; reason: string }
  | {
      kind: 'PRINCIPAL_CONFIRMATION';
      /** The requesting principal, who must confirm this exact envelope. */
      principalUserId: string;
      /** An approval at this tier or above satisfies the requirement too. */
      approvalTierFloor: number;
      reason: string;
    }
  | { kind: 'HUMAN_APPROVAL'; minApprovalTier: number; reason: string };

export interface ControlRequirementInput {
  /** Null when the name did not resolve in the CapabilityContract. */
  capability: { name: string; riskTier: number } | null;
  surface: ExecutionSurface;
  /** The requesting principal's authority, or null when the surface has none. */
  principal: PrincipalAuthority | null;
  autonomy: KeyAutonomyVerdict;
}

export function deriveControlRequirement(input: ControlRequirementInput): ControlRequirement {
  const { capability, surface, principal, autonomy } = input;

  if (!capability) {
    return { kind: 'DENY', code: 'UNKNOWN_CAPABILITY', reason: 'No CapabilityContract resolves this action' };
  }
  if (tenantBindingOf(surface) === 'untrusted') {
    return {
      kind: 'DENY',
      code: 'UNTRUSTED_TENANT_BINDING',
      reason: `${capability.name} cannot run from ${surface}: nothing on that surface proves the business or the actor`,
    };
  }
  if (!autonomy.allowed) {
    return { kind: 'DENY', code: 'BLOCKED_BY_POLICY', reason: autonomy.reason };
  }

  // KEY autonomy is not a substitute for human authority. With no trusted
  // principal the action can only become a proposal for a human, whatever the
  // autonomy level says it may auto-execute.
  if (!principal) {
    return {
      kind: 'HUMAN_APPROVAL',
      minApprovalTier: capability.riskTier,
      reason: `${capability.name} arrived on ${surface} with no trusted principal; a human with approval tier ${capability.riskTier} or higher must approve it`,
    };
  }
  if (principal.basis === 'none') {
    return {
      kind: 'DENY',
      code: 'PRINCIPAL_NOT_AUTHORIZED',
      reason: 'The requesting user has no authority in this business',
    };
  }

  if (autonomy.requiresAdminApproval || autonomy.requiresFormalApproval) {
    return { kind: 'HUMAN_APPROVAL', minApprovalTier: capability.riskTier, reason: autonomy.reason };
  }
  if (autonomy.requiresQuickConfirm) {
    return {
      kind: 'PRINCIPAL_CONFIRMATION',
      principalUserId: principal.userId,
      approvalTierFloor: capability.riskTier,
      reason: autonomy.reason,
    };
  }
  return { kind: 'NONE', reason: autonomy.reason };
}

/** Strictness order, for telling "tightened" from "relaxed". */
const REQUIREMENT_RANK: Record<ControlRequirement['kind'], number> = {
  NONE: 0,
  PRINCIPAL_CONFIRMATION: 1,
  HUMAN_APPROVAL: 2,
  DENY: 3,
};

export function isStricter(now: ControlRequirement, before: ControlRequirement): boolean {
  return REQUIREMENT_RANK[now.kind] > REQUIREMENT_RANK[before.kind];
}

// ------------------------------------------------------------ control evidence

export interface ControlEvidence {
  v: 1;
  kind: 'CONFIRMATION' | 'APPROVAL';
  /** The fingerprint of the envelope this evidence is for. */
  fingerprint: string;
  /** The authenticated principal who gave it. Never taken from a request body. */
  principalUserId: string;
  issuedAt: string;
  expiresAt: string;
  /** The giver's authority when the evidence was issued. */
  assumptions: {
    basis: PrincipalAuthority['basis'];
    membershipId: string | null;
    approvalTier: number;
  };
}

export function parseStoredEvidence(stored: unknown): ControlEvidence | null {
  const e = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, any>) : null;
  if (!e) return null;
  const a = e.assumptions;
  const wellFormed =
    e.v === 1 &&
    (e.kind === 'CONFIRMATION' || e.kind === 'APPROVAL') &&
    typeof e.fingerprint === 'string' &&
    typeof e.principalUserId === 'string' &&
    e.principalUserId !== '' &&
    typeof e.issuedAt === 'string' &&
    typeof e.expiresAt === 'string' &&
    a &&
    typeof a === 'object' &&
    typeof a.basis === 'string' &&
    typeof a.approvalTier === 'number';
  // Malformed evidence is no evidence. It is never repaired into something
  // that might clear.
  return wellFormed ? (e as ControlEvidence) : null;
}

/** A requester's confirmation is short-lived: it answers a question just asked. */
export const CONFIRMATION_TTL_MS = 15 * 60 * 1000;

/**
 * Whether this principal may give the evidence this requirement asks for.
 *
 * `whenNoneRequired` covers a human who confirms or approves an action that
 * KEY autonomy would clear without them. The evidence is still recorded, and
 * it is still held to the rule that would have applied.
 */
export function evidenceKindFor(
  requirement: ControlRequirement,
  giver: PrincipalAuthority,
  whenNoneRequired?: { requesterUserId: string | null; capabilityTier: number },
): { kind: ControlEvidence['kind'] } | { refused: string } {
  if (requirement.kind === 'DENY') return { refused: requirement.reason };
  if (giver.basis === 'none') return { refused: 'You have no authority in this business' };

  if (requirement.kind === 'NONE') {
    if (!whenNoneRequired) return { refused: 'This action needs no confirmation or approval' };
    if (whenNoneRequired.requesterUserId && giver.userId === whenNoneRequired.requesterUserId) {
      return { kind: 'CONFIRMATION' };
    }
    if (giver.approvalTier >= whenNoneRequired.capabilityTier) return { kind: 'APPROVAL' };
    return {
      refused: `Approving this action requires approval tier ${whenNoneRequired.capabilityTier} or higher (you have tier ${giver.approvalTier})`,
    };
  }

  if (requirement.kind === 'PRINCIPAL_CONFIRMATION') {
    if (giver.userId === requirement.principalUserId) return { kind: 'CONFIRMATION' };
    if (giver.approvalTier >= requirement.approvalTierFloor) return { kind: 'APPROVAL' };
    return {
      refused: `Only the requester, or an approver with tier ${requirement.approvalTierFloor} or higher, can clear this action (you have tier ${giver.approvalTier})`,
    };
  }
  if (giver.approvalTier >= requirement.minApprovalTier) return { kind: 'APPROVAL' };
  return {
    refused: `This action requires approval tier ${requirement.minApprovalTier} or higher (you have tier ${giver.approvalTier})`,
  };
}

// ------------------------------------------------------------------ clearance

export type ClearanceRefusalCode =
  | ControlDenialCode
  | 'ENVELOPE_MUTATED'
  | 'CONTROL_EVIDENCE_REQUIRED'
  | 'EVIDENCE_FINGERPRINT_MISMATCH'
  | 'EVIDENCE_EXPIRED'
  | 'EVIDENCE_PRINCIPAL_REVOKED'
  | 'EVIDENCE_AUTHORITY_CHANGED'
  | 'EVIDENCE_INSUFFICIENT';

export type ClearanceDecision =
  | {
      cleared: true;
      basis: 'NO_CONTROL_REQUIRED' | 'CONFIRMED' | 'APPROVED';
      requirement: ControlRequirement;
      /** Who gave the evidence; null when none was required. */
      approvedBy: string | null;
    }
  | {
      cleared: false;
      code: ClearanceRefusalCode;
      reason: string;
      /**
       * True when fresh evidence could still clear the action, so the caller
       * should ask again. False when it is refused outright.
       */
      reevaluate: boolean;
      requirement: ControlRequirement;
    };

export interface ClearanceInput {
  /** Derived from rows read inside the claim transaction. */
  requirement: ControlRequirement;
  /** The fingerprint stored when the action was recorded. */
  storedFingerprint: string | null;
  /** Recomputed from the stored envelope inside the claim transaction. */
  recomputedFingerprint: string;
  evidence: ControlEvidence | null;
  /** The evidence-giver's authority, read inside the claim transaction. */
  evidencePrincipal: PrincipalAuthority | null;
  now: Date;
}

export function computeClearance(input: ClearanceInput): ClearanceDecision {
  const { requirement, evidence, evidencePrincipal, now } = input;
  const refuse = (code: ClearanceRefusalCode, reason: string, reevaluate: boolean): ClearanceDecision => ({
    cleared: false,
    code,
    reason,
    reevaluate,
    requirement,
  });

  if (!input.storedFingerprint || input.storedFingerprint !== input.recomputedFingerprint) {
    return refuse(
      'ENVELOPE_MUTATED',
      'The action parameters no longer match the fingerprint recorded for this action',
      false,
    );
  }
  if (requirement.kind === 'DENY') return refuse(requirement.code, requirement.reason, false);
  if (requirement.kind === 'NONE') {
    return { cleared: true, basis: 'NO_CONTROL_REQUIRED', requirement, approvedBy: null };
  }

  if (!evidence) {
    return refuse('CONTROL_EVIDENCE_REQUIRED', requirement.reason, true);
  }
  if (evidence.fingerprint !== input.recomputedFingerprint) {
    return refuse(
      'EVIDENCE_FINGERPRINT_MISMATCH',
      'The confirmation or approval on record is for different action parameters',
      true,
    );
  }
  const expiresAt = Date.parse(evidence.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return refuse('EVIDENCE_EXPIRED', 'The confirmation or approval on record has expired', true);
  }
  if (!evidencePrincipal || evidencePrincipal.userId !== evidence.principalUserId || evidencePrincipal.basis === 'none') {
    return refuse(
      'EVIDENCE_PRINCIPAL_REVOKED',
      'The person who confirmed or approved this action no longer has authority in this business',
      true,
    );
  }
  // Evidence is given under an authority. If that authority is now less than
  // it was, or rests on a different Membership row, the assumption the
  // evidence was issued on has changed and it has to be given again.
  if (
    evidencePrincipal.basis !== evidence.assumptions.basis ||
    evidencePrincipal.membershipId !== evidence.assumptions.membershipId ||
    evidencePrincipal.approvalTier < evidence.assumptions.approvalTier
  ) {
    return refuse(
      'EVIDENCE_AUTHORITY_CHANGED',
      'The authority of the person who confirmed or approved this action has changed since they did',
      true,
    );
  }

  const admissible = evidenceKindFor(requirement, evidencePrincipal);
  if ('refused' in admissible) return refuse('EVIDENCE_INSUFFICIENT', admissible.refused, true);
  // A CONFIRMATION on record cannot stand in for an APPROVAL the requirement
  // now asks for. The reverse is fine: an approval is the stronger control.
  if (admissible.kind === 'APPROVAL' && evidence.kind !== 'APPROVAL') {
    return refuse('EVIDENCE_INSUFFICIENT', requirement.reason, true);
  }

  return {
    cleared: true,
    basis: evidence.kind === 'APPROVAL' ? 'APPROVED' : 'CONFIRMED',
    requirement,
    approvedBy: evidence.principalUserId,
  };
}
