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
import {
  REPO, HEAD, BASE, SEMANTIC, target, grantComment, followUp, holdComment, claudeNote, directiveComment, realPlanComment,
} from './helpers/merge-grant-fixture.mjs';

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
  const scenarioPath = path.join(dir, 'scenario.json');
  fs.writeFileSync(scenarioPath, JSON.stringify(s));
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
      KF_SYNTHETIC_GITHUB_FILE: scenarioPath,
      KF_SYNTHETIC_TRACE: tracePath,
      ...env,
    },
  });
  // A child that never started is a harness failure, never a denial.
  if (child.error) throw child.error;
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
  // Seen only by the second snapshot, on its second page.
  const revokedOnRecheck = run(scenario([[...filler, g], [...filler, g, followUp()]]), ['--merge']);
  assert.equal(revokedOnRecheck.code, 3);
  assert.equal(revokedOnRecheck.out.detail.reason, 'merge_grant_superseded');
  assert.equal(puts(revokedOnRecheck).length, 0);
  assert.equal(commentReads(revokedOnRecheck).length, 4, 'two pages in each snapshot');
});

// PR 181 review 5560243413 P1, through the real CLI: an envelope-valid RESUME
// whose effect is not a valid HOLD_CLEAR must leave the target held.
const invalidReleases = [
  ['missing effect', (b) => b.replace('control_effect: HOLD_CLEAR\n', '')],
  ['wrong effect', (b) => b.replace('control_effect: HOLD_CLEAR', 'control_effect: NO_STATE_CHANGE')],
  ['unknown effect', (b) => b.replace('control_effect: HOLD_CLEAR', 'control_effect: RELEASE_ALL')],
  ['production touched', (b) => b.replace('production_touched: false', 'production_touched: true')],
  ['invalid health', (b) => b.replace('health: YELLOW', 'health: AMBER')],
  ['programme field', (b) => b.replace('control_effect: HOLD_CLEAR\n', 'control_effect: HOLD_CLEAR\nprogramme_action: ACTIVATE\n')],
  ['hold effect on a RESUME', (b) => b.replace('control_effect: HOLD_CLEAR', 'control_effect: HOLD_SET')],
  ['production untouched not stated', (b) => b.replace('production_touched: false', 'production_touched: null')],
];

for (const [name, change] of invalidReleases) {
  test(`NC CLI hold release: ${name} cannot clear an active hold before an exact grant`, () => {
    // In #80 order: the HOLD, then the RESUME, then the grant. Each fixture
    // call is newer than the last, so they are made in that order; a RESUME
    // made first would be older than the HOLD and prove nothing.
    const hold = holdComment('HOLD', 'KF-X-001');
    const resume = holdComment('RESUME', 'KF-X-001');
    resume.body = change(resume.body);
    const comments = [hold, resume, grantComment()];
    assert.ok(Date.parse(hold.created_at) < Date.parse(resume.created_at), 'the RESUME follows the HOLD');
    const r = run(scenario([comments, comments]), ['--merge']);
    assert.ok(r.trace, r.stderr);
    assert.equal(puts(r).length, 0, 'an invalid release must leave the target hold active');
    assert.equal(r.code, 3);
    assert.equal(r.out.detail.reason, 'merge_grant_target_held');
    const gate = run(scenario([comments]), ['--grant-only']);
    assert.equal(gate.code, 3);
    assert.equal(gate.out.detail.reason, 'merge_grant_target_held');
    assert.equal(puts(gate).length, 0);
  });
}

