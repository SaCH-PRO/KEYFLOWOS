import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAdmission, ADMISSION_REASONS } from '../lib/admission.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const SEMANTIC = 'c'.repeat(40);

const greenRuns = (sha = HEAD) =>
  ['CI/CD Pipeline', 'Agent Control Gate', 'Branch divergence', 'DAST (HawkScan)'].map((name, i) => ({
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
  },
  ancestry: { source_head_is_ancestor: true, non_control_files: [] },
  workflow_runs: greenRuns(),
  contradictions: [],
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
