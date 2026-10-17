/**
 * The real auto-merge-admitted.mjs CLI, collector and recheck included, under
 * a synthetic GitHub (helpers/synthetic-github.mjs). F9; CG-DIR-F9-001.
 *
 * Every network effect is replaced: the preload answers each request from
 * the scenario below, throws on anything else, and answers the merge PUT
 * itself. The child gets a synthetic token and none of this process's
 * environment, so no real credential can reach it.
 *
 * KF_CLI_ROOT runs the same cases against another checkout (for the F9
 * reproduction on unrepaired main); by default it is this repository.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REQUIRED_WORKFLOWS } from '../lib/events.mjs';
import { REPO, HEAD, BASE, SEMANTIC, target, grantComment, followUp, claudeNote } from './helpers/merge-grant-fixture.mjs';

const ROOT = path.resolve(process.env.KF_CLI_ROOT || '.');
const CLI = path.join(ROOT, 'scripts/agent-control/auto-merge-admitted.mjs');
const PRELOAD = pathToFileURL(path.resolve('scripts/agent-control/tests/helpers/synthetic-github.mjs')).href;
const REVIEW_URL = `https://github.com/${REPO}/pull/87#pullrequestreview-1`;

const common = `packet_id: KF-X-001\nimplementation_branch: impl/x\npr_number: 87\nsource_main: ${BASE}\nproduction_touched: false\nmerge_authority: false\n`;
const ret = (status) => common + [
  `source_head: ${SEMANTIC}`,
  `review_status: ${status}`,
  'state: PROVING',
  'scope_changed: false',
  'tests:',
  '  failed: 0',
  '  skipped: 0',
  'semantic_review:',
  '  implementer: claude',
  '  reviews:',
  '    - provider: copilot',
  '      reviewer: copilot-pull-request-reviewer[bot]',
  `      reviewed_head: ${HEAD}`,
  '      outcome: PASS',
  '      reason: null',
  '      unresolved_substantive_findings: []',
  '      dispositioned_findings: []',
  `      evidence_location: ${REVIEW_URL}`,
  '',
].join('\n');

const pr = { number: 87, state: 'open', draft: false, head_sha: HEAD, base_sha: BASE, head_ref: 'impl/x' };

/** A scenario that is eligible in every respect but the grant, which is the variable. */
const scenario = (comments_by_snapshot, overrides = {}) => ({
  repo: REPO,
  pr,
  active: common,
  ret: ret('ACCEPT_FOR_ADMISSION'),
  compare: { [`${SEMANTIC}...${HEAD}`]: { status: 'ahead', files: [{ filename: '.agent-control/claude-return.yaml' }] } },
  runs: REQUIRED_WORKFLOWS.map((name, i) => ({ id: 100 + i, name, head_sha: HEAD, status: 'completed', conclusion: 'success', created_at: '2026-10-17T00:00:00Z' })),
  reviews: [{ user: { login: 'copilot-pull-request-reviewer[bot]', type: 'Bot' }, body: '**Findings:** 0', commit_id: HEAD, html_url: REVIEW_URL }],
  events: [],
  comments_by_snapshot,
  ...overrides,
});

function run(s, args, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-merge-cli-'));
  const tracePath = path.join(dir, 'trace.json');
  const child = spawnSync(process.execPath, ['--import', PRELOAD, CLI, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    // Only what Node needs to start; nothing of this process's credentials.
    env: {
      SystemRoot: process.env.SystemRoot,
      PATH: process.env.PATH,
      GITHUB_TOKEN: 'synthetic-token-not-a-credential',
      GITHUB_REPOSITORY: REPO,
      PR_NUMBER: '87',
      KF_SYNTHETIC_GITHUB: JSON.stringify(s),
      KF_SYNTHETIC_TRACE: tracePath,
      ...env,
    },
  });
  const trace = fs.existsSync(tracePath) ? JSON.parse(fs.readFileSync(tracePath, 'utf8')) : null;
  fs.rmSync(dir, { recursive: true, force: true });
  let out = null;
  try { out = JSON.parse(child.stdout); } catch { /* reported below */ }
  return { code: child.status, out, stdout: child.stdout, stderr: child.stderr, trace };
}

const puts = (r) => r.trace.filter((q) => q.method === 'PUT');
const commentReads = (r) => r.trace.filter((q) => q.method === 'GET' && q.path.startsWith(`/repos/${REPO}/issues/80/comments`));

test('NC CLI F9: ACCEPT_FOR_ADMISSION, false artifact grants and a passing review make two snapshots and NO merge call', () => {
  const r = run(scenario([[claudeNote('RETURN')], [claudeNote('RETURN')]]), ['--merge']);
  assert.ok(r.trace, r.stderr);
  assert.equal(puts(r).length, 0, `no merge call without a grant: ${JSON.stringify(puts(r))}`);
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.eligible, false);
  assert.equal(r.out.reason, 'merge_grant_not_satisfied');
  assert.equal(r.out.detail.reason, 'merge_grant_absent');
  assert.ok(commentReads(r).length >= 1, 'the collector must read #80');
});

