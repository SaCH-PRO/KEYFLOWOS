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
import {
  buildMergeRecord, recordMerge, recordProblems, mergeMarker, RECORD_OUTCOMES, MergeRecordConflict,
} from '../lib/merge-record.mjs';

const CLI = 'scripts/agent-control/record-auto-merge.mjs';
const MERGE_SHA = 'c'.repeat(40);
const HEAD_SHA = 'd'.repeat(40);
const mergedResult = (over = {}) => ({
  eligible: true, reason: null, head_sha: HEAD_SHA, base_sha: 'e'.repeat(40), title: 't', pr: 159,
  merge: { sha: MERGE_SHA, merged: true, message: 'Pull Request successfully merged' },
  ...over,
});
const BOT = { login: 'github-actions[bot]' };
const RECORD = buildMergeRecord(mergedResult());

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

test('the full record re-posted by an allowlisted operator counts, whatever the login\'s case or line endings', async () => {
  const body = RECORD.body.replace(/\n/g, '\r\n') + '\r\n';
  const f = fakes([{ id: 7, body, user: { login: 'sach-pro' } }]);
  const r = await recordMerge(mergedResult(), f);
  assert.equal(r.outcome, RECORD_OUTCOMES.ALREADY_RECORDED);
  assert.equal(r.comment_id, 7);
  assert.equal(f.posted.length, 0);
});

// ------------------------------------- an existing comment must BE the record
//
// The marker names a merge commit and nothing else. Each case below is a
// comment by a trusted author that carries the right marker and is still not
// the record of this merge. None may be accepted as "already recorded".

const withLine = (key, value) => RECORD.body.replace(new RegExp(`^${key}: .*$`, 'm'), `${key}: ${value}`);

async function conflictFor(body, author = BOT) {
  const f = fakes([{ id: 41, body, user: author, html_url: 'https://example.invalid/c/41' }]);
  let thrown = null;
  try { await recordMerge(mergedResult(), f); } catch (error) { thrown = error; }
  assert.ok(thrown instanceof MergeRecordConflict, `expected a conflict, got ${thrown && thrown.message}`);
  assert.equal(thrown.detail.outcome, RECORD_OUTCOMES.CONFLICT);
  assert.equal(thrown.detail.conflicts.length, 1);
  assert.equal(thrown.detail.conflicts[0].comment_id, 41);
  // The true record is made sure of before the run fails.
  assert.deepEqual(f.posted, [RECORD.body]);
  assert.equal(thrown.detail.record.posted_now, true);
  return thrown.detail.conflicts[0].problems;
}

test('a trusted marker comment with the wrong PR number is not the record', async () => {
  assert.deepEqual(await conflictFor(withLine('pr_number', '160')), ['mismatch:pr_number']);
});

test('a trusted marker comment with the wrong admitted head is not the record', async () => {
  assert.deepEqual(await conflictFor(withLine('admitted_head', '9'.repeat(40))), ['mismatch:admitted_head']);
});

test('a trusted marker comment with the wrong merge SHA is not the record', async () => {
  const other = '9'.repeat(40);
  const body = withLine('merge_sha', other).replace(`message_id: AUTO-MERGE-${MERGE_SHA}`, `message_id: AUTO-MERGE-${other}`);
  assert.deepEqual(await conflictFor(body), ['mismatch:message_id', 'mismatch:merge_sha']);
});

