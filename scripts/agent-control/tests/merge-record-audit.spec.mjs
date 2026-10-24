/**
 * AUTO_MERGE audit proofs (lib/merge-record-audit.mjs, audit-merge-records.mjs).
 *
 * The recorder fails loudly when it cannot record a merge, once, in the job
 * that merged. After that nothing looked again. The audit derives what should
 * be recorded from the repository itself -- a merged implementation PR whose
 * merge the workflow token made -- and checks the control room against it.
 *
 * The CLI proofs run the real script with its real fetch calls against a local
 * HTTP server standing in for the GitHub API, and assert what that server
 * received and stored.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { parseYaml } from '../lib/yaml.mjs';
import { MUTATION_LOCK } from '../lib/events.mjs';
import { buildMergeRecord, mergeMarker } from '../lib/merge-record.mjs';
import { auditMergeRecords, mergeResultOf, owesRecord, AUTOPILOT_MERGER } from '../lib/merge-record-audit.mjs';

const CLI = 'scripts/agent-control/audit-merge-records.mjs';
const BOT = { login: AUTOPILOT_MERGER };
const OPERATOR = { login: 'SaCH-PRO' };
const sha = (c) => String(c).repeat(40).slice(0, 40);

/** A merged PR as GET /pulls/{n} returns it. */
function mergedPr(number, { by = BOT, ref = `impl/p${number}`, merged = true } = {}) {
  return {
    number,
    state: 'closed',
    merged,
    merged_at: merged ? '2026-10-11T16:13:07Z' : null,
    merged_by: merged ? by : null,
    merge_commit_sha: merged ? sha(number % 10) + '' : null,
    head: { ref, sha: sha('b') },
  };
}
const recordOf = (pr) => buildMergeRecord(mergeResultOf(pr));
const recordComment = (pr, id, user = BOT) => ({ id, user, body: recordOf(pr).body, html_url: `https://example.invalid/c/${id}` });

// ------------------------------------------------------------ what is owed

test('only a merged implementation PR that the workflow token merged owes a record', () => {
  assert.equal(owesRecord(mergedPr(159)), true);
  assert.equal(owesRecord(mergedPr(166, { by: OPERATOR })), false, 'a person merged it');
  assert.equal(owesRecord(mergedPr(166, { ref: 'fix/x' })), false, 'the evaluator merges only impl/ branches');
  assert.equal(owesRecord(mergedPr(160, { merged: false })), false, 'closed without merging');
  assert.equal(owesRecord({ number: 1, merged: true, head: { ref: 'impl/x' } }), false, 'merger unknown is not assumed to be the bot');
});

test('the record expected for a merged PR is the one the recorder would have posted', () => {
  const pr = mergedPr(159);
  const record = recordOf(pr);
  assert.match(record.body, /^pr_number: 159$/m);
  assert.match(record.body, new RegExp(`^admitted_head: ${pr.head.sha}$`, 'm'));
  assert.match(record.body, new RegExp(`^merge_sha: ${pr.merge_commit_sha}$`, 'm'));
});

// ----------------------------------------------------------- classification

test('a recorded merge is clean; a merge by a person is not audited at all', () => {
  const a = mergedPr(159);
  const report = auditMergeRecords([a, mergedPr(166, { by: OPERATOR })], [recordComment(a, 9)]);
  assert.equal(report.audited, 1);
  assert.equal(report.clean, true);
  assert.deepEqual(report.entries.map((e) => [e.pr, e.state, e.record_comment_id]), [[159, 'recorded', 9]]);
});

test('an autopilot merge with no record is MISSING', () => {
  const report = auditMergeRecords([mergedPr(159), mergedPr(161)], [recordComment(mergedPr(159), 9)]);
  assert.equal(report.clean, false);
  assert.deepEqual(report.missing, [161]);
});

test('a marker alone, or a record by a stranger, does not count as recorded', () => {
  const pr = mergedPr(159);
  const strangers = auditMergeRecords([pr], [recordComment(pr, 9, { login: 'someone-else' })]);
  assert.deepEqual(strangers.missing, [159], 'an untrusted author records nothing');

  const markerOnly = auditMergeRecords([pr], [{ id: 9, user: BOT, body: mergeMarker(pr.merge_commit_sha) }]);
  assert.deepEqual(markerOnly.conflicts, [159], 'a trusted marker that is not the record is a conflict');
  assert.deepEqual(markerOnly.entries[0].conflicts[0].problems, ['marker_only']);
});

