/**
 * The hourly sweep's candidate enumeration (KF-META-AUTOPILOT-SWEEP-COVERAGE-001).
 *
 * `gh pr list --state open` answers with 30 pull requests unless told
 * otherwise. On 2026-10-24 the repository had 52 open PRs, 21 of them impl/*,
 * and the sweep saw seven of them and reported a clean run. The lister proved
 * here pages the GraphQL API to the end and prints nothing unless the
 * enumeration is complete and internally consistent.
 *
 * Every test injects `fetch`. Nothing reaches the network, and what is
 * asserted is what the lister printed, returned, or refused. The last test
 * runs the actual CLI file as a child process and reads its real stdout pipe
 * (SWEEP-IO-001); its fetch is injected through a test-only preload.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  PAGE_SIZE,
  MAX_PAGES,
  MAX_ATTEMPTS,
  GRAPHQL_URL,
  LISTING_ERRORS,
  ListingError,
  enumerateOpenPullRequests,
  listOpenImplPrs,
  main,
} from '../list-open-impl-prs.mjs';

const REPO = 'SaCH-PRO/KEYFLOWOS';
const TOKEN = 'ghs_test_token';

/** `n` open PRs numbered from 101, every `every`-th one on an impl/* head. */
function openPrs(n, { every = 3, from = 101 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const number = from + i;
    const impl = i % every === 0;
    return { number, headRefName: impl ? `impl/kf-packet-${number}` : `chore/branch-${number}`, isDraft: impl };
  });
}

/** Slices `nodes` into GraphQL pages of `size`, with a cursor per page. */
function pagesOf(nodes, size = PAGE_SIZE, { totalCount = nodes.length } = {}) {
  const pages = [];
  for (let i = 0; i < nodes.length || pages.length === 0; i += size) {
    const slice = nodes.slice(i, i + size);
    const last = i + size >= nodes.length;
    pages.push({
      data: { repository: { pullRequests: {
        totalCount,
        pageInfo: { hasNextPage: !last, endCursor: last ? null : `cursor-${pages.length + 1}` },
        nodes: slice,
      } } },
    });
    if (last) break;
  }
  return pages;
}

/**
 * A fetch that answers each call with the next entry of `script`: a body
 * object (HTTP 200), or `{ status }` for an HTTP failure, or `{ raw }` for a
 * body that is not JSON, or `{ throws }` for a network error. Records every
 * request it saw.
 */
function fakeFetch(script) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const i = calls.length;
    calls.push({ url, init, variables: JSON.parse(init.body).variables });
    const entry = script[i];
    if (entry === undefined) throw new Error(`fake fetch: unexpected request #${i + 1}`);
    if (entry.throws) throw new Error(entry.throws);
    if (entry.raw !== undefined) return { status: 200, json: async () => JSON.parse(entry.raw) };
    if (entry.status !== undefined) return { status: entry.status, json: async () => ({}) };
    return { status: 200, json: async () => entry };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function sink() {
  const chunks = [];
  return { write: (s) => { chunks.push(String(s)); return true; }, text: () => chunks.join('') };
}

async function runMain(fetchImpl, env = { GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: REPO }) {
  const stdout = sink();
  const stderr = sink();
  const code = await main({ env, fetchImpl, stdout, stderr });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

async function rejectsWith(promise, code, detailPattern) {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error instanceof ListingError, `expected a ListingError, got ${error && error.constructor.name}: ${error && error.message}`);
  assert.equal(error.code, code, error.message);
  if (detailPattern) assert.match(error.detail, detailPattern);
  return error;
}

// ------------------------------------------------------------- the 2026-10-24 shape

test('52 open PRs over two pages: every impl/* PR is listed, including the ones beyond the 30th', async () => {
  const prs = openPrs(52, { every: 2 }); // 26 impl/* PRs: numbers 101, 103, ..., 151
  const fetchImpl = fakeFetch(pagesOf(prs, 30));
  const result = await listOpenImplPrs({ fetchImpl, token: TOKEN, repository: REPO });
  const expected = prs.filter((p) => p.headRefName.startsWith('impl/')).map((p) => p.number);
  assert.deepEqual(result.numbers, expected);
  assert.equal(result.numbers.length, 26);
  assert.ok(result.numbers.some((n) => n > prs[29].number), 'PRs past the 30th are listed');
  assert.equal(result.totalCount, 52);
  assert.equal(result.pages, 2);
  assert.equal(result.attempts, 1);
});

