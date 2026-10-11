/**
 * Complete, read-only discovery of the open implementation PRs.
 *
 * The hourly sweep listed open PRs with `gh pr list`, whose default is the 30
 * newest. With more than 30 open, the oldest implementation PRs were never
 * looked at by the one job meant to catch what event-driven runs miss, and
 * nothing said so.
 *
 * Discovery is kept apart from eligibility. This module only answers "which
 * open PRs are implementation PRs of this repository, and which of them did
 * the sweep already cover". It reads; it never merges and never judges
 * admission. Every PR it names still goes through auto-merge-admitted.mjs.
 *
 * It does NOT widen what the sweep may merge. The merge window stays exactly
 * what `gh pr list` gave the sweep before: the MERGE_WINDOW newest open PRs.
 * An implementation PR outside that window is reported in `observe` mode, in
 * which the sweep runs the evaluator without --merge and says what it found.
 * Widening the window is a decision for authority, made by changing one
 * constant in a reviewed commit.
 *
 * Fail closed: a page that cannot be read, or is not a list, throws. An
 * incomplete listing must never look like a short one.
 */

/** The `gh pr list` default the sweep has always run under. Not a tuning knob. */
export const MERGE_WINDOW = 30;

export const PER_PAGE = 100;

/** Far above any real backlog; a listing that never ends is an error, not a loop. */
export const MAX_PAGES = 50;

export const SWEEP_MODES = Object.freeze({ MERGE: 'merge', OBSERVE: 'observe' });

/** Newest first, the order `gh pr list` and the sweep have always used. */
export const LIST_QUERY = `state=open&sort=created&direction=desc&per_page=${PER_PAGE}`;

/**
 * Every open PR, newest first. `listPage(page)` returns one page of
 * GET /repos/{repo}/pulls and throws on any failure.
 */
export async function listOpenPrs(listPage) {
  const seen = new Set();
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await listPage(page);
    if (!Array.isArray(batch)) throw new Error(`page ${page} of the open pull requests is not a list`);
    for (const pr of batch) {
      if (!Number.isInteger(pr?.number) || pr.number <= 0) throw new Error(`page ${page} holds an entry with no pull request number`);
      // A PR opened between two page reads shifts the next page by one and
      // repeats an entry. Kept once, at its first (newest) position.
      if (seen.has(pr.number)) continue;
      seen.add(pr.number);
      all.push(pr);
    }
    if (batch.length < PER_PAGE) return { prs: all, pages: page };
  }
  throw new Error(`the open pull request listing did not end within ${MAX_PAGES} pages`);
}

/**
 * Which open PRs the sweep reconciles, and how.
 *
 * An implementation PR is one whose head is an `impl/` branch OF THIS
 * REPOSITORY. evaluateAdmission checks the branch name but not where the
 * branch lives, so a fork's `impl/x` is left out here and listed under
 * `excluded_forks` rather than handed to the evaluator.
 */
export function planSweep(prs, repo) {
  const impl = [];
  const excluded_forks = [];
  prs.forEach((pr, index) => {
    const ref = String(pr?.head?.ref || '');
    if (!ref.startsWith('impl/')) return;
    const headRepo = pr?.head?.repo?.full_name ?? null;
    if (String(headRepo || '').toLowerCase() !== String(repo).toLowerCase()) {
      excluded_forks.push({ number: pr.number, head_ref: ref, head_repo: headRepo });
      return;
    }
    impl.push({
      number: pr.number,
      head_ref: ref,
      head_sha: pr.head.sha ?? null,
      draft: pr.draft === true,
      // Position among ALL open PRs decides the mode: the first MERGE_WINDOW
      // are what the sweep has always been handed.
      mode: index < MERGE_WINDOW ? SWEEP_MODES.MERGE : SWEEP_MODES.OBSERVE,
    });
  });
  return {
    complete: true,
    open_total: prs.length,
    merge_window: MERGE_WINDOW,
    impl,
    in_merge_window: impl.filter((p) => p.mode === SWEEP_MODES.MERGE).length,
    observed_only: impl.filter((p) => p.mode === SWEEP_MODES.OBSERVE).length,
    excluded_forks,
  };
}

/** Discover and plan in one call. */
export async function discoverSweep(listPage, repo) {
  const { prs, pages } = await listOpenPrs(listPage);
  return { ...planSweep(prs, repo), pages };
}

/** One line per PR for the workflow's shell loop: `<number> <mode>`. */
export function sweepLines(plan) {
  return plan.impl.map((p) => `${p.number} ${p.mode}`);
}

export default { MERGE_WINDOW, PER_PAGE, MAX_PAGES, SWEEP_MODES, LIST_QUERY, listOpenPrs, planSweep, discoverSweep, sweepLines };
