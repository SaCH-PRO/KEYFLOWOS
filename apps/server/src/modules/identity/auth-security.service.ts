import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export type AuthEvent =
  | 'signup'
  | 'login_success'
  | 'login_failure'
  | 'resend_verification'
  | 'rate_limited';

export type AuthOutcome = 'success' | 'failure' | 'rate_limited' | 'error';

export interface RateLimitRule {
  /** Logical name — joined with the subject to form the bucket. */
  scope: string;
  /** Maximum hits allowed inside `windowMs`. */
  limit: number;
  /** Sliding window in milliseconds. */
  windowMs: number;
}

export interface AuditEntry {
  event: AuthEvent;
  outcome: AuthOutcome;
  email?: string | null;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Tier-2 auth hardening service.
 *
 * Two responsibilities, deliberately co-located so every protected auth
 * route hits both in lockstep:
 *
 *   1. **Rate limiting** via a sliding window backed by Postgres
 *      (`AuthRateLimit` table). The legacy `PublicRateLimitGuard` keeps
 *      its in-memory buckets for low-stakes endpoints — but auth needs
 *      to survive process restarts, multi-instance deploys, and
 *      distinguish IP-based vs email-based brute-force, so we go to the
 *      DB. Each rule is a `(scope, subject)` pair → one bucket row per
 *      hit, count rows in window, throw 429 when over.
 *
 *   2. **Audit logging** via an append-only `AuthAuditLog` table that
 *      records every signup / login / resend / rate-limit event with
 *      IP, user-agent, email and reason. The admin Security UI reads
 *      from this table; T007 surfaces it in the UI.
 *
 * Both calls are best-effort — a DB hiccup must NOT lock the user out
 * or take down auth — so failures are logged and swallowed (limiter
 * "fails open"). The guarantees we make:
 *   - `enforce()` either returns silently OR throws HttpException(429).
 *   - `audit()` never throws.
 */
@Injectable()
export class AuthSecurityService {
  private readonly logger = new Logger(AuthSecurityService.name);

  /**
   * Default rules — tuned for a small SaaS where genuine users rarely
   * retry more than a handful of times. Operators can override per-call
   * if a particular endpoint needs different bounds.
   *
   * IP-scoped buckets stop distributed brute-force from a single host;
   * email-scoped buckets stop credential-stuffing one account from many
   * hosts. Both apply.
   */
  static readonly RULES = {
    LOGIN_IP: { scope: 'login:ip', limit: 10, windowMs: 15 * 60_000 },
    LOGIN_EMAIL: { scope: 'login:email', limit: 8, windowMs: 15 * 60_000 },
    SIGNUP_IP: { scope: 'signup:ip', limit: 5, windowMs: 60 * 60_000 },
    SIGNUP_EMAIL: { scope: 'signup:email', limit: 3, windowMs: 60 * 60_000 },
    RESEND_IP: { scope: 'resend:ip', limit: 10, windowMs: 60 * 60_000 },
    RESEND_EMAIL: { scope: 'resend:email', limit: 5, windowMs: 60 * 60_000 },
  } as const satisfies Record<string, RateLimitRule>;

  private lastPruneAt = 0;
  private readonly pruneIntervalMs = 5 * 60_000;
  /** Records older than this are eligible for pruning. */
  private readonly pruneOlderThanMs = 24 * 60 * 60_000;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Throws `HttpException(429)` if `(rule.scope, subject)` has exceeded
   * `rule.limit` hits inside `rule.windowMs`. Otherwise records the hit
   * and returns. Subject is normalized (trimmed + lower-cased) so
   * "Foo@Bar" and "foo@bar" share the same bucket.
   *
   * Failures contacting the DB are logged but allowed through — auth
   * must remain available even if the limiter table is briefly
   * unreachable.
   */
  async enforce(rule: RateLimitRule, subject: string): Promise<void> {
    const bucket = this.bucketKey(rule.scope, subject);
    const now = Date.now();
    const windowStart = new Date(now - rule.windowMs);

    try {
      const count = await this.prisma.client.authRateLimit.count({
        where: { bucket, hitAt: { gte: windowStart } },
      });
      if (count >= rule.limit) {
        throw new HttpException(
          { code: 'rate_limited', message: 'Too many attempts. Please wait a few minutes and try again.' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await this.prisma.client.authRateLimit.create({ data: { bucket } });
    } catch (err) {
      // Re-throw the 429 so the caller actually rejects the request.
      if (err instanceof HttpException) throw err;
      // Anything else (DB unreachable, etc.) — log + fail open.
      this.logger.warn(
        `enforce(${bucket}) failed; allowing through: ${err instanceof Error ? err.message : err}`,
      );
    }

    this.maybePrune(now).catch(() => undefined);
  }

  /**
   * Append an entry to `AuthAuditLog`. Never throws — auditing is
   * observability, not business logic. If the write fails we log the
   * error and continue so the user still sees a successful (or failed)
   * auth response.
   */
  async audit(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.client.authAuditLog.create({
        data: {
          event: entry.event,
          outcome: entry.outcome,
          email: entry.email?.trim().toLowerCase() || null,
          userId: entry.userId ?? null,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent?.slice(0, 512) ?? null,
          reason: entry.reason?.slice(0, 256) ?? null,
          metadata: (entry.metadata ?? null) as never,
        },
      });
    } catch (err) {
      this.logger.warn(
        `audit(${entry.event}/${entry.outcome}) failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private bucketKey(scope: string, subject: string): string {
    const normalized = (subject ?? '').trim().toLowerCase() || 'unknown';
    return `${scope}:${normalized}`;
  }

  /**
   * Garbage-collect old rate-limit rows roughly every 5 minutes. Keeps
   * the table from growing unbounded under sustained traffic. The
   * cleanup is fire-and-forget; we never wait for it before serving
   * the current request.
   */
  private async maybePrune(now: number): Promise<void> {
    if (now - this.lastPruneAt < this.pruneIntervalMs) return;
    this.lastPruneAt = now;
    const cutoff = new Date(now - this.pruneOlderThanMs);
    try {
      await this.prisma.client.authRateLimit.deleteMany({ where: { hitAt: { lt: cutoff } } });
    } catch (err) {
      this.logger.debug(
        `prune failed (non-fatal): ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
