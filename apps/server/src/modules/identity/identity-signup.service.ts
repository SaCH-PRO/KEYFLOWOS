import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseAdminService, SupabaseAdminError } from '../../core/auth/supabase-admin.service';
import { SystemEmailService } from '../notifications/system-email.service';
import { verificationEmailTemplate } from '../notifications/email-templates';
import { appUrl } from '../../core/config/runtime-urls';
import { PasswordPolicyService } from './password-policy.service';

export type SignupOutcome =
  | { mode: 'session'; userId: string; email: string; accessToken: string; refreshToken: string }
  | { mode: 'verification'; userId: string; email: string };

/**
 * Returns true when the platform should require new users to verify their
 * email before they can sign in. Off in dev (auto-confirm = no email step,
 * devs never blocked); on in prod (real verification email required).
 *
 * Defaults to `true` whenever NODE_ENV === 'production' and `false`
 * otherwise — explicit AUTH_REQUIRE_EMAIL_VERIFICATION wins either way.
 */
export function isEmailVerificationRequired(): boolean {
  const flag = (process.env.AUTH_REQUIRE_EMAIL_VERIFICATION || '').trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return process.env.NODE_ENV === 'production';
}

@Injectable()
export class IdentitySignupService {
  private readonly logger = new Logger(IdentitySignupService.name);
  private readonly resendCooldownMs = 60_000;
  private readonly resendCooldown = new Map<string, number>();

  constructor(
    @Inject(SupabaseAdminService) private readonly supabaseAdmin: SupabaseAdminService,
    @Inject(SystemEmailService) private readonly systemEmail: SystemEmailService,
    @Inject(PasswordPolicyService) private readonly passwordPolicy: PasswordPolicyService,
  ) {}

  /**
   * Resolve the public-facing site URL we redirect users back to after
   * clicking the verification link in the email. Server-side single source
   * of truth, derived from env only.
   *
   * SECURITY: We deliberately do NOT trust the request `Origin` /
   * `X-Forwarded-Host` here. Verification links carry one-time auth
   * material and must only redirect to operator-approved origins, never
   * an attacker-controlled value. The optional `requestOrigin` parameter
   * is honored ONLY when it exactly matches the env-resolved canonical
   * site URL (so calls from the same host don't accidentally drift), and
   * is otherwise ignored. Set `SITE_URL` (or `APP_URL` /
   * `PUBLIC_BASE_URL` via `appUrl()`) to control where verification links land.
   */
  resolveSiteUrl(requestOrigin?: string | null): string {
    const explicit = (process.env.SITE_URL || '').trim();
    const canonical = (explicit ? explicit : appUrl()).replace(/\/+$/, '');
    if (requestOrigin) {
      const normalized = requestOrigin.replace(/\/+$/, '');
      if (normalized !== canonical) {
        this.logger.debug(
          `Ignoring untrusted request origin "${normalized}" for verification redirect (canonical "${canonical}")`,
        );
      }
    }
    return canonical;
  }

  buildVerifiedRedirect(siteUrl: string): string {
    return `${siteUrl.replace(/\/+$/, '')}/auth/login?verified=1`;
  }

