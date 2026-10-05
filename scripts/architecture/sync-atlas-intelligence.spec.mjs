import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCanonicalCatalogue,
  parseKernelHeadings,
  parsePrimaryJourneyLinks,
  buildIntelligenceTopology,
} from './sync-atlas-intelligence.mjs';

const analysis = `
# Map

## Canonical journey programme

1. \`KF-JOURNEY-001 — Business Birth\`
2. \`KF-JOURNEY-002 — KEY Request → Governed Action\`

Exactly 2 canonical journeys are currently defined.

## Canonical working kernel programme

1. \`KF-KERNEL-001 — Tenant Genesis & Identity\`
2. \`KF-KERNEL-002 — Human Authority & Organization\`
`;

const kernels = `
# Kernel programme

## K1 — Tenant Genesis & Identity Kernel

**Working ID:** \`KF-KERNEL-001\`

Primary journeys:

- J1 Business Birth
- J2 Governed Action

Current questions:

- x

## K2 — Human Authority & Organization Kernel

**Working ID:** \`KF-KERNEL-002\`

Primary journeys:

- J2 Governed Action

Core law:

x
`;

const state25 = `
project: KEYFLOWOS
coverage:
  journeys: 2
  journey_dossiers: 2
  kernels: 2
  kernel_dossiers: 2
  execution_packets: 35
`;

test('parses canonical journey and kernel catalogues without inventing ids', () => {
  assert.deepEqual(parseCanonicalCatalogue(analysis, 'KF-JOURNEY'), [
    { id: 'KF-JOURNEY-001', name: 'Business Birth' },
    { id: 'KF-JOURNEY-002', name: 'KEY Request → Governed Action' },
  ]);

  assert.deepEqual(parseCanonicalCatalogue(analysis, 'KF-KERNEL'), [
    { id: 'KF-KERNEL-001', name: 'Tenant Genesis & Identity' },
    { id: 'KF-KERNEL-002', name: 'Human Authority & Organization' },
  ]);
});

test('kernel programme headings and primary journey links are parsed', () => {
  assert.deepEqual(parseKernelHeadings(kernels), [
    { ordinal: 1, name: 'Tenant Genesis & Identity', id: 'KF-KERNEL-001' },
    { ordinal: 2, name: 'Human Authority & Organization', id: 'KF-KERNEL-002' },
  ]);

  assert.deepEqual(parsePrimaryJourneyLinks(kernels), [
    { journey_id: 'KF-JOURNEY-001', kernel_id: 'KF-KERNEL-001' },
    { journey_id: 'KF-JOURNEY-002', kernel_id: 'KF-KERNEL-001' },
    { journey_id: 'KF-JOURNEY-002', kernel_id: 'KF-KERNEL-002' },
  ]);
});

test('consistent intelligence sources produce a consistent topology', () => {
  const topology = buildIntelligenceTopology({
    analysisMapText: analysis,
    kernelProgrammeText: kernels,
    currentStateText: state25,
    sourceRef: 'test-ref',
  });

  assert.equal(topology.status, 'CONSISTENT');
  assert.equal(topology.journeys.length, 2);
  assert.equal(topology.kernels.length, 2);
  assert.equal(topology.contradictions.length, 0);
  assert.equal(topology.claims.analysis_map_journeys, 2);
  assert.equal(topology.claims.current_state_journeys, 2);
});

test('NEGATIVE CONTROL: journey-count disagreement is preserved as contradiction', () => {
  const topology = buildIntelligenceTopology({
    analysisMapText: analysis,
    kernelProgrammeText: kernels,
    currentStateText: state25.replace('journeys: 2', 'journeys: 3'),
    sourceRef: 'test-ref',
  });

  assert.equal(topology.status, 'CONTRADICTED');
  const contradiction = topology.contradictions.find(
    (item) => item.id === 'ATLAS-INTEL-CONTRADICTION-JOURNEY-COUNT',
  );
  assert.ok(contradiction);
  assert.equal(contradiction.analysis_map_value, 2);
  assert.equal(contradiction.current_state_value, 3);
  assert.equal(contradiction.disposition, 'UNRESOLVED');
});

test('NEGATIVE CONTROL: kernel-count disagreement is preserved as contradiction', () => {
  const topology = buildIntelligenceTopology({
    analysisMapText: analysis,
    kernelProgrammeText: kernels,
    currentStateText: state25.replace('kernels: 2', 'kernels: 3'),
    sourceRef: 'test-ref',
  });

  assert.equal(topology.status, 'CONTRADICTED');
  assert.ok(
    topology.contradictions.some(
      (item) => item.id === 'ATLAS-INTEL-CONTRADICTION-KERNEL-COUNT',
    ),
  );
});

test('NEGATIVE CONTROL: a primary link to an undefined journey is not accepted silently', () => {
  const badKernels = kernels.replace(
    '- J2 Governed Action\n\nCore law:',
    '- J2 Governed Action\n- J9 Unknown Journey\n\nCore law:',
  );

  const topology = buildIntelligenceTopology({
    analysisMapText: analysis,
    kernelProgrammeText: badKernels,
    currentStateText: state25,
    sourceRef: 'test-ref',
  });

  assert.equal(topology.status, 'CONTRADICTED');
  assert.ok(
    topology.contradictions.some(
      (item) =>
        item.subject === 'primary_journey_link' &&
        item.value?.journey_id === 'KF-JOURNEY-009',
    ),
  );
});