test('CLI hold release referent: a valid HOLD_CLEAR then an exact grant gives both snapshots and one SHA-pinned synthetic merge', () => {
  const comments = [holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001'), grantComment()];
  const r = run(scenario([comments, comments]), ['--merge']);
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.equal(puts(r).length, 1);
  assert.equal(puts(r)[0].body.sha, HEAD);
  assert.equal(commentReads(r).length, 2);
});

test('CLI hold release isolation: an invalid release for another packet does not block this exact grant', () => {
  const hold = holdComment('HOLD', 'KF-OTHER-001');
  const resume = holdComment('RESUME', 'KF-OTHER-001');
  resume.body = resume.body.replace('control_effect: HOLD_CLEAR', 'control_effect: NO_STATE_CHANGE');
  const comments = [hold, resume, grantComment()];
  const r = run(scenario([comments, comments]), ['--merge']);
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.equal(puts(r).length, 1);
});

// A valid HOLD_CLEAR releases only its own packet's hold, and only a hold that
// came before it; the merge call stays at zero otherwise (both modes).
function assertHeldThroughCli(comments) {
  const r = run(scenario([comments, comments]), ['--merge']);
  assert.ok(r.trace, r.stderr);
  assert.equal(puts(r).length, 0, 'the target hold must stay active: no merge call');
  assert.equal(r.code, 3);
  assert.equal(r.out.detail.reason, 'merge_grant_target_held');
  const gate = run(scenario([comments]), ['--grant-only']);
  assert.equal(gate.code, 3);
  assert.equal(gate.out.detail.reason, 'merge_grant_target_held');
  assert.equal(puts(gate).length, 0);
}

test('NC CLI hold release binding: a valid HOLD_CLEAR for another packet leaves the target held and makes no merge call', () => {
  const hold = holdComment('HOLD', 'KF-X-001');
  const elsewhere = holdComment('RESUME', 'KF-OTHER-001');
  assert.ok(Date.parse(hold.created_at) < Date.parse(elsewhere.created_at), 'the RESUME follows the HOLD');
  assertHeldThroughCli([hold, elsewhere, grantComment()]);
  // ...even when that release names the target's PR and branch.
  const held = holdComment('HOLD', 'KF-X-001');
  const byReference = holdComment('RESUME', 'KF-OTHER-001', {}, { pr_number: 87, implementation_branch: 'impl/x' });
  assertHeldThroughCli([held, byReference, grantComment()]);
});

/** The CLI denies with `reason` in both modes and makes no merge call. */
function assertDeniedThroughCli(comments, reason) {
  const r = run(scenario([comments, comments]), ['--merge']);
  assert.ok(r.trace, r.stderr);
  assert.equal(puts(r).length, 0, `no merge call: ${reason}`);
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.detail.reason, reason);
  const gate = run(scenario([comments]), ['--grant-only']);
  assert.equal(gate.code, 3, gate.stderr);
  assert.equal(gate.out.detail.reason, reason);
  assert.equal(puts(gate).length, 0);
  return r;
}

/** The CLI grants in both modes and makes exactly one SHA-pinned synthetic merge call. */
function assertMergedThroughCli(comments) {
  const r = run(scenario([comments, comments]), ['--merge']);
  assert.equal(r.code, 0, r.stderr || r.stdout);
  assert.equal(puts(r).length, 1);
  assert.equal(puts(r)[0].body.sha, HEAD);
  const gate = run(scenario([comments]), ['--grant-only']);
  assert.equal(gate.code, 0, gate.stderr || gate.stdout);
  assert.equal(puts(gate).length, 0);
}

// CG-REV-F9-003 (F9-H1): a malformed HOLD on the target before the grant holds
// it through the real CLI. Each case is built in #80 order.
test('NC CLI malformed hold: a malformed target HOLD before an exact grant makes no merge call in either mode', () => {
  for (const fields of [{ scope_changed: undefined }, { message_type: ['REVIEW', 'HOLD'] }]) {
    const hold = holdComment('HOLD', 'KF-X-001', {}, fields);
    const r = assertDeniedThroughCli([hold, grantComment()], 'merge_grant_target_held');
    assert.equal(r.out.detail.detail.comment_id, hold.id, JSON.stringify(fields));
  }
  // A claim with no packet holds within the target's lifetime (CG-REV-F9-004, A1).
  const directive = directiveComment();
  const packetless = holdComment('HOLD', 'KF-X-001', {}, { packet_id: undefined, scope_changed: undefined });
  const r = assertDeniedThroughCli([directive, packetless, grantComment()], 'merge_grant_target_held');
  assert.equal(r.out.detail.detail.comment_id, packetless.id);
});

