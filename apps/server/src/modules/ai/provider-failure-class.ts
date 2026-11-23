/**
 * Provider failure classification for the model gateway (RR-GATEWAY-TYPED-FAILURES, D-261).
 *
 * A caught provider error is classified once, and the class decides two things
 * that used to be decided by a message-substring test and by nothing at all:
 *
 *   - whether the failure counts toward the circuit of the credential in use
 *     (`failureCountsTowardCircuit`): a provider that is down, a credential that
 *     cannot serve (auth, exhausted quota) and anything unexplained count; a
 *     rate limit, a request the caller got wrong and the caller's own abort do
 *     not, because none of them says the provider or the key is unavailable to
 *     the next caller;
 *   - whether the attempt is retried in place (`failureIsRetryable`): rate
 *     limits, server, network and timeout failures are; auth, quota, bad
 *     requests and aborts are not (retrying them repeats the same answer).
 *
 * Inputs read, in order: the caller-abort shapes; the OpenAI SDK's typed
 * connection errors; an HTTP status (`err.status` on an OpenAI SDK APIError or
 * on a ProviderHttpError) with `err.code`/`err.type` for the 429 split and 402 as
 * quota; a Node
 * network error code (`err.code`, or `err.cause.code` under fetch); and only
 * then, for a plain Error, its message with whole-number status codes
 * (`\b500\b` does not match 'max_tokens 5000').
 */
import OpenAI from 'openai';

export type ProviderFailureClass =
  | 'rate_limited'
  | 'quota_exhausted'
  | 'auth'
  | 'bad_request'
  | 'caller_aborted'
  | 'server'
  | 'network'
  | 'timeout'
  | 'unknown';

/** An HTTP failure from a provider the gateway calls with fetch (Anthropic). The message is the text the logs always carried. */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly provider: string;

  constructor(provider: string, status: number, message: string) {
    super(message);
    this.name = 'ProviderHttpError';
    this.provider = provider;
    this.status = status;
  }
}

const COUNTS_TOWARD_CIRCUIT: ReadonlySet<ProviderFailureClass> = new Set(['server', 'network', 'timeout', 'auth', 'quota_exhausted', 'unknown']);
const RETRYABLE: ReadonlySet<ProviderFailureClass> = new Set(['rate_limited', 'server', 'network', 'timeout']);

export function failureCountsTowardCircuit(cls: ProviderFailureClass): boolean {
  return COUNTS_TOWARD_CIRCUIT.has(cls);
}

export function failureIsRetryable(cls: ProviderFailureClass): boolean {
  return RETRYABLE.has(cls);
}

const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED']);
const ABORT_CODES = new Set(['ABORT_ERR']);

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
  type?: unknown;
  cause?: unknown;
};

function asErrorLike(err: unknown): ErrorLike | null {
  return err !== null && typeof err === 'object' ? (err as ErrorLike) : null;
}

function codeOf(e: ErrorLike): string | undefined {
  if (typeof e.code === 'string') return e.code;
  const cause = asErrorLike(e.cause);
  return cause && typeof cause.code === 'string' ? cause.code : undefined;
}

/**
 * The documented quota signals on a 429: OpenAI's `insufficient_quota` (code or type) and Moonshot's
 * `exceeded_current_quota_error` (type). The words of the message are never read on the status path:
 * Google's ordinary per-minute throttle says "check quota" and is a rate limit.
 */
const QUOTA_MARKERS = ['insufficient_quota', 'exceeded_current_quota_error'];

function classifyStatus(status: number, e: ErrorLike): ProviderFailureClass {
  if (status === 429) {
    const marker = `${typeof e.code === 'string' ? e.code : ''} ${typeof e.type === 'string' ? e.type : ''}`.toLowerCase();
    return QUOTA_MARKERS.some((m) => marker.includes(m)) ? 'quota_exhausted' : 'rate_limited';
  }
  // 402 Payment Required: OpenRouter and other OpenAI-compatible providers answer it when the credential
  // has no credits. The credential cannot serve, like insufficient_quota.
  if (status === 402) return 'quota_exhausted';
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'unknown';
}

/** The message fallback, for plain Errors thrown by paths that carry no status (and for tests that stub them). */
function classifyMessage(message: string): ProviderFailureClass {
  const msg = message.toLowerCase();
  if (/insufficient_quota|exceeded_current_quota_error|\b402\b/.test(msg)) return 'quota_exhausted';
  if (/\b429\b|rate limit/.test(msg)) return 'rate_limited';
  if (/\b(401|403)\b|invalid api key|incorrect api key|invalid x-api-key|unauthorized|authentication/.test(msg)) return 'auth';
  if (/\b(400|404|413|422)\b/.test(msg)) return 'bad_request';
  if (/\b(500|502|503|504|529)\b|overloaded_error/.test(msg)) return 'server';
  if (/\btimed? ?out\b/.test(msg)) return 'timeout';
  if (/econnreset|econnrefused|enotfound|socket hang up|network error|connection error/.test(msg)) return 'network';
  return 'unknown';
}

export function classifyProviderFailure(err: unknown): ProviderFailureClass {
  const e = asErrorLike(err);
  if (!e) return 'unknown';

  if (err instanceof OpenAI.APIUserAbortError || e.name === 'AbortError' || ABORT_CODES.has(codeOf(e) ?? '')) {
    return 'caller_aborted';
  }
  if (err instanceof OpenAI.APIConnectionTimeoutError || e.name === 'TimeoutError') return 'timeout';
  if (err instanceof OpenAI.APIConnectionError) return 'network';

  if (typeof e.status === 'number' && Number.isFinite(e.status) && e.status > 0) {
    return classifyStatus(e.status, e);
  }

  const code = codeOf(e);
  if (code && TIMEOUT_CODES.has(code)) return 'timeout';
  if (code && NETWORK_CODES.has(code)) return 'network';

  return classifyMessage(typeof e.message === 'string' ? e.message : '');
}
