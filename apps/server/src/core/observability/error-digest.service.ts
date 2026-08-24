import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { safeInterval } from '../scheduling/safe-interval';
import { errorRegistry } from './error-registry';

/**
 * Periodically says out loud what has been failing.
 *
 * WHY. The registry makes failures queryable at
 * `GET /api/diagnostics/errors`, but nothing queries it. A record nobody reads
 * is not observability — it is the same shape as the logs it was meant to
 * improve on. This is the part that reaches a person: one line in the log that
 * an operator, a log aggregator, or a cloud cycle can notice without knowing
 * the endpoint exists.
 *
 * WHY IT STAYS QUIET. It reports only when the total has MOVED since the last
 * digest. A summary emitted every interval regardless — including "0 errors" —
 * is noise, and noise is how a signal gets filtered out and then ignored. The
 * repo has already learned this once: a permanently-red gate gets disabled, and
 * a permanently-chatty log gets muted. Silence here means nothing new broke.
 */
@Injectable()
export class ErrorDigestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ErrorDigestService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTotal = 0;

  /** Long enough not to chatter, short enough that a bad deploy is visible. */
  static readonly INTERVAL_MS = 15 * 60 * 1000;
  /** Offenders named per digest. The rest are a count. */
  static readonly TOP_N = 5;

  onModuleInit(): void {
    // Uses safeInterval rather than setInterval for the same reason everything
    // else here does: a throw in this method must not reach the process
    // handler and take the API down. An observability service that can kill
    // the server is a worse bug than the one it reports.
    this.timer = safeInterval(
      'ErrorDigestService',
      ErrorDigestService.INTERVAL_MS,
      () => this.emit(),
      this.logger,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Emit a digest if anything new has failed. Public so it can be tested and
   * called on demand without waiting fifteen minutes.
   *
   * Returns the line it logged, or null when it stayed quiet.
   */
  emit(): string | null {
    const snap = errorRegistry.snapshot(ErrorDigestService.TOP_N);
    const newFailures = snap.total - this.lastTotal;
    if (newFailures <= 0) {
      // Also resync downward, so a registry reset cannot leave lastTotal above
      // total and suppress every future digest.
      this.lastTotal = snap.total;
      return null;
    }
    this.lastTotal = snap.total;

    const top = snap.entries
      .map((e) => `${e.label} x${e.count} (${e.source}): ${e.message}`)
      .join(' | ');
    const more = snap.distinct > snap.entries.length
      ? ` +${snap.distinct - snap.entries.length} other signatures`
      : '';
    const dropped = snap.dropped > 0 ? ` [${snap.dropped} dropped: key cap reached]` : '';

    const line =
      `${newFailures} new failure(s) since last digest; ` +
      `${snap.distinct} distinct, ${snap.total} total since ${snap.since}. ` +
      `http=${snap.bySource.http} background=${snap.bySource.background}. ` +
      `Top: ${top}${more}${dropped}`;

    this.logger.warn(line);
    return line;
  }
}
