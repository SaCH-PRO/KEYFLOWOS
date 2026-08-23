import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

/**
 * `checkEnvSecrets` had an entry whose branches were both `null`:
 *
 *   env.SUPABASE_SERVICE_ROLE_KEY && !env.NODE_ENV?.includes('prod') ? null : null
 *
 * so it could never contribute a finding, and the check reported "no obvious
 * secret configuration issues detected" no matter how the environment was
 * configured. A green light that cannot turn red is worse than no check,
 * because it is trusted.
 *
 * The suite above asserts only that an `env-secrets` check appears among the
 * eight — never what it concluded — which is exactly how the dead branch
 * survived. The first test below is the one that pins it: it configures a
 * Supabase problem and nothing else, so it fails against the old code and can
 * only pass if that branch actually evaluates.
 *
 * The last test guards the opposite failure mode. Flagging the mere presence of
 * a service-role key outside production would fire on every developer machine
 * (main.ts requires that key for signup in all environments), the audit would
 * be permanently red, and a permanently red audit gets ignored.
 */
describe('checkEnvSecrets', () => {
  type EnvCheck = { passed: boolean; description: string; severity: string; id: string };

  const KEYS = [
    'NODE_ENV',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'AI_INTEGRATIONS_OPENAI_API_KEY',
    'DATABASE_URL',
  ] as const;

  /** checkEnvSecrets is a pure function of process.env; prisma is never touched. */
  function runEnvCheck(): EnvCheck {
    const service = new SecurityAuditService({} as never);
    return (service as unknown as { checkEnvSecrets(): EnvCheck }).checkEnvSecrets();
  }

  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('flags a short/truncated service-role key', () => {
    // The assertion that pins the dead ternary. Nothing else is misconfigured,
    // so the only way this can fail is if the Supabase branch evaluates.
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'too-short';

    const check = runEnvCheck();

    expect(check.passed, 'the Supabase branch never contributed a finding').toBe(false);
    expect(check.description).toContain('SUPABASE_SERVICE_ROLE_KEY appears short/weak');
    expect(check.severity).toBe('critical');
  });

  it('flags a service-role key that is identical to the public anon key', () => {
    const shared = 'x'.repeat(60);
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_SERVICE_ROLE_KEY = shared;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = shared;

    const check = runEnvCheck();

    expect(check.passed).toBe(false);
    expect(check.description).toContain('identical to the public anon key');
  });

  it('flags a service-role key missing in production', () => {
    process.env.NODE_ENV = 'production';

    const check = runEnvCheck();

    expect(check.passed).toBe(false);
    expect(check.description).toContain('SUPABASE_SERVICE_ROLE_KEY is not set in production');
  });

  it('still flags the pre-existing checks', () => {
    process.env.NODE_ENV = 'development';
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'short';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';

    const check = runEnvCheck();

    expect(check.passed).toBe(false);
    expect(check.description).toContain('AI_INTEGRATIONS_OPENAI_API_KEY appears short/weak');
    expect(check.description).toContain('DATABASE_URL points to localhost');
  });

  it('passes on a well-formed environment', () => {
    process.env.NODE_ENV = 'production';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'a'.repeat(220);
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'b'.repeat(200);
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'sk-'.padEnd(64, 'z');
    process.env.DATABASE_URL = 'postgresql://u:p@db.internal:5432/db';

    const check = runEnvCheck();

    expect(check.passed).toBe(true);
    expect(check.severity).toBe('info');
  });

  it('does NOT flag a service-role key merely for being present outside production', () => {
    // Every developer machine looks like this. If it fired here the audit would
    // be permanently red, and a permanently red audit gets ignored.
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'a'.repeat(220);
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'b'.repeat(200);
    process.env.DATABASE_URL = 'postgresql://u:p@db.internal:5432/db';

    const check = runEnvCheck();

    expect(check.passed).toBe(true);
  });
});