test('the request pages by 100 and follows endCursor until hasNextPage is false', async () => {
  const prs = openPrs(250);
  const fetchImpl = fakeFetch(pagesOf(prs));
  const result = await enumerateOpenPullRequests({ fetchImpl, token: TOKEN, repository: REPO });
  assert.equal(result.nodes.length, 250);
  assert.equal(result.pages, 3);
  assert.deepEqual(fetchImpl.calls.map((c) => c.variables.cursor), [null, 'cursor-1', 'cursor-2']);
  for (const call of fetchImpl.calls) {
    assert.equal(call.url, GRAPHQL_URL);
    assert.equal(call.init.method, 'POST');
    assert.equal(call.variables.first, PAGE_SIZE);
    assert.deepEqual([call.variables.owner, call.variables.name], ['SaCH-PRO', 'KEYFLOWOS']);
    assert.equal(call.init.headers.authorization, `Bearer ${TOKEN}`);
  }
});

test('more than 30 impl/* PRs on a single page are all listed', async () => {
  const prs = openPrs(45, { every: 1 });
  const fetchImpl = fakeFetch(pagesOf(prs));
  const result = await listOpenImplPrs({ fetchImpl, token: TOKEN, repository: REPO });
  assert.equal(result.numbers.length, 45);
  assert.equal(result.pages, 1);
});

test('the numbers are ascending whatever order the API returned them in', async () => {
  const prs = [
    { number: 162, headRefName: 'impl/a', isDraft: true },
    { number: 155, headRefName: 'impl/b', isDraft: true },
    { number: 160, headRefName: 'impl/c', isDraft: false },
  ];
  const result = await listOpenImplPrs({ fetchImpl: fakeFetch(pagesOf(prs)), token: TOKEN, repository: REPO });
  assert.deepEqual(result.numbers, [155, 160, 162]);
});

