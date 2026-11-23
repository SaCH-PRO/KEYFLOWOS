/** FU-INSIGHTS-SIGHT (security review round 1, OOS-2): dashboardFor keeps named fields only, so a field added later fails closed. */
import { describe, it, expect } from 'vitest';
import { dashboardFor } from './insight-sight';

const blind = { reader: 'u1', sight: (m: string) => m !== 'revenue' && m !== 'expenses' } as any;
const full = { reader: 'u0', sight: () => true } as any;

describe('dashboardFor keeps a field only when it is known and the reader holds its sight', () => {
  const dashboard = {
    momentumScore: 40, activeProjects: 2, overdueTaskCount: 1, upcomingBookings: 3, staleLeads: 5, utilizationRate: 60,
    monthlyRevenue: 1000, outstandingRevenue: 7341, overdueInvoices: 2, overdueAmount: 7341, pendingQuotes: 1, pendingQuoteValue: 250,
    expensesThisMonth: 900, cashRunwayDays: 12,
  };
  it('a field it does not know (a money field added later) is left out for every reader but one who reads everything', () => {
    expect(dashboardFor(dashboard, blind)).toEqual({ momentumScore: 40, activeProjects: 2, overdueTaskCount: 1, upcomingBookings: 3, staleLeads: 5, utilizationRate: 60 });
    expect(dashboardFor(dashboard, full)).toEqual(dashboard);
  });
});
