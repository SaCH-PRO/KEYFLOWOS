import { describe, it, expect } from 'vitest';
import {
  pickVariantId,
  validateGraph,
  type SequenceGraph,
  type SequenceNode,
} from './crm-sequence-graph.util';

function sendNode(overrides: Partial<SequenceNode> = {}): SequenceNode {
  return {
    id: 'n1',
    type: 'email',
    data: { subject: 's', body: 'b' },
    ...overrides,
  };
}

describe('pickVariantId', () => {
  it('returns null when the node has no variants (legacy single-content)', () => {
    const node = sendNode();
    expect(pickVariantId(node)).toBeNull();
  });

  it('always returns the only variant when there is just one', () => {
    const node = sendNode({
      data: {
        variants: [{ id: 'a', weight: 1, body: 'x' }],
      },
    });
    // Run many times with random rng to verify it never deviates.
    for (let i = 0; i < 25; i++) {
      expect(pickVariantId(node, Math.random)).toBe('a');
    }
  });

  it('respects weighting via the rng (low rand → first bucket, high rand → last)', () => {
    const node = sendNode({
      data: {
        variants: [
          { id: 'a', weight: 1, body: 'x' },
          { id: 'b', weight: 1, body: 'x' },
          { id: 'c', weight: 2, body: 'x' },
        ],
      },
    });
    // total weight = 4. r = rand*4. r < 1 → 'a', r in [1,2) → 'b', r in [2,4) → 'c'.
    expect(pickVariantId(node, () => 0)).toBe('a');
    expect(pickVariantId(node, () => 0.2)).toBe('a');
    expect(pickVariantId(node, () => 0.3)).toBe('b');
    expect(pickVariantId(node, () => 0.6)).toBe('c');
    expect(pickVariantId(node, () => 0.999)).toBe('c');
  });

  it('produces a distribution roughly matching the configured weights', () => {
    const node = sendNode({
      data: {
        variants: [
          { id: 'a', weight: 1, body: 'x' },
          { id: 'b', weight: 3, body: 'x' },
        ],
      },
    });
    const counts: Record<string, number> = { a: 0, b: 0 };
    let seed = 1;
    const rng = () => {
      // deterministic LCG so the test is reproducible
      seed = (seed * 1664525 + 1013904223) % 0xffffffff;
      return seed / 0xffffffff;
    };
    for (let i = 0; i < 4000; i++) {
      counts[pickVariantId(node, rng)!]++;
    }
    // Expected ratio is ~1:3 (25% / 75%). Allow a generous tolerance.
    const aShare = counts.a / 4000;
    expect(aShare).toBeGreaterThan(0.18);
    expect(aShare).toBeLessThan(0.32);
  });

  it('always returns the promoted variant (sticky winner) regardless of weights', () => {
    const node = sendNode({
      data: {
        promotedVariantId: 'b',
        variants: [
          { id: 'a', weight: 100, body: 'x' },
          { id: 'b', weight: 1, body: 'x' },
        ],
      },
    });
    for (let i = 0; i < 25; i++) {
      expect(pickVariantId(node, Math.random)).toBe('b');
    }
  });

  it('falls back to the first variant when total weight is zero', () => {
    const node = sendNode({
      data: {
        variants: [
          { id: 'a', weight: 0, body: 'x' },
          { id: 'b', weight: 0, body: 'x' },
        ],
      },
    });
    expect(pickVariantId(node, () => 0.5)).toBe('a');
  });

  it('ignores promoted id when it does not match any current variant', () => {
    const node = sendNode({
      data: {
        promotedVariantId: 'gone',
        variants: [{ id: 'a', weight: 1, body: 'x' }],
      },
    });
    expect(pickVariantId(node)).toBe('a');
  });
});

function buildGraph(nodes: SequenceNode[], edges: SequenceGraph['edges']): SequenceGraph {
  return { nodes, edges, startNodeId: nodes[0]?.id ?? null, version: 1 };
}

