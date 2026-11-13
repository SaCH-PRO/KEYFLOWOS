/**
 * Which open implementation PRs have a gate that main has moved out from under.
 *
 * The Agent Control Gate checks out the PR merged with its base and requires
 * that nothing outside .agent-control/ differs from the PR's `source_head`.
 * So every merge to main that changes a non-control file fails the gate of
 * every open impl/ PR the next time that gate runs -- while the PR goes on
 * showing the green run it got before main moved. On a non-draft PR the gate
 * also requires both artifacts' `source_main` to equal the base.
 *
 * This module only detects and explains. It never repairs, and the repair it
 * describes is not automatic: an ordinary merge of main into the branch makes
 * a new semantic head, and a new semantic head owes a fresh independent
 * review. Detection must not become a way around that.
 *
 * `gatherGateFacts` reads GitHub through an injected runner (the `gh` CLI in
 * production, as lib/truth.mjs does). Any read that fails throws: a PR whose
 * facts could not be read is never reported as "not stale".
 */

import { parseYaml } from './yaml.mjs';

export const GATE_WORKFLOW = 'Agent Control Gate';

export const STALE_REASONS = Object.freeze({
  /** main changed non-control files this branch does not have: the gate's diff will not be control-only. */
  BEHIND_MAIN: 'behind_main_with_non_control_changes',
  /** The branch conflicts with main: there is no merge for the gate to check. */
  CONFLICTING: 'conflicts_with_main',
  /** The artifacts name another base: a non-draft PR fails "revalidated against the current base". */
  SOURCE_MAIN_NOT_BASE: 'source_main_is_not_the_base',
  /** The newest gate run is older than main's tip: its colour says nothing about today. */
  GATE_RUN_PREDATES_MAIN: 'gate_run_predates_main',
  ARTIFACTS_MISSING: 'control_artifacts_missing',
});

/** The compare API lists at most this many files; at the limit the list may be cut. */
export const COMPARE_FILE_LIMIT = 300;

export const REPAIR = 'merge origin/main into the branch (no rebase, no force push); the merge commit becomes the new source_head and source_main moves to the new base; one control-only commit updates the artifacts; a FRESH independent semantic review of the new head is then owed before admission';

const isControl = (file) => String(file).startsWith('.agent-control/');

/**
 * @param {object} f
 *   pr: {number, head_ref, head_sha, base_sha, draft, mergeable}
 *   main: {sha, committed_at}
 *   compare: {behind_by, files: string[], truncated: boolean}   files main changed since the merge base
 *   artifacts: {active_source_main, return_source_main, source_head} | null
 *   gate_run: {conclusion, status, created_at, head_sha} | null   newest gate run at the PR head
 */
export function assessGate(f) {
  const reasons = [];
  const nonControl = f.compare.files.filter((file) => !isControl(file));
  // A cut file list cannot prove the difference is control-only.
  const behind = f.compare.behind_by > 0 && (nonControl.length > 0 || f.compare.truncated);
  if (behind) reasons.push(STALE_REASONS.BEHIND_MAIN);
  if (f.pr.mergeable === false) reasons.push(STALE_REASONS.CONFLICTING);
  if (!f.artifacts) reasons.push(STALE_REASONS.ARTIFACTS_MISSING);
  else if (f.artifacts.active_source_main !== f.main.sha || f.artifacts.return_source_main !== f.main.sha) reasons.push(STALE_REASONS.SOURCE_MAIN_NOT_BASE);

  const run = f.gate_run;
  const predates = Boolean(run && Date.parse(run.created_at) < Date.parse(f.main.committed_at) && f.compare.behind_by > 0);
  if (predates) reasons.push(STALE_REASONS.GATE_RUN_PREDATES_MAIN);

  // What the gate would do if it ran now. SOURCE_MAIN_NOT_BASE fails it only
  // once the PR is not a draft; the others fail it regardless.
  const failsNow = behind || f.pr.mergeable === false || !f.artifacts || (f.pr.draft === false && reasons.includes(STALE_REASONS.SOURCE_MAIN_NOT_BASE));
  return {
    number: f.pr.number,
    head_ref: f.pr.head_ref,
    head_sha: f.pr.head_sha,
    draft: f.pr.draft === true,
    behind_main_by: f.compare.behind_by,
    non_control_files_behind: nonControl.length,
    compare_truncated: f.compare.truncated,
    source_main: f.artifacts ? { active: f.artifacts.active_source_main, return: f.artifacts.return_source_main } : null,
    last_gate_run: run ? { conclusion: run.conclusion ?? run.status, created_at: run.created_at } : null,
    // A green run that predates main is the misleading case: it looks fine.
    misleading_green: predates && run.conclusion === 'success' && failsNow,
    stale: reasons.length > 0,
    gate_would_fail_now: failsNow,
    fails_when_marked_ready: f.pr.draft === true && reasons.includes(STALE_REASONS.SOURCE_MAIN_NOT_BASE),
    reasons,
    repair: reasons.length ? REPAIR : null,
  };
}

