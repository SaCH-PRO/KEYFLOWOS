/**
 * FU-PATTERNS-ROUTES-SIGHT (security review round 5, F-1): what PatternDetectorService stores as one AiMemory
 * 'patterns' row is bounded. Its support cluster copied each ticket's title (member-written, unbounded but for the
 * 100 KB body limit) into the pattern's title and every affected entity's label, so one scan stored rows of ~400 KB,
 * which every partial reader's GET .../agent/patterns reads and classifies for 30 days. The memory PUTs refuse a value
 * over 2,000 characters; the detector now stores no pattern over that either. Pure: Prisma, the model and the memory
 * service are stand-ins.
 */
import { describe, it, expect } from 'vitest';
import { PatternDetectorService } from './pattern-detector.service';

const MAX = 2_000;

function detectorOver(tickets: unknown[], modelContent: string) {
  const stored: Array<{ key: string; value: string }> = [];
  const prisma = {
    client: {
      supportTicket: { findMany: async () => tickets },
      booking: { findMany: async () => [] },
      contactEvent: { findMany: async () => [] },
      invoice: { findMany: async () => [] },
    },
  };
  const memory = { upsert: async (_b: string, row: { key: string; value: string }) => { stored.push(row); return row; } };
  const aiUsage = { trackAndComplete: async () => ({ content: modelContent, toolCalls: [], usage: {} }) };
  const events = { emit: () => true };
  const detector = new PatternDetectorService(prisma as any, events as any, {} as any, memory as any, aiUsage as any);
  return { detector, stored };
}

describe('PatternDetectorService stores no pattern over 2,000 characters (FU-PATTERNS-ROUTES-SIGHT round 5)', () => {
  it('a support cluster of 33 titles of ~99 KB each (3 tickets a title) stores 33 bounded patterns, each still naming its category and its tickets', async () => {
    const tickets = Array.from({ length: 99 }, (_, i) => ({
      id: `t${i}`, title: `revenue issue ${Math.floor(i / 3)} ${'x'.repeat(99_000)}`, status: 'OPEN', priority: 'HIGH', orgUnitId: null, createdAt: new Date(),
    }));
    const { detector, stored } = detectorOver(tickets, '{"patterns": []}');
    const scan = await detector.scanBusiness('biz');
    const clusters = stored.filter((r) => r.key.startsWith('pattern_support_cluster_'));
    expect(clusters).toHaveLength(33);
    for (const row of stored) expect(row.value.length, row.key).toBeLessThanOrEqual(MAX);
    for (const p of scan.patterns) expect(JSON.stringify(p).length).toBeLessThanOrEqual(MAX);
    const first = JSON.parse(clusters[0].value);
    expect(first.category).toBe('support_cluster');
    expect(first.title).toContain('Multiple tickets about "revenue issue');
    expect(first.affectedEntities.length).toBeGreaterThan(0);
    expect(first.affectedEntities[0].type).toBe('supportTicket');
  });

  it("a model pattern over the bound (a 5,000-character description) is stored bounded", async () => {
    const tickets = [0, 1].map((i) => ({ id: `t${i}`, title: `ticket ${i}`, status: 'OPEN', priority: 'LOW', orgUnitId: null, createdAt: new Date() }));
    const model = JSON.stringify({ patterns: [{ category: 'support_theme', severity: 'info', title: 'A theme', description: 'd'.repeat(5_000), confidence: 0.7, suggestedAction: 'a'.repeat(3_000) }] });
    const { detector, stored } = detectorOver(tickets, model);
    await detector.scanBusiness('biz');
    expect(stored.length).toBeGreaterThan(0);
    for (const row of stored) expect(row.value.length, row.key).toBeLessThanOrEqual(MAX);
  });
});
