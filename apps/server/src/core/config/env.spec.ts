/**
 * R0-SEC-02-VERIFYLOCAL-ISSUER: boot refuses the public placeholder for
 * SUPABASE_JWT_SECRET in production and warns about it elsewhere.
 *
 * `.env.example` carried `SUPABASE_JWT_SECRET=your-supabase-jwt-signing-secret`
 * until the R0-14 review repair (git log -S on .env.example: ecb7bba7 added
 * it, f6554848 removed it). Anyone who copied the example kept a value that
 * is public, and the server verifies HS256 tokens with it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ensureValidServerEnv, validateServerEnv } from './env';

const PLACEHOLDER = 'your-supabase-jwt-signing-secret';

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    SUPABASE_URL: 'https://sec02-ref.supabase.co',
    REDIS_URL: 'redis://localhost:6379/0',
    ANTHROPIC_API_KEY: 'k',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

const mentionsPlaceholder = (lines: string[]) => lines.filter((l) => /SUPABASE_JWT_SECRET/.test(l) && /placeholder/i.test(l));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateServerEnv — SUPABASE_JWT_SECRET placeholder', () => {
  it('production: the former .env.example placeholder fails validation with an error naming the variable and the fix', () => {
    const report = validateServerEnv(env({ NODE_ENV: 'production', SUPABASE_JWT_SECRET: PLACEHOLDER }));
    expect(report.ok).toBe(false);
    const errors = mentionsPlaceholder(report.missingRequired);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/leave it empty/i);
    // The value itself is not echoed into logs.
    expect(errors[0]).not.toContain(PLACEHOLDER);
  });

  it('production: surrounding whitespace does not hide the placeholder', () => {
    const report = validateServerEnv(env({ NODE_ENV: 'production', SUPABASE_JWT_SECRET: `  ${PLACEHOLDER}\n` }));
    expect(report.ok).toBe(false);
    expect(mentionsPlaceholder(report.missingRequired)).toHaveLength(1);
  });

  it.each(['development', 'test', undefined])(
    'NODE_ENV=%s: the placeholder is a warning, and boot is not blocked',
    (nodeEnv) => {
      const report = validateServerEnv(env({ NODE_ENV: nodeEnv, SUPABASE_JWT_SECRET: PLACEHOLDER }));
      expect(report.ok).toBe(true);
      expect(mentionsPlaceholder(report.missingRequired)).toEqual([]);
      expect(mentionsPlaceholder(report.warnings)).toHaveLength(1);
    },
  );

  it.each([
    ['empty', ''],
    ['unset', undefined],
    ['any other value', 'sec02-not-the-placeholder'],
  ])('production: %s is not reported as the placeholder', (_label, value) => {
    const report = validateServerEnv(env({ NODE_ENV: 'production', SUPABASE_JWT_SECRET: value }));
    expect(report.ok).toBe(true);
    expect(mentionsPlaceholder(report.missingRequired)).toEqual([]);
    expect(mentionsPlaceholder(report.warnings)).toEqual([]);
  });
});

describe('ensureValidServerEnv — boot with the placeholder', () => {
  it('production: exits 1 with a FATAL line naming SUPABASE_JWT_SECRET', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    ensureValidServerEnv(env({ NODE_ENV: 'production', SUPABASE_JWT_SECRET: PLACEHOLDER }));

    expect(exit).toHaveBeenCalledWith(1);
    const printed = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toMatch(/\[FATAL\]/);
    expect(printed).toMatch(/SUPABASE_JWT_SECRET/);
  });

  it('development: warns and does not exit', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    ensureValidServerEnv(env({ NODE_ENV: 'development', SUPABASE_JWT_SECRET: PLACEHOLDER }));

    expect(exit).not.toHaveBeenCalled();
    const printed = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toMatch(/SUPABASE_JWT_SECRET/);
    expect(printed).toMatch(/placeholder/i);
  });
});
