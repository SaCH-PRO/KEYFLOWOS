/**
 * Stale-gate detection proofs (lib/stale-gates.mjs).
 *
 * A merge to main that changes a non-control file breaks the Agent Control
 * Gate of every open impl/ PR, and nothing says so: each PR keeps showing the
 * run it got before main moved. The detector must find those, must not call a
 * current PR stale, must never report a PR it could not read as fine, and
 * must never offer a repair that skips the fresh review a new head owes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { assessGate, gatherGateFacts, reportStaleGates, STALE_REASONS, REPAIR, COMPARE_FILE_LIMIT } from '../lib/stale-gates.mjs';

const MAIN = { sha: 'm'.repeat(40).replace(/m/g, 'a'), committed_at: '2026-10-11T16:13:07Z' };
const HEAD = 'b'.repeat(40);

/** A PR whose gate is current: at main, artifacts name main, a green run after main's tip. */
function current(over = {}) {
  return {
    pr: { number: 155, head_ref: 'impl/x', head_sha: HEAD, base_sha: MAIN.sha, draft: true, mergeable: true },
    main: MAIN,
    compare: { behind_by: 0, files: [], truncated: false },
    artifacts: { active_source_main: MAIN.sha, return_source_main: MAIN.sha, source_head: HEAD },
    gate_run: { conclusion: 'success', status: 'completed', created_at: '2026-10-11T17:00:00Z', head_sha: HEAD },
    ...over,
  };
}
const behind = (files, n = 1) => ({ behind_by: n, files, truncated: false });

test('a PR at main with current artifacts and a run after main moved is not stale', () => {
  const a = assessGate(current());
  assert.equal(a.stale, false);
  assert.equal(a.gate_would_fail_now, false);
  assert.equal(a.repair, null);
  assert.deepEqual(a.reasons, []);
});

test('behind main by a non-control file: the gate would fail, whatever colour its last run shows', () => {
  const a = assessGate(current({
    compare: behind(['scripts/agent-control/lib/authority-effects.mjs', '.agent-control/claude-return.yaml']),
    gate_run: { conclusion: 'success', status: 'completed', created_at: '2026-10-06T18:01:00Z', head_sha: HEAD },
  }));
  assert.equal(a.stale, true);
  assert.equal(a.gate_would_fail_now, true);
  assert.equal(a.non_control_files_behind, 1);
  assert.ok(a.reasons.includes(STALE_REASONS.BEHIND_MAIN));
  assert.ok(a.reasons.includes(STALE_REASONS.GATE_RUN_PREDATES_MAIN));
  assert.equal(a.misleading_green, true, 'green, from before main moved, on a gate that would now fail');
});

test('behind main only under .agent-control/ does not break the gate\'s control-only rule', () => {
  const a = assessGate(current({ compare: behind(['.agent-control/active-packet.yaml', '.agent-control/claude-return.yaml']) }));
  assert.ok(!a.reasons.includes(STALE_REASONS.BEHIND_MAIN));
  assert.equal(a.gate_would_fail_now, false);
});

test('a file list cut at the API limit cannot prove the difference is control-only', () => {
  const files = Array.from({ length: COMPARE_FILE_LIMIT }, (_, i) => `.agent-control/f${i}`);
  const a = assessGate(current({ compare: { behind_by: 40, files, truncated: true } }));
  assert.ok(a.reasons.includes(STALE_REASONS.BEHIND_MAIN));
  assert.equal(a.compare_truncated, true);
});

test('artifacts naming an older base: fine while a draft, a failure once marked ready', () => {
  const stale = { active_source_main: 'c'.repeat(40), return_source_main: 'c'.repeat(40), source_head: HEAD };
  const draft = assessGate(current({ artifacts: stale }));
  assert.deepEqual(draft.reasons, [STALE_REASONS.SOURCE_MAIN_NOT_BASE]);
  assert.equal(draft.gate_would_fail_now, false);
  assert.equal(draft.fails_when_marked_ready, true);

  const ready = assessGate(current({ artifacts: stale, pr: { ...current().pr, draft: false } }));
  assert.equal(ready.gate_would_fail_now, true);

  const oneOnly = assessGate(current({ artifacts: { ...stale, active_source_main: MAIN.sha } }));
  assert.ok(oneOnly.reasons.includes(STALE_REASONS.SOURCE_MAIN_NOT_BASE), 'both artifacts must name the base');
});

