#!/usr/bin/env node
/**
 * LIST-OPEN-IMPL-PRS — the hourly sweep's candidate enumeration.
 * (KF-META-AUTOPILOT-SWEEP-COVERAGE-001; CG-DIR-AUTOPILOT-SWEEP-COVERAGE-002)
 *
 * The scheduled reconcile used to list candidates with `gh pr list --state
 * open`, which returns at most 30 pull requests unless told otherwise. On
 * 2026-10-24 that hid 14 of the 21 open impl/* PRs behind the 30 newest of 52
 * open PRs, and the sweep reported a clean run having evaluated seven.
 *
 * This lister pages the GraphQL API in pages of 100 until hasNextPage is
 * false, then checks that the enumeration is internally consistent before it
 * prints anything: every node well formed, no PR number seen twice, no cursor
 * repeated, the page count bounded, and the number of nodes equal to the
 * totalCount the API reported. Equality with totalCount is evidence of ONE
 * consistent read, not a transactional snapshot: a PR opened or closed while
 * the pages were fetched can show as a duplicate or a count mismatch, and that
 * is treated as churn, not success. The whole enumeration is retried a bounded
 * number of times on churn; a remaining inconsistency fails, before any
 * evaluator runs. Each per-PR evaluator rechecks live eligibility, head and
 * base at execution, so the sweep's listing never decides a merge on its own.
 *
 * Output: the impl/* PR numbers, ascending, one per line, only after a
 * complete and consistent enumeration. On any failure: nothing on stdout, one
 * line on stderr, exit 2. A complete enumeration with no impl/* PR prints
 * nothing and exits 0.
 *
 * Usage (the workflow): node scripts/agent-control/list-open-impl-prs.mjs
 *   GITHUB_TOKEN and GITHUB_REPOSITORY (owner/name) from the job environment.
 */

import { pathToFileURL } from 'node:url';

export const PAGE_SIZE = 100;
export const MAX_PAGES = 50; // 5,000 open pull requests; far beyond this repository, finite on purpose
export const MAX_ATTEMPTS = 2; // one retry of the whole enumeration on churn
export const GRAPHQL_URL = 'https://api.github.com/graphql';
export const IMPL_PREFIX = 'impl/';

export const QUERY = `
query($owner: String!, $name: String!, $first: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: $first, after: $cursor, orderBy: { field: CREATED_AT, direction: ASC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { number headRefName isDraft }
    }
  }
}`;

/** Why an enumeration is not trusted. The code is the first word on stderr. */
export const LISTING_ERRORS = Object.freeze({
  CONFIG: 'config',
  HTTP: 'http',
  JSON: 'json',
  GRAPHQL: 'graphql',
  SHAPE: 'shape',
  CURSOR: 'cursor',
  PAGE_CAP: 'page_cap',
  DUPLICATE: 'duplicate',
  TOTAL_MISMATCH: 'total_mismatch',
});

/** Churn: a second whole enumeration may read a consistent set. */
const RETRYABLE = new Set([LISTING_ERRORS.DUPLICATE, LISTING_ERRORS.TOTAL_MISMATCH]);

export class ListingError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.detail = detail;
  }
}

function parseRepository(repository) {
  const m = /^([^/\s]+)\/([^/\s]+)$/.exec(String(repository || ''));
  if (!m) throw new ListingError(LISTING_ERRORS.CONFIG, `GITHUB_REPOSITORY must be owner/name; got ${JSON.stringify(repository ?? null)}`);
  return { owner: m[1], name: m[2] };
}

