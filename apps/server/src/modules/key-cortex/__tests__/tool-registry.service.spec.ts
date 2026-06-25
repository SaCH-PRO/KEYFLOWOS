import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistryService } from '../tool-registry.service';

describe('Phase 18E — ToolRegistryService', () => {
  let registry: ToolRegistryService;

  beforeEach(() => {
    registry = new ToolRegistryService();
  });

  // ── Registration ──────────────────────────────────────────

  it('should register all 16 tools at boot', () => {
    const stats = registry.getStats();
    expect(stats.total).toBe(16);
  });

  it('should retrieve any tool by id', () => {
    const tool = registry.getTool('task.create');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('Create Task');
    expect(tool!.category).toBe('workflow');
  });

  it('should return undefined for unknown tools', () => {
    const tool = registry.getTool('unknown.tool');
    expect(tool).toBeUndefined();
  });

  // ── Categories ────────────────────────────────────────────

  it('should group tools by category', () => {
    const workflowTools = registry.getToolsByCategory('workflow');
    expect(workflowTools.length).toBeGreaterThan(0);
    expect(workflowTools.every((t) => t.category === 'workflow')).toBe(true);
  });

  // ── Genome readiness gate ─────────────────────────────────

  describe('checkReadiness', () => {
    it('should allow when readiness meets minimum', () => {
      const result = registry.checkReadiness('task.create', 'growth', 70, { execution: 80 });
      expect(result.allowed).toBe(true);
    });

    it('should deny when readiness below minimum', () => {
      const result = registry.checkReadiness('invoice.create', 'seed', 20, {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('below minimum');
    });

    it('should deny when DNA dimension below minimum', () => {
      const result = registry.checkReadiness('invoice.create', 'growth', 70, { finance: 30 });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('finance');
    });

    it('should allow for unknown tool (defensive)', () => {
      const result = registry.checkReadiness('unknown.tool', 'growth', 100, {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  // ── Risk assessment ───────────────────────────────────────

  describe('risk levels', () => {
    it('should identify high-risk tools', () => {
      expect(registry.getRiskLevel('invoice.create')).toBe('high');
      expect(registry.getRiskLevel('email.send')).toBe('high');
    });

    it('should identify low-risk tools', () => {
      expect(registry.getRiskLevel('task.create')).toBe('low');
      expect(registry.getRiskLevel('knowledge.search')).toBe('low');
    });
  });

  describe('approval requirements', () => {
    it('should require approval for high-risk tools', () => {
      expect(registry.requiresApproval('invoice.create')).toBe(true);
      expect(registry.requiresApproval('flow.execute')).toBe(true);
    });

    it('should not require approval for low-risk tools', () => {
      expect(registry.requiresApproval('task.create')).toBe(false);
      expect(registry.requiresApproval('reminder.schedule')).toBe(false);
    });
  });

  describe('dry run support', () => {
    it('should support dry-run for reversible tools', () => {
      expect(registry.supportsDryRun('task.create')).toBe(true);
      expect(registry.supportsDryRun('event.create')).toBe(true);
    });

    it('should not support dry-run for communication tools', () => {
      expect(registry.supportsDryRun('email.send')).toBe(false);
    });
  });

  // ── Statistics ────────────────────────────────────────────

  it('should provide risk distribution', () => {
    const stats = registry.getStats();
    expect(stats.byRisk.low + stats.byRisk.medium + stats.byRisk.high + stats.byRisk.critical).toBe(16);
  });

  it('should provide category distribution', () => {
    const stats = registry.getStats();
    expect(Object.values(stats.byCategory).reduce((s, v) => s + v, 0)).toBe(16);
  });
});
