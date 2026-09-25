/**
 * AUTO-ORCHESTRATOR — derive the next legal control action.
 *
 * Deterministic. Given the same state, reconciliation and event it returns the
 * same action. It decides MECHANICS only: which legal transition, which
 * dispatch, which escalation. It never invents architecture, never resolves a
 * contradiction, and never grants its own admission.
 *
 * programme-state.yaml is a derived projection (lib/reconcile.mjs). Its rules
 * are only consulted once a reconciliation shows it agrees with the newest #80
 * authority and with repository truth; otherwise the answer is REPORT_DRIFT.
 */

import { canTransition } from './state-machine.mjs';
import { FINDINGS } from './reconcile.mjs';
import { evaluateMomentum } from './momentum.mjs';
import { planCorrection, DECISIONS as CORRECTION } from './correction.mjs';
import { selectNext } from './dag.mjs';
import { AGENT_STATUS, ROLES, selectAdapter } from './adapters.mjs';

export const ACTIONS = Object.freeze({
  NOOP: 'NOOP',
  DUPLICATE_EVENT: 'DUPLICATE_EVENT',
  ESCALATE: 'ESCALATE',
  POST_MOMENTUM: 'POST_MOMENTUM',
  DISPATCH_BUILDER: 'DISPATCH_BUILDER',
  REQUEST_REVIEW: 'REQUEST_REVIEW',
  EVALUATE_ADMISSION: 'EVALUATE_ADMISSION',
  MERGE_ADMITTED_HEAD: 'MERGE_ADMITTED_HEAD',
  POST_MERGE_VERIFY: 'POST_MERGE_VERIFY',
  CHECKPOINT: 'CHECKPOINT',
  SELECT_NEXT_PACKET: 'SELECT_NEXT_PACKET',
  WAIT_EXTERNAL_AGENT: 'WAIT_EXTERNAL_AGENT',
  WAIT_AUTHORITY: 'WAIT_AUTHORITY',
  REPORT_DRIFT: 'REPORT_DRIFT',
});

function action(type, reason, detail = {}) {
  return { action: type, reason, ...detail };
}

/**
 * @param {object} input
 *   state    programme state (derived projection)
 *   reconciliation  reconcile() verdict for this state; REQUIRED. Missing or
 *            inconsistent means the projection may not drive any decision.
 *   event    normalized event (may be null for a plain reconcile)
 *   dag      built DAG
 *   registry agent adapter registry
 *   duplicate  true when the journal already holds this event key
 */
export function decide(input) {
  const { event = null, duplicate = false } = input;

  // 1. Replay safety comes first: a duplicate never produces a second effect.
  if (duplicate) {
    return action(ACTIONS.DUPLICATE_EVENT, 'event already applied; converging without a second effect', {
      idempotency_key: event?.idempotency_key || null,
    });
  }

  // 2. Source precedence. A projection that disagrees with newer authority or
  //    with repository truth -- or that nobody checked -- advances nothing.
  const rec = input.reconciliation;
  if (!rec || rec.consistent !== true) {
    const findings = rec?.findings?.length
      ? rec.findings
      : [{ code: FINDINGS.RECONCILIATION_NOT_PERFORMED, detail: 'decide() was called without a consistent reconciliation' }];
    return action(
      ACTIONS.REPORT_DRIFT,
      `derived programme-state is not usable: ${findings.map((f) => f.code).join(', ')}; failing closed until it is re-derived from current authority and repository truth`,
      { findings, authority_newest: rec?.authority_newest || null, advancement: 'NONE' },
    );
  }

  return derivedDecision(input);
}

/**
 * The rule table over the projection. It trusts programme-state completely, so
 * it is only correct behind decide()'s reconciliation gate. Exported for the
 * positive control that proves the gate changes nothing for consistent input;
 * production callers use decide().
 */
