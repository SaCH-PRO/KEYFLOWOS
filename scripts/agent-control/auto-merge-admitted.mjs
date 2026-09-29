#!/usr/bin/env node
/**
 * Exact-head admission evaluator and (optionally) merger.
 *
 * Adopted from the PR #86 prototype and corrected:
 *   - workflow conclusions are only accepted at the EXACT PR head, and runs at
 *     another head are reported as a stale head rather than silently missing;
 *   - the source_head / control-only-tail contract is evaluated here too,
 *     instead of being assumed from the separate gate;
 *   - failures exit non-zero with a structured reason so a caller cannot
 *     mistake an error for a clean no-op. (F5)
 *
 * KF-META-AI-REVIEW-FAILOVER-001 adds:
 *   - the provider-neutral independent semantic review, checked against live
 *     evidence: the PR's Copilot bot reviews and the #80 ChatGPT REVIEW
 *     comments the record cites;
 *   - the PR timeline, so a transition that owes a re-run blocks admission
 *     until that run exists and is green;
 *   - with --merge, a second full snapshot immediately before the merge call.
 *     The merge happens only if both verdicts are eligible at the same head
 *     and base (PR 103 was merged while a newly triggered gate run was pending).
 *
 * Without --merge this is the pre-merge check every merge must pass, manual
 * merges included (docs/development/AGENT_CONTROL_PLANE.md).
 *
 * Exit codes: 0 eligible (and merged with --merge), 3 not eligible, 2 error.
 */

import { parseYaml } from './lib/yaml.mjs';
import { evaluateAdmission, recheckBeforeMerge } from './lib/admission.mjs';
import { CONTROL_ISSUE } from './lib/events.mjs';
import { copilotReviewEvidence, chatgptReviewEvidence } from './lib/semantic-review.mjs';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const prNumber = Number(process.env.PR_NUMBER || 0);
const wantMerge = process.argv.includes('--merge');

if (!token || !repo || !prNumber) {
  process.stderr.write('GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER are required\n');
  process.exit(2);
}

async function api(path, init = {}) {
  const res = await fetch('https://api.github.com' + path, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const error = new Error(`${res.status} ${res.statusText} ${path} ${body}`);
    error.status = res.status;
    throw error;
  }
  return res.status === 204 ? null : res.json();
}

