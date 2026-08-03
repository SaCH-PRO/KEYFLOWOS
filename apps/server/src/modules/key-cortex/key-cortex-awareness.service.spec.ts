/**
 * Awareness — reading back what KEY noticed on its own.
 *
 * The proactive layers write five record types (weak signals, churn risk,
 * ideas, reflection sessions, dream hypotheses) and NOTHING read any of them.
 * KEY was noticing into a drawer nobody opens.
 *
 * The properties that matter here are tenancy and resilience: this backs a
 * dashboard panel, so it must never leak across businesses and never take a
 * page down because one stored row is malformed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexAwarenessService } from './key-cortex-awareness.service';

type Row = {
  businessId: string;
  type: string;
  key: string;
  value: string;
  confidence: number;
  createdAt: Date;
};

class PrismaStub {
  rows: Row[] = [];

  client = {
    keyCortexMemory: {
      findMany: vi.fn(
        ({
          where,
          take,
        }: {
          where: { businessId: string; type: string; createdAt?: { gte: Date } };
          take: number;
        }) =>
          Promise.resolve(
            this.rows
              .filter(
                (r) =>
                  r.businessId === where.businessId &&
                  r.type === where.type &&
                  (!where.createdAt || r.createdAt >= where.createdAt.gte),
              )
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
              .slice(0, take),
          ),
      ),
    },
  };
}

const at = (min: number) => new Date(Date.now() - min * 60_000);

function seed(p: PrismaStub) {
  p.rows.push(
    {
      businessId: 'biz_1',
      type: 'weak_signal',
      key: 'sig_1',
      confidence: 0.7,
      createdAt: at(10),
      value: JSON.stringify({
        description: 'Support replies slowed 40% this week',
        recommendedInvestigation: 'Check ticket volume against staffing',
        category: 'behavioral',
      }),
    },
    {
      businessId: 'biz_1',
      type: 'churn_risk',
      key: 'contact_9',
      confidence: 0.8,
      createdAt: at(30),
      value: JSON.stringify({
        prediction: 'Acme Ltd likely to lapse',
        timeHorizon: '30 days',
        riskScore: 0.82,
      }),
    },
    {
      businessId: 'biz_1',
      type: 'creative_idea',
      key: 'idea_3',
      confidence: 0.6,
      createdAt: at(60),
      value: JSON.stringify({
        title: 'Bundle install with the annual plan',
        implementationSteps: ['Price the bundle', 'Test on 10 accounts'],
      }),
    },
    // another tenant's data — must never appear
    {
      businessId: 'biz_2',
      type: 'weak_signal',
      key: 'sig_other',
      confidence: 0.9,
      createdAt: at(5),
      value: JSON.stringify({ description: 'ANOTHER TENANT SIGNAL' }),
    },
  );
}

describe('getAwareness', () => {
  let prisma: PrismaStub;
  let svc: KeyCortexAwarenessService;

  beforeEach(() => {
    prisma = new PrismaStub();
    seed(prisma);
    svc = new KeyCortexAwarenessService(prisma as never);
  });

  it('returns what KEY noticed, newest first', async () => {
    const out = await svc.getAwareness('biz_1');
    expect(out.items.length).toBe(3);
    expect(out.items[0].kind).toBe('weakSignal'); // 10 min ago
    expect(out.items[2].kind).toBe('idea'); // 60 min ago
  });

  it('NEVER returns another business rows', async () => {
    const out = await svc.getAwareness('biz_1');
    const text = JSON.stringify(out);
    expect(text).not.toContain('ANOTHER TENANT SIGNAL');
    expect(out.items.every((i) => i.id !== 'sig_other')).toBe(true);
  });

  it('scopes every query by businessId, not just the guard', async () => {
    // A guard establishes who is asking; it does not constrain what the query
    // returns. Both are required.
    await svc.getAwareness('biz_1');
    for (const call of prisma.client.keyCortexMemory.findMany.mock.calls) {
      expect(call[0].where.businessId).toBe('biz_1');
    }
  });

  it('builds a usable headline per kind', async () => {
    const out = await svc.getAwareness('biz_1');
    const by = (k: string) => out.items.find((i) => i.kind === k)!;

    expect(by('weakSignal').headline).toBe('Support replies slowed 40% this week');
    expect(by('churnRisk').headline).toBe('Acme Ltd likely to lapse');
    expect(by('idea').headline).toBe('Bundle install with the annual plan');
  });

  it('surfaces the suggested action where the layer recorded one', async () => {
    const out = await svc.getAwareness('biz_1');
    const signal = out.items.find((i) => i.kind === 'weakSignal')!;
    expect(signal.suggestedAction).toBe('Check ticket volume against staffing');
  });

  it('falls back to a plain label rather than inventing a sentence', async () => {
    // A payload whose shape changed should read as "KEY recorded something",
    // not as a confident sentence assembled from absent fields.
    prisma.rows = [
      {
        businessId: 'biz_1',
        type: 'weak_signal',
        key: 'sig_x',
        confidence: 0.5,
        createdAt: at(1),
        value: JSON.stringify({ unexpected: 'shape' }),
      },
    ];
    const out = await svc.getAwareness('biz_1');
    expect(out.items[0].headline).toBe('Weak signal detected');
    expect(out.items[0].suggestedAction).toBeUndefined();
  });

  it('filters by kind when asked', async () => {
    const out = await svc.getAwareness('biz_1', { kinds: ['churnRisk'] });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].kind).toBe('churnRisk');
  });

  it('counts per kind', async () => {
    const out = await svc.getAwareness('biz_1');
    expect(out.counts.weakSignal).toBe(1);
    expect(out.counts.churnRisk).toBe(1);
    expect(out.counts.idea).toBe(1);
    expect(out.counts.reflection).toBe(0);
  });

  it('reports the newest timestamp, or null when nothing was noticed', async () => {
    expect((await svc.getAwareness('biz_1')).latestAt).not.toBeNull();
    expect((await svc.getAwareness('biz_empty')).latestAt).toBeNull();
  });

  it('one malformed row does not lose the feed', async () => {
    prisma.rows.push({
      businessId: 'biz_1',
      type: 'weak_signal',
      key: 'corrupt',
      confidence: 0.5,
      createdAt: at(2),
      value: '{not json',
    });
    const out = await svc.getAwareness('biz_1');
    expect(out.items.some((i) => i.id === 'corrupt')).toBe(false);
    expect(out.items.length).toBe(3);
  });

  it('a storage failure returns an empty feed, not a 500', async () => {
    // This backs a dashboard panel; an empty panel beats taking the page down.
    prisma.client.keyCortexMemory.findMany.mockRejectedValue(new Error('db down'));
    const out = await svc.getAwareness('biz_1');
    expect(out.items).toEqual([]);
    expect(out.latestAt).toBeNull();
  });

  it('bounds how much it reads per kind', async () => {
    await svc.getAwareness('biz_1');
    for (const call of prisma.client.keyCortexMemory.findMany.mock.calls) {
      expect(call[0].take).toBeGreaterThan(0);
      expect(call[0].take).toBeLessThanOrEqual(50);
    }
  });
});
