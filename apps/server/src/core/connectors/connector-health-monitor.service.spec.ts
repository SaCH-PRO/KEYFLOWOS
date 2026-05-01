import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConnectorHealthMonitorService } from './connector-health-monitor.service';

function makeService(overrides: {
  statuses?: Array<{ businessId: string; connectorType: string; status: string }>;
  testResult?: { success: boolean; error?: string };
  registryHas?: boolean;
  lastNotification?: { createdAt: Date } | null;
}) {
  const upsert = vi.fn().mockResolvedValue(undefined);
  const findFirstNotification = vi.fn().mockResolvedValue(overrides.lastNotification ?? null);
  const prisma = {
    client: {
      connectorStatus: {
        findMany: vi.fn().mockResolvedValue(overrides.statuses ?? []),
        upsert,
      },
      notification: {
        findFirst: findFirstNotification,
      },
    },
  };
  const registry = {
    get: vi.fn().mockReturnValue(
      overrides.registryHas === false
        ? null
        : { meta: { name: 'Gmail', type: 'gmail' } },
    ),
    testConnector: vi.fn().mockResolvedValue(
      overrides.testResult ?? { success: true },
    ),
  };
  const activity = { record: vi.fn().mockResolvedValue(undefined) };
  const notifications = { create: vi.fn().mockResolvedValue({ id: 'notif-1' }) };
  const service = new ConnectorHealthMonitorService(
    prisma as any,
    registry as any,
    activity as any,
    notifications as any,
  );
  return { service, prisma, registry, activity, notifications, upsert };
}

describe('ConnectorHealthMonitorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when there are no healthy connectors to check', async () => {
    const { service, registry } = makeService({});
    const result = await service.tick();
    expect(result).toEqual({ businessesChecked: 0, alerts: 0 });
    expect(registry.testConnector).not.toHaveBeenCalled();
  });

  it('leaves status untouched when test succeeds', async () => {
    const { service, registry, upsert, notifications } = makeService({
      statuses: [{ businessId: 'b1', connectorType: 'gmail', status: 'connected' }],
      testResult: { success: true },
    });
    const result = await service.tick();
    expect(registry.testConnector).toHaveBeenCalledWith('gmail', 'b1');
    expect(upsert).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
    expect(result.alerts).toBe(0);
  });

  it('flips status to expired and notifies when an OAuth token expires', async () => {
    const { service, upsert, notifications, activity } = makeService({
      statuses: [{ businessId: 'b1', connectorType: 'gmail', status: 'connected' }],
      testResult: { success: false, error: 'Token expired (401)' },
    });
    const result = await service.tick();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].update.status).toBe('expired');
    expect(notifications.create).toHaveBeenCalledTimes(1);
    const notifArg = notifications.create.mock.calls[0][0];
    expect(notifArg.type).toBe('connector_health');
    expect(notifArg.data.link).toBe('/app/connect');
    expect(notifArg.data.connectorType).toBe('gmail');
    expect(activity.record).toHaveBeenCalledTimes(1);
    expect(result.alerts).toBe(1);
  });

  it('classifies generic failures as error (not expired)', async () => {
    const { service, upsert } = makeService({
      statuses: [{ businessId: 'b1', connectorType: 'gmail', status: 'connected' }],
      testResult: { success: false, error: 'API quota exceeded' },
    });
    await service.tick();
    expect(upsert.mock.calls[0][0].update.status).toBe('error');
  });

  it('does not double-notify if a connector_health notification was created recently', async () => {
    const { service, notifications } = makeService({
      statuses: [{ businessId: 'b1', connectorType: 'gmail', status: 'error' }],
      testResult: { success: false, error: 'still broken' },
      lastNotification: { createdAt: new Date() },
    });
    const result = await service.tick();
    expect(notifications.create).not.toHaveBeenCalled();
    expect(result.alerts).toBe(0);
  });

  it('re-notifies after the renotify window has elapsed', async () => {
    const { service, notifications } = makeService({
      statuses: [{ businessId: 'b1', connectorType: 'gmail', status: 'error' }],
      testResult: { success: false, error: 'still broken' },
      lastNotification: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    const result = await service.tick();
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(result.alerts).toBe(1);
  });

  it('skips connectors whose type is not registered', async () => {
    const { service, upsert, notifications, registry } = makeService({
      statuses: [{ businessId: 'b1', connectorType: 'gmail', status: 'connected' }],
      registryHas: false,
    });
    const result = await service.tick();
    expect(registry.testConnector).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
    expect(result.alerts).toBe(0);
  });

  it('tickBusiness only queries connectors for the supplied businessId', async () => {
    const { service, prisma, registry } = makeService({});
    (prisma.client.connectorStatus.findMany as any).mockResolvedValueOnce([
      { connectorType: 'gmail', status: 'connected' },
    ]);
    await service.tickBusiness('biz-42');
    const args = (prisma.client.connectorStatus.findMany as any).mock.calls[0][0];
    expect(args.where.businessId).toBe('biz-42');
    expect(args.where.status).toEqual({
      in: ['connected', 'syncing', 'error', 'expired'],
    });
    expect(registry.testConnector).toHaveBeenCalledWith('gmail', 'biz-42');
  });

  it('tickBusiness flips a single failing connector and returns scoped counts', async () => {
    const { service, prisma, notifications } = makeService({
      testResult: { success: false, error: 'API quota exceeded' },
    });
    (prisma.client.connectorStatus.findMany as any).mockResolvedValueOnce([
      { connectorType: 'gmail', status: 'connected' },
    ]);
    const result = await service.tickBusiness('biz-1');
    expect(result).toEqual({ checked: 1, alerts: 1 });
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create.mock.calls[0][0].businessId).toBe('biz-1');
  });

  it('needsAttention summarises connectors in error/expired state', async () => {
    const { service, prisma } = makeService({});
    (prisma.client.connectorStatus.findMany as any).mockResolvedValueOnce([
      {
        connectorType: 'gmail',
        status: 'expired',
        lastError: 'Token expired',
        lastErrorAt: new Date('2026-01-01'),
      },
      {
        connectorType: 'stripe',
        status: 'error',
        lastError: 'Quota',
        lastErrorAt: new Date('2026-01-02'),
      },
    ]);
    const result = await service.needsAttention('biz-1');
    expect(result.count).toBe(2);
    expect(result.items.map((i) => i.connectorType)).toEqual(['gmail', 'stripe']);
  });
});
