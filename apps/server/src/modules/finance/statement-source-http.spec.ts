/**
 * What Google actually receives.
 *
 * Every earlier test of the sweep mocked GoogleDriveService and GmailService
 * themselves, so the only thing being checked was that the sweep called the
 * methods with the arguments the test author expected. Both sides of that were
 * written by the same person, so it could not disagree with itself.
 *
 * It was hiding a total failure. `listFiles`' `query` option is a FILENAME
 * SUBSTRING — it is wrapped in `name contains '...'` — and the sweep was
 * passing hand-built Drive syntax into it:
 *
 *     '<folderId>' in parents and trashed = false
 *
 * which Google received as a search for a file literally *named* that. It
 * matched nothing. Not an error, not an empty-folder edge case: the Drive
 * sweep could never have imported a single statement, and would have run every
 * night at 5am reporting success and zero files for as long as anyone left it
 * alone.
 *
 * So these tests stub `fetch` and let the REAL service code run. The assertion
 * is on the URL and body that leave the process, which is the only artefact
 * Google ever sees and the only one a mock cannot invent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { GoogleDriveService } from '../google-drive/google-drive.service';
import { GmailService } from '../commerce/gmail.service';
import { StatementSourceService } from './statement-source.service';

const OFX = `OFXHEADER:100
<OFX><STMTTRN>
<DTPOSTED>20260703
<TRNAMT>-100.00
<FITID>FIT-1
<NAME>SHOP
</STMTTRN></OFX>`;

/** Every URL the process asked for, in order. */
let calls: Array<{ url: string; init?: any }>;
let realFetch: typeof globalThis.fetch;

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer,
  } as any;
}

/** A prisma stand-in that hands back a connected Google account. */
function prismaWithConnection() {
  const account = {
    id: 'acc_A',
    businessId: 'biz_1',
    name: 'Republic',
    metadata: { statementSources: { driveFolderId: 'FOLDER_XYZ' } },
  };
  return {
    client: {
      financialAccount: {
        findMany: vi.fn(async () => [account]),
        findFirst: vi.fn(async () => account),
        update: vi.fn(async () => account),
      },
      // Both Google services read their tokens off the Business row itself
      // (google-drive.service.ts:227, gmail.service.ts:234). An expiry well in
      // the future keeps the refresh path out of these assertions — the token
      // handling has its own tests, and borrowing it unchanged is the whole
      // reason the sweep does not carry a second Google client.
      business: {
        findUnique: vi.fn(async () => ({
          driveAccessToken: 'ACCESS_TOKEN',
          driveRefreshToken: 'REFRESH',
          driveTokenExpiry: new Date(Date.now() + 3_600_000),
          gmailAccessToken: 'ACCESS_TOKEN',
          gmailRefreshToken: 'REFRESH',
          gmailTokenExpiry: new Date(Date.now() + 3_600_000),
        })),
        update: vi.fn(async () => ({})),
      },
    },
  } as any;
}

