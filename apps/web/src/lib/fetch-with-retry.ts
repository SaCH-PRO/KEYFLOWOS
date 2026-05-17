import { logError } from "./logger";

export interface FetchRetryOptions {
  /** Maximum retry attempts (default 3) */
  retries?: number;
  /** Base delay in ms (default 300) */
  baseDelayMs?: number;
  /** Per-attempt timeout in ms (default none) */
  timeoutMs?: number;
  /** Status codes that trigger a retry (default 408, 429, 502, 503, 504) */
  retryStatusCodes?: number[];
  /** HTTP methods that are safe to retry (default GET, HEAD, OPTIONS) */
  retryMethods?: string[];
}

const DEFAULT_RETRY_STATUS_CODES = [408, 429, 502, 503, 504];
const DEFAULT_RETRY_METHODS = ["GET", "HEAD", "OPTIONS"];
const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("abort") ||
    msg.includes("timeout") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror")
  );
}

/**
 * fetch wrapper with exponential backoff for transient failures.
 *
 * Retries on:
 *   - Network errors / fetch failures
 *   - HTTP 408, 429, 502, 503, 504
 *
 * Does NOT retry on:
 *   - 4xx client errors (except 408/429)
 *   - Non-idempotent methods (POST, PUT, PATCH, DELETE) unless explicitly configured
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: FetchRetryOptions,
): Promise<Response> {
  const retries = options?.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const retryStatusCodes = options?.retryStatusCodes ?? DEFAULT_RETRY_STATUS_CODES;
  const retryMethods = options?.retryMethods ?? DEFAULT_RETRY_METHODS;
  const method = (init?.method ?? "GET").toUpperCase();
  const shouldRetryMethod = retryMethods.includes(method);

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let res: Response;
      if (options?.timeoutMs) {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), options.timeoutMs);
        res = await fetch(input, { ...init, signal: controller.signal });
        clearTimeout(t);
      } else {
        res = await fetch(input, init);
      }

      // If successful or non-retryable, return immediately
      if (res.ok || !retryStatusCodes.includes(res.status) || !shouldRetryMethod) {
        return res;
      }

      // Retryable HTTP status
      lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || !shouldRetryMethod) {
        throw err;
      }
    }

    if (attempt < retries) {
      const delay = baseDelayMs * 2 ** attempt;
      const jitter = Math.random() * 100;
      await sleep(delay + jitter);
    }
  }

  logError("fetchWithRetry exhausted all attempts", lastError);
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