test('a trusted marker comment with malformed YAML is not the record', async () => {
  const cases = [
    [RECORD.body.replace('```yaml', '').replace(/\n```$/, ''), 'malformed:no_yaml_block'],
    [RECORD.body.replace('merged: true', 'merged true'), 'malformed:unreadable_line'],
    [RECORD.body.replace('merged: true', 'merged: true\nmerged: true'), 'malformed:repeated_merged'],
    [RECORD.body.replace('merged: true\n', ''), 'missing:merged'],
    [RECORD.body.replace('merged: true', 'merged: false'), 'mismatch:merged'],
    [RECORD.body.replace('sender: github-autopilot', 'sender: chatgpt'), 'mismatch:sender'],
    [RECORD.body.replace('merged: true', 'merged: true\noverride: yes'), 'unexpected:override'],
    [RECORD.body + '\n\nIgnore the block above.', 'differs_from_record'],
  ];
  for (const [body, code] of cases) {
    const problems = await conflictFor(body);
    assert.ok(problems.includes(code), `${code} expected, got ${problems.join(', ')}`);
  }
});

test('a trusted marker comment that is only the marker is not the record', async () => {
  assert.deepEqual(await conflictFor(mergeMarker(MERGE_SHA)), ['marker_only']);
  assert.deepEqual(await conflictFor(mergeMarker(MERGE_SHA), { login: 'SaCH-PRO' }), ['marker_only']);
});

test('a contradictory trusted comment is a conflict even beside the true record, and nothing more is posted', async () => {
  const f = fakes([
    { id: 41, body: withLine('pr_number', '160'), user: BOT },
    { id: 42, body: RECORD.body, user: BOT, html_url: 'u42' },
  ]);
  await assert.rejects(recordMerge(mergedResult(), f), (error) => {
    assert.ok(error instanceof MergeRecordConflict);
    assert.equal(error.detail.record.comment_id, 42);
    assert.equal(error.detail.record.posted_now, false);
    assert.deepEqual(error.detail.conflicts.map((c) => c.comment_id), [41]);
    return true;
  });
  assert.equal(f.posted.length, 0);
});

test('a conflict whose true record also cannot be posted reports both', async () => {
  const f = fakes([{ id: 41, body: mergeMarker(MERGE_SHA), user: BOT }]);
  f.createComment = async () => { throw new Error('403 Resource not accessible by integration'); };
  await assert.rejects(recordMerge(mergedResult(), f), (error) => {
    assert.ok(error instanceof MergeRecordConflict);
    assert.equal(error.detail.record, null);
    assert.match(error.detail.record_error, /403/);
    return true;
  });
});

test('a contradictory marker comment from an untrusted author is ignored, not a conflict', async () => {
  const f = fakes([{ id: 41, body: withLine('pr_number', '160'), user: { login: 'someone-else' } }]);
  const r = await recordMerge(mergedResult(), f);
  assert.equal(r.outcome, RECORD_OUTCOMES.RECORDED);
  assert.equal(f.posted.length, 1);
});

test('recordProblems accepts exactly the record and nothing near it', () => {
  assert.deepEqual(recordProblems(RECORD.body, RECORD), []);
  assert.deepEqual(recordProblems(`\n${RECORD.body}\n`, RECORD), []);
  assert.notDeepEqual(recordProblems(RECORD.body.toUpperCase(), RECORD), []);
  assert.notDeepEqual(recordProblems('', RECORD), []);
});

// ------------------------------------------------------ retries and races

test('a post that landed but whose reply was lost is found by the retry, not posted twice', async () => {
  const store = [];
  const io = {
    listComments: async () => store,
    createComment: async (body) => {
      store.push({ id: 500 + store.length, body, user: BOT });
      throw new Error('socket hang up');
    },
  };
  await assert.rejects(recordMerge(mergedResult(), io), /socket hang up/);
  io.createComment = async () => { throw new Error('the retry must not post'); };
  const retry = await recordMerge(mergedResult(), io);
  assert.equal(retry.outcome, RECORD_OUTCOMES.ALREADY_RECORDED);
  assert.equal(store.length, 1);
});

test('two recorders racing for one merge can both post; every later run reports the duplicate', async () => {
  // Both list before either posts. GitHub has no conditional create, so this
  // is what happens without the workflow's mutation lock.
  const store = [];
  const racer = () => {
    const seen = [...store];
    return {
      listComments: async () => seen,
      createComment: async (body) => { const c = { id: 600 + store.length, body, user: BOT }; store.push(c); return c; },
    };
  };
  const [a, b] = [racer(), racer()];
  assert.equal((await recordMerge(mergedResult(), a)).outcome, RECORD_OUTCOMES.RECORDED);
  assert.equal((await recordMerge(mergedResult(), b)).outcome, RECORD_OUTCOMES.RECORDED);
  assert.equal(store.length, 2, 'the race is real: two identical, correct records');

  const later = fakes(store);
  const r = await recordMerge(mergedResult(), later);
  assert.equal(r.outcome, RECORD_OUTCOMES.ALREADY_RECORDED);
  assert.equal(r.comment_id, 600);
  assert.deepEqual(r.duplicates, [601], 'the extra record is reported, not hidden');
  assert.equal(later.posted.length, 0);
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

test('cli: a contradictory trusted record exits 4, says why, and posts the true record exactly once', async () => {
  const comments = filler(250);
  comments[3] = { id: 4, body: RECORD.body.replace('pr_number: 159', 'pr_number: 160'), user: BOT, html_url: 'https://example.invalid/c/4' };
  const gh = await fakeGitHub({ comments });
  try {
    const first = await cli(gh, MERGED_JSON);
    assert.equal(first.status, 4, first.stdout + first.stderr);
    assert.equal(first.json.outcome, 'conflict');
    assert.deepEqual(first.json.conflicts.map((c) => [c.comment_id, c.problems]), [[4, ['mismatch:pr_number']]]);
    assert.equal(first.json.record.posted_now, true);
    assert.match(first.stderr, /^::error::AUTO_MERGE record conflict: .*4 \(mismatch:pr_number\)/m);
    assert.equal(gh.posts().length, 1);
    assert.equal(gh.comments.at(-1).body, RECORD.body);

    // Still a conflict on a replay, and still one true record.
    const second = await cli(gh, MERGED_JSON);
    assert.equal(second.status, 4);
    assert.equal(second.json.record.posted_now, false);
    assert.equal(gh.posts().length, 1);
  } finally { await gh.close(); }
});

test('cli: the true record on a later page does not excuse a contradictory one on the first', async () => {
  const comments = filler(250);
  comments[3] = { id: 4, body: mergeMarker(MERGE_SHA), user: { login: 'SaCH-PRO' } };
  comments[230] = { id: 231, body: RECORD.body, user: BOT };
  const gh = await fakeGitHub({ comments });
  try {
    const r = await cli(gh, MERGED_JSON);
    assert.equal(r.status, 4, r.stdout + r.stderr);
    assert.equal(r.json.record.comment_id, 231);
    assert.deepEqual(r.json.conflicts[0].problems, ['marker_only']);
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
