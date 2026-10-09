/**
 * AUTO_MERGE record proofs.
 *
 * The record is the control room's only durable note that the autopilot
 * merged something, and nothing else in the control plane depends on it, so a
 * missing one is invisible unless the recorder itself fails loudly. These
 * proofs cover the record's content, its idempotency, and every way the
 * recorder can be unable to confirm it.
 *
 * The CLI proofs run the real record-auto-merge.mjs with its real fetch calls
 * against a local HTTP server standing in for the GitHub API. What is asserted
 * is what the server received and stored, and the exit status a workflow step
 * would act on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { buildMergeRecord, recordMerge, mergeMarker, RECORD_OUTCOMES } from '../lib/merge-record.mjs';

const CLI = 'scripts/agent-control/record-auto-merge.mjs';
const MERGE_SHA = 'c'.repeat(40);
const HEAD_SHA = 'd'.repeat(40);
const mergedResult = (over = {}) => ({
  eligible: true, reason: null, head_sha: HEAD_SHA, base_sha: 'e'.repeat(40), title: 't', pr: 159,
  merge: { sha: MERGE_SHA, merged: true, message: 'Pull Request successfully merged' },
  ...over,
});
const BOT = { login: 'github-actions[bot]' };

// ------------------------------------------------------------------ content

test('the record is byte-for-byte what the event-driven job has always posted', () => {
  // Copied from the inline github-script step this module replaced. A reader
  // of issue 80 must not be able to tell which job recorded a merge.
  const expected = [
    `<!-- keyflow-autopilot-merge:${MERGE_SHA} -->`,
    '```yaml',
    `message_id: AUTO-MERGE-${MERGE_SHA}`,
    'message_type: AUTO_MERGE',
    'sender: github-autopilot',
    'pr_number: 159',
    `admitted_head: ${HEAD_SHA}`,
    'merged: true',
    `merge_sha: ${MERGE_SHA}`,
    'next_action: post_merge_verify_and_checkpoint',
    '```',
  ].join('\n');
  assert.equal(buildMergeRecord(mergedResult()).body, expected);
});

test('a result that merged nothing has no record', () => {
  assert.equal(buildMergeRecord({ eligible: false, reason: 'pr_is_draft', pr: 162 }), null);
  assert.equal(buildMergeRecord({ eligible: true, pr: 159, head_sha: HEAD_SHA }), null, 'eligible without --merge');
  assert.equal(buildMergeRecord(mergedResult({ merge: { merged: false, sha: MERGE_SHA } })), null);
  assert.equal(buildMergeRecord(null), null);
});

test('a result that reports a merge it cannot identify is an error, never a blank record', () => {
  assert.throws(() => buildMergeRecord(mergedResult({ merge: { merged: true } })), /merge\.sha/);
  assert.throws(() => buildMergeRecord(mergedResult({ merge: { merged: true, sha: 'abc' } })), /merge\.sha/);
  assert.throws(() => buildMergeRecord(mergedResult({ head_sha: undefined })), /head_sha/);
  assert.throws(() => buildMergeRecord(mergedResult({ pr: undefined })), /\bpr\b/);
});

// -------------------------------------------------------------- idempotency

function fakes(existing = []) {
  const posted = [];
  return {
    posted,
    listComments: async () => existing,
    createComment: async (body) => {
      posted.push(body);
      return { id: 9001, body, html_url: 'https://example.invalid/c/9001' };
    },
  };
}

test('a merge is recorded once; a replay finds the record and posts nothing', async () => {
  const first = fakes();
  const a = await recordMerge(mergedResult(), first);
  assert.equal(a.outcome, RECORD_OUTCOMES.RECORDED);
  assert.equal(a.comment_id, 9001);
  assert.equal(first.posted.length, 1);

  const second = fakes([{ id: 9001, body: first.posted[0], user: BOT, html_url: 'u' }]);
  const b = await recordMerge(mergedResult(), second);
  assert.equal(b.outcome, RECORD_OUTCOMES.ALREADY_RECORDED);
  assert.equal(b.comment_id, 9001);
  assert.equal(second.posted.length, 0);
});

test('a marker pasted by an untrusted author does not suppress the record', async () => {
  const f = fakes([{ id: 1, body: `nice ${mergeMarker(MERGE_SHA)}`, user: { login: 'someone-else' } }]);
  const r = await recordMerge(mergedResult(), f);
  assert.equal(r.outcome, RECORD_OUTCOMES.RECORDED);
  assert.equal(f.posted.length, 1);
});

test('a record re-posted by an allowlisted operator counts, whatever the login\'s case', async () => {
  const f = fakes([{ id: 7, body: mergeMarker(MERGE_SHA), user: { login: 'sach-pro' } }]);
  assert.equal((await recordMerge(mergedResult(), f)).outcome, RECORD_OUTCOMES.ALREADY_RECORDED);
  assert.equal(f.posted.length, 0);
});

test('the record of one merge does not stand in for another', async () => {
  const f = fakes([{ id: 7, body: mergeMarker('f'.repeat(40)), user: BOT }]);
  assert.equal((await recordMerge(mergedResult(), f)).outcome, RECORD_OUTCOMES.RECORDED);
});

// ----------------------------------------------------------------- failures

test('an unreadable control room is an error, and nothing is posted blind', async () => {
  const f = fakes();
  f.listComments = async () => { throw new Error('502 Bad Gateway'); };
  await assert.rejects(recordMerge(mergedResult(), f), /502 Bad Gateway/);
  assert.equal(f.posted.length, 0);

  const g = fakes();
  g.listComments = async () => ({ message: 'rate limited' });
  await assert.rejects(recordMerge(mergedResult(), g), /could not be read as a list/);
  assert.equal(g.posted.length, 0);
});

test('a post that is refused, or not confirmed, is an error and never "recorded"', async () => {
  const refused = fakes();
  refused.createComment = async () => { throw new Error('403 Resource not accessible by integration'); };
  await assert.rejects(recordMerge(mergedResult(), refused), /403/);

  for (const reply of [null, {}, { id: 5 }, { id: 5, body: 'something else' }, { body: mergeMarker(MERGE_SHA) }]) {
    const f = fakes();
    f.createComment = async () => reply;
    await assert.rejects(recordMerge(mergedResult(), f), /did not confirm/, JSON.stringify(reply));
  }
});

// ------------------------------------------------- the CLI, over real HTTP

/** A stand-in for the two GitHub endpoints the recorder uses. */
async function fakeGitHub({ comments = [], failListPage = null, createStatus = 201, echo = true } = {}) {
  const state = { comments: [...comments], requests: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      state.requests.push({ method: req.method, path: url.pathname, page: url.searchParams.get('page'), auth: req.headers.authorization });
      const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (url.pathname !== '/repos/o/r/issues/80/comments') return send(404, { message: 'Not Found' });
      if (req.method === 'GET') {
        const page = Number(url.searchParams.get('page'));
        if (failListPage === page) return send(502, { message: 'Bad Gateway' });
        return send(200, state.comments.slice((page - 1) * 100, page * 100));
      }
      if (createStatus !== 201) return send(createStatus, { message: 'Resource not accessible by integration' });
      const stored = { id: 7000 + state.comments.length, body: echo ? JSON.parse(raw).body : 'stored something else', user: BOT, html_url: 'https://example.invalid/c' };
      state.comments.push(stored);
      return send(201, stored);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.close = () => new Promise((resolve) => server.close(resolve));
  state.posts = () => state.requests.filter((r) => r.method === 'POST');
  return state;
}

function cli(github, mergeJson, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI], {
      env: { ...process.env, GITHUB_TOKEN: 'test-token', GITHUB_REPOSITORY: 'o/r', KF_GITHUB_API_URL: github.url, MERGE_JSON: mergeJson, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => {
      let json = null;
      try { json = JSON.parse(stdout); } catch { /* asserted by the caller */ }
      resolve({ status, stdout, stderr, json });
    });
  });
}

