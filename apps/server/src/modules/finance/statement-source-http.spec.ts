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
