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
 * by message id and prose. Rather than infer meaning from either, ANY valid
 * authority message newer than the one the projection is anchored to makes the
 * projection stale. A newer hold therefore always wins over an older derived
 * "advance", and a resume can never be applied by automation.
 */

import { parseControlMessage } from './events.mjs';

/** Message types that carry execution authority when ChatGPT sends them. */
export const AUTHORITY_MESSAGE_TYPES = Object.freeze(['DIRECTIVE', 'REVIEW', 'HOLD', 'RESUME']);

/** Exact sender value. Matches the worker's dispatch rule (select-directive.ps1). */
export const AUTHORITY_SENDER = 'chatgpt';

/**
 * GitHub accounts whose comments may carry authority. Must equal
 * AGENT_AUTOPILOT_POLICY.yaml worker.dispatch_authority.author_allowlist; the
 * repository is public, so `sender:` alone proves nothing.
 */
export const AUTHORIZED_AUTHORS = Object.freeze(['SaCH-PRO']);

export const FINDINGS = Object.freeze({
  RECONCILIATION_NOT_PERFORMED: 'RECONCILIATION_NOT_PERFORMED',
  AUTHORITY_UNVERIFIABLE: 'AUTHORITY_UNVERIFIABLE',
  DERIVED_STATE_UNANCHORED: 'DERIVED_STATE_UNANCHORED',
  DERIVED_ANCHOR_NOT_FOUND: 'DERIVED_ANCHOR_NOT_FOUND',
  DERIVED_STATE_STALE_AUTHORITY: 'DERIVED_STATE_STALE_AUTHORITY',
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
 * Reduce raw issue #80 comments to the ordered list of valid authority messages.
 *
 * @param {Array|null} comments GitHub issue comments ({id, created_at, user:{login}, body})
 * @param {object} [options] { authors } allowlist override for tests
 * @returns {{verified: boolean, reason?: string, messages: object[], newest: object|null, rejected: number}}
 */
export function collectAuthority(comments, options = {}) {
  if (!Array.isArray(comments)) {
    return { verified: false, reason: 'issue #80 comments were not observed', messages: [], newest: null, rejected: 0 };
  }
  const authors = (options.authors || AUTHORIZED_AUTHORS).map((a) => String(a).toLowerCase());
  const messages = [];
  let rejected = 0;

  for (const comment of comments) {
    const msg = parseControlMessage(comment?.body || '');
    if (!msg.message_type || !AUTHORITY_MESSAGE_TYPES.includes(msg.message_type)) continue;
    const author = String(comment?.user?.login || '').toLowerCase();
    // Exact, case-sensitive sender (as the worker); allowlisted GitHub author.
    if (msg.sender !== AUTHORITY_SENDER || !authors.includes(author) || !msg.message_id) {
      rejected += 1;
      continue;
    }
    if (comment.id === undefined || comment.id === null || !comment.created_at) {
      return { verified: false, reason: 'an authority comment has no id or timestamp; ordering is not deterministic', messages: [], newest: null, rejected };
    }
    messages.push({ ...msg, comment_id: comment.id, created_at: comment.created_at, author: comment.user.login });
  }

  // Oldest first. Comment ids are monotonic on GitHub and break timestamp ties.
  messages.sort((a, b) => {
    const t = Date.parse(a.created_at) - Date.parse(b.created_at);
    return t !== 0 ? t : Number(a.comment_id) - Number(b.comment_id);
  });

  return { verified: true, messages, newest: messages.length ? messages[messages.length - 1] : null, rejected };
}

/**
 * Compare the derived projection against authority and repository truth.
 *
 * @param {object} state      normalized programme-state
 * @param {object} authority  collectAuthority() output
 * @param {object} repo       {verified, reason?, main_sha, source_main_on_main: true|false|null,
 *                             pr: {number, state, merged, head_ref} | null}
 * @returns {{consistent: boolean, findings: object[], authority_newest: object|null}}
 */
export function reconcile(state, authority, repo) {
  const findings = [];
  const p = state?.programme || {};

  // --- execution authority (#80) ------------------------------------------
  if (!authority?.verified) {
    findings.push(finding(FINDINGS.AUTHORITY_UNVERIFIABLE, authority?.reason || 'no authority snapshot supplied'));
  } else {
    const basis = state?.authority_basis;
    if (!basis?.message_id || basis.comment_id === undefined || basis.comment_id === null) {
      findings.push(finding(FINDINGS.DERIVED_STATE_UNANCHORED, 'programme-state records no authority_basis {message_id, comment_id}'));
    } else {
      const idx = authority.messages.findIndex((m) => String(m.comment_id) === String(basis.comment_id));
      if (idx < 0 || authority.messages[idx].message_id !== basis.message_id) {
        findings.push(finding(FINDINGS.DERIVED_ANCHOR_NOT_FOUND, {
          anchor: basis,
          reason: 'no valid authority message on #80 has this comment id and message id',
        }));
      } else if (idx < authority.messages.length - 1) {
        findings.push(finding(FINDINGS.DERIVED_STATE_STALE_AUTHORITY, {
          anchor: basis,
          newer: authority.messages.slice(idx + 1).map(summarize),
        }));
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

export default { collectAuthority, reconcile, FINDINGS, AUTHORITY_MESSAGE_TYPES, AUTHORITY_SENDER, AUTHORIZED_AUTHORS };
