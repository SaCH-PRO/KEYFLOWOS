import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsentService } from './consent.service';

function makePrismaMock() {
  return {
    client: {
      consentRecord: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'cr_1', ...data })),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  };
}

describe('ConsentService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: ConsentService;

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new ConsentService(prisma as any);
  });

  it('records granted consent with timestamp', async () => {
    const res = await svc.recordConsent('biz_1', 'c_1', {
      channel: 'email',
      consentType: 'marketing',
      status: 'granted',
      source: 'form',
    });
    expect(res.status).toBe('granted');
    expect(res.grantedAt).toBeInstanceOf(Date);
    expect(res.revokedAt).toBeNull();
  });

  it('records revoked consent with timestamp', async () => {
    const res = await svc.recordConsent('biz_1', 'c_1', {
      channel: 'sms',
      consentType: 'marketing',
      status: 'revoked',
      source: 'verbal',
    });
    expect(res.status).toBe('revoked');
    expect(res.revokedAt).toBeInstanceOf(Date);
    expect(res.grantedAt).toBeNull();
  });

  it('checkConsent returns pending when no record exists', async () => {
    const res = await svc.checkConsent('biz_1', 'c_1', 'email', 'marketing');
    expect(res.status).toBe('pending');
    expect(res.canContact).toBe(true);
    expect(res.canSendMarketing).toBe(false);
  });

  it('checkConsent returns granted permissions when record exists', async () => {
    prisma.client.consentRecord.findFirst.mockResolvedValue({
      status: 'granted',
      grantedAt: new Date(),
      evidence: null,
    });
    const res = await svc.checkConsent('biz_1', 'c_1', 'whatsapp', 'marketing');
    expect(res.status).toBe('granted');
    expect(res.canSendMarketing).toBe(true);
    expect(res.canContact).toBe(true);
  });

  it('checkConsent returns revoked permissions when record exists', async () => {
    prisma.client.consentRecord.findFirst.mockResolvedValue({
      status: 'revoked',
      revokedAt: new Date(),
      evidence: null,
    });
    const res = await svc.checkConsent('biz_1', 'c_1', 'sms', 'marketing');
    expect(res.status).toBe('revoked');
    expect(res.canSendMarketing).toBe(false);
    expect(res.canContact).toBe(false);
  });

  it('listConsentRecords applies filters', async () => {
    await svc.listConsentRecords('biz_1', 'c_1', { channel: 'email', status: 'granted' });
    const call = prisma.client.consentRecord.findMany.mock.calls[0][0];
    expect(call.where.businessId).toBe('biz_1');
    expect(call.where.contactId).toBe('c_1');
    expect(call.where.channel).toBe('email');
    expect(call.where.status).toBe('granted');
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
    expect(call.take).toBe(100);
  });
});
