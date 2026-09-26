import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseYaml } from '../lib/yaml.mjs';
import { buildDag, proveDrainable, selectNext } from '../lib/dag.mjs';
import {
  PLATFORM_DAG_PATH,
  PLATFORM_PROGRAMME_ID,
  PLATFORM_STATES,
  REQUIRED_HUMAN_GATES,
  loadAutopilotPolicy,
  loadPlatformDag,
  platformProgrammeState,
  validatePlatformContract,
} from '../lib/platform-dag.mjs';

const repoRoot = process.cwd();
const clone = (value) => JSON.parse(JSON.stringify(value));
const codes = (problems) => problems.map((p) => p.code);

// ---------------------------------------------------------------- TOPOLOGY

test('platform DAG parses with the repository YAML codec and drains completely', () => {
  const { doc, dag } = loadPlatformDag(repoRoot);
  assert.equal(doc.programme, PLATFORM_PROGRAMME_ID);
  assert.equal(PLATFORM_PROGRAMME_ID, 'KEYFLOWOS_PLATFORM_CONVERGENCE');
  assert.equal(dag.packetsTotal, 63);
  const proof = proveDrainable(dag);
  assert.equal(proof.drained, true, `graph stalled after ${proof.stalled_after} of ${dag.phasesTotal}`);
  assert.equal(proof.order.length, 63);
});

test('every packet except the root carries an explicit dependency edge', () => {
  const { dag } = loadPlatformDag(repoRoot);
  const roots = dag.nodes.filter((n) => n.resolved_depends_on.length === 0).map((n) => n.key);
  assert.deepEqual(roots, ['KF-PLAT-AUTO-001']);
});

test('the drain order honours every declared edge', () => {
  const { dag } = loadPlatformDag(repoRoot);
  const { order } = proveDrainable(dag);
  for (const node of dag.nodes) {
    for (const dep of node.resolved_depends_on) {
      assert.ok(order.indexOf(dep) < order.indexOf(node.key), `${dep} must precede ${node.key}`);
    }
  }
});

test('named ordering constraints from the programme are encoded as edges', () => {
  const { dag } = loadPlatformDag(repoRoot);
  const deps = (key) => dag.byKey.get(key).resolved_depends_on;
  // KF-INFRA-002 consumes the admitted result of KF-INFRA-001.
  assert.ok(deps('KF-INFRA-002').includes('KF-INFRA-001'));
  // The end-to-end proof follows the first two P0 packets.
  assert.ok(deps('KF-PLAT-AUTO-003').includes('KF-PLAT-AUTO-002'));
  assert.ok(deps('KF-PLAT-AUTO-002').includes('KF-PLAT-AUTO-001'));
  // Cutover follows characterization; retirement follows cutover.
  assert.ok(deps('KF-INFRA-004').includes('KF-INFRA-003'));
  assert.ok(deps('KF-INFRA-005').includes('KF-INFRA-004'));
});

test('after P0 only packets whose own edges are complete are ready', () => {
  const { dag } = loadPlatformDag(repoRoot);
  const selection = selectNext(dag, ['KF-PLAT-AUTO-001', 'KF-PLAT-AUTO-002', 'KF-PLAT-AUTO-003']);
  const ready = selection.eligible.map((n) => n.key).sort();
  assert.deepEqual(ready, ['KF-GOV-001', 'KF-INFRA-001']);
  assert.equal(selection.selected.key, 'KF-INFRA-001', 'lowest ready phase is preferred');
});

test('NEGATIVE CONTROL: phase grouping without an edge lets dependent work start early', () => {
  // Proves the edge assertions above are not vacuous: drop one edge and the
  // selector really does dispatch KF-INFRA-002 before KF-INFRA-001.
  const { doc } = loadPlatformDag(repoRoot);
  const broken = clone(doc);
  broken.packets.find((p) => p.id === 'KF-INFRA-002').depends_on = [];
  const dag = buildDag(broken);
  const ready = selectNext(dag, ['KF-PLAT-AUTO-001', 'KF-PLAT-AUTO-002', 'KF-PLAT-AUTO-003']).eligible.map((n) => n.key);
  assert.ok(ready.includes('KF-INFRA-002'), 'without the edge, INFRA-002 is dispatchable alongside INFRA-001');
});