test('a conflict with main, or missing artifacts, would fail the gate', () => {
  const conflict = assessGate(current({ pr: { ...current().pr, mergeable: false } }));
  assert.deepEqual(conflict.reasons, [STALE_REASONS.CONFLICTING]);
  assert.equal(conflict.gate_would_fail_now, true);

  const missing = assessGate(current({ artifacts: null }));
  assert.deepEqual(missing.reasons, [STALE_REASONS.ARTIFACTS_MISSING]);
  assert.equal(missing.gate_would_fail_now, true);

  // mergeable null means GitHub has not computed it yet: unknown is not a conflict.
  assert.deepEqual(assessGate(current({ pr: { ...current().pr, mergeable: null } })).reasons, []);
});

test('a red run that predates main is stale but not "misleading green"', () => {
  const a = assessGate(current({ compare: behind(['apps/server/x.ts']), gate_run: { conclusion: 'failure', created_at: '2026-10-06T18:01:00Z' } }));
  assert.equal(a.misleading_green, false);
  assert.equal(a.stale, true);
});

test('the only repair it names keeps the fresh review, and it never repairs', () => {
  const a = assessGate(current({ compare: behind(['apps/server/x.ts']) }));
  assert.equal(a.repair, REPAIR);
  assert.match(REPAIR, /no rebase, no force push/);
  assert.match(REPAIR, /FRESH independent semantic review of the new head is then owed/);
});

// ------------------------------------------------------- reading the facts

