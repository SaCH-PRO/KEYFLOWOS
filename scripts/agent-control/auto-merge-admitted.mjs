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
 * Exit codes: 0 eligible (and merged with --merge), 3 not eligible, 2 error.
 */

import { parseYaml } from './lib/yaml.mjs';
import { evaluateAdmission } from './lib/admission.mjs';
import { evaluateAiReview } from './lib/ai-review.mjs';
import { collectAiReviewSnapshot, githubClient } from './lib/ai-review-collect.mjs';

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

async function main() {
  const pr = await api(`/repos/${repo}/pulls/${prNumber}`);

  const [active, ret] = await Promise.all([
    readControlFile(pr.head.sha, '.agent-control/active-packet.yaml'),
    readControlFile(pr.head.sha, '.agent-control/claude-return.yaml'),
  ]);

  if (!active || !ret) {
    return { eligible: false, reason: 'control_artifacts_missing', pr: prNumber, head_sha: pr.head.sha };
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

  // The AI review verdict is computed HERE, by this trusted checkout of main,
  // pinned to the head just read. (KF-AI-PR-REVIEW-GATE-001)
  const ai_review = evaluateAiReview(
    await collectAiReviewSnapshot({ client: githubClient(token), repo, prNumber, expectedHead: pr.head.sha }),
  );

  const verdict = evaluateAdmission({
    ai_review,
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
    contradictions: Array.isArray(ret.unresolved_contradictions)
      ? ret.unresolved_contradictions.map((c) => (typeof c === 'string' ? c : c.id)).filter(Boolean)
      : [],
  });

  const result = { ...verdict, pr: prNumber, head_sha: pr.head.sha };

  if (verdict.eligible && wantMerge) {
    // Merging by the exact head sha: if the head moved, GitHub rejects rather
    // than merging a tree that was never admitted.
    result.merge = await api(`/repos/${repo}/pulls/${prNumber}/merge`, {
      method: 'PUT',
      body: JSON.stringify({ sha: pr.head.sha, merge_method: 'squash', commit_title: pr.title }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

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
