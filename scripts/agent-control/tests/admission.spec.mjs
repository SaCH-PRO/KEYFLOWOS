import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateAdmission, ADMISSION_REASONS, ADMISSION_WORKFLOWS } from '../lib/admission.mjs';
import { AI_REVIEW_GATE_WORKFLOW } from '../lib/ai-review.mjs';
import { REQUIRED_WORKFLOWS } from '../lib/events.mjs';
import { parseYaml } from '../lib/yaml.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const SEMANTIC = 'c'.repeat(40);

// Every workflow admission requires, including the AI Review Gate.
const greenRuns = (sha = HEAD) =>
  ADMISSION_WORKFLOWS.map((name, i) => ({
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

// ------------------------------------------ AI REVIEW GATE (KF-AI-PR-REVIEW-GATE-001)

test('the AI Review Gate is required at the exact head in addition to every existing workflow', () => {
  // Existing prerequisites are preserved: every REQUIRED_WORKFLOWS entry is still required.
  for (const name of REQUIRED_WORKFLOWS) assert.ok(ADMISSION_WORKFLOWS.includes(name), `${name} must stay required`);
  assert.ok(ADMISSION_WORKFLOWS.includes(AI_REVIEW_GATE_WORKFLOW));

  const withoutGate = greenRuns().filter((r) => r.name !== AI_REVIEW_GATE_WORKFLOW);
  const missing = evaluateAdmission(admissible({ workflow_runs: withoutGate }));
  assert.equal(missing.reason, ADMISSION_REASONS.MISSING_WORKFLOWS);
  assert.deepEqual(missing.detail, [AI_REVIEW_GATE_WORKFLOW]);

  const red = greenRuns().map((r) => (r.name === AI_REVIEW_GATE_WORKFLOW ? { ...r, conclusion: 'failure' } : r));
  assert.equal(evaluateAdmission(admissible({ workflow_runs: red })).reason, ADMISSION_REASONS.WORKFLOWS_NOT_GREEN);

  // A green gate at an older head proves nothing about this tree.
  const staleGate = greenRuns().map((r) => (r.name === AI_REVIEW_GATE_WORKFLOW ? { ...r, head_sha: 'e'.repeat(40) } : r));
  assert.equal(evaluateAdmission(admissible({ workflow_runs: staleGate })).reason, ADMISSION_REASONS.STALE_WORKFLOW_HEAD);

  // The latest evaluation at the head wins: an early fail (review not posted yet), then a pass, admits.
  const reevaluated = [
    ...greenRuns().map((r) =>
      r.name === AI_REVIEW_GATE_WORKFLOW ? { ...r, conclusion: 'failure', created_at: '2026-09-23T09:00:00Z' } : r,
    ),
    { id: 777, name: AI_REVIEW_GATE_WORKFLOW, head_sha: HEAD, status: 'completed', conclusion: 'success', created_at: '2026-09-23T11:00:00Z' },
  ];
  assert.equal(evaluateAdmission(admissible({ workflow_runs: reevaluated })).eligible, true);
});

test('the AI Review Gate runs on every PR event it depends on and never wakes the autopilot', () => {
  const text = fs.readFileSync('.github/workflows/ai-review-gate.yml', 'utf8');
  assert.equal((text.match(/^name:\s*(.+?)\s*$/m) || [])[1], AI_REVIEW_GATE_WORKFLOW);
  const trigger = text.slice(text.indexOf('\non:'), text.indexOf('\njobs:'));
  for (const event of ['pull_request', 'pull_request_review', 'pull_request_review_comment']) {
    assert.match(trigger, new RegExp(`^\\s*${event}:`, 'm'), `the gate must run on ${event}`);
  }
  assert.ok(!/paths(-ignore)?:/.test(trigger), 'the gate must not be path-filtered: every PR needs it');
  assert.ok(!/pull_request_target/.test(text), 'the gate must not run as privileged pull_request_target');

  // Waking on it would post one #80 AUTO_EVENT per re-evaluation: a control-channel storm.
  const autopilot = fs.readFileSync('.github/workflows/agent-control-autopilot.yml', 'utf8');
  assert.ok(!autopilot.includes(`- "${AI_REVIEW_GATE_WORKFLOW}"`), 'the autopilot must not wake on the AI Review Gate');

  const policy = parseYaml(fs.readFileSync('docs/development/AGENT_AUTOPILOT_POLICY.yaml', 'utf8'));
  assert.deepEqual(policy.required_pr_review_gates, [AI_REVIEW_GATE_WORKFLOW], 'policy and code must agree');
});