beforeEach(() => {
  calls = [];
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('the Drive query that actually leaves the process', () => {
  /** Runs a real sweepDrive with fetch stubbed, returns the Drive list URL. */
  async function sweepAndCaptureListUrl(lastSweptAt?: string) {
    const prisma = prismaWithConnection();
    if (lastSweptAt) {
      prisma.client.financialAccount.findMany = vi.fn(async () => [
        {
          id: 'acc_A', businessId: 'biz_1', name: 'Republic',
          metadata: { statementSources: { driveFolderId: 'FOLDER_XYZ', lastSweptAt } },
        },
      ]);
    }

    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.includes('/drive/v3/files?')) {
        return jsonResponse({ files: [{ id: 'f1', name: 'statement.ofx', mimeType: 'text/plain' }] });
      }
      if (u.includes('alt=media')) {
        return {
          ok: true, status: 200,
          arrayBuffer: async () => Buffer.from(OFX),
          text: async () => OFX,
          json: async () => ({}),
        } as any;
      }
      // getFile metadata lookup made by downloadBinary
      return jsonResponse({ id: 'f1', name: 'statement.ofx', mimeType: 'text/plain' });
    }) as any;

    const drive = new GoogleDriveService(prisma);
    const gmail = new GmailService(prisma) as any;
    const bankImport = {
      ingest: vi.fn(async () => ({
        accountId: 'acc_A', parsed: 1, inserted: 1, duplicates: 0, invalid: 0,
        errors: [], format: 'ofx', exactDedupe: true,
      })),
    } as any;

    const service = new StatementSourceService(prisma, drive, gmail, bankImport);
    await service.sweepDrive('biz_1', 'acc_A');

    const listCall = calls.find((c) => c.url.includes('/drive/v3/files?'));
    expect(listCall, 'the sweep never asked Drive for a file list').toBeTruthy();
    return decodeURIComponent(new URL(listCall!.url).searchParams.get('q') ?? '');
  }

  it("scopes to the folder with `in parents`, which is the only syntax Drive honours", async () => {
    const q = await sweepAndCaptureListUrl();

    expect(q, `Drive received q=${q}`).toContain("'FOLDER_XYZ' in parents");
  });

  it('never asks Drive for a FILENAME containing the folder id', async () => {
    // The original defect, stated as the thing it must never do again. This is
    // what `query: "'<folder>' in parents..."` produced, and it is silent.
    const q = await sweepAndCaptureListUrl();

    expect(q, `Drive received q=${q}`).not.toMatch(/name contains/);
  });

  it('excludes trashed files', async () => {
    const q = await sweepAndCaptureListUrl();
    expect(q).toContain('trashed = false');
  });

  it('asks only for what changed once the folder has been swept before', async () => {
    const q = await sweepAndCaptureListUrl('2026-08-01T00:00:00.000Z');

    expect(q).toContain("modifiedTime > '2026-08-01T00:00:00.000Z'");
  });

  it('sends the access token as a bearer header', async () => {
    await sweepAndCaptureListUrl();
    const listCall = calls.find((c) => c.url.includes('/drive/v3/files?'))!;
    expect(listCall.init?.headers?.Authorization).toBe('Bearer ACCESS_TOKEN');
  });
});

describe('the Gmail request that actually leaves the process', () => {
  async function sweepGmailAndCapture() {
    const account = {
      id: 'acc_B', businessId: 'biz_1', name: 'FCB',
      metadata: { statementSources: { gmailQuery: 'from:republicbank.com' } },
    };
    const prisma = prismaWithConnection();
    prisma.client.financialAccount.findMany = vi.fn(async () => [account]);
    prisma.client.financialAccount.findFirst = vi.fn(async () => account);

    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.includes('/messages?')) return jsonResponse({ messages: [{ id: 'm1', threadId: 't1' }] });
      if (u.includes('/attachments/')) {
        // base64url — Gmail uses - and _ rather than + and /
        return jsonResponse({ data: Buffer.from(OFX).toString('base64').replace(/\+/g, '-').replace(/\//g, '_') });
      }
      if (u.includes('/messages/')) {
        // An attachment nested two levels down, which is what a forwarded mail
        // with an inline signature image actually looks like.
        return jsonResponse({
          id: 'm1',
          internalDate: String(Date.parse('2026-08-01T00:00:00Z')),
          payload: {
            headers: [{ name: 'Subject', value: 'Statement' }, { name: 'From', value: 'bank@example.com' }],
            parts: [
              { mimeType: 'text/plain', body: { size: 10 } },
              {
                mimeType: 'multipart/mixed',
                parts: [
                  { mimeType: 'image/png', filename: 'sig.png', body: { attachmentId: 'att_sig', size: 100 } },
                  { mimeType: 'application/octet-stream', filename: 'july.ofx', body: { attachmentId: 'att_ofx', size: 200 } },
                ],
              },
            ],
          },
        });
      }
      return jsonResponse({});
    }) as any;

    const drive = new GoogleDriveService(prisma);
    const gmail = new GmailService(prisma) as any;
    const bankImport = {
      ingest: vi.fn(async () => ({
        accountId: 'acc_B', parsed: 1, inserted: 1, duplicates: 0, invalid: 0,
        errors: [], format: 'ofx', exactDedupe: true,
      })),
    } as any;

    const service = new StatementSourceService(prisma, drive, gmail, bankImport);
    const result = await service.sweepGmail('biz_1', 'acc_B');
    return { result, bankImport };
  }

  it('sends the configured query with an attachment and date bound attached', async () => {
    await sweepGmailAndCapture();

    const search = calls.find((c) => c.url.includes('/messages?'));
    expect(search, 'the sweep never searched Gmail').toBeTruthy();
    const q = new URL(search!.url).searchParams.get('q') ?? '';

    expect(q).toContain('from:republicbank.com');
    expect(q).toContain('has:attachment');
    // Without a bound, a first sweep walks a ten-year mailbox.
    expect(q).toMatch(/newer_than:\d+d/);
  });

  it('finds an attachment nested two levels deep, and ignores the signature image', async () => {
    // The recursive walk is the part most likely to be written wrong, and a
    // scan of payload.parts would find neither file here.
    const { bankImport } = await sweepGmailAndCapture();

    const fetched = calls.filter((c) => c.url.includes('/attachments/')).map((c) => c.url);
    expect(fetched.some((u) => u.includes('att_ofx')), 'the .ofx attachment was never fetched').toBe(true);

    // sig.png is walked and considered, but must not reach the importer.
    expect(bankImport.ingest).toHaveBeenCalledTimes(1);
    expect(bankImport.ingest.mock.calls[0][1]).toBe('acc_B');
  });

  it('decodes base64url, not plain base64', async () => {
    // Gmail returns - and _ where base64 has + and /. Decoding it as plain
    // base64 corrupts the bytes, and a corrupted OFX fails format detection —
    // so the file is silently "not a statement" rather than an error.
    const { bankImport } = await sweepGmailAndCapture();

    const content = bankImport.ingest.mock.calls[0][2] as string;
    expect(content).toContain('<FITID>FIT-1');
    expect(content).toContain('OFXHEADER');
  });
});

