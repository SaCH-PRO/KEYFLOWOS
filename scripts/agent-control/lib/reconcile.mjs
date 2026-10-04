/**
 * AUTO-RECONCILE — source precedence between the three control stores.
 * (CG-DIRECTIVE-META-STATE-RECONCILE-001)
 *
 *   repository / PR / CI evidence   implementation truth: what actually exists
 *   newest valid ChatGPT DIRECTIVE, REVIEW, HOLD or RESUME on issue #80
 *                                   execution authority: what may happen now
 *   .agent-control/programme-state.yaml
 *                                   a DERIVED projection of the two above. It
 *                                   may summarize and accelerate a decision; it
 *                                   may never override newer authority or
 *                                   repository reality.
 *
 * Pure: every input is a snapshot, so each verdict is reproducible from
 * recorded evidence. Fetching the snapshot lives in lib/truth.mjs.
 *
 * The comparison fails closed. Anything this module cannot verify is a finding,
 * and any finding makes the projection unusable for advancement. It never picks
 * a winner and never repairs the projection; re-deriving it is a reviewed commit.
 *
 * Deliberately NOT done here: classifying a message as a hold or a release.
 * On #80 holds and resumes have so far been typed DIRECTIVE and told apart only
 * by message id and prose. Rather than infer meaning from either, reconcile()
 * treats ANY valid authority message newer than the projection's anchor as
 * making it stale. A newer hold therefore always wins over an older derived
 * "advance".
 *
 * reconcileProjection() first folds newer authority that declares an explicit
 * control_effect over the reviewed checkpoint (lib/authority-effects.mjs,
 * KF-META-STATE-REDUCER-LIVE-001), then runs the same comparison on the
 * effective projection. Typed authority, including an explicit HOLD_CLEAR on a
 * RESUME, advances the anchor. The first untyped, unknown, malformed or
 * conflicting message stops the fold; it and everything after it stay newer
 * than the anchor and are reported exactly as before.
 */

import {
  AUTHORITY_MESSAGE_TYPES,
  AUTHORITY_SENDER,
  AUTHORIZED_AUTHORS,
  collectAuthority,
  compareAuthorityOrder,
} from './control-envelope.mjs';
import { reduceAuthority } from './authority-effects.mjs';
import { validateState } from './state.mjs';

// Authority is defined once, in the shared #80 envelope parser; these are
// re-exported so existing importers keep one source.
export { AUTHORITY_MESSAGE_TYPES, AUTHORITY_SENDER, AUTHORIZED_AUTHORS, collectAuthority };

export const FINDINGS = Object.freeze({
  RECONCILIATION_NOT_PERFORMED: 'RECONCILIATION_NOT_PERFORMED',
  AUTHORITY_UNVERIFIABLE: 'AUTHORITY_UNVERIFIABLE',
  AUTHORITY_EDITED: 'AUTHORITY_EDITED',
  AUTHORITY_ORDER_AMBIGUOUS: 'AUTHORITY_ORDER_AMBIGUOUS',
  AUTHORITY_MALFORMED: 'AUTHORITY_MALFORMED',
  DERIVED_STATE_UNANCHORED: 'DERIVED_STATE_UNANCHORED',
  DERIVED_ANCHOR_NOT_FOUND: 'DERIVED_ANCHOR_NOT_FOUND',
  DERIVED_STATE_STALE_AUTHORITY: 'DERIVED_STATE_STALE_AUTHORITY',
  DERIVED_STATE_INVALID: 'DERIVED_STATE_INVALID',
  REPO_TRUTH_UNVERIFIABLE: 'REPO_TRUTH_UNVERIFIABLE',
  SOURCE_MAIN_NOT_ON_MAIN: 'SOURCE_MAIN_NOT_ON_MAIN',
  PR_REFERENCE_MISSING: 'PR_REFERENCE_MISSING',
  PR_ALREADY_MERGED: 'PR_ALREADY_MERGED',
  PR_CLOSED_UNMERGED: 'PR_CLOSED_UNMERGED',
  PR_NOT_MERGED: 'PR_NOT_MERGED',
  PR_BRANCH_MISMATCH: 'PR_BRANCH_MISMATCH',
});