const MERGED_JSON = JSON.stringify(mergedResult());
const filler = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, body: `comment ${i + 1}`, user: { login: 'SaCH-PRO' } }));

test('cli: a merge is posted once, authenticated, and a second run adds nothing', async () => {
  const gh = await fakeGitHub();
  try {
    const first = await cli(gh, MERGED_JSON);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.json.outcome, 'recorded');
    assert.equal(first.json.merge_sha, MERGE_SHA);
    assert.equal(gh.comments.length, 1);
    assert.equal(gh.comments[0].body, buildMergeRecord(mergedResult()).body, 'what was stored is the record');
    assert.equal(gh.posts()[0].auth, 'Bearer test-token');

    const second = await cli(gh, MERGED_JSON);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.json.outcome, 'already_recorded');
    assert.equal(gh.comments.length, 1, 'idempotent on the merge commit');
    assert.equal(gh.posts().length, 1);
  } finally { await gh.close(); }
});

test('cli: an existing record beyond the first page of comments is found, not duplicated', async () => {
  const comments = filler(250);
  comments[230] = { id: 231, body: buildMergeRecord(mergedResult()).body, user: BOT };
  const gh = await fakeGitHub({ comments });
  try {
    const r = await cli(gh, MERGED_JSON);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.outcome, 'already_recorded');
    assert.equal(r.json.comment_id, 231);
    assert.deepEqual(gh.requests.filter((q) => q.method === 'GET').map((q) => q.page), ['1', '2', '3']);
    assert.equal(gh.posts().length, 0);
  } finally { await gh.close(); }
});