describe('validateGraph', () => {
  it('passes a minimal valid email→end graph', () => {
    const g = buildGraph(
      [
        { id: 'a', type: 'email', data: { subject: 'hi', body: 'hello' } },
        { id: 'z', type: 'end', data: {} },
      ],
      [{ id: 'e', source: 'a', target: 'z', branch: 'default' }],
    );
    expect(validateGraph(g)).toEqual({ ok: true, errors: [] });
  });

  describe('variant rules', () => {
    const baseEdge = { id: 'e', source: 'a', target: 'z', branch: 'default' as const };
    const endNode: SequenceNode = { id: 'z', type: 'end', data: {} };

    it('rejects more than 3 variants on a send node', () => {
      const g = buildGraph(
        [
          {
            id: 'a',
            type: 'email',
            data: {
              variants: [
                { id: 'v1', weight: 1, subject: 's', body: 'b' },
                { id: 'v2', weight: 1, subject: 's', body: 'b' },
                { id: 'v3', weight: 1, subject: 's', body: 'b' },
                { id: 'v4', weight: 1, subject: 's', body: 'b' },
              ],
            },
          },
          endNode,
        ],
        [baseEdge],
      );
      const r = validateGraph(g);
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => /at most 3 variants/.test(e))).toBe(true);
    });

    it('rejects duplicate variant ids', () => {
      const g = buildGraph(
        [
          {
            id: 'a',
            type: 'email',
            data: {
              variants: [
                { id: 'v1', weight: 1, subject: 's', body: 'b' },
                { id: 'v1', weight: 1, subject: 's', body: 'b' },
              ],
            },
          },
          endNode,
        ],
        [baseEdge],
      );
      const r = validateGraph(g);
      expect(r.errors.some((e) => /Duplicate variant id "v1"/.test(e))).toBe(true);
    });

    it('rejects negative weights and zero combined weight', () => {
      const g = buildGraph(
        [
          {
            id: 'a',
            type: 'email',
            data: {
              variants: [
                { id: 'v1', weight: -1, subject: 's', body: 'b' },
                { id: 'v2', weight: 0, subject: 's', body: 'b' },
              ],
            },
          },
          endNode,
        ],
        [baseEdge],
      );
      const r = validateGraph(g);
      expect(r.errors.some((e) => /non-negative weight/.test(e))).toBe(true);
      expect(r.errors.some((e) => /combined weight > 0/.test(e))).toBe(true);
    });

    it('requires subject on email variants and body on every variant when strict', () => {
      const g = buildGraph(
        [
          {
            id: 'a',
            type: 'email',
            data: {
              variants: [
                { id: 'v1', weight: 1, body: 'b' }, // missing subject
                { id: 'v2', weight: 1, subject: 's' }, // missing body
              ],
            },
          },
          endNode,
        ],
        [baseEdge],
      );
      const r = validateGraph(g);
      expect(r.errors.some((e) => /requires a subject/.test(e))).toBe(true);
      expect(r.errors.some((e) => /requires a body/.test(e))).toBe(true);
    });

    it('allows missing subject/body on variants when not strict', () => {
      const g = buildGraph(
        [
          {
            id: 'a',
            type: 'email',
            data: {
              variants: [{ id: 'v1', weight: 1 }],
            },
          },
          endNode,
        ],
        [baseEdge],
      );
      const r = validateGraph(g, { strict: false });
      expect(r.ok).toBe(true);
    });

    it('rejects a promotedVariantId that does not match any variant', () => {
      const g = buildGraph(
        [
          {
            id: 'a',
            type: 'email',
            data: {
              promotedVariantId: 'ghost',
              variants: [{ id: 'v1', weight: 1, subject: 's', body: 'b' }],
            },
          },
          endNode,
        ],
        [baseEdge],
      );
      const r = validateGraph(g);
      expect(r.errors.some((e) => /Promoted variant "ghost"/.test(e))).toBe(true);
    });
  });

  describe('branch conditions', () => {
    const yesEnd: SequenceNode = { id: 'y', type: 'end', data: {} };
    const noEnd: SequenceNode = { id: 'n', type: 'end', data: {} };
    const branchEdges = [
      { id: 'eb-y', source: 'b', target: 'y', branch: 'yes' as const },
      { id: 'eb-n', source: 'b', target: 'n', branch: 'no' as const },
    ];

    it('requires targetHealth when condition is relationship_health_changed_to', () => {
      const g = buildGraph(
        [
          { id: 'b', type: 'branch', data: { condition: 'relationship_health_changed_to' } },
          yesEnd,
          noEnd,
        ],
        branchEdges,
      );
      const r = validateGraph(g);
      expect(r.errors.some((e) => /requires a targetHealth/.test(e))).toBe(true);
    });

    it('passes when targetHealth is provided for relationship_health_changed_to', () => {
      const g = buildGraph(
        [
          {
            id: 'b',
            type: 'branch',
            data: { condition: 'relationship_health_changed_to', targetHealth: 'HOT' },
          },
          yesEnd,
          noEnd,
        ],
        branchEdges,
      );
      expect(validateGraph(g)).toEqual({ ok: true, errors: [] });
    });

    it('requires targetChannel when condition is best_channel', () => {
      const g = buildGraph(
        [
          { id: 'b', type: 'branch', data: { condition: 'best_channel' } },
          yesEnd,
          noEnd,
        ],
        branchEdges,
      );
      const r = validateGraph(g);
      expect(r.errors.some((e) => /requires a targetChannel/.test(e))).toBe(true);
    });

    it('requires positive waitForDays when condition is not_opened_in_days', () => {
      const g = buildGraph(
        [
          { id: 'b', type: 'branch', data: { condition: 'not_opened_in_days', waitForDays: 0 } },
          yesEnd,
          noEnd,
        ],
        branchEdges,
      );
      const r = validateGraph(g);
      expect(r.errors.some((e) => /positive waitForDays/.test(e))).toBe(true);
    });

    it('rejects branch nodes that lack both yes and no outgoing edges', () => {
      const g = buildGraph(
        [
          { id: 'b', type: 'branch', data: { condition: 'no_reply', waitForDays: 1 } },
          yesEnd,
        ],
        [{ id: 'eb-y', source: 'b', target: 'y', branch: 'yes' }],
      );
      const r = validateGraph(g);
      expect(r.errors.some((e) => /must have both "yes" and "no"/.test(e))).toBe(true);
    });
  });
});