async function fetchPage(fetchImpl, { token, owner, name, cursor }) {
  let response;
  try {
    response = await fetchImpl(GRAPHQL_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { owner, name, first: PAGE_SIZE, cursor } }),
    });
  } catch (error) {
    throw new ListingError(LISTING_ERRORS.HTTP, `request failed: ${error?.message ?? error}`);
  }
  if (!response || typeof response.status !== 'number') throw new ListingError(LISTING_ERRORS.HTTP, 'no HTTP response');
  if (response.status < 200 || response.status >= 300) throw new ListingError(LISTING_ERRORS.HTTP, `HTTP ${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new ListingError(LISTING_ERRORS.JSON, `response is not JSON: ${error?.message ?? error}`);
  }
  if (Array.isArray(body?.errors) && body.errors.length) {
    throw new ListingError(LISTING_ERRORS.GRAPHQL, body.errors.map((e) => e?.message ?? String(e)).join('; '));
  }
  const prs = body?.data?.repository?.pullRequests;
  if (!prs || typeof prs !== 'object') throw new ListingError(LISTING_ERRORS.SHAPE, 'data.repository.pullRequests missing');
  if (!Number.isSafeInteger(prs.totalCount) || prs.totalCount < 0) throw new ListingError(LISTING_ERRORS.SHAPE, `totalCount unreadable: ${JSON.stringify(prs.totalCount)}`);
  const info = prs.pageInfo;
  if (!info || typeof info.hasNextPage !== 'boolean') throw new ListingError(LISTING_ERRORS.SHAPE, 'pageInfo.hasNextPage unreadable');
  if (info.endCursor !== null && info.endCursor !== undefined && typeof info.endCursor !== 'string') {
    throw new ListingError(LISTING_ERRORS.SHAPE, 'pageInfo.endCursor unreadable');
  }
  if (!Array.isArray(prs.nodes)) throw new ListingError(LISTING_ERRORS.SHAPE, 'nodes is not a list');
  const nodes = prs.nodes.map((node, i) => {
    if (!node || typeof node !== 'object') throw new ListingError(LISTING_ERRORS.SHAPE, `node ${i} is not an object`);
    if (!Number.isSafeInteger(node.number) || node.number <= 0) throw new ListingError(LISTING_ERRORS.SHAPE, `node ${i} number unreadable: ${JSON.stringify(node.number)}`);
    if (typeof node.headRefName !== 'string' || !node.headRefName) throw new ListingError(LISTING_ERRORS.SHAPE, `node ${i} headRefName unreadable`);
    return { number: node.number, headRefName: node.headRefName, isDraft: node.isDraft === true };
  });
  return { totalCount: prs.totalCount, hasNextPage: info.hasNextPage, endCursor: info.endCursor ?? null, nodes };
}

/**
 * One whole enumeration of the open pull requests.
 * @returns {{totalCount: number, nodes: {number, headRefName, isDraft}[], pages: number}}
 * @throws {ListingError} on any failure or inconsistency
 */
export async function enumerateOpenPullRequests({ fetchImpl = globalThis.fetch, token, repository } = {}) {
  if (!token) throw new ListingError(LISTING_ERRORS.CONFIG, 'GITHUB_TOKEN is required');
  if (typeof fetchImpl !== 'function') throw new ListingError(LISTING_ERRORS.CONFIG, 'no fetch available');
  const { owner, name } = parseRepository(repository);
  const seenNumbers = new Set();
  const seenCursors = new Set();
  const nodes = [];
  let cursor = null;
  let totalCount = null;
  let pages = 0;
  for (;;) {
    if (pages >= MAX_PAGES) throw new ListingError(LISTING_ERRORS.PAGE_CAP, `more than ${MAX_PAGES} pages; refusing to continue`);
    const page = await fetchPage(fetchImpl, { token, owner, name, cursor });
    pages += 1;
    if (totalCount === null) totalCount = page.totalCount;
    else if (page.totalCount !== totalCount) {
      throw new ListingError(LISTING_ERRORS.TOTAL_MISMATCH, `totalCount changed between pages: ${totalCount} then ${page.totalCount}`);
    }
    for (const node of page.nodes) {
      // A number seen twice is churn or a partial re-read, never collapsed into success.
      if (seenNumbers.has(node.number)) throw new ListingError(LISTING_ERRORS.DUPLICATE, `PR #${node.number} listed twice`);
      seenNumbers.add(node.number);
      nodes.push(node);
    }
    if (!page.hasNextPage) break;
    if (typeof page.endCursor !== 'string' || !page.endCursor) {
      throw new ListingError(LISTING_ERRORS.CURSOR, 'hasNextPage is true but endCursor is empty');
    }
    if (seenCursors.has(page.endCursor) || page.endCursor === cursor) {
      throw new ListingError(LISTING_ERRORS.CURSOR, `cursor repeated: ${page.endCursor}`);
    }
    seenCursors.add(page.endCursor);
    cursor = page.endCursor;
  }
  if (nodes.length !== totalCount) {
    throw new ListingError(LISTING_ERRORS.TOTAL_MISMATCH, `collected ${nodes.length} nodes but the API reported totalCount ${totalCount}`);
  }
  return { totalCount, nodes, pages };
}

/**
 * The impl/* PR numbers, ascending, from a complete and consistent
 * enumeration; a bounded whole-enumeration retry on churn.
 * @returns {{numbers: number[], totalCount: number, attempts: number, pages: number}}
 * @throws {ListingError}
 */
export async function listOpenImplPrs({ fetchImpl, token, repository, attempts = MAX_ATTEMPTS, onRetry = () => {} } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { totalCount, nodes, pages } = await enumerateOpenPullRequests({ fetchImpl, token, repository });
      const numbers = nodes.filter((n) => n.headRefName.startsWith(IMPL_PREFIX)).map((n) => n.number).sort((a, b) => a - b);
      return { numbers, totalCount, attempts: attempt, pages };
    } catch (error) {
      lastError = error;
      if (!(error instanceof ListingError) || !RETRYABLE.has(error.code) || attempt === attempts) throw error;
      onRetry(error, attempt);
    }
  }
  throw lastError;
}

export async function main({ env = process.env, fetchImpl = globalThis.fetch, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const result = await listOpenImplPrs({
      fetchImpl,
      token: env.GITHUB_TOKEN || env.GH_TOKEN,
      repository: env.GITHUB_REPOSITORY,
      onRetry: (error, attempt) => stderr.write(`list-open-impl-prs: attempt ${attempt} inconsistent (${error.code}: ${error.detail}); enumerating again\n`),
    });
    stderr.write(`list-open-impl-prs: ${result.totalCount} open pull requests over ${result.pages} page(s), ${result.numbers.length} impl/* candidate(s), attempt ${result.attempts}\n`);
    if (result.numbers.length) stdout.write(`${result.numbers.join('\n')}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof ListingError ? error.code : 'error';
    const detail = error instanceof ListingError ? error.detail : (error?.message ?? String(error));
    stderr.write(`list-open-impl-prs: ${code}: ${detail}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Natural termination, never process.exit(): the status is kept, and the one
  // large stdout write drains into the pipe before the process ends. A forced
  // exit right after that write can end the process with part of the list
  // still unwritten, and exit 0 (SWEEP-IO-001: 65,536 of 85,000 bytes on Linux).
  main().then((code) => { process.exitCode = code; });
}
