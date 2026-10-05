import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePacketSemantics, buildPacketSemanticIndex } from './sync-atlas-packet-semantics.mjs';

function dag() {
  return {
    packetsTotal: 2,
    byPacket: new Map([
      ['KF-EXEC-ACTION-001', [{ title: 'Action' }]],
      ['KF-EXEC-FINANCE-001', [{ title: 'Finance' }]],
    ]),
  };
}

test('packet semantics preserve primary versus consumer journeys and kernels', () => {
  const parsed = parsePacketSemantics(`
# Packet
Primary kernels: K3, K5, K6, K11
Primary journeys: J2, J15, J6; consumers include J5/J22

## Current seams

- apps/server/src/modules/capabilities/capability-contract.service.ts
- ActionDispatcherService
  `);
  assert.deepEqual(parsed.primary_kernels, ['KF-KERNEL-003','KF-KERNEL-005','KF-KERNEL-006','KF-KERNEL-011']);
  assert.deepEqual(parsed.primary_journeys, ['KF-JOURNEY-002','KF-JOURNEY-015','KF-JOURNEY-006']);
  assert.deepEqual(parsed.consumer_journeys, ['KF-JOURNEY-005','KF-JOURNEY-022']);
  assert.equal(parsed.seams[0].kind, 'path_or_symbol');
  assert.equal(parsed.seams[1].kind, 'conceptual');
  assert.ok(parsed.seams.every((x) => x.requires_revalidation === true));
});

test('mapped packets connect only to known canonical ids', () => {
  const files = [
    'docs/intelligence/execution/KF-EXEC-ACTION-001-A.md',
    'docs/intelligence/execution/KF-EXEC-FINANCE-001-B.md',
  ];
  const documents = {
    [files[0]]: 'Primary kernels: K3/K5\nPrimary journeys: J2/J15\n',
    [files[1]]: 'Primary kernels: K10/K8\nPrimary journeys: J7\n',
  };
  const index = buildPacketSemanticIndex({
    dag: dag(),
    executionFiles: files,
    documents,
    sourceRef: 'test-ref',
    intelligenceTopology: {
      journeys: [
        { id: 'KF-JOURNEY-002' }, { id: 'KF-JOURNEY-015' }, { id: 'KF-JOURNEY-007' },
      ],
      kernels: [
        { id: 'KF-KERNEL-003' }, { id: 'KF-KERNEL-005' },
        { id: 'KF-KERNEL-008' }, { id: 'KF-KERNEL-010' },
      ],
    },
  });
  assert.equal(index.status, 'MAPPED');
  assert.equal(index.contradictions.length, 0);
  assert.equal(index.packets.length, 2);
});



test('broad packet scopes are preserved without inventing journey edges', () => {
  const parsedAll = parsePacketSemantics('Primary kernels: K12/all\nPrimary journeys: all\n');
  assert.equal(parsedAll.journey_scope, 'ALL_CANONICAL');
  assert.equal(parsedAll.kernel_scope, 'ALL');
  assert.deepEqual(parsedAll.primary_journeys, []);
  assert.deepEqual(parsedAll.primary_kernels, ['KF-KERNEL-012']);

  const parsedMigrated = parsePacketSemantics('Primary kernels: K12/K11\nPrimary journeys: all migrated\n');
  assert.equal(parsedMigrated.journey_scope, 'ALL_MIGRATED');

  const parsedConstellations = parsePacketSemantics('Primary kernels: K12\nPrimary journeys: all constellations\n');
  assert.equal(parsedConstellations.journey_scope, 'ALL_CONSTELLATIONS');
});

test('NEGATIVE CONTROL: missing packet source remains unresolved', () => {
  const index = buildPacketSemanticIndex({
    dag: dag(),
    executionFiles: ['docs/intelligence/execution/KF-EXEC-ACTION-001-A.md'],
    documents: {
      'docs/intelligence/execution/KF-EXEC-ACTION-001-A.md': 'Primary kernels: K3\nPrimary journeys: J2\n',
    },
    sourceRef: 'test-ref',
    intelligenceTopology: null,
  });
  assert.ok(index.contradictions.some((x) => x.type === 'MISSING_PACKET_SOURCE' && x.packet_id === 'KF-EXEC-FINANCE-001'));
});

test('NEGATIVE CONTROL: unknown journey/kernel references are surfaced', () => {
  const file = 'docs/intelligence/execution/KF-EXEC-ACTION-001-A.md';
  const finance = 'docs/intelligence/execution/KF-EXEC-FINANCE-001-B.md';
  const index = buildPacketSemanticIndex({
    dag: dag(),
    executionFiles: [file, finance],
    documents: {
      [file]: 'Primary kernels: K99\nPrimary journeys: J99\n',
      [finance]: 'Primary kernels: K10\nPrimary journeys: J7\n',
    },
    sourceRef: 'test-ref',
    intelligenceTopology: {
      journeys: [{ id: 'KF-JOURNEY-007' }],
      kernels: [{ id: 'KF-KERNEL-010' }],
    },
  });
  assert.ok(index.contradictions.some((x) => x.type === 'UNKNOWN_JOURNEY_REFERENCE'));
  assert.ok(index.contradictions.some((x) => x.type === 'UNKNOWN_KERNEL_REFERENCE'));
});

test('NEGATIVE CONTROL: packet without primary semantic anchors is partial', () => {
  const files = [
    'docs/intelligence/execution/KF-EXEC-ACTION-001-A.md',
    'docs/intelligence/execution/KF-EXEC-FINANCE-001-B.md',
  ];
  const index = buildPacketSemanticIndex({
    dag: dag(),
    executionFiles: files,
    documents: { [files[0]]: '# no metadata\n', [files[1]]: 'Primary kernels: K10\nPrimary journeys: J7\n' },
    sourceRef: 'test-ref',
    intelligenceTopology: null,
  });
  const action = index.packets.find((x) => x.packet_id === 'KF-EXEC-ACTION-001');
  assert.equal(action.semantic_status, 'PARTIAL');
  assert.ok(index.contradictions.some((x) => x.id === 'ATLAS-PACKET-MISSING-JOURNEY-KF-EXEC-ACTION-001'));
  assert.ok(index.contradictions.some((x) => x.id === 'ATLAS-PACKET-MISSING-KERNEL-KF-EXEC-ACTION-001'));
});
