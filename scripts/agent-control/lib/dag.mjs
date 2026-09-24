/**
 * AUTO-DAG — programme dependency graph loader, validator and selector.
 *
 * Static topology only. This module never reads or writes live packet state;
 * callers pass completion facts in from programme-state.yaml.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from './yaml.mjs';

export const DAG_PATH = 'docs/development/KEYFLOWOS_PROGRAMME_DAG.yaml';

/** A node is one executable phase. Single-phase packets get an implicit phase. */
function expand(dagDoc) {
  const nodes = [];
  const byPacket = new Map();

  for (const packet of dagDoc.packets || []) {
    if (!packet.id) throw new Error('dag: packet without an id');
    if (byPacket.has(packet.id)) throw new Error(`dag: duplicate packet id ${packet.id}`);

    const declared = Array.isArray(packet.phases) && packet.phases.length
      ? packet.phases
      : [{ name: null, wave: packet.wave, depends_on: packet.depends_on, depends_on_groups: packet.depends_on_groups }];

    const phases = declared.map((phase) => {
      if (!phase.wave) throw new Error(`dag: ${packet.id} phase ${phase.name || '(single)'} has no wave`);
      return {
        packet_id: packet.id,
        phase: phase.name,
        key: phase.name ? `${packet.id}#${phase.name}` : packet.id,
        title: packet.title || packet.id,
        wave: String(phase.wave),
        depends_on: [...(phase.depends_on || [])],
        depends_on_groups: [...(phase.depends_on_groups || [])],
        coordinates_with: [...(packet.coordinates_with || [])],
      };
    });

    byPacket.set(packet.id, phases);
    nodes.push(...phases);
  }

  return { nodes, byPacket };
}

function resolveGroup(dagDoc, byPacket, name) {
  const group = (dagDoc.groups || {})[name];
  if (!group) throw new Error(`dag: unknown dependency group ${name}`);
  const waves = new Set((group.waves || []).map(String));
  const out = [];
  for (const [packetId, phases] of byPacket) {
    // A group referencing a wave includes every phase of every packet in it.
    if (phases.some((p) => waves.has(p.wave))) out.push(packetId);
  }
  for (const extra of group.plus || []) {
    if (!byPacket.has(extra)) throw new Error(`dag: group ${name} references unknown packet ${extra}`);
    out.push(extra);
  }
  return [...new Set(out)];
}

/**
 * Resolve a dependency reference to concrete node keys.
 * "X" -> X's terminal phase; "X#phase" -> that exact phase.
 */
function resolveRef(byPacket, ref, owner) {
  const [packetId, phaseName] = String(ref).split('#');
  const phases = byPacket.get(packetId);
  if (!phases) throw new Error(`dag: ${owner} depends on unknown packet ${packetId}`);
  if (!phaseName) return phases[phases.length - 1].key;
  const match = phases.find((p) => p.phase === phaseName);
  if (!match) throw new Error(`dag: ${owner} depends on unknown phase ${ref}`);
  return match.key;
}

export function loadDag(repoRoot = process.cwd()) {
  const text = fs.readFileSync(path.join(repoRoot, DAG_PATH), 'utf8');
  return buildDag(parseYaml(text));
}

export function buildDag(dagDoc) {
  const { nodes, byPacket } = expand(dagDoc);
  const waveOrder = (dagDoc.selection_policy?.wave_order || []).map(String);
  if (!waveOrder.length) throw new Error('dag: selection_policy.wave_order is required');
  const waveIndex = new Map(waveOrder.map((w, i) => [w, i]));

  const byKey = new Map(nodes.map((n) => [n.key, n]));

  for (const node of nodes) {
    if (!waveIndex.has(node.wave)) throw new Error(`dag: ${node.key} has wave ${node.wave} outside wave_order`);
    const refs = [
      ...node.depends_on.map((r) => resolveRef(byPacket, r, node.key)),
      ...node.depends_on_groups.flatMap((g) =>
        resolveGroup(dagDoc, byPacket, g).map((p) => resolveRef(byPacket, p, node.key)),
      ),
    ];
    node.resolved_depends_on = [...new Set(refs)].filter((r) => r !== node.key);
  }

  const dag = {
    doc: dagDoc,
    nodes,
    byKey,
    byPacket,
    waveOrder,
    waveIndex,
    packetsTotal: byPacket.size,
    phasesTotal: nodes.length,
  };

  validateDag(dag);
  return dag;
}

/**
 * Structural proof that the graph is executable.
 * Fails closed with a reason code rather than returning a graph a selector
 * would deadlock on.
 */
