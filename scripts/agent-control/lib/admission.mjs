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
  ELIGIBLE: 'all_admission_contracts_satisfied',
});

const READY_STATUSES = new Set(['READY_TO_MERGE', 'ACCEPT_FOR_ADMISSION']);

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
      source_head: ret.source_head,
      workflows: REQUIRED_WORKFLOWS.map((n) => ({ workflow: n, run_id: latest.get(n).id ?? null, conclusion: 'success' })),
    },
  };
}

export default { evaluateAdmission, ADMISSION_REASONS };