/** Packet states that assert the referenced PR has NOT merged yet. */
const PRE_MERGE_STATES = new Set(['CHARACTERIZING', 'IMPLEMENTING', 'PROVING', 'FIXING_PROOF_FAILURES', 'READY_TO_MERGE']);
/** Packet states that assert the referenced PR HAS merged. */
const POST_MERGE_STATES = new Set(['MERGED', 'CHECKPOINTED']);
/** Packet states that cannot be checked at all without a PR reference. */
const PR_REQUIRED_STATES = new Set(['READY_TO_MERGE', 'MERGED']);

function finding(code, detail) {
  return { code, detail: detail ?? null };
}

function summarize(message) {
  return {
    message_id: message.message_id,
    message_type: message.message_type,
    packet_id: message.packet_id,
    comment_id: message.comment_id,
    created_at: message.created_at,
  };
}

/**
 * Compare the derived projection against authority and repository truth.
 *
 * @param {object} state      normalized programme-state
 * @param {object} authority  collectAuthority() output (lib/control-envelope.mjs)
 * @param {object} repo       {verified, reason?, main_sha, source_main_on_main: true|false|null,
 *                             pr: {number, state, merged, head_ref} | null}
 * @param {object} [reduction] reduceAuthority() result that produced `state`; names why a fold stopped
 * @returns {{consistent: boolean, findings: object[], authority_newest: object|null}}
 */