test('NEGATIVE CONTROL: the previous flow-mapping shape is rejected by the YAML codec', () => {
  const previous = `
packets:
  KF-PLAT-AUTO-001: { phase: P0, depends_on: [] }
`;
  assert.throws(() => parseYaml(previous), /non-empty flow mappings are not supported/);
});

test('NEGATIVE CONTROL: a dependency cycle in the platform DAG is rejected', () => {
  const { doc } = loadPlatformDag(repoRoot);
  const cyclic = clone(doc);
  cyclic.packets.find((p) => p.id === 'KF-PLAT-AUTO-001').depends_on = ['KF-PLAT-AUTO-003'];
  assert.throws(() => buildDag(cyclic), (err) => codes(err.problems).includes('DEPENDENCY_CYCLE'));
});

test('NEGATIVE CONTROL: a miscounted packet total is rejected', () => {
  const { doc } = loadPlatformDag(repoRoot);
  const miscounted = clone(doc);
  miscounted.packets = miscounted.packets.filter((p) => p.id !== 'KF-QUAL-003');
  assert.throws(() => buildDag(miscounted), (err) => codes(err.problems).includes('PACKET_COUNT_MISMATCH'));
});

// ---------------------------------------------------------------- GATES AND CONTRACT

test('the committed DAG satisfies the gate and activation contract', () => {
  const { doc } = loadPlatformDag(repoRoot);
  assert.deepEqual(validatePlatformContract(doc, loadAutopilotPolicy(repoRoot)), []);
});

test('every human-only gate required by the correction directive is declared', () => {
  const { doc } = loadPlatformDag(repoRoot);
  const ids = doc.human_gates.gates.map((g) => g.id);
  for (const required of [
    'production_deployment_or_release',
    'production_mutation',
    'production_data_mutation',
    'production_dns_or_domain_cutover',
    'destructive_production_data_or_schema_action',
    'paid_resource_creation',
    'secret_or_oauth_entry_without_safe_connected_writer',
    'unauthorized_real_provider_traffic',
    'major_architecture_override',
    'weakening_security_tenancy_branch_ci_proof_review_or_admission_gate',
  ]) {
    assert.ok(ids.includes(required), `missing human gate ${required}`);
  }
});

test('every never_automatic effect of the active policy is inherited, including rebaseline and map refresh', () => {
  const { doc } = loadPlatformDag(repoRoot);
  const policy = loadAutopilotPolicy(repoRoot);
  assert.ok(policy.never_automatic.includes('forensic_rebaseline'));
  assert.ok(policy.never_automatic.includes('programme_map_refresh'));
  for (const effect of policy.never_automatic) {
    assert.ok(doc.human_gates.inherited_never_automatic.includes(effect), `${effect} not inherited`);
  }
});

test('a secret-connection packet carries the secret gate, not only the paid gate', () => {
  const { doc } = loadPlatformDag(repoRoot);
  const gates = doc.packets.find((p) => p.id === 'KF-CONFIG-003').human_gates.map((g) => g.gate);
  assert.ok(gates.includes('secret_or_oauth_entry_without_safe_connected_writer'));
  assert.ok(gates.includes('paid_resource_creation'));
});

test('NEGATIVE CONTROL: dropping an inherited never_automatic effect is caught', () => {
  const { doc } = loadPlatformDag(repoRoot);
  const weakened = clone(doc);
  weakened.human_gates.inherited_never_automatic = weakened.human_gates.inherited_never_automatic.filter((e) => e !== 'programme_map_refresh');
  const problems = validatePlatformContract(weakened, loadAutopilotPolicy(repoRoot));
  assert.ok(problems.some((p) => p.code === 'INHERITED_GATE_MISSING' && /programme_map_refresh/.test(p.detail)));
});

test('NEGATIVE CONTROL: a packet referencing an undeclared gate is caught', () => {
  const { doc } = loadPlatformDag(repoRoot);
  const broken = clone(doc);
  broken.packets.find((p) => p.id === 'KF-INFRA-004').human_gates[0].gate = 'production_dns_cutover';
  assert.ok(codes(validatePlatformContract(broken, loadAutopilotPolicy(repoRoot))).includes('PACKET_GATE_UNKNOWN'));
});

