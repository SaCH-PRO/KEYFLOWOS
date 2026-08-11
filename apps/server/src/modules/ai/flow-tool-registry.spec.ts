import { describe, it, expect } from 'vitest';
import {
  FLOW_TOOLS,
  CORTEX_TOOL_BRIDGE,
  isCortexBridgedTool,
  getToolByName,
} from './flow-tool-registry';

/**
 * Single-source-of-truth guards for the Flow tool registry.
 *
 * Per ADR-0001 (Flow is the execution substrate), FLOW_TOOLS is the canonical
 * catalogue of every tool KEY can execute. These tests keep the catalogue and
 * its one seam to the cortex organ handlers (CORTEX_TOOL_BRIDGE) honest, so the
 * two-stack consolidation cannot silently regress.
 */
describe('flow-tool-registry — single source of truth', () => {
  it('has no duplicate tool names', () => {
    const seen = new Map<string, number>();
    for (const t of FLOW_TOOLS) seen.set(t.name, (seen.get(t.name) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name);
    expect(dupes).toEqual([]);
  });

  it('every tool declares a family, a risk tier 1-4, and a manual-equivalent route', () => {
    for (const t of FLOW_TOOLS) {
      expect(t.name).toBeTruthy();
      expect(['read', 'draft', 'organize', 'execute', 'crud']).toContain(t.family);
      expect(t.riskTier).toBeGreaterThanOrEqual(1);
      expect(t.riskTier).toBeLessThanOrEqual(4);
      // manual-equivalent route is CI-enforced elsewhere; assert presence here too
      expect(typeof t.manualEquivalentRoute).toBe('string');
      expect(t.manualEquivalentRoute.startsWith('/')).toBe(true);
    }
  });
});

describe('flow-tool-registry — CORTEX_TOOL_BRIDGE seam', () => {
  it('every bridged name is a real FLOW tool (no phantom bridges)', () => {
    for (const flowName of Object.keys(CORTEX_TOOL_BRIDGE)) {
      expect(getToolByName(flowName), `bridge references unknown flow tool "${flowName}"`).toBeDefined();
    }
  });

  it('every bridge target is a fully-qualified cortex organ tool name', () => {
    for (const cortexName of Object.values(CORTEX_TOOL_BRIDGE)) {
      // qualified as "<organ>.<tool>", e.g. "key_inbox.list_threads"
      expect(cortexName).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+$/);
    }
  });

  it('isCortexBridgedTool agrees with the bridge map', () => {
    for (const flowName of Object.keys(CORTEX_TOOL_BRIDGE)) {
      expect(isCortexBridgedTool(flowName)).toBe(true);
    }
    expect(isCortexBridgedTool('definitely_not_a_bridged_tool')).toBe(false);
  });

  it('the bridge stays small — widening it is a deliberate consolidation decision (ADR-0001)', () => {
    // Guardrail, not a hard cap: if this fails, the seam is growing. Update the
    // number consciously and record why in ADR-0001's migration ledger.
    expect(Object.keys(CORTEX_TOOL_BRIDGE).length).toBeLessThanOrEqual(4);
  });
});