const yaml = (obj) => Buffer.from(Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n').toString('base64');

/** A fake `gh`: answers by API path, records every call, and can be told to fail one. */
function fakeGh({ prs, compare = {}, artifacts = {}, runs = {}, failOn = null }) {
  const calls = [];
  const run = (args) => {
    calls.push(args.join(' '));
    const target = args[args.length - 1];
    if (failOn && target.includes(failOn)) { const e = new Error('gh failed'); e.stderr = 'gh: Server Error (HTTP 502)'; throw e; }
    if (target === 'repos/o/r/commits/main') return JSON.stringify({ sha: MAIN.sha, commit: { committer: { date: MAIN.committed_at } } });
    if (target.startsWith('repos/o/r/pulls?')) return JSON.stringify([prs]);
    const single = target.match(/^repos\/o\/r\/pulls\/(\d+)$/);
    if (single) return JSON.stringify(prs.find((p) => p.number === Number(single[1])));
    const cmp = target.match(/^repos\/o\/r\/compare\/([0-9a-f]+)\.\.\./);
    if (cmp) return JSON.stringify(compare[cmp[1]] || { ahead_by: 0, files: [] });
    const content = target.match(/^repos\/o\/r\/contents\/\.agent-control\/([a-z-]+\.yaml)\?ref=([0-9a-f]+)$/);
    if (content) {
      const doc = artifacts[content[2]];
      if (!doc) { const e = new Error('not found'); e.stderr = 'gh: Not Found (HTTP 404)'; throw e; }
      return JSON.stringify({ content: yaml(doc[content[1]]) });
    }
    const runsFor = target.match(/^repos\/o\/r\/actions\/runs\?head_sha=([0-9a-f]+)/);
    if (runsFor) return JSON.stringify({ workflow_runs: runs[runsFor[1]] || [] });
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return { run, calls };
}
const pr = (number, ref, sha, extra = {}) => ({ number, draft: true, mergeable: true, head: { ref, sha, repo: { full_name: 'o/r' } }, base: { sha: MAIN.sha }, ...extra });
const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);

test('report: finds the stale impl PR, leaves the current one, ignores other branches and forks', () => {
  const gh = fakeGh({
    prs: [
      pr(155, 'impl/stale', SHA1),
      pr(168, 'impl/current', SHA2),
      pr(170, 'fix/not-impl', '3'.repeat(40)),
      pr(999, 'impl/fork', '4'.repeat(40), { head: { ref: 'impl/fork', sha: '4'.repeat(40), repo: { full_name: 'someone/r' } } }),
    ],
    compare: { [SHA1]: { ahead_by: 5, files: [{ filename: 'scripts/agent-control/claude-worker.ps1' }] } },
    artifacts: {
      [SHA1]: { 'active-packet.yaml': { source_main: 'c'.repeat(40) }, 'claude-return.yaml': { source_main: 'c'.repeat(40), source_head: SHA1 } },
      [SHA2]: { 'active-packet.yaml': { source_main: MAIN.sha }, 'claude-return.yaml': { source_main: MAIN.sha, source_head: SHA2 } },
    },
    runs: {
      [SHA1]: [{ name: 'Agent Control Gate', conclusion: 'success', status: 'completed', created_at: '2026-10-06T18:01:00Z', head_sha: SHA1 }, { name: 'CI/CD Pipeline', conclusion: 'failure', created_at: '2026-10-11T17:00:00Z' }],
      [SHA2]: [{ name: 'Agent Control Gate', conclusion: 'success', status: 'completed', created_at: '2026-10-11T17:00:00Z', head_sha: SHA2 }],
    },
  });
  const report = reportStaleGates('o/r', gh.run);
  assert.equal(report.open_total, 4);
  assert.equal(report.impl_total, 2);
  assert.deepEqual(report.stale, [155]);
  assert.deepEqual(report.misleading_green, [155]);
  assert.equal(report.prs.find((p) => p.number === 168).stale, false);
  assert.ok(gh.calls.every((c) => c.startsWith('api ')), 'only gh api reads');
  assert.ok(!gh.calls.some((c) => /-X|--method|-f |--field/.test(c)), 'no call that could write');
});

test('report: the newest gate run decides, not an older one', () => {
  const gh = fakeGh({
    prs: [pr(155, 'impl/x', SHA1)],
    compare: { [SHA1]: { ahead_by: 1, files: [{ filename: 'apps/server/x.ts' }] } },
    artifacts: { [SHA1]: { 'active-packet.yaml': { source_main: MAIN.sha }, 'claude-return.yaml': { source_main: MAIN.sha, source_head: SHA1 } } },
    runs: { [SHA1]: [
      { name: 'Agent Control Gate', conclusion: 'success', created_at: '2026-10-06T18:01:00Z' },
      { name: 'Agent Control Gate', conclusion: 'failure', created_at: '2026-10-11T17:30:00Z' },
    ] },
  });
  const p = reportStaleGates('o/r', gh.run).prs[0];
  assert.equal(p.last_gate_run.conclusion, 'failure');
  assert.equal(p.misleading_green, false, 'the gate already re-ran after main moved and says so itself');
});

test('report: missing artifacts are a finding; any other failed read fails the whole report', () => {
  const base = { prs: [pr(155, 'impl/x', SHA1)], compare: {}, runs: {} };
  const missing = reportStaleGates('o/r', fakeGh({ ...base, artifacts: {} }).run);
  assert.deepEqual(missing.prs[0].reasons, [STALE_REASONS.ARTIFACTS_MISSING]);

  for (const failOn of ['commits/main', 'pulls?', 'pulls/155', 'compare/', 'contents/', 'actions/runs']) {
    const gh = fakeGh({ ...base, artifacts: { [SHA1]: { 'active-packet.yaml': { source_main: MAIN.sha }, 'claude-return.yaml': { source_main: MAIN.sha } } }, failOn });
    assert.throws(() => reportStaleGates('o/r', gh.run), /gh failed/, `a failed read of ${failOn} must not yield a report`);
  }
});

test('gatherGateFacts reads head...main, so "behind" counts what main has and the branch lacks', () => {
  const gh = fakeGh({ prs: [pr(155, 'impl/x', SHA1)], compare: { [SHA1]: { ahead_by: 3, behind_by: 9, files: [] } }, artifacts: {}, runs: {} });
  const { facts } = gatherGateFacts('o/r', gh.run);
  assert.equal(facts[0].compare.behind_by, 3);
  assert.ok(gh.calls.includes(`api repos/o/r/compare/${SHA1}...${MAIN.sha}`));
});
