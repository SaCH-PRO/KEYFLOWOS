/**
 * Lightweight circuit breaker for external API calls.
 *
 * States:
 *   CLOSED  – requests pass through normally.
 *   OPEN    – after {failureThreshold} failures in {windowMs}, rejects fast.
 *   HALF_OPEN – after {resetTimeoutMs}, allows 1 probe request.
 *
 * Usage:
 *   const cb = new CircuitBreaker('openai', { failureThreshold: 5, resetTimeoutMs: 30000 });
 *   const result = await cb.execute(() => openai.chat.completions.create(params));
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Failures within window to trip the breaker (default 5) */
  failureThreshold?: number;
  /** Rolling window in ms (default 60_000) */
  windowMs?: number;
  /** Time before allowing a probe request after OPEN (default 30_000) */
  resetTimeoutMs?: number;
}

export class CircuitBreaker {
  readonly name: string;
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly resetTimeoutMs: number;

  private state: CircuitState = 'CLOSED';
  private failures: number[] = []; // timestamps
  private nextAttempt = 0;
  private halfOpenPending = false;

  constructor(name: string, options: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.windowMs = options.windowMs ?? 60_000;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
  }

  getState(): CircuitState {
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new CircuitBreakerError(
          `Circuit breaker '${this.name}' is OPEN`,
          this.name,
        );
      }
      this.state = 'HALF_OPEN';
      this.halfOpenPending = false;
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenPending) {
      throw new CircuitBreakerError(
        `Circuit breaker '${this.name}' is HALF_OPEN with pending probe`,
        this.name,
      );
    }

    if (this.state === 'HALF_OPEN') {
      this.halfOpenPending = true;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err: any) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.failures = [];
      this.halfOpenPending = false;
    }
  }

  private onFailure(): void {
    const now = Date.now();
    this.failures.push(now);
    this.failures = this.failures.filter((t) => now - t <= this.windowMs);

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.nextAttempt = now + this.resetTimeoutMs;
      this.halfOpenPending = false;
      return;
    }

    if (this.failures.length >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = now + this.resetTimeoutMs;
    }
  }
}

export class CircuitBreakerError extends Error {
  readonly circuitName: string;
  constructor(message: string, circuitName: string) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.circuitName = circuitName;
  }
}