test('a complete enumeration with no impl/* PR is an empty list, not an error', async () => {
  const prs = openPrs(40, { every: 1000 }).map((p) => ({ ...p, headRefName: p.headRefName.replace(/^impl\//, 'feature/') }));
  const result = await listOpenImplPrs({ fetchImpl: fakeFetch(pagesOf(prs)), token: TOKEN, repository: REPO });
  assert.deepEqual(result.numbers, []);
  assert.equal(result.totalCount, 40);
  const run = await runMain(fakeFetch(pagesOf(prs)));
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, '');
});

test('only the impl/ prefix qualifies: impl-, Impl/ and a branch containing impl/ elsewhere do not', async () => {
  const prs = [
    { number: 1, headRefName: 'impl/x', isDraft: true },
    { number: 2, headRefName: 'impl-x', isDraft: true },
    { number: 3, headRefName: 'Impl/x', isDraft: true },
    { number: 4, headRefName: 'feature/impl/x', isDraft: true },
    { number: 5, headRefName: 'implementation/x', isDraft: true },
  ];
  const result = await listOpenImplPrs({ fetchImpl: fakeFetch(pagesOf(prs)), token: TOKEN, repository: REPO });
  assert.deepEqual(result.numbers, [1]);
});

test('main prints the numbers one per line on stdout and a summary on stderr', async () => {
  const prs = openPrs(52, { every: 2 });
  const run = await runMain(fakeFetch(pagesOf(prs, 30)));
  assert.equal(run.code, 0, run.stderr);
  const lines = run.stdout.split('\n');
  assert.equal(lines.at(-1), '', 'stdout ends with a newline');
  assert.deepEqual(lines.slice(0, -1).map(Number), prs.filter((p) => p.headRefName.startsWith('impl/')).map((p) => p.number));
  assert.match(run.stderr, /52 open pull requests over 2 page\(s\), 26 impl\/\* candidate\(s\), attempt 1/);
});

// ------------------------------------------------------------- churn and inconsistency

test('NC: a PR number seen on two pages is a duplicate, never collapsed into success', async () => {
  const prs = openPrs(150, { every: 1 });
  const pages = pagesOf(prs);
  pages[1].data.repository.pullRequests.nodes[0] = { ...prs[99] }; // the last node of page one, again
  const fetchImpl = fakeFetch(pages);
  await rejectsWith(enumerateOpenPullRequests({ fetchImpl, token: TOKEN, repository: REPO }), LISTING_ERRORS.DUPLICATE, /#200 listed twice/);
});

test('NC: a duplicated page cannot be deduplicated into a clean listing even when the count would then match', async () => {
  // Two identical pages of 100 and a totalCount of 100: deduplication would
  // produce exactly totalCount nodes and look complete. It is still refused.
  const prs = openPrs(100, { every: 1 });
  const [page] = pagesOf(prs);
  page.data.repository.pullRequests.pageInfo = { hasNextPage: true, endCursor: 'cursor-1' };
  const repeat = structuredClone(page);
  repeat.data.repository.pullRequests.pageInfo = { hasNextPage: false, endCursor: null };
  const fetchImpl = fakeFetch([page, repeat, page, repeat]);
  await rejectsWith(listOpenImplPrs({ fetchImpl, token: TOKEN, repository: REPO }), LISTING_ERRORS.DUPLICATE);
  assert.equal(fetchImpl.calls.length, 4, 'one whole retry, then refusal');
});

test('NC: fewer nodes than totalCount is an incomplete enumeration, not a shorter list', async () => {
  const prs = openPrs(52, { every: 2 });
  const pages = pagesOf(prs, 30, { totalCount: 53 });
  await rejectsWith(enumerateOpenPullRequests({ fetchImpl: fakeFetch(pages), token: TOKEN, repository: REPO }), LISTING_ERRORS.TOTAL_MISMATCH, /collected 52 nodes but the API reported totalCount 53/);
});

test('NC: a totalCount that changes between pages is churn, not the later page\'s truth', async () => {
  const prs = openPrs(52, { every: 2 });
  const pages = pagesOf(prs, 30);
  pages[1].data.repository.pullRequests.totalCount = 51;
  await rejectsWith(enumerateOpenPullRequests({ fetchImpl: fakeFetch(pages), token: TOKEN, repository: REPO }), LISTING_ERRORS.TOTAL_MISMATCH, /changed between pages: 52 then 51/);
});

test('churn is retried as a whole enumeration once, and a consistent second read is used', async () => {
  const prs = openPrs(52, { every: 2 });
  const churned = pagesOf(prs, 30);
  churned[1].data.repository.pullRequests.totalCount = 53;
  const fetchImpl = fakeFetch([...churned, ...pagesOf(prs, 30)]);
  const retries = [];
  const result = await listOpenImplPrs({ fetchImpl, token: TOKEN, repository: REPO, onRetry: (e, attempt) => retries.push([e.code, attempt]) });
  assert.equal(result.attempts, 2);
  assert.equal(result.numbers.length, 26);
  assert.deepEqual(retries, [[LISTING_ERRORS.TOTAL_MISMATCH, 1]]);
  assert.deepEqual(fetchImpl.calls.map((c) => c.variables.cursor), [null, 'cursor-1', null, 'cursor-1'], 'the retry starts from the first page');
});

test('NC: churn on every attempt fails after the bounded retry, with nothing on stdout', async () => {
  const prs = openPrs(52, { every: 2 });
  const script = [];
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    const pages = pagesOf(prs, 30);
    pages[1].data.repository.pullRequests.totalCount = 53;
    script.push(...pages);
  }
  const fetchImpl = fakeFetch(script);
  const run = await runMain(fetchImpl);
  assert.equal(run.code, 2);
  assert.equal(run.stdout, '', 'no candidate list is printed from an inconsistent enumeration');
  assert.match(run.stderr, /attempt 1 inconsistent \(total_mismatch/);
  assert.match(run.stderr, /list-open-impl-prs: total_mismatch:/);
  assert.equal(fetchImpl.calls.length, 2 * MAX_ATTEMPTS, 'exactly the bounded number of whole enumerations');
});

test('a non-churn failure is not retried', async () => {
  const fetchImpl = fakeFetch([{ status: 502 }, ...pagesOf(openPrs(3))]);
  await rejectsWith(listOpenImplPrs({ fetchImpl, token: TOKEN, repository: REPO }), LISTING_ERRORS.HTTP, /HTTP 502/);
  assert.equal(fetchImpl.calls.length, 1, 'an HTTP failure is reported, not papered over by a second read');
});

// ------------------------------------------------------------- transport and shape failures

test('NC: an HTTP failure on the second page fails the whole listing; the first page is not printed', async () => {
  const prs = openPrs(52, { every: 2 });
  const [first] = pagesOf(prs, 30);
  const run = await runMain(fakeFetch([first, { status: 502 }]));
  assert.equal(run.code, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /^list-open-impl-prs: http: HTTP 502\n$/);
});

test('a network error, a non-JSON body and a GraphQL error each fail with their own code', async () => {
  await rejectsWith(enumerateOpenPullRequests({ fetchImpl: fakeFetch([{ throws: 'ECONNRESET' }]), token: TOKEN, repository: REPO }), LISTING_ERRORS.HTTP, /ECONNRESET/);
  await rejectsWith(enumerateOpenPullRequests({ fetchImpl: fakeFetch([{ raw: '<html>502</html>' }]), token: TOKEN, repository: REPO }), LISTING_ERRORS.JSON);
  const graphql = { errors: [{ message: 'API rate limit exceeded' }], data: null };
  await rejectsWith(enumerateOpenPullRequests({ fetchImpl: fakeFetch([graphql]), token: TOKEN, repository: REPO }), LISTING_ERRORS.GRAPHQL, /rate limit exceeded/);
});

test('NC: malformed nodes, a missing pageInfo and an unreadable totalCount are shape failures, not empty pages', async () => {
  const shapes = [
    { data: { repository: null } },
    { data: { repository: { pullRequests: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ number: '101', headRefName: 'impl/x' }] } } } },
    { data: { repository: { pullRequests: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ number: 101, headRefName: '' }] } } } },
    { data: { repository: { pullRequests: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [null] } } } },
    { data: { repository: { pullRequests: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: null } } } },
    { data: { repository: { pullRequests: { totalCount: 1, nodes: [] } } } },
    { data: { repository: { pullRequests: { totalCount: '1', pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } },
    { data: { repository: { pullRequests: { totalCount: 1, pageInfo: { hasNextPage: 'no', endCursor: null }, nodes: [] } } } },
  ];
  for (const body of shapes) {
    await rejectsWith(enumerateOpenPullRequests({ fetchImpl: fakeFetch([body]), token: TOKEN, repository: REPO }), LISTING_ERRORS.SHAPE);
  }
});

