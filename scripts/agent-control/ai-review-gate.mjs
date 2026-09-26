#!/usr/bin/env node
/**
 * AI Review Gate — collects exact-head review evidence for one PR and prints
 * the verdict of lib/ai-review.mjs. Read-only: it never writes to GitHub.
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, optional EXPECTED_HEAD_SHA.
 * Flags: --ledger <file>  also write the markdown ledger for this head.
 *
 * Exit codes: 0 admissible, 3 not admissible, 2 evaluator error. An error is
 * never a pass: the caller's check fails either way.
 */

import fs from 'node:fs';
import { evaluateAiReview, requiredComparisons, renderLedger } from './lib/ai-review.mjs';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const prNumber = Number(process.env.PR_NUMBER || 0);
const expectedHead = (process.env.EXPECTED_HEAD_SHA || '').trim() || null;
const ledgerIdx = process.argv.indexOf('--ledger');
const ledgerPath = ledgerIdx > -1 ? process.argv[ledgerIdx + 1] : null;

if (!token || !repo || !prNumber) {
  process.stderr.write('GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER are required\n');
  process.exit(2);
}
const [owner, name] = repo.split('/');

async function request(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const error = new Error(`${res.status} ${res.statusText} ${url} ${await res.text()}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

const rest = (path) => request('https://api.github.com' + path);

async function graphql(query, variables) {
  const body = await request('https://api.github.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (body.errors?.length) throw new Error('graphql: ' + JSON.stringify(body.errors));
  return body.data;
}

const AUTHOR = '__typename login ... on Bot { id } ... on User { id }';
const QUERY = `
query($owner: String!, $name: String!, $number: Int!, $reviewsAfter: String, $threadsAfter: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state isDraft headRefOid baseRefOid
      reviews(first: 100, after: $reviewsAfter) {
        pageInfo { hasNextPage endCursor }
        nodes { databaseId state submittedAt body commit { oid } author { ${AUTHOR} } }
      }
      reviewThreads(first: 100, after: $threadsAfter) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line originalLine
          comments(first: 100) {
            pageInfo { hasNextPage }
            nodes { databaseId body createdAt commit { oid } originalCommit { oid } author { ${AUTHOR} } }
          }
        }
      }
    }
  }
}`;

const toAuthor = (a) => (a ? { login: a.login, type: a.__typename, id: a.id ?? null } : null);

async function collect() {
  let reviewsAfter = null;
  let threadsAfter = null;
  let pr = null;
  const reviews = [];
  const threads = [];
  let truncated = false;
  // Page both connections until exhausted; bounded so a runaway cursor fails closed.
  for (let page = 0; page < 20; page += 1) {
    const data = await graphql(QUERY, { owner, name, number: prNumber, reviewsAfter, threadsAfter });
    const p = data.repository.pullRequest;
    pr = pr || p;
    if (page === 0 || reviewsAfter) {
      for (const r of p.reviews.nodes) {
        reviews.push({
          id: r.databaseId,
          author: toAuthor(r.author),
          state: r.state,
          commit_sha: r.commit?.oid ?? null,
          submitted_at: r.submittedAt,
          body: r.body,
        });
      }
    }
    if (page === 0 || threadsAfter) {
      for (const t of p.reviewThreads.nodes) {
        if (t.comments.pageInfo.hasNextPage) truncated = true;
        threads.push({
          id: t.id,
          is_resolved: t.isResolved,
          is_outdated: t.isOutdated,
          path: t.path,
          line: t.line ?? t.originalLine ?? null,
          comments: t.comments.nodes.map((c) => ({
            id: c.databaseId,
            author: toAuthor(c.author),
            body: c.body,
            commit_sha: c.commit?.oid ?? null,
            original_commit_sha: c.originalCommit?.oid ?? null,
            created_at: c.createdAt,
          })),
        });
      }
    }
    // A finished connection stays finished: re-querying it with a null cursor
    // returns its first page again, which must not restart its cursor.
    if (page === 0 || reviewsAfter) {
      reviewsAfter = p.reviews.pageInfo.hasNextPage ? p.reviews.pageInfo.endCursor : null;
    }
    if (page === 0 || threadsAfter) {
      threadsAfter = p.reviewThreads.pageInfo.hasNextPage ? p.reviewThreads.pageInfo.endCursor : null;
    }
    if (!reviewsAfter && !threadsAfter) break;
    if (page === 19) truncated = true;
  }

  // Changed files for high-risk classification (GitHub caps this listing at 3000).
  const files = [];
  let filesTruncated = false;
  for (let page = 1; page <= 30; page += 1) {
    const batch = await rest(`/repos/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`);
    files.push(...batch.map((f) => ({ filename: f.filename, patch: f.patch ?? null })));
    if (batch.length < 100) break;
    if (page === 30) filesTruncated = true;
  }

  return {
    pr: {
      number: prNumber,
      state: String(pr.state).toLowerCase(),
      draft: pr.isDraft,
      head_sha: pr.headRefOid,
      base_sha: pr.baseRefOid,
    },
    expected_head_sha: expectedHead,
    reviews,
    threads,
    files,
    files_truncated: filesTruncated,
    evidence_truncated: truncated,
  };
}

async function compareAll(snapshot) {
  const comparisons = {};
  for (const { from, to } of requiredComparisons(snapshot)) {
    try {
      const cmp = await rest(`/repos/${repo}/compare/${from}...${to}`);
      // The compare file list caps at 300; a longer list cannot prove control-only.
      const files = (cmp.files || []).map((f) => f.filename);
      comparisons[`${from}...${to}`] = {
        status: cmp.status,
        files: (cmp.files || []).length >= 300 ? [...files, '<compare file list truncated>'] : files,
      };
    } catch (error) {
      // Unknown commit (force-pushed away, typo): leave it unproven, which fails closed.
      if (error.status !== 404 && error.status !== 422) throw error;
    }
  }
  return comparisons;
}

async function main() {
  const snapshot = await collect();
  snapshot.comparisons = await compareAll(snapshot);
  const verdict = evaluateAiReview(snapshot);
  if (ledgerPath) {
    const runUrl = process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;
    fs.writeFileSync(ledgerPath, renderLedger(verdict, { prNumber, runUrl }));
  }
  return { ...verdict, pr: prNumber };
}

main()
  .then((verdict) => {
    process.stdout.write(JSON.stringify(verdict));
    process.exit(verdict.admissible ? 0 : 3);
  })
  .catch((error) => {
    process.stdout.write(JSON.stringify({ admissible: false, reason: 'evaluator_error', error: error.message, pr: prNumber }));
    process.stderr.write(`ai review gate failed: ${error.stack || error.message}\n`);
    process.exit(2);
  });
