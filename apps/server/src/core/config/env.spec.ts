/**
 * R0-SEC-02-VERIFYLOCAL-ISSUER: boot refuses the public placeholder for
 * SUPABASE_JWT_SECRET in production and warns about it elsewhere.
 *
 * `.env.example` carried `SUPABASE_JWT_SECRET=your-supabase-jwt-signing-secret`
 * until the R0-14 review repair (git log -S on .env.example: ecb7bba7 added
 * it, f6554848 removed it). Anyone who copied the example kept a value that
 * is public, and the server verifies HS256 tokens with it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

/**
 * Review repair SEC02-R1 / CR-2: the repo ships a second public value for the
 * same variable. DEPLOYMENT.md sets `SUPABASE_JWT_SECRET=your-jwt-secret` for
 * local use (:73) and inside the NODE_ENV=production Railway block (:183).
 */
const DEPLOYMENT_PLACEHOLDER = 'your-jwt-secret';

describe('validateServerEnv — the DEPLOYMENT.md placeholder (review repair SEC02-R1 / CR-2)', () => {
  it('production: your-jwt-secret fails validation, and the value is not echoed', () => {
    const report = validateServerEnv(env({ NODE_ENV: 'production', SUPABASE_JWT_SECRET: DEPLOYMENT_PLACEHOLDER }));
    expect(report.ok).toBe(false);
    const errors = mentionsPlaceholder(report.missingRequired);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/leave it empty/i);
    expect(errors[0]).not.toContain(DEPLOYMENT_PLACEHOLDER);
  });

  it('production: surrounding whitespace does not hide it', () => {
    const report = validateServerEnv(env({ NODE_ENV: 'production', SUPABASE_JWT_SECRET: ` ${DEPLOYMENT_PLACEHOLDER}\t` }));
    expect(report.ok).toBe(false);
    expect(mentionsPlaceholder(report.missingRequired)).toHaveLength(1);
  });

  it.each(['development', 'test', undefined])('NODE_ENV=%s: it is a warning, and boot is not blocked', (nodeEnv) => {
    const report = validateServerEnv(env({ NODE_ENV: nodeEnv, SUPABASE_JWT_SECRET: DEPLOYMENT_PLACEHOLDER }));
    expect(report.ok).toBe(true);
    expect(mentionsPlaceholder(report.warnings)).toHaveLength(1);
  });

  it('production boot with it exits 1 with a FATAL line naming SUPABASE_JWT_SECRET', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    ensureValidServerEnv(env({ NODE_ENV: 'production', SUPABASE_JWT_SECRET: DEPLOYMENT_PLACEHOLDER }));

    expect(exit).toHaveBeenCalledWith(1);
    const printed = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toMatch(/\[FATAL\]/);
    expect(printed).toMatch(/SUPABASE_JWT_SECRET/);
    expect(printed).not.toContain(DEPLOYMENT_PLACEHOLDER);
  });

  it('every non-empty SUPABASE_JWT_SECRET value the repo documents is refused in production', () => {
    // A ratchet: a doc or template that ships a new example value for this
    // variable fails here until the value joins the deny-list (or is blanked).
    const root = resolve(__dirname, '../../../../..');
    expect(existsSync(resolve(root, 'pnpm-workspace.yaml'))).toBe(true);
    const sources = ['DEPLOYMENT.md', '.env.example', 'infrastructure/production.env.template', 'MIGRATION.md', 'README.md'];
    const values = new Set<string>();
    for (const rel of sources) {
      const file = resolve(root, rel);
      if (!existsSync(file)) continue;
      for (const m of readFileSync(file, 'utf8').matchAll(/^[ \t]*(?:export[ \t]+)?SUPABASE_JWT_SECRET[ \t]*=[ \t]*(.*)$/gm)) {
        const value = m[1].replace(/[ \t]+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
        if (value) values.add(value);
      }
    }
    // R0-SEC-04 blanked the DEPLOYMENT.md lines, so this usually has nothing
    // to check; the emptiness test below is what keeps them blank.
    for (const value of values) {
      const report = validateServerEnv(env({ NODE_ENV: 'production', SUPABASE_JWT_SECRET: value }));
      expect({ value, ok: report.ok }).toEqual({ value, ok: false });
    }
  });
});

