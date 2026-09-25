import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../lib/state.mjs';
import { evaluateMomentum, countOperation, countFailure, clearOnTransition, failureSignature, THRESHOLDS } from '../lib/momentum.mjs';
import { planCorrection, recordAttempt, DECISIONS } from '../lib/correction.mjs';
import { decide, ACTIONS } from '../lib/orchestrator.mjs';
import fs from 'node:fs';
import { loadDag } from '../lib/dag.mjs';
import { ROLES, AGENT_STATUS, selectAdapter, claudeLocalAdapter, openAiAdapter } from '../lib/adapters.mjs';

// Verdict for a projection that agrees with authority and repository truth.
// These tests exercise the rule table behind that gate; tests/reconcile.spec.mjs
// covers the gate itself.
const CONSISTENT = Object.freeze({ consistent: true, findings: [], authority_newest: null });

const readyBuilder = {
  id: 'test-builder',
  vendor: 'test',
  roles: [ROLES.BUILDER],
  probeAuth: () => ({ status: AGENT_STATUS.READY, detail: 'ok' }),
  invoke: () => ({ status: 'COMPLETED', output: 'done' }),
};
const unauthedBuilder = {
  id: 'test-builder',
  vendor: 'test',
  roles: [ROLES.BUILDER],
  probeAuth: () => ({ status: AGENT_STATUS.WAITING_EXTERNAL_AGENT, detail: 'no session' }),
  invoke: () => ({ status: AGENT_STATUS.WAITING_EXTERNAL_AGENT }),
};

// ------------------------------------------------------------- MOMENTUM

test('six operations without a transition raise the alarm; five do not', () => {
  let state = emptyState();
  for (let i = 0; i < THRESHOLDS.OPERATIONS_WITHOUT_TRANSITION - 1; i += 1) state = countOperation(state);
  assert.equal(evaluateMomentum(state).alarm, false, 'five operations is below the threshold');
  state = countOperation(state);
  assert.equal(evaluateMomentum(state).alarm, true);
  assert.ok(evaluateMomentum(state).reasons.includes('six_or_more_operations_without_a_state_transition'));
});

test('two materially identical failures raise the alarm; two different ones do not', () => {
  const sig = failureSignature({ class: 'TYPECHECK_FAILURE', target: 'delivery-queue.service.ts' });
  let same = countFailure(emptyState(), sig);
  same = countFailure(same, sig);
  assert.equal(evaluateMomentum(same).alarm, true);

  let different = countFailure(emptyState(), failureSignature({ class: 'TYPECHECK_FAILURE', target: 'a.ts' }));
  different = countFailure(different, failureSignature({ class: 'TYPECHECK_FAILURE', target: 'b.ts' }));
  assert.equal(evaluateMomentum(different).alarm, false, 'a new root cause is progress, not a stall');
});

test('two CI failures without a new root cause raise the alarm', () => {
  const sig = failureSignature({ class: 'CI', target: 'CI/CD Pipeline' });
  let state = countFailure(emptyState(), sig, 'ci');
  state = countFailure(state, sig, 'ci');
  assert.ok(evaluateMomentum(state).reasons.includes('two_consecutive_ci_failures_without_a_new_root_cause'));
});

test('a real transition clears every momentum counter', () => {
  let state = emptyState();
  for (let i = 0; i < 8; i += 1) state = countOperation(state);
  state = countFailure(state, 'x');
  assert.equal(evaluateMomentum(state).alarm, true);
  state = clearOnTransition(state, '2026-09-23T21:00:00Z');
  assert.equal(evaluateMomentum(state).alarm, false);
  assert.equal(state.momentum.last_transition_at, '2026-09-23T21:00:00Z');
});

// ------------------------------------------------------------- CORRECTION

test('a mechanical defect is auto-correctable within the bound', () => {
  const plan = planCorrection(emptyState(), { class: 'TYPECHECK_FAILURE', target: 'x.ts' });
  assert.equal(plan.decision, DECISIONS.AUTO_CORRECT);
  assert.equal(plan.attempts, 1);
});

test('two materially identical failed corrections force a block, not a third retry', () => {
  let state = emptyState();
  const defect = { class: 'TYPECHECK_FAILURE', target: 'x.ts' };
  for (let i = 0; i < 2; i += 1) state = recordAttempt(state, planCorrection(state, defect));
  const third = planCorrection(state, defect);
  assert.equal(third.decision, DECISIONS.BLOCK_REPEATED);
  assert.match(third.reason, /blocking rather than retrying/);
});

