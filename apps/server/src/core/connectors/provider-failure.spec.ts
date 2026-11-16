/**
 * W11-PROVIDER-OUTAGE-503 (R-5 part 1; W10-DISPATCH-STATUS review CR-W10DS-1):
 * the mapping table of providerFailure(), the one place a Google client turns
 * a non-OK upstream answer into an HttpException.
 *
 * The defect: GmailService and GoogleDriveService answered EVERY non-OK Google
 * response with BadRequestException, an outage included, so a genuine refusal
 * and a provider that did not answer looked the same to callers (a KEY plan
 * step cannot treat a 400 as final while 'Gmail search failed (503)' is one).
 *
 * The table (pure: no fetch, no Nest app):
 *   transient -> 503 ServiceUnavailableException
 *                { code: 'provider_unavailable', service, message, upstreamStatus, error: 'Service Unavailable' }
 *     any 5xx; 408; 429;
 *     403 whose Google JSON error names errors[].reason rateLimitExceeded or
 *         userRateLimitExceeded, or error.status RESOURCE_EXHAUSTED;
 *     409 whose error.status is ABORTED.
 *   otherwise -> the existing BadRequestException(message), unchanged.
 * The body is parsed defensively (non-JSON, empty, null, oversized, odd shapes)
 * and never appears in the message or the response.
 *
 * RED-BEFORE (int/v1-base at 15ca8599): provider-failure.ts does not exist, so
 * the import fails and every case below fails.
 *
 * W11-PROVIDER-OUTAGE-CONNECT (R-5 part 3) adds the remaining Google clients'
 * service ids (google_contacts, google_forms, google_business_profile,
 * google_calendar), which keep the Google table, and the Microsoft ones
 * (outlook_contacts for Graph, microsoft for the identity platform's token
 * endpoint), which have no Google error body: 5xx, 408 and 429 are outages and
 * every other 4xx (a 409, a 403, whatever the body says) stays 400. And
 * providerUnavailable(), the 503 a client answers when it has decided the
 * failure is an outage itself (the People / Graph 410 "please retry", whose
 * cursor was just cleared). RED-BEFORE (pkt base c72069ac): POF-16 to POF-19
 * fail (the Graph rows answer the Google table's 503 for a rate-limit 403 and
 * an ABORTED 409, isTransientProviderFailure ignores the service, and
 * providerUnavailable is not exported); POF-20 passes (the open union).
 */
import { describe, it, expect } from 'vitest';
import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { providerFailure, providerUnavailable, isTransientProviderFailure, readProviderFailureBody } from './provider-failure';

/** A Google API error body, as googleapis.com answers it. */
function googleError(code: number, status: string, reasons: string[] = []): string {
  return JSON.stringify({
    error: {
      code,
      message: `upstream says ${status}`,
      status,
      errors: reasons.map((reason) => ({ domain: 'global', reason, message: `upstream reason ${reason}` })),
    },
  });
}

function expectUnavailable(err: HttpException, service: string, status: number, message: string) {
  expect(err).toBeInstanceOf(ServiceUnavailableException);
  expect(err.getStatus()).toBe(503);
  expect(err.getResponse()).toEqual({
    code: 'provider_unavailable',
    service,
    message,
    upstreamStatus: status,
    error: 'Service Unavailable',
  });
}

function expectRefused(err: HttpException, message: string) {
  expect(err).toBeInstanceOf(BadRequestException);
  expect(err).not.toBeInstanceOf(ServiceUnavailableException);
  expect(err.getStatus()).toBe(400);
  expect(err.message).toBe(message);
  // Exactly what `new BadRequestException(message)` answers today.
  expect(err.getResponse()).toEqual(new BadRequestException(message).getResponse());
}

