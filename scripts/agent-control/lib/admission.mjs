/**
 * AUTO-ADMISSION — exact-head admission evaluator.
 *
 * Pure function over a snapshot so it is testable without network access and
 * so every verdict is reproducible from recorded evidence.
 *
 * It never grants admission. It only decides whether an admission ALREADY
 * granted by authority may be mechanically executed against this exact head.
 */

import { REQUIRED_WORKFLOWS } from './events.mjs';
import { evaluateSemanticReview } from './semantic-review.mjs';

export const ADMISSION_REASONS = Object.freeze({
  PR_NOT_OPEN: 'pr_not_open',
  PR_IS_DRAFT: 'pr_is_draft',
  NOT_IMPL_BRANCH: 'not_impl_branch',
  REVIEW_NOT_READY: 'review_not_ready',
  PRODUCTION_TOUCHED: 'production_touched',
  SOURCE_MAIN_DRIFT: 'source_main_drift',
  SOURCE_HEAD_MISSING: 'source_head_missing',
  SOURCE_HEAD_NOT_ANCESTOR: 'source_head_not_ancestor',
  NON_CONTROL_TAIL: 'non_control_tail',
  SCOPE_CHANGED: 'scope_changed_without_authority',
  UNRESOLVED_CONTRADICTION: 'unresolved_contradiction',
  UNEXPLAINED_PROOF: 'unexplained_failed_or_skipped_proof',
  MISSING_WORKFLOWS: 'missing_workflows',
  WORKFLOWS_NOT_GREEN: 'workflows_not_green',
  STALE_WORKFLOW_HEAD: 'workflow_runs_not_at_exact_head',
  REQUIRED_CHECK_PENDING: 'required_check_pending_at_head',
  TRANSITIONS_UNKNOWN: 'pr_transitions_unknown',
  CHECKS_PREDATE_TRANSITION: 'required_checks_predate_pr_transition',
  SEMANTIC_REVIEW_NOT_SATISFIED: 'semantic_review_not_satisfied',
  CHANGED_BEFORE_MERGE: 'admission_changed_before_merge',
  ELIGIBLE: 'all_admission_contracts_satisfied',
});

const READY_STATUSES = new Set(['READY_TO_MERGE', 'ACCEPT_FOR_ADMISSION']);

/**
 * PR timeline events that re-run required workflows at an unchanged head, and
 * which workflows they re-run (the `on.pull_request.types` of each workflow).
 * A transition newer than a workflow's latest run means a run is owed that the
 * run list may not show yet: GitHub creates it seconds after the event. PR 103
 * was merged 7s after ready_for_review, while the Agent Control Gate run that
 * event triggered was in progress; it then failed.
 * (CG-DECISION-META-AI-REVIEW-FAILOVER-001, admission-order correction)
 */
export const TRANSITION_TRIGGERS = Object.freeze({
  reopened: REQUIRED_WORKFLOWS,
  ready_for_review: Object.freeze(['Agent Control Gate']),
  converted_to_draft: Object.freeze(['Agent Control Gate']),
  renamed: Object.freeze(['Agent Control Gate']),
  base_ref_changed: Object.freeze(['Agent Control Gate']),
});

function fail(reason, detail) {
  return { eligible: false, reason, detail: detail ?? null };
}

/**
 * @param {object} snapshot
 *   pr: {number, state, draft, head_sha, base_sha, head_ref}
 *   active: parsed active-packet.yaml
 *   ret: parsed claude-return.yaml
 *   workflow_runs: [{name, head_sha, status, conclusion, created_at}]
 *   ancestry: {source_head_is_ancestor: bool, non_control_files: string[]}
 *   contradictions: string[]
 *   pr_transitions: [{event, created_at}] from the PR timeline
 *   semantic_review_live: {copilot: [...], chatgpt: [...]} (lib/semantic-review.mjs)
 *   reviewed_head_lineage: {[sha]: {descends_from_source_head, ancestor_of_pr_head, non_control_files}}
 */