test('NEGATIVE CONTROL: making gates per-packet only is caught', () => {
  const { doc } = loadPlatformDag(repoRoot);
  const broken = clone(doc);
  broken.human_gates.applies_to_every_packet = false;
  assert.ok(codes(validatePlatformContract(broken, loadAutopilotPolicy(repoRoot))).includes('GATES_NOT_GLOBAL'));
});

test('NEGATIVE CONTROL: the file cannot declare itself active', () => {
  const { doc } = loadPlatformDag(repoRoot);
  const broken = clone(doc);
  broken.status = 'ACTIVE';
  assert.ok(codes(validatePlatformContract(broken, loadAutopilotPolicy(repoRoot))).includes('FILE_DECLARES_ACTIVATION'));
});

test('NEGATIVE CONTROL: activation by a non-DIRECTIVE or without the action field is caught', () => {
  const { doc } = loadPlatformDag(repoRoot);
  const policy = loadAutopilotPolicy(repoRoot);
  const byReview = clone(doc);
  byReview.activation.activate.message_type = 'REVIEW';
  assert.ok(codes(validatePlatformContract(byReview, policy)).includes('ACTIVATION_TYPE_NOT_DIRECTIVE'));
  const noAction = clone(doc);
  delete noAction.activation.activate.required_fields.programme_action;
  assert.ok(codes(validatePlatformContract(noAction, policy)).includes('ACTIVATION_ACTION_FIELD'));
  const failOpen = clone(doc);
  failOpen.activation.evaluation.no_matching_message = 'ACTIVE';
  assert.ok(codes(validatePlatformContract(failOpen, policy)).includes('ACTIVATION_FAILS_OPEN'));
});

// ---------------------------------------------------------------- ACTIVATION STATE

let nextId = 1000;
function comment(fields, { author = 'SaCH-PRO', at } = {}) {
  nextId += 1;
  const body = ['```yaml', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '```'].join('\n');
  return { id: nextId, created_at: at || `2026-09-25T10:${String(nextId % 60).padStart(2, '0')}:00Z`, user: { login: author }, body };
}
const activateFields = (extra = {}) => ({
  message_id: `CG-DIRECTIVE-TEST-${nextId}`,
  message_type: 'DIRECTIVE',
  packet_id: 'KF-PLAT-AUTO-001',
  sender: 'chatgpt',
  source_main: 'ad97ea48841a0a4acb13f9a170bae0e07159d6f4',
  implementation_branch: 'impl/kf-plat-auto-001',
  state: 'CHARACTERIZING',
  health: 'GREEN',
  scope_changed: 'false',
  production_touched: 'false',
  programme: 'KEYFLOWOS_PLATFORM_CONVERGENCE',
  programme_action: 'ACTIVATE',
  ...extra,
});
const without = (fields, key) => {
  const copy = { ...fields };
  delete copy[key];
  return copy;
};
const stateOf = (comments, doc = loadPlatformDag(repoRoot).doc) =>
  platformProgrammeState(comments, doc, loadAutopilotPolicy(repoRoot)).state;

test('the real correction directive does not activate the programme', () => {
  // Names the programme in packet_id and prose and talks about activation, but
  // carries no programme/programme_action field.
  const directive = {
    id: 5830323946,
    created_at: '2026-09-25T09:46:43Z',
    user: { login: 'SaCH-PRO' },
    body: [
      '```yaml',
      'message_id: CG-DIRECTIVE-PLATFORM-PREACTIVATION-CORRECTION-001',
      'message_type: DIRECTIVE',
      'packet_id: KEYFLOWOS_PLATFORM_CONVERGENCE_PREACTIVATION',
      'sender: chatgpt',
      'objective: >',
      '  Correct PR #93 only. Keep KEYFLOWOS_PLATFORM_CONVERGENCE inactive.',
      'prohibited:',
      '  - no activation of KEYFLOWOS_PLATFORM_CONVERGENCE',
      '```',
    ].join('\n'),
  };
  assert.equal(stateOf([directive]), PLATFORM_STATES.INACTIVE);
});