/**
 * W11-PROVIDER-OUTAGE-503 (R-5 part 1; W10-DISPATCH-STATUS review CR-W10DS-1).
 * The same fetch boundary, with Google answering an error. A Google outage is
 * not a refusal: the real GmailService and GoogleDriveService answer it 503
 * { code: 'provider_unavailable', service } (so KEY's plan queue keeps
 * retrying reconcile_sweep_statements), while a genuine refusal keeps its
 * existing 400 and message.
 *
 * RED-BEFORE (int/v1-base at 15ca8599): the outage cases reject with
 * BadRequestException('Gmail search failed (503)') and
 * BadRequestException('Failed to list Google Drive files'); the controls pass.
 */
describe('a Google outage during a sweep is 503 provider_unavailable; a refusal stays 400 (W11-PROVIDER-OUTAGE-503)', () => {
  function googleError(code: number, status: string, reasons: string[] = []) {
    return JSON.stringify({ error: { code, message: status, status, errors: reasons.map((reason) => ({ reason })) } });
  }

  /** fetch answers the Gmail search or the Drive list with `status`; anything else is a test failure. */
  function stubFailing(match: string, status: number, body: string) {
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.includes(match)) {
        return new Response(body, { status, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as any;
  }

  function services() {
    const account = {
      id: 'acc_A', businessId: 'biz_1', name: 'Republic',
      metadata: { statementSources: { driveFolderId: 'FOLDER_XYZ', gmailQuery: 'from:republicbank.com' } },
    };
    const prisma = prismaWithConnection();
    prisma.client.financialAccount.findMany = vi.fn(async () => [account]);
    prisma.client.financialAccount.findFirst = vi.fn(async () => account);
    const bankImport = { ingest: vi.fn() } as any;
    const service = new StatementSourceService(prisma, new GoogleDriveService(prisma), new GmailService(prisma) as any, bankImport);
    return { service, prisma, bankImport };
  }

  it('[SSH-503-01] RED-BEFORE: Gmail search answered 503 makes sweepGmail reject with 503 {code: provider_unavailable, service: gmail, message: "Gmail search failed (503)"}; nothing is imported or stamped', async () => {
    stubFailing('/gmail/v1/users/me/messages?', 503, googleError(503, 'UNAVAILABLE', ['backendError']));
    const { service, prisma, bankImport } = services();

    const err = await service.sweepGmail('biz_1', 'acc_A').then(() => null, (e) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toMatchObject({ code: 'provider_unavailable', service: 'gmail', message: 'Gmail search failed (503)', upstreamStatus: 503 });
    expect(bankImport.ingest).not.toHaveBeenCalled();
    expect(prisma.client.financialAccount.update).not.toHaveBeenCalled();
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/gmail/v1/users/me/messages']);
  });

  it('[SSH-503-02] RED-BEFORE: Drive list answered 429 makes sweepDrive reject with 503 {code: provider_unavailable, service: drive} and its existing message', async () => {
    stubFailing('/drive/v3/files?', 429, googleError(429, 'RESOURCE_EXHAUSTED', ['rateLimitExceeded']));
    const { service, prisma, bankImport } = services();

    const err = await service.sweepDrive('biz_1', 'acc_A').then(() => null, (e) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.getResponse()).toMatchObject({ code: 'provider_unavailable', service: 'drive', message: 'Failed to list Google Drive files', upstreamStatus: 429 });
    expect(bankImport.ingest).not.toHaveBeenCalled();
    expect(prisma.client.financialAccount.update).not.toHaveBeenCalled();
  });

  it('[SSH-503-03] RED-BEFORE: a Drive list 403 rateLimitExceeded is an outage too (503), a 403 insufficientPermissions is a refusal (400)', async () => {
    stubFailing('/drive/v3/files?', 403, googleError(403, 'PERMISSION_DENIED', ['userRateLimitExceeded']));
    const limited = await services().service.sweepDrive('biz_1', 'acc_A').then(() => null, (e) => e);
    expect(limited).toBeInstanceOf(ServiceUnavailableException);
    expect(limited.getResponse()).toMatchObject({ code: 'provider_unavailable', service: 'drive', upstreamStatus: 403 });

    stubFailing('/drive/v3/files?', 403, googleError(403, 'PERMISSION_DENIED', ['insufficientPermissions']));
    const refused = await services().service.sweepDrive('biz_1', 'acc_A').then(() => null, (e) => e);
    expect(refused).toBeInstanceOf(BadRequestException);
    expect(refused).not.toBeInstanceOf(ServiceUnavailableException);
    expect(refused.message).toBe('Failed to list Google Drive files');
  });

  it('[SSH-503-04] control: Gmail search answered 400 stays BadRequestException("Gmail search failed (400)")', async () => {
    stubFailing('/gmail/v1/users/me/messages?', 400, googleError(400, 'INVALID_ARGUMENT', ['invalidArgument']));
    const err = await services().service.sweepGmail('biz_1', 'acc_A').then(() => null, (e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err).not.toBeInstanceOf(ServiceUnavailableException);
    expect(err.getStatus()).toBe(400);
    expect(err.message).toBe('Gmail search failed (400)');
  });

  it('[SSH-503-05] control: Drive list answered 404 stays BadRequestException("Failed to list Google Drive files")', async () => {
    stubFailing('/drive/v3/files?', 404, googleError(404, 'NOT_FOUND', ['notFound']));
    const err = await services().service.sweepDrive('biz_1', 'acc_A').then(() => null, (e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err).not.toBeInstanceOf(ServiceUnavailableException);
    expect(err.message).toBe('Failed to list Google Drive files');
  });

  it('[SSH-503-06] RED-BEFORE: an outage on one message of a sweep is reported on the result, as any per-file failure is (the sweep goes on); the message names the outage', async () => {
    // Search answers, the message fetch is down: sweepGmail's per-message
    // catch records it on the result rather than rejecting the whole sweep.
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.includes('/messages?')) return jsonResponse({ messages: [{ id: 'm1', threadId: 't1' }] });
      if (u.includes('/messages/m1')) return new Response(googleError(502, 'UNAVAILABLE'), { status: 502 });
      throw new Error(`unexpected fetch ${u}`);
    }) as any;
    const { service, bankImport } = services();

    const result = await service.sweepGmail('biz_1', 'acc_A');

    expect(result.errors).toEqual(['message m1: Gmail message fetch failed (502)']);
    expect(bankImport.ingest).not.toHaveBeenCalled();
    // What the per-message catch saw was the outage, not a refusal.
    const gmail = new GmailService(prismaWithConnection()) as any;
    const err = await gmail.getMessageWithAttachments('biz_1', 'm1').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.getResponse()).toMatchObject({ code: 'provider_unavailable', service: 'gmail', message: 'Gmail message fetch failed (502)', upstreamStatus: 502 });
  });
});
