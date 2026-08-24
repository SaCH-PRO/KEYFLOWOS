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

  /**
   * Change the password of a signed-in user.
   *
   * WHY THE CURRENT PASSWORD IS REQUIRED even though AuthGuard already ran.
   * An access token is a bearer token: whoever holds it is the user for as long
   * as it lives. Without re-authentication, a token that leaks once — XSS, a
   * shared machine, a log line — becomes PERMANENT account takeover, because
   * the holder can set a new password and lock the owner out. Demanding the
   * current password means a stolen token alone is not enough.
   *
   * Until now the only way to change a password was to trigger a recovery
   * email, which is a poor experience for someone already signed in and, worse,
   * trains people to expect password changes to arrive by email.
   */
  async changePassword(args: {
    userId: string;
    email: string;
    currentPassword: string;
    newPassword: string;
    /** Verifies the current password. Injected so this service does not depend
     *  on the signup service, which would be a cycle. */
    verifyCurrent: (email: string, password: string) => Promise<unknown>;
  }): Promise<void> {
    if (args.currentPassword === args.newPassword) {
      throw new BadRequestException('The new password must be different from the current one');
    }

    // Re-authenticate FIRST. Running the policy before this would let a caller
    // holding only a stolen token probe which passwords are acceptable, and
    // would fire the outbound HIBP lookup on their behalf — the same ordering
    // mistake the reset flow guards against.
    try {
      await args.verifyCurrent(args.email, args.currentPassword);
    } catch {
      // Deliberately not the upstream error. Distinguishing "wrong password"
      // from "account locked" or "unverified" here tells an attacker holding a
      // session token something about the account they do not already know.
      throw new UnauthorizedException('Current password is incorrect');
    }

    await this.policy.validate({ password: args.newPassword, email: args.email });
    await this.admin.updateUserPassword(args.userId, args.newPassword);

    // 'others', NOT 'global'. A global sign-out would invalidate the session of
    // the person who just changed their password, bouncing them to the login
    // screen as a reward for good hygiene. Recovery uses 'global' because there
    // the current session is the one under suspicion; here it is the trusted one.
    try {
      await this.admin.signOut(args.userId, 'others');
    } catch (err) {
      this.logger.warn(
        `Password changed but other-session sign-out failed for ${args.userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