test('CLI referent: a valid exact-head grant in both snapshots makes exactly one SHA-pinned (synthetic) merge call', () => {
  const g = grantComment();
  const r = run(scenario([[g], [g]]), ['--merge']);
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.equal(r.out.eligible, true);
  assert.equal(r.out.merge_grant.comment_id, g.id);
  assert.equal(puts(r).length, 1);
  assert.deepEqual(puts(r)[0].body.sha, HEAD);
  // Two complete snapshots, each with its own read of #80, before the PUT.
  const prReads = r.trace.map((q, i) => [q, i]).filter(([q]) => q.method === 'GET' && q.path === `/repos/${REPO}/pulls/87`);
  assert.equal(prReads.length, 2);
  assert.equal(commentReads(r).length, 2);
  const putAt = r.trace.findIndex((q) => q.method === 'PUT');
  assert.ok(r.trace.findLastIndex((q) => q.path.startsWith(`/repos/${REPO}/issues/80/comments`)) < putAt);
});

test('NC CLI recheck: a grant revoked between the snapshots stops the merge call', () => {
  const g = grantComment();
  const r = run(scenario([[g], [g, followUp()]]), ['--merge']);
  assert.equal(puts(r).length, 0);
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.reason, 'merge_grant_not_satisfied');
  assert.equal(r.out.detail.reason, 'merge_grant_superseded');
  assert.equal(commentReads(r).length, 2, 'the revocation is seen by the second snapshot');
});

test('NC CLI recheck: a grant replaced between the snapshots stops the merge call', () => {
  const r = run(scenario([[grantComment()], [grantComment()]]), ['--merge']);
  assert.equal(puts(r).length, 0);
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.reason, 'merge_grant_changed_before_merge');
});

test('NC CLI recheck: a base that moved between the snapshots stops the merge call even with a grant', () => {
  const g = grantComment();
  const moved = { ...pr, base_sha: 'd'.repeat(40) };
  const r = run(scenario([[g], [g]], { pr_by_snapshot: [pr, moved] }), ['--merge']);
  assert.equal(puts(r).length, 0);
  assert.equal(r.code, 3);
  assert.equal(r.out.eligible, false);
});

test('CLI --grant-only: the gate check reads the PR, artifacts and #80, never the workflow runs, and never merges', () => {
  const g = grantComment();
  const r = run(scenario([[g]]), ['--grant-only'], { EXPECTED_HEAD_SHA: HEAD, EXPECTED_BASE_SHA: BASE });
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.equal(r.out.mode, 'grant-only');
  assert.equal(r.out.merge_grant.comment_id, g.id);
  assert.equal(puts(r).length, 0);
  assert.equal(r.trace.filter((q) => q.path.includes('/actions/runs')).length, 0, 'the gate must not wait for its own run');
});

test('NC CLI --grant-only: no grant, an ACCEPT_FOR_ADMISSION-only review, or a PR that moved since the event fails the gate', () => {
  const none = run(scenario([[claudeNote('RETURN')]]), ['--grant-only']);
  assert.equal(none.code, 3);
  assert.equal(none.out.detail.reason, 'merge_grant_absent');
  const accepted = run(scenario([[grantComment({ review_status: 'ACCEPT_FOR_ADMISSION', merge_authority: 'false' })]]), ['--grant-only']);
  assert.equal(accepted.code, 3);
  assert.equal(accepted.out.detail.reason, 'merge_grant_not_a_grant');
  const moved = run(scenario([[grantComment()]]), ['--grant-only'], { EXPECTED_HEAD_SHA: 'd'.repeat(40) });
  assert.equal(moved.code, 3);
  assert.equal(moved.out.reason, 'pr_moved_since_event');
  for (const r of [none, accepted, moved]) assert.equal(puts(r).length, 0);
});

test('CLI: --merge with --grant-only is refused before any request', () => {
  const r = run(scenario([[grantComment()]]), ['--merge', '--grant-only']);
  assert.equal(r.code, 2);
  assert.equal((r.trace || []).length, 0);
});

test('NC CLI: the #80 read follows pagination, so a grant on a later page is found and a revocation there is not missed', () => {
  const g = grantComment();
  const filler = Array.from({ length: 150 }, () => claudeNote('PROGRESS'));
  const granted = run(scenario([[...filler, g], [...filler, g]]), ['--merge']);
  assert.equal(granted.code, 0, granted.stderr || granted.stdout);
  assert.ok(commentReads(granted).length >= 4, 'two pages per snapshot');
  const revoked = run(scenario([[g, ...filler, followUp()], [g, ...filler, followUp()]]), ['--merge']);
  assert.equal(revoked.code, 3);
  assert.equal(revoked.out.detail.reason, 'merge_grant_superseded');
  assert.equal(puts(revoked).length, 0);
});

test('target() in the fixture is the PR this scenario serves', () => {
  assert.deepEqual(target(), { repository: REPO, pr_number: pr.number, packet_id: 'KF-X-001', implementation_branch: pr.head_ref, source_head: SEMANTIC, pr_head: HEAD, base_sha: BASE });
});
