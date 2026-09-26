#!/usr/bin/env node
/**
 * AI Review Gate — collects exact-head review evidence for one PR and prints
 * the verdict of lib/ai-review.mjs. Read-only: it never writes to GitHub.
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, optional EXPECTED_HEAD_SHA,
 *      optional DELETED_COMMENT (JSON of a deleted review comment event).
 * Flags: --ledger <file>  also write the markdown ledger for this head.
 *
 * Exit codes: 0 admissible, 3 not admissible, 2 evaluator error. An error is
 * never a pass: the caller's check fails either way.
 */

import fs from 'node:fs';
import { evaluateAiReview, renderLedger } from './lib/ai-review.mjs';
import { collectAiReviewSnapshot, githubClient } from './lib/ai-review-collect.mjs';

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

function deletedComment() {
  const raw = (process.env.DELETED_COMMENT || '').trim();
  if (!raw || raw === 'null') return null;
  return JSON.parse(raw);
}

async function main() {
  const snapshot = await collectAiReviewSnapshot({
    client: githubClient(token),
    repo,
    prNumber,
    expectedHead,
    deletedComment: deletedComment(),
  });
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
