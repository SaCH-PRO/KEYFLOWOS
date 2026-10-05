import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  aggregateProgrammeHealth,
  buildAtlasProjection,
  normalizeCheck,
  proofProgress,
} from './project-mission-control.service';

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-mission-control-'));
  fs.mkdirSync(path.join(root, 'architecture/atlas/generated'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps/server'), { recursive: true });
  return root;
}

function writeJson(root: string, relativePath: string, value: unknown) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
}

describe('ProjectMissionControlService proof truth', () => {
  it('does not count skipped checks as passing proof', () => {
    const checks = [
      normalizeCheck({ name: 'build', status: 'completed', conclusion: 'success' }),
      normalizeCheck({ name: 'optional', status: 'completed', conclusion: 'skipped' }),
      normalizeCheck({ name: 'security', status: 'completed', conclusion: 'failure' }),
    ];
    expect(proofProgress(checks)).toMatchObject({ completed: 1, total: 2 });
  });

  it('fails closed on stale/startup failures and keeps neutral evidence unknown', () => {
    expect(normalizeCheck({ name: 'stale', status: 'completed', conclusion: 'stale' }).status).toBe('FAIL');
    expect(normalizeCheck({ name: 'startup', status: 'completed', conclusion: 'startup_failure' }).status).toBe('FAIL');
    expect(normalizeCheck({ name: 'neutral', status: 'completed', conclusion: 'neutral' }).status).toBe('UNKNOWN');
  });

  it('keeps pending evidence in the denominator and deduplicates reruns', () => {
    const pending = [
      normalizeCheck({ name: 'build', status: 'completed', conclusion: 'success' }),
      normalizeCheck({ name: 'tests', status: 'in_progress', conclusion: null }),
    ];
    expect(proofProgress(pending)).toMatchObject({ completed: 1, total: 2 });

    expect(
      proofProgress([
        { name: 'tests', status: 'PASS' },
        { name: 'tests', status: 'FAIL' },
        { name: 'build', status: 'PASS' },
      ]),
    ).toMatchObject({ completed: 2, total: 2 });
  });

  it('never reports aggregate green when Atlas truth is contradicted or unknown', () => {
    expect(aggregateProgrammeHealth([{ health: 'GREEN' }], 'CONTRADICTED')).toBe('YELLOW');
    expect(aggregateProgrammeHealth([{ health: 'GREEN' }], 'UNKNOWN')).toBe('UNKNOWN');
    expect(aggregateProgrammeHealth([{ health: 'GREEN' }], 'FRESH')).toBe('GREEN');
  });

  it('returns unknown progress when there is no usable proof denominator', () => {
    expect(proofProgress([{ name: 'optional', status: 'SKIPPED' }])).toMatchObject({
      completed: null,
      total: null,
    });
  });
});

describe('Mission Control Atlas projection', () => {
  it('surfaces the 25 versus 26 journey contradiction instead of choosing a denominator', () => {
    const root = tempRepo();
    try {
      writeJson(root, 'architecture/atlas/generated/intelligence-topology.json', {
        schema: 'keyflowos-intelligence-topology/v1',
        verified_at: '2026-10-05',
        source_ref: 'docs/keyflow-intelligence-foundation',
        status: 'CONTRADICTED',
        claims: {
          analysis_map_journeys: 25,
          current_state_journeys: 26,
          analysis_map_kernels: 12,
          current_state_kernels: 12,
        },
        journeys: Array.from({ length: 25 }, (_, i) => ({ id: `J${i + 1}` })),
        kernels: Array.from({ length: 12 }, (_, i) => ({ id: `K${i + 1}` })),
        contradictions: [
          {
            id: 'ATLAS-INTEL-CONTRADICTION-JOURNEY-COUNT',
            subject: 'canonical_journey_count',
            analysis_map_value: 25,
            current_state_value: 26,
            disposition: 'UNRESOLVED',
          },
        ],
      });

      const atlas = buildAtlasProjection(root, new Date('2026-10-05T18:00:00Z'));
      expect(atlas.status).toBe('CONTRADICTED');
      expect(atlas.journeyCount).toEqual({
        named: 25,
        claimed: 26,
        status: 'CONTRADICTED',
      });
      expect(atlas.kernelCount.status).toBe('CONSISTENT');
      expect(atlas.contradictions).toHaveLength(1);
      expect(atlas.layers.find((layer) => layer.id === 'L2')?.status).toBe('CONTRADICTED');
      expect(atlas.layers.find((layer) => layer.id === 'L2')?.progress).toMatchObject({
        completed: null,
        total: null,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('marks missing generated artifacts explicitly instead of fabricating graph counts', () => {
    const root = tempRepo();
    try {
      writeJson(root, 'architecture/atlas/generated/intelligence-topology.json', {
        schema: 'keyflowos-intelligence-topology/v1',
        verified_at: '2026-10-05',
        status: 'CONSISTENT',
        claims: {
          analysis_map_journeys: 25,
          current_state_journeys: 25,
          analysis_map_kernels: 12,
          current_state_kernels: 12,
        },
        journeys: Array.from({ length: 25 }),
        kernels: Array.from({ length: 12 }),
        contradictions: [],
      });

      const atlas = buildAtlasProjection(root, new Date('2026-10-05T18:00:00Z'));
      expect(atlas.status).toBe('FRESH');
      expect(atlas.graph.nodes).toBeNull();
      expect(atlas.graph.edges).toBeNull();
      expect(atlas.graph.verifiedCodeLinks).toBeNull();
      expect(atlas.missingArtifacts).toContain('architecture/atlas/generated/atlas-graph.json');
      expect(atlas.missingArtifacts).toContain('architecture/atlas/generated/packet-code-links.json');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('marks accepted evidence stale only from an explicit verification date', () => {
    const root = tempRepo();
    try {
      writeJson(root, 'architecture/atlas/generated/intelligence-topology.json', {
        verified_at: '2026-09-01',
        status: 'CONSISTENT',
        journeys: [],
        kernels: [],
        contradictions: [],
      });
      const atlas = buildAtlasProjection(root, new Date('2026-10-05T18:00:00Z'));
      expect(atlas.status).toBe('STALE');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('is UNKNOWN when the repository/Atlas cannot be resolved', () => {
    const atlas = buildAtlasProjection(null);
    expect(atlas.status).toBe('UNKNOWN');
    expect(atlas.graph.nodes).toBeNull();
    expect(atlas.layers.every((layer) => layer.status === 'UNVERIFIED')).toBe(true);
  });
});
