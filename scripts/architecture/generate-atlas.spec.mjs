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

test('canonical intelligence topology becomes journey/kernel nodes and preserves contradictions', () => {
  const graph = buildAtlasGraph({
    architectureGraph: { meta: {}, nodes: [], edges: [] },
    moduleRegistryText: 'modules:\n',
    routeRegistryText: 'routes:\n',
    eventRegistryText: 'events:\n',
    capabilityRegistryText: 'capabilities:\n',
    ownershipRegistryText: 'models:\n',
    dag: fakeDag(),
    intelligenceTopology: {
      schema: 'keyflowos-intelligence-topology/v1',
      source_ref: 'docs/keyflow-intelligence-foundation',
      source_files: [
        'docs/intelligence/03-ANALYSIS-MAP.md',
        'docs/intelligence/12-KERNEL-PROGRAMME.md',
        'docs/intelligence/handoff/CURRENT-STATE.yaml',
      ],
      status: 'CONTRADICTED',
      journeys: [{ id: 'KF-JOURNEY-001', name: 'Business Birth' }],
      kernels: [{ id: 'KF-KERNEL-001', name: 'Tenant Genesis & Identity' }],
      primary_journey_kernel_links: [
        { journey_id: 'KF-JOURNEY-001', kernel_id: 'KF-KERNEL-001' },
      ],
      contradictions: [
        {
          id: 'ATLAS-INTEL-CONTRADICTION-JOURNEY-COUNT',
          subject: 'canonical_journey_count',
          analysis_map_value: 25,
          current_state_value: 26,
          disposition: 'UNRESOLVED',
          evidence: [
            {
              path: 'docs/intelligence/03-ANALYSIS-MAP.md',
              ref: 'docs/keyflow-intelligence-foundation',
            },
          ],
        },
      ],
    },
  });

  assert.ok(graph.nodes.some((n) => n.id === 'journey:KF-JOURNEY-001' && n.layer === 'L2'));
  assert.ok(graph.nodes.some((n) => n.id === 'kernel:KF-KERNEL-001' && n.layer === 'L3'));
  assert.ok(
    graph.edges.some(
      (e) =>
        e.source === 'journey:KF-JOURNEY-001' &&
        e.target === 'kernel:KF-KERNEL-001' &&
        e.relation === 'uses',
    ),
  );
  const contradiction = graph.nodes.find(
    (n) => n.id === 'contradiction:ATLAS-INTEL-CONTRADICTION-JOURNEY-COUNT',
  );
  assert.ok(contradiction);
  assert.equal(contradiction.metadata.disposition, 'UNRESOLVED');
  assert.equal(contradiction.metadata.analysis_map_value, 25);
  assert.equal(contradiction.metadata.current_state_value, 26);
  assert.equal(graph.source_state.intelligence_status, 'CONTRADICTED');
});

test('packet semantic index creates journey/kernel impact edges without promoting seam guesses', () => {
  const graph = buildAtlasGraph({
    architectureGraph: { meta: {}, nodes: [], edges: [] },
    moduleRegistryText: 'modules:\n',
    routeRegistryText: 'routes:\n',
    eventRegistryText: 'events:\n',
    capabilityRegistryText: 'capabilities:\n',
    ownershipRegistryText: 'models:\n',
    dag: fakeDag(),
    intelligenceTopology: {
      source_ref: 'docs/keyflow-intelligence-foundation',
      source_files: ['docs/intelligence/03-ANALYSIS-MAP.md'],
      status: 'CONSISTENT',
      journeys: [
        { id: 'KF-JOURNEY-001', name: 'Business Birth' },
        { id: 'KF-JOURNEY-002', name: 'Governed Action' },
      ],
      kernels: [{ id: 'KF-KERNEL-001', name: 'Tenant Genesis & Identity' }],
      primary_journey_kernel_links: [],
      contradictions: [],
    },
    packetSemanticIndex: {
      source_ref: 'docs/keyflow-intelligence-foundation',
      status: 'MAPPED',
      packets: [
        {
          packet_id: 'KF-EXEC-A-001',
          source_file: 'docs/intelligence/execution/KF-EXEC-A-001.md',
          semantic_status: 'MAPPED',
          primary_journeys: ['KF-JOURNEY-001'],
          consumer_journeys: ['KF-JOURNEY-002'],
          primary_kernels: ['KF-KERNEL-001'],
          seams: [
            {
              value: 'apps/server/src/example.ts',
              kind: 'path_or_symbol',
              requires_revalidation: true,
            },
          ],
        },
      ],
      contradictions: [],
    },
  });

  assert.ok(
    graph.edges.some(
      (e) =>
        e.source === 'packet:KF-EXEC-A-001' &&
        e.target === 'journey:KF-JOURNEY-001' &&
        e.relation === 'impacts_journey',
    ),
  );
  assert.ok(
    graph.edges.some(
      (e) =>
        e.source === 'packet:KF-EXEC-A-001' &&
        e.target === 'journey:KF-JOURNEY-002' &&
        e.relation === 'consumer_journey',
    ),
  );
  assert.ok(
    graph.edges.some(
      (e) =>
        e.source === 'packet:KF-EXEC-A-001' &&
        e.target === 'kernel:KF-KERNEL-001' &&
        e.relation === 'impacts_kernel',
    ),
  );

  const packet = graph.nodes.find((n) => n.id === 'packet:KF-EXEC-A-001');
  assert.equal(packet.metadata.semantic_status, 'MAPPED');
  assert.equal(packet.metadata.characterization_seams[0].requires_revalidation, true);
  assert.ok(
    !graph.edges.some(
      (e) =>
        e.source === 'packet:KF-EXEC-A-001' &&
        e.target === 'apps/server/src/example.ts',
    ),
    'unrevalidated seam text must not become a code edge',
  );
});

test('packet semantic contradictions become visible L8 nodes', () => {
  const graph = buildAtlasGraph({
    architectureGraph: { meta: {}, nodes: [], edges: [] },
    moduleRegistryText: 'modules:\n',
    routeRegistryText: 'routes:\n',
    eventRegistryText: 'events:\n',
    capabilityRegistryText: 'capabilities:\n',
    ownershipRegistryText: 'models:\n',
    dag: fakeDag(),
    intelligenceTopology: null,
    packetSemanticIndex: {
      source_ref: 'docs/keyflow-intelligence-foundation',
      status: 'PARTIAL_OR_CONTRADICTED',
      packets: [],
      contradictions: [
        {
          id: 'ATLAS-PACKET-UNKNOWN-JOURNEY-KF-EXEC-A-001-KF-JOURNEY-026',
          type: 'UNKNOWN_JOURNEY_REFERENCE',
          packet_id: 'KF-EXEC-A-001',
          reference: 'KF-JOURNEY-026',
          source_file: 'docs/intelligence/execution/KF-EXEC-A-001.md',
          disposition: 'UNRESOLVED',
        },
      ],
    },
  });

  const contradiction = graph.nodes.find(
    (n) =>
      n.id ===
      'contradiction:ATLAS-PACKET-UNKNOWN-JOURNEY-KF-EXEC-A-001-KF-JOURNEY-026',
  );
  assert.ok(contradiction);
  assert.equal(contradiction.layer, 'L8');
  assert.equal(contradiction.metadata.reference, 'KF-JOURNEY-026');
  assert.equal(graph.source_state.packet_semantic_status, 'PARTIAL_OR_CONTRADICTED');
});