test('authority-class defects are never auto-corrected', () => {
  for (const cls of ['CONTRADICTION', 'SCOPE_WIDENING', 'PRODUCTION_RISK', 'GATE_WEAKENING', 'SCHEMA_PRIMITIVE_CHOICE']) {
    const plan = planCorrection(emptyState(), { class: cls, target: 'x' });
    assert.equal(plan.decision, DECISIONS.ESCALATE, `${cls} must escalate`);
  }
});

test('an unrecognised defect class fails closed to escalation', () => {
  const plan = planCorrection(emptyState(), { class: 'SOMETHING_NEW', target: 'x' });
  assert.equal(plan.decision, DECISIONS.ESCALATE);
  assert.match(plan.reason, /not a recognised auto-correctable defect class/);
});

// ------------------------------------------------------------- ADAPTERS

test('a missing credential yields WAITING_EXTERNAL_AGENT, never a false success', () => {
  delete process.env.KEYFLOW_AGENT_OPENAI_API_KEY;
  const probe = openAiAdapter().probeAuth();
  assert.equal(probe.status, AGENT_STATUS.WAITING_EXTERNAL_AGENT);
  const chosen = selectAdapter([openAiAdapter()], ROLES.ADVERSARIAL_REVIEWER);
  assert.equal(chosen.adapter, null);
  assert.equal(chosen.status, AGENT_STATUS.WAITING_EXTERNAL_AGENT);
});

test('an adapter that is present but disabled reports DISABLED', () => {
  process.env.KEYFLOW_AGENT_CLAUDE_DISABLED = '1';
  assert.equal(claudeLocalAdapter().probeAuth().status, AGENT_STATUS.DISABLED);
  delete process.env.KEYFLOW_AGENT_CLAUDE_DISABLED;
});

test('the builder can never be selected to adversarially review its own work', () => {
  const builderAlsoClaimingReview = { ...readyBuilder, id: 'claude-code-local', roles: [ROLES.BUILDER, ROLES.ADVERSARIAL_REVIEWER] };
  const chosen = selectAdapter([builderAlsoClaimingReview], ROLES.ADVERSARIAL_REVIEWER, ['claude-code-local']);
  assert.equal(chosen.adapter, null, 'self-review must be structurally impossible');
});

// ------------------------------------------------------------- ORCHESTRATOR

test('a duplicate event converges without a second effect', () => {
  const out = decide({ state: emptyState(), event: { idempotency_key: 'k' }, duplicate: true });
  assert.equal(out.action, ACTIONS.DUPLICATE_EVENT);
});

test('an active hold outranks ordinary progression', () => {
  const state = emptyState();
  state.programme.state = 'IMPLEMENTING';
  state.hold = { reason: 'ACTION-001 held pending META-AUTO', resume_condition: 'CG-RESUME-ACTION-*' };
  const out = decide({ state, reconciliation: CONSISTENT,registry: [readyBuilder] });
  assert.equal(out.action, ACTIONS.WAIT_AUTHORITY);
  assert.match(out.reason, /held/);
});

test('an unresolved contradiction stops advancement and is never auto-resolved', () => {
  const state = emptyState();
  state.programme.state = 'IMPLEMENTING';
  state.unresolved_contradictions = ['META-C1'];
  const out = decide({ state, reconciliation: CONSISTENT,registry: [readyBuilder] });
  assert.equal(out.action, ACTIONS.WAIT_AUTHORITY);
  assert.deepEqual(out.contradictions, ['META-C1']);
});

test('a momentum alarm is reported before further mechanical work', () => {
  let state = emptyState();
  state.programme.state = 'IMPLEMENTING';
  for (let i = 0; i < 6; i += 1) state = countOperation(state);
  const out = decide({ state, reconciliation: CONSISTENT,registry: [readyBuilder] });
  assert.equal(out.action, ACTIONS.POST_MOMENTUM);
});

test('IMPLEMENTING dispatches the builder when one is authenticated', () => {
  const state = emptyState();
  state.programme.state = 'IMPLEMENTING';
  state.programme.active_packet = 'KF-META-AUTO-001';
  const out = decide({ state, reconciliation: CONSISTENT,registry: [readyBuilder] });
  assert.equal(out.action, ACTIONS.DISPATCH_BUILDER);
  assert.equal(out.adapter, 'test-builder');
});