test('an explicit ACTIVATE DIRECTIVE from the authority activates the programme', () => {
  const result = platformProgrammeState([comment(activateFields())], loadPlatformDag(repoRoot).doc, loadAutopilotPolicy(repoRoot));
  assert.equal(result.state, PLATFORM_STATES.ACTIVE);
  assert.equal(result.decided_by.programme_action, 'ACTIVATE');
});

test('no comments, or unobservable comments, leave the programme inactive', () => {
  assert.equal(stateOf([]), PLATFORM_STATES.INACTIVE);
  assert.equal(stateOf(null), PLATFORM_STATES.INACTIVE);
});

test('NEGATIVE CONTROL: an unauthorized author is ignored; a wrong sender never activates', () => {
  assert.equal(stateOf([comment(activateFields(), { author: 'someone-else' })]), PLATFORM_STATES.INACTIVE);
  // From the allowlisted account, a non-exact sender is a malformed message about this programme.
  assert.equal(stateOf([comment(activateFields({ sender: 'claude-code' }))]), PLATFORM_STATES.HELD);
  assert.equal(stateOf([comment(activateFields({ sender: 'ChatGPT' }))]), PLATFORM_STATES.HELD);
});

test('NEGATIVE CONTROL: a caller cannot widen the author allowlist', () => {
  const doc = loadPlatformDag(repoRoot).doc;
  const policy = loadAutopilotPolicy(repoRoot);
  const outsider = [comment(activateFields(), { author: 'someone-else' })];
  assert.equal(platformProgrammeState(outsider, doc, policy, { authors: ['someone-else'] }).state, PLATFORM_STATES.INACTIVE);
});

test('NEGATIVE CONTROL: a newer message without message_id or sender holds an active programme', () => {
  const good = comment(activateFields(), { at: '2026-09-26T10:00:00Z' });
  for (const key of ['message_id', 'sender']) {
    const malformed = comment(without(activateFields({ programme_action: 'ACTIVATE' }), key), { at: '2026-09-26T11:00:00Z' });
    assert.equal(stateOf([good, malformed]), PLATFORM_STATES.HELD, `a newer message missing ${key} must not leave the programme ACTIVE`);
  }
  const wrongSender = comment(activateFields({ sender: 'claude-code' }), { at: '2026-09-26T11:00:00Z' });
  assert.equal(stateOf([good, wrongSender]), PLATFORM_STATES.HELD);
});

test('NEGATIVE CONTROL: REVIEW, RESUME and AUTO_EVENT never activate', () => {
  assert.equal(stateOf([comment(activateFields({ message_type: 'REVIEW' }))]), PLATFORM_STATES.HELD);
  assert.equal(stateOf([comment(activateFields({ message_type: 'RESUME' }))]), PLATFORM_STATES.HELD);
  assert.equal(stateOf([comment(activateFields({ message_type: 'AUTO_EVENT' }))]), PLATFORM_STATES.INACTIVE);
});

test('NEGATIVE CONTROL: a DIRECTIVE naming the programme without ACTIVATE fails closed', () => {
  assert.equal(stateOf([comment(activateFields({ programme_action: 'null' }))]), PLATFORM_STATES.HELD);
  assert.equal(stateOf([comment(activateFields({ programme_action: 'activate' }))]), PLATFORM_STATES.HELD);
});

test('NEGATIVE CONTROL: activation for another programme does not activate this one', () => {
  assert.equal(stateOf([comment(activateFields({ programme: 'KEYFLOWOS_OTHER' }))]), PLATFORM_STATES.INACTIVE);
});

