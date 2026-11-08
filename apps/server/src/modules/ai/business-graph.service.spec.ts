import { describe, expect, it, vi } from 'vitest';
import { BusinessGraphService } from './business-graph.service';

describe('BusinessGraphService — Treasury, Pipeline & Support Sight', () => {
  function makeStubs(opts?: {
    cashBalance?: number;
    unpaidBillsAmount?: number;
    unpaidBillsCount?: number;
    committedPayrollAmount?: number;
    committedPayrollRuns?: number;
    openPipelineValue?: number;
    openDealCount?: number;
    openTicketsCount?: number;
  }) {
    const prisma = {
      client: {
        business: {
          findUnique: vi.fn(async () => ({
            name: 'KeyFlow Demo Co',
            industry: 'Services',
            archetype: 'AGENCY',
            revenueModel: 'RETAINER',
            currency: 'TTD',
            businessStage: 'GROWTH',
            teamSize: '5-10',
          })),
        },
        contact: {
          count: vi.fn(async () => 12),
          groupBy: vi.fn(async () => [{ status: 'ACTIVE', _count: 10 }]),
          findMany: vi.fn(async () => []),
        },
        invoice: {
          aggregate: vi.fn(async () => ({ _sum: { total: 25_000 }, _count: 2 })),
          count: vi.fn(async () => 5),
          findMany: vi.fn(async () => []),
        },
        booking: {
          count: vi.fn(async () => 3),
        },
        expense: {
          aggregate: vi.fn(async (args: any) => {
            if (args?.where?.status === 'BILL') {
              return {
                _sum: { amount: opts?.unpaidBillsAmount ?? 4_200 },
                _count: opts?.unpaidBillsCount ?? 3,
              };
            }
            return { _sum: { amount: 3_000 } };
          }),
          groupBy: vi.fn(async () => []),
        },
        expenseBudget: {
          aggregate: vi.fn(async () => ({ _sum: { amount: 10_000 } })),
        },
        project: {
          count: vi.fn(async () => 4),
          findMany: vi.fn(async () => []),
        },
        projectTask: {
          count: vi.fn(async () => 0),
        },
        socialPost: {
          count: vi.fn(async () => 1),
        },
        emailCampaign: {
          count: vi.fn(async () => 0),
        },
        automation: {
          count: vi.fn(async () => 2),
          aggregate: vi.fn(async () => ({ _sum: { runCount: 14 } })),
        },
        product: {
          count: vi.fn(async () => 6),
          aggregate: vi.fn(async () => ({ _avg: { price: 500 } })),
          findMany: vi.fn(async () => []),
        },
        service: {
          findMany: vi.fn(async () => []),
        },
        financialAccount: {
          aggregate: vi.fn(async () => ({
            _sum: { currentBalance: opts?.cashBalance ?? 18_500 },
          })),
        },
        payrollRun: {
          aggregate: vi.fn(async () => ({
            _sum: { totalGross: opts?.committedPayrollAmount ?? 6_000 },
            _count: opts?.committedPayrollRuns ?? 1,
          })),
        },
        deal: {
          aggregate: vi.fn(async () => ({
            _sum: { value: opts?.openPipelineValue ?? 45_000 },
            _count: opts?.openDealCount ?? 4,
          })),
        },
        supportTicket: {
          count: vi.fn(async () => opts?.openTicketsCount ?? 2),
        },
      },
    } as any;

    return { prisma, svc: new BusinessGraphService(prisma) };
  }

  it('surfaces cash balance, unpaid bills, committed payroll, open deals, and open tickets in snapshot and context string', async () => {
    const { svc } = makeStubs();
    const snapshot = await svc.getSnapshot('biz_1', true);

    expect(snapshot.treasury).toEqual({
      cashBalance: 18_500,
      unpaidBillsAmount: 4_200,
      unpaidBillsCount: 3,
      committedPayrollAmount: 6_000,
      committedPayrollRuns: 1,
    });
    expect(snapshot.pipeline).toEqual({
      openDealCount: 4,
      openPipelineValue: 45_000,
    });
    expect(snapshot.support).toEqual({
      openTicketCount: 2,
    });

    const context = svc.buildContextString(snapshot);
    expect(context).toContain('Cash & Obligations: $18,500 cash, $4,200 unpaid bills (3), $6,000 committed payroll (1 runs)');
    expect(context).toContain('Pipeline: 4 open deals ($45,000)');
    expect(context).toContain('Support: 2 open tickets');
  });

  it('emits a critical treasury health indicator when unpaid bills + committed payroll exceed cash balance', async () => {
    const { svc } = makeStubs({
      cashBalance: 5_000,
      unpaidBillsAmount: 4_000,
      committedPayrollAmount: 3_500,
    });
    const snapshot = await svc.getSnapshot('biz_1', true);
    const treasuryAlert = snapshot.healthIndicators.find((h) => h.area === 'treasury');
    expect(treasuryAlert).toBeDefined();
    expect(treasuryAlert?.status).toBe('critical');
    expect(treasuryAlert?.detail).toContain('exceed available cash');
  });
});
