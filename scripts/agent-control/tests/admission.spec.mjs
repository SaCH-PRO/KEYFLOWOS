import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateAdmission, recheckBeforeMerge, ADMISSION_REASONS, TRANSITION_TRIGGERS } from '../lib/admission.mjs';
import { SEMANTIC_REVIEW_REASONS } from '../lib/semantic-review.mjs';
import { REQUIRED_WORKFLOWS } from '../lib/events.mjs';
import { parseYaml } from '../lib/yaml.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const SEMANTIC = 'c'.repeat(40);

const greenRuns = (sha = HEAD) =>
  REQUIRED_WORKFLOWS.map((name, i) => ({
    id: 100 + i,
    name,
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-09-23T10:00:00Z',
  }));

const admissible = (overrides = {}) => ({
  pr: { number: 87, state: 'open', draft: false, head_sha: HEAD, base_sha: BASE, head_ref: 'impl/x' },
  active: { source_main: BASE, production_touched: false },
  ret: {
    source_main: BASE,
    source_head: SEMANTIC,
    review_status: 'READY_TO_MERGE',
    production_touched: false,
    scope_changed: false,
    tests: { failed: 0, skipped: 0 },
    semantic_review: {
      implementer: 'claude',
      reviews: [
        {
          provider: 'copilot',
          reviewer: 'copilot-pull-request-reviewer[bot]',
          reviewed_head: HEAD,
          outcome: 'PASS',
          reason: null,
          unresolved_substantive_findings: [],
          dispositioned_findings: [],
          evidence_location: 'https://github.com/o/r/pull/87#pullrequestreview-1',
        },
      ],
    },
  },
  ancestry: { source_head_is_ancestor: true, non_control_files: [] },
  workflow_runs: greenRuns(),
  contradictions: [],
  pr_transitions: [],
  semantic_review_live: { copilot: [{ commit_id: HEAD, status: 'REVIEWED', url: null }], chatgpt: [] },
  ...overrides,
});

test('a fully admitted exact head is eligible', () => {
  const v = evaluateAdmission(admissible());
  assert.equal(v.eligible, true);
  assert.equal(v.reason, ADMISSION_REASONS.ELIGIBLE);
  assert.equal(v.head_sha, HEAD);
});

// -------------------------------------------------------------- FAIL CLOSED

test('a draft PR is never eligible', () => {
  const v = evaluateAdmission(admissible({ pr: { ...admissible().pr, draft: true } }));
  assert.equal(v.reason, ADMISSION_REASONS.PR_IS_DRAFT);
});

test('a non-impl branch is never eligible', () => {
  const v = evaluateAdmission(admissible({ pr: { ...admissible().pr, head_ref: 'chore/agent-control-autopilot-v1' } }));
  assert.equal(v.reason, ADMISSION_REASONS.NOT_IMPL_BRANCH);
});

test('without a review marker there is no admission', () => {
  const base = admissible();
  const v = evaluateAdmission({ ...base, ret: { ...base.ret, review_status: 'PENDING_CHATGPT_REVIEW' } });
  assert.equal(v.reason, ADMISSION_REASONS.REVIEW_NOT_READY);
});

test('production_touched blocks admission from either artifact', () => {
  const base = admissible();
  assert.equal(evaluateAdmission({ ...base, active: { ...base.active, production_touched: true } }).reason, ADMISSION_REASONS.PRODUCTION_TOUCHED);
  assert.equal(evaluateAdmission({ ...base, ret: { ...base.ret, production_touched: true } }).reason, ADMISSION_REASONS.PRODUCTION_TOUCHED);
});

test('main drift blocks admission', () => {
  const base = admissible();
  const v = evaluateAdmission({ ...base, ret: { ...base.ret, source_main: 'd'.repeat(40) } });
  assert.equal(v.reason, ADMISSION_REASONS.SOURCE_MAIN_DRIFT);
});

