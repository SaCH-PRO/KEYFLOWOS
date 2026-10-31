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

/**
 * R0-07: the body codes of the structured 503 an optional service (Gmail, AI)
 * answers when it cannot be used for this request:
 *
 *   { statusCode: 503, code: 'provider_not_configured' | 'provider_unavailable', message, details: { service } }
 *
 * `provider_not_configured`: nothing is set up to call (no Gmail connection, no
 * AI key). `provider_unavailable`: AI providers are configured but every
 * circuit is open. Neither is a transient gateway failure, so retrying cannot
 * change the answer and only spends the caller's rate limit.
 */
export const PROVIDER_UNAVAILABLE_CODES = ["provider_not_configured", "provider_unavailable"] as const;
export type ProviderUnavailableCode = (typeof PROVIDER_UNAVAILABLE_CODES)[number];

/** The R0-07 code a parsed error body carries, or null when it carries none. */
export function providerUnavailableCode(body: unknown): ProviderUnavailableCode | null {
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { code?: unknown }).code;
  return (PROVIDER_UNAVAILABLE_CODES as readonly unknown[]).includes(code) ? (code as ProviderUnavailableCode) : null;
}

/**
 * Bounds on the body read that classifies a 503 (R0-07b review ST-1). The
 * R0-07 body is a few hundred bytes of JSON sent with the headers, so a body
 * that is larger, or still arriving after this long, is not that answer: it is
 * handled as a plain 503 (retried), as it was before the check existed. The
 * read also never outlasts the attempt's own timeout.
 */
const PROVIDER_BODY_MAX_BYTES = 16 * 1024;
const PROVIDER_BODY_READ_MS = 5_000;

/**
 * Reads at most PROVIDER_BODY_MAX_BYTES of a clone of `res` within `budgetMs`.
 * Null when the body is missing, too large, not bytes, or still arriving at the
 * deadline; then both branches of the body are cancelled and `onGiveUp` runs,
 * so the discarded response does not keep its connection open.
 */
async function readSmallBody(res: Response, budgetMs: number, onGiveUp?: () => void): Promise<string | null> {
  const declared = Number(res.headers?.get?.("content-length") ?? "");
  if (Number.isFinite(declared) && declared > PROVIDER_BODY_MAX_BYTES) return null;
  const body = res.clone().body;
  if (!body || typeof body.getReader !== "function") return null;

  const reader = body.getReader();
  // Not awaited: a cancelled tee branch settles only once its sibling is
  // cancelled too, and the caller must not wait on either.
  const giveUp = (): null => {
    reader.cancel().catch(() => undefined);
    res.body?.cancel().catch(() => undefined);
    onGiveUp?.();
    return null;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"expired">((resolve) => {
    timer = setTimeout(() => resolve("expired"), budgetMs);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const step = await Promise.race([reader.read(), expired]);
      if (step === "expired") return giveUp();
      if (step.done) break;
      // isView rather than instanceof: a chunk from another realm is still bytes.
      const view: unknown = step.value;
      if (!ArrayBuffer.isView(view)) return giveUp();
      size += view.byteLength;
      if (size > PROVIDER_BODY_MAX_BYTES) return giveUp();
      chunks.push(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    }
  } finally {
    clearTimeout(timer);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Whether a 503 is the R0-07 optional-service answer. Reads a clone, so the
 * caller still gets the body. Only a small JSON body is read, and only within
 * `budgetMs`; an empty, HTML, oversized, stalled or other non-JSON body is a
 * plain 503 and keeps the retry.
 */
async function isProviderUnavailable503(res: Response, budgetMs: number, onGiveUp?: () => void): Promise<boolean> {
  if (res.status !== 503 || typeof res.clone !== "function" || budgetMs <= 0) return false;
  if (!/json/i.test(res.headers?.get?.("content-type") ?? "")) return false;
  try {
    const text = await readSmallBody(res, budgetMs, onGiveUp);
    return text !== null && providerUnavailableCode(JSON.parse(text)) !== null;
  } catch {
    return false;
  }
}

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
 *   - A 503 whose JSON body code is provider_not_configured or provider_unavailable
 *     (R0-07): that response is returned with its body, so the caller can show
 *     "not configured" rather than "backend unreachable"
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
    // The per-attempt timer stays armed until this attempt is decided, which
    // includes the 503 body check below. It is cleared before a response is
    // handed back, so the caller's own body read is not cut off.
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    try {
      let res: Response;
      if (options?.timeoutMs) {
        const attemptController = new AbortController();
        controller = attemptController;
        timer = setTimeout(() => attemptController.abort(), options.timeoutMs);
        res = await fetch(input, { ...init, signal: attemptController.signal });
      } else {
        res = await fetch(input, init);
      }

      // If successful or non-retryable, return immediately
      if (res.ok || !retryStatusCodes.includes(res.status) || !shouldRetryMethod) {
        return res;
      }
      const budgetMs = options?.timeoutMs
        ? Math.min(PROVIDER_BODY_READ_MS, options.timeoutMs - (Date.now() - startedAt))
        : PROVIDER_BODY_READ_MS;
      if (await isProviderUnavailable503(res, budgetMs, () => controller?.abort())) {
        return res;
      }

      // Retryable HTTP status
      lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || !shouldRetryMethod) {
        throw err;
      }
    } finally {
      clearTimeout(timer);
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
