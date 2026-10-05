#!/usr/bin/env node

/**
 * Deterministic Living System Atlas materializer.
 *
 * This script consumes existing repository architecture/control topology and emits
 * a cross-layer graph. It never invents semantic ownership: generated ownership
 * remains an explicit low-confidence "references_most" relationship.
 *
 * Usage:
 *   node scripts/architecture/generate-atlas.mjs
 *   node scripts/architecture/generate-atlas.mjs --check
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadDag } from '../agent-control/lib/dag.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'architecture/atlas/generated/atlas-graph.json');

function parseFlatScalar(value) {
  const raw = String(value ?? '').trim();
  if (raw === '' || raw === 'null' || raw === '~') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d+\.\d+$/.test(raw)) return Number(raw);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * Parse only the flat fields of generated registry list items.
 * Nested arrays/maps are deliberately ignored; this keeps the reader bound to
 * the generator's stable top-level contract rather than pretending to be YAML.
 */
export function parseRegistryItems(text, itemKey, fields) {
  const wanted = new Set(fields);
  const items = [];
  let current = null;

  for (const line of String(text).split(/\r?\n/)) {
    const start = line.match(new RegExp(`^  - ${itemKey}:\\s*(.*)$`));
    if (start) {
      if (current) items.push(current);
      current = { [itemKey]: parseFlatScalar(start[1]) };
      continue;
    }
    if (!current) continue;
    const field = line.match(/^    ([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    if (!field || !wanted.has(field[1])) continue;
    current[field[1]] = parseFlatScalar(field[2]);
  }

  if (current) items.push(current);
  return items;
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function evidence(pathName) {
  return [{ path: pathName }];
}

function normalizeKind(type) {
  const known = new Set([
    'app', 'package', 'module', 'file', 'entity', 'event', 'route',
    'capability', 'integration', 'external_integration', 'execution_path',
    'risk', 'packet', 'packet_phase',
  ]);
  return known.has(type) ? type : 'implementation_node';
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function edgeId(source, relation, target) {
  return `edge:${source}|${relation}|${target}`;
}

export function validateAtlasGraph(graph) {
  const problems = [];
  const ids = new Set();

  for (const node of graph.nodes || []) {
    if (!node.id) problems.push({ code: 'NODE_ID_MISSING', node });
    else if (ids.has(node.id)) problems.push({ code: 'NODE_ID_DUPLICATE', id: node.id });
    ids.add(node.id);

    for (const field of ['kind', 'layer', 'label', 'evidence_class', 'authority', 'confidence']) {
      if (node[field] === undefined || node[field] === null || node[field] === '') {
        problems.push({ code: 'NODE_FIELD_MISSING', id: node.id, field });
      }
    }
  }

  const edgeIds = new Set();
  for (const edge of graph.edges || []) {
    if (!edge.id) problems.push({ code: 'EDGE_ID_MISSING', edge });
    else if (edgeIds.has(edge.id)) problems.push({ code: 'EDGE_ID_DUPLICATE', id: edge.id });
    edgeIds.add(edge.id);

    if (!ids.has(edge.source)) problems.push({ code: 'EDGE_SOURCE_MISSING', id: edge.id, source: edge.source });
    if (!ids.has(edge.target)) problems.push({ code: 'EDGE_TARGET_MISSING', id: edge.id, target: edge.target });

    for (const field of ['relation', 'layer', 'evidence_class', 'authority', 'confidence']) {
      if (edge[field] === undefined || edge[field] === null || edge[field] === '') {
        problems.push({ code: 'EDGE_FIELD_MISSING', id: edge.id, field });
      }
    }

    if (edge.relation === 'owns' && edge.authority === 'generated_architecture') {
      problems.push({
        code: 'GENERATED_OWNERSHIP_PROMOTED',
        id: edge.id,
        detail: 'reference-count ownership may not be represented as semantic ownership',
      });
    }

    if (edge.evidence_class === 'observed' && (!Array.isArray(edge.evidence) || edge.evidence.length === 0)) {
      problems.push({ code: 'OBSERVED_EDGE_WITHOUT_EVIDENCE', id: edge.id });
    }
  }

  if (problems.length) {
    const err = new Error(`atlas: ${problems.length} validation problem(s)`);
    err.problems = problems;
    throw err;
  }
  return { ok: true, problems: [] };
}

export function buildAtlasGraph({
  architectureGraph,
  moduleRegistryText,
  routeRegistryText,
  eventRegistryText,
  capabilityRegistryText,
  ownershipRegistryText,
  dag,
}) {
  const nodes = new Map();
  const edges = new Map();

  const addNode = (node) => {
    const prior = nodes.get(node.id);
    if (!prior) {
      nodes.set(node.id, node);
      return;
    }
    nodes.set(node.id, {
      ...prior,
      ...node,
      metadata: { ...(prior.metadata || {}), ...(node.metadata || {}) },
      evidence: [...(prior.evidence || []), ...(node.evidence || [])]
        .filter((v, i, a) => a.findIndex((x) => JSON.stringify(x) === JSON.stringify(v)) === i),
    });
  };

  const addEdge = (edge) => {
    const id = edge.id || edgeId(edge.source, edge.relation, edge.target);
    if (!edges.has(id)) edges.set(id, { ...edge, id });
  };

  for (const source of architectureGraph.nodes || []) {
    addNode({
      id: source.id,
      kind: normalizeKind(source.type),
      layer: 'L6',
      label: source.label || source.id,
      evidence_class: 'derived',
      authority: 'generated_architecture',
      confidence: 'medium',
      evidence: evidence('architecture/architecture.json'),
      metadata: source.severity ? { severity: source.severity } : {},
    });
  }

  for (const source of architectureGraph.edges || []) {
    addEdge({
      source: source.source,
      target: source.target,
      relation: source.type || 'depends_on',
      layer: 'L6',
      evidence_class: 'derived',
      authority: 'generated_architecture',
      confidence: 'medium',
      evidence: evidence('architecture/architecture.json'),
    });
  }

  const modules = parseRegistryItems(moduleRegistryText, 'id', [
    'moduleClass', 'registeredInAppModule', 'services', 'controllers',
  ]);
  for (const module of modules) {
    const id = `module:${module.id}`;
    addNode({
      id,
      kind: 'module',
      layer: 'L6',
      label: String(module.id),
      evidence_class: 'observed',
      authority: 'generated_architecture',
      confidence: 'high',
      evidence: evidence('architecture/module-registry.yaml'),
      metadata: {
        moduleClass: module.moduleClass,
        registeredInAppModule: module.registeredInAppModule,
        services: module.services,
        controllers: module.controllers,
      },
    });
  }

  const routes = parseRegistryItems(routeRegistryText, 'path', ['inNav']);
  for (const route of routes) {
    const id = `route:${route.path}`;
    addNode({
      id,
      kind: 'route',
      layer: 'L6',
      label: String(route.path),
      evidence_class: 'observed',
      authority: 'generated_architecture',
      confidence: 'high',
      evidence: evidence('architecture/route-registry.yaml'),
      metadata: { inNav: route.inNav },
    });
  }

  const events = parseRegistryItems(eventRegistryText, 'event', ['status']);
  for (const event of events) {
    const id = `event:${event.event}`;
    addNode({
      id,
      kind: 'event',
      layer: 'L6',
      label: String(event.event),
      evidence_class: 'observed',
      authority: 'generated_architecture',
      confidence: 'high',
      evidence: evidence('architecture/event-registry.yaml'),
      metadata: { status: event.status },
    });
  }

  const capabilities = parseRegistryItems(capabilityRegistryText, 'name', [
    'family', 'riskTier', 'riskLevel', 'manualRoute',
  ]);
  for (const capability of capabilities) {
    const id = `capability:${capability.name}`;
    addNode({
      id,
      kind: 'capability',
      layer: 'L1',
      label: String(capability.name),
      evidence_class: 'observed',
      authority: 'generated_architecture',
      confidence: 'high',
      evidence: evidence('architecture/capability-registry.yaml'),
      metadata: {
        family: capability.family,
        riskTier: capability.riskTier,
        riskLevel: capability.riskLevel,
        manualRoute: capability.manualRoute,
      },
    });
    if (capability.manualRoute) {
      const routeId = `route:${capability.manualRoute}`;
      if (!nodes.has(routeId)) {
        addNode({
          id: routeId,
          kind: 'route',
          layer: 'L6',
          label: String(capability.manualRoute),
          evidence_class: 'observed',
          authority: 'generated_architecture',
          confidence: 'medium',
          evidence: evidence('architecture/capability-registry.yaml'),
        });
      }
      addEdge({
        source: id,
        target: routeId,
        relation: 'manual_equivalent',
        layer: 'L1',
        evidence_class: 'observed',
        authority: 'generated_architecture',
        confidence: 'high',
        evidence: evidence('architecture/capability-registry.yaml'),
      });
    }
  }

  const ownership = parseRegistryItems(ownershipRegistryText, 'model', [
    'owner', 'referenceCount',
  ]);
  for (const model of ownership) {
    const entityId = `entity:${model.model}`;
    addNode({
      id: entityId,
      kind: 'entity',
      layer: 'L6',
      label: String(model.model),
      evidence_class: 'observed',
      authority: 'generated_architecture',
      confidence: 'high',
      evidence: evidence('architecture/data-ownership.yaml'),
      metadata: {
        approximateOwner: model.owner,
        referenceCount: model.referenceCount,
      },
    });

    if (model.owner && model.owner !== 'unassigned') {
      const moduleId = `module:${model.owner}`;
      if (!nodes.has(moduleId)) {
        addNode({
          id: moduleId,
          kind: 'module',
          layer: 'L6',
          label: String(model.owner),
          evidence_class: 'derived',
          authority: 'generated_architecture',
          confidence: 'medium',
          evidence: evidence('architecture/data-ownership.yaml'),
        });
      }
      addEdge({
        source: moduleId,
        target: entityId,
        relation: 'references_most',
        layer: 'L6',
        evidence_class: 'derived',
        authority: 'generated_architecture',
        confidence: 'low',
        evidence: evidence('architecture/data-ownership.yaml'),
        notes: 'Approximate ownership evidence only; not reviewed semantic ownership.',
      });
    }
  }

  for (const phase of dag.nodes) {
    const packetId = `packet:${phase.packet_id}`;
    const phaseId = `packet-phase:${phase.key}`;
    addNode({
      id: packetId,
      kind: 'packet',
      layer: 'L7',
      label: phase.title || phase.packet_id,
      evidence_class: 'accepted',
      authority: 'control_plane',
      confidence: 'high',
      evidence: evidence('docs/development/KEYFLOWOS_PROGRAMME_DAG.yaml'),
    });
    addNode({
      id: phaseId,
      kind: 'packet_phase',
      layer: 'L7',
      label: phase.phase ? `${phase.packet_id} / ${phase.phase}` : phase.packet_id,
      evidence_class: 'accepted',
      authority: 'control_plane',
      confidence: 'high',
      evidence: evidence('docs/development/KEYFLOWOS_PROGRAMME_DAG.yaml'),
      metadata: { wave: phase.wave, phase: phase.phase },
    });
    addEdge({
      source: packetId,
      target: phaseId,
      relation: 'contains',
      layer: 'L7',
      evidence_class: 'accepted',
      authority: 'control_plane',
      confidence: 'high',
      evidence: evidence('docs/development/KEYFLOWOS_PROGRAMME_DAG.yaml'),
    });
  }

  for (const phase of dag.nodes) {
    for (const dep of phase.resolved_depends_on) {
      addEdge({
        source: `packet-phase:${phase.key}`,
        target: `packet-phase:${dep}`,
        relation: 'depends_on',
        layer: 'L7',
        evidence_class: 'accepted',
        authority: 'control_plane',
        confidence: 'high',
        evidence: evidence('docs/development/KEYFLOWOS_PROGRAMME_DAG.yaml'),
      });
    }
  }

  const result = {
    schema: 'keyflowos-living-atlas/v1',
    deterministic: true,
    source_state: {
      architecture_graph_generated: architectureGraph.meta?.generated || null,
      module_registry_items: modules.length,
      route_registry_items: routes.length,
      event_registry_items: events.length,
      capability_registry_items: capabilities.length,
      data_model_items: ownership.length,
      programme_packets: dag.packetsTotal,
      programme_phases: dag.phasesTotal,
    },
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };

  validateAtlasGraph(result);
  return stableObject(result);
}

export function buildFromRepository(repoRoot = ROOT) {
  const architectureGraph = JSON.parse(fs.readFileSync(path.join(repoRoot, 'architecture/architecture.json'), 'utf8'));
  const dag = loadDag(repoRoot);
  return buildAtlasGraph({
    architectureGraph,
    moduleRegistryText: fs.readFileSync(path.join(repoRoot, 'architecture/module-registry.yaml'), 'utf8'),
    routeRegistryText: fs.readFileSync(path.join(repoRoot, 'architecture/route-registry.yaml'), 'utf8'),
    eventRegistryText: fs.readFileSync(path.join(repoRoot, 'architecture/event-registry.yaml'), 'utf8'),
    capabilityRegistryText: fs.readFileSync(path.join(repoRoot, 'architecture/capability-registry.yaml'), 'utf8'),
    ownershipRegistryText: fs.readFileSync(path.join(repoRoot, 'architecture/data-ownership.yaml'), 'utf8'),
    dag,
  });
}

function serialize(graph) {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

function main() {
  const graph = buildFromRepository(ROOT);
  const output = serialize(graph);
  const check = process.argv.includes('--check');

  if (check) {
    if (!fs.existsSync(OUT)) {
      console.error(`atlas: missing generated graph ${path.relative(ROOT, OUT)}`);
      process.exitCode = 1;
      return;
    }
    const current = fs.readFileSync(OUT, 'utf8');
    if (current !== output) {
      console.error('atlas: generated graph is stale; run node scripts/architecture/generate-atlas.mjs');
      process.exitCode = 1;
      return;
    }
    console.log('atlas: generated graph is current');
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, output);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