test('IMPLEMENTING waits rather than pretending when no builder is authenticated', () => {
  const state = emptyState();
  state.programme.state = 'IMPLEMENTING';
  const out = decide({ state, reconciliation: CONSISTENT,registry: [unauthedBuilder] });
  assert.equal(out.action, ACTIONS.WAIT_EXTERNAL_AGENT);
  assert.equal(out.status, AGENT_STATUS.WAITING_EXTERNAL_AGENT);
});

test('PROVING requests adversarial review and reports reviewer availability', () => {
  const state = emptyState();
  state.programme.state = 'PROVING';
  const out = decide({ state, reconciliation: CONSISTENT,registry: [readyBuilder] });
  assert.equal(out.action, ACTIONS.REQUEST_REVIEW);
  assert.equal(out.reviewer_status, AGENT_STATUS.WAITING_EXTERNAL_AGENT);
});

test('a merged PR routes to post-merge verification, never straight to checkpoint', () => {
  const state = emptyState();
  state.programme.state = 'READY_TO_MERGE';
  const out = decide({ state, reconciliation: CONSISTENT,event: { kind: 'PR_MERGED', pr_number: 87, merge_commit_sha: 'm' }, registry: [] });
  assert.equal(out.action, ACTIONS.POST_MERGE_VERIFY);
});

test('after a checkpoint the next dependency-safe phase is proposed, not released', () => {
  const dag = loadDag(process.cwd());
  const state = emptyState();
  state.programme.state = 'CHECKPOINTED';
  state.programme.checkpointed = ['KF-EXEC-K12-001', 'KF-EXEC-EXTFX-001', 'KF-EXEC-TENANT-001', 'KF-EXEC-AUTH-001'];
  const out = decide({ state, reconciliation: CONSISTENT,dag, registry: [readyBuilder] });
  assert.equal(out.action, ACTIONS.SELECT_NEXT_PACKET);
  assert.equal(out.selected, 'KF-EXEC-ACTION-001');
  assert.match(out.note, /remains an authority action/);
});

test('a CONTRADICTION event escalates to BLOCKED', () => {
  const state = emptyState();
  state.programme.state = 'IMPLEMENTING';
  const out = decide({ state, reconciliation: CONSISTENT,event: { kind: 'CONTRADICTION', packet_id: 'KF-META-AUTO-001' }, registry: [readyBuilder] });
  assert.equal(out.action, ACTIONS.ESCALATE);
  assert.equal(out.target_state, 'BLOCKED');
});

test('the orchestrator is deterministic for the same input', () => {
  const dag = loadDag(process.cwd());
  const build = () => {
    const s = emptyState();
    s.programme.state = 'CHECKPOINTED';
    s.programme.checkpointed = ['KF-EXEC-K12-001'];
    return s;
  };
  assert.deepEqual(decide({ state: build(), reconciliation: CONSISTENT,dag, registry: [readyBuilder] }), decide({ state: build(), reconciliation: CONSISTENT,dag, registry: [readyBuilder] }));
});

test('REGRESSION: the local builder adapter detects the real Claude CLI', () => {
  // On Windows `claude` is a .cmd/.ps1 shim that Node cannot spawn without a
  // shell; the adapter reported WAITING_EXTERNAL_AGENT for an agent that was
  // in fact installed and authenticated, which would silently stall the loop.
  delete process.env.KEYFLOW_AGENT_CLAUDE_DISABLED;
  const probe = claudeLocalAdapter().probeAuth();
  assert.notEqual(probe.status, 'FAILED');
  if (probe.status === AGENT_STATUS.READY) {
    assert.match(probe.detail, /Claude Code/, 'a READY probe must report the real version banner');
  } else {
    // Legitimately absent on a runner without the CLI: it must say so precisely.
    assert.equal(probe.status, AGENT_STATUS.WAITING_EXTERNAL_AGENT);
    assert.match(probe.detail, /not on PATH|ENOENT|exited/);
  }
});

test('the builder adapter never puts the prompt on the command line', () => {
  const source = fs.readFileSync('scripts/agent-control/lib/adapters.mjs', 'utf8');
  assert.ok(!/\['-p',\s*task\.prompt/.test(source), 'prompt must not be an argv element');
  assert.match(source, /input: task\.prompt/, 'prompt must be passed on stdin');
});
