/**
 * MERGE-GRANT — the one predicate for "ChatGPT granted this exact merge".
 * (KF-META-MERGE-AUTHORITY-001; CG-DIR-F9-001; finding F9)
 *
 * A readiness status, a semantic PASS, a green workflow or the builder's own
 * `merge_authority:` line is never merge authority by itself. Before F9 was
 * repaired, READY_STATUSES took ACCEPT_FOR_ADMISSION exactly as it took
 * READY_TO_MERGE, nothing on the merge path read a grant, and the draft flag
 * was the only thing between an accepted record and the automated merge.
 *
 * Pure: no I/O, no clock. Every consumer gives it the raw issue #80 comments
 * of the target repository and the exact target, and gets the same answer:
 *   - lib/admission.mjs evaluateAdmission() (both snapshots of the merger);
 *   - lib/admission.mjs recheckBeforeMerge(), through the grant it returns;
 *   - auto-merge-admitted.mjs --grant-only, the non-draft step of the Agent
 *     Control Gate, which must not run the full evaluator: that evaluator
 *     waits for the gate's own successful run.
 *
 * Control fields are read only through lib/control-envelope.mjs and the effect
 * only through lib/authority-effects.mjs readEffect(). Neither changes.
 *
 * THE GRANT. The newest valid authority message about the target, and:
 *   - message_type REVIEW, from an allowlisted account (collectAuthority);
 *   - merge_authority: true and review_status: READY_TO_MERGE.
 *     ACCEPT_FOR_ADMISSION is acceptance of a record, never the decision;
 *   - a control_effect readEffect() reads as NO_STATE_CHANGE or
 *     PACKET_ADMISSION. NO_STATE_CHANGE is allowed so that a bounded meta
 *     repair can be merged without moving the active application packet (the
 *     PR 159 grant, comment 6111001643), but it is never a grant on its own:
 *     every field above and below is still required;
 *   - exact binding, each a separate field: pr_number, packet_id,
 *     implementation_branch, source_head (the semantic head), pr_head (the
 *     final artifact head) and source_main (the base). A `repository:` field,
 *     when present, names the target; the comment's own URL must be on the
 *     target repository's control issue either way.
 *
 * The grant names the final artifact head, so it is posted after that commit
 * exists and the artifact never has to name the grant: the binding is
 * acyclic, and no artifact is rewritten to carry its own SHA.
 *
 * "About the target" means its packet_id, pr_number or implementation_branch
 * is the target's. Holds and revocations are target-scoped:
 *   - any later valid authority message about the target supersedes the
 *     grant, whatever it says (a REVIEW with merge_authority false, a
 *     CHANGES_REQUIRED, a HOLD, a new DIRECTIVE). Only a new grant at the
 *     current binding restores it;
 *   - a malformed authority candidate after the grant that is, or may be,
 *     about the target (any of the three fields unreadable) makes the grant
 *     ambiguous. A malformed candidate before the grant is superseded by it;
 *   - a valid HOLD for the target packet with no later valid RESUME for it
 *     denies, before or after the grant. Holds on other packets do not apply,
 *     so an unrelated active packet neither blocks this target nor moves.
 *   - a global READY_TO_MERGE projection is not required, and not read.
 *
 * Fail closed: an unobserved, edited, edit-unknown or unordered collection
 * (collectAuthority), an incomplete target, or a grant whose provenance is not
 * the target repository's control issue, never grants.
 *
 * Limits, stated rather than claimed away: a grant read immediately before a
 * SHA-pinned merge call is not atomic with a later #80 comment; a revocation
 * posted in that window is seen only by the next evaluation. Every authority
 * comment comes from one shared account, so the allowlist attests the
 * account, not which agent wrote the words.
 */

import { CONTROL_ISSUE } from './events.mjs';
import { collectAuthority, envelopeField } from './control-envelope.mjs';
import { readEffect } from './authority-effects.mjs';

export const GRANT_EFFECTS = Object.freeze(['NO_STATE_CHANGE', 'PACKET_ADMISSION']);
export const GRANT_REVIEW_STATUS = 'READY_TO_MERGE';

export const GRANT_REASONS = Object.freeze({
  TARGET_INCOMPLETE: 'merge_grant_target_incomplete',
  AUTHORITY_UNVERIFIED: 'merge_grant_authority_unverified',
  ABSENT: 'merge_grant_absent',
  SUPERSEDED: 'merge_grant_superseded',
  NOT_A_GRANT: 'merge_grant_not_a_grant',
  BINDING_MISMATCH: 'merge_grant_binding_mismatch',
  PROVENANCE: 'merge_grant_provenance_not_target_repository',
  AMBIGUOUS: 'merge_grant_ambiguous_authority',
  HOLD_ACTIVE: 'merge_grant_target_held',
  GRANTED: 'merge_grant_valid',
});