describe('providerFailure: an upstream outage is 503 provider_unavailable, a refusal stays 400 (W11-PROVIDER-OUTAGE-503)', () => {
  it.each([500, 502, 503, 504])('[POF-01] %i gives 503 provider_unavailable with the service, the upstream status and the caller\'s message', (status) => {
    expectUnavailable(providerFailure('gmail', status, googleError(status, 'UNAVAILABLE'), 'Gmail search failed (' + status + ')'), 'gmail', status, `Gmail search failed (${status})`);
  });

  it('[POF-02] every other 5xx (501, 505, 599) is an outage too', () => {
    for (const status of [501, 505, 599]) {
      expectUnavailable(providerFailure('drive', status, null, 'Failed to list Google Drive files'), 'drive', status, 'Failed to list Google Drive files');
    }
  });

  it.each([408, 429])('[POF-03] %i (request timeout, too many requests) gives 503 provider_unavailable', (status) => {
    expectUnavailable(providerFailure('drive', status, googleError(status, 'RESOURCE_EXHAUSTED', ['rateLimitExceeded']), 'Failed to list Google Drive files'), 'drive', status, 'Failed to list Google Drive files');
    // The body plays no part: a bare 408 / 429 is an outage whatever it says.
    expectUnavailable(providerFailure('gmail', status, '', 'Failed to send email'), 'gmail', status, 'Failed to send email');
  });

  it('[POF-04] 403 with errors[].reason rateLimitExceeded or userRateLimitExceeded gives 503 provider_unavailable', () => {
    for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded']) {
      expectUnavailable(providerFailure('drive', 403, googleError(403, 'PERMISSION_DENIED', [reason]), 'Drive trash failed: 403'), 'drive', 403, 'Drive trash failed: 403');
    }
    // One rate-limit reason among others is enough.
    expectUnavailable(providerFailure('gmail', 403, googleError(403, 'PERMISSION_DENIED', ['quotaExceeded', 'userRateLimitExceeded']), 'Gmail API error 403'), 'gmail', 403, 'Gmail API error 403');
  });

  it('[POF-05] 403 with error.status RESOURCE_EXHAUSTED (no errors[] at all) gives 503 provider_unavailable', () => {
    const body = JSON.stringify({ error: { code: 403, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } });
    expectUnavailable(providerFailure('gmail', 403, body, 'Gmail search failed (403)'), 'gmail', 403, 'Gmail search failed (403)');
  });

  it('[POF-06] 409 with error.status ABORTED (a concurrency abort, retryable) gives 503 provider_unavailable', () => {
    expectUnavailable(providerFailure('drive', 409, googleError(409, 'ABORTED'), 'Drive createFolder failed: 409'), 'drive', 409, 'Drive createFolder failed: 409');
  });

  it.each([400, 401, 404, 410, 422])('[POF-07] %i gives the existing BadRequestException with the given message', (status) => {
    expectRefused(providerFailure('gmail', status, googleError(status, 'INVALID_ARGUMENT', ['invalidArgument']), `Gmail API error ${status}`), `Gmail API error ${status}`);
  });

  it('[POF-08] 403 insufficientPermissions (and a 403 with no rate-limit marker) stays 400', () => {
    expectRefused(providerFailure('drive', 403, googleError(403, 'PERMISSION_DENIED', ['insufficientPermissions']), 'Drive move failed: 403'), 'Drive move failed: 403');
    expectRefused(providerFailure('drive', 403, googleError(403, 'PERMISSION_DENIED', ['forbidden', 'appNotAuthorizedToFile']), 'Drive move failed: 403'), 'Drive move failed: 403');
    expectRefused(providerFailure('drive', 403, null, 'Drive move failed: 403'), 'Drive move failed: 403');
  });

  it('[POF-09] 409 ALREADY_EXISTS (and a 409 with no status) stays 400', () => {
    expectRefused(providerFailure('drive', 409, googleError(409, 'ALREADY_EXISTS'), 'Drive createDoc failed: 409'), 'Drive createDoc failed: 409');
    expectRefused(providerFailure('drive', 409, JSON.stringify({ error: { code: 409, message: 'conflict' } }), 'Drive createDoc failed: 409'), 'Drive createDoc failed: 409');
  });

  it('[POF-10] the token endpoint: 400 / 401 invalid_grant (a revoked or expired grant: reconnect) stays 400; a 5xx or 429 is 503', () => {
    const invalidGrant = JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    expectRefused(providerFailure('gmail', 400, invalidGrant, 'Failed to refresh access token'), 'Failed to refresh access token');
    expectRefused(providerFailure('gmail', 401, JSON.stringify({ error: 'invalid_client' }), 'Failed to refresh access token'), 'Failed to refresh access token');
    expectUnavailable(providerFailure('gmail', 503, 'Service Unavailable', 'Failed to refresh access token'), 'gmail', 503, 'Failed to refresh access token');
    expectUnavailable(providerFailure('drive', 429, null, 'Failed to refresh Google Drive connection. Please reconnect.'), 'drive', 429, 'Failed to refresh Google Drive connection. Please reconnect.');
    // A string `error` names no rate limit, whatever it says.
    expectRefused(providerFailure('gmail', 403, JSON.stringify({ error: 'RESOURCE_EXHAUSTED' }), 'Failed to refresh access token'), 'Failed to refresh access token');
  });

  it('[POF-11] non-JSON, empty, null and oddly shaped bodies are handled: the status alone decides', () => {
    const odd = [
      null,
      '',
      '   ',
      '<html><body>403 Forbidden</body></html>',
      'not json {',
      'null',
      '42',
      '"a string"',
      '[]',
      JSON.stringify({ error: null }),
      JSON.stringify({ error: [] }),
      JSON.stringify({ error: { errors: 'rateLimitExceeded' } }),
      JSON.stringify({ error: { errors: [null, 7, 'rateLimitExceeded', { reason: 42 }] } }),
      JSON.stringify({ error: { status: 42 } }),
    ];
    for (const body of odd) {
      expectRefused(providerFailure('drive', 403, body, 'Drive rename failed: 403'), 'Drive rename failed: 403');
      expectRefused(providerFailure('drive', 409, body, 'Drive rename failed: 409'), 'Drive rename failed: 409');
      expectUnavailable(providerFailure('drive', 502, body, 'Drive rename failed: 502'), 'drive', 502, 'Drive rename failed: 502');
    }
    // An oversized body is not parsed: a 403 that only an oversized body would mark as a rate limit stays 400.
    const huge = JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', padding: 'x'.repeat(200_000) } });
    expectRefused(providerFailure('drive', 403, huge, 'Drive rename failed: 403'), 'Drive rename failed: 403');
  });

  it('[POF-12] the body never appears in the message or anywhere in the response, for either answer', () => {
    const CANARY = 'k-canary-body-text-7f3a';
    const bodies = [
      googleError(503, CANARY, [CANARY]),
      JSON.stringify({ error: { code: 403, message: CANARY, status: 'RESOURCE_EXHAUSTED' } }),
      JSON.stringify({ error: { code: 400, message: CANARY, status: 'INVALID_ARGUMENT' } }),
      `${CANARY} plain text`,
    ];
    for (const [status, body] of [[503, bodies[0]], [403, bodies[1]], [400, bodies[2]], [500, bodies[3]], [404, bodies[3]]] as const) {
      const err = providerFailure('gmail', status, body, 'Failed to send email');
      expect(err.message).toBe('Failed to send email');
      expect(JSON.stringify(err.getResponse())).not.toContain(CANARY);
    }
  });

  it('[POF-13] the service is an open union: a later client names its own service', () => {
    expectUnavailable(providerFailure('calendar', 503, null, 'Calendar list failed'), 'calendar', 503, 'Calendar list failed');
  });

  it('[POF-14] isTransientProviderFailure is the same table, as a predicate', () => {
    expect(isTransientProviderFailure(500, null)).toBe(true);
    expect(isTransientProviderFailure(408, null)).toBe(true);
    expect(isTransientProviderFailure(429, null)).toBe(true);
    expect(isTransientProviderFailure(403, googleError(403, 'PERMISSION_DENIED', ['rateLimitExceeded']))).toBe(true);
    expect(isTransientProviderFailure(409, googleError(409, 'ABORTED'))).toBe(true);
    expect(isTransientProviderFailure(400, null)).toBe(false);
    expect(isTransientProviderFailure(403, googleError(403, 'PERMISSION_DENIED', ['insufficientPermissions']))).toBe(false);
    expect(isTransientProviderFailure(409, googleError(409, 'ALREADY_EXISTS'))).toBe(false);
    expect(isTransientProviderFailure(404, googleError(404, 'ABORTED'))).toBe(false);
  });

  it('[POF-15] readProviderFailureBody reads a failed answer\'s text once, and answers null when there is none or it cannot be read', async () => {
    expect(await readProviderFailureBody(new Response('{"error":{"status":"ABORTED"}}', { status: 409 }))).toBe('{"error":{"status":"ABORTED"}}');
    expect(await readProviderFailureBody(new Response(null, { status: 503 }))).toBe('');
    expect(await readProviderFailureBody({ status: 500 } as any)).toBeNull();
    expect(await readProviderFailureBody({ status: 500, text: async () => { throw new Error('socket hang up'); } } as any)).toBeNull();
    expect(await readProviderFailureBody(null as any)).toBeNull();
  });
  // ---- W11-PROVIDER-OUTAGE-CONNECT: the Graph rows and the new service ids ----

  it.each(['outlook_contacts', 'microsoft'])('[POF-16] Graph (%s): 5xx, 408 and 429 give 503 provider_unavailable; the body plays no part', (service) => {
    for (const status of [500, 502, 503, 504, 599, 408, 429]) {
      expectUnavailable(providerFailure(service, status, JSON.stringify({ error: { code: 'serviceNotAvailable', message: 'graph' } }), `Graph API error ${status}`), service, status, `Graph API error ${status}`);
      expectUnavailable(providerFailure(service, status, null, `Graph API error ${status}`), service, status, `Graph API error ${status}`);
    }
  });

  it.each(['outlook_contacts', 'microsoft'])('[POF-17] Graph (%s) has no Google reason or status field: every other 4xx stays 400, a Google-shaped rate-limit 403 or ABORTED 409 body included', (service) => {
    const graph = (code: string) => JSON.stringify({ error: { code, message: `graph says ${code}` } });
    for (const [status, body] of [
      [400, graph('BadRequest')],
      [401, JSON.stringify({ error: 'invalid_grant', error_description: 'AADSTS70008: expired' })],
      [403, graph('ErrorAccessDenied')],
      [404, graph('ErrorItemNotFound')],
      [409, graph('ErrorIrresolvableConflict')],
      [410, graph('SyncStateNotFound')],
      [403, googleError(403, 'PERMISSION_DENIED', ['rateLimitExceeded'])],
      [403, JSON.stringify({ error: { code: 403, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } })],
      [409, googleError(409, 'ABORTED')],
    ] as Array<[number, string]>) {
      expectRefused(providerFailure(service, status, body, `Graph API error ${status}`), `Graph API error ${status}`);
    }
  });

  it('[POF-18] isTransientProviderFailure takes the service: a Graph service ignores the Google markers, a Google one (or none) reads them', () => {
    const rateLimited403 = googleError(403, 'PERMISSION_DENIED', ['userRateLimitExceeded']);
    const aborted409 = googleError(409, 'ABORTED');
    for (const service of ['outlook_contacts', 'microsoft']) {
      expect(isTransientProviderFailure(403, rateLimited403, service)).toBe(false);
      expect(isTransientProviderFailure(409, aborted409, service)).toBe(false);
      expect(isTransientProviderFailure(503, null, service)).toBe(true);
      expect(isTransientProviderFailure(408, null, service)).toBe(true);
      expect(isTransientProviderFailure(429, null, service)).toBe(true);
      expect(isTransientProviderFailure(400, null, service)).toBe(false);
    }
    for (const service of ['gmail', 'drive', 'google_contacts', 'google_forms', 'google_business_profile', 'google_calendar', undefined]) {
      expect(isTransientProviderFailure(403, rateLimited403, service)).toBe(true);
      expect(isTransientProviderFailure(409, aborted409, service)).toBe(true);
    }
  });

  it('[POF-19] providerUnavailable builds the same 503 an outage gets, for a status the table would call a refusal (the 410 "please retry")', () => {
    expectUnavailable(providerUnavailable('google_contacts', 410, 'Sync token expired; please retry'), 'google_contacts', 410, 'Sync token expired; please retry');
    expectUnavailable(providerUnavailable('outlook_contacts', 410, 'Outlook delta token expired; please retry'), 'outlook_contacts', 410, 'Outlook delta token expired; please retry');
    expect(providerUnavailable('drive', 503, 'Failed to list Google Drive files').getResponse())
      .toEqual(providerFailure('drive', 503, null, 'Failed to list Google Drive files').getResponse());
  });

  it.each(['google_contacts', 'google_forms', 'google_business_profile', 'google_calendar'])('[POF-20] the Google service id %s keeps the Google table', (service) => {
    expectUnavailable(providerFailure(service, 503, null, 'm'), service, 503, 'm');
    expectUnavailable(providerFailure(service, 429, null, 'm'), service, 429, 'm');
    expectUnavailable(providerFailure(service, 403, googleError(403, 'PERMISSION_DENIED', ['rateLimitExceeded']), 'm'), service, 403, 'm');
    expectUnavailable(providerFailure(service, 409, googleError(409, 'ABORTED'), 'm'), service, 409, 'm');
    expectRefused(providerFailure(service, 403, googleError(403, 'PERMISSION_DENIED', ['insufficientPermissions']), 'm'), 'm');
    expectRefused(providerFailure(service, 404, googleError(404, 'NOT_FOUND'), 'm'), 'm');
    expectRefused(providerFailure(service, 400, JSON.stringify({ error: 'invalid_grant' }), 'm'), 'm');
  });
});
