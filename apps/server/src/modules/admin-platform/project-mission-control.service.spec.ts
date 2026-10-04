import { describe, expect, it } from 'vitest';
import { normalizeCheck, proofProgress } from './project-mission-control.service';

describe('ProjectMissionControlService proof truth', () => {
  it('does not count skipped checks as passing proof', () => {
    const checks = [
      normalizeCheck({ name: 'build', status: 'completed', conclusion: 'success' }),
      normalizeCheck({ name: 'optional', status: 'completed', conclusion: 'skipped' }),
      normalizeCheck({ name: 'security', status: 'completed', conclusion: 'failure' }),
    ];
    expect(proofProgress(checks)).toMatchObject({ completed: 1, total: 2 });
  });

  it('keeps pending evidence in the denominator and never calls it complete', () => {
    const checks = [
      normalizeCheck({ name: 'build', status: 'completed', conclusion: 'success' }),
      normalizeCheck({ name: 'tests', status: 'in_progress', conclusion: null }),
    ];
    expect(proofProgress(checks)).toMatchObject({ completed: 1, total: 2 });
  });

  it('deduplicates reruns by check name so stale runs cannot inflate progress', () => {
    const checks = [
      { name: 'tests', status: 'PASS' as const },
      { name: 'tests', status: 'FAIL' as const },
      { name: 'build', status: 'PASS' as const },
    ];
    expect(proofProgress(checks)).toMatchObject({ completed: 2, total: 2 });
  });

  it('returns unknown progress when there is no usable proof denominator', () => {
    expect(proofProgress([{ name: 'optional', status: 'SKIPPED' }])).toMatchObject({
      completed: null,
      total: null,
    });
  });
});
