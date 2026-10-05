import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRegistryItems,
  buildAtlasGraph,
  validateAtlasGraph,
} from './generate-atlas.mjs';

function fakeDag() {
  const nodes = [
    {
      packet_id: 'KF-EXEC-A-001',
      key: 'KF-EXEC-A-001',
      phase: null,
      title: 'A',
      wave: 'A',
      resolved_depends_on: [],
    },
    {
      packet_id: 'KF-EXEC-B-001',
      key: 'KF-EXEC-B-001',
      phase: null,
      title: 'B',
      wave: 'B',
      resolved_depends_on: ['KF-EXEC-A-001'],
    },
  ];
  return {
    nodes,
    packetsTotal: 2,
    phasesTotal: 2,
  };
}

test('parseRegistryItems reads only declared flat fields', () => {
  const text = `
generated: 2026-10-05
modules:
  - id: crm
    moduleClass: crm
    registeredInAppModule: true
    services: 4
    controllers: 2
    registeredVia:
      - ai
  - id: finance
    moduleClass: finance
    registeredInAppModule: false
    services: 7
    controllers: 1
`;

  assert.deepEqual(
    parseRegistryItems(text, 'id', [
      'moduleClass',
      'registeredInAppModule',
      'services',
      'controllers',
    ]),
    [
      {
        id: 'crm',
        moduleClass: 'crm',
        registeredInAppModule: true,
        services: 4,
        controllers: 2,
      },
      {
        id: 'finance',
        moduleClass: 'finance',
        registeredInAppModule: false,
        services: 7,
        controllers: 1,
      },
    ],
  );
});

test('materializer preserves generated ownership as approximate reference evidence', () => {
  const graph = buildAtlasGraph({
    architectureGraph: {
      meta: { generated: '2026-10-05T00:00:00Z' },
      nodes: [],
      edges: [],
    },
    moduleRegistryText: `
modules:
  - id: crm
    moduleClass: crm
    registeredInAppModule: true
    services: 1
    controllers: 1
`,
    routeRegistryText: 'routes:\n',
    eventRegistryText: 'events:\n',
    capabilityRegistryText: 'capabilities:\n',
    ownershipRegistryText: `
models:
  - model: Contact
    owner: crm
    referenceCount: 12
`,
    dag: fakeDag(),
  });

  const ownership = graph.edges.find(
    (edge) => edge.source === 'module:crm' && edge.target === 'entity:Contact',
  );

  assert.ok(ownership);
  assert.equal(ownership.relation, 'references_most');
  assert.equal(ownership.evidence_class, 'derived');
  assert.equal(ownership.confidence, 'low');
  assert.notEqual(ownership.relation, 'owns');
});

test('programme DAG is projected as packet/phase nodes with dependency edges', () => {
  const graph = buildAtlasGraph({
    architectureGraph: { meta: {}, nodes: [], edges: [] },
    moduleRegistryText: 'modules:\n',
    routeRegistryText: 'routes:\n',
    eventRegistryText: 'events:\n',
    capabilityRegistryText: 'capabilities:\n',
    ownershipRegistryText: 'models:\n',
    dag: fakeDag(),
  });

  assert.ok(graph.nodes.some((n) => n.id === 'packet:KF-EXEC-A-001'));
  assert.ok(graph.nodes.some((n) => n.id === 'packet-phase:KF-EXEC-B-001'));
  assert.ok(
    graph.edges.some(
      (e) =>
        e.source === 'packet-phase:KF-EXEC-B-001' &&
        e.target === 'packet-phase:KF-EXEC-A-001' &&
        e.relation === 'depends_on',
    ),
  );
});

test('capability manual route becomes an explicit evidence-backed edge', () => {
  const graph = buildAtlasGraph({
    architectureGraph: { meta: {}, nodes: [], edges: [] },
    moduleRegistryText: 'modules:\n',
    routeRegistryText: `
routes:
  - path: /app/commerce
    inNav: true
`,
    eventRegistryText: 'events:\n',
    capabilityRegistryText: `
capabilities:
  - name: invoice_send
    family: execute
    riskTier: 3
    riskLevel: high
    manualRoute: /app/commerce
`,
    ownershipRegistryText: 'models:\n',
    dag: fakeDag(),
  });

  const edge = graph.edges.find(
    (e) =>
      e.source === 'capability:invoice_send' &&
      e.target === 'route:/app/commerce',
  );
  assert.ok(edge);
  assert.equal(edge.relation, 'manual_equivalent');
  assert.equal(edge.evidence_class, 'observed');
});

test('NEGATIVE CONTROL: broken graph references fail closed', () => {
  assert.throws(
    () =>
      validateAtlasGraph({
        nodes: [
          {
            id: 'a',
            kind: 'module',
            layer: 'L6',
            label: 'A',
            evidence_class: 'observed',
            authority: 'current_code',
            confidence: 'high',
          },
        ],
        edges: [
          {
            id: 'edge:a|depends_on|missing',
            source: 'a',
            target: 'missing',
            relation: 'depends_on',
            layer: 'L6',
            evidence_class: 'observed',
            authority: 'current_code',
            confidence: 'high',
            evidence: [{ path: 'x' }],
          },
        ],
      }),
    (err) =>
      Array.isArray(err.problems) &&
      err.problems.some((p) => p.code === 'EDGE_TARGET_MISSING'),
  );
});

test('NEGATIVE CONTROL: generated ownership cannot be promoted to semantic owns', () => {
  assert.throws(
    () =>
      validateAtlasGraph({
        nodes: [
          {
            id: 'module:crm',
            kind: 'module',
            layer: 'L6',
            label: 'crm',
            evidence_class: 'observed',
            authority: 'generated_architecture',
            confidence: 'high',
          },
          {
            id: 'entity:Contact',
            kind: 'entity',
            layer: 'L6',
            label: 'Contact',
            evidence_class: 'observed',
            authority: 'generated_architecture',
            confidence: 'high',
          },
        ],
        edges: [
          {
            id: 'bad-owner',
            source: 'module:crm',
            target: 'entity:Contact',
            relation: 'owns',
            layer: 'L6',
            evidence_class: 'derived',
            authority: 'generated_architecture',
            confidence: 'low',
            evidence: [{ path: 'architecture/data-ownership.yaml' }],
          },
        ],
      }),
    (err) =>
      Array.isArray(err.problems) &&
      err.problems.some((p) => p.code === 'GENERATED_OWNERSHIP_PROMOTED'),
  );
});

test('NEGATIVE CONTROL: observed edges require provenance', () => {
  assert.throws(
    () =>
      validateAtlasGraph({
        nodes: [
          {
            id: 'a',
            kind: 'module',
            layer: 'L6',
            label: 'A',
            evidence_class: 'observed',
            authority: 'current_code',
            confidence: 'high',
          },
          {
            id: 'b',
            kind: 'module',
            layer: 'L6',
            label: 'B',
            evidence_class: 'observed',
            authority: 'current_code',
            confidence: 'high',
          },
        ],
        edges: [
          {
            id: 'edge:a|depends_on|b',
            source: 'a',
            target: 'b',
            relation: 'depends_on',
            layer: 'L6',
            evidence_class: 'observed',
            authority: 'current_code',
            confidence: 'high',
          },
        ],
      }),
    (err) =>
      Array.isArray(err.problems) &&
      err.problems.some((p) => p.code === 'OBSERVED_EDGE_WITHOUT_EVIDENCE'),
  );
});