/** Every page of a list endpoint; a truncated list would read as absent evidence. */
async function apiAll(path) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await api(`${path}${sep}per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

const decode = (content) => Buffer.from(content, 'base64').toString('utf8');

async function readControlFile(ref, file) {
  try {
    const raw = await api(`/repos/${repo}/contents/${file}?ref=${ref}`);
    return parseYaml(decode(raw.content));
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

/** The #80 comments a semantic_review record cites. Other locations are not fetched. */
async function chatgptEvidence(ret) {
  const reviews = Array.isArray(ret?.semantic_review?.reviews) ? ret.semantic_review.reviews : [];
  const own = new RegExp(`^https://github\\.com/${repo.replace(/\./g, '\\.')}/issues/${CONTROL_ISSUE}#issuecomment-(\\d+)$`);
  const evidence = [];
  for (const entry of reviews) {
    const m = String(entry?.evidence_location || '').match(own);
    if (String(entry?.provider || '').toLowerCase() !== 'chatgpt' || !m) continue;
    try {
      evidence.push(chatgptReviewEvidence(await api(`/repos/${repo}/issues/comments/${m[1]}`)));
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  return evidence;
}

/**
 * For each reviewed_head that is neither source_head nor the PR head, whether
 * it carries exactly the admitted semantics: it descends from source_head, it
 * is an ancestor of the PR head, and it differs from source_head only under
 * .agent-control/. Proved against the compare API; unknown stays unproved.
 */
async function reviewedHeadLineage(ret, headSha) {
  const reviews = Array.isArray(ret?.semantic_review?.reviews) ? ret.semantic_review.reviews : [];
  const shas = [...new Set(reviews.map((e) => e?.reviewed_head))].filter(
    (sha) => /^[0-9a-f]{40}$/.test(String(sha || '')) && sha !== ret.source_head && sha !== headSha,
  );
  const lineage = {};
  for (const sha of shas) {
    try {
      const fromSource = await api(`/repos/${repo}/compare/${ret.source_head}...${sha}`);
      const toHead = await api(`/repos/${repo}/compare/${sha}...${headSha}`);
      lineage[sha] = {
        descends_from_source_head: fromSource.status === 'ahead' || fromSource.status === 'identical',
        ancestor_of_pr_head: toHead.status === 'ahead' || toHead.status === 'identical',
        non_control_files: (fromSource.files || []).map((f) => f.filename).filter((n) => !n.startsWith('.agent-control/')),
      };
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  return lineage;
}

/** One complete, freshly fetched admission verdict for the PR. */
async function evaluateNow() {
  const pr = await api(`/repos/${repo}/pulls/${prNumber}`);
  const identity = { head_sha: pr.head.sha, base_sha: pr.base.sha };

  const [active, ret] = await Promise.all([
    readControlFile(pr.head.sha, '.agent-control/active-packet.yaml'),
    readControlFile(pr.head.sha, '.agent-control/claude-return.yaml'),
  ]);

  if (!active || !ret) {
    return { eligible: false, reason: 'control_artifacts_missing', ...identity };
  }

  // Ancestry + control-only tail, proved against the API rather than a local clone.
  let ancestry = { source_head_is_ancestor: false, non_control_files: [] };
  if (ret.source_head) {
    try {
      const cmp = await api(`/repos/${repo}/compare/${ret.source_head}...${pr.head.sha}`);
      ancestry = {
        source_head_is_ancestor: cmp.status === 'ahead' || cmp.status === 'identical',
        non_control_files: (cmp.files || [])
          .map((f) => f.filename)
          .filter((name) => !name.startsWith('.agent-control/')),
      };
    } catch (error) {
      if (error.status !== 404) throw error;
      ancestry = { source_head_is_ancestor: false, non_control_files: [] };
    }
  }

  const runs = await api(`/repos/${repo}/actions/runs?head_sha=${pr.head.sha}&per_page=100`);
  const workflow_runs = (runs.workflow_runs || []).map((r) => ({
    id: r.id,
    name: r.name,
    head_sha: r.head_sha,
    status: r.status,
    conclusion: r.conclusion,
    created_at: r.created_at,
  }));

  const [reviews, events, chatgpt, lineage] = await Promise.all([
    apiAll(`/repos/${repo}/pulls/${prNumber}/reviews`),
    apiAll(`/repos/${repo}/issues/${prNumber}/events`),
    chatgptEvidence(ret),
    ret.source_head ? reviewedHeadLineage(ret, pr.head.sha) : {},
  ]);

  const verdict = evaluateAdmission({
    pr: {
      number: pr.number,
      state: pr.state,
      draft: pr.draft,
      head_sha: pr.head.sha,
      base_sha: pr.base.sha,
      head_ref: pr.head.ref,
    },
    active,
    ret,
    ancestry,
    workflow_runs,
    pr_transitions: events.map((e) => ({ event: e.event, created_at: e.created_at })),
    reviewed_head_lineage: lineage,
    semantic_review_live: {
      copilot: reviews.map(copilotReviewEvidence).filter(Boolean),
      chatgpt,
    },
    contradictions: Array.isArray(ret.unresolved_contradictions)
      ? ret.unresolved_contradictions.map((c) => (typeof c === 'string' ? c : c.id)).filter(Boolean)
      : [],
  });
  return { ...verdict, ...identity, title: pr.title };
}

async function main() {
  const first = await evaluateNow();
  if (!first.eligible || !wantMerge) return { ...first, pr: prNumber };

  // Immediately before the merge call, collect everything again. A run
  // triggered since the first snapshot, a moved head or a moved base must
  // stop the merge, not follow it.
  const verdict = recheckBeforeMerge(first, await evaluateNow());
  const result = { ...verdict, pr: prNumber };
  if (!verdict.eligible) return result;

  // Merging by the exact head sha: if the head moved, GitHub rejects rather
  // than merging a tree that was never admitted.
  result.merge = await api(`/repos/${repo}/pulls/${prNumber}/merge`, {
    method: 'PUT',
    body: JSON.stringify({ sha: verdict.head_sha, merge_method: 'squash', commit_title: verdict.title }),
    headers: { 'Content-Type': 'application/json' },
  });
  return result;
}

main()
  .then((result) => {
    process.stdout.write(JSON.stringify(result));
    process.exit(result.eligible ? 0 : 3);
  })
  .catch((error) => {
    // An unexpected failure is never a silent no-op.
    process.stdout.write(JSON.stringify({ eligible: false, reason: 'evaluator_error', error: error.message, pr: prNumber }));
    process.stderr.write(`admission evaluator failed: ${error.stack || error.message}\n`);
    process.exit(2);
  });
