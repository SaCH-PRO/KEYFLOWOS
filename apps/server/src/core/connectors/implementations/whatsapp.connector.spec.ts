import { describe, it, expect, vi } from 'vitest';
import { WhatsAppConnector } from './whatsapp.connector';

describe('WhatsAppConnector multi-tenant healthCheck & smokeTest', () => {
  it('reports connected with tenant phone number when business.metaData.whatsapp is configured', async () => {
    const prismaMock: any = {
      client: {
        connectorStatus: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue({}),
        },
        business: {
          findUnique: vi.fn().mockResolvedValue({
            metaData: {
              whatsapp: {
                provider: 'twilio',
                accountSid: 'AC1234567890',
                authToken: 'auth_secret',
                fromNumber: '+18685550199',
              },
            },
          }),
        },
      },
    };

    const connector = new WhatsAppConnector(prismaMock, { emit: vi.fn() } as any, {} as any);
    const health = await connector.healthCheck('biz_tenant_1');

    expect(health.status).toBe('connected');
    expect(health.connectedAccount).toBe('+18685550199');

    const smoke = await connector.smokeTest('biz_tenant_1');
    expect(smoke.success).toBe(true);
    expect(smoke.account).toBe('+18685550199');
  });

  it('reports disconnected when tenant has no WhatsApp config and no global token is set', async () => {
    const prevToken = process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_ACCESS_TOKEN;

    try {
      const prismaMock: any = {
        client: {
          connectorStatus: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
          business: {
            findUnique: vi.fn().mockResolvedValue({ metaData: {} }),
          },
        },
      };

      const connector = new WhatsAppConnector(prismaMock, { emit: vi.fn() } as any, {} as any);
      const health = await connector.healthCheck('biz_unconfigured');

      expect(health.status).toBe('disconnected');
    } finally {
      if (prevToken !== undefined) process.env.WHATSAPP_ACCESS_TOKEN = prevToken;
    }
  });
});