test('NEGATIVE CONTROL: renaming the programme identity together cannot validate or activate', () => {
  // r4104000182: doc.programme and both required_fields.programme renamed in
  // step stay mutually consistent, so only a pinned identity catches them.
  const policy = loadAutopilotPolicy(repoRoot);
  const renamed = clone(loadPlatformDag(repoRoot).doc);
  renamed.programme = 'KEYFLOWOS_OTHER';
  renamed.activation.activate.required_fields.programme = 'KEYFLOWOS_OTHER';
  renamed.activation.hold.required_fields.programme = 'KEYFLOWOS_OTHER';
  const problems = codes(validatePlatformContract(renamed, policy));
  assert.ok(problems.includes('PROGRAMME_IDENTITY_MISMATCH'), `renamed identity must fail validation: ${problems}`);
  assert.ok(problems.includes('ACTIVATION_PROGRAMME_FIELD'));
  // Referent: the same message naming the real programme is well formed and
  // activates against the committed contract, so INACTIVE below is the identity pin.
  assert.equal(stateOf([comment(activateFields())]), PLATFORM_STATES.ACTIVE);
  assert.equal(stateOf([comment(activateFields({ programme: 'KEYFLOWOS_OTHER' }))], renamed), PLATFORM_STATES.INACTIVE);
  assert.equal(stateOf([comment(activateFields())], renamed), PLATFORM_STATES.INACTIVE);
});

test('the newest message naming the programme decides: HOLD after ACTIVATE holds', () => {
  const activate = comment(activateFields(), { at: '2026-09-26T10:00:00Z' });
  const hold = comment(activateFields({ message_type: 'HOLD', programme_action: 'HOLD' }), { at: '2026-09-26T11:00:00Z' });
  assert.equal(stateOf([activate, hold]), PLATFORM_STATES.HELD);
  // Order of the input array is irrelevant; created_at decides.
  assert.equal(stateOf([hold, activate]), PLATFORM_STATES.HELD);
  const reactivate = comment(activateFields(), { at: '2026-09-26T12:00:00Z' });
  assert.equal(stateOf([activate, hold, reactivate]), PLATFORM_STATES.ACTIVE);
});

test('a newer authority message about something else does not change programme state', () => {
  const activate = comment(activateFields(), { at: '2026-09-26T10:00:00Z' });
  const other = comment(
    { message_id: 'CG-DIRECTIVE-OTHER', message_type: 'DIRECTIVE', sender: 'chatgpt', packet_id: 'KF-EXEC-ACTION-001' },
    { at: '2026-09-26T11:00:00Z' },
  );
  assert.equal(stateOf([activate, other]), PLATFORM_STATES.ACTIVE);
});

test('NEGATIVE CONTROL: an ACTIVATE missing any envelope field cannot activate; it holds', () => {
  for (const key of ['message_id', 'packet_id', 'sender', 'source_main', 'implementation_branch', 'state', 'health', 'scope_changed', 'production_touched']) {
    assert.equal(stateOf([comment(without(activateFields(), key))]), PLATFORM_STATES.HELD, `missing ${key} must not activate`);
  }
  // A malformed message cannot activate even after an earlier valid ACTIVATE.
  const good = comment(activateFields(), { at: '2026-09-26T10:00:00Z' });
  const malformed = comment(without(activateFields(), 'health'), { at: '2026-09-26T11:00:00Z' });
  assert.equal(stateOf([good, malformed]), PLATFORM_STATES.HELD);
});

test('source_head satisfies the source_main/source_head envelope slot', () => {
  const fields = without(activateFields({ source_head: '98ee0e0db5b4bb080941138b9edfcd4f52092cd7' }), 'source_main');
  assert.equal(stateOf([comment(fields)]), PLATFORM_STATES.ACTIVE);
  assert.equal(stateOf([comment(without(activateFields(), 'source_main'))]), PLATFORM_STATES.HELD);
});

test('NEGATIVE CONTROL: an edited fallback cannot make unreadable #80 activate', () => {
  const tampered = clone(loadPlatformDag(repoRoot).doc);
  tampered.activation.evaluation.authority_unverifiable = 'ACTIVE';
  tampered.activation.evaluation.no_matching_message = 'ACTIVE';
  tampered.activation.evaluation.unrecognized_programme_action = 'ACTIVE';
  assert.equal(stateOf(null, tampered), PLATFORM_STATES.INACTIVE);
  assert.equal(stateOf([], tampered), PLATFORM_STATES.INACTIVE);
  assert.equal(stateOf([comment(activateFields({ programme_action: 'RESUME' }))], tampered), PLATFORM_STATES.INACTIVE);
});

