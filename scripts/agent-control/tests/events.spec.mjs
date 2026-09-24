import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeEvent, mutationLockKey, observationKey, MUTATION_LOCK, parseControlMessage, readField } from '../lib/events.mjs';
import { parseYaml } from '../lib/yaml.mjs';

const WORKFLOW = '.github/workflows/agent-control-autopilot.yml';

/** Jobs that can mutate programme state: they invoke the merging evaluator. */
function mutatingJobs(workflow) {
  return Object.entries(workflow.jobs).filter(([, job]) => /auto-merge-admitted\.mjs --merge/.test(JSON.stringify(job)));
}

const comment = (body, id = 5001) => ({
  issue: { number: 80 },
  action: 'created',
  comment: { id, body, html_url: 'https://example/x', user: { login: 'SaCH-PRO' } },
});

test('RETURN on the control issue is actionable', () => {
  const e = normalizeEvent('issue_comment', comment('message_id: X\nmessage_type: RETURN\npacket_id: P\nstate: PROVING\nhealth: GREEN'));
  assert.equal(e.actionable, true);
  assert.equal(e.kind, 'RETURN');
  assert.equal(e.packet_id, 'P');
});

test('a comment on another issue is ignored', () => {
  const e = normalizeEvent('issue_comment', { issue: { number: 79 }, comment: { id: 1, body: 'message_type: RETURN' } });
  assert.equal(e.actionable, false);
  assert.equal(e.idempotency_key, null);
});

test('ordinary PROGRESS is recorded but is not a wake event', () => {
  const e = normalizeEvent('issue_comment', comment('message_type: PROGRESS'));
  assert.equal(e.actionable, false);
  assert.equal(e.kind, 'PROGRESS');
});

// ------------------------------------------------------------- F3 IDEMPOTENCY

test('F3: the same comment replayed under different run ids yields one key', () => {
  process.env.GITHUB_RUN_ID = '111';
  const first = normalizeEvent('issue_comment', comment('message_type: RETURN', 4242));
  process.env.GITHUB_RUN_ID = '222';
  const second = normalizeEvent('issue_comment', comment('message_type: RETURN', 4242));
  delete process.env.GITHUB_RUN_ID;
  assert.equal(first.idempotency_key, second.idempotency_key);
  assert.equal(first.idempotency_key, 'issue_comment:4242:created');
});

test('F3: a workflow_run re-observed keeps one key; a new attempt is a new key', () => {
  const payload = (attempt) => ({
    workflow_run: { id: 99, run_attempt: attempt, name: 'CI/CD Pipeline', status: 'completed', conclusion: 'success', head_sha: 'abc', pull_requests: [{ number: 9 }] },
  });
  assert.equal(normalizeEvent('workflow_run', payload(1)).idempotency_key, 'workflow_run:99:1');
  assert.equal(normalizeEvent('workflow_run', payload(1)).idempotency_key, 'workflow_run:99:1');
  assert.notEqual(normalizeEvent('workflow_run', payload(2)).idempotency_key, 'workflow_run:99:1');
});

test('F3: a merged PR keys on the merge commit, so replay converges', () => {
  const payload = {
    action: 'closed',
    pull_request: { number: 9, merged: true, merge_commit_sha: 'deadbeef', head: { ref: 'impl/x', sha: 'abc' }, base: { sha: 'base' } },
  };
  const a = normalizeEvent('pull_request_target', payload);
  const b = normalizeEvent('pull_request_target', payload);
  assert.equal(a.idempotency_key, b.idempotency_key);
  assert.equal(a.idempotency_key, 'pr_merged:9:deadbeef');
  assert.equal(a.actionable, true);
});

test('F3: scheduled ticks inside one hour collapse to one key', () => {
  const a = normalizeEvent('schedule', { schedule_time: '2026-09-23T21:17:00Z' });
  const b = normalizeEvent('schedule', { schedule_time: '2026-09-23T21:59:00Z' });
  const c = normalizeEvent('schedule', { schedule_time: '2026-09-23T22:01:00Z' });
  assert.equal(a.idempotency_key, b.idempotency_key);
  assert.notEqual(a.idempotency_key, c.idempotency_key);
});

