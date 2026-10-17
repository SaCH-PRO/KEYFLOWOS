/**
 * A fixture GitHub for the handoff collector: the same REST shapes, Link
 * pagination, `since` filtering and ETags as the live API, served from memory.
 * Used by the tests, the CLI's --fixture mode and the loopback UI proof. It
 * enforces the collector's request allowlist, so a fixture run proves the same
 * request discipline as a live one, and it records every request it serves.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { GITHUB_API_ORIGIN, allowedRequest } from './handoff-collector.mjs';

/**
 * @param {object} data {issue: {comments}, comments: [...], pulls: {<n>: {...}}}
 * @param {object} [options]
 *   pageSize   comments per page (default 100, as the collector asks)
 *   fail       (target, callIndex) => null | {status, headers} | Error  scripted failure
 */
export function createFixtureTransport(data, { pageSize = 100, fail = null } = {}) {
  const requests = [];
  const dataset = {
    comments: [...(data.comments || [])],
    pulls: { ...(data.pulls || {}) },
    issueCount: data.issue?.comments,
  };
  const etagOf = (value) => `"${crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex')}"`;

  const transport = {
    requests,
    dataset,
    async get(target, { etag, method = 'GET' } = {}) {
      requests.push({ method, target });
      if (method !== 'GET') throw new Error(`fixture transport refuses ${method}`);
      const pathAndQuery = allowedRequest(target);
      const scripted = fail ? fail(pathAndQuery, requests.length - 1) : null;
      if (scripted instanceof Error) throw scripted;
      if (scripted) return { status: scripted.status, headers: { ...scripted.headers }, json: null };

      const url = new URL(pathAndQuery, GITHUB_API_ORIGIN);
      let body;
      let link = null;
      if (/\/issues\/\d+$/.test(url.pathname)) {
        body = { number: 80, comments: dataset.issueCount ?? dataset.comments.length };
      } else if (/\/comments$/.test(url.pathname)) {
        const since = url.searchParams.get('since');
        const list = dataset.comments
          .filter((c) => !since || String(c.updated_at || c.created_at) >= since)
          .sort((a, b) => a.id - b.id);
        const page = Number(url.searchParams.get('page') || 1);
        body = list.slice((page - 1) * pageSize, page * pageSize);
        if (page * pageSize < list.length) {
          url.searchParams.set('page', String(page + 1));
          link = `<${GITHUB_API_ORIGIN}${url.pathname}${url.search}>; rel="next"`;
        }
      } else {
        const n = url.pathname.split('/').pop();
        body = dataset.pulls[n];
        if (!body) return { status: 404, headers: {}, json: null };
      }
      const tag = etagOf(body);
      if (etag && etag === tag) return { status: 304, headers: { etag: tag, link }, json: null };
      return { status: 200, headers: { etag: tag, link }, json: JSON.parse(JSON.stringify(body)) };
    },
  };
  return transport;
}

/** Load a fixture file: {issue, comments, pulls}. */
export function loadFixture(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data.comments)) throw new Error(`${file}: fixture has no comments list`);
  return data;
}

export default { createFixtureTransport, loadFixture };