// COV-HOLD-01: an envelope-valid HOLD whose effect readEffect() rejects still holds.
test('NC CLI hold effect: an envelope-valid HOLD with no readable effect makes no merge call in either mode', () => {
  const hold = holdComment('HOLD', 'KF-X-001');
  hold.body = hold.body.replace('control_effect: HOLD_SET\n', '');
  const r = assertDeniedThroughCli([hold, grantComment()], 'merge_grant_target_held');
  assert.equal(r.out.detail.detail.comment_id, hold.id);
  assert.equal(r.out.detail.detail.malformed, false);
});

// CG-REV-F9-004 (A1), through the real CLI. Each case is built in #80 order.
test('NC CLI real history (A1): PLAN 5826799265 older than the target merges once; the same envelope after the floor makes no merge call', () => {
  assertMergedThroughCli([
    realPlanComment(),
    directiveComment({ message_id: 'CG-DIRECTIVE-SYNTHETIC-OTHER', packet_id: 'KF-OTHER-001', pr_number: 41, implementation_branch: 'impl/other' }),
    directiveComment(),
    grantComment(),
  ]);
  const directive = directiveComment();
  const late = realPlanComment({ id: undefined, created_at: undefined });
  const r = assertDeniedThroughCli([directive, late, grantComment()], 'merge_grant_target_held');
  assert.equal(r.out.detail.detail.comment_id, late.id);
});

test('NC CLI lifetime floor (A1): only packet-less claims older than the floor are out of scope; named, lifetime and unreleased claims make no merge call', () => {
  const packetless = () => holdComment('HOLD', 'KF-X-001', {}, { packet_id: undefined, scope_changed: undefined });
  // (a) older than the floor: merges once.
  assertMergedThroughCli([packetless(), directiveComment(), grantComment()]);
  // (b) at or after the floor, before the grant: held.
  assertDeniedThroughCli([directiveComment(), packetless(), grantComment()], 'merge_grant_target_held');
  // (c) older than the floor but naming the target PR or branch: held.
  for (const fields of [{ pr_number: 87 }, { implementation_branch: 'impl/x' }]) {
    assertDeniedThroughCli([holdComment('HOLD', 'KF-X-001', {}, { packet_id: undefined, ...fields }), directiveComment(), grantComment()], 'merge_grant_target_held');
  }
  // (d) an unrelated readable-packet HOLD: merges once.
  assertMergedThroughCli([directiveComment(), holdComment('HOLD', 'KF-OTHER-001', {}, { scope_changed: undefined }), grantComment()]);
  // (e) another packet's release leaves it held; the target's own release merges once.
  assertDeniedThroughCli([directiveComment(), packetless(), holdComment('RESUME', 'KF-OTHER-001'), grantComment()], 'merge_grant_target_held');
  assertMergedThroughCli([directiveComment(), packetless(), holdComment('RESUME', 'KF-X-001'), grantComment()]);
});

test('NC CLI recheck (A1): a packet-less claim posted between the snapshots stops the merge call', () => {
  const directive = directiveComment();
  const g = grantComment();
  const r = run(scenario([[directive, g], [directive, g, realPlanComment({ id: undefined, created_at: undefined })]]), ['--merge']);
  assert.ok(r.trace, r.stderr);
  assert.equal(puts(r).length, 0);
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.reason, 'merge_grant_not_satisfied');
  assert.equal(r.out.detail.reason, 'merge_grant_ambiguous_authority');
  assert.equal(commentReads(r).length, 2, 'the claim is seen by the second snapshot');
});

test('CLI malformed hold referent: a malformed target HOLD, then a valid HOLD_CLEAR, then an exact grant merges once', () => {
  assertMergedThroughCli([holdComment('HOLD', 'KF-X-001', {}, { scope_changed: undefined }), holdComment('RESUME', 'KF-X-001'), grantComment()]);
});

test('NC CLI hold duplicate: HOLD, HOLD, RESUME and an exact grant makes no merge call in either mode', () => {
  const comments = [holdComment('HOLD', 'KF-X-001'), holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001'), grantComment()];
  assertDeniedThroughCli(comments, 'merge_grant_hold_duplicate');
});

test('CLI hold duplicate referent: HOLD, HOLD_CLEAR, HOLD, HOLD_CLEAR and an exact grant merges once', () => {
  assertMergedThroughCli([holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001'), holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001'), grantComment()]);
});

