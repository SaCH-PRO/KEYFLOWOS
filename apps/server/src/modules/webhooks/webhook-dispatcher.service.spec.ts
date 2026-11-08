import { describe, it, expect, vi } from 'vitest';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

describe('WebhookDispatcherService persistent delivery logs', () => {
  it('persists delivery logs to ActivityLog and hydrates them in getDeliveryLogs across restarts', async () => {
    const persistedRows: Array<{ id: string; businessId: string; type: string; metadata: any; createdAt: Date }> = [];
    const prismaMock: any = {
      client: {
        webhook: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'wh_1',
            businessId: 'biz_1',
            name: 'Order Hook',
            url: 'https://example.com/webhook',
            secret: 'secret_123',
            events: ['invoice.paid'],
            isActive: true,
          }),
        },
        activityLog: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            const row = {
              id: `act_${persistedRows.length + 1}`,
              businessId: data.businessId,
              type: data.type,
              metadata: data.metadata,
              createdAt: new Date(),
            };
            persistedRows.push(row);
            return row;
          }),
          findMany: vi.fn().mockImplementation(async ({ where }: any) =>
            persistedRows.filter((r) => r.businessId === where.businessId && r.type === where.type),
          ),
        },
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    }) as any;

    try {
      const dispatcher1 = new WebhookDispatcherService(prismaMock);
      const sentLog = await dispatcher1.sendTestEvent('wh_1', 'biz_1');

      expect(sentLog.status).toBe('success');
      expect(prismaMock.client.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            businessId: 'biz_1',
            type: 'webhook.delivery',
            metadata: expect.objectContaining({
              webhookId: 'wh_1',
              event: 'test.ping',
              status: 'success',
            }),
          }),
        }),
      );

      // Simulate a fresh server instance with an empty in-memory log array
      const dispatcherAfterRestart = new WebhookDispatcherService(prismaMock);
      const hydrated = await dispatcherAfterRestart.getDeliveryLogs('biz_1', 'wh_1', 10);

      expect(hydrated).toHaveLength(1);
      expect(hydrated[0].id).toBe(sentLog.id);
      expect(hydrated[0].webhookId).toBe('wh_1');
      expect(hydrated[0].status).toBe('success');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
