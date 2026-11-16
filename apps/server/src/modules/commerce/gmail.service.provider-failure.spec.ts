/**
 * W11-PROVIDER-OUTAGE-503 (R-5 part 1; W10-DISPATCH-STATUS review CR-W10DS-1):
 * GmailService's provider failures (pure: a fake Prisma client and a stubbed
 * fetch, no database, no network). The real-database proof over HTTP is
 * test/optional-services-fail-visibly.integration.test.ts (send-email) and
 * test/provider-outage-503.integration.test.ts (the statement sweep and the
 * token refresh).
 *
 * Every `if (!res.ok)` site that answers a Gmail API (or Google token
 * endpoint) failure now throws providerFailure('gmail', status, body, <its
 * existing message>): a Gmail outage (5xx, 408, 429, a rate-limited 403, an
 * ABORTED 409) is 503 { code: 'provider_unavailable', service: 'gmail',
 * message, upstreamStatus }; a refusal keeps its existing 400 and message.
 *
 * Unchanged, and pinned here: gmailNotConfigured (503 provider_not_configured);
 * the OAuth consent and connect sites (exchangeCodeForTokens, getUserInfo stay
 * 400 whatever Google answers); a fetch that throws (its error propagates).
 *
 * Why a file of its own: gmail.service.spec.ts is bound by the Release 0
 * manifest gmail-connect-binding.json with allowAdditionalCases false, so a
 * new case there would be an unexpected case of that manifest (a manifest
 * change outside the approved Release 0 register).
 *
 * RED-BEFORE (int/v1-base at 15ca8599): every outage case fails (each site
 * answered BadRequestException); the refusal and unchanged cases pass.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { GmailService } from './gmail.service';

const BIZ = 'biz_gmail_pof';
// Built at runtime: no secret-shaped literal in the fixture.
const ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: ['unit', 'pof', 'client', 'id'].join('-'),
  GOOGLE_CLIENT_SECRET: ['unit', 'pof', 'oauth', 'value'].join('-'),
  GMAIL_REDIRECT_URI: 'http://localhost:3001/api/commerce/gmail/callback',
  GOOGLE_STATE_SECRET: ['unit', 'pof', 'state', 'value'].join('-'),
};
const saved: Record<string, string | undefined> = {};

/** A Google API error body, as googleapis.com answers it. */
function googleError(code: number, status: string, reasons: string[] = []) {
  return JSON.stringify({ error: { code, message: `upstream ${status}`, status, errors: reasons.map((reason) => ({ reason })) } });
}

/** A fake Prisma client whose business row is a Gmail connection (live or expired token). */
function fakePrisma(opts: { expired?: boolean; connected?: boolean } = {}) {
  const writes: unknown[] = [];
  const connected = opts.connected !== false;
  const client: any = {
    business: {
      findUnique: async () => ({
        name: 'POF Biz',
        gmailEmail: connected ? 'mailbox@gmail.test' : null,
        gmailAccessToken: connected ? 'acc_live' : null,
        gmailRefreshToken: connected ? 'ref_1' : null,
        gmailTokenExpiry: new Date(Date.now() + (opts.expired ? -1 : 1) * 60 * 60 * 1000),
      }),
      update: async (args: unknown) => { writes.push(args); return {}; },
      updateMany: async (args: unknown) => { writes.push(args); return { count: 1 }; },
    },
    $transaction: async (fn: (tx: any) => Promise<unknown>) => { writes.push('$transaction'); return fn(client); },
    $queryRaw: async () => [],
  };
  return { prisma: { client } as any, writes };
}

/** Every URL the service fetched. */
let fetched: string[] = [];

/**
 * fetch: a URL `fail` matches answers `status` with `body`; any other Gmail
 * URL answers a plausible success (so a site whose first call succeeds reaches
 * the failing one).
 */
function stubGmail(fail: (url: string) => boolean, status: number, body: string) {
  vi.stubGlobal('fetch', async (input: any) => {
    const url = String(input);
    fetched.push(url);
    if (fail(url)) return new Response(body, { status, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'acc_new', expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'm1', threadId: 't1', messages: [], labels: [], data: '' }), { status: 200 });
  });
}

function service(opts: { expired?: boolean; connected?: boolean } = {}) {
  const { prisma, writes } = fakePrisma(opts);
  return { gmail: new GmailService(prisma) as any, writes };
}

async function failureOf(p: Promise<unknown>): Promise<any> {
  return p.then(() => {
    throw new Error('expected the call to fail');
  }, (e) => e);
}

function expectUnavailable(err: any, message: string, upstreamStatus: number) {
  expect(err).toBeInstanceOf(ServiceUnavailableException);
  expect(err.getStatus()).toBe(503);
  expect(err.getResponse()).toEqual({
    code: 'provider_unavailable',
    service: 'gmail',
    message,
    upstreamStatus,
    error: 'Service Unavailable',
  });
}

function expectRefused(err: any, message: string) {
  expect(err).toBeInstanceOf(BadRequestException);
  expect(err).not.toBeInstanceOf(ServiceUnavailableException);
  expect(err.getStatus()).toBe(400);
  expect(err.message).toBe(message);
}

