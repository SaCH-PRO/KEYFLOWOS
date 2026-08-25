/**
 * The browser must not perform credential operations against Supabase directly.
 *
 * This has been fixed three times, in three places, each found by accident:
 *
 *   password reset    POST /auth/v1/recover + PUT /auth/v1/user
 *   token refresh     POST /auth/v1/token?grant_type=refresh_token
 *   change password   PUT /auth/v1/user  — and this one had no current-password
 *                     field at all, so a leaked access token was a permanent
 *                     account takeover
 *
 * None of them were broken. Supabase handled every one correctly, which is
 * exactly why they survived: nothing failed, so nothing drew attention to the
 * fact that these flows never crossed the server and therefore had no rate
 * limit, no audit row, and no password policy.
 *
 * A fourth will be written the same way unless something fails the build. That
 * is what this is.
 *
 * WHAT IS ALLOWED, AND WHY
 *
 *   /auth/v1/authorize  A top-level browser navigation to the OAuth provider.
 *                       It cannot happen anywhere else — that is the entire
 *                       mechanism — and it carries no credential of ours.
 *   the OAuth callback  The PKCE code exchange and the GET that reads the
 *                       resulting profile. Both are the back half of the same
 *                       redirect and are pinned by path below, so moving them
 *                       elsewhere still fails.
 *
 * A GET against /auth/v1/user is a read and is not the concern here; a PUT or
 * PATCH against it sets a password and very much is.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB_SRC = path.join(__dirname, '..', '..');

/** The OAuth redirect handshake, which genuinely belongs in the browser. */
const ALLOWED = [
  { file: 'app/auth/login/login-form.tsx', reason: 'OAuth authorize redirect' },
  { file: 'app/auth/signup/page.tsx', reason: 'OAuth authorize redirect' },
  { file: 'app/auth/callback/page.tsx', reason: 'PKCE code exchange + profile read, back half of the redirect' },
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      sourceFiles(p, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

const rel = (f: string) => path.relative(WEB_SRC, f).split(path.sep).join('/');

/** Files touching any Supabase auth endpoint, comments excluded. */
function callers(): { file: string; code: string }[] {
  return sourceFiles(WEB_SRC)
    .map((f) => ({ file: rel(f), code: stripComments(fs.readFileSync(f, 'utf8')) }))
    .filter((x) => x.code.includes('/auth/v1/'));
}

describe('the browser does not touch Supabase credential endpoints', () => {
  it('finds the OAuth callers — this gate is not vacuous', () => {
    // If this hits zero the scan has broken and every assertion below passes
    // regardless of what the code does.
    expect(callers().length).toBeGreaterThanOrEqual(3);
  });

  it('only the OAuth redirect handshake talks to Supabase auth at all', () => {
    const allowed = new Set(ALLOWED.map((a) => a.file));
    const unexpected = callers().map((c) => c.file).filter((f) => !allowed.has(f));

    expect(
      unexpected,
      'this file calls a Supabase auth endpoint from the browser. Credential ' +
        'operations must go through the server so they are rate limited, ' +
        'audited, and subject to the password policy — see ' +
        'POST /identity/{login,refresh,forgot-password,reset-password,change-password}.',
    ).toEqual([]);
  });

  it('nothing sets a password by PUT-ing to /auth/v1/user', () => {
    // The specific shape of the change-password hole: a PUT whose only
    // credential is the bearer token, so whoever holds that token owns the
    // account permanently.
    const offenders = callers()
      .filter((c) => /method:\s*["']P(UT|ATCH)["'][\s\S]{0,400}?\/auth\/v1\/user|\/auth\/v1\/user[\s\S]{0,400}?method:\s*["']P(UT|ATCH)["']/.test(c.code))
      .map((c) => c.file);

    expect(
      offenders,
      'setting a password directly against Supabase skips re-authentication, ' +
        'the password policy and the audit trail. Use POST /identity/change-password.',
    ).toEqual([]);
  });

  it('nothing requests recovery or exchanges a refresh token in the browser', () => {
    const offenders = callers()
      .filter((c) => /\/auth\/v1\/recover|grant_type=refresh_token|grant_type=password/.test(c.code))
      .map((c) => c.file);

    expect(
      offenders,
      'recovery and token exchange belong on the server: POST ' +
        '/identity/forgot-password and POST /identity/refresh.',
    ).toEqual([]);
  });

  it('the change-password form asks for the current password', () => {
    // Re-authentication is the property that makes a stolen access token
    // insufficient. The form shipped without it.
    const src = fs.readFileSync(
      path.join(WEB_SRC, 'app', 'app', 'profile', 'components', 'security-section.tsx'),
      'utf8',
    );
    expect(src).toContain('currentPassword');
    expect(stripComments(src)).toContain('/identity/change-password');
  });
});
