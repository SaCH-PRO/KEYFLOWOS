/**
 * Open-PR discovery proofs (lib/pr-discovery.mjs, list-open-impl-prs.mjs).
 *
 * Two properties, and they pull in opposite directions:
 *   - COMPLETE: every open implementation PR is found, however many are open.
 *     The sweep used `gh pr list`, which returns the 30 newest.
 *   - NO WIDER MERGE AUTHORITY: the PRs the sweep may merge are exactly the
 *     ones it was handed before. Everything else is `observe`.
 *
 * The CLI proofs run the real script with its real fetch calls against a local
 * HTTP server standing in for the GitHub API.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import {
  listOpenPrs, planSweep, discoverSweep, sweepLines, MERGE_WINDOW, PER_PAGE, MAX_PAGES, SWEEP_MODES,
} from '../lib/pr-discovery.mjs';

const REPO = 'o/r';
const CLI = 'scripts/agent-control/list-open-impl-prs.mjs';

/** `count` open PRs, newest first (numbers descending), as the pulls API lists them. */
function openPrs(count, shape = () => ({})) {
  return Array.from({ length: count }, (_, i) => {
    const number = 1000 - i;
    const s = shape(number, i);
    return {
      number,
      draft: s.draft ?? false,
      head: { ref: s.ref ?? `docs/n${number}`, sha: String(number).padStart(40, 'a'), repo: { full_name: s.repo ?? REPO } },
    };
  });
}
const pager = (all, log = []) => async (page) => { log.push(page); return all.slice((page - 1) * PER_PAGE, page * PER_PAGE); };
const everyThirdIsImpl = (n, i) => (i % 3 === 0 ? { ref: `impl/p${n}` } : {});

// ------------------------------------------------------------- completeness

test('every open PR is listed, for 0, 1, 30, 31, 100, 101 and 250 open', async () => {
  for (const count of [0, 1, 30, 31, 100, 101, 250]) {
    const pages = [];
    const { prs, pages: read } = await listOpenPrs(pager(openPrs(count), pages));
    assert.equal(prs.length, count, `${count} open`);
    // A full last page is followed by one more read: only a short page ends a listing.
    assert.equal(read, Math.floor(count / PER_PAGE) + 1, `${count} open: pages read`);
    assert.deepEqual(pages, Array.from({ length: read }, (_, i) => i + 1));
  }
});

test('an implementation PR older than the 30 newest is found', async () => {
  // The defect: with 39 open, `gh pr list` never showed the oldest nine.
  const all = openPrs(39, (n, i) => (i === 37 ? { ref: 'impl/the-old-one' } : {}));
  const plan = await discoverSweep(pager(all), REPO);
  assert.equal(plan.open_total, 39);
  assert.deepEqual(plan.impl.map((p) => p.head_ref), ['impl/the-old-one']);
});

test('a page that fails, or is not a list, fails the whole listing', async () => {
  const all = openPrs(250, everyThirdIsImpl);
  const failing = async (page) => { if (page === 2) throw new Error('502 Bad Gateway'); return all.slice((page - 1) * PER_PAGE, page * PER_PAGE); };
  await assert.rejects(discoverSweep(failing, REPO), /502 Bad Gateway/);

  const notAList = async (page) => (page === 2 ? { message: 'rate limited' } : all.slice(0, PER_PAGE));
  await assert.rejects(discoverSweep(notAList, REPO), /page 2 .* is not a list/);

  const noNumber = async () => [{ head: { ref: 'impl/x' } }];
  await assert.rejects(discoverSweep(noNumber, REPO), /no pull request number/);
});

test('a listing that never ends is an error, not an endless loop', async () => {
  let calls = 0;
  const endless = async (page) => { calls += 1; return openPrs(PER_PAGE).map((p) => ({ ...p, number: page * 1000 + p.number })); };
  await assert.rejects(listOpenPrs(endless), /did not end within/);
  assert.equal(calls, MAX_PAGES);
});