test('NC: hasNextPage with no cursor, and a cursor that repeats, are cursor failures rather than loops', async () => {
  const prs = openPrs(100, { every: 1 });
  const [page] = pagesOf(prs);
  const noCursor = structuredClone(page);
  noCursor.data.repository.pullRequests.pageInfo = { hasNextPage: true, endCursor: null };
  await rejectsWith(enumerateOpenPullRequests({ fetchImpl: fakeFetch([noCursor]), token: TOKEN, repository: REPO }), LISTING_ERRORS.CURSOR, /endCursor is empty/);

  const first = structuredClone(page);
  first.data.repository.pullRequests.pageInfo = { hasNextPage: true, endCursor: 'same' };
  const second = pagesOf(openPrs(100, { every: 1, from: 1001 }))[0];
  second.data.repository.pullRequests.pageInfo = { hasNextPage: true, endCursor: 'same' };
  const fetchImpl = fakeFetch([first, second]);
  await rejectsWith(enumerateOpenPullRequests({ fetchImpl, token: TOKEN, repository: REPO }), LISTING_ERRORS.CURSOR, /cursor repeated/);
  assert.equal(fetchImpl.calls.length, 2, 'the repeated cursor is refused before a third request');
});

test('NC: an endless hasNextPage stops at the page cap instead of running forever', async () => {
  const script = [];
  for (let i = 0; i < MAX_PAGES + 5; i += 1) {
    const [page] = pagesOf(openPrs(100, { every: 1, from: 1 + i * 100 }));
    page.data.repository.pullRequests.totalCount = 100 * (MAX_PAGES + 5);
    page.data.repository.pullRequests.pageInfo = { hasNextPage: true, endCursor: `c${i}` };
    script.push(page);
  }
  const fetchImpl = fakeFetch(script);
  await rejectsWith(enumerateOpenPullRequests({ fetchImpl, token: TOKEN, repository: REPO }), LISTING_ERRORS.PAGE_CAP);
  assert.equal(fetchImpl.calls.length, MAX_PAGES);
});

test('missing token, missing repository or a malformed repository are configuration failures before any request', async () => {
  const fetchImpl = fakeFetch([]);
  await rejectsWith(enumerateOpenPullRequests({ fetchImpl, token: '', repository: REPO }), LISTING_ERRORS.CONFIG, /GITHUB_TOKEN/);
  await rejectsWith(enumerateOpenPullRequests({ fetchImpl, token: TOKEN, repository: undefined }), LISTING_ERRORS.CONFIG, /owner\/name/);
  await rejectsWith(enumerateOpenPullRequests({ fetchImpl, token: TOKEN, repository: 'KEYFLOWOS' }), LISTING_ERRORS.CONFIG);
  await rejectsWith(enumerateOpenPullRequests({ fetchImpl, token: TOKEN, repository: 'a/b/c' }), LISTING_ERRORS.CONFIG);
  assert.equal(fetchImpl.calls.length, 0);
  const run = await runMain(fetchImpl, { GITHUB_REPOSITORY: REPO });
  assert.equal(run.code, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /config: GITHUB_TOKEN is required/);
});

