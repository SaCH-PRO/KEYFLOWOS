import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { CrmSequenceService } from '../src/modules/crm/crm-sequence.service';
import type { SequenceGraph } from '../src/modules/crm/crm-sequence-graph.util';

const businessId = 'biz-1';
const sequenceId = 'seq-1';

function makeGraph(): SequenceGraph {
  return {
    nodes: [
      {
        id: 'send',
        type: 'email',
        data: {
          subject: 's',
          body: 'b',
          variants: [
            { id: 'v1', label: 'A', weight: 1, subject: 'A', body: 'A' },
            { id: 'v2', label: 'B', weight: 1, subject: 'B', body: 'B' },
          ],
        },
      },
      { id: 'end', type: 'end', data: {} },
    ],
    edges: [{ id: 'e', source: 'send', target: 'end', branch: 'default' }],
    startNodeId: 'send',
    version: 1,
  };
}

function enrollmentWithEvents(
  id: string,
  variantId: string,
  flags: { opened?: boolean; clicked?: boolean; replied?: boolean; converted?: boolean } = {},
) {
  const stamp = new Date().toISOString();
  return {
    id,
    metadata: {
      stepEvents: {
        send: {
          variantId,
          sentAt: stamp,
          ...(flags.opened ? { openedAt: stamp } : {}),
          ...(flags.clicked ? { clickedAt: stamp } : {}),
          ...(flags.replied ? { repliedAt: stamp } : {}),
          ...(flags.converted ? { convertedAt: stamp } : {}),
        },
      },
    },
  };
}

function makePrisma(graph: SequenceGraph, enrollments: any[], promotedVariantId: string | null = null) {
  const g = JSON.parse(JSON.stringify(graph)) as SequenceGraph;
  const sendNode = g.nodes.find((n) => n.id === 'send')!;
  if (promotedVariantId) sendNode.data!.promotedVariantId = promotedVariantId;
  return {
    client: {
      crmSequence: {
        findFirst: vi.fn(async ({ where }: any) =>
          where.id === sequenceId && where.businessId === businessId
            ? { id: sequenceId, businessId, graph: g, steps: [], enrollments }
            : null,
        ),
      },
    },
  };
}

function build(prisma: any) {
  const timeline = { logEvent: vi.fn(async () => undefined) } as any;
  return new CrmSequenceService(prisma as any, timeline);
}

