import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConnectorSyncSchedulerService } from './connector-sync-scheduler.service';

function makeService(overrides: {
  statuses?: Array<{ businessId: string; connectorType: string }>;
  registryHas?: boolean;
  syncResult?: { success: boolean; itemsSynced?: number; errors?: string[]; duration?: number };
  syncThrows?: Error;
}) {
  const findMany = vi.fn().mockResolvedValue(overrides.statuses ?? []);
  const prisma = {
    client: {
      connectorStatus: { findMany },
    },
  };
  const syncConnector = overrides.syncThrows
    ? vi.fn().mockRejectedValue(overrides.syncThrows)
    : vi.fn().mockResolvedValue(
        overrides.syncResult ?? { success: true, itemsSynced: 1, errors: [], duration: 5 },
      );
  const registry = {
    get: vi
      .fn()
      .mockReturnValue(overrides.registryHas === false ? null : { meta: { type: 'gmail' } }),
    syncConnector,
  };
  const activity = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ConnectorSyncSchedulerService(
    prisma as any,
    registry as any,
    activity as any,
  );
  return { service, prisma, registry, activity, findMany };
}

describe('ConnectorSyncSchedulerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when there are no eligible connectors', async () => {
    const { service, registry } = makeService({});
    const result = await service.runNightlySync();
    expect(result).toEqual({ businesses: 0, attempted: 0, synced: 0, skipped: 0, failed: 0 });
    expect(registry.syncConnector).not.toHaveBeenCalled();
  });

  it('syncs every connected (business, connector) pair', async () => {
    const { service, registry } = makeService({
      statuses: [
        { businessId: 'b1', connectorType: 'gmail' },
        { businessId: 'b1', connectorType: 'stripe' },
        { businessId: 'b2', connectorType: 'gmail' },
      ],
    });
    const result = await service.runNightlySync();
    expect(registry.syncConnector).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ businesses: 2, attempted: 3, synced: 3, skipped: 0, failed: 0 });
  });

  it('skips connectors whose type is not registered', async () => {
    const { service, registry } = makeService({
      statuses: [{ businessId: 'b1', connectorType: 'gmail' }],
      registryHas: false,
    });
    const result = await service.runNightlySync();
    expect(registry.syncConnector).not.toHaveBeenCalled();
    expect(result).toEqual({ businesses: 1, attempted: 0, synced: 0, skipped: 0, failed: 0 });
  });

  it('records a failure activity when sync returns success=false', async () => {
    const { service, activity } = makeService({
      statuses: [{ businessId: 'b1', connectorType: 'gmail' }],
      syncResult: { success: false, itemsSynced: 0, errors: ['Not connected'], duration: 3 },
    });
    const result = await service.runNightlySync();
    expect(result).toEqual({ businesses: 1, attempted: 1, synced: 0, skipped: 0, failed: 1 });
    expect(activity.record).toHaveBeenCalledTimes(1);
    const call = activity.record.mock.calls[0][0];
    expect(call.action).toBe('sync');
    expect(call.status).toBe('failure');
    expect(call.message).toBe('Not connected');
    expect(call.metadata).toEqual({ source: 'nightly_scheduler' });
  });

  it('records an error activity when sync throws and continues with the next connector', async () => {
    const { service, registry, activity } = makeService({
      statuses: [
        { businessId: 'b1', connectorType: 'gmail' },
        { businessId: 'b2', connectorType: 'stripe' },
      ],
      syncThrows: new Error('boom'),
    });
    const result = await service.runNightlySync();
    expect(registry.syncConnector).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ businesses: 2, attempted: 2, synced: 0, skipped: 0, failed: 2 });
    expect(activity.record).toHaveBeenCalledTimes(2);
    const call = activity.record.mock.calls[0][0];
    expect(call.action).toBe('error');
    expect(call.status).toBe('failure');
    expect(call.message).toBe('boom');
    expect(call.metadata).toEqual({ source: 'nightly_scheduler' });
  });

  it('queries connector_status for connected and syncing rows only', async () => {
    const { service, findMany } = makeService({});
    await service.runNightlySync();
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['connected', 'syncing'] });
  });
});
