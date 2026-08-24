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
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { IdentityPasswordService } from './identity-password.service';

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
  const svc = new IdentityPasswordService(admin as never, auth as never, policy as never);
  return { svc, admin, auth, policy };
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

    await svc.completeReset('good-token', 'CorrectHorseBattery9!');

    // Reversing these turns an unauthenticated endpoint into a policy oracle
    // and an outbound-HIBP-request trigger.
    expect(order).toEqual(['token', 'policy']);
  });

  it('runs the same policy signup uses, and passes the email to it', async () => {
    const { svc, policy } = build();
    await svc.completeReset('good-token', 'CorrectHorseBattery9!');
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

    await expect(svc.completeReset('good-token', 'password123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(admin.updateUserPassword).not.toHaveBeenCalled();
  });

  it('signs out every other session after a successful reset', async () => {
    const { svc, admin } = build();
    await svc.completeReset('good-token', 'CorrectHorseBattery9!');
    expect(admin.updateUserPassword).toHaveBeenCalledWith('u1', 'CorrectHorseBattery9!');
    expect(admin.signOut).toHaveBeenCalledWith('u1', 'global');
  });

  it('still reports success when the sign-out sweep fails', async () => {
    // The password IS changed by this point. Throwing here would tell the user
    // their reset failed and invite them to repeat it, when in fact the new
    // password is already live.
    const { svc } = build({
      admin: { signOut: vi.fn(async () => { throw new Error('supabase timeout'); }) },
    });
    await expect(svc.completeReset('good-token', 'CorrectHorseBattery9!')).resolves.toMatchObject({
      userId: 'u1',
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
    const { svc, admin } = build();
    await svc.changePassword({ ...base, verifyCurrent: vi.fn(async () => undefined) });
    expect(admin.signOut).toHaveBeenCalledWith('u1', 'others');
  });

  it('still succeeds when the sign-out sweep fails', async () => {
    // The password IS changed by then. Throwing would tell the user it failed
    // and invite a retry against a password that no longer exists.
    const { svc } = build({
      admin: { signOut: vi.fn(async () => { throw new Error('supabase timeout'); }) },
    });
    await expect(
      svc.changePassword({ ...base, verifyCurrent: vi.fn(async () => undefined) }),
    ).resolves.toBeUndefined();
  });
});
