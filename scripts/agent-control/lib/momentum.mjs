/**
 * AUTO-MOMENTUM — watchdog for the thresholds in
 * docs/development/EXECUTION_CONTROL_STANDARD.md §3.
 *
 * The alarm exists so activity is never mistaken for progress. It reports; it
 * does not silence itself and it does not advance anything.
 */

export const THRESHOLDS = Object.freeze({
  OPERATIONS_WITHOUT_TRANSITION: 6,
  IDENTICAL_FAILURES: 2,
  CI_FAILURES_WITHOUT_NEW_ROOT_CAUSE: 2,
  BRANCH_COMMIT_WARN: 40,
});

export const MOMENTUM_REASONS = Object.freeze({
  NO_TRANSITION: 'six_or_more_operations_without_a_state_transition',
  IDENTICAL_FAILURE: 'two_consecutive_failures_for_materially_the_same_reason',
  CI_REPEAT: 'two_consecutive_ci_failures_without_a_new_root_cause',
  HYGIENE: 'branch_hygiene_threshold_approaching',
  ASSUMPTIONS_MOVING: 'assumptions_changing_while_state_is_static',
});

/**
 * A failure signature is what makes "materially the same reason" mechanical.
 * Callers derive it from the stable part of a failure (reason code + target),
 * never from a timestamp or run id.
 */
export function failureSignature(parts) {
  return Object.entries(parts || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('|');
}

/**
 * @param {object} state programme state
 * @param {object} [extra] { branch_commits, assumptions_changed }
 * @returns {{alarm: boolean, reasons: string[], report: object|null}}
 */
export function evaluateMomentum(state, extra = {}) {
  const m = state.momentum || {};
  const p = state.programme || {};
  const reasons = [];

  if ((m.operations_since_transition || 0) >= THRESHOLDS.OPERATIONS_WITHOUT_TRANSITION) {
    reasons.push(MOMENTUM_REASONS.NO_TRANSITION);
  }
  if ((m.consecutive_identical_failures || 0) >= THRESHOLDS.IDENTICAL_FAILURES) {
    reasons.push(MOMENTUM_REASONS.IDENTICAL_FAILURE);
  }
  if ((m.consecutive_ci_failures_without_new_root_cause || 0) >= THRESHOLDS.CI_FAILURES_WITHOUT_NEW_ROOT_CAUSE) {
    reasons.push(MOMENTUM_REASONS.CI_REPEAT);
  }
  if ((extra.branch_commits || 0) >= THRESHOLDS.BRANCH_COMMIT_WARN) {
    reasons.push(MOMENTUM_REASONS.HYGIENE);
  }
  if (extra.assumptions_changed === true && (m.operations_since_transition || 0) > 0) {
    reasons.push(MOMENTUM_REASONS.ASSUMPTIONS_MOVING);
  }

  if (!reasons.length) return { alarm: false, reasons: [], report: null };

  return {
    alarm: true,
    reasons,
    report: {
      packet: p.active_packet,
      state: p.state,
      health: p.health,
      blocking: reasons,
      attempts_made: m.operations_since_transition || 0,
      identical_failures: m.consecutive_identical_failures || 0,
      ci_failures: m.consecutive_ci_failures_without_new_root_cause || 0,
      last_failure_signature: m.last_failure_signature || null,
      last_transition_at: m.last_transition_at || null,
      scope_changed: Boolean(state.scope_changed),
      production_touched: Boolean(p.production_touched),
    },
  };
}

/** Count one substantive operation that did not transition state. */
export function countOperation(state) {
  return {
    ...state,
    momentum: {
      ...state.momentum,
      operations_since_transition: (state.momentum?.operations_since_transition || 0) + 1,
    },
  };
}

/** Record a failure, tracking whether it repeats the previous root cause. */
export function countFailure(state, signature, kind = 'generic') {
  const m = state.momentum || {};
  const same = signature && signature === m.last_failure_signature;
  return {
    ...state,
    momentum: {
      ...m,
      last_failure_signature: signature || null,
      consecutive_identical_failures: same ? (m.consecutive_identical_failures || 0) + 1 : 1,
      consecutive_ci_failures_without_new_root_cause:
        kind === 'ci'
          ? same
            ? (m.consecutive_ci_failures_without_new_root_cause || 0) + 1
            : 1
          : m.consecutive_ci_failures_without_new_root_cause || 0,
    },
  };
}

/** A real state transition clears the counters. */
export function clearOnTransition(state, at) {
  return {
    ...state,
    momentum: {
      ...state.momentum,
      operations_since_transition: 0,
      consecutive_identical_failures: 0,
      consecutive_ci_failures_without_new_root_cause: 0,
      last_failure_signature: null,
      last_transition_at: at || new Date().toISOString(),
      alarm_active: false,
    },
  };
}

export default {
  THRESHOLDS,
  MOMENTUM_REASONS,
  evaluateMomentum,
  countOperation,
  countFailure,
  clearOnTransition,
  failureSignature,
};