test('main accepts GH_TOKEN when GITHUB_TOKEN is unset, as the workflow job sets both', async () => {
  const fetchImpl = fakeFetch(pagesOf(openPrs(3)));
  const run = await runMain(fetchImpl, { GH_TOKEN: TOKEN, GITHUB_REPOSITORY: REPO });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(fetchImpl.calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
});

test('an error that is not a ListingError still exits 2 with nothing on stdout', async () => {
  const fetchImpl = async () => { throw new TypeError('fetch is broken'); };
  // fetchPage wraps request failures as HTTP; force an unexpected failure past it.
  const run = await runMain(fetchImpl);
  assert.equal(run.code, 2);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /http: request failed: fetch is broken/);
});

// ------------------------------------------------------------- the CLI-to-pipe boundary (SWEEP-IO-001)
//
// Everything above injects stdout in memory. The sweep consumes the real
// process's stdout through a pipe, and that boundary has its own defect: a
// process.exit() right after the one large write ends the process with part
// of the list still unwritten, and exit 0. On Linux the kernel pipe takes
// 65,536 bytes of an 85,000-byte write and the rest is lost. On Windows, Node
// gives a stdout pipe a blocking handle with synchronous writes, so the
// native pipe cannot show the loss; the second leg below models a POSIX pipe
// under backpressure deterministically on every platform, and it is the leg
// through which the negative control is live on Windows.

const CLI_PATH = fileURLToPath(new URL('../list-open-impl-prs.mjs', import.meta.url));

/** 5,000 open impl/* PRs with 16-digit numbers over 50 pages, the page cap exactly: 85,000 bytes of stdout. */
const PIPE_CASE = Object.freeze({ total: MAX_PAGES * PAGE_SIZE, from: 1_000_000_000_000_000 });
const PIPE_EXPECTED_NUMBERS = Object.freeze(Array.from({ length: PIPE_CASE.total }, (_, i) => PIPE_CASE.from + i));
const PIPE_EXPECTED_TEXT = `${PIPE_EXPECTED_NUMBERS.join('\n')}\n`;
const PIPE_EXPECTED_BYTES = Buffer.byteLength(PIPE_EXPECTED_TEXT);

/**
 * Test-only preload for the child. It answers the lister's GraphQL requests
 * from memory, and, when KF_LISTER_TEST_ASYNC_STDOUT is 1, delivers every
 * process.stdout.write to the real pipe on a later macrotask and reports
 * backpressure (returns false), which is what a POSIX pipe does once its
 * buffer is full. Nothing shipped reads these variables; the file exists only
 * in a temporary directory for the duration of one child.
 */
const PRELOAD_SOURCE = `
const TOTAL = Number(process.env.KF_LISTER_TEST_TOTAL);
const FROM = Number(process.env.KF_LISTER_TEST_FROM);
const PAGE = Number(process.env.KF_LISTER_TEST_PAGE);
globalThis.fetch = async (url, init) => {
  const { variables } = JSON.parse(init.body);
  const pageIndex = variables.cursor === null ? 0 : Number(variables.cursor.slice('cursor-'.length));
  const start = pageIndex * PAGE;
  const end = Math.min(start + PAGE, TOTAL);
  const nodes = [];
  for (let i = start; i < end; i += 1) nodes.push({ number: FROM + i, headRefName: 'impl/kf-' + (FROM + i), isDraft: true });
  const last = end >= TOTAL;
  const body = { data: { repository: { pullRequests: {
    totalCount: TOTAL,
    pageInfo: { hasNextPage: !last, endCursor: last ? null : 'cursor-' + (pageIndex + 1) },
    nodes,
  } } } };
  return { status: 200, json: async () => body };
};
if (process.env.KF_LISTER_TEST_ASYNC_STDOUT === '1') {
  const realWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, encoding, callback) => {
    setImmediate(() => realWrite(chunk, encoding, callback));
    return false;
  };
}
`;

const CHILD_KILL_MS = 30_000;
const READER_RESUME_AT_LATEST_MS = 5_000;
const READER_RESUME_AFTER_SUMMARY_MS = 150;

