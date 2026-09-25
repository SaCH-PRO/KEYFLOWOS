/**
 * Gather the authority and repository snapshots that lib/reconcile.mjs compares.
 *
 * Every failure becomes `verified: false` with a reason, never an empty-but-
 * verified snapshot: an unreadable #80 must look unverifiable, not "no newer
 * authority". The GitHub CLI is used so a local operator's and a runner's
 * existing auth both work (GH_TOKEN / GITHUB_TOKEN on a runner).
 */

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CONTROL_ISSUE } from './events.mjs';
import { collectAuthority, reconcile } from './reconcile.mjs';

export const DEFAULT_REPOSITORY = 'SaCH-PRO/KEYFLOWOS';

export function ghRunner(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

function errorText(error) {
  return String(error?.stderr || error?.message || error).trim().split('\n')[0];
}

export function fetchComments(repository, run = ghRunner) {
  try {
    const pages = JSON.parse(run(['api', '--paginate', '--slurp', `repos/${repository}/issues/${CONTROL_ISSUE}/comments?per_page=100`]));
    if (!Array.isArray(pages)) return { ok: false, reason: 'issue #80 comment listing was not an array' };
    return { ok: true, comments: pages.flat() };
  } catch (error) {
    return { ok: false, reason: `issue #80 unreadable: ${errorText(error)}` };
  }
}

/**
 * @param {object} programme  state.programme
 * @returns {object} repo snapshot for reconcile()
 */
export function fetchRepoTruth(repository, programme = {}, run = ghRunner) {
  const snapshot = { verified: true, main_sha: null, source_main_on_main: null, pr: null };
  try {
    snapshot.main_sha = JSON.parse(run(['api', `repos/${repository}/commits/main`])).sha || null;
    if (!snapshot.main_sha) return { verified: false, reason: 'main has no resolvable sha' };

    if (programme.source_main) {
      try {
        const cmp = JSON.parse(run(['api', `repos/${repository}/compare/${programme.source_main}...${snapshot.main_sha}`]));
        snapshot.source_main_on_main = cmp.status === 'ahead' || cmp.status === 'identical';
      } catch (error) {
        // A sha GitHub does not know is definitively not on main; anything else is unknown.
        if (/HTTP 404/.test(errorText(error))) snapshot.source_main_on_main = false;
        else return { verified: false, reason: `source_main ancestry unreadable: ${errorText(error)}` };
      }
    }

    if (programme.pr_number !== null && programme.pr_number !== undefined) {
      const pr = JSON.parse(run(['api', `repos/${repository}/pulls/${programme.pr_number}`]));
      snapshot.pr = { number: pr.number, state: pr.state, merged: pr.merged === true, head_ref: pr.head?.ref || null };
    }
    return snapshot;
  } catch (error) {
    return { verified: false, reason: `repository truth unreadable: ${errorText(error)}` };
  }
}

/**
 * Live snapshot, or a recorded one from a JSON file
 * ({comments: [...] | null, repo: {...}}) so a verdict can be reproduced exactly.
 */
export function gatherTruth(state, options = {}) {
  if (options.truthFile) {
    const recorded = JSON.parse(fs.readFileSync(options.truthFile, 'utf8'));
    return {
      comments: Array.isArray(recorded.comments) ? recorded.comments : null,
      commentsReason: 'recorded snapshot has no comments array',
      repo: recorded.repo || { verified: false, reason: 'recorded snapshot has no repo truth' },
    };
  }
  const repository = options.repository || process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const run = options.run || ghRunner;
  const comments = fetchComments(repository, run);
  return {
    comments: comments.ok ? comments.comments : null,
    commentsReason: comments.reason,
    repo: fetchRepoTruth(repository, state.programme || {}, run),
  };
}

/** gatherTruth() + reconcile() in one step; what the CLIs call. */
export function reconcileWithTruth(state, options = {}) {
  const truth = gatherTruth(state, options);
  const authority = truth.comments
    ? collectAuthority(truth.comments)
    : { verified: false, reason: truth.commentsReason, messages: [], newest: null, rejected: 0 };
  return reconcile(state, authority, truth.repo);
}

export default { gatherTruth, reconcileWithTruth, fetchComments, fetchRepoTruth, ghRunner, DEFAULT_REPOSITORY };