test('a source_head that is not an ancestor blocks admission', () => {
  const v = evaluateAdmission(admissible({ ancestry: { source_head_is_ancestor: false, non_control_files: [] } }));
  assert.equal(v.reason, ADMISSION_REASONS.SOURCE_HEAD_NOT_ANCESTOR);
});

test('a non-control file after source_head blocks admission', () => {
  const v = evaluateAdmission(
    admissible({ ancestry: { source_head_is_ancestor: true, non_control_files: ['apps/server/src/main.ts'] } }),
  );
  assert.equal(v.reason, ADMISSION_REASONS.NON_CONTROL_TAIL);
  assert.deepEqual(v.detail, ['apps/server/src/main.ts']);
});

test('an unresolved contradiction blocks admission', () => {
  const v = evaluateAdmission(admissible({ contradictions: ['META-C1'] }));
  assert.equal(v.reason, ADMISSION_REASONS.UNRESOLVED_CONTRADICTION);
});

test('failed or unexplained skipped proof blocks admission', () => {
  const base = admissible();
  assert.equal(
    evaluateAdmission({ ...base, ret: { ...base.ret, tests: { failed: 1, skipped: 0 } } }).reason,
    ADMISSION_REASONS.UNEXPLAINED_PROOF,
  );
  assert.equal(
    evaluateAdmission({ ...base, ret: { ...base.ret, tests: { failed: 0, skipped: 3 } } }).reason,
    ADMISSION_REASONS.UNEXPLAINED_PROOF,
  );
  // An explicitly justified skip is allowed through.
  assert.equal(
    evaluateAdmission({ ...base, ret: { ...base.ret, tests: { failed: 0, skipped: 3 }, skipped_justification: 'db-less env' } }).eligible,
    true,
  );
});

// ------------------------------------------------------------ EXACT HEAD

test('STALE HEAD: green runs at a different sha cannot admit this head', () => {
  const v = evaluateAdmission(admissible({ workflow_runs: greenRuns('e'.repeat(40)) }));
  assert.equal(v.reason, ADMISSION_REASONS.STALE_WORKFLOW_HEAD);
  assert.deepEqual(v.detail.runs_at_other_heads, ['e'.repeat(40)]);
});

test('a missing required workflow blocks admission', () => {
  const v = evaluateAdmission(admissible({ workflow_runs: greenRuns().slice(0, 2) }));
  assert.equal(v.reason, ADMISSION_REASONS.MISSING_WORKFLOWS);
});

test('a red required workflow blocks admission', () => {
  const runs = greenRuns();
  runs[0] = { ...runs[0], conclusion: 'failure' };
  const v = evaluateAdmission(admissible({ workflow_runs: runs }));
  assert.equal(v.reason, ADMISSION_REASONS.WORKFLOWS_NOT_GREEN);
});

test('the newest run at the head wins when a workflow re-ran', () => {
  const runs = greenRuns();
  runs.push({ id: 999, name: 'CI/CD Pipeline', head_sha: HEAD, status: 'completed', conclusion: 'success', created_at: '2026-09-23T12:00:00Z' });
  runs[0] = { ...runs[0], conclusion: 'failure', created_at: '2026-09-23T09:00:00Z' };
  assert.equal(evaluateAdmission(admissible({ workflow_runs: runs })).eligible, true);

  // ...and a newer FAILURE must lose to nothing.
  const runs2 = greenRuns();
  runs2.push({ id: 998, name: 'CI/CD Pipeline', head_sha: HEAD, status: 'completed', conclusion: 'failure', created_at: '2026-09-23T12:00:00Z' });
  assert.equal(evaluateAdmission(admissible({ workflow_runs: runs2 })).reason, ADMISSION_REASONS.WORKFLOWS_NOT_GREEN);
});

test('NEGATIVE CONTROL: the prototype head filter would have admitted a stale tree', () => {
  // The prototype queried runs by head_sha but never re-verified head_sha on
  // the returned rows, so a mixed response could admit the wrong tree.
  const mixed = [...greenRuns('f'.repeat(40))];
  const prototypeVerdict = ['CI/CD Pipeline', 'Agent Control Gate', 'Branch divergence', 'DAST (HawkScan)'].every((name) =>
    mixed.some((r) => r.name === name && r.status === 'completed' && r.conclusion === 'success'),
  );
  assert.equal(prototypeVerdict, true, 'the old check passes on stale runs');
  assert.equal(evaluateAdmission(admissible({ workflow_runs: mixed })).eligible, false, 'the new check rejects them');
});

