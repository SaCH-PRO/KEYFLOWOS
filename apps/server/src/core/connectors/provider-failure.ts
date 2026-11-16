import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';

/**
 * W11-PROVIDER-OUTAGE-503 (R-5 part 1; W10-DISPATCH-STATUS review
 * CR-W10DS-1): how a Google client answers a non-OK upstream response.
 *
 * GmailService and GoogleDriveService answered every non-OK Google response
 * with BadRequestException, an outage included, so a genuine refusal and a
 * provider that did not answer looked the same to every caller: the web could
 * not say "try again later", and KEY's plan queue could not treat a tool's 400
 * as final while 'Gmail search failed (503)' was one.
 *
 * providerFailure() is the one decision:
 *
 *   transient (the provider did not answer; asking again later can succeed)
 *     -> 503 ServiceUnavailableException
 *        { code: 'provider_unavailable', service, message, upstreamStatus, error: 'Service Unavailable' }
 *     any 5xx; 408 (request timeout); 429 (too many requests);
 *     403 whose Google JSON error names errors[].reason rateLimitExceeded or
 *         userRateLimitExceeded, or error.status RESOURCE_EXHAUSTED (Google
 *         answers some quota limits 403, not 429);
 *     409 whose error.status is ABORTED (a concurrency abort Google says to retry).
 *   otherwise (a refusal: asking again the same way fails the same way)
 *     -> the existing new BadRequestException(message), unchanged
 *        (an ALREADY_EXISTS 409, a 403 insufficientPermissions and a token
 *        endpoint's 400/401 invalid_grant, which needs a reconnect, included).
 *
 * The global filter renders the 503 as { statusCode: 503, code:
 * 'provider_unavailable', message, details: { service, upstreamStatus } }, the
 * shape gmailNotConfigured's provider_not_configured already has (R0-07), and
 * the web already reads (providerUnavailableOf, apps/web/src/lib/api.ts).
 *
 * The message is always the caller's: the upstream body is read only to
 * classify a 403 or 409, defensively (non-JSON, empty, oversized or oddly
 * shaped bodies classify as a refusal), and never put in the message or the
 * response. A fetch() that throws never reaches here: its error propagates as
 * it always did.
 */
export type ProviderService = 'gmail' | 'drive' | (string & {});

/** Bodies longer than this are not parsed (a Google error body is a few hundred bytes). */
const MAX_PARSED_BODY = 64 * 1024;

const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

/** The `error` object of a Google JSON error body, or null when there is none. */
function googleErrorOf(bodyText: string | null): Record<string, unknown> | null {
  if (typeof bodyText !== 'string' || bodyText.length === 0 || bodyText.length > MAX_PARSED_BODY) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const error = (parsed as { error?: unknown }).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  return error as Record<string, unknown>;
}

function isRateLimited(error: Record<string, unknown>): boolean {
  if (error.status === 'RESOURCE_EXHAUSTED') return true;
  const errors = error.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some(
    (e) => !!e && typeof e === 'object' && typeof (e as { reason?: unknown }).reason === 'string'
      && RATE_LIMIT_REASONS.has((e as { reason: string }).reason),
  );
}

/** Whether an upstream answer of `status` (with `bodyText`) is an outage rather than a refusal. */
export function isTransientProviderFailure(status: number, bodyText: string | null): boolean {
  if (status >= 500 || status === 408 || status === 429) return true;
  if (status !== 403 && status !== 409) return false;
  const error = googleErrorOf(bodyText);
  if (!error) return false;
  if (status === 403) return isRateLimited(error);
  return error.status === 'ABORTED';
}

/**
 * The exception a Google client throws for a non-OK upstream answer: 503
 * provider_unavailable for an outage, else the existing BadRequestException
 * with the same message.
 */
export function providerFailure(
  service: ProviderService,
  status: number,
  bodyText: string | null,
  message: string,
): HttpException {
  if (isTransientProviderFailure(status, bodyText)) {
    return new ServiceUnavailableException({
      code: 'provider_unavailable',
      service,
      message,
      upstreamStatus: status,
      error: 'Service Unavailable',
    });
  }
  return new BadRequestException(message);
}

/**
 * A failed answer's body text, read once, for a site that does not already
 * read it for its log. null when the answer has no readable body.
 */
export async function readProviderFailureBody(res: { text?: () => Promise<string> } | null | undefined): Promise<string | null> {
  if (!res || typeof res.text !== 'function') return null;
  try {
    return await res.text();
  } catch {
    return null;
  }
}