test('a trusted comment naming another PR for the same merge is a CONFLICT, even beside the true record', () => {
  const pr = mergedPr(159);
  const wrong = { id: 8, user: BOT, body: recordOf(pr).body.replace('pr_number: 159', 'pr_number: 160') };
  const report = auditMergeRecords([pr], [wrong, recordComment(pr, 9)]);
  assert.deepEqual(report.conflicts, [159]);
  assert.equal(report.clean, false);
  assert.deepEqual(report.entries[0].conflicts[0].problems, ['mismatch:pr_number']);
});

test('two identical records are recorded, and reported as duplicates', () => {
  const pr = mergedPr(159);
  const report = auditMergeRecords([pr], [recordComment(pr, 9), recordComment(pr, 12)]);
  assert.equal(report.clean, true);
  assert.deepEqual(report.duplicates, [159]);
  assert.deepEqual(report.entries[0].duplicates, [12]);
});

test('a merged PR the audit cannot identify, or an unreadable control room, is an error', () => {
  const broken = { ...mergedPr(159), merge_commit_sha: null };
  assert.throws(() => auditMergeRecords([broken], []), /merge\.sha/);
  assert.throws(() => auditMergeRecords([mergedPr(159)], { message: 'rate limited' }), /could not be read as a list/);
});

// ------------------------------------------------- the CLI, over real HTTP

async function fakeGitHub({ prs = [], comments = [], failClosedPage = null, failCommentsPage = null, failPr = null, createStatus = 201 } = {}) {
  const state = { comments: [...comments], requests: [] };
  const byNumber = new Map(prs.map((p) => [p.number, p]));
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const page = Number(url.searchParams.get('page'));
      state.requests.push({ method: req.method, path: url.pathname, page });
      const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      const single = url.pathname.match(/^\/repos\/o\/r\/pulls\/(\d+)$/);
      if (req.method === 'GET' && url.pathname === '/repos/o/r/pulls') {
        if (url.searchParams.get('state') !== 'closed') return send(400, { message: 'expected state=closed' });
        if (failClosedPage === page) return send(502, { message: 'Bad Gateway' });
        // The list endpoint does not say who merged.
        const list = prs.map(({ merged_by, merged, ...rest }) => rest);
        return send(200, list.slice((page - 1) * 100, page * 100));
      }
      if (req.method === 'GET' && single) {
        if (failPr === Number(single[1])) return send(500, { message: 'Server Error' });
        return send(200, byNumber.get(Number(single[1])));
      }
      if (url.pathname !== '/repos/o/r/issues/80/comments') return send(404, { message: 'Not Found' });
      if (req.method === 'GET') {
        if (failCommentsPage === page) return send(502, { message: 'Bad Gateway' });
        return send(200, state.comments.slice((page - 1) * 100, page * 100));
      }
      if (createStatus !== 201) return send(createStatus, { message: 'Resource not accessible by integration' });
      const stored = { id: 7000 + state.comments.length, body: JSON.parse(raw).body, user: BOT, html_url: 'https://example.invalid/c' };
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

function cli(github, args = [], env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, GITHUB_TOKEN: 'test-token', GITHUB_REPOSITORY: 'o/r', KF_GITHUB_API_URL: github.url, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => {
      let json = null;
      try { json = JSON.parse(stdout.trim().split('\n')[0]); } catch { /* asserted by the caller */ }
      resolve({ status, stdout, stderr, json });
    });
  });
}

const filler = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, body: `comment ${i + 1}`, user: OPERATOR }));
const closedBacklog = (n) => Array.from({ length: n }, (_, i) => mergedPr(2000 + i, { by: OPERATOR, ref: `docs/d${i}` }));

test('cli: every autopilot merge recorded is exit 0, and the audit only reads', async () => {
  const a = mergedPr(159);
  const gh = await fakeGitHub({ prs: [a, mergedPr(166, { by: OPERATOR }), mergedPr(165, { merged: false })], comments: [...filler(120), recordComment(a, 900)] });
  try {
    const r = await cli(gh);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.outcome, 'clean');
    assert.equal(r.json.audited, 1);
    assert.ok(gh.requests.every((q) => q.method === 'GET'));
    assert.match(r.stderr, /audited 1 autopilot merge\(s\) among 2 merged implementation PR\(s\): 1 recorded, 0 missing, 0 in conflict/);
  } finally { await gh.close(); }
});

