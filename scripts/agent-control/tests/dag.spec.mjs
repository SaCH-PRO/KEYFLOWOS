import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDag, loadDag, selectNext, proveDrainable, validateDag } from '../lib/dag.mjs';
import { parseYaml } from '../lib/yaml.mjs';

const repoRoot = process.cwd();

test('canonical DAG loads, validates and drains completely', () => {
  const dag = loadDag(repoRoot);
  assert.equal(dag.packetsTotal, 35, 'the programme has 35 packets');
  const proof = proveDrainable(dag);
  assert.equal(proof.drained, true, `graph stalled after ${proof.stalled_after} of ${dag.phasesTotal}`);
  assert.equal(proof.order.length, dag.phasesTotal);
});

test('GROWTH closed_loop is ordered after its wave D dependencies', () => {
  const dag = loadDag(repoRoot);
  const { order } = proveDrainable(dag);
  const closed = order.indexOf('KF-EXEC-GROWTH-001#closed_loop');
  assert.ok(closed > -1, 'closed_loop phase must be selectable at all');
  for (const dep of ['KF-EXEC-PUBLIC-001', 'KF-EXEC-SPACE-001', 'KF-EXEC-CONNECTOR-001']) {
    assert.ok(order.indexOf(dep) < closed, `${dep} must precede GROWTH closed_loop`);
  }
  assert.ok(order.indexOf('KF-EXEC-GROWTH-001#foundation') < closed, 'foundation precedes closed_loop');
});

test('the union of phase dependencies equals the board packet dependency list', () => {
  const dag = loadDag(repoRoot);
  const phases = dag.byPacket.get('KF-EXEC-GROWTH-001');
  const union = new Set(phases.flatMap((p) => p.depends_on).filter((d) => !d.startsWith('KF-EXEC-GROWTH-001')));
  // Board: ACTION, COMMERCIAL, FINANCE, PLAYBOOK, PUBLIC, SPACE, CONNECTOR
  assert.deepEqual(
    [...union].sort(),
    [
      'KF-EXEC-ACTION-001',
      'KF-EXEC-COMMERCIAL-001',
      'KF-EXEC-CONNECTOR-001',
      'KF-EXEC-FINANCE-001',
      'KF-EXEC-PLAYBOOK-001',
      'KF-EXEC-PUBLIC-001',
      'KF-EXEC-SPACE-001',
    ],
    'no board dependency may be lost or invented by the phase split',
  );
});

// ---------------------------------------------------------------- NEGATIVE CONTROLS

test('NEGATIVE CONTROL: the prototype single-node shape is rejected as a deadlock', () => {
  // This is the exact F2 defect: GROWTH in wave C depending on wave D packets.
  const broken = parseYaml(`
version: 2
packets_total: 4
phases_total: 4
selection_policy:
  wave_order: ["C", "D"]
  do_not_leapfrog_wave_gate: true
packets:
  - id: KF-EXEC-COMMERCIAL-001
    wave: C
    depends_on: []
  - id: KF-EXEC-GROWTH-001
    wave: C
    depends_on: [KF-EXEC-COMMERCIAL-001, KF-EXEC-PUBLIC-001, KF-EXEC-SPACE-001]
  - id: KF-EXEC-PUBLIC-001
    wave: D
    depends_on: []
  - id: KF-EXEC-SPACE-001
    wave: D
    depends_on: []
`);
  assert.throws(
    () => buildDag(broken),
    (err) => {
      assert.ok(err.problems, 'validator must attach structured problems');
      const codes = err.problems.map((p) => p.code);
      assert.ok(codes.includes('WAVE_GATE_DEADLOCK'), `expected WAVE_GATE_DEADLOCK, got ${codes.join(',')}`);
      return true;
    },
  );
});

