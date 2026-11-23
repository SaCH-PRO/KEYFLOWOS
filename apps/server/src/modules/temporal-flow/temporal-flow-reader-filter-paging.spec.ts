/**
 * FU-TEMPORAL-FLOW-INBOX-SCOPE (merge with FU-PROPOSAL-REVENUE-SIGHT, D-238): every timeline query a reader's read
 * makes carries the reader's module filter (readerFilter) in its where, as { AND: [where, FILTER] }, so D-238's
 * page-filling loop counts only rows the module rule lets through and no withheld-module row reaches a page, a page
 * boundary or the scan cap. This pins each findMany of list (the no-reader read, the revenue reader's read, every page
 * of the loop), calendarRange and remindersDue: any of them reverting to the unscoped where fails here.
 */
import { describe, it, expect, vi } from 'vitest';
import { TemporalFlowService } from './temporal-flow.service';

const FILTER = { NOT: { OR: [{ source: { equals: 'key_inbox', mode: 'insensitive' } }] } };

/** A financial KEY proposal's event: withheld by D-238 from a reader without revenue read, so the loop pages on. */
const moneyEvent = (i: number) => ({
  id: `ev_${i}`,
  businessId: 'biz_1',
  entityType: 'key_action_proposal',
  entityId: 'kap_money',
  title: 'KEY action executed',
  description: null,
  payload: {},
  metadata: {},
});

function service(pages: unknown[][]) {
  let call = 0;
  const findMany = vi.fn(async () => pages[Math.min(call++, pages.length - 1)] ?? []);
  const prisma = {
    client: {
      temporalFlowEvent: { findMany },
      keyActionProposal: {
        findMany: vi.fn(async () => [
          { id: 'kap_money', actionType: 'EXECUTE_TOOL', module: 'commerce', toolName: 'commerce.record_payment', title: 'Record the payment' },
        ]),
      },
      genomeRecommendation: { findMany: vi.fn(async () => []) },
      membership: {
        findUnique: vi.fn(async ({ where }: any) =>
          ({
            blind: { role: 'STAFF', permissionScopes: { revenue: 'none', bookings: 'read' } },
            owner: { role: 'OWNER', permissionScopes: null },
          })[where.userId_businessId.userId as string] ?? null,
        ),
      },
    },
  };
  return { svc: new TemporalFlowService(prisma as any), findMany };
}

/** Every timeline query was scoped: its where is { AND: [<the read's own where>, FILTER] }. */
function expectEveryQueryScoped(findMany: ReturnType<typeof vi.fn>, minCalls: number) {
  expect(findMany.mock.calls.length).toBeGreaterThanOrEqual(minCalls);
  for (const [args] of findMany.mock.calls as any[]) {
    expect(Array.isArray(args.where?.AND), JSON.stringify(args.where)).toBe(true);
    expect(args.where.AND).toHaveLength(2);
    expect(args.where.AND[0].businessId).toBe('biz_1');
    expect(args.where.AND[1]).toBe(FILTER);
  }
}

describe('the module filter is in every timeline query a read makes (D-238 merge)', () => {
  it('list with no reader argument: its one read is scoped', async () => {
    const { svc, findMany } = service([[]]);
    await svc.list('biz_1', { limit: 5 }, undefined, FILTER);
    expectEveryQueryScoped(findMany, 1);
  });

  it("list for a revenue reader: D-238's single read is scoped", async () => {
    const { svc, findMany } = service([[]]);
    await svc.list('biz_1', { limit: 5 }, { id: 'owner', role: 'USER' }, FILTER);
    expectEveryQueryScoped(findMany, 1);
  });

  it("list for a reader without revenue read: every page of D-238's loop is scoped", async () => {
    // Two full pages of withheld proposal events, then a short one: the loop reads three pages.
    const { svc, findMany } = service([
      Array.from({ length: 2 }, (_, i) => moneyEvent(i)),
      Array.from({ length: 100 }, (_, i) => moneyEvent(10 + i)),
      [moneyEvent(500)],
    ]);
    const rows = await svc.list('biz_1', { limit: 2 }, { id: 'blind', role: 'USER' }, FILTER);
    expect(rows).toEqual([]);
    expectEveryQueryScoped(findMany, 3);
  });

  it('calendarRange and remindersDue: their read is scoped', async () => {
    const cal = service([[]]);
    await cal.svc.calendarRange('biz_1', '2026-01-01', '2026-12-31', { id: 'blind', role: 'USER' }, FILTER);
    expectEveryQueryScoped(cal.findMany, 1);
    const rem = service([[]]);
    await rem.svc.remindersDue('biz_1', { id: 'blind', role: 'USER' }, FILTER);
    expectEveryQueryScoped(rem.findMany, 1);
  });

  it('control: a read given no filter queries its own where, unwrapped', async () => {
    const { svc, findMany } = service([[]]);
    await svc.list('biz_1', { limit: 5 });
    expect((findMany.mock.calls[0] as any)[0].where.businessId).toBe('biz_1');
    expect((findMany.mock.calls[0] as any)[0].where.AND).toBeUndefined();
  });
});