export function validateDag(dag) {
  const problems = [];

  // 1. No backward wave edge: a node may never depend on a later wave.
  for (const node of dag.nodes) {
    for (const depKey of node.resolved_depends_on) {
      const dep = dag.byKey.get(depKey);
      if (dag.waveIndex.get(dep.wave) > dag.waveIndex.get(node.wave)) {
        problems.push({
          code: 'WAVE_GATE_DEADLOCK',
          node: node.key,
          dependency: dep.key,
          detail: `${node.key} (wave ${node.wave}) depends on ${dep.key} (wave ${dep.wave}); with do_not_leapfrog_wave_gate this can never become selectable`,
        });
      }
    }
  }

  // 2. No cycles.
  const state = new Map();
  const stack = [];
  const visit = (key) => {
    const mark = state.get(key);
    if (mark === 'done') return;
    if (mark === 'open') {
      const at = stack.indexOf(key);
      problems.push({ code: 'DEPENDENCY_CYCLE', node: key, detail: `cycle: ${[...stack.slice(at), key].join(' -> ')}` });
      return;
    }
    state.set(key, 'open');
    stack.push(key);
    for (const dep of dag.byKey.get(key).resolved_depends_on) visit(dep);
    stack.pop();
    state.set(key, 'done');
  };
  for (const node of dag.nodes) visit(node.key);

  // 3. Declared counts must match reality, so a silent edit is caught.
  const declaredPackets = dag.doc.packets_total;
  const declaredPhases = dag.doc.phases_total;
  if (declaredPackets !== undefined && declaredPackets !== dag.packetsTotal) {
    problems.push({ code: 'PACKET_COUNT_MISMATCH', detail: `declared ${declaredPackets}, found ${dag.packetsTotal}` });
  }
  if (declaredPhases !== undefined && declaredPhases !== dag.phasesTotal) {
    problems.push({ code: 'PHASE_COUNT_MISMATCH', detail: `declared ${declaredPhases}, found ${dag.phasesTotal}` });
  }

  if (problems.length) {
    const err = new Error(`dag: ${problems.length} structural problem(s): ${problems.map((p) => p.code).join(', ')}`);
    err.problems = problems;
    throw err;
  }
  return { ok: true, problems: [] };
}

/**
 * Next dependency-safe phase.
 *
 * `completed` is the set of node keys already CHECKPOINTED. A packet-level id
 * in `completed` marks every phase of that packet complete.
 */
export function selectNext(dag, completed, options = {}) {
  const done = new Set();
  for (const item of completed || []) {
    if (dag.byKey.has(item)) {
      done.add(item);
      continue;
    }
    const phases = dag.byPacket.get(item);
    if (phases) for (const p of phases) done.add(p.key);
  }

  const noLeapfrog = options.enforceWaveGate ?? dag.doc.selection_policy?.do_not_leapfrog_wave_gate ?? true;

  // The wave gate: the earliest wave that still has incomplete work.
  let gateIndex = dag.waveOrder.length - 1;
  for (let i = 0; i < dag.waveOrder.length; i += 1) {
    const wave = dag.waveOrder[i];
    const incomplete = dag.nodes.filter((n) => n.wave === wave && !done.has(n.key));
    if (incomplete.length) {
      gateIndex = i;
      break;
    }
  }

  const eligible = dag.nodes.filter((node) => {
    if (done.has(node.key)) return false;
    if (noLeapfrog && dag.waveIndex.get(node.wave) > gateIndex) return false;
    return node.resolved_depends_on.every((dep) => done.has(dep));
  });

  eligible.sort((a, b) => {
    const wave = dag.waveIndex.get(a.wave) - dag.waveIndex.get(b.wave);
    if (wave !== 0) return wave;
    return dag.nodes.indexOf(a) - dag.nodes.indexOf(b);
  });

  return {
    gate_wave: dag.waveOrder[gateIndex],
    selected: eligible[0] || null,
    eligible,
    remaining: dag.nodes.filter((n) => !done.has(n.key)).length,
  };
}

/** Walk the whole graph to prove it can be fully drained in wave order. */
export function proveDrainable(dag) {
  const done = new Set();
  const order = [];
  for (let guard = 0; guard <= dag.nodes.length + 1; guard += 1) {
    const { selected } = selectNext(dag, done);
    if (!selected) break;
    done.add(selected.key);
    order.push(selected.key);
  }
  return { drained: order.length === dag.nodes.length, order, stalled_after: order.length };
}

export default { loadDag, buildDag, validateDag, selectNext, proveDrainable, DAG_PATH };
