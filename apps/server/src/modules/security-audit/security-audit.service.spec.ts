import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SecurityAuditService } from './security-audit.service';

function makePrismaMock() {
  return {
    client: {
      membership: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'u_1' }, { userId: 'u_2' }]),
      },
      consentRecord: {
        count: vi.fn().mockResolvedValue(5),
      },
      contact: {
        count: vi.fn().mockResolvedValue(10),
      },
      business: {
        findUnique: vi.fn().mockResolvedValue({ forgetGraceDays: 7, defaultForgetReason: 'Customer request' }),
      },
    },
  };
}

describe('SecurityAuditService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: SecurityAuditService;

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new SecurityAuditService(prisma as any);
    vi.unstubAllEnvs();
  });

  it('returns all 8 checks', async () => {
    const checks = await svc.runAudit('biz_1');
    expect(checks).toHaveLength(8);
    const ids = checks.map((c) => c.id);
    expect(ids).toContain('mfa-enforcement');
    expect(ids).toContain('password-policy');
    expect(ids).toContain('inactive-users');
    expect(ids).toContain('consent-coverage');
    expect(ids).toContain('privacy-settings');
    expect(ids).toContain('env-secrets');
    expect(ids).toContain('ssl-config');
    expect(ids).toContain('rate-limiting');
  });

  it('consent coverage passes when above 50%', async () => {
    prisma.client.contact.count.mockResolvedValue(10);
    prisma.client.consentRecord.count.mockResolvedValue(6);
    const checks = await svc.runAudit('biz_1');
    const check = checks.find((c) => c.id === 'consent-coverage')!;
    expect(check.passed).toBe(true);
    expect(check.description).toContain('60%');
  });

  it('consent coverage fails when below 50%', async () => {
    prisma.client.contact.count.mockResolvedValue(10);
    prisma.client.consentRecord.count.mockResolvedValue(3);
    const checks = await svc.runAudit('biz_1');
    const check = checks.find((c) => c.id === 'consent-coverage')!;
    expect(check.passed).toBe(false);
    expect(check.severity).toBe('warning');
  });

  it('privacy settings passes when configured', async () => {
    const checks = await svc.runAudit('biz_1');
    const check = checks.find((c) => c.id === 'privacy-settings')!;
    expect(check.passed).toBe(true);
  });

  it('privacy settings fails when not configured', async () => {
    prisma.client.business.findUnique.mockResolvedValue({ forgetGraceDays: null, defaultForgetReason: null });
    const checks = await svc.runAudit('biz_1');
    const check = checks.find((c) => c.id === 'privacy-settings')!;
    expect(check.passed).toBe(false);
    expect(check.severity).toBe('warning');
  });

  it('password policy passes with default 8 chars', async () => {
    const checks = await svc.runAudit('biz_1');
    const check = checks.find((c) => c.id === 'password-policy')!;
    expect(check.passed).toBe(true);
  });

  it('password policy fails with short min length', async () => {
    vi.stubEnv('PASSWORD_MIN_LENGTH', '4');
    const checks = await svc.runAudit('biz_1');
    const check = checks.find((c) => c.id === 'password-policy')!;
    expect(check.passed).toBe(false);
  });
});
