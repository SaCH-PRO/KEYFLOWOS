import { describe, expect, it } from 'vitest';
import { CapabilityContractService } from './capability-contract.service';

/**
 * Stage 3 contract test: every registered capability MUST be a complete,
 * well-formed platform definition. A failure here blocks merging a tool that
 * can't be safely invoked by all consumers (UI, automation, KEY, apps).
 */
describe('CapabilityContractService (platform contract)', () => {
  const service = new CapabilityContractService();
  const all = service.list();

  it('exposes the full FLOW_TOOLS registry', () => {
    expect(all.length).toBeGreaterThan(150);
  });

  it('every capability has a complete contract', () => {
    for (const cap of all) {
      expect(cap.name, 'name').toMatch(/^[a-z0-9_]+$/);
      expect(cap.version, `${cap.name} version`).toBeGreaterThanOrEqual(1);
      expect(cap.ownerModule, `${cap.name} owner`).toBeTruthy();
      expect(cap.description.length, `${cap.name} description`).toBeGreaterThan(10);
      expect(cap.inputSchema, `${cap.name} inputSchema`).toBeTruthy();
      expect(cap.outputSchema, `${cap.name} outputSchema`).toBeTruthy();
      expect([1, 2, 3, 4], `${cap.name} riskTier`).toContain(cap.riskTier);
      expect(['low', 'medium', 'high'], `${cap.name} riskLevel`).toContain(cap.riskLevel);
      expect(cap.permission, `${cap.name} permission format`).toMatch(/^[a-z]+\.[a-z]+\.[a-z0-9_]+$/);
      expect(cap.permission.startsWith(`${cap.ownerModule}.`), `${cap.name} permission prefix`).toBe(true);
      expect(['SYNC', 'ASYNC'], `${cap.name} executionMode`).toContain(cap.executionMode);
      expect(['REQUIRED', 'SUPPORTED', 'NONE'], `${cap.name} idempotency`).toContain(cap.idempotency);
      expect(cap.manualEquivalentRoute, `${cap.name} manual route`).toMatch(/^\/app\//);
      expect(Array.isArray(cap.changedEntities), `${cap.name} changedEntities`).toBe(true);
      if (cap.riskTier >= 3) {
        expect(cap.requiresApproval, `${cap.name} tier-3 must require approval`).toBe(true);
      }
    }
  });

  it('names are unique', () => {
    const names = all.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('execution mode matches family semantics', () => {
    for (const cap of all) {
      if (cap.family === 'read' || cap.family === 'draft') {
        expect(cap.executionMode, `${cap.name} should be SYNC`).toBe('SYNC');
      } else {
        expect(cap.executionMode, `${cap.name} should be ASYNC`).toBe('ASYNC');
      }
    }
  });

  it('get() and stats() are consistent with list()', () => {
    const stats = service.stats();
    expect(stats.total).toBe(all.length);
    for (const cap of all) {
      expect(service.get(cap.name)?.name).toBe(cap.name);
    }
    expect(service.get('definitely_not_a_capability')).toBeNull();
  });
});