test('cli: a missing record is exit 5 and, without --reconcile, nothing is posted', async () => {
  const gh = await fakeGitHub({ prs: [mergedPr(159), mergedPr(161)], comments: [recordComment(mergedPr(159), 900)] });
  try {
    const r = await cli(gh);
    assert.equal(r.status, 5);
    assert.deepEqual(r.json.missing, [161]);
    assert.match(r.stderr, /^::error::PR #161, merged by the autopilot as [0-9a-f]{40}: no AUTO_MERGE record$/m);
    assert.equal(gh.posts().length, 0, 'detection alone never writes');
  } finally { await gh.close(); }
});

test('cli: --reconcile posts exactly the missing record, once, and a second run is clean and silent', async () => {
  const missing = mergedPr(161);
  const gh = await fakeGitHub({ prs: [mergedPr(159), missing], comments: [recordComment(mergedPr(159), 900)] });
  try {
    const first = await cli(gh, ['--reconcile']);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.deepEqual(first.json.posted.map((p) => [p.pr, p.outcome]), [[161, 'recorded']]);
    assert.equal(gh.posts().length, 1);
    assert.equal(gh.comments.at(-1).body, recordOf(missing).body, 'what was stored is that merge\'s record');

    const second = await cli(gh, ['--reconcile']);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(second.json.posted, []);
    assert.equal(gh.posts().length, 1, 'idempotent');
  } finally { await gh.close(); }
});

test('cli: a merge by a person, or of a non-implementation branch, is never given a record', async () => {
  const gh = await fakeGitHub({ prs: [mergedPr(166, { by: OPERATOR }), mergedPr(167, { ref: 'fix/x' })] });
  try {
    const r = await cli(gh, ['--reconcile']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.audited, 0);
    assert.equal(gh.posts().length, 0);
    assert.equal(gh.requests.filter((q) => q.path === '/repos/o/r/pulls/167').length, 0, 'a non-impl PR is not even looked up');
  } finally { await gh.close(); }
});

test('cli: an old autopilot merge beyond the first page of closed PRs is still audited', async () => {
  const old = mergedPr(41);
  const gh = await fakeGitHub({ prs: [...closedBacklog(230), old] });
  try {
    const r = await cli(gh);
    assert.equal(r.status, 5);
    assert.deepEqual(r.json.missing, [41]);
    assert.deepEqual(gh.requests.filter((q) => q.path === '/repos/o/r/pulls').map((q) => q.page), [1, 2, 3]);
  } finally { await gh.close(); }
});

test('cli: a conflict is exit 4, named, and --reconcile does not paper over it', async () => {
  const pr = mergedPr(159);
  const wrong = { id: 8, user: BOT, body: recordOf(pr).body.replace('pr_number: 159', 'pr_number: 160') };
  const gh = await fakeGitHub({ prs: [pr], comments: [wrong, recordComment(pr, 9)] });
  try {
    const r = await cli(gh, ['--reconcile']);
    assert.equal(r.status, 4);
    assert.deepEqual(r.json.conflicts, [159]);
    assert.match(r.stderr, /^::error::PR #159, merged by the autopilot as [0-9a-f]{40}: conflicting comment\(s\) 8 \(mismatch:pr_number\)$/m);
    assert.equal(gh.posts().length, 0);
  } finally { await gh.close(); }
});

test('cli: anything it cannot read in full is exit 2 and nothing is posted', async () => {
  const prs = [...closedBacklog(150), mergedPr(161)];
  for (const fault of [{ failClosedPage: 2 }, { failCommentsPage: 2 }, { failPr: 161 }]) {
    const gh = await fakeGitHub({ prs, comments: filler(150), ...fault });
    try {
      const r = await cli(gh, ['--reconcile']);
      assert.equal(r.status, 2, `${JSON.stringify(fault)}: ${r.stdout}`);
      assert.equal(r.json.outcome, 'error');
      assert.equal(gh.posts().length, 0, 'never reconcile from a partial read');
    } finally { await gh.close(); }
  }
});

test('cli: a missing record it is refused permission to post is exit 2, not clean', async () => {
  const gh = await fakeGitHub({ prs: [mergedPr(161)], createStatus: 403 });
  try {
    const r = await cli(gh, ['--reconcile']);
    assert.equal(r.status, 2);
    assert.deepEqual(r.json.missing, [161]);
    assert.match(r.stderr, /could not post 1 missing record\(s\): #161 403/);
  } finally { await gh.close(); }
});

test('cli: without a token, or pointed at another host, it exits 2 and sends nothing', async () => {
  const gh = await fakeGitHub({ prs: [mergedPr(161)] });
  try {
    assert.equal((await cli(gh, [], { GITHUB_TOKEN: '' })).status, 2);
    const elsewhere = await cli(gh, ['--reconcile'], { KF_GITHUB_API_URL: 'https://example.invalid' });
    assert.equal(elsewhere.status, 2);
    assert.match(elsewhere.stderr, /loopback/);
    assert.equal(gh.requests.length, 0);
  } finally { await gh.close(); }
});

// ------------------------------------------------------------- the workflow

test('the sweep job audits after reconciling, even when the sweep failed, under the mutation lock', () => {
  const workflow = parseYaml(fs.readFileSync('.github/workflows/agent-control-autopilot.yml', 'utf8'));
  const job = workflow.jobs['hourly-reconcile-open-prs'];
  const names = job.steps.map((s) => s.name);
  const audit = job.steps.find((s) => s.name === 'Audit AUTO_MERGE records');
  assert.ok(audit, 'the audit step exists');
  assert.ok(names.indexOf('Audit AUTO_MERGE records') > names.indexOf('Reconcile every open implementation PR'));
  // A sweep that failed because a record could not be posted is the case the
  // audit exists to repair; the default `if` would skip it then.
  assert.match(String(audit.if), /!cancelled\(\)/);
  assert.equal(audit.shell, 'bash');
  assert.ok(String(audit.run).includes('node scripts/agent-control/audit-merge-records.mjs --reconcile'));
  assert.equal(job.concurrency.group, MUTATION_LOCK, 'it posts, so it runs under the mutation lock');
  // Only this job reconciles; an unlocked job must not.
  for (const [name, other] of Object.entries(workflow.jobs)) {
    if (name === 'hourly-reconcile-open-prs') continue;
    assert.ok(!(other.steps || []).some((s) => String(s.run || '').includes('audit-merge-records.mjs')), `${name} must not run the audit`);
  }
});

test('the audit step fails the job for a missing record, a conflict, or an audit that did not complete', async () => {
  // The step's own run text, under the shell line GitHub uses for `shell: bash`,
  // with a stub `node` that leaves the status the audit would.
  const os = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const workflow = parseYaml(fs.readFileSync('.github/workflows/agent-control-autopilot.yml', 'utf8'));
  const run = workflow.jobs['hourly-reconcile-open-prs'].steps.find((s) => s.name === 'Audit AUTO_MERGE records').run.replace(/\r\n/g, '\n');
  let bash = 'bash';
  if (process.platform === 'win32') {
    const where = spawnSync('where', ['git'], { encoding: 'utf8' });
    for (const line of (where.stdout || '').split(/\r?\n/).filter(Boolean)) {
      const c = path.join(path.dirname(path.dirname(line)), 'bin', 'bash.exe');
      if (fs.existsSync(c)) { bash = c; break; }
    }
  }
  const posix = (p) => p.split('\\').join('/');
  for (const [status, expectExit, line] of [
    [0, 0, /every autopilot merge has its AUTO_MERGE record/],
    [5, 1, /^::error::an autopilot merge still has no AUTO_MERGE record after reconciliation$/m],
    [4, 1, /^::error::a trusted control-room comment contradicts an AUTO_MERGE record/m],
    [2, 1, /^::error::the AUTO_MERGE audit did not complete \(status 2\)$/m],
    [137, 1, /^::error::the AUTO_MERGE audit did not complete \(status 137\)$/m],
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-audit-step-'));
    try {
      fs.mkdirSync(path.join(dir, 'bin'));
      fs.writeFileSync(path.join(dir, 'bin', 'node'), `#!/usr/bin/env bash\necho "$*" >> "${posix(dir)}/calls"\nexit ${status}\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(dir, 'step.sh'), run);
      const r = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', posix(path.join(dir, 'step.sh'))], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}` },
      });
      const out = (r.stdout || '') + (r.stderr || '');
      assert.equal(r.status, expectExit, `audit status ${status}: ${out}`);
      assert.match(out, line);
      assert.equal(fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim(), 'scripts/agent-control/audit-merge-records.mjs --reconcile');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