const SHA = /^[0-9a-f]{40}$/;
const PR_NUMBER = /^[1-9][0-9]*$/;

function deny(reason, detail) {
  return { granted: false, reason, detail: detail ?? null, grant: null };
}

/** The target's own values as text, or the list of what is missing. */
function readTarget(target = {}) {
  const t = {
    repository: typeof target.repository === 'string' ? target.repository : '',
    pr_number: target.pr_number === undefined || target.pr_number === null ? '' : String(target.pr_number),
    packet_id: typeof target.packet_id === 'string' ? target.packet_id : '',
    implementation_branch: typeof target.implementation_branch === 'string' ? target.implementation_branch : '',
    source_head: typeof target.source_head === 'string' ? target.source_head : '',
    pr_head: typeof target.pr_head === 'string' ? target.pr_head : '',
    base_sha: typeof target.base_sha === 'string' ? target.base_sha : '',
  };
  const missing = [];
  if (!/^[^/\s]+\/[^/\s]+$/.test(t.repository)) missing.push('repository');
  if (!PR_NUMBER.test(t.pr_number)) missing.push('pr_number');
  for (const key of ['packet_id', 'implementation_branch']) if (t[key].trim() === '') missing.push(key);
  for (const key of ['source_head', 'pr_head', 'base_sha']) if (!SHA.test(t[key])) missing.push(key);
  return { t, missing };
}

/** Every value a body gives `key`, repeats included, so a repeat cannot hide a match. */
const valuesOf = (entry, key) => (entry.envelope?.values?.[key] || []).map((v) => (v === null ? null : String(v)));

const IDENTITY_KEYS = Object.freeze([
  ['packet_id', (t) => t.packet_id],
  ['pr_number', (t) => t.pr_number],
  ['implementation_branch', (t) => t.implementation_branch],
]);

/** True when the message names the target by packet, PR or branch. */
function concerns(entry, t) {
  return IDENTITY_KEYS.some(([key, of]) => valuesOf(entry, key).includes(of(t)));
}

/**
 * True when a malformed candidate is, or cannot be shown not to be, about the
 * target: it names the target, or one of the three identity fields is absent,
 * null or repeated so that it names nothing readable.
 */
function mayConcern(entry, t) {
  if (concerns(entry, t)) return true;
  return IDENTITY_KEYS.some(([key]) => {
    const values = valuesOf(entry, key);
    return values.length !== 1 || values[0] === null || values[0].trim() === '';
  });
}

/** Whether the comment is on the target repository's control issue. */
function onTargetIssue(entry, repository) {
  const url = String(entry.url || '');
  const browser = `https://github.com/${repository}/issues/${CONTROL_ISSUE}#issuecomment-${entry.comment_id}`;
  const api = `https://api.github.com/repos/${repository}/issues/comments/${entry.comment_id}`;
  return url === browser || url === api;
}

const field = (entry, key) => envelopeField(entry.envelope, key);

/** Why a message that is about the target is not a grant for it, or null. */
function grantProblems(entry, t) {
  const problems = [];
  if (entry.message_type !== 'REVIEW') problems.push(`message_type (${entry.message_type} is not REVIEW)`);
  if (field(entry, 'merge_authority') !== 'true') problems.push(`merge_authority (${field(entry, 'merge_authority')} is not true)`);
  if (field(entry, 'review_status') !== GRANT_REVIEW_STATUS) {
    problems.push(`review_status (${field(entry, 'review_status')} is not ${GRANT_REVIEW_STATUS})`);
  }
  const effect = readEffect(entry);
  if (!effect.ok) problems.push(`control_effect (${effect.code}: ${typeof effect.detail === 'string' ? effect.detail : JSON.stringify(effect.detail)})`);
  else if (!GRANT_EFFECTS.includes(effect.effect)) problems.push(`control_effect (${effect.effect} is not ${GRANT_EFFECTS.join('/')})`);
  return problems;
}