test('a PR repeated across pages is kept once, at its first position', async () => {
  // A PR opened between two page reads pushes one entry onto the next page.
  const all = openPrs(150);
  const shifted = async (page) => (page === 1 ? all.slice(0, 100) : page === 2 ? all.slice(99, 150) : []);
  const { prs } = await listOpenPrs(shifted);
  assert.equal(prs.length, 150);
  assert.equal(new Set(prs.map((p) => p.number)).size, 150);
});

// ------------------------------------------------------ no wider authority

test('the merge window is the 30 newest open PRs, the number gh pr list returned', () => {
  assert.equal(MERGE_WINDOW, 30);
});

test('only an implementation PR among the 30 newest OPEN PRs is in merge mode', () => {
  // Position among ALL open PRs decides, not position among impl PRs: that
  // is what the sweep was handed when it listed 30 PRs and then filtered.
  const all = openPrs(45, everyThirdIsImpl);
  const plan = planSweep(all, REPO);
  const indexOf = new Map(all.map((p, i) => [p.number, i]));
  assert.equal(plan.impl.length, 15);
  for (const p of plan.impl) {
    assert.equal(p.mode, indexOf.get(p.number) < 30 ? SWEEP_MODES.MERGE : SWEEP_MODES.OBSERVE, `#${p.number}`);
  }
  assert.equal(plan.in_merge_window, 10);
  assert.equal(plan.observed_only, 5);
});

test('the merge-mode set equals what the old 30-PR listing produced, whatever the backlog', () => {
  for (const count of [5, 30, 31, 39, 120]) {
    const all = openPrs(count, everyThirdIsImpl);
    // The old step: the 30 newest open PRs, then those on impl/ branches.
    const old = all.slice(0, 30).filter((p) => p.head.ref.startsWith('impl/')).map((p) => p.number);
    const now = planSweep(all, REPO).impl.filter((p) => p.mode === SWEEP_MODES.MERGE).map((p) => p.number);
    assert.deepEqual(now, old, `${count} open`);
  }
});

test('thirty-one implementation PRs: the thirty-first is observed, never merged', () => {
  const plan = planSweep(openPrs(31, (n) => ({ ref: `impl/p${n}` })), REPO);
  assert.deepEqual(plan.impl.map((p) => p.mode), [...Array(30).fill('merge'), 'observe']);
});

// -------------------------------------------------------------- what counts

test('a fork PR on an impl/ branch is left out and named, in either window', () => {
  const all = openPrs(40, (n, i) => (i === 2 || i === 35 ? { ref: 'impl/from-a-fork', repo: 'someone/r' } : i === 3 ? { ref: 'impl/ours' } : {}));
  const plan = planSweep(all, REPO);
  assert.deepEqual(plan.impl.map((p) => p.head_ref), ['impl/ours']);
  assert.deepEqual(plan.excluded_forks.map((f) => f.head_repo), ['someone/r', 'someone/r']);
});

test('a PR whose head repository is gone is left out, not assumed to be ours', () => {
  const all = openPrs(1, () => ({ ref: 'impl/orphan' }));
  all[0].head.repo = null;
  const plan = planSweep(all, REPO);
  assert.deepEqual(plan.impl, []);
  assert.equal(plan.excluded_forks.length, 1);
});

test('only impl/ branches are implementation PRs; drafts are listed and flagged', () => {
  const refs = ['impl/a', 'fix/impl/b', 'IMPL/c', 'implementation/d', 'docs/e', 'impl/f'];
  const all = openPrs(refs.length, (n, i) => ({ ref: refs[i], draft: i === 5 }));
  const plan = planSweep(all, REPO);
  assert.deepEqual(plan.impl.map((p) => [p.head_ref, p.draft]), [['impl/a', false], ['impl/f', true]]);
});

test('the shell lines are exactly "<number> <mode>", newest first', () => {
  const plan = planSweep(openPrs(32, (n, i) => (i === 0 || i === 31 ? { ref: `impl/p${n}` } : {})), REPO);
  assert.deepEqual(sweepLines(plan), ['1000 merge', '969 observe']);
});

