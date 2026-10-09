#!/usr/bin/env node
/**
 * Post the durable AUTO_MERGE record for a merge the autopilot just made.
 *
 * Input: MERGE_JSON, the JSON auto-merge-admitted.mjs printed with --merge.
 * It records; it never merges and never evaluates admission.
 *
 * Exit codes: 0 the record exists (posted now, or already there),
 *             3 the result merged nothing, so there is nothing to record,
 *             2 error -- the record is NOT known to exist.
 * stdout carries one JSON object describing which of these happened.
 */

import { CONTROL_ISSUE } from './lib/events.mjs';
import { recordMerge, RECORD_OUTCOMES } from './lib/merge-record.mjs';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const apiBase = process.env.KF_GITHUB_API_URL || 'https://api.github.com';

function fail(message) {
  process.stdout.write(JSON.stringify({ outcome: 'error', error: message }) + '\n');
  process.stderr.write(`AUTO_MERGE record failed: ${message}\n`);
  process.exit(2);
}

if (!token || !repo) fail('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
// The override exists for the proofs, which stand a local server in for the
// API. The token is never sent to any other host.
if (apiBase !== 'https://api.github.com' && !/^http:\/\/127\.0\.0\.1:\d+$/.test(apiBase)) {
  fail('KF_GITHUB_API_URL may only point at a loopback test server');
}

let result;
try {
  result = JSON.parse(process.env.MERGE_JSON || '');
} catch {
  fail('MERGE_JSON is not the evaluator\'s JSON result');
}
if (result === null || typeof result !== 'object' || Array.isArray(result)) fail('MERGE_JSON is not a result object');

async function api(path, init = {}) {
  const res = await fetch(apiBase + path, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${path} ${await res.text()}`);
  return res.json();
}

/** Every page: a truncated list would miss an existing record and post a second. */
async function listComments() {
  const items = [];
  for (let page = 1; ; page += 1) {
    const batch = await api(`/repos/${repo}/issues/${CONTROL_ISSUE}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error(`page ${page} of the control-room comments is not a list`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

const createComment = (body) =>
  api(`/repos/${repo}/issues/${CONTROL_ISSUE}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
    headers: { 'Content-Type': 'application/json' },
  });

recordMerge(result, { listComments, createComment })
  .then((record) => {
    process.stdout.write(JSON.stringify(record) + '\n');
    process.exit(record.outcome === RECORD_OUTCOMES.NOT_MERGED ? 3 : 0);
  })
  .catch((error) => fail(error.message));
