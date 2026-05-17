import { describe, expect, it, vi } from 'vitest';
import { KeyMonitorService } from './key-monitor.service';

function createMockPrisma() {
  return {
    client: {
      contactTask: {
        findMany: vi.fn(async () => [
          { id: 't1', title: 'Overdue Task', dueDate: new Date('2026-01-01'), priority: 'HIGH' },
        ]),
      },
      contentRequest: {
        findMany: vi.fn(async () => [
          { id: 'cr1', businessGoal: 'Stuck Content', status: 'in_production', updatedAt: new Date('2026-01-01'), priority: 'normal' },
        ]),
      },
      approvalRequest: {
        findMany: vi.fn(async () => [
          { id: 'a1', title: 'Old Approval', createdAt: new Date('2026-01-01') },
        ]),
      },
      booking: {
        findMany: vi.fn(async () => [
          { id: 'b1', startTime: new Date(Date.now() + 12 * 60 * 60 * 1000), contactId: 'c1' },
        ]),
      },
      callLog: {
        findMany: vi.fn(async () => [
          { id: 'cl1', contactId: 'c1', scheduledAt: new Date(), completedAt: new Date(), outcome: null },
        ]),
      },
      evidence: {
        findMany: vi.fn(async () => []),
      },
    },
  };
}

describe('KeyMonitorService', () => {
  it('finds overdue tasks', async () => {
    const prisma = createMockPrisma();
    const svc = new KeyMonitorService(prisma as any);

    const alerts = await svc.checkOverdueTasks('biz_1');
    expect(alerts.length).toBe(1);
    expect(alerts[0].type).toBe('overdue_task');
    expect(alerts[0].severity).toBe('critical');
  });

  it('finds stuck content requests', async () => {
    const prisma = createMockPrisma();
    const svc = new KeyMonitorService(prisma as any);

    const alerts = await svc.checkStuckContentRequests('biz_1');
    expect(alerts.length).toBe(1);
    expect(alerts[0].type).toBe('stuck_content_request');
  });

  it('finds pending approvals', async () => {
    const prisma = createMockPrisma();
    const svc = new KeyMonitorService(prisma as any);

    const alerts = await svc.checkPendingApprovals('biz_1');
    expect(alerts.length).toBe(1);
    expect(alerts[0].type).toBe('pending_approval');
  });

  it('finds unconfirmed bookings', async () => {
    const prisma = createMockPrisma();
    const svc = new KeyMonitorService(prisma as any);

    const alerts = await svc.checkUnconfirmedBookings('biz_1');
    expect(alerts.length).toBe(1);
    expect(alerts[0].type).toBe('unconfirmed_booking');
  });

  it('finds calls without outcome', async () => {
    const prisma = createMockPrisma();
    const svc = new KeyMonitorService(prisma as any);

    const alerts = await svc.checkCallsWithoutOutcome('biz_1');
    expect(alerts.length).toBe(1);
    expect(alerts[0].type).toBe('call_without_outcome');
  });

  it('generates daily digest with all alerts', async () => {
    const prisma = createMockPrisma();
    const svc = new KeyMonitorService(prisma as any);

    const digest = await svc.generateDailyDigest('biz_1');
    expect(digest.businessId).toBe('biz_1');
    expect(digest.alerts.length).toBeGreaterThan(0);
    expect(digest.stats.overdueTasks).toBe(1);
    expect(digest.stats.stuckContentRequests).toBe(1);
    expect(digest.recommendations.length).toBeGreaterThan(0);
  });

  it('shows all-clear when no issues', async () => {
    const prisma = createMockPrisma();
    prisma.client.contactTask.findMany = vi.fn(async () => []);
    prisma.client.contentRequest.findMany = vi.fn(async () => []);
    prisma.client.approvalRequest.findMany = vi.fn(async () => []);
    prisma.client.booking.findMany = vi.fn(async () => []);
    prisma.client.callLog.findMany = vi.fn(async () => []);
    prisma.client.evidence.findMany = vi.fn(async () => []);

    const svc = new KeyMonitorService(prisma as any);
    const digest = await svc.generateDailyDigest('biz_1');
    expect(digest.alerts.length).toBe(0);
    expect(digest.recommendations[0]).toContain('All systems green');
  });
});