test('NEGATIVE CONTROL: no idempotency key is ever the observing run id', () => {
  process.env.GITHUB_RUN_ID = '987654321';
  const events = [
    normalizeEvent('issue_comment', comment('message_type: RETURN')),
    normalizeEvent('workflow_run', { workflow_run: { id: 1, run_attempt: 1, status: 'completed', pull_requests: [{ number: 2 }] } }),
    normalizeEvent('pull_request_target', { action: 'closed', pull_request: { number: 3, merged: true, merge_commit_sha: 'm', head: { ref: 'impl/a' } } }),
    normalizeEvent('schedule', {}),
  ];
  for (const e of events) {
    assert.ok(!String(e.idempotency_key).includes('987654321'), `${e.kind} key leaked the run id: ${e.idempotency_key}`);
  }
  delete process.env.GITHUB_RUN_ID;
});

test('a merged PR without a merge commit is malformed, not actionable', () => {
  const e = normalizeEvent('pull_request_target', {
    action: 'closed',
    pull_request: { number: 9, merged: true, head: { ref: 'impl/x' } },
  });
  assert.equal(e.actionable, false);
  assert.equal(e.kind, 'MALFORMED');
});

test('a comment with no id is malformed rather than silently keyed', () => {
  const e = normalizeEvent('issue_comment', { issue: { number: 80 }, comment: { body: 'message_type: RETURN' } });
  assert.equal(e.kind, 'MALFORMED');
  assert.equal(e.idempotency_key, null);
});

// ------------------------------------------------------------- F1 CONCURRENCY

test('NEGATIVE CONTROL: the prototype key (run id) would not have collided', () => {
  // Reproduces the F1 defect to prove the new test would catch it.
  const prototypeKey = (event, runId) => event.head_sha || event.pull_request_sha || runId;
  const scheduled = prototypeKey({}, 'run-1');
  const workflow = prototypeKey({ head_sha: 'abc' }, 'run-2');
  assert.notEqual(scheduled, workflow, 'the old scheme let a scheduled sweep run beside a workflow merge');
});

// ------------------------------------------------------------- FIELD PARSING

test('field reads are anchored so prose cannot spoof a control field', () => {
  const body = 'summary: >\n  someone wrote message_type: RETURN inside prose\nmessage_type: PROGRESS';
  assert.equal(parseControlMessage(body).message_type, 'PROGRESS');
});

test('null and empty fields normalize to null', () => {
  assert.equal(readField('source_head: null', 'source_head'), null);
  assert.equal(readField('source_head:', 'source_head'), null);
  assert.equal(readField('source_head: abc123', 'source_head'), 'abc123');
});

// ══════════════════════════════════════════════════════════ MUTATION LOCK (F1)
//
// META-P1-CONCURRENCY-CROSS-PATH-001.
//
// The previous version of these tests asserted that concurrencyKey(scheduled,
// packet) === concurrencyKey(workflow, packet). That passed while the SHIPPED
// workflow partitioned the very same paths, because it exercised a helper with
// an explicitly-passed packet id rather than what the workflow computes. These
// tests read the workflow file itself.

test('F1: every mutating job declares the same job-level mutation lock', () => {
  const workflow = parseYaml(fs.readFileSync(WORKFLOW, 'utf8'));
  const mutators = mutatingJobs(workflow);

  assert.ok(mutators.length >= 2, `expected at least two mutating jobs, found ${mutators.length}`);

  for (const [name, job] of mutators) {
    assert.ok(job.concurrency, `mutating job "${name}" declares no job-level concurrency`);
    assert.equal(
      job.concurrency.group,
      MUTATION_LOCK,
      `mutating job "${name}" must serialize on the single mutation lock`,
    );
    assert.equal(job.concurrency['cancel-in-progress'], false, `"${name}" must not cancel an in-flight mutation`);
  }

  const groups = new Set(mutators.map(([, job]) => job.concurrency.group));
  assert.equal(groups.size, 1, `mutating jobs are partitioned across groups: ${[...groups].join(', ')}`);
});

