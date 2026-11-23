/**
 * FU-PATTERNS-ROUTES-SIGHT review round 1 (security F-1, F-4; correctness COR-FUPRS-1, COR-FUPRS-2): GET
 * .../agent/patterns reads past withheld patterns in pages. Those pages must be keyset pages (no offset: a pattern
 * written between two pages shifted every offset, so a row came back twice), and the rows read per request bounded
 * (PatternDetectorService stores every detection under a new key, so a reader who may read few patterns made the route
 * read the whole table, each page by a longer offset). Pure: an in-memory AiMemory table stands in for Prisma.
 */
import { describe, it, expect } from 'vitest';
import { AgentController } from './agent.controller';

interface Row { id: string; businessId: string; category: string; key: string; value: string; createdAt: Date; confidence: number }

const BLIND_SCOPES = {
  crm: 'read', bookings: 'read', projects: 'read', content: 'read', automations: 'read', storefront: 'read',
  analytics: 'read', operations: 'read', ai: 'read', team: 'read', expenses: 'none', revenue: 'none',
};

/** A table of 'patterns' rows, newest first, that answers findMany as Prisma would (keyset OR, skip, take, order). */
function table(rows: Row[], onRead?: (call: number) => void) {
  const calls: any[] = [];
  const findMany = async (args: any) => {
    calls.push(args);
    onRead?.(calls.length);
    let out = rows.filter((r) => r.businessId === args.where.businessId && r.category === args.where.category);
    if (args.where.createdAt?.gte) out = out.filter((r) => r.createdAt >= args.where.createdAt.gte);
    const or = args.where.OR as Array<any> | undefined;
    if (or) {
      out = out.filter((r) =>
        or.some((c) =>
          c.createdAt?.lt !== undefined
            ? r.createdAt < c.createdAt.lt
            : r.createdAt.getTime() === c.createdAt.getTime() && r.id < c.id.lt,
        ),
      );
    }
    out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    return out.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? out.length));
  };
  return { calls, findMany };
}

function controllerOver(findMany: (args: any) => Promise<Row[]>, role = 'STAFF', permissionScopes: unknown = BLIND_SCOPES) {
  const prisma = {
    client: {
      aiMemory: { findMany },
      membership: { findUnique: async () => ({ role, permissionScopes }) },
    },
  };
  return new AgentController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, prisma as any);
}

const BASE = Date.now() - 10 * 24 * 60 * 60 * 1000;
const at = (n: number) => new Date(BASE + n * 1000);
const plain = (n: number): Row => ({ id: `p${String(n).padStart(6, '0')}`, businessId: 'biz', category: 'patterns', key: `peak_${n}`, value: `Peak activity hour: ${n % 12 || 12}AM`, createdAt: at(n), confidence: 0.8 });
const money = (n: number): Row => ({
  id: `m${String(n).padStart(6, '0')}`, businessId: 'biz', category: 'patterns', key: `pattern_overdue_invoice_cluster_${n}`,
  value: JSON.stringify({ category: 'overdue_invoice_cluster', description: `2 overdue invoices totaling ${4000 + n}` }), createdAt: at(n), confidence: 0.85,
});
const req = { user: { id: 'u_blind' } } as any;

describe('GET .../agent/patterns pages by keyset, bounded (FU-PATTERNS-ROUTES-SIGHT round 1)', () => {
  it('reads no page by offset: every page after the first starts below the last row read (createdAt, id)', async () => {
    const rows = [...Array.from({ length: 30 }, (_, i) => plain(i)), ...Array.from({ length: 400 }, (_, i) => money(100 + i))];
    const t = table(rows);
    const res = await controllerOver(t.findMany).getDetectedPatterns('biz', req);
    expect(res.patterns).toHaveLength(30);
    expect(t.calls.length).toBeGreaterThan(1);
    for (const call of t.calls) expect(call.skip ?? 0, JSON.stringify(call)).toBe(0);
    for (const call of t.calls.slice(1)) expect(call.where.OR, 'keyset cursor').toBeDefined();
  });

  it('a pattern written between two pages neither repeats nor drops a row the reader may read', async () => {
    const rows = [...Array.from({ length: 60 }, (_, i) => plain(i)), ...Array.from({ length: 199 }, (_, i) => money(100 + i))];
    let written = false;
    const t = table(rows, (call) => {
      if (call === 2 && !written) {
        written = true;
        rows.push(money(10_000));
      }
    });
    const res = await controllerOver(t.findMany).getDetectedPatterns('biz', req);
    const ids = res.patterns.map((p: any) => p.id);
    expect(new Set(ids).size, 'no row twice').toBe(ids.length);
    expect(ids).toEqual(Array.from({ length: 50 }, (_, i) => plain(59 - i).id));
  });

  // Review round 2 (security F-1): a bound on the rows read counted the withheld rows too, so whether a visible pattern
  // was answered told a reader how many money patterns were newer (1,999 newer: answered; 2,000: not). The round-1
  // case here pinned that bound ("at most 2,000 rows read"); it is replaced by the window below, which bounds the read
  // by time and not by what is withheld.
  it('no row-count signal: a visible pattern is answered whether 1,999, 2,000 or 5,000 withheld patterns are newer', async () => {
    for (const newer of [1_999, 2_000, 5_000]) {
      const rows = [plain(0), ...Array.from({ length: newer }, (_, i) => money(1 + i))];
      const res = await controllerOver(table(rows).findMany).getDetectedPatterns('biz', req);
      expect(res.patterns.map((p: any) => p.id), `${newer} newer`).toEqual([plain(0).id]);
    }
  });

  it("a reader who may not read every pattern reads the last PATTERNS_WINDOW_DAYS days only: every read carries the window, and an older pattern is not answered to them (the owner's is)", async () => {
    const old: Row = { ...plain(1), id: 'p_old', createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) };
    const rows = [old, plain(2), ...Array.from({ length: 300 }, (_, i) => money(10 + i))];
    const t = table(rows);
    const res = await controllerOver(t.findMany).getDetectedPatterns('biz', req);
    expect(res.patterns.map((p: any) => p.id)).toEqual([plain(2).id]);
    const floor = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const call of t.calls) {
      const gte = call.where.createdAt?.gte as Date | undefined;
      expect(gte, JSON.stringify(call.where)).toBeInstanceOf(Date);
      expect(Math.abs(gte!.getTime() - floor)).toBeLessThan(60_000);
    }
    const owner = await controllerOver(table(rows).findMany, 'OWNER', null).getDetectedPatterns('biz', { user: { id: 'u_owner' } } as any);
    expect(owner.patterns.map((p: any) => p.id)).toContain('p_old');
  });

  it('the owner reads the newest 50 in one page, as before (createdAt desc, id desc)', async () => {
    const rows = [...Array.from({ length: 30 }, (_, i) => plain(i)), ...Array.from({ length: 400 }, (_, i) => money(100 + i))];
    const t = table(rows);
    const res = await controllerOver(t.findMany, 'OWNER', null).getDetectedPatterns('biz', { user: { id: 'u_owner' } } as any);
    expect(res.patterns.map((p: any) => p.description)).toEqual(Array.from({ length: 50 }, (_, i) => `2 overdue invoices totaling ${4000 + 499 - i}`));
    expect(t.calls).toHaveLength(1);
    // Correctness review round 2 (COR-R2-2): the owner's one read is the old one: the newest 50, no window.
    expect(t.calls[0].take).toBe(50);
    expect(t.calls[0].where.createdAt).toBeUndefined();
  });
});