test('NEGATIVE CONTROL: a deadlocked graph cannot be drained even if validation is bypassed', () => {
  const dag = {
    doc: { selection_policy: { wave_order: ['C', 'D'], do_not_leapfrog_wave_gate: true } },
    waveOrder: ['C', 'D'],
    waveIndex: new Map([['C', 0], ['D', 1]]),
    nodes: [
      { key: 'G', packet_id: 'G', wave: 'C', resolved_depends_on: ['P'] },
      { key: 'P', packet_id: 'P', wave: 'D', resolved_depends_on: [] },
    ],
    byKey: new Map(),
    byPacket: new Map([['G', [{ key: 'G' }]], ['P', [{ key: 'P' }]]]),
  };
  dag.byKey = new Map(dag.nodes.map((n) => [n.key, n]));
  const proof = proveDrainable(dag);
  assert.equal(proof.drained, false, 'the defective graph must stall, proving the drain test is not vacuous');
  assert.equal(proof.stalled_after, 0);
});

test('NEGATIVE CONTROL: a dependency cycle is rejected', () => {
  const cyclic = parseYaml(`
version: 2
packets_total: 2
phases_total: 2
selection_policy:
  wave_order: ["A"]
packets:
  - id: KF-EXEC-A-001
    wave: A
    depends_on: [KF-EXEC-B-001]
  - id: KF-EXEC-B-001
    wave: A
    depends_on: [KF-EXEC-A-001]
`);
  assert.throws(() => buildDag(cyclic), (err) => err.problems.some((p) => p.code === 'DEPENDENCY_CYCLE'));
});

test('NEGATIVE CONTROL: an unknown dependency is rejected rather than ignored', () => {
  const unknown = parseYaml(`
version: 2
packets_total: 1
phases_total: 1
selection_policy:
  wave_order: ["A"]
packets:
  - id: KF-EXEC-A-001
    wave: A
    depends_on: [ALL_MIGRATED_DOMAIN_PACKETS]
`);
  // The prototype silently matched nothing for this pseudo-id.
  assert.throws(() => buildDag(unknown), /unknown packet ALL_MIGRATED_DOMAIN_PACKETS/);
});

test('declared packet/phase counts are enforced against reality', () => {
  const miscounted = parseYaml(`
version: 2
packets_total: 99
phases_total: 1
selection_policy:
  wave_order: ["A"]
packets:
  - id: KF-EXEC-A-001
    wave: A
    depends_on: []
`);
  assert.throws(() => buildDag(miscounted), (err) => err.problems.some((p) => p.code === 'PACKET_COUNT_MISMATCH'));
});

// ---------------------------------------------------------------- SELECTION

test('selector respects the wave gate and does not leapfrog', () => {
  const dag = loadDag(repoRoot);
  const selection = selectNext(dag, []);
  assert.equal(selection.gate_wave, '0');
  assert.equal(selection.selected.key, 'KF-EXEC-K12-001');
  assert.ok(
    selection.eligible.every((n) => n.wave === '0'),
    'nothing beyond the gate wave may be eligible',
  );
});

test('next dependency-safe selection respects canonical dependencies', () => {
  const dag = loadDag(repoRoot);
  const done = ['KF-EXEC-K12-001', 'KF-EXEC-EXTFX-001', 'KF-EXEC-TENANT-001', 'KF-EXEC-AUTH-001'];
  const selection = selectNext(dag, done);
  assert.equal(selection.selected.key, 'KF-EXEC-ACTION-001', 'ACTION-001 is the next dependency-safe packet');
  assert.equal(selection.gate_wave, 'A');
});

test('a packet id in completed marks every phase of that packet complete', () => {
  const dag = loadDag(repoRoot);
  const withPlaybook = selectNext(dag, ['KF-EXEC-PLAYBOOK-001']);
  const keys = withPlaybook.eligible.map((n) => n.key);
  assert.ok(!keys.includes('KF-EXEC-PLAYBOOK-001#foundation'));
  assert.ok(!keys.includes('KF-EXEC-PLAYBOOK-001#convergence'));
});

test('SPACE coordination with UX is not a blocking dependency', () => {
  const dag = loadDag(repoRoot);
  const space = dag.byKey.get('KF-EXEC-SPACE-001');
  assert.ok(!space.resolved_depends_on.includes('KF-EXEC-UX-001'), 'coordination must not become a hard gate');
  assert.deepEqual(space.coordinates_with, ['KF-EXEC-UX-001'], 'but the relationship must not be lost either');
});