/**
 * Runs the actual CLI as a child whose stdout is a real pipe. The reader is
 * held paused until the child has announced its result on stderr (the
 * summary line precedes the stdout write), plus a margin, so the one large
 * write meets a reader that is not consuming; it always resumes on its own
 * timer, so a correct child can never deadlock against the test, and a hung
 * child is killed and reported. Returns exactly what the pipe delivered.
 */
async function runCliThroughPipe({ asyncStdout }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-lister-pipe-'));
  const preload = path.join(dir, 'preload.mjs');
  fs.writeFileSync(preload, PRELOAD_SOURCE);
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, CLI_PATH], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Only what Node needs to start; nothing of this process's credentials.
    env: {
      SystemRoot: process.env.SystemRoot,
      PATH: process.env.PATH,
      GITHUB_TOKEN: 'synthetic-token-not-a-credential',
      GITHUB_REPOSITORY: REPO,
      KF_LISTER_TEST_TOTAL: String(PIPE_CASE.total),
      KF_LISTER_TEST_FROM: String(PIPE_CASE.from),
      KF_LISTER_TEST_PAGE: String(PAGE_SIZE),
      ...(asyncStdout ? { KF_LISTER_TEST_ASYNC_STDOUT: '1' } : {}),
    },
  });
  const timers = [];
  let killed = false;
  let resumed = false;
  const resume = () => {
    if (resumed) return;
    resumed = true;
    child.stdout.resume();
  };
  try {
    const chunks = [];
    let stderr = '';
    child.stdout.pause();
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (!resumed && /impl\/\* candidate\(s\)/.test(stderr)) {
        timers.push(setTimeout(resume, READER_RESUME_AFTER_SUMMARY_MS));
      }
    });
    timers.push(setTimeout(resume, READER_RESUME_AT_LATEST_MS));
    timers.push(setTimeout(() => { killed = true; child.kill('SIGKILL'); resume(); }, CHILD_KILL_MS));
    const [code, signal] = await once(child, 'close');
    return { code, signal, killed, stdout: Buffer.concat(chunks), stderr };
  } finally {
    for (const timer of timers) clearTimeout(timer);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function assertCompletePipeDelivery(leg, run) {
  assert.equal(run.killed, false, `${leg}: the child hung and was killed; stderr: ${run.stderr}`);
  assert.equal(run.signal, null, `${leg}: the child ended by signal ${run.signal}; stderr: ${run.stderr}`);
  assert.equal(run.code, 0, `${leg}: exit ${run.code}; stderr: ${run.stderr}`);
  assert.match(run.stderr, /5000 open pull requests over 50 page\(s\), 5000 impl\/\* candidate\(s\), attempt 1/, `${leg}: the summary line`);
  // Byte-for-byte: the whole ordered list reached the pipe, not a prefix that still parses.
  assert.equal(run.stdout.length, PIPE_EXPECTED_BYTES, `${leg}: ${run.stdout.length} of ${PIPE_EXPECTED_BYTES} bytes reached the pipe`);
  assert.equal(run.stdout.toString('utf8'), PIPE_EXPECTED_TEXT, `${leg}: stdout differs from the expected list`);
  const numbers = run.stdout.toString('utf8').split('\n').slice(0, -1).map(Number);
  assert.equal(numbers.length, PIPE_CASE.total, `${leg}: candidate count`);
  assert.deepEqual(numbers, PIPE_EXPECTED_NUMBERS, `${leg}: candidate identities and order`);
}

test('NC: the CLI drains its stdout pipe before it exits: 5,000 candidates reach a paused reader complete, exit 0', async (t) => {
  // Leg 1, the native OS pipe. With the forced exit restored this leg fails on
  // Linux (65,536 of 85,000 bytes) and passes on Windows, whose stdout pipe is
  // blocking; it is not evidence of native Windows loss and does not claim it.
  await t.test('drains its stdout pipe before it exits: native OS pipe', async () => {
    assertCompletePipeDelivery('native OS pipe', await runCliThroughPipe({ asyncStdout: false }));
  });
  // Leg 2, the modeled POSIX pipe under backpressure: each write reaches the
  // real pipe on a later macrotask. A forced exit in the microtask after
  // main() resolves runs first and the list never reaches the pipe, on every
  // platform; natural termination lets the write drain, then exits with the
  // same status. This is the leg through which the control is live on Windows.
  await t.test('drains its stdout pipe before it exits: modeled asynchronous stdout (test-only preload sink)', async () => {
    assertCompletePipeDelivery('modeled asynchronous stdout', await runCliThroughPipe({ asyncStdout: true }));
  });
});
