import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { IdentitySignupService } from '../src/modules/identity/identity-signup.service';
import { SupabaseAdminError } from '../src/core/auth/supabase-admin.service';

/**
 * Integration-flavoured tests for IdentitySignupService.
 *
 * These go beyond the controller smoke tests in identity-signup.e2e.test.ts
 * by exercising the full verification-required path: createUser → generateLink →
 * sendVerificationEmail. They verify the contract between IdentitySignupService
 * and its collaborators (SupabaseAdminService, SystemEmailService) using
 * lightweight fakes rather than calling out to live Supabase / Resend.
 */
describe('IdentitySignupService — verification-required path', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = 'true';
    process.env.SITE_URL = 'https://app.example.com';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function buildService(overrides?: {
    supabaseAdmin?: Partial<{
      isConfigured: () => boolean;
      createUser: ReturnType<typeof vi.fn>;
      generateSignupLink: ReturnType<typeof vi.fn>;
      generateConfirmationLink: ReturnType<typeof vi.fn>;
      findUserByEmail: ReturnType<typeof vi.fn>;
      deleteUser: ReturnType<typeof vi.fn>;
    }>;
    systemEmail?: Partial<{
      isConfigured: () => boolean;
      sendTransactional: ReturnType<typeof vi.fn>;
    }>;
  }) {
    const supabaseAdmin = {
      isConfigured: () => true,
      createUser: vi.fn(async (args: { email: string }) => ({
        id: `user-${args.email}`,
        email: args.email,
      })),
      generateSignupLink: vi.fn(async () => 'https://app.example.com/verify?token=abc'),
      generateConfirmationLink: vi.fn(async () => 'https://app.example.com/verify?token=xyz'),
      findUserByEmail: vi.fn(async () => null),
      deleteUser: vi.fn(async () => true),
      ...overrides?.supabaseAdmin,
    };
    const systemEmail = {
      isConfigured: () => true,
      sendTransactional: vi.fn(async () => ({ id: 'email-1', provider: 'resend' as const })),
      ...overrides?.systemEmail,
    };
    const passwordPolicy = {
      validate: vi.fn(async () => undefined),
    };
    const svc = new IdentitySignupService(
      supabaseAdmin as never,
      systemEmail as never,
      passwordPolicy as never,
    );
    return { svc, supabaseAdmin, systemEmail, passwordPolicy };
  }

  it('drives the full verification flow: creates unconfirmed user, generates link, and sends email', async () => {
    const { svc, supabaseAdmin, systemEmail } = buildService();

    const result = await svc.signup({
      email: 'newcomer@example.com',
      password: 'StrongPass1',
      firstName: 'New',
      lastName: 'Comer',
    });

    expect(result.mode).toBe('verification');
    if (result.mode !== 'verification') return;
    expect(result.userId).toBe('user-newcomer@example.com');
    expect(result.email).toBe('newcomer@example.com');

    expect(supabaseAdmin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'newcomer@example.com',
        password: 'StrongPass1',
        emailConfirm: false,
        userMetadata: expect.objectContaining({
          first_name: 'New',
          last_name: 'Comer',
          full_name: 'New Comer',
        }),
      }),
    );

    expect(supabaseAdmin.generateSignupLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'newcomer@example.com',
        password: 'StrongPass1',
        redirectTo: 'https://app.example.com/auth/login?verified=1',
      }),
    );

    expect(systemEmail.sendTransactional).toHaveBeenCalledTimes(1);
    const sendArgs = systemEmail.sendTransactional.mock.calls[0][0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
    expect(sendArgs.to).toBe('newcomer@example.com');
    expect(sendArgs.subject).toMatch(/verify|confirm/i);
    expect(sendArgs.html).toContain('https://app.example.com/verify?token=abc');
    expect(sendArgs.text).toContain('https://app.example.com/verify?token=abc');

    expect(supabaseAdmin.deleteUser).not.toHaveBeenCalled();
  });

  it('rolls back the half-created user when link generation fails', async () => {
    const { svc, supabaseAdmin, systemEmail } = buildService({
      supabaseAdmin: {
        generateSignupLink: vi.fn(async () => {
          throw new SupabaseAdminError('boom', 500);
        }),
      },
    });

    await expect(
      svc.signup({ email: 'rollback@example.com', password: 'StrongPass1' }),
    ).rejects.toMatchObject({
      response: { code: 'email_send_failed' },
    });

    expect(supabaseAdmin.deleteUser).toHaveBeenCalledWith('user-rollback@example.com');
    expect(systemEmail.sendTransactional).not.toHaveBeenCalled();
  });

  it('rolls back the half-created user when email send fails', async () => {
    const { svc, supabaseAdmin } = buildService({
      systemEmail: {
        sendTransactional: vi.fn(async () => {
          throw new Error('resend down');
        }),
      },
    });

    await expect(
      svc.signup({ email: 'sendfail@example.com', password: 'StrongPass1' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(supabaseAdmin.deleteUser).toHaveBeenCalledWith('user-sendfail@example.com');
  });

  it('translates supabase "already registered" errors into email_taken', async () => {
    const { svc } = buildService({
      supabaseAdmin: {
        createUser: vi.fn(async () => {
          throw new SupabaseAdminError('A user with this email already registered', 422);
        }),
      },
    });

    await expect(
      svc.signup({ email: 'dup@example.com', password: 'StrongPass1' }),
    ).rejects.toMatchObject({
      response: { code: 'email_taken' },
    });
  });

  it('resendVerification sends a fresh magiclink for an unconfirmed user', async () => {
    const { svc, supabaseAdmin, systemEmail } = buildService({
      supabaseAdmin: {
        findUserByEmail: vi.fn(async () => ({
          id: 'u-unconf',
          email: 'unconf@example.com',
          email_confirmed_at: null,
          user_metadata: { full_name: 'Un Conf' },
        })),
      },
    });

    const res = await svc.resendVerification({ email: 'unconf@example.com' });
    expect(res.ok).toBe(true);
    expect(supabaseAdmin.generateConfirmationLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'unconf@example.com',
        redirectTo: 'https://app.example.com/auth/login?verified=1',
      }),
    );
    expect(systemEmail.sendTransactional).toHaveBeenCalledTimes(1);
  });

  it('resendVerification stays silent (ok, no email) for an already-confirmed user', async () => {
    const { svc, supabaseAdmin, systemEmail } = buildService({
      supabaseAdmin: {
        findUserByEmail: vi.fn(async () => ({
          id: 'u-conf',
          email: 'conf@example.com',
          email_confirmed_at: new Date().toISOString(),
          user_metadata: {},
        })),
      },
    });

    const res = await svc.resendVerification({ email: 'conf@example.com' });
    expect(res.ok).toBe(true);
    expect(supabaseAdmin.generateConfirmationLink).not.toHaveBeenCalled();
    expect(systemEmail.sendTransactional).not.toHaveBeenCalled();
  });

  it('resendVerification reports cooldown on second call within 60s and does not re-send', async () => {
    const { svc, supabaseAdmin, systemEmail } = buildService({
      supabaseAdmin: {
        findUserByEmail: vi.fn(async () => ({
          id: 'u-unconf',
          email: 'cool@example.com',
          email_confirmed_at: null,
          user_metadata: {},
        })),
      },
    });

    const first = await svc.resendVerification({ email: 'cool@example.com' });
    expect(first.cooldownRemainingMs).toBeUndefined();
    expect(systemEmail.sendTransactional).toHaveBeenCalledTimes(1);

    const second = await svc.resendVerification({ email: 'cool@example.com' });
    expect(second.ok).toBe(true);
    expect(second.cooldownRemainingMs).toBeGreaterThan(0);
    expect(supabaseAdmin.generateConfirmationLink).toHaveBeenCalledTimes(1);
    expect(systemEmail.sendTransactional).toHaveBeenCalledTimes(1);
  });

  it('resolveSiteUrl never trusts a request origin that diverges from canonical', () => {
    const { svc } = buildService();
    const url = svc.resolveSiteUrl('https://attacker.example/');
    expect(url).toBe('https://app.example.com');
    expect(svc.buildVerifiedRedirect(url)).toBe(
      'https://app.example.com/auth/login?verified=1',
    );
  });
});
