#!/usr/bin/env node
/**
 * Audit, and on request reconcile, the AUTO_MERGE records on the control room.
 *
 * Without --reconcile it only reads. It lists every closed pull request, takes
 * the merged implementation PRs, asks who merged each, and checks that every
 * one the workflow token merged has its exact record (lib/merge-record-audit.mjs).
 *
 * With --reconcile it posts the record for each merge that has none, through
 * the same recordMerge the merging jobs use, then audits again. It never
 * merges, never edits or deletes a comment, and cannot resolve a conflict.
 *
 * Exit codes: 0 every autopilot merge has its record,
 *             5 at least one record is missing (after reconciling, if asked),
 *             4 a trusted comment contradicts a record,
 *             2 error -- the audit is NOT complete.
 * stdout carries one JSON object. Nothing is posted unless the whole read
 * succeeded first.
 */

import { CONTROL_ISSUE } from './lib/events.mjs';
import { recordMerge, MergeRecordConflict } from './lib/merge-record.mjs';
import { auditMergeRecords, mergeResultOf } from './lib/merge-record-audit.mjs';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const apiBase = process.env.KF_GITHUB_API_URL || 'https://api.github.com';
const reconcile = process.argv.includes('--reconcile');
const PER_PAGE = 100;
const MAX_PAGES = 100;

function fail(message) {
  process.stdout.write(JSON.stringify({ outcome: 'error', error: message }) + '\n');
  process.stderr.write(`AUTO_MERGE audit failed: ${message}\n`);
  process.exit(2);
}

if (!token || !repo) fail('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
// The override exists for the proofs, which stand a local server in for the
// API. The token is never sent to any other host.
if (apiBase !== 'https://api.github.com' && !/^http:\/\/127\.0\.0\.1:\d+$/.test(apiBase)) {
  fail('KF_GITHUB_API_URL may only point at a loopback test server');
}

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

/** Every page, or an error: a short read would hide a merge or a record. */
async function listAll(path, what) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=${PER_PAGE}&page=${page}`);
    if (!Array.isArray(batch)) throw new Error(`page ${page} of ${what} is not a list`);
    items.push(...batch);
    if (batch.length < PER_PAGE) return items;
  }
  throw new Error(`${what} did not end within ${MAX_PAGES} pages`);
}

const listComments = () => listAll(`/repos/${repo}/issues/${CONTROL_ISSUE}/comments`, 'the control-room comments');
const createComment = (body) =>
  api(`/repos/${repo}/issues/${CONTROL_ISSUE}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
    headers: { 'Content-Type': 'application/json' },
  });

async function main() {
  const closed = await listAll(`/repos/${repo}/pulls?state=closed&sort=created&direction=desc`, 'the closed pull requests');
  // The list does not say who merged; only the single-PR read does. Asked
  // only for merged impl/ PRs: the evaluator can merge nothing else.
  const candidates = closed.filter((pr) => pr.merged_at && String(pr?.head?.ref || '').startsWith('impl/'));
  const merged = [];
  for (const pr of candidates) merged.push(await api(`/repos/${repo}/pulls/${pr.number}`));

  let audit = auditMergeRecords(merged, await listComments());
  const posted = [];
  const post_errors = [];
  if (reconcile && audit.missing.length) {
    for (const number of audit.missing) {
      const pr = merged.find((p) => p.number === number);
      try {
        const r = await recordMerge(mergeResultOf(pr), { listComments, createComment });
        posted.push({ pr: number, outcome: r.outcome, comment_id: r.comment_id });
      } catch (error) {
        if (!(error instanceof MergeRecordConflict)) post_errors.push({ pr: number, error: error.message });
      }
    }
    audit = auditMergeRecords(merged, await listComments());
  }
  return { outcome: audit.clean ? 'clean' : audit.conflicts.length ? 'conflict' : 'missing', closed_read: closed.length, merged_impl: candidates.length, reconcile, posted, post_errors, ...audit };
}

main()
  .then((report) => {
    process.stdout.write(JSON.stringify(report) + '\n');
    for (const e of report.entries.filter((x) => x.state !== 'recorded')) {
      const why = e.state === 'conflict' ? `conflicting comment(s) ${e.conflicts.map((c) => `${c.comment_id} (${c.problems.join(', ')})`).join('; ')}` : 'no AUTO_MERGE record';
      process.stderr.write(`::error::PR #${e.pr}, merged by the autopilot as ${e.merge_sha}: ${why}\n`);
    }
    for (const e of report.entries.filter((x) => x.duplicates.length)) {
      process.stderr.write(`::warning::PR #${e.pr} has ${e.duplicates.length + 1} identical AUTO_MERGE records\n`);
    }
    process.stderr.write(`audited ${report.audited} autopilot merge(s) among ${report.merged_impl} merged implementation PR(s): ${report.recorded} recorded, ${report.missing.length} missing, ${report.conflicts.length} in conflict${report.posted.length ? `; posted ${report.posted.length} missing record(s)` : ''}\n`);
    if (report.post_errors.length) {
      // The report above is already on stdout; this only sets the status.
      process.stderr.write(`AUTO_MERGE audit failed: could not post ${report.post_errors.length} missing record(s): ${report.post_errors.map((p) => `#${p.pr} ${p.error}`).join('; ')}\n`);
      process.exit(2);
    }
    process.exit(report.clean ? 0 : report.conflicts.length ? 4 : 5);
  })
  .catch((error) => fail(error.message));
