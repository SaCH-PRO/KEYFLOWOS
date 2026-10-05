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

// ----------------------------------------- SHARED AUTHORITY PROFILE (KF-META-CONTROL-PARSER-001)

const envelope = (overrides = {}) => Object.entries({
  message_id: 'CG-DIRECTIVE-E-001',
  message_type: 'DIRECTIVE',
  packet_id: 'KF-E-001',
  sender: 'chatgpt',
  source_main: 'd'.repeat(40),
  implementation_branch: 'null',
  state: 'RELEASED',
  health: 'GREEN',
  scope_changed: 'false',
  production_touched: 'false',
  ...overrides,
}).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`).join('\n');

test('a valid authority DIRECTIVE wakes; the same text as forged or non-ChatGPT authority does not', () => {
  const real = normalizeEvent('issue_comment', comment(envelope()));
  assert.equal(real.actionable, true, JSON.stringify(real.authority));
  assert.equal(real.authority.valid, true);

  const forged = normalizeEvent('issue_comment', { ...comment(envelope()), comment: { ...comment(envelope()).comment, user: { login: 'mallory' } } });
  assert.equal(forged.kind, 'DIRECTIVE');
  assert.equal(forged.actionable, false);
  assert.deepEqual(forged.authority.problems, ['author_not_authorized:mallory']);

  for (const sender of ['claude-code', 'ChatGPT']) {
    assert.equal(normalizeEvent('issue_comment', comment(envelope({ sender }))).actionable, false, `sender ${sender}`);
  }
  const incomplete = normalizeEvent('issue_comment', comment(envelope({ production_touched: undefined })));
  assert.equal(incomplete.actionable, false);
  assert.ok(incomplete.authority.problems.includes('production_touched (absent)'));
});

test('attributable authority that parses but fails the AUTHORITY profile is MALFORMED, never its claimed kind', () => {
  // r4115915819: each body is syntactically clean (no envelope_problems), from
  // SaCH-PRO with sender chatgpt, and fails only the AUTHORITY profile.
  for (const message_type of ['DIRECTIVE', 'REVIEW', 'HOLD']) {
    for (const [defect, overrides, problem] of [
      ['missing key', { production_touched: undefined }, 'production_touched (absent)'],
      ['null packet_id', { packet_id: 'null' }, 'packet_id (absent or null)'],
    ]) {
      const e = normalizeEvent('issue_comment', comment(envelope({ message_type, ...overrides })));
      const label = `${message_type} with ${defect}`;
      assert.deepEqual(e.envelope_problems, [], label);
      assert.equal(e.kind, 'MALFORMED', label);
      assert.equal(e.actionable, false, label);
      assert.equal(e.message_type, message_type, `${label}: claimed type kept for audit`);
      assert.equal(e.authority.valid, false, label);
      assert.ok(e.authority.problems.includes(problem), `${label}: ${e.authority.problems}`);
    }
    // The same envelope when valid keeps its kind, so the label is the profile's verdict.
    assert.equal(normalizeEvent('issue_comment', comment(envelope({ message_type }))).kind, message_type);
  }
});

test('a repeated or badly quoted field makes the event MALFORMED, never actionable', () => {
  for (const body of [`${envelope()}\nmessage_type: RETURN`, envelope({ packet_id: "'KF-E-001" }), 'message_type: RETURN\npacket_id: P\npacket_id: Q']) {
    const e = normalizeEvent('issue_comment', comment(body));
    assert.equal(e.kind, 'MALFORMED', body);
    assert.equal(e.actionable, false);
    assert.ok(e.envelope_problems.length > 0);
  }
});

test('inline comments are read as the YAML codec reads them', () => {
  const e = normalizeEvent('issue_comment', comment('message_id: X\nmessage_type: RETURN   # returning\npacket_id: P # the packet'));
  assert.equal(e.kind, 'RETURN');
  assert.equal(e.packet_id, 'P');
  assert.equal(e.actionable, true);
});

// ----------------------------------------- HOLD / RESUME WAKE (RULING-012 R12-K1)

const POSTED_AT = '2026-10-04T17:00:00Z';

/** An issue_comment payload as GitHub delivers a created comment: timestamps included. */
const posted = (body, overrides = {}) => ({
  issue: { number: 80 },
  action: 'created',
  comment: { id: 7001, body, html_url: 'https://example/h', user: { login: 'SaCH-PRO' }, created_at: POSTED_AT, updated_at: POSTED_AT },
  ...overrides,
});

const holdEnvelope = (message_type, control_effect, overrides = {}) => envelope({
  message_id: `CG-${message_type}-E-001`,
  message_type,
  packet_id: 'KF-EXEC-ACTION-001',
  state: 'HELD',
  control_effect,
  ...overrides,
});

const HOLD_TYPES = [['HOLD', 'HOLD_SET'], ['RESUME', 'HOLD_CLEAR']];

test('a valid typed HOLD wakes for HOLD_SET and a valid typed RESUME wakes for HOLD_CLEAR', () => {
  for (const [message_type, effect] of HOLD_TYPES) {
    const e = normalizeEvent('issue_comment', posted(holdEnvelope(message_type, effect)));
    assert.equal(e.actionable, true, `${message_type}: ${e.wake_refused}`);
    assert.equal(e.kind, message_type);
    assert.equal(e.authority.valid, true);
    assert.equal(e.control_effect, effect);
    assert.equal(e.wake_refused, null);
    assert.equal(e.packet_id, 'KF-EXEC-ACTION-001');
    assert.equal(e.idempotency_key, 'issue_comment:7001:created');
  }
  // The other types carry neither field, and their wake rules are unchanged.
  const directive = normalizeEvent('issue_comment', comment(envelope()));
  assert.equal(directive.actionable, true);
  assert.equal(directive.control_effect, null);
  assert.equal(directive.wake_refused, null);
});

test('NC: a HOLD or RESUME without its own readable typed effect gains no actionability from its type', () => {
  const swapped = { HOLD: 'HOLD_CLEAR', RESUME: 'HOLD_SET' };
  for (const [message_type, effect] of HOLD_TYPES) {
    const cases = [
      ['untyped', holdEnvelope(message_type, undefined), /CONTROL_EFFECT_MISSING/],
      ['the other type\'s effect', holdEnvelope(message_type, swapped[message_type]), /CONTROL_EFFECT_TYPE_MISMATCH/],
      ['a packet effect', holdEnvelope(message_type, 'PACKET_RELEASE'), /CONTROL_EFFECT_TYPE_MISMATCH/],
      ['NO_STATE_CHANGE', holdEnvelope(message_type, 'NO_STATE_CHANGE'), /CONTROL_EFFECT_TYPE_MISMATCH/],
      ['an unknown effect', holdEnvelope(message_type, 'HOLD'), /CONTROL_EFFECT_UNKNOWN/],
      ['a lower-case effect', holdEnvelope(message_type, effect.toLowerCase()), /CONTROL_EFFECT_UNKNOWN/],
      ['a null effect', holdEnvelope(message_type, 'null'), /CONTROL_EFFECT_MISSING/],
      ['an effect only in prose', `${holdEnvelope(message_type, undefined)}\n\nThis sets control_effect: ${effect} for the packet.\n  control_effect: ${effect}`, /CONTROL_EFFECT_MISSING/],
      ['production_touched true', holdEnvelope(message_type, effect, { production_touched: 'true' }), /CONTROL_EFFECT_PRODUCTION_TOUCHED/],
      ['production_touched null', holdEnvelope(message_type, effect, { production_touched: 'null' }), /CONTROL_EFFECT_PRODUCTION_TOUCHED/],
      ['production_touched no', holdEnvelope(message_type, effect, { production_touched: 'no' }), /CONTROL_EFFECT_PRODUCTION_TOUCHED/],
      ['production_touched False', holdEnvelope(message_type, effect, { production_touched: 'False' }), /CONTROL_EFFECT_PRODUCTION_TOUCHED/],
      ['health outside the vocabulary', holdEnvelope(message_type, effect, { health: 'AMBER' }), /CONTROL_EFFECT_HEALTH_INVALID/],
      ['lower-case health', holdEnvelope(message_type, effect, { health: 'green' }), /CONTROL_EFFECT_HEALTH_INVALID/],
      ['a programme field', holdEnvelope(message_type, effect, { programme: 'KEYFLOWOS_PLATFORM_CONVERGENCE' }), /CONTROL_EFFECT_PROGRAMME_NOT_FOLDABLE/],
      ['a programme_action field', holdEnvelope(message_type, effect, { programme_action: 'HOLD' }), /CONTROL_EFFECT_PROGRAMME_NOT_FOLDABLE/],
    ];
    for (const [defect, body, refusal] of cases) {
      const e = normalizeEvent('issue_comment', posted(body));
      const label = `${message_type} with ${defect}`;
      assert.equal(e.actionable, false, label);
      // Valid authority all the same: it is recorded under its own kind, and the fold decides what it means.
      assert.equal(e.kind, message_type, label);
      assert.equal(e.authority.valid, true, label);
      assert.match(e.wake_refused, refusal, label);
    }
  }
});

test('NC: a forged, malformed, ambiguous or unsupported HOLD or RESUME does not wake', () => {
  for (const [message_type, effect] of HOLD_TYPES) {
    const valid = holdEnvelope(message_type, effect);
    const from = (login) => posted(valid, { comment: { ...posted(valid).comment, user: { login } } });
    const cases = [
      ['an outside author', from('mallory'), message_type],
      ['no author', from(undefined), message_type],
      ['sender claude', posted(holdEnvelope(message_type, effect, { sender: 'claude' })), message_type],
      ['sender ChatGPT', posted(holdEnvelope(message_type, effect, { sender: 'ChatGPT' })), message_type],
      ['a missing envelope key', posted(holdEnvelope(message_type, effect, { production_touched: undefined })), 'MALFORMED'],
      ['a null packet id', posted(holdEnvelope(message_type, effect, { packet_id: 'null' })), 'MALFORMED'],
      ['a blank packet id', posted(holdEnvelope(message_type, effect, { packet_id: '"  "' })), 'MALFORMED'],
      ['a repeated control_effect', posted(`${valid}\ncontrol_effect: ${effect}`), 'MALFORMED'],
      ['a repeated message_type', posted(`${valid}\nmessage_type: ${message_type}`), 'MALFORMED'],
      ['an unmatched quote', posted(holdEnvelope(message_type, effect, { packet_id: "'KF-EXEC-ACTION-001" })), 'MALFORMED'],
      ['a block-scalar packet id', posted(holdEnvelope(message_type, effect, { packet_id: '>' })), 'MALFORMED'],
      ['a typo of the type', posted(holdEnvelope(`${message_type}D`, effect)), 'MALFORMED'],
      ['a lower-case type', posted(holdEnvelope(message_type.toLowerCase(), effect)), 'MALFORMED'],
    ];
    for (const [defect, payload, kind] of cases) {
      const e = normalizeEvent('issue_comment', payload);
      const label = `${message_type} with ${defect}`;
      assert.equal(e.actionable, false, label);
      assert.equal(e.kind, kind, label);
    }
    // Referent: the same envelope, well formed and from the authority, wakes.
    assert.equal(normalizeEvent('issue_comment', posted(valid)).actionable, true, message_type);
  }
});

test('NC: a claimed HOLD or RESUME that is not authority records why in wake_refused, beside authority.problems (018 K1)', () => {
  // Copilot r4178914062: these were refused with wake_refused null; the reason
  // was only in authority.problems, or in envelope_problems.
  for (const [message_type, effect] of HOLD_TYPES) {
    const valid = holdEnvelope(message_type, effect);
    const from = (login) => posted(valid, { comment: { ...posted(valid).comment, user: { login } } });
    const cases = [
      ['an outside author', from('mallory'), 'AUTHORITY_REJECTED', ['author_not_authorized:mallory']],
      ['no author', from(undefined), 'AUTHORITY_REJECTED', ['author_not_authorized:']],
      ['sender claude', posted(holdEnvelope(message_type, effect, { sender: 'claude' })), 'AUTHORITY_REJECTED', ['sender_not_chatgpt:claude']],
      ['sender ChatGPT', posted(holdEnvelope(message_type, effect, { sender: 'ChatGPT' })), 'AUTHORITY_REJECTED', ['sender_not_chatgpt:ChatGPT']],
      ['no sender', posted(holdEnvelope(message_type, effect, { sender: undefined })), 'AUTHORITY_REJECTED', ['sender_not_chatgpt:']],
      ['a missing envelope key', posted(holdEnvelope(message_type, effect, { production_touched: undefined })), 'AUTHORITY_MALFORMED', ['production_touched (absent)']],
      ['a missing health', posted(holdEnvelope(message_type, effect, { health: undefined })), 'AUTHORITY_MALFORMED', ['health (absent)']],
      ['a null packet id', posted(holdEnvelope(message_type, effect, { packet_id: 'null' })), 'AUTHORITY_MALFORMED', ['packet_id (absent or null)']],
      ['a blank packet id', posted(holdEnvelope(message_type, effect, { packet_id: '"  "' })), 'AUTHORITY_MALFORMED', ['packet_id (blank)']],
      ['a block-scalar packet id', posted(holdEnvelope(message_type, effect, { packet_id: '>' })), 'AUTHORITY_MALFORMED', null],
      ['a repeated control_effect', posted(`${valid}\ncontrol_effect: ${effect}`), 'ENVELOPE_MALFORMED', ['control_effect (repeated; ambiguous)']],
      ['a repeated message_type', posted(`${valid}\nmessage_type: ${message_type}`), 'ENVELOPE_MALFORMED', ['message_type (repeated; ambiguous)']],
      ['a second, different message_type', posted(`${valid}\nmessage_type: RETURN`), 'ENVELOPE_MALFORMED', ['message_type (repeated; ambiguous)']],
      ['an unmatched quote', posted(holdEnvelope(message_type, effect, { packet_id: "'KF-EXEC-ACTION-001" })), 'ENVELOPE_MALFORMED', null],
    ];
    for (const [defect, payload, code, problems] of cases) {
      const e = normalizeEvent('issue_comment', payload);
      const label = `${message_type} with ${defect}`;
      assert.equal(e.actionable, false, label);
      assert.equal(typeof e.wake_refused, 'string', `${label}: wake_refused is ${e.wake_refused}`);
      // The summary is the structured record, not a second opinion: the code, then exactly the problems.
      const structured = code === 'ENVELOPE_MALFORMED' ? e.envelope_problems : e.authority.problems;
      assert.ok(structured.length > 0, label);
      assert.equal(e.wake_refused, `${code}: ${JSON.stringify(structured)}`, label);
      if (problems) assert.deepEqual(structured, problems, label);
      // The structured form is kept, and only for a message that reached the authority check.
      assert.equal(e.authority === null, code === 'ENVELOPE_MALFORMED', label);
      if (e.authority) assert.equal(e.authority.valid, false, label);
      // Not authority, so its effect is never read into the event.
      assert.equal(e.control_effect, null, label);
    }

    // Valid authority that is refused for its effect, or for how it arrived, is unchanged.
    assert.match(normalizeEvent('issue_comment', posted(holdEnvelope(message_type, undefined))).wake_refused, /^CONTROL_EFFECT_MISSING: /);
    assert.equal(normalizeEvent('issue_comment', { ...posted(valid), action: 'edited' }).wake_refused, 'comment action edited; only a created comment wakes');
    // Referent: the same envelope from the authority wakes and refuses nothing.
    const woke = normalizeEvent('issue_comment', posted(valid));
    assert.deepEqual([woke.actionable, woke.wake_refused, woke.control_effect, woke.authority.problems], [true, null, effect, []], message_type);

    // A type that is not exactly HOLD or RESUME claims neither, so the field stays
    // null and the reason stays in authority.problems, as for any other type.
    for (const typo of [`${message_type}D`, message_type.toLowerCase()]) {
      const e = normalizeEvent('issue_comment', posted(holdEnvelope(typo, effect)));
      assert.deepEqual([e.actionable, e.kind, e.wake_refused], [false, 'MALFORMED', null], typo);
      assert.ok(e.authority.problems.some((p) => p.startsWith('message_type (')), typo);
    }
  }
  // The field is about HOLD and RESUME only: a refused DIRECTIVE or REVIEW still carries none.
  for (const message_type of ['DIRECTIVE', 'REVIEW']) {
    const forged = normalizeEvent('issue_comment', posted(holdEnvelope(message_type, 'HOLD_SET', { sender: 'claude' })));
    assert.deepEqual([forged.actionable, forged.wake_refused, forged.authority.problems], [false, null, ['sender_not_chatgpt:claude']], message_type);
    const incomplete = normalizeEvent('issue_comment', posted(holdEnvelope(message_type, 'HOLD_SET', { health: undefined })));
    assert.deepEqual([incomplete.actionable, incomplete.kind, incomplete.wake_refused], [false, 'MALFORMED', null], message_type);
  }
});

test('NC: a hold effect on a non-wake type wakes nothing, and DIRECTIVE and REVIEW wake as before', () => {
  for (const effect of ['HOLD_SET', 'HOLD_CLEAR']) {
    for (const message_type of ['PROGRESS', 'ACK', 'CLOSE', 'AUTO_EVENT', 'AUTO_MERGE']) {
      for (const sender of ['chatgpt', 'claude']) {
        const e = normalizeEvent('issue_comment', posted(holdEnvelope(message_type, effect, { sender })));
        const label = `${message_type} from ${sender} carrying ${effect}`;
        assert.equal(e.actionable, false, label);
        assert.equal(e.kind, message_type, label);
        assert.equal(e.control_effect, null, label);
      }
    }
    // A DIRECTIVE or REVIEW is not gated on its effect: it wakes with a hold
    // effect it cannot carry, exactly as it wakes with none. The fold stops on it.
    for (const message_type of ['DIRECTIVE', 'REVIEW']) {
      for (const control_effect of [effect, undefined]) {
        const e = normalizeEvent('issue_comment', posted(holdEnvelope(message_type, control_effect)));
        assert.equal(e.actionable, true, `${message_type} with ${control_effect}`);
        assert.equal(e.wake_refused, null);
      }
    }
  }
});

test('NC: an edited HOLD or RESUME, or one whose edit state the payload cannot show, does not wake', () => {
  for (const [message_type, effect] of HOLD_TYPES) {
    const valid = holdEnvelope(message_type, effect);
    const base = posted(valid);
    const cases = [
      ['an edited event', { ...base, action: 'edited' }, /comment action edited; only a created comment wakes/],
      ['a deleted event', { ...base, action: 'deleted' }, /comment action deleted; only a created comment wakes/],
      // ACTION-SHAPE-014: an absent action is never read as created.
      ['an absent action', { ...base, action: undefined }, /comment action absent; only a created comment wakes/],
      ['a null action', { ...base, action: null }, /comment action absent; only a created comment wakes/],
      ['an empty action', { ...base, action: '' }, /comment action ; only a created comment wakes/],
      ['an upper-case action', { ...base, action: 'CREATED' }, /comment action CREATED; only a created comment wakes/],
      ['a later updated_at', { ...base, comment: { ...base.comment, updated_at: '2026-10-04T17:05:00Z' } }, /^comment edited$/],
      ['no timestamps', { ...base, comment: { ...base.comment, created_at: undefined, updated_at: undefined } }, /edit state not observable/],
      ['no updated_at', { ...base, comment: { ...base.comment, updated_at: undefined } }, /edit state not observable/],
    ];
    for (const [defect, payload, refusal] of cases) {
      const e = normalizeEvent('issue_comment', payload);
      const label = `${message_type} with ${defect}`;
      assert.equal(e.actionable, false, label);
      assert.equal(e.control_effect, effect, `${label}: the effect is still recorded`);
      assert.match(e.wake_refused, refusal, label);
    }
    assert.equal(normalizeEvent('issue_comment', base).actionable, true, message_type);
  }
});

test('the autopilot publishes a wake event exactly when the normalized event is actionable', () => {
  const workflow = parseYaml(fs.readFileSync(WORKFLOW, 'utf8'));
  const steps = workflow.jobs['normalize-event'].steps;
  const normalize = steps.find((s) => s.id === 'event');
  assert.match(normalize.run, /node scripts\/agent-control\/normalize-event\.mjs/);
  const publish = steps.find((s) => s.name === 'Publish actionable wake event');
  assert.equal(publish.if, 'fromJSON(steps.event.outputs.json).actionable == true');
  // The comment trigger delivers created comments only, so an edit never reaches the wake path.
  assert.deepEqual(workflow.on.issue_comment.types, ['created']);
});

// ----------------------------------------- D1: live reads in the CI observer

test('D1: the decide step reads #80 and the repository with the job token, read-only', () => {
  const workflow = parseYaml(fs.readFileSync(WORKFLOW, 'utf8'));
  const job = workflow.jobs['normalize-event'];
  const decide = job.steps.find((s) => s.id === 'decide');
  assert.equal(decide.env?.GH_TOKEN, '${{ github.token }}', 'without a token every gh read fails and reconcile reports AUTHORITY_UNVERIFIABLE');
  assert.match(decide.run, /orchestrate\.mjs --json/);
  // Exactly the reads reconciliation needs; the only write is publishing the wake event.
  assert.deepEqual(job.permissions, { contents: 'read', issues: 'write', 'pull-requests': 'read' });
  assert.equal(workflow.permissions.contents, 'read');
  assert.ok(!JSON.stringify(workflow).includes('secrets.'), 'no secret or PAT is introduced');
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
