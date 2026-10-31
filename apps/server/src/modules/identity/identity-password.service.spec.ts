/**
 * Password recovery, which until now never crossed this server.
 *
 * The browser called Supabase directly for both halves — request the mail, then
 * set the new password. That worked, which is why it survived: nothing was
 * broken, so nothing drew attention to the fact that recovery skipped every
 * control the other auth flows have. No rate limit, no audit row, and a
 * password policy enforced only by a length check in the page.
 *
 * The tests below are about the properties that are easy to get wrong and
 * impossible to notice:
 *
 *   enumeration   the request endpoint must behave identically for a real
 *                 address and an unknown one, including when Supabase errors.
 *   ordering      the token is verified BEFORE the policy runs. Reversed, an
 *                 anonymous caller could use the endpoint as an oracle for
 *                 which passwords the policy accepts, and could trigger its
 *                 outbound HIBP lookup at will.
 *   parity        the SAME policy object signup uses. A policy enforced on one
 *                 door and not the other is not a policy.
 *   session kill  recovery is what someone does when they think they are
 *                 compromised. Leaving the attacker's sessions alive defeats it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { IdentityPasswordService } from './identity-password.service';

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
/** A JWT-shaped token for user u1. Its signature is never checked here: getUserFromToken is the mocked verifier. */
const jwt = (claims: Record<string, unknown>) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'u1', aud: 'authenticated', ...claims })}.sig`;
/**
 * The access token GoTrue puts in a recovery link: a session whose amr says it
 * was authenticated by the recovery verification (auth-js JWTPayload.amr,
 * AMREntry { method, timestamp }), at `authenticatedAt` (epoch seconds).
 */
const recoveryJwt = (authenticatedAt: number, claims: Record<string, unknown> = {}) =>
  jwt({
    iat: authenticatedAt,
    exp: authenticatedAt + 3600,
    session_id: `s-recovery-${authenticatedAt}`,
    amr: [{ method: 'recovery', timestamp: authenticatedAt }],
    ...claims,
  });
/** A recovery-link token authenticated a minute ago: what every pre-F5 case below presented as the opaque 'good-token'. */
const RECOVERY = recoveryJwt(Math.floor(Date.now() / 1000) - 60);

function build(over: Record<string, any> = {}) {
  const admin = {
    sendRecoveryEmail: vi.fn(async () => undefined),
    updateUserPassword: vi.fn(async () => undefined),
    signOut: vi.fn(async () => true),
    ...over.admin,
  };
  const auth = {
    getUserFromToken: vi.fn(async () => ({ id: 'u1', email: 'person@example.com' })),
    ...over.auth,
  };
  const policy = { validate: vi.fn(async () => undefined), ...over.policy };
  // The local User row: active unless a case says otherwise.
  const prisma = {
    client: { user: { findUnique: vi.fn(async () => ({ deletedAt: null, bannedAt: null })), ...over.user } },
  };
  // The logout revocation marker store: no marker unless a case says otherwise.
  const redis = {
    get: vi.fn(async () => null as string | null),
    // Redis semantics: remaining ms, -1 when the key has no TTL, -2 when it does not exist.
    pttl: vi.fn(async () => -2),
    ...over.redis,
  };
  const svc = new IdentityPasswordService(admin as never, auth as never, policy as never, prisma as never, redis as never);
  return { svc, admin, auth, policy, prisma, redis };
}

describe('password recovery — requesting', () => {
  it('normalises the address before asking Supabase', async () => {
    const { svc, admin } = build();
    await svc.requestReset('  Person@Example.COM ', 'https://app.test/auth/reset-password');
    expect(admin.sendRecoveryEmail).toHaveBeenCalledWith(
      'person@example.com',
      'https://app.test/auth/reset-password',
    );
  });

  it('resolves normally even when Supabase throws', async () => {
    // The caller turns this into a fixed response. If a failure propagated,
    // the difference between responses would tell an attacker which addresses
    // are real — the endpoint would become a membership oracle.
    const { svc } = build({
      admin: { sendRecoveryEmail: vi.fn(async () => { throw new Error('supabase down'); }) },
    });
    await expect(svc.requestReset('person@example.com', 'https://app.test/x')).resolves.toBeUndefined();
  });
});

describe('password recovery — completing', () => {
  it('rejects an invalid or expired token', async () => {
    const { svc, policy, admin } = build({ auth: { getUserFromToken: vi.fn(async () => null) } });

    await expect(svc.completeReset('bogus', 'CorrectHorseBattery9!')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // And it must stop there.
    expect(policy.validate).not.toHaveBeenCalled();
    expect(admin.updateUserPassword).not.toHaveBeenCalled();
  });

  it('verifies the token BEFORE running the password policy', async () => {
    const order: string[] = [];
    const { svc } = build({
      auth: { getUserFromToken: vi.fn(async () => { order.push('token'); return { id: 'u1', email: 'p@e.com' }; }) },
      policy: { validate: vi.fn(async () => { order.push('policy'); }) },
    });

    await svc.completeReset(RECOVERY, 'CorrectHorseBattery9!');

    // Reversing these turns an unauthenticated endpoint into a policy oracle
    // and an outbound-HIBP-request trigger.
    expect(order).toEqual(['token', 'policy']);
  });

  it('runs the same policy signup uses, and passes the email to it', async () => {
    const { svc, policy } = build();
    await svc.completeReset(RECOVERY, 'CorrectHorseBattery9!');
    expect(policy.validate).toHaveBeenCalledWith({
      password: 'CorrectHorseBattery9!',
      email: 'person@example.com',
    });
  });

  it('does not set the password when the policy rejects it', async () => {
    // The whole reason this endpoint exists: the browser path enforced a length
    // check and nothing else, so a password refused at signup as breached could
    // be adopted by resetting to it.
    const { svc, admin } = build({
      policy: { validate: vi.fn(async () => { throw new BadRequestException('breached password'); }) },
    });

    await expect(svc.completeReset(RECOVERY, 'password123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(admin.updateUserPassword).not.toHaveBeenCalled();
  });

  it('signs out every other session after a successful reset', async () => {
    // CR-2 (R0-ID-F4): auth-js admin.signOut(jwt, scope) revokes the sessions of
    // the user the JWT belongs to. The recovery link's access token IS that JWT;
    // the user id (what this asserted before) never revoked anything.
    const { svc, admin } = build();
    await svc.completeReset(RECOVERY, 'CorrectHorseBattery9!');
    expect(admin.updateUserPassword).toHaveBeenCalledWith('u1', 'CorrectHorseBattery9!');
    expect(admin.signOut).toHaveBeenCalledWith(RECOVERY, 'global');
    expect(admin.signOut).not.toHaveBeenCalledWith('u1', expect.anything());
  });

  it('reports whether the provider sign-out held, so the caller can audit it', async () => {
    await expect(build().svc.completeReset(RECOVERY, 'CorrectHorseBattery9!')).resolves.toEqual({
      userId: 'u1',
      email: 'person@example.com',
      providerSignedOut: true,
    });
    // SupabaseAdminService.signOut reports failure by resolving false.
    const failing = build({ admin: { signOut: vi.fn(async () => false) } });
    await expect(failing.svc.completeReset(RECOVERY, 'CorrectHorseBattery9!')).resolves.toMatchObject({
      providerSignedOut: false,
    });
  });

  it('still reports success when the sign-out sweep fails', async () => {
    // The password IS changed by this point. Throwing here would tell the user
    // their reset failed and invite them to repeat it, when in fact the new
    // password is already live.
    const { svc } = build({
      admin: { signOut: vi.fn(async () => { throw new Error('supabase timeout'); }) },
    });
    await expect(svc.completeReset(RECOVERY, 'CorrectHorseBattery9!')).resolves.toMatchObject({
      userId: 'u1',
      providerSignedOut: false,
    });
  });

  it("revokes the sessions BEFORE setting the password: GoTrue's admin update ends every session itself, so a sign-out sent after it is refused (R0-ID-F4 review F4-A / CR-1)", async () => {
    // GoTrue (supabase/auth) adminUserUpdate with a password runs
    // user.UpdatePassword(tx, nil), which calls models.Logout for the user. A
    // POST /logout sent afterwards bears a JWT whose session row is gone and is
    // refused 403 session_not_found, so the sweep would be reported failed on
    // every successful reset.
    const order: string[] = [];
    const { svc } = build({
      auth: { getUserFromToken: vi.fn(async () => { order.push('token'); return { id: 'u1', email: 'p@e.com' }; }) },
      policy: { validate: vi.fn(async () => { order.push('policy'); }) },
      admin: {
        signOut: vi.fn(async () => { order.push('signOut'); return true; }),
        updateUserPassword: vi.fn(async () => { order.push('updateUserPassword'); }),
      },
    });
    await svc.completeReset(RECOVERY, 'CorrectHorseBattery9!');
    expect(order).toEqual(['token', 'policy', 'signOut', 'updateUserPassword']);
  });

  it('revokes nothing when the policy rejects the password', async () => {
    const { svc, admin } = build({
      policy: { validate: vi.fn(async () => { throw new BadRequestException('breached password'); }) },
    });
    await expect(svc.completeReset(RECOVERY, 'password123456')).rejects.toBeInstanceOf(BadRequestException);
    expect(admin.signOut).not.toHaveBeenCalled();
  });

  it('a failed sweep does not stop the password update', async () => {
    const { svc, admin } = build({ admin: { signOut: vi.fn(async () => false) } });
    await expect(svc.completeReset(RECOVERY, 'CorrectHorseBattery9!')).resolves.toMatchObject({ providerSignedOut: false });
    expect(admin.updateUserPassword).toHaveBeenCalledWith('u1', 'CorrectHorseBattery9!');
  });

  /**
   * R0-ID-F4 review F4-B / R0-ID-F3 review ST4-R2 (R0-ID-F5-RESET-PASSWORD-RECOVERY).
   *
   * The reset endpoint is public: the access token in the body is its only
   * credential. completeReset used to accept ANY token the verifier accepts,
   * so a stolen ordinary session token (or one AuthMiddleware already refuses
   * after a logout) could set a new password without the current one — the
   * re-authentication changePassword demands, bypassed through the other door.
   *
   * Now, after the signature check and BEFORE the policy or any provider call:
   *   recovery    the token's session must have been authenticated by the
   *               recovery verification: auth-js JWTPayload.amr (AMREntry[] or
   *               RFC-8176 string[]) includes the method 'recovery'.
   *   cutoff      a session authenticated at or before the user's logout
   *               cutoff (auth:revoked:user:<id>, epoch seconds, R0-ID-F3) is
   *               refused, by the same session-start rule AuthMiddleware uses.
   *   local user  a deleted or banned User row is refused; no row yet (signed
   *               up, never bootstrapped) is not a revoked user.
   */
  describe('only a recovery session that post-dates the logout cutoff, of a user still allowed in, can reset (F4-B / ST4-R2)', () => {
    const NOW_MS = Date.parse('2026-10-31T12:00:00.000Z');
    const NOW_S = Math.floor(NOW_MS / 1000);
    const DAY_S = 24 * 60 * 60;
    const PW = 'CorrectHorseBattery9!';
    const marker = (value: string, pttlMs = -1) => ({
      get: vi.fn(async (k: string) => (k === 'auth:revoked:user:u1' ? value : null)),
      pttl: vi.fn(async () => pttlMs),
    });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW_MS);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Refused with the reset link's generic 401, before the policy and before any provider call. */
    async function expectRefused(h: ReturnType<typeof build>, token: string, label: string) {
      await expect(h.svc.completeReset(token, PW), label).rejects.toBeInstanceOf(UnauthorizedException);
      expect(h.policy.validate, `${label}: policy`).not.toHaveBeenCalled();
      expect(h.admin.signOut, `${label}: provider sign-out`).not.toHaveBeenCalled();
      expect(h.admin.updateUserPassword, `${label}: password update`).not.toHaveBeenCalled();
    }

    it('refuses a token whose session was not authenticated by the recovery verification: a password, otp, magiclink or oauth session, no amr, or not a JWT at all', async () => {
      const session = (method: string) =>
        jwt({ iat: NOW_S - 60, exp: NOW_S + 3540, session_id: 's1', amr: [{ method, timestamp: NOW_S - 60 }] });
      const cases: Array<[string, string]> = [
        ['password session (a stolen ordinary access token)', session('password')],
        ['email OTP sign-in session', session('otp')],
        ['magic-link session', session('magiclink')],
        ['oauth session', session('oauth')],
        ['a method that merely contains the word', session('not-recovery')],
        ['RFC-8176 string amr without recovery', jwt({ iat: NOW_S - 60, exp: NOW_S + 3540, amr: ['pwd'] })],
        ['no amr claim', jwt({ iat: NOW_S - 60, exp: NOW_S + 3540, session_id: 's1' })],
        ['empty amr', jwt({ iat: NOW_S - 60, exp: NOW_S + 3540, session_id: 's1', amr: [] })],
        ['opaque token (not a JWT)', 'good-token'],
      ];
      for (const [label, token] of cases) await expectRefused(build(), token, label);
    });

    it('positive control: a recovery-link token of an active user, with no logout on record, resets — in the AMREntry form and the RFC-8176 string form', async () => {
      for (const token of [recoveryJwt(NOW_S - 60), jwt({ iat: NOW_S - 60, exp: NOW_S + 3540, amr: ['recovery'] })]) {
        const h = build();
        await expect(h.svc.completeReset(token, PW)).resolves.toEqual({ userId: 'u1', email: 'person@example.com', providerSignedOut: true });
        expect(h.redis.get).toHaveBeenCalledWith('auth:revoked:user:u1');
        expect(h.admin.signOut).toHaveBeenCalledWith(token, 'global');
        expect(h.admin.updateUserPassword).toHaveBeenCalledWith('u1', PW);
      }
    });

    it('an MFA step-up on a recovery session does not hide it: amr includes recovery', async () => {
      const h = build();
      const token = jwt({
        iat: NOW_S - 30,
        exp: NOW_S + 3570,
        session_id: 's-rec',
        amr: [{ method: 'totp', timestamp: NOW_S - 30 }, { method: 'recovery', timestamp: NOW_S - 60 }],
      });
      await expect(h.svc.completeReset(token, PW)).resolves.toMatchObject({ userId: 'u1' });
    });

    it('refuses a recovery session authenticated at or before the logout cutoff; one authenticated after it resets', async () => {
      await expectRefused(build({ redis: marker(String(NOW_S)) }), recoveryJwt(NOW_S - 600), 'recovery session from before the logout');
      await expectRefused(build({ redis: marker(String(NOW_S)) }), recoveryJwt(NOW_S), 'recovery session in the second of the logout');

      const after = build({ redis: marker(String(NOW_S - 1)) });
      await expect(after.svc.completeReset(recoveryJwt(NOW_S), PW), 'recovery session after the logout').resolves.toMatchObject({
        userId: 'u1',
      });
      expect(after.admin.updateUserPassword).toHaveBeenCalledWith('u1', PW);
    });

    it('a pre-logout recovery session refreshed after the logout stays refused: the cutoff is compared with when the session was authenticated (amr), not the token iat', async () => {
      const refreshed = recoveryJwt(NOW_S - 600, { iat: NOW_S + 300, exp: NOW_S + 3900 });
      await expectRefused(build({ redis: marker(String(NOW_S)) }), refreshed, 'refreshed pre-logout recovery session');
    });

    it('a recovery session that cannot say when it was authenticated is refused while a logout is on record (fail closed); the same token resets with no marker', async () => {
      const untimed = jwt({ iat: NOW_S + 60, exp: NOW_S + 3660, session_id: 's-rec', amr: ['recovery'] });
      await expectRefused(build({ redis: marker(String(NOW_S)) }), untimed, 'string amr, session_id, marker present');
      await expect(build().svc.completeReset(untimed, PW)).resolves.toMatchObject({ userId: 'u1' });
    });

    it("reads the previous release's bare '1' by its TTL, as AuthMiddleware does: a recovery session from before that logout is refused, one after it resets; no readable TTL is 'revoked now'", async () => {
      const written10MinAgo = () => marker('1', (DAY_S - 600) * 1000);
      await expectRefused(build({ redis: written10MinAgo() }), recoveryJwt(NOW_S - 900), "recovery before a legacy '1'");
      const after = build({ redis: written10MinAgo() });
      await expect(after.svc.completeReset(recoveryJwt(NOW_S - 300), PW)).resolves.toMatchObject({ userId: 'u1' });
      expect(after.redis.pttl).toHaveBeenCalledWith('auth:revoked:user:u1');

      await expectRefused(build({ redis: marker('1', -1) }), recoveryJwt(NOW_S - 300), "legacy '1' with no TTL");
    });

    it('refuses the recovery session of a deleted or of a banned user', async () => {
      for (const [label, row] of [
        ['deleted', { deletedAt: new Date(NOW_MS - 1000), bannedAt: null }],
        ['banned', { deletedAt: null, bannedAt: new Date(NOW_MS - 1000) }],
      ] as const) {
        const h = build({ user: { findUnique: vi.fn(async () => row) } });
        await expectRefused(h, recoveryJwt(NOW_S - 60), `${label} user`);
        expect(h.prisma.client.user.findUnique).toHaveBeenCalledWith({
          where: { id: 'u1' },
          select: { deletedAt: true, bannedAt: true },
        });
      }
    });

    it('a user with no local row yet (signed up, never bootstrapped) is not a revoked user: their recovery session resets', async () => {
      const h = build({ user: { findUnique: vi.fn(async () => null) } });
      await expect(h.svc.completeReset(recoveryJwt(NOW_S - 60), PW)).resolves.toMatchObject({ userId: 'u1' });
    });

    it('fails closed when the logout marker or the User row cannot be read: no password is set, and the error is not an invalid-link 401', async () => {
      const redisDown = build({ redis: { get: vi.fn(async () => { throw new Error('redis down'); }) } });
      await expect(redisDown.svc.completeReset(recoveryJwt(NOW_S - 60), PW)).rejects.toBeInstanceOf(ServiceUnavailableException);
      const dbDown = build({ user: { findUnique: vi.fn(async () => { throw new Error('db down'); }) } });
      await expect(dbDown.svc.completeReset(recoveryJwt(NOW_S - 60), PW)).rejects.toBeInstanceOf(ServiceUnavailableException);
      for (const h of [redisDown, dbDown]) {
        expect(h.policy.validate).not.toHaveBeenCalled();
        expect(h.admin.signOut).not.toHaveBeenCalled();
        expect(h.admin.updateUserPassword).not.toHaveBeenCalled();
      }
    });

    it('every check runs after the signature check: an unverifiable token reads neither the marker nor the row', async () => {
      const h = build({ auth: { getUserFromToken: vi.fn(async () => null) } });
      await expect(h.svc.completeReset(recoveryJwt(NOW_S - 60), PW)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(h.redis.get).not.toHaveBeenCalled();
      expect(h.prisma.client.user.findUnique).not.toHaveBeenCalled();
    });
  });
});

describe('recovery redirect targets', () => {
  const allowed = ['https://app.keyflow.test', 'http://localhost:5000'];

  it('accepts a configured origin', () => {
    const { svc } = build();
    expect(() =>
      svc.assertSafeRedirect('https://app.keyflow.test/auth/reset-password', allowed),
    ).not.toThrow();
  });

  it('rejects a foreign origin', () => {
    // The recovery link carries a session in its fragment, so a redirect an
    // attacker chooses hands them the account.
    const { svc } = build();
    expect(() => svc.assertSafeRedirect('https://evil.example.com/steal', allowed)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a look-alike host rather than matching on prefix', () => {
    const { svc } = build();
    expect(() =>
      svc.assertSafeRedirect('https://app.keyflow.test.evil.com/steal', allowed),
    ).toThrow(BadRequestException);
  });

  it('rejects a malformed target', () => {
    const { svc } = build();
    expect(() => svc.assertSafeRedirect('not a url', allowed)).toThrow(BadRequestException);
  });
});

describe('changing a password while signed in', () => {
  const base = {
    userId: 'u1',
    email: 'person@example.com',
    currentPassword: 'OldButValid2026!',
    newPassword: 'BrandNewOne2026!',
    /** The caller's own bearer access token (the session that stays signed in). */
    accessToken: 'callers-access-jwt',
  };

  it('re-authenticates BEFORE running the policy', async () => {
    // AuthGuard has already run, so this is not about identity — it is about a
    // token that leaked. Running the policy first would let whoever holds that
    // token probe which passwords are acceptable, and fire the outbound HIBP
    // lookup on their behalf, without ever knowing the current password.
    const order: string[] = [];
    const { svc, policy } = build({
      policy: { validate: vi.fn(async () => { order.push('policy'); }) },
    });

    await svc.changePassword({
      ...base,
      verifyCurrent: vi.fn(async () => { order.push('verify'); }),
    });

    expect(order).toEqual(['verify', 'policy']);
  });

  it('rejects a wrong current password without touching the policy or the store', async () => {
    const { svc, policy, admin } = build();

    await expect(
      svc.changePassword({
        ...base,
        verifyCurrent: vi.fn(async () => { throw new Error('invalid_credentials'); }),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(policy.validate).not.toHaveBeenCalled();
    expect(admin.updateUserPassword).not.toHaveBeenCalled();
  });

  it('does not leak why re-authentication failed', async () => {
    // "account locked" or "email unverified" would tell someone holding a
    // session token something about the account they do not already know.
    const { svc } = build();
    await expect(
      svc.changePassword({
        ...base,
        verifyCurrent: vi.fn(async () => { throw new Error('Account is locked until 5pm'); }),
      }),
    ).rejects.toThrow('Current password is incorrect');
  });

  it('refuses a no-op change', async () => {
    const { svc, admin } = build();
    await expect(
      svc.changePassword({
        ...base,
        newPassword: base.currentPassword,
        verifyCurrent: vi.fn(async () => undefined),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(admin.updateUserPassword).not.toHaveBeenCalled();
  });

  it('runs the same policy signup and reset use', async () => {
    const { svc, policy } = build();
    await svc.changePassword({ ...base, verifyCurrent: vi.fn(async () => undefined) });
    expect(policy.validate).toHaveBeenCalledWith({
      password: base.newPassword,
      email: base.email,
    });
  });

  it("signs out OTHER sessions, not the caller's own", async () => {
    // 'global' would invalidate the session of the person who just changed
    // their password — bouncing them to the login screen for good hygiene.
    // Recovery uses 'global' because there the current session is the suspect;
    // here it is the trusted one.
    //
    // CR-2 (R0-ID-F4): 'others' keeps the session named by the JWT passed to
    // auth-js admin.signOut, so it must be the CALLER's access token. With the
    // user id (what this asserted before) there is no session to keep and
    // nothing was revoked at all.
    const { svc, admin } = build();
    await expect(
      svc.changePassword({ ...base, verifyCurrent: vi.fn(async () => undefined) }),
    ).resolves.toEqual({ providerSignedOut: true });
    expect(admin.signOut).toHaveBeenCalledWith('callers-access-jwt', 'others');
    expect(admin.signOut).not.toHaveBeenCalledWith('u1', expect.anything());
  });

  it('does not ask the provider when the caller presented no Supabase access token, and reports the sweep as not done', async () => {
    const { svc, admin } = build();
    await expect(
      svc.changePassword({ ...base, accessToken: null, verifyCurrent: vi.fn(async () => undefined) }),
    ).resolves.toEqual({ providerSignedOut: false });
    expect(admin.updateUserPassword).toHaveBeenCalledWith('u1', base.newPassword);
    expect(admin.signOut).not.toHaveBeenCalled();
  });

  it('still succeeds when the sign-out sweep fails', async () => {
    // The password IS changed by then. Throwing would tell the user it failed
    // and invite a retry against a password that no longer exists.
    const { svc } = build({
      admin: { signOut: vi.fn(async () => { throw new Error('supabase timeout'); }) },
    });
    await expect(
      svc.changePassword({ ...base, verifyCurrent: vi.fn(async () => undefined) }),
    ).resolves.toEqual({ providerSignedOut: false });
    // SupabaseAdminService.signOut reports failure by resolving false.
    const failing = build({ admin: { signOut: vi.fn(async () => false) } });
    await expect(
      failing.svc.changePassword({ ...base, verifyCurrent: vi.fn(async () => undefined) }),
    ).resolves.toEqual({ providerSignedOut: false });
  });

  it("revokes the other sessions BEFORE setting the password: GoTrue's admin update ends every session itself, so a sign-out sent after it is refused (R0-ID-F4 review F4-A / CR-1)", async () => {
    const order: string[] = [];
    const { svc } = build({
      policy: { validate: vi.fn(async () => { order.push('policy'); }) },
      admin: {
        signOut: vi.fn(async () => { order.push('signOut'); return true; }),
        updateUserPassword: vi.fn(async () => { order.push('updateUserPassword'); }),
      },
    });
    await svc.changePassword({ ...base, verifyCurrent: vi.fn(async () => { order.push('verify'); }) });
    expect(order).toEqual(['verify', 'policy', 'signOut', 'updateUserPassword']);
  });

  it('revokes nothing when re-authentication or the policy fails', async () => {
    const wrong = build();
    await expect(
      wrong.svc.changePassword({ ...base, verifyCurrent: vi.fn(async () => { throw new Error('invalid_credentials'); }) }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(wrong.admin.signOut).not.toHaveBeenCalled();

    const rejected = build({
      policy: { validate: vi.fn(async () => { throw new BadRequestException('breached password'); }) },
    });
    await expect(
      rejected.svc.changePassword({ ...base, verifyCurrent: vi.fn(async () => undefined) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rejected.admin.signOut).not.toHaveBeenCalled();
  });

  it('a failed sweep does not stop the password update', async () => {
    const { svc, admin } = build({ admin: { signOut: vi.fn(async () => false) } });
    await expect(
      svc.changePassword({ ...base, verifyCurrent: vi.fn(async () => undefined) }),
    ).resolves.toEqual({ providerSignedOut: false });
    expect(admin.updateUserPassword).toHaveBeenCalledWith('u1', base.newPassword);
  });
});
