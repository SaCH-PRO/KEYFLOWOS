import { Logger } from '@nestjs/common';
import { errorRegistry } from '../observability/error-registry';

/**
 * `setInterval` for background jobs, with the rejection path closed.
 *
 * WHY THIS EXISTS. `main.ts` installs:
 *
 *     process.on('unhandledRejection', (reason) => {
 *       console.error('[FATAL] Unhandled rejection:', reason);
 *       process.exit(1);
 *     });
 *
 * so ANY unhandled promise rejection anywhere in the process kills the API —
 * dropping every in-flight request, for every tenant, immediately. Meanwhile
 * this server runs 52 `setInterval` schedulers, and the common spelling is:
 *
 *     setInterval(() => void this.tick(), MS);
 *
 * `void` discards the promise; it does not handle its rejection. So one
 * transient failure inside a background job — a DB blip in an overdue-invoice
 * sweep, a network error in a connector health check — takes the whole API
 * down. Reproduced directly: an async interval callback that throws reaches the
 * handler above and exits 1.
 *
 * WHY IT WRAPS EVERY SITE RATHER THAN THE UNSAFE ONES. Three successive static
 * analyses of "which callbacks are unsafe" gave three different answers (28,
 * then 23, then 17), and the last was still wrong: `ConnectorHealthMonitor.tick`
 * has a try/catch that simply is not its first statement. Deciding this
 * statically means proving that every await in a method — and its catch block,
 * and anything after its try — cannot throw. Wrapping unconditionally makes the
 * question unnecessary: a redundant catch over an already-safe job costs one
 * closure and nothing else.
 *
 * The process-level handler is deliberately left alone. Failing fast on a
 * genuinely unknown rejection is a reasonable policy; it just should not be
 * reachable from a background tick.
 */
export function safeInterval(
  label: string,
  ms: number,
  fn: () => unknown,
  logger: Pick<Logger, 'error'>,
): NodeJS.Timeout {
  return setInterval(() => {
    runGuarded(label, fn, logger);
  }, ms);
}

/** `setTimeout` with the same guarantee — schedulers often use a startup delay. */
export function safeTimeout(
  label: string,
  ms: number,
  fn: () => unknown,
  logger: Pick<Logger, 'error'>,
): NodeJS.Timeout {
  return setTimeout(() => {
    runGuarded(label, fn, logger);
  }, ms);
}

/**
 * Run `fn`, swallowing both a synchronous throw and a rejected promise.
 *
 * Returns nothing: a caller that wants the result should not be using a
 * fire-and-forget scheduler.
 */
export function runGuarded(label: string, fn: () => unknown, logger: Pick<Logger, 'error'>): void {
  const report = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    // Logged, never rethrown — rethrowing here would land straight back on the
    // process-level handler this exists to keep unreachable.
    logger.error(`[${label}] background tick failed: ${message}`, stack);
    // Every background failure in the server passes through here, which makes
    // this the one place worth recording them. Without it a job can fail on
    // every tick for days and leave no trace but log lines nobody reads.
    errorRegistry.record('background', label, err);
  };

  let result: unknown;
  try {
    result = fn();
  } catch (err) {
    report(err);
    return;
  }

  // Duck-typed rather than `instanceof Promise`, so a thenable from another
  // realm (or a library's own promise implementation) is still handled.
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(result).catch(report);
  }
}