test('cli: a control room it cannot read completely fails with status 2 and posts nothing', async () => {
  const gh = await fakeGitHub({ comments: filler(150), failListPage: 2 });
  try {
    const r = await cli(gh, MERGED_JSON);
    assert.equal(r.status, 2);
    assert.equal(r.json.outcome, 'error');
    assert.match(r.stderr, /AUTO_MERGE record failed: 502/);
    assert.equal(gh.posts().length, 0, 'never post without knowing whether the record exists');
  } finally { await gh.close(); }
});

test('cli: a refused post fails with status 2 and reports no record', async () => {
  const gh = await fakeGitHub({ createStatus: 403 });
  try {
    const r = await cli(gh, MERGED_JSON);
    assert.equal(r.status, 2);
    assert.equal(r.json.outcome, 'error');
    assert.match(r.stderr, /403/);
    assert.equal(gh.comments.length, 0);
    assert.doesNotMatch(r.stdout, /"recorded"/);
  } finally { await gh.close(); }
});

test('cli: a 201 that stored something other than the record fails with status 2', async () => {
  const gh = await fakeGitHub({ echo: false });
  try {
    const r = await cli(gh, MERGED_JSON);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /did not confirm/);
  } finally { await gh.close(); }
});

test('cli: a result that merged nothing exits 3 without touching the control room', async () => {
  const gh = await fakeGitHub();
  try {
    const r = await cli(gh, JSON.stringify({ eligible: false, reason: 'pr_is_draft', pr: 162 }));
    assert.equal(r.status, 3);
    assert.equal(r.json.outcome, 'not_merged');
    assert.equal(gh.requests.length, 0);
  } finally { await gh.close(); }
});

test('cli: input that is not a usable evaluator result fails with status 2 and sends nothing', async () => {
  const gh = await fakeGitHub();
  try {
    const cases = ['', 'Windows PowerShell', '[]', 'null', JSON.stringify(mergedResult({ merge: { merged: true } }))];
    for (const input of cases) {
      const r = await cli(gh, input);
      assert.equal(r.status, 2, `input ${JSON.stringify(input)}: ${r.stdout}`);
      assert.equal(r.json.outcome, 'error');
    }
    const noToken = await cli(gh, MERGED_JSON, { GITHUB_TOKEN: '' });
    assert.equal(noToken.status, 2);
    // The API override is a test seam; it must not carry the token off-host.
    const elsewhere = await cli(gh, MERGED_JSON, { KF_GITHUB_API_URL: 'https://example.invalid' });
    assert.equal(elsewhere.status, 2);
    assert.match(elsewhere.stderr, /loopback/);
    assert.equal(gh.posts().length, 0);
  } finally { await gh.close(); }
});
