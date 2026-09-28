/**
 * RETURN-EVIDENCE — what a branch claude-return.yaml may claim before the
 * RETURN exists. (KF-META-CONTROL-PARSER-001;
 * CG-REVIEW-META-CONTROL-PARSER-EVIDENCE-ORDER-001)
 *
 * The artifact is committed before the checks for the head that carries it
 * run, and the RETURN is posted on #80 only after they finish, with no further
 * branch mutation. The RETURN comment is the final evidence envelope. So the
 * artifact on the branch is always a pre-RETURN record, and it must not say:
 *   - that a RETURN exists (return_message_id stays null);
 *   - that any RETURN id it names was posted, unless it lists that id as
 *     previously posted or as never posted;
 *   - that an exact-head check or the fresh AI review has passed. Those are
 *     PENDING until the RETURN reports them, in exact_head_proof and in prose
 *     alike (Copilot r4117477551: `security` said DAST "passed" while its
 *     structured entry was PENDING).
 *
 * The prose rule reads each sentence of every value. A sentence that names an
 * exact-head gate, or all of them ("exact-head workflows", "required checks"),
 * next to a pass or completion word is a claim. Two kinds of text are not
 * claims about this head: an `obligation` (it states what must be proven, and
 * its result is checked separately) and a `previous_head_<sha>` record (it is
 * about that earlier head by name). Outcomes for earlier heads belong in those
 * records, and other prose points at them. A sentence that names a gate but
 * says "not passed" is still flagged; write PENDING instead.
 *
 * Only PROVEN satisfies a gate. PENDING and UNKNOWN are never green.
 *
 * Every proof_matrix entry declares its evidence_scope: exact_head for proof
 * that only the checks on the head carrying the artifact can give (it must be
 * PENDING), semantic_head for proof gathered before the artifact commit. The
 * scope is required, so an exact-head obligation cannot read as PROVEN by
 * leaving the marker out (Copilot r4117714827). As a second guard, an
 * obligation that names an exact-head gate, by the same matching the prose
 * rule uses, must be exact_head.
 *
 * Pure: takes the parsed artifact and returns a list of problems, empty when
 * the artifact is truthful.
 */

import { REQUIRED_WORKFLOWS } from './events.mjs';

/** The evidence_policy states, plus PENDING for exact-head proof not yet run. */
export const EVIDENCE_STATES = Object.freeze([
  'PROVEN',
  'PARTIAL',
  'NOT_RUN',
  'NOT_APPLICABLE',
  'HUMAN_GATED',
  'FAILED',
  'UNKNOWN',
  'PENDING',
]);

export const PRE_RETURN_STATUS = 'AWAITING_POSTCHECK_RETURN';

/** Where a proof_matrix entry's evidence comes from; required on every entry. */
export const EVIDENCE_SCOPES = Object.freeze(['exact_head', 'semantic_head']);

/** The exact-head gates a pre-RETURN artifact must list, all PENDING. */
export const AI_REVIEW_GATE = 'fresh Copilot review';
export const EXACT_HEAD_GATES = Object.freeze([...REQUIRED_WORKFLOWS, AI_REVIEW_GATE]);

const RETURN_ID = /CC-RETURN-[A-Z0-9]+(?:-[A-Z0-9]+)*/g;
const ID_LISTS = new Set(['previous_return_message_ids', 'never_posted_return_message_ids']);

function* strings(value, key = null) {
  if (key !== null && ID_LISTS.has(key)) return;
  if (typeof value === 'string') {
    yield value;
  } else if (Array.isArray(value)) {
    for (const item of value) yield* strings(item);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      yield k;
      yield* strings(v, k);
    }
  }
}

// Pass and completion vocabulary; "completed with zero failures" claims a
// finished gate as surely as "passed" does (Copilot r4117648609).
const PASS_WORD = /\b(?:pass(?:ed|es|ing)?|green|succeeded|successful(?:ly)?|proven|complete[ds]?|(?:zero|no|0) fail(?:ures?|ed|ing)?)\b/i;
// "All required exact-head workflows passed" names every gate at once (r4117648627).
const UMBRELLA_GATE = /\b(?:exact[- ]head (?:workflows?|checks?|ci|gates?|proof)|required (?:workflows?|checks?))\b/i;
const HISTORICAL_KEY = /^previous_head_[0-9a-f]{7,40}$/;
const REQUIREMENT_KEYS = new Set(['obligation']);

