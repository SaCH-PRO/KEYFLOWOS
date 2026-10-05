import type { ControlRequirement, ExecutionSurface, KeyAutonomyVerdict } from './control-clearance';

/**
 * Shadow comparison: what each surface did with an oversight decision before
 * the boundary, beside what the boundary's ControlRequirement does now
 * (KF-EXEC-ACTION-001, migration_shape "run the new decision path in shadow
 * beside current oversight").
 *
 * The left column is a transcription of the code as characterized at
 * ad97ea48 (CC-RETURN-ACTION-001-CHAR, section 2). It is the record of what
 * was replaced, so it must not be "fixed": if a line here looks wrong, it is
 * wrong in the way the old code was.
 *
 * Where a surface's legacy behaviour depended on something that is not an
 * input here (a model's self-reported confidence on E5, a pre-approved plan
 * step on E7), the transcription takes the most permissive outcome that
 * surface could reach. The comparison is then a bound: the boundary is never
 * looser than the loosest thing the surface used to do.
 */

export type Disposition = 'BLOCK' | 'QUEUE_APPROVAL' | 'ASK_CONFIRMATION' | 'EXECUTE';

/** Loosest first. */
const RANK: Record<Disposition, number> = {
  EXECUTE: 0,
  ASK_CONFIRMATION: 1,
  QUEUE_APPROVAL: 2,
  BLOCK: 3,
};

export function legacyDisposition(surface: ExecutionSurface, verdict: KeyAutonomyVerdict): Disposition {
  const formal = verdict.requiresFormalApproval || verdict.requiresAdminApproval;
  switch (surface) {
    // flow-orchestrator.service.ts:1772-1831 and :2248-2346
    case 'CHAT':
    case 'CHAT_STREAM':
      if (!verdict.allowed) return 'BLOCK';
      if (formal) return 'QUEUE_APPROVAL';
      if (verdict.requiresQuickConfirm) return 'ASK_CONFIRMATION';
      return 'EXECUTE';

    // :1654-1699. A client-resubmitted tool name and arguments executed once
    // the name passed evaluate(); quick-confirm was the client's own boolean.
    case 'CHAT_CONFIRM':
      if (!verdict.allowed) return 'BLOCK';
      if (formal) return 'QUEUE_APPROVAL';
      return 'EXECUTE';

    // :6613-6658. "Quick-confirm implicitly satisfied by plan approval".
    case 'PLAN_HTTP':
      if (!verdict.allowed) return 'BLOCK';
      if (formal) return 'QUEUE_APPROVAL';
      return 'EXECUTE';

    // graph-actions.controller.ts:103-146. requiresQuickConfirm was ignored.
    case 'GRAPH_ACTION':
      if (!verdict.allowed) return 'BLOCK';
      if (formal) return 'QUEUE_APPROVAL';
      return 'EXECUTE';

    // conversational-ai.service.ts:110-126 with ai-oversight.service.ts:285-299.
    // A confidence above 0.9 auto-approved any tier up to 2.
    case 'INBOUND_CONVERSATION':
      if (!verdict.allowed) return 'BLOCK';
      if (formal) return 'ASK_CONFIRMATION';
      return 'EXECUTE';

    // action-dispatcher.service.ts:83-84 checked `allowed` and nothing else.
    case 'PLAN_QUEUE':
      return verdict.allowed ? 'EXECUTE' : 'BLOCK';

    // flow-orchestrator.service.ts:6716, with a `pro_auto` mode override.
    case 'PRO_AUTO_MONITOR':
      return verdict.allowed ? 'EXECUTE' : 'BLOCK';

    // key-action-proposal.service.ts:241-247 evaluated the wrapper name
    // `key_autonomy.EXECUTE_TOOL`, so this capability's own blocklist entry,
    // module and tier were never consulted.
    case 'PROPOSAL':
      return 'EXECUTE';

    // phone-voice.service.ts:248-249, flow-orchestrator.service.ts:5535 and
    // key-cortex-efferent-bridge.service.ts:137 reached the executor with no
    // AiOversightService decision at all.
    case 'PHONE_STREAM':
    case 'CUSTOM_LOGIC':
    case 'CORTEX_BRIDGE':
    case 'UNDECLARED':
      return 'EXECUTE';
  }
}

export function boundaryDisposition(requirement: ControlRequirement): Disposition {
  switch (requirement.kind) {
    case 'DENY':
      return 'BLOCK';
    case 'HUMAN_APPROVAL':
      return 'QUEUE_APPROVAL';
    case 'PRINCIPAL_CONFIRMATION':
      return 'ASK_CONFIRMATION';
    case 'NONE':
      return 'EXECUTE';
  }
}

export interface ShadowComparison {
  surface: ExecutionSurface;
  legacy: Disposition;
  boundary: Disposition;
  parity: 'SAME' | 'BOUNDARY_STRICTER' | 'BOUNDARY_LOOSER';
  /** The oversight decision both sides started from. */
  oversight: KeyAutonomyVerdict;
}

export function compareWithLegacy(
  surface: ExecutionSurface,
  oversight: KeyAutonomyVerdict,
  requirement: ControlRequirement,
): ShadowComparison {
  const legacy = legacyDisposition(surface, oversight);
  const boundary = boundaryDisposition(requirement);
  const parity =
    RANK[boundary] === RANK[legacy] ? 'SAME' : RANK[boundary] > RANK[legacy] ? 'BOUNDARY_STRICTER' : 'BOUNDARY_LOOSER';
  return { surface, legacy, boundary, parity, oversight };
}