/**
 * R0-SEC-04 review repair CR-1: R0-SEC-04 blanked both DEPLOYMENT.md lines
 * (local block and the NODE_ENV=production Railway block). The ratchet above
 * passes with `your-jwt-secret` restored, since that value is on the deny-list,
 * so this test is what proves the docs and templates ship no value at all.
 */
describe('docs and templates leave SUPABASE_JWT_SECRET empty (R0-SEC-04 review repair CR-1)', () => {
  // Every assignment, wherever it sits on the line: plain, `export`, commented
  // out, quoted, or inside a command such as `fly secrets set ...`.
  const ASSIGNMENT = /(?<![A-Za-z0-9_])SUPABASE_JWT_SECRET[ \t]*=[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s#`|]*))/g;
  const SOURCES = ['DEPLOYMENT.md', '.env.example', 'infrastructure/production.env.template', 'MIGRATION.md', 'README.md'];
  const MUST_SET = ['DEPLOYMENT.md', '.env.example', 'infrastructure/production.env.template'];

  function assignments(): Array<{ at: string; value: string }> {
    const root = resolve(__dirname, '../../../../..');
    expect(existsSync(resolve(root, 'pnpm-workspace.yaml'))).toBe(true);
    const found: Array<{ at: string; value: string }> = [];
    for (const rel of SOURCES) {
      const file = resolve(root, rel);
      if (!existsSync(file)) {
        expect(MUST_SET, `${rel} is missing`).not.toContain(rel);
        continue;
      }
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(ASSIGNMENT)) {
            found.push({ at: `${rel}:${i + 1}`, value: (m[1] ?? m[2] ?? m[3] ?? '').trim() });
          }
        });
    }
    return found;
  }

  it('DEPLOYMENT.md, .env.example and the production template each set it, and no source gives it a value', () => {
    const found = assignments();
    // Not vacuous: the scan sees the blank lines it is guarding.
    for (const rel of MUST_SET) {
      expect(found.filter((a) => a.at.startsWith(`${rel}:`)).length, rel).toBeGreaterThan(0);
    }
    expect(found.filter((a) => a.value !== '')).toEqual([]);
  });

  it.each([
    ['plain', 'SUPABASE_JWT_SECRET=your-jwt-secret', 'your-jwt-secret'],
    ['export', 'export SUPABASE_JWT_SECRET="sec04-x"', 'sec04-x'],
    ['commented out', '# SUPABASE_JWT_SECRET=sec04-y', 'sec04-y'],
    ['inside a command', 'fly secrets set SUPABASE_JWT_SECRET=sec04-z --app keyflowos', 'sec04-z'],
    ['blank', 'SUPABASE_JWT_SECRET=', ''],
    ['blank with a comment', 'SUPABASE_JWT_SECRET=   # leave empty', ''],
  ])('the scan reads a %s assignment', (_label, line, value) => {
    expect([...line.matchAll(ASSIGNMENT)].map((m) => (m[1] ?? m[2] ?? m[3] ?? '').trim())).toEqual([value]);
  });

  it('the scan ignores prose and table cells that name the variable without assigning it', () => {
    for (const line of [
      '# Leave SUPABASE_JWT_SECRET empty with a hosted Supabase project, and never deploy',
      '| `SUPABASE_JWT_SECRET` | Server | Leave empty for Release 0 |',
      'NEXT_SUPABASE_JWT_SECRET_X=sec04-other',
    ]) {
      expect([...line.matchAll(ASSIGNMENT)], line).toEqual([]);
    }
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
