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
import { aiMemoryRowVisibleTo } from './semantic-memory-sight';

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

  // Correctness review round 6 (COR-R5-1): clipping cut the words or figure that made a pattern money or an expense,
  // so a stored row withheld before became visible (sometimes with the figure still in it). The class is decided on
  // the pattern before it is clipped and kept.
  const noRevenue = { reader: 'u1', sight: (m: string) => m !== 'revenue' } as any;
  const noExpenses = { reader: 'u1', sight: (m: string) => m !== 'expenses' } as any;
  const owner = { reader: 'u0', sight: () => true } as any;
  const visibleTo = (row: { key: string; value: string }, who: any) => aiMemoryRowVisibleTo({ category: 'patterns', key: row.key, value: row.value }, who);

  it.each([
    ['figure past the clip', `${'a'.repeat(265)} 900 outstanding`, noRevenue],
    ['currency code past the clip', `${'a'.repeat(268)} 4000 TTD`, noRevenue],
    ['refund past the clip', `${'a'.repeat(300)} refund $4,000`, noRevenue],
    ['expense past the clip', `${'a'.repeat(300)} rent`, noExpenses],
    ['over the classifier bound (99 KB)', `revenue ${'x'.repeat(99_000)}`, noRevenue],
  ])('a support cluster whose money or expense is %s stays withheld once stored bounded; the owner reads it', async (_label, title, reader) => {
    const tickets = [0, 1, 2].map((i) => ({ id: `t${i}`, title, status: 'OPEN', priority: 'LOW', orgUnitId: null, createdAt: new Date() }));
    const { detector, stored } = detectorOver(tickets, '{"patterns": []}');
    const scan = await detector.scanBusiness('biz');
    const row = stored.find((r) => r.key.startsWith('pattern_support_cluster_'))!;
    expect(row.value.length).toBeLessThanOrEqual(MAX);
    expect(visibleTo(row, reader), row.value.slice(0, 400)).toBe(false);
    expect(visibleTo(row, owner)).toBe(true);
    const answered = scan.patterns.find((p: any) => p.category === 'support_cluster');
    expect(visibleTo({ key: 'pattern_support_cluster', value: JSON.stringify(answered) }, reader)).toBe(false);
  });

  it('a model pattern whose money is only past the clip (its category) stays withheld once stored bounded', async () => {
    const tickets = [0, 1].map((i) => ({ id: `t${i}`, title: `ticket ${i}`, status: 'OPEN', priority: 'LOW', orgUnitId: null, createdAt: new Date() }));
    const model = JSON.stringify({ patterns: [{ category: `${'q'.repeat(80)}_revenue_risk`, severity: 'warning', title: 'A theme', description: 'Something to look at', confidence: 0.7, suggestedAction: 'Look' }] });
    const { detector, stored } = detectorOver(tickets, model);
    await detector.scanBusiness('biz');
    expect(stored).toHaveLength(1);
    expect(visibleTo(stored[0], noRevenue), stored[0].value).toBe(false);
  });

  // Correctness COR-R5-2 / security F-3 (round 6): the bound holds after JSON escaping, and the model's severity and
  // category are not carried unbounded.
  it('control characters, quotes and a 3,000-character model severity still store at most 2,000 characters', async () => {
    const control = '\u0001'.repeat(5_000);
    const tickets = [0, 1, 2].map((i) => ({ id: `t${i}`, title: control, status: 'OPEN', priority: 'LOW', orgUnitId: null, createdAt: new Date() }));
    const model = JSON.stringify({ patterns: [{ category: 'x', severity: 's'.repeat(3_000), title: '\u0001'.repeat(400), description: '"'.repeat(400), confidence: 0.5, suggestedAction: '\\'.repeat(400) }] });
    const { detector, stored } = detectorOver(tickets, model);
    const scan = await detector.scanBusiness('biz');
    expect(stored.length).toBe(2);
    for (const row of stored) expect(row.value.length, row.key).toBeLessThanOrEqual(MAX);
    for (const p of scan.patterns) {
      expect(JSON.stringify(p).length).toBeLessThanOrEqual(MAX);
      expect(['critical', 'warning', 'info']).toContain(p.severity);
    }
  });

  // Correctness review round 7 (COR-R6-1): the expense stamp must not itself read as money ('expense' is a money
  // term): an expense-only pattern stays readable by a member with expenses read and without revenue read.
  it('an expense-only cluster (late suppliers) stays visible to a member with expenses read and no revenue read, and withheld from one without expenses read', async () => {
    const tickets = [0, 1, 2].map((i) => ({ id: `t${i}`, title: 'late suppliers', status: 'OPEN', priority: 'LOW', orgUnitId: null, createdAt: new Date() }));
    const { detector, stored } = detectorOver(tickets, '{"patterns": []}');
    const scan = await detector.scanBusiness('biz');
    const row = stored.find((r) => r.key.startsWith('pattern_support_cluster_'))!;
    expect(visibleTo(row, noRevenue), row.value).toBe(true);
    expect(visibleTo(row, noExpenses), row.value).toBe(false);
    const answered = scan.patterns.find((p: any) => p.category === 'support_cluster');
    expect(visibleTo({ key: 'pattern_support_cluster', value: JSON.stringify(answered) }, noRevenue)).toBe(true);
  });

  // COR-R6-2: the class is decided on what is stored (the capped entities, with their text unclipped): 100 harmless
  // tickets made the uncapped JSON exceed the classifier's bound (money, fail closed) though nothing stored states money.
  it('a harmless cluster of 100 tickets with long titles is not withheld as money', async () => {
    const title = `printer jams ${'z'.repeat(950)}`;
    const tickets = Array.from({ length: 100 }, (_, i) => ({ id: `t${i}`, title, status: 'OPEN', priority: 'LOW', orgUnitId: null, createdAt: new Date() }));
    const { detector, stored } = detectorOver(tickets, '{"patterns": []}');
    await detector.scanBusiness('biz');
    const row = stored.find((r) => r.key.startsWith('pattern_support_cluster_'))!;
    expect(visibleTo(row, noRevenue), row.value.slice(0, 300)).toBe(true);
  });

  // COR-R6-3: a model's severity in another case is kept, not downgraded.
  it("a model severity of 'Critical' or 'WARNING' is kept (lower-cased)", async () => {
    const tickets = [0, 1].map((i) => ({ id: `t${i}`, title: `ticket ${i}`, status: 'OPEN', priority: 'LOW', orgUnitId: null, createdAt: new Date() }));
    const model = JSON.stringify({ patterns: [
      { category: 'a', severity: 'Critical', title: 'A', description: 'a', confidence: 0.5, suggestedAction: 'a' },
      { category: 'b', severity: 'WARNING', title: 'B', description: 'b', confidence: 0.5, suggestedAction: 'b' },
    ] });
    const { detector } = detectorOver(tickets, model);
    const scan = await detector.scanBusiness('biz');
    expect(scan.patterns.map((p: any) => p.severity)).toEqual(['critical', 'warning']);
  });
});