/** Whether text names an exact-head gate, or all of them at once. */
function namesExactHeadGate(text) {
  const lower = text.toLowerCase();
  return EXACT_HEAD_GATES.some((gate) => lower.includes(gate.toLowerCase())) || UMBRELLA_GATE.test(text);
}

/** Every sentence of every value that could claim something about this head. */
function* claimSentences(value, key = null) {
  if (key !== null && (HISTORICAL_KEY.test(key) || REQUIREMENT_KEYS.has(key))) return;
  if (typeof value === 'string') {
    for (const sentence of value.split(/(?<=[.;])\s+|\n/)) {
      if (sentence.trim()) yield sentence.trim();
    }
  } else if (Array.isArray(value)) {
    for (const item of value) yield* claimSentences(item);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) yield* claimSentences(v, k);
  }
}

/**
 * @param {object} ret parsed claude-return.yaml
 * @returns {string[]} problems; empty when the artifact claims nothing it cannot know
 */
export function preReturnEvidenceProblems(ret) {
  const problems = [];
  if (!ret || typeof ret !== 'object') return ['artifact is not a mapping'];

  if (ret.return_status !== PRE_RETURN_STATUS) {
    problems.push(`return_status must be ${PRE_RETURN_STATUS} on the branch; found ${ret.return_status ?? 'none'}`);
  }
  if (ret.return_message_id !== undefined && ret.return_message_id !== null) {
    problems.push(`return_message_id must be null until the RETURN is posted; found ${ret.return_message_id}`);
  }

  const accounted = new Set([
    ...(Array.isArray(ret.previous_return_message_ids) ? ret.previous_return_message_ids : []),
    ...(Array.isArray(ret.never_posted_return_message_ids) ? ret.never_posted_return_message_ids : []),
  ]);
  const unaccounted = new Set();
  for (const text of strings(ret)) {
    for (const id of text.match(RETURN_ID) || []) {
      if (!accounted.has(id)) unaccounted.add(id);
    }
  }
  for (const id of unaccounted) {
    problems.push(`${id} is named but not listed as previously posted or never posted`);
  }

  const proof = Array.isArray(ret.exact_head_proof) ? ret.exact_head_proof : [];
  if (!proof.length) problems.push('exact_head_proof must list every exact-head gate');
  const byGate = new Map(proof.map((entry) => [entry?.gate, entry]));
  for (const gate of EXACT_HEAD_GATES) {
    if (!byGate.has(gate)) problems.push(`exact_head_proof is missing ${gate}`);
  }
  for (const entry of proof) {
    if (entry?.status !== 'PENDING') {
      problems.push(`exact_head_proof ${entry?.gate ?? '?'} must be PENDING before the RETURN; found ${entry?.status ?? 'none'}`);
    }
  }

  for (const sentence of claimSentences(ret)) {
    const named = EXACT_HEAD_GATES.filter((gate) => sentence.toLowerCase().includes(gate.toLowerCase()));
    const umbrella = sentence.match(UMBRELLA_GATE);
    if (umbrella && !named.length) named.push(umbrella[0]);
    if (named.length && PASS_WORD.test(sentence)) {
      problems.push(`prose claims ${named.join(', ')} passed before the RETURN: "${sentence}"`);
    }
  }

  for (const entry of Array.isArray(ret.proof_matrix) ? ret.proof_matrix : []) {
    const label = entry?.obligation ?? '?';
    const scope = entry?.evidence_scope;
    if (!EVIDENCE_STATES.includes(entry?.result)) {
      problems.push(`proof_matrix "${label}" result ${entry?.result ?? 'none'} is not an evidence state`);
    }
    if (!EVIDENCE_SCOPES.includes(scope)) {
      problems.push(`proof_matrix "${label}" evidence_scope ${scope || 'none'} must be one of ${EVIDENCE_SCOPES.join(', ')}`);
    } else if (scope !== 'exact_head' && namesExactHeadGate(String(label))) {
      problems.push(`proof_matrix "${label}" names an exact-head gate and must have evidence_scope exact_head; found ${scope}`);
    } else if (scope === 'exact_head' && EVIDENCE_STATES.includes(entry.result) && entry.result !== 'PENDING') {
      problems.push(`proof_matrix "${label}" depends on the exact head and must be PENDING; found ${entry.result}`);
    }
  }

  return problems;
}

export default { preReturnEvidenceProblems, EVIDENCE_STATES, EVIDENCE_SCOPES, EXACT_HEAD_GATES, PRE_RETURN_STATUS, AI_REVIEW_GATE };