const scalar = (doc, key) => (doc && typeof doc[key] === 'string' ? doc[key] : doc && doc[key] != null ? String(doc[key]) : null);

/**
 * Read everything assessGate needs for every open impl/ PR of this repository.
 * `run(args)` executes `gh <args>` and returns stdout, throwing on failure.
 */
export function gatherGateFacts(repository, run) {
  const json = (args) => JSON.parse(run(args));
  const mainCommit = json(['api', `repos/${repository}/commits/main`]);
  const main = { sha: mainCommit.sha, committed_at: mainCommit.commit?.committer?.date };
  if (!main.sha || !main.committed_at) throw new Error('main has no resolvable commit');

  const pages = json(['api', '--paginate', '--slurp', `repos/${repository}/pulls?state=open&per_page=100`]);
  if (!Array.isArray(pages)) throw new Error('the open pull request listing was not a list');
  const open = pages.flat();
  const impl = open.filter((pr) => String(pr?.head?.ref || '').startsWith('impl/') && String(pr?.head?.repo?.full_name || '').toLowerCase() === repository.toLowerCase());

  const facts = [];
  for (const listed of impl) {
    const pr = json(['api', `repos/${repository}/pulls/${listed.number}`]);
    const cmp = json(['api', `repos/${repository}/compare/${pr.head.sha}...${main.sha}`]);
    const files = (cmp.files || []).map((x) => x.filename);

    const artifact = (name) => {
      try {
        const raw = json(['api', `repos/${repository}/contents/.agent-control/${name}?ref=${pr.head.sha}`]);
        return parseYaml(Buffer.from(raw.content, 'base64').toString('utf8'));
      } catch (error) {
        // Absent is a finding; anything else is a failed read.
        if (/HTTP 404/.test(String(error?.stderr || error?.message || error))) return null;
        throw error;
      }
    };
    const active = artifact('active-packet.yaml');
    const ret = artifact('claude-return.yaml');
    const runs = json(['api', `repos/${repository}/actions/runs?head_sha=${pr.head.sha}&per_page=100`]);
    const gateRuns = (runs.workflow_runs || []).filter((r) => r.name === GATE_WORKFLOW).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

    facts.push({
      pr: { number: pr.number, head_ref: pr.head.ref, head_sha: pr.head.sha, base_sha: pr.base.sha, draft: pr.draft === true, mergeable: pr.mergeable },
      main,
      // head...main: commits main has that the head lacks, and the files they changed.
      compare: { behind_by: cmp.ahead_by ?? 0, files, truncated: files.length >= COMPARE_FILE_LIMIT },
      artifacts: active && ret ? { active_source_main: scalar(active, 'source_main'), return_source_main: scalar(ret, 'source_main'), source_head: scalar(ret, 'source_head') } : null,
      gate_run: gateRuns[0] ? { conclusion: gateRuns[0].conclusion, status: gateRuns[0].status, created_at: gateRuns[0].created_at, head_sha: gateRuns[0].head_sha } : null,
    });
  }
  return { main, open_total: open.length, impl_total: impl.length, facts };
}

export function reportStaleGates(repository, run) {
  const gathered = gatherGateFacts(repository, run);
  const prs = gathered.facts.map(assessGate);
  return {
    main: gathered.main.sha,
    open_total: gathered.open_total,
    impl_total: gathered.impl_total,
    stale: prs.filter((p) => p.stale).map((p) => p.number),
    gate_would_fail_now: prs.filter((p) => p.gate_would_fail_now).map((p) => p.number),
    misleading_green: prs.filter((p) => p.misleading_green).map((p) => p.number),
    prs,
  };
}

export default { STALE_REASONS, REPAIR, GATE_WORKFLOW, COMPARE_FILE_LIMIT, assessGate, gatherGateFacts, reportStaleGates };