export function evaluateAdmission(snapshot) {
  const { pr = {}, active = {}, ret = {}, ancestry = {}, contradictions = [] } = snapshot;
  const runs = snapshot.workflow_runs || [];

  if (pr.state !== 'open') return fail(ADMISSION_REASONS.PR_NOT_OPEN, pr.state);
  if (pr.draft === true) return fail(ADMISSION_REASONS.PR_IS_DRAFT);
  if (!String(pr.head_ref || '').startsWith('impl/')) return fail(ADMISSION_REASONS.NOT_IMPL_BRANCH, pr.head_ref);

  // --- authority ---------------------------------------------------------
  if (!READY_STATUSES.has(String(ret.review_status))) {
    return fail(ADMISSION_REASONS.REVIEW_NOT_READY, ret.review_status ?? null);
  }

  // --- safety ------------------------------------------------------------
  if (active.production_touched === true || ret.production_touched === true) {
    return fail(ADMISSION_REASONS.PRODUCTION_TOUCHED);
  }
  if (ret.scope_changed === true && !ret.scope_change_authority) {
    return fail(ADMISSION_REASONS.SCOPE_CHANGED);
  }
  if (contradictions.length) return fail(ADMISSION_REASONS.UNRESOLVED_CONTRADICTION, contradictions.join(','));

  // --- exact identity ----------------------------------------------------
  if (String(active.source_main) !== String(pr.base_sha) || String(ret.source_main) !== String(pr.base_sha)) {
    return fail(ADMISSION_REASONS.SOURCE_MAIN_DRIFT, {
      pr_base: pr.base_sha,
      active: active.source_main ?? null,
      ret: ret.source_main ?? null,
    });
  }
  if (!ret.source_head) return fail(ADMISSION_REASONS.SOURCE_HEAD_MISSING);
  if (ancestry.source_head_is_ancestor !== true) return fail(ADMISSION_REASONS.SOURCE_HEAD_NOT_ANCESTOR, ret.source_head);
  if ((ancestry.non_control_files || []).length) {
    return fail(ADMISSION_REASONS.NON_CONTROL_TAIL, ancestry.non_control_files);
  }

  // --- independent semantic review ----------------------------------------
  // Provider-neutral: Copilot when it ran, ChatGPT only when Copilot is
  // recorded and evidenced as NOT_RUN. Never the implementer.
  const review = evaluateSemanticReview({
    record: ret.semantic_review,
    source_head: ret.source_head,
    pr_head: pr.head_sha,
    lineage: snapshot.reviewed_head_lineage,
    live: snapshot.semantic_review_live,
  });
  if (!review.satisfied) {
    return fail(ADMISSION_REASONS.SEMANTIC_REVIEW_NOT_SATISFIED, { reason: review.reason, detail: review.detail });
  }

  // --- proof -------------------------------------------------------------
  const tests = ret.tests || {};
  const failed = Number(tests.failed || 0);
  const skipped = Number(tests.skipped || 0);
  if (failed > 0 || (skipped > 0 && !ret.skipped_justification)) {
    return fail(ADMISSION_REASONS.UNEXPLAINED_PROOF, { failed, skipped });
  }

  // --- CI at the EXACT head ---------------------------------------------
  // Runs for any other sha prove nothing about this tree.
  const atHead = runs.filter((r) => String(r.head_sha) === String(pr.head_sha));
  const latest = new Map();
  for (const run of atHead) {
    if (!REQUIRED_WORKFLOWS.includes(run.name)) continue;
    const prev = latest.get(run.name);
    if (!prev || new Date(run.created_at) > new Date(prev.created_at)) latest.set(run.name, run);
  }

  const missing = REQUIRED_WORKFLOWS.filter((name) => !latest.has(name));
  if (missing.length) {
    const elsewhere = runs.filter((r) => REQUIRED_WORKFLOWS.includes(r.name) && String(r.head_sha) !== String(pr.head_sha));
    if (elsewhere.length) {
      return fail(ADMISSION_REASONS.STALE_WORKFLOW_HEAD, {
        missing_at_head: missing,
        head_sha: pr.head_sha,
        runs_at_other_heads: [...new Set(elsewhere.map((r) => r.head_sha))],
      });
    }
    return fail(ADMISSION_REASONS.MISSING_WORKFLOWS, missing);
  }

  // A required run at this head that has not finished is unresolved, even when
  // an older run of the same workflow succeeded: merging now would admit a head
  // whose newest verdict is unknown.
  const pending = atHead.filter((r) => REQUIRED_WORKFLOWS.includes(r.name) && r.status !== 'completed');
  if (pending.length) {
    return fail(ADMISSION_REASONS.REQUIRED_CHECK_PENDING, pending.map((r) => ({ workflow: r.name, status: r.status, run_id: r.id ?? null })));
  }

  if (!Array.isArray(snapshot.pr_transitions)) return fail(ADMISSION_REASONS.TRANSITIONS_UNKNOWN);
  const owed = [];
  for (const t of snapshot.pr_transitions) {
    const affected = TRANSITION_TRIGGERS[t?.event];
    if (!affected) continue;
    for (const name of affected) {
      if (new Date(latest.get(name).created_at) < new Date(t.created_at)) {
        owed.push({ workflow: name, transition: t.event, transition_at: t.created_at, latest_run_at: latest.get(name).created_at });
      }
    }
  }
  if (owed.length) return fail(ADMISSION_REASONS.CHECKS_PREDATE_TRANSITION, owed);

  const notGreen = REQUIRED_WORKFLOWS.filter((name) => {
    const run = latest.get(name);
    return !(run.status === 'completed' && run.conclusion === 'success');
  });
  if (notGreen.length) {
    return fail(ADMISSION_REASONS.WORKFLOWS_NOT_GREEN, notGreen.map((n) => ({ workflow: n, conclusion: latest.get(n).conclusion })));
  }

  return {
    eligible: true,
    reason: ADMISSION_REASONS.ELIGIBLE,
    head_sha: pr.head_sha,
    base_sha: pr.base_sha,
    evidence: {
      review_status: ret.review_status,
      semantic_review: review.evidence,
      source_head: ret.source_head,
      workflows: REQUIRED_WORKFLOWS.map((n) => ({ workflow: n, run_id: latest.get(n).id ?? null, conclusion: 'success' })),
    },
  };
}

/**
 * The verdict a merge may act on, given two evaluations of freshly collected
 * snapshots: one to decide, one taken immediately before the merge call. Both
 * must be eligible for the same head and base; anything that changed between
 * them (a new run, a transition, a moved head or base) blocks the merge.
 */
export function recheckBeforeMerge(first, second) {
  if (!first?.eligible) return first;
  if (!second?.eligible) return second ?? fail(ADMISSION_REASONS.CHANGED_BEFORE_MERGE, 'no recheck');
  if (String(first.head_sha) !== String(second.head_sha) || String(first.base_sha) !== String(second.base_sha)) {
    return fail(ADMISSION_REASONS.CHANGED_BEFORE_MERGE, {
      first: { head_sha: first.head_sha, base_sha: first.base_sha },
      second: { head_sha: second.head_sha, base_sha: second.base_sha },
    });
  }
  return second;
}

export default { evaluateAdmission, recheckBeforeMerge, ADMISSION_REASONS, TRANSITION_TRIGGERS };
