#!/usr/bin/env node
/**
 * AI Review Request — asks Codex to re-review a semantic push.
 *
 * Codex reviews natively on "open for review" and "draft -> ready" only; a
 * push is never re-reviewed. Copilot is re-requested on every push by the
 * repository ruleset and needs nothing here. This posts at most one
 * "@codex review" per head, only for a non-draft PR, and only when the push
 * changed something outside .agent-control/** (lib/ai-review.mjs decides).
 *
 * The request carries no authority: the AI Review Gate never counts a comment
 * by this workflow as review evidence.
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, EVENT_ACTION, BEFORE_SHA,
 *      AFTER_SHA, PR_DRAFT. Flag: --dry-run (decide and print, never post).
 */

import { decideReviewRequest, requestMarker, REQUEST_MARKER } from './lib/ai-review.mjs';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const prNumber = Number(process.env.PR_NUMBER || 0);
const dryRun = process.argv.includes('--dry-run');

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
    const error = new Error(`${res.status} ${res.statusText} ${path} ${await res.text()}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

async function treeOf(sha) {
  try {
    return (await api(`/repos/${repo}/git/commits/${sha}`)).tree.sha;
  } catch (error) {
    if (error.status === 404 || error.status === 422) return null;
    throw error;
  }
}

async function existingMarkers() {
  const heads = [];
  const pattern = new RegExp(`<!-- ${REQUEST_MARKER} head=([0-9a-f]{40}) -->`);
  for (let page = 1; page <= 30; page += 1) {
    const batch = await api(`/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`);
    for (const c of batch) {
      if (c.user?.login !== 'github-actions[bot]') continue;
      const m = String(c.body || '').match(pattern);
      if (m) heads.push(m[1]);
    }
    if (batch.length < 100) break;
  }
  return heads;
}

async function main() {
  const before = (process.env.BEFORE_SHA || '').trim();
  const after = (process.env.AFTER_SHA || '').trim();
  const input = {
    action: process.env.EVENT_ACTION,
    draft: process.env.PR_DRAFT === 'true',
    before,
    after,
    trees_equal: null,
    compare: null,
    existing_markers: await existingMarkers(),
  };
  if (/^[0-9a-f]{40}$/.test(before) && /^[0-9a-f]{40}$/.test(after)) {
    const [a, b] = await Promise.all([treeOf(before), treeOf(after)]);
    input.trees_equal = Boolean(a && b && a === b);
    try {
      const cmp = await api(`/repos/${repo}/compare/${before}...${after}`);
      const files = (cmp.files || []).map((f) => f.filename);
      input.compare = { status: cmp.status, files: files.length >= 300 ? [...files, '<compare file list truncated>'] : files };
    } catch (error) {
      if (error.status !== 404 && error.status !== 422) throw error;
    }
  }

  const decision = decideReviewRequest(input);
  if (decision.request && !dryRun) {
    const body = `${requestMarker(after)}\n@codex review\n\nAutomated exact-head re-review request for \`${after}\` (semantic push; ${decision.reason}). This comment is a trigger only and is never counted as review evidence.`;
    const posted = await api(`/repos/${repo}/issues/${prNumber}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    decision.comment_id = posted.id;
  }
  return { ...decision, pr: prNumber, head_sha: after || null, dry_run: dryRun };
}

main()
  .then((result) => {
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  })
  .catch((error) => {
    process.stdout.write(JSON.stringify({ request: false, reason: 'request_error', error: error.message, pr: prNumber }));
    process.stderr.write(`ai review request failed: ${error.stack || error.message}\n`);
    process.exit(2);
  });