beforeEach(() => {
  for (const key of Object.keys(ENV)) saved[key] = process.env[key];
  Object.assign(process.env, ENV);
  fetched = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(ENV)) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const SEND = { businessId: BIZ, to: 'customer@test.local', subject: 'Invoice', htmlBody: '<p>hi</p>' };
const REPLY = { ...SEND, threadId: 't1', inReplyTo: '<m0@mail.test>' };

/** Every Gmail API site: the URL it fails on, how to reach it, and its existing message. */
const SITES: Array<{ name: string; fail: (url: string) => boolean; call: (g: any) => Promise<unknown>; message: (status: number) => string }> = [
  { name: 'listThreads', fail: (u) => u.includes('/users/me/threads?'), call: (g) => g.listThreads(BIZ, {}), message: (s) => `Gmail API error ${s}` },
  { name: 'getThread', fail: (u) => u.includes('/users/me/threads/t1'), call: (g) => g.getThread(BIZ, 't1'), message: (s) => `Gmail API error ${s}` },
  { name: 'modifyMessageLabels (markRead)', fail: (u) => u.endsWith('/messages/m1/modify'), call: (g) => g.markRead(BIZ, 'm1'), message: (s) => `Gmail API error ${s}` },
  { name: 'trash', fail: (u) => u.endsWith('/messages/m1/trash'), call: (g) => g.trash(BIZ, 'm1'), message: (s) => `Gmail API error ${s}` },
  { name: 'untrash', fail: (u) => u.endsWith('/messages/m1/untrash'), call: (g) => g.untrash(BIZ, 'm1'), message: (s) => `Gmail API error ${s}` },
  { name: 'listLabels', fail: (u) => u.endsWith('/users/me/labels'), call: (g) => g.listLabels(BIZ), message: (s) => `Gmail API error ${s}` },
  { name: 'sendEmail', fail: (u) => u.endsWith('/messages/send'), call: (g) => g.sendEmail(SEND), message: () => 'Failed to send email' },
  { name: 'sendReply', fail: (u) => u.endsWith('/messages/send'), call: (g) => g.sendReply(REPLY), message: () => 'Failed to send reply' },
  { name: 'searchMessages', fail: (u) => u.includes('/users/me/messages?'), call: (g) => g.searchMessages(BIZ, 'from:bank.test'), message: (s) => `Gmail search failed (${s})` },
  { name: 'getMessageWithAttachments', fail: (u) => u.includes('/messages/m1?format=full'), call: (g) => g.getMessageWithAttachments(BIZ, 'm1'), message: (s) => `Gmail message fetch failed (${s})` },
  { name: 'getAttachment', fail: (u) => u.includes('/messages/m1/attachments/a1'), call: (g) => g.getAttachment(BIZ, 'm1', 'a1'), message: (s) => `Gmail attachment fetch failed (${s})` },
];

const OUTAGES: Array<[string, number, string]> = [
  ['500 backendError', 500, googleError(500, 'INTERNAL', ['backendError'])],
  ['503 (non-JSON body)', 503, '<html>Service Unavailable</html>'],
  ['429 rateLimitExceeded', 429, googleError(429, 'RESOURCE_EXHAUSTED', ['rateLimitExceeded'])],
  ['403 userRateLimitExceeded', 403, googleError(403, 'PERMISSION_DENIED', ['userRateLimitExceeded'])],
];
const REFUSALS: Array<[string, number, string]> = [
  ['400 invalidArgument', 400, googleError(400, 'INVALID_ARGUMENT', ['invalidArgument'])],
  ['404 notFound', 404, googleError(404, 'NOT_FOUND', ['notFound'])],
  ['403 insufficientPermissions', 403, googleError(403, 'PERMISSION_DENIED', ['insufficientPermissions'])],
];

describe('GmailService — a Gmail outage is 503 provider_unavailable, a refusal stays 400 (W11-PROVIDER-OUTAGE-503)', () => {
  describe('provider failures', () => {
    it('[GPF-01] RED-BEFORE: sendEmail with Gmail answering 500 gives 503 provider_unavailable "Failed to send email"', async () => {
      stubGmail((u) => u.endsWith('/messages/send'), 500, googleError(500, 'INTERNAL', ['backendError']));
      const err = await failureOf(service().gmail.sendEmail(SEND));
      expectUnavailable(err, 'Failed to send email', 500);
    });

    it('[GPF-02] sendEmail with Gmail answering 400 gives the existing 400 "Failed to send email"', async () => {
      stubGmail((u) => u.endsWith('/messages/send'), 400, googleError(400, 'INVALID_ARGUMENT', ['invalidArgument']));
      const err = await failureOf(service().gmail.sendEmail(SEND));
      expectRefused(err, 'Failed to send email');
    });

    it('[GPF-03] refreshAccessToken with 400 invalid_grant (a revoked or expired grant: reconnect) gives the existing 400 "Failed to refresh access token"', async () => {
      stubGmail((u) => u.startsWith('https://oauth2.googleapis.com/token'), 400, JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }));
      const err = await failureOf(service().gmail.refreshAccessToken('ref_1'));
      expectRefused(err, 'Failed to refresh access token');
    });

    it('[GPF-04] RED-BEFORE: refreshAccessToken with 503 gives 503 provider_unavailable "Failed to refresh access token"; 429 too; 401 stays 400', async () => {
      stubGmail((u) => u.startsWith('https://oauth2.googleapis.com/token'), 503, 'Service Unavailable');
      expectUnavailable(await failureOf(service().gmail.refreshAccessToken('ref_1')), 'Failed to refresh access token', 503);

      stubGmail((u) => u.startsWith('https://oauth2.googleapis.com/token'), 429, '');
      expectUnavailable(await failureOf(service().gmail.refreshAccessToken('ref_1')), 'Failed to refresh access token', 429);

      stubGmail((u) => u.startsWith('https://oauth2.googleapis.com/token'), 401, JSON.stringify({ error: 'invalid_client' }));
      expectRefused(await failureOf(service().gmail.refreshAccessToken('ref_1')), 'Failed to refresh access token');
    });

    it('[GPF-05] RED-BEFORE: an expired token whose refresh meets an outage fails the send 503 before Gmail is asked, and writes no token', async () => {
      stubGmail((u) => u.startsWith('https://oauth2.googleapis.com/token'), 502, '');
      const { gmail, writes } = service({ expired: true });
      const err = await failureOf(gmail.sendEmail(SEND));
      expectUnavailable(err, 'Failed to refresh access token', 502);
      expect(writes).toEqual([]);
      expect(fetched).toEqual(['https://oauth2.googleapis.com/token']);
    });

    for (const site of SITES) {
      it(`[GPF-06] RED-BEFORE: ${site.name}: an outage (500, 503, 429, a rate-limited 403) is 503 provider_unavailable with its existing message`, async () => {
        for (const [label, status, body] of OUTAGES) {
          stubGmail(site.fail, status, body);
          const err = await failureOf(site.call(service().gmail));
          expect(err, label).toBeInstanceOf(ServiceUnavailableException);
          expectUnavailable(err, site.message(status), status);
        }
      });

      it(`[GPF-07] ${site.name}: a refusal (400, 404, 403 insufficientPermissions) keeps its existing 400 and message`, async () => {
        for (const [label, status, body] of REFUSALS) {
          stubGmail(site.fail, status, body);
          const err = await failureOf(site.call(service().gmail));
          expect(err, label).toBeInstanceOf(BadRequestException);
          expectRefused(err, site.message(status));
        }
      });
    }

    it('[GPF-08] the upstream body is never in the message or the response', async () => {
      const CANARY = 'gpf-canary-upstream-body';
      for (const status of [503, 400]) {
        stubGmail((u) => u.endsWith('/messages/send'), status, googleError(status, CANARY, [CANARY]));
        const err = await failureOf(service().gmail.sendEmail(SEND));
        expect(err.message).toBe('Failed to send email');
        expect(JSON.stringify(err.getResponse())).not.toContain(CANARY);
      }
    });
  });

  describe('unchanged', () => {
    it('[GPF-09] gmailNotConfigured is unchanged: no connection is 503 provider_not_configured "Gmail not connected", no Google call', async () => {
      stubGmail(() => true, 503, '');
      const err = await failureOf(service({ connected: false }).gmail.sendEmail(SEND));
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.getResponse()).toEqual({ code: 'provider_not_configured', service: 'gmail', message: 'Gmail not connected', error: 'Service Unavailable' });
      expect(fetched).toEqual([]);
    });

    it('[GPF-10] no Google OAuth client is still 503 provider_not_configured on refresh, with no Google call', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      stubGmail(() => true, 503, '');
      const err = await failureOf(service().gmail.refreshAccessToken('ref_1'));
      expect(err.getResponse()).toMatchObject({ code: 'provider_not_configured', service: 'gmail', message: 'Google OAuth not configured' });
      expect(fetched).toEqual([]);
    });

    it('[GPF-11] the OAuth consent and connect sites are unchanged: a Google outage on the code exchange or userinfo stays 400 with its message', async () => {
      stubGmail((u) => u.startsWith('https://oauth2.googleapis.com/token'), 503, '');
      expectRefused(await failureOf(service().gmail.exchangeCodeForTokens('a-code')), 'Failed to exchange authorization code');

      stubGmail((u) => u.startsWith('https://www.googleapis.com/oauth2/v2/userinfo'), 503, '');
      expectRefused(await failureOf(service().gmail.getUserInfo('acc')), 'Failed to get user info');
    });

    it('[GPF-12] a fetch that throws (a network failure) is unchanged: its error propagates as it was, not as provider_unavailable', async () => {
      const network = new TypeError('fetch failed');
      vi.stubGlobal('fetch', async () => { throw network; });
      const err = await failureOf(service().gmail.sendEmail(SEND));
      expect(err).toBe(network);
    });
  });
});
