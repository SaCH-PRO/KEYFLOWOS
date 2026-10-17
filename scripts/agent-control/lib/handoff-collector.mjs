/**
 * HANDOFF COLLECTOR — GET-only, bounded reading of issue #80 for the handoff
 * viewer, and the demand-driven cache around it. (KF-META-HANDOFF-MONITOR-001)
 *
 * The transport can reach exactly three GitHub REST paths of this repository:
 *   /repos/SaCH-PRO/KEYFLOWOS/issues/80
 *   /repos/SaCH-PRO/KEYFLOWOS/issues/80/comments
 *   /repos/SaCH-PRO/KEYFLOWOS/pulls/<n>
 * Every request is a GET. A `next` page link is followed only when it is one
 * of those paths on api.github.com. No URL taken from a comment is fetched.
 *
 * Freshness is kept as separate facts, never one green timestamp:
 *   source event times    the comments' own created_at / updated_at
 *   last_success_at       the last collection that completed in full
 *   last_attempt_at       the last collection started, whatever happened
 *   generation            bumped only when the projected content changed
 *   coverage              COMPLETE, or PARTIAL/FAILED with the reason
 * A failed or partial collection never advances last_success_at, and a 304
 * confirms the fetch without touching any event time. The last good snapshot
 * is kept and served as DEGRADED or STALE after a failure.
 */

import { CONTROL_ISSUE, REPOSITORY, projectHandoffs, redactCredentials } from './handoff-projector.mjs';

export const GITHUB_API_ORIGIN = 'https://api.github.com';
export const PER_PAGE = 100;

const BASE = `/repos/${REPOSITORY}`;
const ALLOWED_PATH = new RegExp(
  `^${BASE.replace(/\//g, '\\/')}/(issues/${CONTROL_ISSUE}|issues/${CONTROL_ISSUE}/comments|pulls/\\d{1,7})$`,
);
const ALLOWED_QUERY = new Set(['per_page', 'page', 'since']);

export const DEFAULT_CONFIG = Object.freeze({
  minRefreshMs: 30_000, // server-side refresh target; requests in between are served from cache
  staleAfterMs: 180_000, // a snapshot older than this is STALE
  fullResyncMs: 600_000, // full paginated pass that detects deletions
  sinceOverlapMs: 300_000, // incremental passes re-read this much history (clock skew, late edits)
  maxPages: 60, // 6,000 comments; more is reported PARTIAL, never COMPLETE
  maxPulls: 20, // PR facts fetched per refresh
  backoffBaseMs: 30_000,
  backoffMaxMs: 900_000,
});

export class CollectionError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Validate a request target. Accepts a path with an optional query string, or
 * an absolute api.github.com URL (a pagination link). Returns the
 * normalized `path?query`, or throws.
 */
export function allowedRequest(target) {
  let url;
  try {
    url = new URL(target, GITHUB_API_ORIGIN);
  } catch {
    throw new CollectionError('REQUEST_NOT_ALLOWED', 'unparseable request target');
  }
  if (url.origin !== GITHUB_API_ORIGIN || url.username || url.password || url.hash) {
    throw new CollectionError('REQUEST_NOT_ALLOWED', `origin ${url.origin} is not the GitHub API`);
  }
  if (!ALLOWED_PATH.test(url.pathname)) {
    throw new CollectionError('REQUEST_NOT_ALLOWED', `path ${url.pathname} is not an allowed handoff source`);
  }
  for (const [key, value] of url.searchParams) {
    if (!ALLOWED_QUERY.has(key)) throw new CollectionError('REQUEST_NOT_ALLOWED', `query parameter ${key} is not allowed`);
    if (key !== 'since' && !/^\d{1,4}$/.test(value)) throw new CollectionError('REQUEST_NOT_ALLOWED', `query ${key}=${value} is not a number`);
    if (key === 'since' && Number.isNaN(Date.parse(value))) throw new CollectionError('REQUEST_NOT_ALLOWED', 'since is not a timestamp');
  }
  return `${url.pathname}${url.search}`;
}