export function derivedDecision(input) {
  const { state, event = null, dag = null, registry = [] } = input;
  const p = state.programme || {};

  // A hold outranks everything except reporting.
  if (state.hold && state.hold.active !== false) {
    return action(ACTIONS.WAIT_AUTHORITY, `programme is held: ${state.hold.reason || 'no reason recorded'}`, {
      hold: state.hold,
      resume_condition: state.hold.resume_condition || null,
    });
  }

  // 3. Unresolved contradictions stop advancement. Never auto-resolved.
  if ((state.unresolved_contradictions || []).length) {
    return action(ACTIONS.WAIT_AUTHORITY, 'unresolved contradiction blocks advancement', {
      contradictions: state.unresolved_contradictions,
      note: 'contradiction resolution is an authority decision and is never automatic',
    });
  }

  // 4. Momentum is reported before any further mechanical work.
  const momentum = evaluateMomentum(state, input.momentumExtra || {});
  if (momentum.alarm && !state.momentum?.alarm_active) {
    return action(ACTIONS.POST_MOMENTUM, 'momentum threshold reached', { report: momentum.report });
  }

  // 5. Event-shaped reactions.
  if (event?.kind === 'CONTRADICTION') {
    return action(ACTIONS.ESCALATE, 'CONTRADICTION received; stopping affected work', {
      packet_id: event.packet_id || p.active_packet,
      target_state: 'BLOCKED',
    });
  }

  if (event?.kind === 'WORKFLOW_COMPLETED' && event.conclusion && event.conclusion !== 'success') {
    const plan = planCorrection(state, { class: 'CONTROL_ARTIFACT_INVALID', target: event.workflow });
    if (plan.decision === CORRECTION.BLOCK_REPEATED) {
      return action(ACTIONS.ESCALATE, plan.reason, { target_state: 'BLOCKED', signature: plan.signature });
    }
    return action(ACTIONS.EVALUATE_ADMISSION, `required workflow ${event.workflow} concluded ${event.conclusion}`, {
      pr_number: event.pr_number,
      head_sha: event.head_sha,
    });
  }

  if (event?.kind === 'PR_MERGED') {
    const verdict = canTransition(p.state, 'MERGED', { authority_marker: state.merge_authority_marker });
    return action(ACTIONS.POST_MERGE_VERIFY, 'implementation PR merged; post-merge verification is required before checkpoint', {
      pr_number: event.pr_number,
      merge_commit_sha: event.merge_commit_sha,
      transition_legal: verdict.ok,
      transition_reason: verdict.ok ? null : verdict.reason,
    });
  }

  // 6. State-shaped progression.
  switch (p.state) {
    case 'MERGED':
      return action(ACTIONS.CHECKPOINT, 'merged packet awaits durable checkpoint', {
        packet_id: p.active_packet,
        requires: 'recorded post-merge verification',
      });

    case 'READY_TO_MERGE':
      return action(ACTIONS.EVALUATE_ADMISSION, 'packet is review-ready; evaluating exact-head admission', {
        pr_number: p.pr_number,
      });

    case 'PROVING':
      return action(ACTIONS.REQUEST_REVIEW, 'local proof complete; adversarial review is required before merge readiness', {
        packet_id: p.active_packet,
        ...reviewerAvailability(registry),
      });

    case 'FIXING_PROOF_FAILURES':
    case 'IMPLEMENTING':
    case 'CHARACTERIZING': {
      const builder = selectAdapter(registry, ROLES.BUILDER);
      if (builder.status !== AGENT_STATUS.READY) {
        return action(ACTIONS.WAIT_EXTERNAL_AGENT, builder.detail || 'no builder adapter is ready', {
          role: ROLES.BUILDER,
          status: builder.status,
        });
      }
      return action(ACTIONS.DISPATCH_BUILDER, `packet is ${p.state}; builder work is the next legal step`, {
        packet_id: p.active_packet,
        adapter: builder.adapter.id,
      });
    }

    case 'BLOCKED':
      return action(ACTIONS.WAIT_AUTHORITY, 'packet is BLOCKED; an authority decision is required to leave this state', {
        packet_id: p.active_packet,
      });

    case 'CHECKPOINTED':
    case null:
    case undefined: {
      if (!dag) return action(ACTIONS.NOOP, 'no DAG supplied; cannot select the next packet');
      const selection = selectNext(dag, p.checkpointed || []);
      if (!selection.selected) {
        return action(ACTIONS.NOOP, 'no dependency-safe packet is currently selectable', {
          gate_wave: selection.gate_wave,
          remaining: selection.remaining,
        });
      }
      return action(ACTIONS.SELECT_NEXT_PACKET, 'previous packet checkpointed; next dependency-safe phase selected', {
        selected: selection.selected.key,
        packet_id: selection.selected.packet_id,
        phase: selection.selected.phase,
        wave: selection.selected.wave,
        gate_wave: selection.gate_wave,
        note: 'selection is a proposal; releasing a directive remains an authority action',
      });
    }

    default:
      return action(ACTIONS.NOOP, `no rule matches state ${p.state}`);
  }
}

function reviewerAvailability(registry) {
  const reviewer = selectAdapter(registry, ROLES.ADVERSARIAL_REVIEWER, ['claude-code-local']);
  return {
    reviewer_status: reviewer.status,
    reviewer: reviewer.adapter?.id || null,
    reviewer_detail: reviewer.detail || null,
  };
}

export default { decide, derivedDecision, ACTIONS };