// ------------------------------------------------- the CLI, over real HTTP

async function fakeGitHub({ prs = [], failPage = null } = {}) {
  const state = { requests: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization });
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'GET' || url.pathname !== '/repos/o/r/pulls') return send(404, { message: 'Not Found' });
    const page = Number(url.searchParams.get('page'));
    if (failPage === page) return send(502, { message: 'Bad Gateway' });
    return send(200, prs.slice((page - 1) * PER_PAGE, page * PER_PAGE));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.close = () => new Promise((resolve) => server.close(resolve));
  return state;
}

function cli(github, args = [], env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, GITHUB_TOKEN: 'test-token', GITHUB_REPOSITORY: REPO, KF_GITHUB_API_URL: github.url, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('cli: 250 open PRs are read over three pages, newest first, and nothing is written', async () => {
  const gh = await fakeGitHub({ prs: openPrs(250, everyThirdIsImpl) });
  try {
    const r = await cli(gh);
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 84);
    assert.equal(lines.filter((l) => l.endsWith(' merge')).length, 10);
    assert.equal(lines.filter((l) => l.endsWith(' observe')).length, 74);
    assert.ok(lines.every((l) => /^\d+ (merge|observe)$/.test(l)), 'nothing but "<number> <mode>" on stdout');
    assert.deepEqual(gh.requests.map((q) => q.query.page), ['1', '2', '3']);
    assert.ok(gh.requests.every((q) => q.method === 'GET'), 'discovery only reads');
    assert.deepEqual([gh.requests[0].query.state, gh.requests[0].query.sort, gh.requests[0].query.direction], ['open', 'created', 'desc']);
    assert.equal(gh.requests[0].auth, 'Bearer test-token');
    assert.match(r.stderr, /discovered 250 open pull request\(s\) over 3 page\(s\): 84 implementation, 10 inside the 30-PR merge window, 74 observed without merge/);
  } finally { await gh.close(); }
});

test('cli: a failed page exits 2 with an EMPTY stdout, so no caller loops over half a listing', async () => {
  const gh = await fakeGitHub({ prs: openPrs(250, everyThirdIsImpl), failPage: 3 });
  try {
    const r = await cli(gh);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /open pull request discovery failed: 502/);
  } finally { await gh.close(); }
});

test('cli: no open implementation PR is a complete, empty listing', async () => {
  const gh = await fakeGitHub({ prs: openPrs(12) });
  try {
    const r = await cli(gh);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /discovered 12 open pull request\(s\) over 1 page\(s\): 0 implementation/);
  } finally { await gh.close(); }
});

test('cli: --json carries the whole plan, forks included', async () => {
  const gh = await fakeGitHub({ prs: openPrs(3, (n, i) => (i === 0 ? { ref: 'impl/ours', draft: true } : i === 1 ? { ref: 'impl/theirs', repo: 'someone/r' } : {})) });
  try {
    const r = await cli(gh, ['--json']);
    assert.equal(r.status, 0, r.stderr);
    const plan = JSON.parse(r.stdout);
    assert.equal(plan.complete, true);
    assert.deepEqual(plan.impl.map((p) => [p.number, p.mode, p.draft]), [[1000, 'merge', true]]);
    assert.deepEqual(plan.excluded_forks.map((f) => f.number), [999]);
    assert.match(r.stderr, /1 fork PR\(s\) on impl\/ branches left out: #999/);
  } finally { await gh.close(); }
});

test('cli: without a token, or pointed at another host, it exits 2 and sends nothing', async () => {
  const gh = await fakeGitHub({ prs: openPrs(3) });
  try {
    assert.equal((await cli(gh, [], { GITHUB_TOKEN: '' })).status, 2);
    const elsewhere = await cli(gh, [], { KF_GITHUB_API_URL: 'https://example.invalid' });
    assert.equal(elsewhere.status, 2);
    assert.match(elsewhere.stderr, /loopback/);
    assert.equal(gh.requests.length, 0);
  } finally { await gh.close(); }
});