test('the Windows worker proof is required: an impl PR without it is not admissible', () => {
  // WORKER-CI-PLATFORM-001: the Windows job is required evidence, not advisory.
  assert.ok(REQUIRED_WORKFLOWS.includes('Agent Control Worker Proof'));
  const withoutWorkerProof = greenRuns().filter((r) => r.name !== 'Agent Control Worker Proof');
  const verdict = evaluateAdmission(admissible({ workflow_runs: withoutWorkerProof }));
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.reason, ADMISSION_REASONS.MISSING_WORKFLOWS);
  assert.deepEqual(verdict.detail, ['Agent Control Worker Proof']);

  const red = greenRuns().map((r) => (r.name === 'Agent Control Worker Proof' ? { ...r, conclusion: 'failure' } : r));
  assert.equal(evaluateAdmission(admissible({ workflow_runs: red })).reason, ADMISSION_REASONS.WORKFLOWS_NOT_GREEN);
});

test('every required workflow exists, runs on every PR, and wakes the autopilot', () => {
  // A required name that no workflow file declares -- or one behind a path
  // filter -- would make every other impl/* PR permanently inadmissible, or
  // silently unrequired. Check the referent, not the list.
  const dir = '.github/workflows';
  const declared = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const name = (text.match(/^name:\s*(.+?)\s*$/m) || [])[1];
    if (name) declared.set(name.replace(/^["']|["']$/g, ''), text);
  }
  const autopilot = fs.readFileSync(path.join(dir, 'agent-control-autopilot.yml'), 'utf8');
  for (const name of REQUIRED_WORKFLOWS) {
    const text = declared.get(name);
    assert.ok(text, `no workflow file declares required workflow "${name}"`);
    assert.match(text, /^\s*pull_request:/m, `"${name}" must run on pull_request`);
    assert.ok(autopilot.includes(`- "${name}"`), `the autopilot must wake on "${name}" completing`);
  }
  const worker = declared.get('Agent Control Worker Proof');
  const trigger = worker.slice(worker.indexOf('on:'), worker.indexOf('jobs:'));
  assert.ok(!/paths(-ignore)?:/.test(trigger), 'the worker proof must not be path-filtered');
  assert.match(worker, /runs-on:\s*windows-latest/);
  assert.match(worker, /tests\/windows\//, 'the Windows job must run the Windows suite');

  const policy = parseYaml(fs.readFileSync('docs/development/AGENT_AUTOPILOT_POLICY.yaml', 'utf8'));
  assert.deepEqual([...policy.required_pr_workflows].sort(), [...REQUIRED_WORKFLOWS].sort(), 'policy and code must agree');
});

// ------------------------------------------ INDEPENDENT SEMANTIC REVIEW
// (KF-META-AI-REVIEW-FAILOVER-001) Admission consumes the provider-neutral
// contract; lib/semantic-review.mjs and its spec cover the contract itself.

test('NC admission consumes semantic review: an otherwise admissible head with no review record is not eligible', () => {
  const base = admissible();
  const { semantic_review, ...ret } = base.ret;
  const v = evaluateAdmission({ ...base, ret });
  assert.equal(v.eligible, false);
  assert.equal(v.reason, ADMISSION_REASONS.SEMANTIC_REVIEW_NOT_SATISFIED);
  assert.equal(v.detail.reason, SEMANTIC_REVIEW_REASONS.RECORD_MISSING);
});

test('NC admission consumes live review evidence: a recorded Copilot PASS the PR does not show is not eligible', () => {
  const v = evaluateAdmission(admissible({ semantic_review_live: { copilot: [], chatgpt: [] } }));
  assert.equal(v.reason, ADMISSION_REASONS.SEMANTIC_REVIEW_NOT_SATISFIED);
  assert.equal(v.detail.reason, SEMANTIC_REVIEW_REASONS.LIVE_EVIDENCE_MISSING);
});

test('an eligible verdict records which independent review satisfied it', () => {
  const v = evaluateAdmission(admissible());
  assert.equal(v.eligible, true);
  assert.deepEqual(v.evidence.semantic_review.passing.map((p) => p.provider), ['copilot']);
});

// ------------------------------------------------ ADMISSION ORDER (PR 103)

test('NC pending re-run: a required run still in progress at the head blocks admission even after an older green run', () => {
  const runs = [
    ...greenRuns(),
    { id: 900, name: 'Agent Control Gate', head_sha: HEAD, status: 'in_progress', conclusion: null, created_at: '2026-09-23T10:00:01Z' },
  ];
  const v = evaluateAdmission(admissible({ workflow_runs: runs }));
  assert.equal(v.eligible, false);
  assert.equal(v.reason, ADMISSION_REASONS.REQUIRED_CHECK_PENDING);
  assert.deepEqual(v.detail.map((d) => d.workflow), ['Agent Control Gate']);
});

test('NC pending re-run: an older queued run beside a newer green one still blocks', () => {
  const runs = greenRuns().map((r) => ({ ...r, created_at: '2026-09-23T10:00:05Z' }));
  runs.push({ id: 901, name: 'CI/CD Pipeline', head_sha: HEAD, status: 'queued', conclusion: null, created_at: '2026-09-23T10:00:00Z' });
  assert.equal(evaluateAdmission(admissible({ workflow_runs: runs })).reason, ADMISSION_REASONS.REQUIRED_CHECK_PENDING);
});

test('NC PR 103 replay: ready_for_review after the last gate run owes a re-run, even before GitHub lists it', () => {
  // The recorded timeline: green runs at 18:22:37, ready_for_review 19:09:33,
  // manual merge 19:09:40. The owed gate run is not in the list yet.
  const runs = greenRuns().map((r) => ({ ...r, created_at: '2026-09-28T18:22:37Z' }));
  const v = evaluateAdmission(admissible({
    workflow_runs: runs,
    pr_transitions: [
      { event: 'review_requested', created_at: '2026-09-28T18:21:23Z' },
      { event: 'ready_for_review', created_at: '2026-09-28T19:09:33Z' },
    ],
  }));
  assert.equal(v.eligible, false);
  assert.equal(v.reason, ADMISSION_REASONS.CHECKS_PREDATE_TRANSITION);
  assert.deepEqual(v.detail.map((d) => d.workflow), ['Agent Control Gate']);
});

test('PR 103 replay, settled: once the owed gate run exists and is green, the transition is satisfied', () => {
  const runs = greenRuns().map((r) => ({ ...r, created_at: '2026-09-28T18:22:37Z' }));
  runs.push({ id: 902, name: 'Agent Control Gate', head_sha: HEAD, status: 'completed', conclusion: 'success', created_at: '2026-09-28T19:09:36Z' });
  const v = evaluateAdmission(admissible({
    workflow_runs: runs,
    pr_transitions: [{ event: 'ready_for_review', created_at: '2026-09-28T19:09:33Z' }],
  }));
  assert.equal(v.eligible, true);
});

test('PR 103 replay, failed: the owed gate run that failed blocks admission', () => {
  const runs = greenRuns().map((r) => ({ ...r, created_at: '2026-09-28T18:22:37Z' }));
  runs.push({ id: 903, name: 'Agent Control Gate', head_sha: HEAD, status: 'completed', conclusion: 'failure', created_at: '2026-09-28T19:09:36Z' });
  const v = evaluateAdmission(admissible({
    workflow_runs: runs,
    pr_transitions: [{ event: 'ready_for_review', created_at: '2026-09-28T19:09:33Z' }],
  }));
  assert.equal(v.reason, ADMISSION_REASONS.WORKFLOWS_NOT_GREEN);
});

test('reopened owes a re-run of every required workflow', () => {
  assert.deepEqual([...TRANSITION_TRIGGERS.reopened], [...REQUIRED_WORKFLOWS]);
  const runs = greenRuns().map((r) => ({ ...r, created_at: '2026-09-23T10:00:00Z' }));
  const v = evaluateAdmission(admissible({ workflow_runs: runs, pr_transitions: [{ event: 'reopened', created_at: '2026-09-23T11:00:00Z' }] }));
  assert.equal(v.reason, ADMISSION_REASONS.CHECKS_PREDATE_TRANSITION);
  assert.deepEqual(v.detail.map((d) => d.workflow).sort(), [...REQUIRED_WORKFLOWS].sort());
});

test('NC unknown timeline fails closed: without pr_transitions admission cannot know no re-run is owed', () => {
  const { pr_transitions, ...snapshot } = admissible();
  assert.equal(evaluateAdmission(snapshot).reason, ADMISSION_REASONS.TRANSITIONS_UNKNOWN);
});

test('every transition trigger names only required workflows that listen to that PR event type', () => {
  for (const [event, workflows] of Object.entries(TRANSITION_TRIGGERS)) {
    for (const name of workflows) assert.ok(REQUIRED_WORKFLOWS.includes(name), `${event} -> ${name}`);
  }
  const gate = fs.readFileSync('.github/workflows/agent-control-gate.yml', 'utf8');
  assert.match(gate, /types: \[[^\]]*\bready_for_review\b[^\]]*\bconverted_to_draft\b[^\]]*\bedited\b/);
});

test('NC recheck before merge: a second snapshot that is no longer eligible stops the merge', () => {
  const first = evaluateAdmission(admissible());
  const runs = [...greenRuns(), { id: 904, name: 'Agent Control Gate', head_sha: HEAD, status: 'in_progress', conclusion: null, created_at: '2026-09-23T10:00:09Z' }];
  const second = evaluateAdmission(admissible({ workflow_runs: runs }));
  const v = recheckBeforeMerge(first, second);
  assert.equal(v.eligible, false);
  assert.equal(v.reason, ADMISSION_REASONS.REQUIRED_CHECK_PENDING);
});

test('NC recheck before merge: a head that moved between the snapshots stops the merge', () => {
  const first = evaluateAdmission(admissible());
  const moved = 'd'.repeat(40);
  const second = evaluateAdmission(admissible({
    pr: { ...admissible().pr, head_sha: moved },
    workflow_runs: greenRuns(moved),
    reviewed_head_lineage: { [HEAD]: { descends_from_source_head: true, ancestor_of_pr_head: true, non_control_files: [] } },
  }));
  assert.equal(second.eligible, true, 'the moved head is itself admissible; only the change must block');
  const v = recheckBeforeMerge(first, second);
  assert.equal(v.eligible, false);
  assert.equal(v.reason, ADMISSION_REASONS.CHANGED_BEFORE_MERGE);
});

test('recheck before merge: two eligible snapshots at the same head and base allow the merge', () => {
  const v = recheckBeforeMerge(evaluateAdmission(admissible()), evaluateAdmission(admissible()));
  assert.equal(v.eligible, true);
});

test('NC merge path shape: auto-merge re-collects and rechecks the complete snapshot before the merge call', () => {
  const src = fs.readFileSync('scripts/agent-control/auto-merge-admitted.mjs', 'utf8');
  const recheck = src.indexOf('recheckBeforeMerge(first, await evaluateNow())');
  const mergeCall = src.indexOf('/merge`');
  assert.ok(recheck > 0, 'the merge verdict must come from a second, freshly collected snapshot');
  assert.ok(mergeCall > recheck, 'the recheck must precede the merge call');
  assert.match(src, /sha: verdict\.head_sha/, 'the merge is pinned to the rechecked head');
  for (const input of ['pr_transitions:', 'semantic_review_live:', 'reviewed_head_lineage:']) {
    assert.ok(src.includes(input), `evaluateAdmission must receive ${input}`);
  }
});
