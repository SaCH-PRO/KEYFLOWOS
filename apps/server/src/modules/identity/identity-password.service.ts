import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { SupabaseAdminService } from '../../core/auth/supabase-admin.service';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { PasswordPolicyService } from './password-policy.service';

/**
 * Server-owned password recovery.
 *
 * The browser used to do both halves of this itself: POST to Supabase
 * `/auth/v1/recover` to request the mail, then PUT `/auth/v1/user` with the
 * recovery session to set the new password. Supabase handles that correctly,
 * so nothing was broken — but it meant recovery was the one auth flow that
 * never crossed this server, and it therefore skipped every control the others
 * have:
 *
 *   rate limiting   login, signup and resend are metered per IP and per email.
 *                   Recovery was metered only by Supabase, so address
 *                   enumeration and mail-bombing ran against their budget
 *                   rather than ours.
 *   audit           auth_audit_log records signup, login and logout. A password
 *                   change — the most security-relevant act an account has —
 *                   left no row at all.
 *   password policy signup runs PasswordPolicyService: length, composition, and
 *                   a Pwned Passwords k-anonymity lookup. Recovery ran a
 *                   12-character check IN THE BROWSER. A password rejected at
 *                   signup as breached could be set by resetting to it, and a
 *                   direct API call skipped even the length check.
 *
 * That last one is the substantive hole. A policy enforced on one door and not
 * the other is not a policy.
 */
@Injectable()
export class IdentityPasswordService {
  private readonly logger = new Logger(IdentityPasswordService.name);

  constructor(
    @Inject(SupabaseAdminService) private readonly admin: SupabaseAdminService,
    @Inject(SupabaseAuthService) private readonly auth: SupabaseAuthService,
    @Inject(PasswordPolicyService) private readonly policy: PasswordPolicyService,
  ) {}

  /**
   * Request a recovery email.
   *
   * ALWAYS resolves the same way, whether or not the address has an account.
   * The caller returns a fixed response built from this, so the endpoint cannot
   * be used to test whether an email is registered. That is why nothing here
   * returns a boolean and why a Supabase failure is logged rather than thrown —
   * an error response would itself be the signal.
   */
  async requestReset(email: string, redirectTo: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    try {
      await this.admin.sendRecoveryEmail(normalized, redirectTo);
    } catch (err) {
      this.logger.warn(
        `Recovery request failed for a supplied address: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Complete a recovery: verify the token, vet the password, then set it.
   *
   * `accessToken` is the session Supabase puts in the recovery link's fragment.
   * Verifying it here is what proves the caller actually received the mail —
   * without that check this endpoint would let anyone set anyone's password.
   *
   * Order matters: the token is verified BEFORE the policy runs. Validating
   * first would let an unauthenticated caller use the endpoint as an oracle for
   * which passwords the policy accepts, and the HIBP lookup it performs is a
   * network call an anonymous caller should not be able to trigger.
   */
  async completeReset(accessToken: string, newPassword: string): Promise<{ userId: string; email: string }> {
    const user = await this.auth.getUserFromToken(accessToken);
    if (!user?.id) {
      throw new UnauthorizedException('This password reset link is invalid or has expired');
    }

    // Same policy object signup uses. Passing the email lets it reject a
    // password that merely restates the address.
    await this.policy.validate({ password: newPassword, email: user.email ?? undefined });

    await this.admin.updateUserPassword(user.id, newPassword);

    // Every other session is dropped. Recovery is the flow someone uses when
    // they believe their account is compromised, so leaving the attacker's
    // existing sessions alive would defeat the point of the reset.
    try {
      await this.admin.signOut(user.id, 'global');
    } catch (err) {
      this.logger.warn(
        `Password reset succeeded but global sign-out failed for ${user.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { userId: user.id, email: user.email ?? '' };
  }

  /** Reject a redirect that would send a recovery link off-site. */
  assertSafeRedirect(redirectTo: string, allowedOrigins: string[]): void {
    let url: URL;
    try {
      url = new URL(redirectTo);
    } catch {
      throw new BadRequestException('Invalid redirect target');
    }
    // An open redirect here is not cosmetic: the recovery link carries a
    // session in its fragment, so a redirect to an attacker's host hands them
    // the account.
    if (!allowedOrigins.includes(url.origin)) {
      throw new BadRequestException('Redirect target is not an allowed origin');
    }
  }
}
