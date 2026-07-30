import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

/**
 * Top common passwords seen in major breaches. We keep this list small
 * and embedded so the policy enforces *something* useful even when the
 * HIBP network call is unavailable. The full breach corpus comes from
 * the Pwned Passwords k-anonymity API ({@link checkHibp}).
 *
 * Sources: SecLists `10-million-password-list-top-100` plus a handful
 * of brand-relevant strings (company name, "trinidad", etc.) likely to
 * be tried first against this product. Lower-case, no whitespace.
 */
const COMMON_PASSWORDS = new Set<string>([
  '123456', '12345678', '123456789', '1234567', '1234567890', '12345',
  'password', 'password1', 'password123', 'qwerty', 'qwerty123',
  'abc123', 'iloveyou', 'admin', 'admin123', 'letmein', 'welcome',
  'monkey', 'dragon', 'master', 'football', 'baseball', 'sunshine',
  'princess', '111111', '000000', '654321', '555555', '666666',
  'asdfgh', 'zxcvbn', 'qazwsx', '1q2w3e', '1q2w3e4r', 'qwertyuiop',
  'trustno1', 'superman', 'batman', 'shadow', 'whatever', 'hello',
  'hello123', 'login', 'changeme', 'pass1234', 'keyflow', 'keyflowos',
  'trinidad', 'tobago', 'caribbean', 'tester', 'test1234',
]);

/**
 * Tier-2 password policy: hard rules + breach-corpus check.
 *
 * **Hard rules** (always enforced, no network needed):
 *   - 12 character minimum (NIST SP 800-63B recommends ≥8; we go higher
 *     to push real entropy out of dictionary range)
 *   - 256 character maximum (Supabase storage cap; also blocks DoS via
 *     megabyte passwords against bcrypt)
 *   - Must contain at least one letter and one number — not because
 *     character-class rules add real entropy, but because it cheaply
 *     screens out "111111111111" and "abcdefghijkl"
 *   - Not present in our embedded common-password set
 *   - Must not equal the user's email local-part
 *
 * **Breach check** (best-effort, fails open on network error):
 *   - Pwned Passwords k-anonymity API (HIBP) — send only the first 5
 *     chars of SHA-1, server returns suffixes; we never expose the
 *     password. If the suffix is found with a count ≥ HIBP_THRESHOLD
 *     the password is rejected. Default threshold 100 (well-known
 *     reused passwords) — operators can lower for stricter posture.
 *
 * Throws BadRequestException with stable code `weak_password` on any
 * failure, so the existing signup error handler maps it cleanly to the
 * UI.
 */
@Injectable()
export class PasswordPolicyService {
  private readonly logger = new Logger(PasswordPolicyService.name);
  private readonly hibpEndpoint =
    process.env.HIBP_API_BASE?.trim() || 'https://api.pwnedpasswords.com/range';
  private readonly hibpThreshold = Number.isFinite(Number(process.env.HIBP_THRESHOLD))
    ? Math.max(1, Number(process.env.HIBP_THRESHOLD))
    : 100;
  private readonly hibpEnabled = (process.env.HIBP_DISABLED || '').toLowerCase() !== 'true';
  private readonly hibpTimeoutMs = 1500;

  async validate(args: { password: string; email?: string }): Promise<void> {
    const pw = args.password ?? '';
    const reasons: string[] = [];

    if (pw.length < 12) reasons.push('Use at least 12 characters.');
    if (pw.length > 256) reasons.push('Password is too long (max 256 characters).');
    if (!/[a-zA-Z]/.test(pw)) reasons.push('Include at least one letter.');
    if (!/\d/.test(pw)) reasons.push('Include at least one number.');

    const lower = pw.trim().toLowerCase();
    if (lower && COMMON_PASSWORDS.has(lower)) {
      reasons.push('That password is too common — pick something unique.');
    }

    if (args.email) {
      const local = args.email.trim().toLowerCase().split('@')[0];
      if (local && local.length >= 4 && lower === local) {
        reasons.push("Don't use your email as your password.");
      }
    }

    if (reasons.length > 0) {
      throw new BadRequestException({
        code: 'weak_password',
        message: reasons.join(' '),
      });
    }

    if (this.hibpEnabled) {
      const hits = await this.checkHibp(pw);
      if (hits >= this.hibpThreshold) {
        throw new BadRequestException({
          code: 'weak_password',
          message: `This password has appeared in ${hits.toLocaleString()} known data breaches. Please choose a different one.`,
        });
      }
    }
  }

  /**
   * Pwned Passwords k-anonymity check. Send the first 5 hex chars of
   * the SHA-1 digest, receive a list of `SUFFIX:COUNT` lines, look for
   * our suffix in the response. The full hash never leaves the server.
   *
   * Returns the breach hit count (0 if not found). Returns 0 on any
   * network/HTTP error so a transient HIBP outage doesn't block real
   * signups — the hard rules above remain active.
   */
  private async checkHibp(password: string): Promise<number> {
    let hash: string;
    try {
      hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    } catch (err: any) {
      this.logger.warn(`hibp hash failed: ${err instanceof Error ? err.message : err}`);
      return 0;
    }
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.hibpTimeoutMs);
    try {
      const res = await fetch(`${this.hibpEndpoint}/${prefix}`, {
        signal: ctrl.signal,
        headers: { 'Add-Padding': 'true', 'User-Agent': 'KeyflowOS-Auth/1.0' },
      });
      if (!res.ok) {
        this.logger.warn(`hibp returned ${res.status}; allowing through`);
        return 0;
      }
      const body = await res.text();
      // Parse `SUFFIX:COUNT` lines, find ours.
      for (const line of body.split(/\r?\n/)) {
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        const sfx = line.slice(0, idx).trim().toUpperCase();
        if (sfx === suffix) {
          const count = parseInt(line.slice(idx + 1).trim(), 10);
          return Number.isFinite(count) ? count : 0;
        }
      }
      return 0;
    } catch (err: any) {
      this.logger.warn(`hibp request failed: ${err instanceof Error ? err.message : err}`);
      return 0;
    } finally {
      clearTimeout(timer);
    }
  }
}
