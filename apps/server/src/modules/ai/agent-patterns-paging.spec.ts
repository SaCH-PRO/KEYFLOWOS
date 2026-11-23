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

const at = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * 1000);
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

  it('reads at most PATTERNS_SCAN_MAX rows a request, however many withheld patterns are newer (fewer than 50, never more rows read)', async () => {
    const rows = [plain(0), ...Array.from({ length: 10_000 }, (_, i) => money(1 + i))];
    const t = table(rows);
    const res = await controllerOver(t.findMany).getDetectedPatterns('biz', req);
    const read = t.calls.reduce((n, c) => n + (c.take ?? 0), 0);
    expect(read, `rows asked for over ${t.calls.length} reads`).toBeLessThanOrEqual(2_000);
    expect(res.patterns.every((p: any) => !JSON.stringify(p).includes('totaling')), 'nothing withheld is answered').toBe(true);
  });

  it('the owner reads the newest 50 in one page, as before (createdAt desc, id desc)', async () => {
    const rows = [...Array.from({ length: 30 }, (_, i) => plain(i)), ...Array.from({ length: 400 }, (_, i) => money(100 + i))];
    const t = table(rows);
    const res = await controllerOver(t.findMany, 'OWNER', null).getDetectedPatterns('biz', { user: { id: 'u_owner' } } as any);
    expect(res.patterns.map((p: any) => p.description)).toEqual(Array.from({ length: 50 }, (_, i) => `2 overdue invoices totaling ${4000 + 499 - i}`));
    expect(t.calls).toHaveLength(1);
  });
});