/** The grant's binding against the target; empty when every field is exact. */
function bindingProblems(entry, t) {
  const expected = {
    pr_number: t.pr_number,
    packet_id: t.packet_id,
    implementation_branch: t.implementation_branch,
    source_head: t.source_head,
    pr_head: t.pr_head,
    source_main: t.base_sha,
  };
  const problems = [];
  for (const [key, want] of Object.entries(expected)) {
    const found = field(entry, key);
    if (found !== want) problems.push({ field: key, expected: want, found });
  }
  if (Object.hasOwn(entry.envelope.values, 'repository') && field(entry, 'repository') !== t.repository) {
    problems.push({ field: 'repository', expected: t.repository, found: field(entry, 'repository') });
  }
  return problems;
}

/**
 * @param {Array|null} comments raw issue #80 comments of the target repository (REST or gh shape)
 * @param {object} target {repository, pr_number, packet_id, implementation_branch, source_head, pr_head, base_sha}
 * @param {object} [options] {authors} allowlist override, as collectAuthority takes it
 * @returns {{granted: boolean, reason: string, detail: any, grant: object|null}}
 */
export function evaluateMergeGrant(comments, target, options = {}) {
  const { t, missing } = readTarget(target);
  if (missing.length) return deny(GRANT_REASONS.TARGET_INCOMPLETE, missing);

  const authority = collectAuthority(comments, options.authors ? { authors: options.authors } : {});
  if (!authority.verified) return deny(GRANT_REASONS.AUTHORITY_UNVERIFIED, { code: authority.code, reason: authority.reason });

  // candidates are in #80 order, valid and malformed together.
  const ordered = authority.candidates;
  const valid = ordered.filter((e) => e.problems.length === 0);
  const about = valid.filter((e) => concerns(e, t));
  if (!about.length) return deny(GRANT_REASONS.ABSENT, 'no valid authority message names this PR, packet or branch');

  const newest = about[about.length - 1];
  const problems = grantProblems(newest, t);
  if (problems.length) {
    const earlier = about.slice(0, -1).filter((e) => grantProblems(e, t).length === 0);
    if (earlier.length) {
      const last = earlier[earlier.length - 1];
      return deny(GRANT_REASONS.SUPERSEDED, {
        grant: { message_id: last.message_id, comment_id: last.comment_id },
        superseded_by: { message_id: newest.message_id, comment_id: newest.comment_id, message_type: newest.message_type },
      });
    }
    return deny(GRANT_REASONS.NOT_A_GRANT, { message_id: newest.message_id, comment_id: newest.comment_id, problems });
  }

  const binding = bindingProblems(newest, t);
  if (binding.length) return deny(GRANT_REASONS.BINDING_MISMATCH, { message_id: newest.message_id, comment_id: newest.comment_id, problems: binding });
  if (!onTargetIssue(newest, t.repository)) {
    return deny(GRANT_REASONS.PROVENANCE, { message_id: newest.message_id, comment_id: newest.comment_id, url: newest.url ?? null });
  }

  const position = ordered.indexOf(newest);
  const later = ordered.slice(position + 1).filter((e) => e.problems.length > 0 && mayConcern(e, t));
  if (later.length) {
    return deny(GRANT_REASONS.AMBIGUOUS, later.map((e) => ({ message_id: e.message_id, comment_id: e.comment_id, problems: e.problems })));
  }

  let hold = null;
  for (const e of valid) {
    if (!valuesOf(e, 'packet_id').includes(t.packet_id)) continue;
    if (e.message_type === 'HOLD') hold = e;
    else if (e.message_type === 'RESUME') hold = null;
  }
  if (hold) return deny(GRANT_REASONS.HOLD_ACTIVE, { packet_id: t.packet_id, message_id: hold.message_id, comment_id: hold.comment_id });

  return {
    granted: true,
    reason: GRANT_REASONS.GRANTED,
    detail: null,
    grant: {
      message_id: newest.message_id,
      comment_id: newest.comment_id,
      created_at: newest.created_at,
      url: newest.url ?? null,
      effect: readEffect(newest).effect,
      binding: {
        repository: t.repository,
        pr_number: Number(t.pr_number),
        packet_id: t.packet_id,
        implementation_branch: t.implementation_branch,
        source_head: t.source_head,
        pr_head: t.pr_head,
        base_sha: t.base_sha,
      },
    },
  };
}

/** Whether two granted verdicts rest on the same grant at the same binding. */
export function sameGrant(a, b) {
  if (!a || !b) return false;
  return a.comment_id === b.comment_id && a.message_id === b.message_id && JSON.stringify(a.binding) === JSON.stringify(b.binding);
}

export default { evaluateMergeGrant, sameGrant, GRANT_REASONS, GRANT_EFFECTS, GRANT_REVIEW_STATUS };