/**
 * The live transport: GET only, fixed origin, allowlisted paths, no
 * redirects, a timeout, and the credential only in the Authorization header.
 *
 * @returns {{get(target, {etag}): Promise<{status, headers, json}>}}
 */
export function createGithubTransport({ token, fetchImpl = globalThis.fetch, timeoutMs = 10_000, userAgent = 'keyflow-handoff-monitor' } = {}) {
  if (!token) throw new CollectionError('NOT_CONFIGURED', 'no GitHub read credential is configured');
  return {
    async get(target, { etag } = {}) {
      const pathAndQuery = allowedRequest(target);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers = {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${token}`,
          'User-Agent': userAgent,
        };
        if (etag) headers['If-None-Match'] = etag;
        const res = await fetchImpl(`${GITHUB_API_ORIGIN}${pathAndQuery}`, {
          method: 'GET',
          headers,
          redirect: 'error',
          signal: controller.signal,
        });
        const pick = (name) => res.headers.get(name);
        const out = {
          status: res.status,
          headers: {
            etag: pick('etag'),
            link: pick('link'),
            'retry-after': pick('retry-after'),
            'x-ratelimit-remaining': pick('x-ratelimit-remaining'),
            'x-ratelimit-reset': pick('x-ratelimit-reset'),
          },
          json: null,
        };
        if (res.status === 200) out.json = await res.json();
        return out;
      } catch (err) {
        if (err instanceof CollectionError) throw err;
        const timedOut = err?.name === 'AbortError';
        throw new CollectionError(timedOut ? 'TIMEOUT' : 'NETWORK', timedOut ? `GitHub did not answer within ${timeoutMs} ms` : redactCredentials(String(err?.message || err)).text);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function nextLink(link) {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

function httpFailure(res, target) {
  const reset = Number(res.headers['x-ratelimit-reset']);
  const retryAfter = Number(res.headers['retry-after']);
  const rateLimited = res.status === 429 || (res.status === 403 && res.headers['x-ratelimit-remaining'] === '0');
  return new CollectionError(rateLimited ? 'RATE_LIMITED' : 'HTTP_ERROR', `GitHub answered ${res.status} for ${target}`, {
    status: res.status,
    retryAt: Number.isFinite(retryAfter) && retryAfter > 0
      ? Date.now() + retryAfter * 1000
      : rateLimited && Number.isFinite(reset) && reset > 0 ? reset * 1000 : null,
  });
}

/**
 * One GET through the conditional cache. Returns {json, notModified}.
 * A 304 reuses the cached body for that exact target.
 */
async function conditionalGet(transport, target, etags) {
  const cached = etags.get(target);
  const res = await transport.get(target, { etag: cached?.etag });
  if (res.status === 304 && cached) return { json: cached.json, notModified: true, headers: { ...res.headers, link: cached.link } };
  if (res.status !== 200) throw httpFailure(res, target);
  if (res.headers.etag) etags.set(target, { etag: res.headers.etag, json: res.json, link: res.headers.link });
  return { json: res.json, notModified: false, headers: res.headers };
}

/**
 * Read every page of a comments listing. Throws on any page failure; never
 * returns a truncated list as if it were complete.
 */
async function readCommentPages(transport, firstTarget, etags, maxPages) {
  const comments = [];
  let target = firstTarget;
  let pages = 0;
  let notModified = 0;
  while (target) {
    if (pages >= maxPages) {
      throw new CollectionError('TRUNCATED', `more than ${maxPages} pages; collection stopped`, { partial: comments, pages });
    }
    const normalized = allowedRequest(target);
    let page;
    try {
      page = await conditionalGet(transport, normalized, etags);
    } catch (err) {
      err.partial = comments;
      err.pages = pages;
      throw err;
    }
    if (!Array.isArray(page.json)) throw new CollectionError('MALFORMED_RESPONSE', `page ${pages + 1} is not a list`, { partial: comments, pages });
    comments.push(...page.json);
    pages += 1;
    if (page.notModified) notModified += 1;
    target = nextLink(page.headers.link);
  }
  return { comments, pages, notModified };
}

/**
 * Keep the newer version of a comment. A lagging or out-of-order response can
 * carry an older copy of a comment already seen; it must not overwrite the
 * newer one.
 */
function putNewer(map, comment) {
  const seen = map.get(comment.id);
  const stamp = (c) => String(c.updated_at || c.created_at || '');
  if (!seen || stamp(comment) >= stamp(seen)) map.set(comment.id, comment);
}

const commentsTarget = (params) => {
  const q = new URLSearchParams({ per_page: String(PER_PAGE), ...params });
  return `${BASE}/issues/${CONTROL_ISSUE}/comments?${q}`;
};

/**
 * Collect once. `state` carries the comment map, ETags and resync bookkeeping
 * between calls and is updated only when the collection succeeds.
 *
 * @returns {{comments, pulls, coverage, changed}}
 */
export async function collectOnce(transport, state, { now, config }) {
  const etags = state.etags;
  const issue = await conditionalGet(transport, `${BASE}/issues/${CONTROL_ISSUE}`, etags);
  const expected = Number.isSafeInteger(issue.json?.comments) ? issue.json.comments : null;

  const due = !state.lastFullAt || now - state.lastFullAt >= config.fullResyncMs || state.needsFull;
  let mode = due || !state.maxUpdatedAt ? 'FULL' : 'INCREMENTAL';
  const next = new Map(state.comments);
  let deletions = [];
  let pagesRead = 0;
  let notModified = 0;

  const full = async () => {
    const read = await readCommentPages(transport, commentsTarget({}), etags, config.maxPages);
    pagesRead += read.pages;
    notModified += read.notModified;
    const seen = new Set(read.comments.map((c) => c.id));
    deletions = [...next.keys()].filter((id) => !seen.has(id));
    // A full pass is authoritative for which comments exist, not for which
    // copy of a surviving comment is newest.
    const previous = new Map(next);
    next.clear();
    for (const c of read.comments) {
      if (previous.has(c.id)) next.set(c.id, previous.get(c.id));
      putNewer(next, c);
    }
  };

  if (mode === 'FULL') {
    await full();
  } else {
    const since = new Date(Date.parse(state.maxUpdatedAt) - config.sinceOverlapMs).toISOString();
    const read = await readCommentPages(transport, commentsTarget({ since }), new Map(), config.maxPages);
    pagesRead += read.pages;
    for (const c of read.comments) putNewer(next, c);
    // A count that disagrees means something was missed or deleted: one full
    // pass now, bounded, instead of trusting the incremental view.
    if (expected !== null && next.size !== expected) {
      mode = 'FULL_AFTER_COUNT_MISMATCH';
      await full();
    }
  }

  const coverage = {
    status: 'COMPLETE',
    mode,
    pages: pagesRead,
    pages_not_modified: notModified,
    comments_observed: next.size,
    comments_expected: expected,
    deletions_detected: deletions.length,
    reason: null,
  };
  if (expected !== null && next.size !== expected) {
    coverage.status = 'PARTIAL';
    coverage.reason = `GitHub reports ${expected} comments; ${next.size} were read`;
  }

  // PR facts for the newest tasks that name a PR, bounded.
  const comments = [...next.values()];
  const preview = projectHandoffs(comments, { observedAt: new Date(now).toISOString() });
  const prNumbers = [...new Set(preview.tasks.map((t) => t.request.pr_number).filter((n) => n !== null))].slice(0, config.maxPulls);
  const pulls = [];
  const pullErrors = [];
  for (const n of prNumbers) {
    try {
      const pr = await conditionalGet(transport, `${BASE}/pulls/${n}`, etags);
      pulls.push({
        number: n,
        head_sha: typeof pr.json?.head?.sha === 'string' ? pr.json.head.sha : null,
        state: pr.json?.merged_at ? 'MERGED' : pr.json?.state === 'closed' ? 'CLOSED' : pr.json?.draft ? 'OPEN_DRAFT' : pr.json?.state === 'open' ? 'OPEN' : 'UNKNOWN',
      });
    } catch (err) {
      pullErrors.push({ number: n, code: err.code || 'ERROR' });
    }
  }
  coverage.pulls_requested = prNumbers.length;
  coverage.pull_errors = pullErrors;

  const maxUpdatedAt = comments.reduce((max, c) => (String(c.updated_at || c.created_at || '') > max ? String(c.updated_at || c.created_at) : max), '');
  const fingerprint = JSON.stringify([comments.length, maxUpdatedAt, deletions, pulls]);
  const changed = fingerprint !== state.fingerprint;

  // Commit bookkeeping only now that the collection completed.
  state.comments = next;
  state.maxUpdatedAt = maxUpdatedAt || state.maxUpdatedAt;
  if (mode !== 'INCREMENTAL') state.lastFullAt = now;
  state.needsFull = coverage.status !== 'COMPLETE';
  state.fingerprint = fingerprint;
  return { comments, pulls, coverage, changed, deletions };
}

function emptyFreshness(status, detail) {
  return {
    status,
    detail,
    last_success_at: null,
    last_attempt_at: null,
    last_attempt_outcome: null,
    generation: 0,
    stale_after_seconds: null,
    snapshot_age_seconds: null,
    backoff_until: null,
    coverage: null,
    error: null,
  };
}

/**
 * The demand-driven monitor the server holds one of. `read()` returns the
 * current snapshot, refreshing first when the cached one is older than
 * `minRefreshMs` and no backoff is in force. Concurrent reads share one
 * refresh. A refresh that finishes after a newer one has committed is
 * discarded, so a slow or reconnecting response cannot overwrite newer state.
 */
export function createHandoffMonitor({ transport, now = () => Date.now(), config = {} } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const state = { comments: new Map(), etags: new Map(), lastFullAt: null, maxUpdatedAt: null, needsFull: false, fingerprint: null };
  let committed = null; // { snapshot, generation, lastSuccessAt, seq }
  let attemptSeq = 0;
  let inflight = null;
  const meta = { lastAttemptAt: null, lastOutcome: null, failures: 0, backoffUntil: null, error: null, coverage: null, partial: null };

  async function refresh() {
    const seq = ++attemptSeq;
    const startedAt = now();
    meta.lastAttemptAt = startedAt;
    try {
      const result = await collectOnce(transport, state, { now: startedAt, config: cfg });
      if (committed && committed.seq > seq) return; // a newer refresh already committed
      const generation = (committed?.generation || 0) + (result.changed || !committed ? 1 : 0);
      const snapshot = result.changed || !committed
        ? projectHandoffs(result.comments, { observedAt: new Date(startedAt).toISOString(), pulls: result.pulls })
        : committed.snapshot;
      const complete = result.coverage.status === 'COMPLETE';
      committed = {
        snapshot,
        generation,
        seq,
        lastSuccessAt: complete ? startedAt : committed?.lastSuccessAt ?? null,
        confirmedUnchangedAt: result.changed ? null : startedAt,
      };
      meta.coverage = result.coverage;
      meta.lastOutcome = complete ? (result.changed ? 'UPDATED' : 'UNCHANGED') : 'PARTIAL';
      meta.error = complete ? null : result.coverage.reason;
      meta.failures = complete ? 0 : meta.failures + 1;
      meta.backoffUntil = complete ? null : startedAt + Math.min(cfg.backoffBaseMs * 2 ** (meta.failures - 1), cfg.backoffMaxMs);
      meta.partial = null;
    } catch (err) {
      meta.failures += 1;
      meta.lastOutcome = err?.code === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'FAILED';
      meta.error = `${err?.code || 'ERROR'}: ${redactCredentials(String(err?.message || err)).text}`;
      const backoff = startedAt + Math.min(cfg.backoffBaseMs * 2 ** (meta.failures - 1), cfg.backoffMaxMs);
      meta.backoffUntil = Math.max(backoff, Number.isFinite(err?.retryAt) ? err.retryAt : 0);
      // No last good snapshot: show what was read, labelled PARTIAL, with no success time.
      if (!committed && Array.isArray(err?.partial) && err.partial.length) {
        meta.partial = projectHandoffs(err.partial, { observedAt: new Date(startedAt).toISOString() });
      }
      meta.coverage = { status: 'FAILED', mode: null, pages: err?.pages ?? null, reason: meta.error };
    }
  }

  function freshness() {
    const t = now();
    if (!committed && !meta.partial) {
      const f = emptyFreshness(meta.lastAttemptAt ? 'NO_DATA' : 'NOT_YET_COLLECTED', meta.error);
      f.last_attempt_at = meta.lastAttemptAt ? new Date(meta.lastAttemptAt).toISOString() : null;
      f.last_attempt_outcome = meta.lastOutcome;
      f.backoff_until = meta.backoffUntil ? new Date(meta.backoffUntil).toISOString() : null;
      f.coverage = meta.coverage;
      f.error = meta.error;
      return f;
    }
    const lastSuccess = committed?.lastSuccessAt ?? null;
    const age = lastSuccess === null ? null : Math.max(0, Math.round((t - lastSuccess) / 1000));
    let status = 'FRESH';
    if (lastSuccess === null) status = 'PARTIAL';
    else if (t - lastSuccess > cfg.staleAfterMs) status = 'STALE';
    else if (meta.lastOutcome === 'FAILED' || meta.lastOutcome === 'PARTIAL') status = 'DEGRADED';
    return {
      status,
      detail: status === 'FRESH' ? null : meta.error,
      last_success_at: lastSuccess === null ? null : new Date(lastSuccess).toISOString(),
      last_attempt_at: meta.lastAttemptAt ? new Date(meta.lastAttemptAt).toISOString() : null,
      last_attempt_outcome: meta.lastOutcome,
      confirmed_unchanged_at: committed?.confirmedUnchangedAt ? new Date(committed.confirmedUnchangedAt).toISOString() : null,
      generation: committed?.generation ?? 0,
      stale_after_seconds: Math.round(cfg.staleAfterMs / 1000),
      snapshot_age_seconds: age,
      backoff_until: meta.backoffUntil && meta.backoffUntil > t ? new Date(meta.backoffUntil).toISOString() : null,
      coverage: meta.coverage,
      error: meta.error,
    };
  }

  return {
    config: cfg,
    /** @returns {Promise<{snapshot: object|null, freshness: object}>} */
    async read({ refresh: allowRefresh = true } = {}) {
      const t = now();
      const inBackoff = meta.backoffUntil !== null && t < meta.backoffUntil;
      const due = meta.lastAttemptAt === null || t - meta.lastAttemptAt >= cfg.minRefreshMs;
      if (allowRefresh && due && !inBackoff) {
        if (!inflight) inflight = refresh().finally(() => { inflight = null; });
        await inflight;
      } else if (inflight) {
        await inflight;
      }
      return { snapshot: committed?.snapshot ?? meta.partial ?? null, freshness: freshness() };
    },
    /** For tests: how many refreshes have started. */
    get attempts() {
      return attemptSeq;
    },
  };
}

export default { createHandoffMonitor, createGithubTransport, collectOnce, allowedRequest, DEFAULT_CONFIG };