describe('CrmSequenceService.getVariantReport', () => {
  it('aggregates send/open/click/reply/conversion counts per variant', async () => {
    const enrollments = [
      enrollmentWithEvents('e1', 'v1', { opened: true, clicked: true, replied: true }),
      enrollmentWithEvents('e2', 'v1', { opened: true }),
      enrollmentWithEvents('e3', 'v2', { opened: true, converted: true }),
      enrollmentWithEvents('e4', 'v2', {}),
    ];
    const svc = build(makePrisma(makeGraph(), enrollments));
    const report = await svc.getVariantReport(businessId, sequenceId);

    expect(report).toHaveLength(1);
    const step = report[0];
    expect(step.nodeId).toBe('send');
    expect(step.totalEnrollments).toBe(4);
    const v1 = step.variants.find((v) => v.variantId === 'v1')!;
    const v2 = step.variants.find((v) => v.variantId === 'v2')!;
    expect(v1.sent).toBe(2);
    expect(v1.opened).toBe(2);
    expect(v1.clicked).toBe(1);
    expect(v1.replied).toBe(1);
    expect(v1.openRate).toBe(1);
    expect(v1.replyRate).toBe(0.5);
    expect(v2.sent).toBe(2);
    expect(v2.converted).toBe(1);
    expect(v2.conversionRate).toBe(0.5);
  });

  it('does not crown a winner below the 30-per-variant minimum sample size', async () => {
    // Lopsided but tiny sample: v1 5/5 opens, v2 0/5 opens
    const enrollments = [
      ...Array.from({ length: 5 }, (_, i) => enrollmentWithEvents(`a${i}`, 'v1', { opened: true })),
      ...Array.from({ length: 5 }, (_, i) => enrollmentWithEvents(`b${i}`, 'v2')),
    ];
    const svc = build(makePrisma(makeGraph(), enrollments));
    const [step] = await svc.getVariantReport(businessId, sequenceId);
    expect(step.winnerVariantId).toBeNull();
    expect(step.winnerConfidence).toBe(0);
  });

  it('does not crown a winner when confidence is below 95%', async () => {
    // 30 vs 30 opens with a tiny lift — noise, not signal
    const enrollments = [
      ...Array.from({ length: 30 }, (_, i) =>
        enrollmentWithEvents(`a${i}`, 'v1', { opened: i < 16 }),
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        enrollmentWithEvents(`b${i}`, 'v2', { opened: i < 15 }),
      ),
    ];
    const svc = build(makePrisma(makeGraph(), enrollments));
    const [step] = await svc.getVariantReport(businessId, sequenceId);
    expect(step.winnerVariantId).toBeNull();
    expect(step.winnerConfidence).toBeLessThan(0.95);
  });

  it('crowns a winner when sample size and lift exceed thresholds', async () => {
    // 50 each, big open-rate gap (45/50 vs 10/50)
    const enrollments = [
      ...Array.from({ length: 50 }, (_, i) =>
        enrollmentWithEvents(`a${i}`, 'v1', { opened: i < 45 }),
      ),
      ...Array.from({ length: 50 }, (_, i) =>
        enrollmentWithEvents(`b${i}`, 'v2', { opened: i < 10 }),
      ),
    ];
    const svc = build(makePrisma(makeGraph(), enrollments));
    const [step] = await svc.getVariantReport(businessId, sequenceId);
    expect(step.winnerVariantId).toBe('v1');
    expect(step.winnerConfidence).toBeGreaterThanOrEqual(0.95);
    const winnerBucket = step.variants.find((v) => v.variantId === 'v1')!;
    expect(winnerBucket.isWinner).toBe(true);
    expect(winnerBucket.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('prefers replyRate over openRate when any replies are present', async () => {
    // v1 wins on opens, v2 wins on replies — replies should drive the call
    const enrollments = [
      ...Array.from({ length: 50 }, (_, i) =>
        enrollmentWithEvents(`a${i}`, 'v1', { opened: i < 45, replied: i < 5 }),
      ),
      ...Array.from({ length: 50 }, (_, i) =>
        enrollmentWithEvents(`b${i}`, 'v2', { opened: i < 20, replied: i < 30 }),
      ),
    ];
    const svc = build(makePrisma(makeGraph(), enrollments));
    const [step] = await svc.getVariantReport(businessId, sequenceId);
    expect(step.winnerVariantId).toBe('v2');
    expect(step.winnerConfidence).toBeGreaterThanOrEqual(0.95);
  });

  it('reports the promoted variant flag without altering winner detection', async () => {
    const enrollments = [
      ...Array.from({ length: 50 }, (_, i) =>
        enrollmentWithEvents(`a${i}`, 'v1', { opened: i < 45 }),
      ),
      ...Array.from({ length: 50 }, (_, i) =>
        enrollmentWithEvents(`b${i}`, 'v2', { opened: i < 10 }),
      ),
    ];
    // Promote the loser; the report should still crown v1 as winner
    const svc = build(makePrisma(makeGraph(), enrollments, 'v2'));
    const [step] = await svc.getVariantReport(businessId, sequenceId);
    expect(step.promotedVariantId).toBe('v2');
    expect(step.winnerVariantId).toBe('v1');
    const v2 = step.variants.find((v) => v.variantId === 'v2')!;
    expect(v2.isPromoted).toBe(true);
    expect(v2.isWinner).toBe(false);
  });

  it('throws when the sequence is not found for the business', async () => {
    const prisma = {
      client: { crmSequence: { findFirst: vi.fn(async () => null) } },
    };
    const svc = build(prisma);
    await expect(svc.getVariantReport(businessId, 'missing')).rejects.toThrow(/not found/i);
  });
});
