/**
 * AUTO-STATE-MACHINE — machine-enforced legal packet transitions.
 *
 * Every transition either succeeds or fails closed with an actionable reason
 * code. There is no "unknown, allow anyway" branch: an unrecognised state is a
 * rejection, because this gate decides whether work may advance.
 *
 * States are the eight declared in docs/development/EXECUTION_CONTROL_STANDARD.md §1.
 */

export const STATES = Object.freeze([
  'CHARACTERIZING',
  'IMPLEMENTING',
  'PROVING',
  'FIXING_PROOF_FAILURES',
  'READY_TO_MERGE',
  'MERGED',
  'CHECKPOINTED',
  'BLOCKED',
]);

export const HEALTH = Object.freeze(['GREEN', 'YELLOW', 'RED']);

export const TERMINAL_STATES = Object.freeze(['CHECKPOINTED']);

/**
 * Legal forward transitions.
 *
 * BLOCKED is reachable from every non-terminal state (a contradiction can be
 * discovered at any time) and returns only to the state that raised it, which
 * the caller supplies as `blocked_from`.
 */
const TRANSITIONS = Object.freeze({
  CHARACTERIZING: ['IMPLEMENTING', 'BLOCKED'],
  IMPLEMENTING: ['PROVING', 'CHARACTERIZING', 'BLOCKED'],
  PROVING: ['FIXING_PROOF_FAILURES', 'READY_TO_MERGE', 'BLOCKED'],
  FIXING_PROOF_FAILURES: ['PROVING', 'IMPLEMENTING', 'BLOCKED'],
  READY_TO_MERGE: ['MERGED', 'FIXING_PROOF_FAILURES', 'BLOCKED'],
  MERGED: ['CHECKPOINTED', 'BLOCKED'],
  CHECKPOINTED: [],
  BLOCKED: [...STATES.filter((s) => s !== 'CHECKPOINTED' && s !== 'BLOCKED')],
});

/**
 * Transitions that may never be taken by deterministic automation alone.
 * Each requires a recorded authority marker naming who authorised it.
 */
const AUTHORITY_REQUIRED = Object.freeze({
  'READY_TO_MERGE->MERGED': 'merge requires an admission evaluation and recorded review marker',
  'MERGED->CHECKPOINTED': 'checkpoint requires recorded post-merge verification',
  'PROVING->READY_TO_MERGE': 'merge readiness requires a recorded ChatGPT review decision',
});

export class TransitionError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'TransitionError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * @returns {{ok: true} | {ok: false, code: string, reason: string}}
 */
export function canTransition(from, to, context = {}) {
  if (!STATES.includes(from)) {
    return { ok: false, code: 'UNKNOWN_FROM_STATE', reason: `${from} is not a declared packet state` };
  }
  if (!STATES.includes(to)) {
    return { ok: false, code: 'UNKNOWN_TO_STATE', reason: `${to} is not a declared packet state` };
  }
  if (from === to) {
    return { ok: false, code: 'NO_OP_TRANSITION', reason: `already in ${from}; a re-entry is not a transition` };
  }
  if (TERMINAL_STATES.includes(from)) {
    return { ok: false, code: 'TERMINAL_STATE', reason: `${from} is terminal and cannot transition to ${to}` };
  }
  if (!TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      reason: `${from} -> ${to} is not a legal transition; legal: ${TRANSITIONS[from].join(', ') || '(none)'}`,
    };
  }

  if (to !== 'BLOCKED' && (context.unresolved_contradictions?.length ?? 0) > 0) {
    return {
      ok: false,
      code: 'UNRESOLVED_CONTRADICTION',
      reason: `cannot advance to ${to} while contradictions are unresolved: ${context.unresolved_contradictions.join(', ')}`,
    };
  }

  const authorityKey = `${from}->${to}`;
  if (AUTHORITY_REQUIRED[authorityKey] && !context.authority_marker) {
    return {
      ok: false,
      code: 'AUTHORITY_REQUIRED',
      reason: `${authorityKey} requires a recorded authority marker: ${AUTHORITY_REQUIRED[authorityKey]}`,
    };
  }

  if (to === 'BLOCKED' && !context.reason) {
    return { ok: false, code: 'BLOCK_REASON_REQUIRED', reason: 'a BLOCKED transition must record why' };
  }

  return { ok: true };
}

export function assertTransition(from, to, context = {}) {
  const verdict = canTransition(from, to, context);
  if (!verdict.ok) throw new TransitionError(verdict.code, verdict.reason, { from, to });
  return verdict;
}

export function legalNext(from) {
  return STATES.includes(from) ? [...TRANSITIONS[from]] : [];
}

export function requiresAuthority(from, to) {
  return Boolean(AUTHORITY_REQUIRED[`${from}->${to}`]);
}

export default { STATES, HEALTH, canTransition, assertTransition, legalNext, requiresAuthority, TransitionError };