// CG-REV-F9-003 Q3, through the real CLI: a HOLD under another packet that
// names the target's PR or branch holds it until its own packet's release.
for (const [identity, fields] of [['PR', { pr_number: 87 }], ['branch', { implementation_branch: 'impl/x' }]]) {
  test(`NC CLI hold by ${identity}: a HOLD under another packet naming the target ${identity} makes no merge call; its own release merges once`, () => {
    assertDeniedThroughCli([holdComment('HOLD', 'KF-OTHER-001', {}, fields), grantComment()], 'merge_grant_target_held');
    assertMergedThroughCli([holdComment('HOLD', 'KF-OTHER-001', {}, fields), holdComment('RESUME', 'KF-OTHER-001'), grantComment()]);
  });
}

test('NC CLI hold cross-packet release: the target\'s own HOLD_CLEAR, or one naming the target PR, does not release another packet\'s hold on it', () => {
  assertDeniedThroughCli([holdComment('HOLD', 'KF-OTHER-001', {}, { pr_number: 87 }), holdComment('RESUME', 'KF-X-001'), grantComment()], 'merge_grant_target_held');
  assertDeniedThroughCli([
    holdComment('HOLD', 'KF-OTHER-001', {}, { implementation_branch: 'impl/x' }),
    holdComment('RESUME', 'KF-THIRD-001', {}, { pr_number: 87, implementation_branch: 'impl/x' }),
    grantComment(),
  ], 'merge_grant_target_held');
  // A genuinely unrelated HOLD does not block.
  assertMergedThroughCli([holdComment('HOLD', 'KF-OTHER-001', {}, { pr_number: 999, implementation_branch: 'impl/else' }), grantComment()]);
});

test('NC CLI hold release order: a HOLD_CLEAR older than the HOLD leaves the target held and makes no merge call', () => {
  const early = holdComment('RESUME', 'KF-X-001');
  const hold = holdComment('HOLD', 'KF-X-001');
  assert.ok(Date.parse(early.created_at) < Date.parse(hold.created_at), 'the RESUME precedes the HOLD');
  assertHeldThroughCli([early, hold, grantComment()]);
});

test('NC CLI recheck: a HOLD posted between the snapshots stops the merge call', () => {
  const g = grantComment();
  const r = run(scenario([[g], [g, holdComment('HOLD', 'KF-X-001')]]), ['--merge']);
  assert.ok(r.trace, r.stderr);
  assert.equal(puts(r).length, 0);
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.reason, 'merge_grant_not_satisfied');
  assert.equal(r.out.detail.reason, 'merge_grant_superseded');
  assert.equal(commentReads(r).length, 2, 'the HOLD is seen by the second snapshot');
});

test('target() in the fixture is the PR this scenario serves', () => {
  assert.deepEqual(target(), { repository: REPO, pr_number: pr.number, packet_id: 'KF-X-001', implementation_branch: pr.head_ref, source_head: SEMANTIC, pr_head: HEAD, base_sha: BASE });
});

// CG-REV-F9-005, through the real CLI: per-packet hold chronology.
test('NC CLI hold chronology (F9-005): HOLD(other, unrelated), HOLD(other, names target PR), its release and an exact grant makes no merge call in either mode', () => {
  const comments = [holdComment('HOLD', 'KF-OTHER-001'), holdComment('HOLD', 'KF-OTHER-001', {}, { pr_number: 87 }), holdComment('RESUME', 'KF-OTHER-001'), grantComment()];
  assertDeniedThroughCli(comments, 'merge_grant_hold_duplicate');
  const byBranch = [holdComment('HOLD', 'KF-OTHER-001'), holdComment('HOLD', 'KF-OTHER-001', {}, { implementation_branch: 'impl/x' }), holdComment('RESUME', 'KF-OTHER-001'), grantComment()];
  assertDeniedThroughCli(byBranch, 'merge_grant_hold_duplicate');
});

test('CLI hold chronology referent (F9-005): a release between the two holds, then the target-naming re-HOLD and its release, merges once', () => {
  assertMergedThroughCli([holdComment('HOLD', 'KF-OTHER-001'), holdComment('RESUME', 'KF-OTHER-001'), holdComment('HOLD', 'KF-OTHER-001', {}, { pr_number: 87 }), holdComment('RESUME', 'KF-OTHER-001'), grantComment()]);
});