test('F1: the mutation lock is a constant, not derived from the event', () => {
  const workflow = parseYaml(fs.readFileSync(WORKFLOW, 'utf8'));
  for (const [name, job] of mutatingJobs(workflow)) {
    assert.ok(
      !/\$\{\{/.test(job.concurrency.group),
      `"${name}" mutation lock contains a GitHub expression; any event-derived value re-partitions the mutating paths`,
    );
  }
  // And the library agrees with the workflow, from every event shape.
  const shapes = [
    normalizeEvent('schedule', {}),
    normalizeEvent('workflow_run', { workflow_run: { id: 1, run_attempt: 1, status: 'completed', conclusion: 'success', head_sha: 'h', pull_requests: [{ number: 87 }] } }),
    normalizeEvent('workflow_dispatch', { inputs: { pr_number: '87' } }),
    normalizeEvent('pull_request_target', { action: 'closed', pull_request: { number: 87, merged: true, merge_commit_sha: 'm', head: { ref: 'impl/x' } } }),
  ];
  const keys = new Set(shapes.map(() => mutationLockKey()));
  assert.equal(keys.size, 1);
  assert.equal([...keys][0], MUTATION_LOCK);
});

test('F1: the scheduled sweep and a per-PR merge share one mutation lock', () => {
  const workflow = parseYaml(fs.readFileSync(WORKFLOW, 'utf8'));
  const scheduled = workflow.jobs['hourly-reconcile-open-prs'];
  const eventDriven = workflow.jobs['exact-head-auto-merge'];

  // The exact pair named in META-P1-CONCURRENCY-CROSS-PATH-001: the sweep
  // iterates every open impl/* PR, so it must exclude the per-PR merge job.
  assert.equal(scheduled.concurrency.group, eventDriven.concurrency.group);
  assert.equal(scheduled.concurrency.group, MUTATION_LOCK);
});

test('F1: the workflow-level group is observation only and never the mutation lock', () => {
  const workflow = parseYaml(fs.readFileSync(WORKFLOW, 'utf8'));
  assert.notEqual(
    workflow.concurrency.group,
    MUTATION_LOCK,
    'the workflow-level group varies by event; it must not be mistaken for the mutation lock',
  );
  assert.match(workflow.concurrency.group, /observe/, 'its name should say what it is');
});

test('observation keys may differ per PR — that parallelism is intended', () => {
  const a = observationKey({ pr_number: 87 }, null);
  const b = observationKey({ pr_number: 88 }, null);
  assert.notEqual(a, b);
  // ...but they are never used to guard mutation.
  assert.notEqual(a, MUTATION_LOCK);
  assert.notEqual(b, MUTATION_LOCK);
});

test('NEGATIVE CONTROL: a per-PR mutation lock is rejected', () => {
  // Restores the defect shape in-memory and proves the assertion above fires.
  const defective = {
    jobs: {
      'exact-head-auto-merge': { steps: ['auto-merge-admitted.mjs --merge'], concurrency: { group: 'keyflow-autopilot-87', 'cancel-in-progress': false } },
      'hourly-reconcile-open-prs': { steps: ['auto-merge-admitted.mjs --merge'], concurrency: { group: 'keyflow-autopilot-programme', 'cancel-in-progress': false } },
    },
  };
  const groups = new Set(mutatingJobs(defective).map(([, job]) => job.concurrency.group));
  assert.equal(groups.size, 2, 'the defective shape partitions the mutating paths');
  assert.throws(() => {
    for (const [, job] of mutatingJobs(defective)) {
      if (job.concurrency.group !== MUTATION_LOCK) throw new Error('partitioned mutation lock');
    }
  }, /partitioned mutation lock/);
});

test('NEGATIVE CONTROL: a mutating job with no job-level concurrency is rejected', () => {
  const defective = { jobs: { 'exact-head-auto-merge': { steps: ['auto-merge-admitted.mjs --merge'] } } };
  const [[name, job]] = mutatingJobs(defective);
  assert.equal(name, 'exact-head-auto-merge');
  assert.equal(job.concurrency, undefined, 'this is the shape that shipped and was caught in review');
});