test('NEGATIVE CONTROL: an edited contract cannot widen who may activate', () => {
  const tampered = clone(loadPlatformDag(repoRoot).doc);
  tampered.activation.activate.message_type = 'REVIEW';
  assert.equal(stateOf([comment(activateFields({ message_type: 'REVIEW' }))], tampered), PLATFORM_STATES.INACTIVE);
  const noEnvelope = clone(loadPlatformDag(repoRoot).doc);
  noEnvelope.activation.required_envelope = ['message_id'];
  assert.ok(codes(validatePlatformContract(noEnvelope, loadAutopilotPolicy(repoRoot))).includes('ACTIVATION_ENVELOPE_MISMATCH'));
  assert.equal(stateOf([comment(activateFields())], noEnvelope), PLATFORM_STATES.INACTIVE);
});

test('NEGATIVE CONTROL: a malformed contract shape fails closed instead of throwing', () => {
  const policy = loadAutopilotPolicy(repoRoot);
  const activate = [comment(activateFields())];
  const shapes = [
    (d) => { d.human_gates.gates = {}; },
    (d) => { d.human_gates.inherited_never_automatic = 'production_deployment'; },
    (d) => { d.packets = {}; },
    (d) => { d.activation.activate.author_allowlist = 'SaCH-PRO'; },
    (d) => { d.activation = null; },
  ];
  for (const mutate of shapes) {
    const doc = clone(loadPlatformDag(repoRoot).doc);
    mutate(doc);
    let result;
    assert.doesNotThrow(() => { result = platformProgrammeState(activate, doc, policy); });
    assert.equal(result.state, PLATFORM_STATES.INACTIVE, `malformed shape must be INACTIVE: ${mutate}`);
  }
  assert.equal(platformProgrammeState(activate, null, policy).state, PLATFORM_STATES.INACTIVE);
  assert.equal(platformProgrammeState(activate, loadPlatformDag(repoRoot).doc, null).state, PLATFORM_STATES.INACTIVE);
});

test('NEGATIVE CONTROL: deleting or loosening any required human gate fails validation and blocks activation', () => {
  const policy = loadAutopilotPolicy(repoRoot);
  for (const id of Object.keys(REQUIRED_HUMAN_GATES)) {
    const doc = clone(loadPlatformDag(repoRoot).doc);
    doc.human_gates.gates = doc.human_gates.gates.filter((g) => g.id !== id);
    doc.packets.forEach((p) => { if (p.human_gates) p.human_gates = p.human_gates.filter((g) => g.gate !== id); });
    const problems = validatePlatformContract(doc, policy);
    assert.ok(problems.some((p) => p.code === 'REQUIRED_GATE_MISSING' && p.detail.includes(id)), `deleting ${id} must fail`);
    assert.equal(stateOf([comment(activateFields())], doc), PLATFORM_STATES.INACTIVE, `deleting ${id} must block activation`);
  }
  for (const [id, parents] of Object.entries(REQUIRED_HUMAN_GATES)) {
    if (!parents.length) continue;
    const doc = clone(loadPlatformDag(repoRoot).doc);
    doc.human_gates.gates.find((g) => g.id === id).inherits = [];
    assert.ok(codes(validatePlatformContract(doc, policy)).includes('REQUIRED_GATE_WEAKENED'), `loosening ${id} must fail`);
  }
});

test('NEGATIVE CONTROL: envelope values outside the repository vocabulary cannot activate', () => {
  const bad = {
    health: 'AMBER',
    state: 'SUPERSEDED',
    source_main: 'ad97ea48',
    scope_changed: 'maybe',
    production_touched: 'no',
  };
  for (const [key, value] of Object.entries(bad)) {
    assert.equal(stateOf([comment(activateFields({ [key]: value }))]), PLATFORM_STATES.HELD, `${key}: ${value} must not activate`);
  }
});

