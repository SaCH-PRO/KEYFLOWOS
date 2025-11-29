import { router, superAdminProcedure } from '../trpc';

export const adminRouter = router({
  overview: superAdminProcedure.query(() => ({
    users: { total: 1280, active7d: 412, newToday: 6 },
    businesses: { total: 540, newThisWeek: 22 },
    revenue: { gmv30d: 325000, gmvToday: 5400 },
    automations: { executions30d: 12840, topPlaybook: 'DM → Booking' },
  })),
  users: superAdminProcedure.query(() => ({
    items: [
      { id: 'u_1', email: 'owner@example.com', businesses: 3, lastActive: '2025-11-29', status: 'active' },
      { id: 'u_2', email: 'clinic@example.com', businesses: 1, lastActive: '2025-11-28', status: 'active' },
      { id: 'u_3', email: 'studio@example.com', businesses: 2, lastActive: '2025-11-26', status: 'inactive' },
    ],
  })),
  businesses: superAdminProcedure.query(() => ({
    items: [
      { id: 'b_1', name: 'Demo Clinic', mrr: 22500, status: 'active', ownerEmail: 'owner@example.com' },
      { id: 'b_2', name: 'Studio North', mrr: 15400, status: 'active', ownerEmail: 'studio@example.com' },
      { id: 'b_3', name: 'Wellness Hub', mrr: 8200, status: 'suspended', ownerEmail: 'ops@example.com' },
    ],
  })),
  events: superAdminProcedure.query(() => ({
    items: [
      { id: 'e1', type: 'invoice.paid', at: '2025-11-29T12:00:00Z', details: 'Invoice #104 paid by Sarah' },
      { id: 'e2', type: 'booking.created', at: '2025-11-29T11:45:00Z', details: 'Consult with Dr. Ali' },
      { id: 'e3', type: 'automation.run', at: '2025-11-29T11:30:00Z', details: 'Review flow triggered' },
    ],
  })),
  systemInsights: superAdminProcedure.query(() => ({
    insights: [
      '24 new businesses created this week; 64% completed onboarding.',
      'Automation usage up 12% after playbook update.',
      'Churn risk: contacts → quotes drop detected in 3 workspaces.',
    ],
  })),
});