  /**
   * Server-side signup flow. Creates the user via the Supabase Admin API,
   * either auto-confirming (verification disabled / dev) or generating a
   * confirmation link and sending it through Resend.
   *
   * Throws BadRequestException with stable, user-readable codes:
   *   - email_taken
   *   - weak_password
   *   - email_send_failed
   *   - signup_failed (generic)
   */
  async signup(args: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    username?: string;
    company?: string;
    phone?: string;
    requestOrigin?: string | null;
    referralCode?: string;
  }): Promise<SignupOutcome> {
    if (!this.supabaseAdmin.isConfigured()) {
      const missing = this.supabaseAdmin.describeMissingConfig();
      throw new BadRequestException({
        code: 'server_misconfigured',
        message:
          'Sign up is temporarily unavailable. The server is missing required configuration.',
        detail: missing,
      });
    }

    const email = args.email.trim().toLowerCase();

    // Tier-2: enforce password policy + breach check BEFORE we hit
    // Supabase. Doing this first means brute attempts that fail policy
    // never touch the upstream API or burn rate-limit budget there.
    await this.passwordPolicy.validate({ password: args.password, email });

    const requireVerification = isEmailVerificationRequired();
    const siteUrl = this.resolveSiteUrl(args.requestOrigin);
    const redirectTo = this.buildVerifiedRedirect(siteUrl);

    const userMetadata: Record<string, unknown> = {};
    if (args.firstName) userMetadata.first_name = args.firstName.trim();
    if (args.lastName) userMetadata.last_name = args.lastName.trim();
    if (args.username) userMetadata.username = args.username.trim();
    if (args.company) userMetadata.company = args.company.trim();
    if (args.phone) userMetadata.phone = args.phone.trim();
    const fullName = [args.firstName, args.lastName].filter(Boolean).join(' ').trim();
    if (fullName) userMetadata.full_name = fullName;

    let user;
    try {
      user = await this.supabaseAdmin.createUser({
        email,
        password: args.password,
        emailConfirm: !requireVerification,
        userMetadata,
      });
    } catch (err) {
      this.translateAndThrow(err);
    }

    if (!user) {
      throw new BadRequestException({ code: 'signup_failed', message: 'Sign up failed.' });
    }

    if (!requireVerification) {
      // Auto-confirm path: mint a session immediately so the user lands in the app.
      const session = await this.signInWithPassword(email, args.password);
      return {
        mode: 'session',
        userId: user.id,
        email,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      };
    }

    // Verification path: generate the confirmation link and ship it through Resend.
    // If either step fails, roll back the half-created auth user so the customer
    // can retry signup cleanly instead of bouncing off `email_taken` next time.
    let link: string;
    try {
      link = await this.supabaseAdmin.generateSignupLink({
        email,
        password: args.password,
        redirectTo,
      });
    } catch (err) {
      this.logger.warn(
        `generateSignupLink failed for ${email}: ${err instanceof Error ? err.message : err}`,
      );
      await this.supabaseAdmin.deleteUser(user.id);
      throw new BadRequestException({
        code: 'email_send_failed',
        message: "Couldn't send verification email — please try again.",
      });
    }

    try {
      await this.sendVerificationEmail({
        to: email,
        recipientName: fullName || undefined,
        confirmationUrl: link,
      });
    } catch (err) {
      this.logger.warn(
        `sendVerificationEmail failed for ${email}: ${err instanceof Error ? err.message : err}`,
      );
      await this.supabaseAdmin.deleteUser(user.id);
      throw new BadRequestException({
        code: 'email_send_failed',
        message: "Couldn't send verification email — please try again.",
      });
    }

    return { mode: 'verification', userId: user.id, email };
  }

  /**
   * Re-issue a fresh confirmation link for an unconfirmed user and re-send
   * it through Resend. Rate-limited to one send per email per 60s. Returns
   * a stable result regardless of whether the email exists or has already
   * been confirmed (to avoid leaking account existence).
   */
  async resendVerification(args: {
    email: string;
    requestOrigin?: string | null;
  }): Promise<{ ok: true; cooldownRemainingMs?: number }> {
    const email = args.email.trim().toLowerCase();
    if (!email) throw new BadRequestException({ code: 'invalid_email', message: 'Email is required.' });

    const now = Date.now();
    const last = this.resendCooldown.get(email) ?? 0;
    const elapsed = now - last;
    if (elapsed < this.resendCooldownMs) {
      const remaining = this.resendCooldownMs - elapsed;
      // Surface the cooldown to the client so it can show a friendly countdown,
      // but do not leak account existence — caller still treats it as success.
      return { ok: true, cooldownRemainingMs: remaining };
    }
    this.resendCooldown.set(email, now);

    if (!this.supabaseAdmin.isConfigured()) {
      // Pretend success to avoid revealing config issues to anonymous callers,
      // but log loudly so the operator can fix it.
      this.logger.warn('resendVerification called but Supabase admin is not configured');
      return { ok: true };
    }

    const siteUrl = this.resolveSiteUrl(args.requestOrigin);
    const redirectTo = this.buildVerifiedRedirect(siteUrl);

    let user;
    try {
      user = await this.supabaseAdmin.findUserByEmail(email);
    } catch (err) {
      this.logger.warn(
        `resendVerification lookup failed for ${email}: ${err instanceof Error ? err.message : err}`,
      );
      return { ok: true };
    }

    // Either user doesn't exist or is already confirmed — return success either
    // way to avoid leaking information.
    if (!user) return { ok: true };
    if (user.email_confirmed_at) return { ok: true };

    let link: string;
    try {
      link = await this.supabaseAdmin.generateConfirmationLink({ email, redirectTo });
    } catch (err) {
      this.logger.warn(
        `resendVerification link gen failed for ${email}: ${err instanceof Error ? err.message : err}`,
      );
      return { ok: true };
    }

    try {
      const recipientName =
        (user.user_metadata as Record<string, unknown> | null)?.['full_name'] as string | undefined;
      await this.sendVerificationEmail({
        to: email,
        recipientName: typeof recipientName === 'string' ? recipientName : undefined,
        confirmationUrl: link,
      });
    } catch (err) {
      this.logger.warn(
        `resendVerification send failed for ${email}: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { ok: true };
  }

  private async sendVerificationEmail(args: {
    to: string;
    recipientName?: string;
    confirmationUrl: string;
  }): Promise<void> {
    if (!this.systemEmail.isConfigured()) {
      throw new Error('System email sender is not configured');
    }
    const tpl = verificationEmailTemplate({
      recipientEmail: args.to,
      recipientName: args.recipientName,
      confirmationUrl: args.confirmationUrl,
      productName: process.env.EMAIL_FROM_NAME?.trim() || 'Keyflow',
    });
    await this.systemEmail.sendTransactional({
      to: args.to,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
  }

  /**
   * Exchange email + password for a Supabase session via the public REST
   * endpoint. Public so the new `/identity/login` controller route can
   * reuse it from {@link IdentityController}.
   *
   * Throws BadRequestException with stable codes:
   *   - signin_unavailable     (Supabase env not configured)
   *   - email_not_confirmed    (verification required, user hasn't clicked link)
   *   - invalid_credentials    (wrong email/password)
   *   - signin_failed          (any other Supabase rejection)
   */
  async signInWithPassword(email: string, password: string) {
    const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const anon = (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
    if (!url || !anon) {
      throw new BadRequestException({
        code: 'signin_unavailable',
        message: 'Account created, but automatic sign-in is unavailable. Please sign in.',
      });
    }
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon },
      body: JSON.stringify({ email, password }),
    });
    const json = (await res.json().catch(() => null)) as
      | {
          access_token?: string;
          refresh_token?: string;
          error_description?: string;
          msg?: string;
          error?: string;
          error_code?: string;
        }
      | null;
    if (!res.ok || !json?.access_token || !json?.refresh_token) {
      const raw = (json?.error_description || json?.msg || json?.error || '').toLowerCase();
      const code = (json?.error_code || '').toLowerCase();
      if (code === 'email_not_confirmed' || raw.includes('email not confirmed')) {
        throw new BadRequestException({
          code: 'email_not_confirmed',
          message: 'Please verify your email before signing in.',
        });
      }
      if (
        code === 'invalid_credentials' ||
        raw.includes('invalid login credentials') ||
        raw.includes('invalid grant')
      ) {
        throw new BadRequestException({
          code: 'invalid_credentials',
          message: 'Invalid email or password.',
        });
      }
      throw new BadRequestException({
        code: 'signin_failed',
        message: json?.error_description || json?.msg || 'Sign in failed.',
      });
    }
    return { accessToken: json.access_token, refreshToken: json.refresh_token };
  }

  private translateAndThrow(err: unknown): never {
    if (err instanceof SupabaseAdminError) {
      const lower = err.message.toLowerCase();
      if (
        lower.includes('already') &&
        (lower.includes('registered') || lower.includes('exists') || lower.includes('user'))
      ) {
        throw new BadRequestException({
          code: 'email_taken',
          message: 'That email is already registered. Try signing in instead.',
        });
      }
      if (
        lower.includes('weak') ||
        lower.includes('password should be') ||
        lower.includes('password is too short')
      ) {
        throw new BadRequestException({
          code: 'weak_password',
          message: 'Password is too weak. Use at least 8 characters with letters and numbers.',
        });
      }
      if (lower.includes('invalid email') || lower.includes('email address')) {
        throw new BadRequestException({
          code: 'invalid_email',
          message: 'That email address looks invalid.',
        });
      }
      throw new BadRequestException({ code: 'signup_failed', message: err.message });
    }
    if (err instanceof Error) {
      throw new BadRequestException({ code: 'signup_failed', message: err.message });
    }
    throw new BadRequestException({ code: 'signup_failed', message: 'Sign up failed.' });
  }
}