test('NEGATIVE CONTROL: editing any activation-boundary field fails validation and blocks activation', () => {
  // r4111509416: each mutation alone must be caught, and the evaluator must
  // then refuse to activate on an otherwise valid ACTIVATE (referent below).
  const policy = loadAutopilotPolicy(repoRoot);
  assert.equal(stateOf([comment(activateFields())]), PLATFORM_STATES.ACTIVE);
  const mutations = [
    ['ACTIVATION_CHANNEL_MISMATCH', (d) => { d.activation.authority_channel = 'slack'; }],
    ['ACTIVATION_CHANNEL_MISMATCH', (d) => { delete d.activation.authority_channel; }],
    ['ACTIVATION_DECIDER_MISMATCH', (d) => { d.activation.evaluation.decided_by = 'oldest_message'; }],
    ['ACTIVATION_BYPASSES_RECONCILE', (d) => { d.activation.evaluation.advancement_still_requires_reconcile = false; }],
    ['ACTIVATION_BYPASSES_RECONCILE', (d) => { delete d.activation.evaluation.advancement_still_requires_reconcile; }],
    ['ACTIVATION_PREEMPTS_APPLICATION_PROGRAMME', (d) => { d.activation.current_application_programme_remains_authoritative_until_activation = false; }],
    ['ACTIVATION_SOURCE_UNLISTED', (d) => { d.activation.never_activated_by = d.activation.never_activated_by.filter((s) => s !== 'prose_or_objective_text'); }],
    ['ACTIVATION_SOURCE_UNLISTED', (d) => { delete d.activation.never_activated_by; }],
  ];
  for (const [code, mutate] of mutations) {
    const doc = clone(loadPlatformDag(repoRoot).doc);
    mutate(doc);
    assert.ok(codes(validatePlatformContract(doc, policy)).includes(code), `${mutate} must raise ${code}`);
    assert.equal(stateOf([comment(activateFields())], doc), PLATFORM_STATES.INACTIVE, `${mutate} must block activation`);
  }
});

test('NEGATIVE CONTROL: activation fields with unmatched quotes cannot activate; they hold', () => {
  // r4111466813: readField strips a leading and a trailing quote independently.
  // Referent: balanced quoting is ordinary YAML and still activates, so HELD
  // below comes from the unmatched quote, not from quoting as such.
  assert.equal(stateOf([comment(activateFields({ programme_action: "'ACTIVATE'", programme: '"KEYFLOWOS_PLATFORM_CONVERGENCE"' }))]), PLATFORM_STATES.ACTIVE);
  const malformed = [
    { programme_action: "'ACTIVATE", programme: "'KEYFLOWOS_PLATFORM_CONVERGENCE" },
    { programme_action: "'ACTIVATE" },
    { programme_action: 'ACTIVATE"' },
    { programme_action: `'ACTIVATE"` },
    { programme: "KEYFLOWOS_PLATFORM_CONVERGENCE'" },
    { message_type: "'DIRECTIVE" },
    { sender: '"chatgpt' },
    { health: "GREEN'" },
  ];
  for (const extra of malformed) {
    assert.equal(stateOf([comment(activateFields(extra))]), PLATFORM_STATES.HELD, `${JSON.stringify(extra)} must not activate`);
  }
  const good = comment(activateFields(), { at: '2026-09-26T10:00:00Z' });
  const unmatched = comment(activateFields({ programme_action: "'ACTIVATE" }), { at: '2026-09-26T11:00:00Z' });
  assert.equal(stateOf([good, unmatched]), PLATFORM_STATES.HELD);
});

test('hold is DIRECTIVE-only in the contract; a HOLD-typed message still holds', () => {
  const doc = clone(loadPlatformDag(repoRoot).doc);
  doc.activation.hold.message_types = ['DIRECTIVE', 'HOLD'];
  assert.ok(codes(validatePlatformContract(doc, loadAutopilotPolicy(repoRoot))).includes('HOLD_TYPES_MISMATCH'));
  const activate = comment(activateFields(), { at: '2026-09-26T10:00:00Z' });
  const holdTyped = comment(activateFields({ message_type: 'HOLD', programme_action: 'HOLD' }), { at: '2026-09-26T11:00:00Z' });
  assert.equal(stateOf([activate, holdTyped]), PLATFORM_STATES.HELD);
});

test('the committed DAG file is the one under test', () => {
  assert.ok(fs.existsSync(PLATFORM_DAG_PATH));
});