export function reconcile(state, authority, repo, reduction = null) {
  const findings = [];
  const p = state?.programme || {};

  // --- execution authority (#80) ------------------------------------------
  if (!authority?.verified) {
    // AUTHORITY_EDITED / AUTHORITY_ORDER_AMBIGUOUS name the cause; anything else is unverifiable.
    const code = [FINDINGS.AUTHORITY_EDITED, FINDINGS.AUTHORITY_ORDER_AMBIGUOUS].includes(authority?.code)
      ? authority.code
      : FINDINGS.AUTHORITY_UNVERIFIABLE;
    findings.push(finding(code, authority?.reason || 'no authority snapshot supplied'));
  } else {
    const basis = state?.authority_basis;
    if (!basis?.message_id || basis.comment_id === undefined || basis.comment_id === null) {
      findings.push(finding(FINDINGS.DERIVED_STATE_UNANCHORED, 'programme-state records no authority_basis {message_id, comment_id}'));
    } else {
      const idx = authority.messages.findIndex((m) => String(m.comment_id) === String(basis.comment_id));
      // An anchored projection the state contract rejects is never usable,
      // whether or not anything is newer than its anchor. The fold does not
      // start from one (CHECKPOINT-VALIDATION-017, Copilot r4178799610).
      if (idx >= 0 && authority.messages[idx].message_id === basis.message_id) {
        const rejected = validateState(state).problems;
        if (rejected.length) {
          findings.push(finding(FINDINGS.DERIVED_STATE_INVALID, { anchor: basis, problems: rejected }));
        }
      }
      if (idx < 0 || authority.messages[idx].message_id !== basis.message_id) {
        findings.push(finding(FINDINGS.DERIVED_ANCHOR_NOT_FOUND, {
          anchor: basis,
          reason: 'no valid authority message on #80 has this comment id and message id',
        }));
      } else if (idx < authority.messages.length - 1) {
        findings.push(finding(FINDINGS.DERIVED_STATE_STALE_AUTHORITY, {
          anchor: basis,
          newer: authority.messages.slice(idx + 1).map(summarize),
          // Why the typed fold stopped short of the newest authority, when it ran.
          ...(reduction?.blocked ? { blocked: reduction.blocked } : {}),
        }));
      }
      // Authority that spoke after the anchor but cannot be read is never
      // skipped: it may be a hold. Older malformed messages predate the
      // reviewed projection and are evidence only.
      if (idx >= 0) {
        const anchor = authority.messages[idx];
        const unreadable = (authority.malformed || []).filter((m) => compareAuthorityOrder(m, anchor) > 0);
        if (unreadable.length) {
          findings.push(finding(FINDINGS.AUTHORITY_MALFORMED, {
            anchor: basis,
            malformed: unreadable.map((m) => ({ ...summarize(m), problems: m.problems })),
          }));
        }
      }
    }
  }

  // --- implementation truth (repository) ----------------------------------
  if (!repo?.verified) {
    findings.push(finding(FINDINGS.REPO_TRUTH_UNVERIFIABLE, repo?.reason || 'no repository snapshot supplied'));
  } else {
    if (p.source_main) {
      if (repo.source_main_on_main === false) {
        findings.push(finding(FINDINGS.SOURCE_MAIN_NOT_ON_MAIN, { source_main: p.source_main, main: repo.main_sha ?? null }));
      } else if (repo.source_main_on_main !== true) {
        findings.push(finding(FINDINGS.REPO_TRUTH_UNVERIFIABLE, `ancestry of source_main ${p.source_main} on main was not observed`));
      }
    }

    if (p.pr_number === null || p.pr_number === undefined) {
      if (PR_REQUIRED_STATES.has(p.state)) {
        findings.push(finding(FINDINGS.PR_REFERENCE_MISSING, `derived state ${p.state} names no PR, so it cannot be checked`));
      }
    } else if (!repo.pr || Number(repo.pr.number) !== Number(p.pr_number)) {
      findings.push(finding(FINDINGS.REPO_TRUTH_UNVERIFIABLE, `PR #${p.pr_number} was not observed`));
    } else {
      const pr = repo.pr;
      const merged = pr.merged === true;
      if (PRE_MERGE_STATES.has(p.state) && merged) {
        findings.push(finding(FINDINGS.PR_ALREADY_MERGED, {
          derived_state: p.state,
          pr_number: pr.number,
          note: 'post-merge verification and a re-derived projection are required',
        }));
      } else if (PRE_MERGE_STATES.has(p.state) && pr.state !== 'open') {
        findings.push(finding(FINDINGS.PR_CLOSED_UNMERGED, { derived_state: p.state, pr_number: pr.number }));
      } else if (POST_MERGE_STATES.has(p.state) && !merged) {
        findings.push(finding(FINDINGS.PR_NOT_MERGED, { derived_state: p.state, pr_number: pr.number, pr_state: pr.state }));
      }
      if (p.implementation_branch && pr.head_ref && pr.head_ref !== p.implementation_branch) {
        findings.push(finding(FINDINGS.PR_BRANCH_MISMATCH, { derived: p.implementation_branch, pr_head_ref: pr.head_ref }));
      }
    }
  }

  return {
    consistent: findings.length === 0,
    findings,
    authority_newest: authority?.newest ? summarize(authority.newest) : null,
  };
}

/**
 * Fold newer typed authority over the reviewed checkpoint, then reconcile the
 * effective projection against authority and repository truth.
 *
 * @param {object} checkpoint  programme-state as committed
 * @param {object} authority   collectAuthority() output
 * @param {object|Function} repoFor  repo snapshot, or programme => snapshot, so
 *   repository truth is read for the EFFECTIVE projection's PR and source_main
 * @param {object} [options]   { applicationPackets } for reduceAuthority()
 * @returns reconcile() verdict plus effective_state and a reduction summary
 */
export function reconcileProjection(checkpoint, authority, repoFor, options = {}) {
  const reduction = reduceAuthority(checkpoint, authority, options);
  const effective = reduction.state;
  const repo = typeof repoFor === 'function' ? repoFor(effective?.programme || {}) : repoFor;
  const { state: _effective, ...summary } = reduction;
  return { ...reconcile(effective, authority, repo, reduction), effective_state: effective, reduction: summary };
}

export default { collectAuthority, reconcile, reconcileProjection, FINDINGS, AUTHORITY_MESSAGE_TYPES, AUTHORITY_SENDER, AUTHORIZED_AUTHORS };
