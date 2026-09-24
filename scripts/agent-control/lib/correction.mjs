/**
 * AUTO-CORRECTION-LOOP — bounded automatic repair.
 *
 * Mechanical defects may be returned to the builder automatically. Anything
 * that changes what the system MEANS stops for authority. The loop is bounded:
 * two materially identical failed attempts force BLOCKED + MOMENTUM rather
 * than infinite retry.
 */

import { failureSignature } from './momentum.mjs';

export const MAX_IDENTICAL_ATTEMPTS = 2;

/**
 * Classes that must never be auto-corrected. Each is a decision about meaning,
 * authority or safety — exactly the decisions a deterministic loop cannot make.
 */
export const ESCALATE_ONLY = Object.freeze([
  'CONTRADICTION',
  'ARCHITECTURAL_PRECEDENCE',
  'SCOPE_WIDENING',
  'SCHEMA_PRIMITIVE_CHOICE',
  'PRODUCTION_RISK',
  'FORENSIC_REBASELINE',
  'PROGRAMME_MAP_REFRESH',
  'GATE_WEAKENING',
  'PROOF_OBLIGATION_REDUCTION',
  'UNRESOLVED_DEFERRAL',
  'MIGRATION_STRATEGY',
  'CREDENTIAL_OR_AUTH',
]);

/** Defect classes a builder agent can be asked to fix without new authority. */
export const AUTO_CORRECTABLE = Object.freeze([
  'TYPECHECK_FAILURE',
  'LINT_FAILURE',
  'UNIT_TEST_FAILURE',
  'BUILD_FAILURE',
  'CONTROL_ARTIFACT_INVALID',
  'SOURCE_MAIN_STALE',
  'MISSING_NEGATIVE_CONTROL',
]);

export const DECISIONS = Object.freeze({
  AUTO_CORRECT: 'AUTO_CORRECT',
  ESCALATE: 'ESCALATE',
  BLOCK_REPEATED: 'BLOCK_REPEATED_FAILURE',
  NO_ACTION: 'NO_ACTION',
});

/**
 * @param {object} state programme state
 * @param {object} defect {class, target, detail}
 * @returns {{decision:string, reason:string, signature:string|null, attempts:number}}
 */
export function planCorrection(state, defect) {
  if (!defect || !defect.class) {
    return { decision: DECISIONS.NO_ACTION, reason: 'no defect supplied', signature: null, attempts: 0 };
  }

  const signature = failureSignature({ class: defect.class, target: defect.target });
  const prior = state.correction?.last_signature === signature ? state.correction?.attempts || 0 : 0;

  if (ESCALATE_ONLY.includes(defect.class)) {
    return {
      decision: DECISIONS.ESCALATE,
      reason: `${defect.class} is an authority decision and is never auto-corrected`,
      signature,
      attempts: prior,
    };
  }

  if (prior >= MAX_IDENTICAL_ATTEMPTS) {
    return {
      decision: DECISIONS.BLOCK_REPEATED,
      reason: `${prior} materially identical correction attempts already failed; blocking rather than retrying`,
      signature,
      attempts: prior,
    };
  }

  if (!AUTO_CORRECTABLE.includes(defect.class)) {
    return {
      decision: DECISIONS.ESCALATE,
      reason: `${defect.class} is not a recognised auto-correctable defect class; failing closed`,
      signature,
      attempts: prior,
    };
  }

  return {
    decision: DECISIONS.AUTO_CORRECT,
    reason: `${defect.class} is mechanically correctable; dispatching attempt ${prior + 1} of ${MAX_IDENTICAL_ATTEMPTS}`,
    signature,
    attempts: prior + 1,
  };
}

export function recordAttempt(state, plan) {
  return {
    ...state,
    correction: {
      attempts: plan.signature === state.correction?.last_signature ? (state.correction?.attempts || 0) + 1 : 1,
      last_signature: plan.signature,
    },
  };
}

export function clearCorrection(state) {
  return { ...state, correction: { attempts: 0, last_signature: null } };
}

export default {
  planCorrection,
  recordAttempt,
  clearCorrection,
  DECISIONS,
  ESCALATE_ONLY,
  AUTO_CORRECTABLE,
  MAX_IDENTICAL_ATTEMPTS,
};
