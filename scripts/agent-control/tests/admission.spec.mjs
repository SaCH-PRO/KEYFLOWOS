import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateAdmission, ADMISSION_REASONS } from '../lib/admission.mjs';
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
  },
  ancestry: { source_head_is_ancestor: true, non_control_files: [] },
  workflow_runs: greenRuns(),
  contradictions: [],
  // KF-AI-PR-REVIEW-GATE-001: the merge path's own exact-head AI review verdict.
  ai_review: { admissible: true, reason: 'current_head_ai_review_admissible', head_sha: HEAD, reviews: [], blocking_findings: [] },
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

// ------------------------------------------ AI REVIEW (KF-AI-PR-REVIEW-GATE-001)

test('admission requires an admissible AI review verdict for the exact head, on top of every workflow', () => {
  const base = admissible();
  const notEvaluated = evaluateAdmission({ ...base, ai_review: undefined });
  assert.equal(notEvaluated.reason, ADMISSION_REASONS.AI_REVIEW_NOT_ADMISSIBLE);
  assert.equal(notEvaluated.detail.reason, 'ai_review_not_evaluated');

  const blocked = evaluateAdmission({
    ...base,
    ai_review: { admissible: false, reason: 'undispositioned_substantive_findings', head_sha: HEAD, blocking_findings: ['F-1'] },
  });
  assert.equal(blocked.reason, ADMISSION_REASONS.AI_REVIEW_NOT_ADMISSIBLE);
  assert.deepEqual(blocked.detail.blocking_findings, ['F-1']);

  // A pass computed for another head proves nothing about this tree.
  const otherHead = evaluateAdmission({ ...base, ai_review: { ...base.ai_review, head_sha: 'e'.repeat(40) } });
  assert.equal(otherHead.reason, ADMISSION_REASONS.AI_REVIEW_NOT_ADMISSIBLE);

  // A truthy-but-not-true admissible flag is not a pass.
  assert.equal(evaluateAdmission({ ...base, ai_review: { ...base.ai_review, admissible: 'yes' } }).eligible, false);

  // Existing prerequisites still come first: the AI verdict cannot rescue a red workflow.
  const runs = greenRuns();
  runs[0] = { ...runs[0], conclusion: 'failure' };
  assert.equal(evaluateAdmission({ ...base, workflow_runs: runs }).reason, ADMISSION_REASONS.WORKFLOWS_NOT_GREEN);
  assert.deepEqual([...REQUIRED_WORKFLOWS].sort(), [...parseYaml(fs.readFileSync('docs/development/AGENT_AUTOPILOT_POLICY.yaml', 'utf8')).required_pr_workflows].sort());
});

test('the merge path computes the AI verdict itself, from trusted main, for the head it merges', () => {
  // Referent check: the merger must not trust a workflow conclusion the PR can author.
  const merger = fs.readFileSync('scripts/agent-control/auto-merge-admitted.mjs', 'utf8');
  assert.match(merger, /evaluateAiReview\(\s*await collectAiReviewSnapshot\(\{[^}]*expectedHead: pr\.head\.sha/);
  assert.match(merger, /evaluateAdmission\(\{\s*ai_review,/);
  const autopilot = fs.readFileSync('.github/workflows/agent-control-autopilot.yml', 'utf8');
  for (const job of ['exact-head-auto-merge:', 'hourly-reconcile-open-prs:']) {
    const body = autopilot.slice(autopilot.indexOf(job));
    assert.match(body.slice(0, 2500), /ref:\s*main/, `${job} must run the trusted main checkout`);
  }
  // The gate workflow is PR-visible evidence only; it neither wakes the autopilot nor gates admission.
  assert.ok(!autopilot.includes('- "AI Review Gate"'));
  assert.ok(!REQUIRED_WORKFLOWS.includes('AI Review Gate'));
});
