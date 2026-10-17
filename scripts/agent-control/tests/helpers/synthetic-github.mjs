/**
 * Preload for the auto-merge-admitted.mjs CLI tests (F9). Loaded with
 * `node --import` BEFORE the real CLI, it replaces global fetch.
 *
 * GLOBAL FETCH IS REPLACED: every response is an in-memory fixture. No
 * request is forwarded to the network, an unexpected request throws, and the
 * merge PUT is answered here, so no merge ever leaves this process.
 *
 * KF_SYNTHETIC_GITHUB  JSON scenario (see merge-cli.spec.mjs)
 * KF_SYNTHETIC_TRACE   file the request trace is written to on exit
 */
import fs from 'node:fs';

const scenario = JSON.parse(process.env.KF_SYNTHETIC_GITHUB || 'null');
if (!scenario) throw new Error('KF_SYNTHETIC_GITHUB is required; refusing to run the CLI without the fixture');

const root = `/repos/${scenario.repo}`;
const trace = [];
let snapshot = -1;

const ok = (data, status = 200) => ({ ok: true, status, statusText: 'OK', json: async () => data, text: async () => JSON.stringify(data) });
const missing = () => ({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}), text: async () => 'not found' });

/** One page of a list, as the CLI's apiAll() asks for it. */
function page(list, search) {
  const params = new URLSearchParams(search);
  const per = Number(params.get('per_page') || 30);
  const n = Number(params.get('page') || 1);
  return list.slice((n - 1) * per, n * per);
}

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const method = init.method || 'GET';
  const request = { method, path: u.pathname + u.search };
  trace.push(request);
  if (u.protocol !== 'https:' || u.hostname !== 'api.github.com' || !u.pathname.startsWith(root + '/')) {
    throw new Error(`synthetic fixture rejected ${method} ${url}; no network access`);
  }
  const path = u.pathname.slice(root.length);
  if (method === 'GET' && path === `/pulls/${scenario.pr.number}`) {
    snapshot += 1;
    const pr = scenario.pr_by_snapshot?.[snapshot] ?? scenario.pr;
    return ok({
      number: pr.number,
      state: pr.state,
      draft: pr.draft,
      title: 'synthetic',
      head: { sha: pr.head_sha, ref: pr.head_ref },
      base: { sha: pr.base_sha },
    });
  }
  const files = { '/contents/.agent-control/active-packet.yaml': scenario.active, '/contents/.agent-control/claude-return.yaml': scenario.ret };
  if (method === 'GET' && Object.hasOwn(files, path)) {
    return files[path] === null ? missing() : ok({ content: Buffer.from(files[path]).toString('base64') });
  }
  if (method === 'GET' && path.startsWith('/compare/')) {
    const answer = scenario.compare?.[path.slice('/compare/'.length)];
    return answer ? ok(answer) : missing();
  }
  if (method === 'GET' && path === '/actions/runs') return ok({ workflow_runs: scenario.runs });
  if (method === 'GET' && path === `/pulls/${scenario.pr.number}/reviews`) return ok(page(scenario.reviews, u.search));
  if (method === 'GET' && path === `/issues/${scenario.pr.number}/events`) return ok(page(scenario.events, u.search));
  if (method === 'GET' && path === '/issues/80/comments') {
    const comments = scenario.comments_by_snapshot[Math.min(Math.max(snapshot, 0), scenario.comments_by_snapshot.length - 1)];
    return ok(page(comments, u.search));
  }
  if (method === 'PUT' && path === `/pulls/${scenario.pr.number}/merge`) {
    request.body = JSON.parse(init.body);
    return ok({ merged: true, sha: 'e'.repeat(40), message: 'SYNTHETIC: answered in-process; no merge was sent' });
  }
  throw new Error(`synthetic fixture rejected unexpected ${method} ${u.pathname}; no network access`);
};

process.on('exit', () => {
  if (process.env.KF_SYNTHETIC_TRACE) fs.writeFileSync(process.env.KF_SYNTHETIC_TRACE, JSON.stringify(trace, null, 2));
});
