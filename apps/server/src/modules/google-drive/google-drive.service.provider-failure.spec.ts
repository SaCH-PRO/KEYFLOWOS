/**
 * W11-PROVIDER-OUTAGE-503 (R-5 part 1; W10-DISPATCH-STATUS review CR-W10DS-1):
 * GoogleDriveService's provider failures (pure: a fake Prisma client and a
 * stubbed fetch, no database, no network). The real-database proof over HTTP
 * is test/provider-outage-503.integration.test.ts.
 *
 * Every `if (!res.ok)` site that answers a Drive, Docs export, upload, Sheets
 * or token-endpoint failure now throws providerFailure('drive', status, body,
 * <its existing message>): an outage (5xx, 408, 429, a rate-limited 403, an
 * ABORTED 409) is 503 { code: 'provider_unavailable', service: 'drive',
 * message, upstreamStatus }; a refusal keeps its existing 400 and message (an
 * ALREADY_EXISTS 409 included).
 *
 * Unchanged, and pinned here: 'Google Drive not connected' and 'Google OAuth
 * not configured' (still 400: aligning them with Gmail's 503
 * provider_not_configured is a separate decision); the connect site
 * (saveDriveCredentials stays 400 whatever Google answers); a fetch that
 * throws (its error propagates).
 *
 * RED-BEFORE (int/v1-base at 15ca8599): every outage case fails (each site
 * answered BadRequestException); the refusal and unchanged cases pass.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { GoogleDriveService } from './google-drive.service';

const BIZ = 'biz_drive_pof';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GDOC_MIME = 'application/vnd.google-apps.document';
// Built at runtime: no secret-shaped literal in the fixture.
const ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: ['unit', 'pof', 'drive', 'client'].join('-'),
  GOOGLE_CLIENT_SECRET: ['unit', 'pof', 'drive', 'value'].join('-'),
  GOOGLE_STATE_SECRET: ['unit', 'pof', 'drive', 'state'].join('-'),
  DRIVE_REDIRECT_URI: 'http://localhost:3001/api/drive/callback',
};
const saved: Record<string, string | undefined> = {};

function googleError(code: number, status: string, reasons: string[] = []) {
  return JSON.stringify({ error: { code, message: `upstream ${status}`, status, errors: reasons.map((reason) => ({ reason })) } });
}

/** A fake Prisma client whose business row holds a Drive connection (live or expired token). */
function fakePrisma(opts: { expired?: boolean; connected?: boolean } = {}) {
  const writes: unknown[] = [];
  const connected = opts.connected !== false;
  const client: any = {
    business: {
      findUnique: async () => ({
        name: 'POF Drive Biz',
        driveAccessToken: connected ? 'drive_acc_live' : null,
        driveRefreshToken: connected ? 'drive_ref_1' : null,
        driveTokenExpiry: new Date(Date.now() + (opts.expired ? -1 : 1) * 60 * 60 * 1000),
        inventoryLinkedSheetId: 'sheet_1',
      }),
      update: async (args: unknown) => { writes.push(args); return {}; },
    },
  };
  return { prisma: { client } as any, writes };
}

let fetched: Array<{ url: string; method: string }> = [];

/**
 * fetch: a request `fail` matches answers `status` with `body`. Anything else
 * answers a success: the file metadata read (GET .../files/f1?fields=...)
 * answers a file of `mimeType`, so a site whose first call reads it reaches
 * the failing call.
 */
function stubDrive(fail: (url: string, method: string) => boolean, status: number, body: string, mimeType = 'text/plain') {
  vi.stubGlobal('fetch', async (input: any, init?: any) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    fetched.push({ url, method });
    if (fail(url, method)) return new Response(body, { status, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'drive_acc_new', expires_in: 3600 }), { status: 200 });
    }
    if (method === 'GET' && url.includes('/drive/v3/files/f1?fields=')) {
      return new Response(JSON.stringify({ id: 'f1', name: 'f1.txt', mimeType }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'ok', files: [], values: [] }), { status: 200 });
  });
}

function service(opts: { expired?: boolean; connected?: boolean } = {}) {
  const { prisma, writes } = fakePrisma(opts);
  return { drive: new GoogleDriveService(prisma) as any, writes };
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
    service: 'drive',
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

const isMeta = (url: string, method: string) => method === 'GET' && url.includes('/drive/v3/files/f1?fields=');
const DOC = { title: 'Plan', sections: [{ sectionName: 'One', content: 'text' }], documentType: 'plan', category: 'ops', version: 1 };

/** Every Drive, Docs, upload and Sheets site: what it fails on, how to reach it, its existing message, the file type its metadata read answers. */
const SITES: Array<{
  name: string;
  fail: (url: string, method: string) => boolean;
  call: (d: any) => Promise<unknown>;
  message: (status: number, body: string) => string;
  mimeType?: string;
}> = [
  { name: 'listFiles', fail: (u) => u.includes('/drive/v3/files?'), call: (d) => d.listFiles(BIZ, {}), message: () => 'Failed to list Google Drive files' },
  { name: 'getFile', fail: isMeta, call: (d) => d.getFile(BIZ, 'f1'), message: () => 'Failed to get file details' },
  { name: 'renameFile', fail: (u, m) => m === 'PATCH' && u.includes('/drive/v3/files/f1?'), call: (d) => d.renameFile(BIZ, 'f1', 'New'), message: (s) => `Drive rename failed: ${s}` },
  { name: 'moveFile', fail: (u, m) => m === 'PATCH' && u.includes('addParents='), call: (d) => d.moveFile(BIZ, 'f1', ['p2'], ['p1']), message: (s) => `Drive move failed: ${s}` },
  { name: 'trashFile', fail: (u, m) => m === 'PATCH' && u.endsWith('/drive/v3/files/f1'), call: (d) => d.trashFile(BIZ, 'f1'), message: (s) => `Drive trash failed: ${s}` },
  { name: 'untrashFile', fail: (u, m) => m === 'PATCH' && u.endsWith('/drive/v3/files/f1'), call: (d) => d.untrashFile(BIZ, 'f1'), message: (s) => `Drive untrash failed: ${s}` },
  { name: 'deleteFile', fail: (_u, m) => m === 'DELETE', call: (d) => d.deleteFile(BIZ, 'f1'), message: (s) => `Drive delete failed: ${s}` },
  // The share site's message already carried the upstream text before this packet; it is kept as it was.
  { name: 'shareFile', fail: (u) => u.includes('/permissions'), call: (d) => d.shareFile(BIZ, 'f1', { type: 'anyone', role: 'reader' }), message: (s, b) => `Drive share failed: ${s} ${b}` },
  { name: 'createDoc', fail: (u, m) => m === 'POST' && u === 'https://www.googleapis.com/drive/v3/files', call: (d) => d.createDoc(BIZ, 'Doc'), message: (s) => `Drive createDoc failed: ${s}` },
  { name: 'createSheet', fail: (u, m) => m === 'POST' && u === 'https://www.googleapis.com/drive/v3/files', call: (d) => d.createSheet(BIZ, 'Sheet'), message: (s) => `Drive createSheet failed: ${s}` },
  { name: 'createFolder', fail: (u, m) => m === 'POST' && u === 'https://www.googleapis.com/drive/v3/files', call: (d) => d.createFolder(BIZ, 'Folder'), message: (s) => `Drive createFolder failed: ${s}` },
  { name: 'findOrCreateFolder (search)', fail: (u) => u.includes('/drive/v3/files?q='), call: (d) => d.findOrCreateFolder(BIZ, 'Revenue'), message: (s) => `Drive folder search failed: ${s}` },
  { name: 'uploadFileToDrive', fail: (u) => u.includes('/upload/drive/v3/files?uploadType=multipart'), call: (d) => d.uploadFileToDrive(BIZ, 'a.pdf', 'application/pdf', Buffer.from('pdf')), message: () => 'Failed to upload file to Google Drive' },
  { name: 'saveHtmlDocumentToDrive', fail: (u) => u.includes('/upload/drive/v3/files?uploadType=multipart'), call: (d) => d.saveHtmlDocumentToDrive(BIZ, 'a', '<p>x</p>'), message: () => 'Failed to save document to Google Drive' },
  { name: 'saveDocumentToDrive', fail: (u) => u.includes('/upload/drive/v3/files?uploadType=multipart'), call: (d) => d.saveDocumentToDrive(BIZ, DOC), message: () => 'Failed to save document to Google Drive' },
  { name: 'downloadBinary', fail: (u) => u.includes('alt=media'), call: (d) => d.downloadBinary(BIZ, 'f1'), message: () => 'Failed to download file from Drive', mimeType: 'application/pdf' },
  { name: 'getFileContent (Google Doc export)', fail: (u) => u.includes('/export?'), call: (d) => d.getFileContent(BIZ, 'f1'), message: () => 'Failed to load Google Doc contents', mimeType: GDOC_MIME },
  { name: 'getFileContent (text download)', fail: (u) => u.includes('alt=media'), call: (d) => d.getFileContent(BIZ, 'f1'), message: () => 'Failed to download Drive file', mimeType: 'text/html' },
  { name: 'getFileContent (Word download)', fail: (u) => u.includes('alt=media'), call: (d) => d.getFileContent(BIZ, 'f1'), message: () => 'Failed to download Word document', mimeType: DOCX_MIME },
  { name: 'updateFileContent (Word upgrade)', fail: (u) => u.includes('/upload/drive/v3/files/f1?uploadType=multipart'), call: (d) => d.updateFileContent(BIZ, 'f1', '<p>x</p>'), message: () => 'Failed to save Word document changes back to Google Drive', mimeType: DOCX_MIME },
  { name: 'updateFileContent (save back)', fail: (u) => u.includes('/upload/drive/v3/files/f1?uploadType=media'), call: (d) => d.updateFileContent(BIZ, 'f1', '<p>x</p>'), message: () => 'Failed to save changes back to Google Drive', mimeType: GDOC_MIME },
  { name: 'createInventorySheet', fail: (u, m) => m === 'POST' && u.includes('/drive/v3/files?fields='), call: (d) => d.createInventorySheet(BIZ, 'Inventory'), message: () => 'Failed to create Google Sheet — check Drive permissions' },
  { name: 'writeSheetValues', fail: (u, m) => m === 'PUT' && u.includes('sheets.googleapis.com'), call: (d) => d.writeSheetValues('acc', 'sheet_1', 'Sheet1', 'A1', [['SKU']]), message: () => 'Failed to write to Google Sheet — check permissions and sheet access' },
  { name: 'readSheetValues', fail: (u, m) => m === 'GET' && u.includes('sheets.googleapis.com'), call: (d) => d.readSheetValues('acc', 'sheet_1', 'Sheet1'), message: () => 'Failed to read from Google Sheet — check sheet ID and permissions' },
];

const OUTAGES: Array<[string, number, string]> = [
  ['500 backendError', 500, googleError(500, 'INTERNAL', ['backendError'])],
  ['503 (non-JSON body)', 503, 'Service Unavailable'],
  ['429 rateLimitExceeded', 429, googleError(429, 'RESOURCE_EXHAUSTED', ['rateLimitExceeded'])],
  ['403 rateLimitExceeded', 403, googleError(403, 'PERMISSION_DENIED', ['rateLimitExceeded'])],
  ['409 ABORTED', 409, googleError(409, 'ABORTED')],
];
const REFUSALS: Array<[string, number, string]> = [
  ['400 invalid', 400, googleError(400, 'INVALID_ARGUMENT', ['invalid'])],
  ['404 notFound', 404, googleError(404, 'NOT_FOUND', ['notFound'])],
  ['403 insufficientPermissions', 403, googleError(403, 'PERMISSION_DENIED', ['insufficientPermissions'])],
  ['409 ALREADY_EXISTS', 409, googleError(409, 'ALREADY_EXISTS', ['duplicate'])],
];

describe('GoogleDriveService — a Drive outage is 503 provider_unavailable, a refusal stays 400 (W11-PROVIDER-OUTAGE-503)', () => {
  describe('provider failures', () => {
    for (const site of SITES) {
      it(`[DPF-01] RED-BEFORE: ${site.name}: an outage (500, 503, 429, a rate-limited 403, an ABORTED 409) is 503 provider_unavailable with its existing message`, async () => {
        for (const [label, status, body] of OUTAGES) {
          stubDrive(site.fail, status, body, site.mimeType);
          const err = await failureOf(site.call(service().drive));
          expect(err, label).toBeInstanceOf(ServiceUnavailableException);
          expectUnavailable(err, site.message(status, body), status);
        }
      });

      it(`[DPF-02] ${site.name}: a refusal (400, 404, 403 insufficientPermissions, 409 ALREADY_EXISTS) keeps its existing 400 and message`, async () => {
        for (const [label, status, body] of REFUSALS) {
          stubDrive(site.fail, status, body, site.mimeType);
          const err = await failureOf(site.call(service().drive));
          expect(err, label).toBeInstanceOf(BadRequestException);
          expectRefused(err, site.message(status, body));
        }
      });
    }

    it('[DPF-03] RED-BEFORE: the token refresh: 400 invalid_grant stays 400 "Failed to refresh Google Drive connection. Please reconnect."; a 5xx or 429 is 503 provider_unavailable with that message; no token is written either way', async () => {
      const MESSAGE = 'Failed to refresh Google Drive connection. Please reconnect.';
      const isToken = (u: string) => u.startsWith('https://oauth2.googleapis.com/token');

      stubDrive(isToken, 400, JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }));
      let s = service({ expired: true });
      expectRefused(await failureOf(s.drive.listFiles(BIZ, {})), MESSAGE);
      expect(s.writes).toEqual([]);

      for (const status of [500, 503, 429]) {
        stubDrive(isToken, status, '');
        s = service({ expired: true });
        expectUnavailable(await failureOf(s.drive.listFiles(BIZ, {})), MESSAGE, status);
        expect(s.writes).toEqual([]);
      }
      // The list was never asked for: the refresh failed first.
      expect(fetched.every((f) => isToken(f.url))).toBe(true);
    });

    it('[DPF-04] a delete Drive answers 204 is still a success', async () => {
      vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
      await expect(service().drive.deleteFile(BIZ, 'f1')).resolves.toBeUndefined();
    });
  });

  describe('unchanged', () => {
    it('[DPF-05] "Google Drive not connected" (no connection) is still 400, with no Google call', async () => {
      stubDrive(() => true, 503, '');
      expectRefused(await failureOf(service({ connected: false }).drive.listFiles(BIZ, {})), 'Google Drive not connected');
      expect(fetched).toEqual([]);
    });

    it('[DPF-06] "Google OAuth not configured" (an expired token and no OAuth client) is still 400, with no Google call', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      stubDrive(() => true, 503, '');
      expectRefused(await failureOf(service({ expired: true }).drive.listFiles(BIZ, {})), 'Google OAuth not configured');
      expect(fetched).toEqual([]);
    });

    it('[DPF-07] the connect site is unchanged: a Google outage on the code exchange stays 400 "Failed to connect Google Drive"', async () => {
      stubDrive((u) => u.startsWith('https://oauth2.googleapis.com/token'), 503, '');
      expectRefused(await failureOf(service().drive.saveDriveCredentials(BIZ, 'a-code')), 'Failed to connect Google Drive');
    });

    it('[DPF-08] a fetch that throws (a network failure) is unchanged: its error propagates as it was', async () => {
      const network = new TypeError('fetch failed');
      vi.stubGlobal('fetch', async () => { throw network; });
      expect(await failureOf(service().drive.listFiles(BIZ, {}))).toBe(network);
    });

    it('[DPF-09] the upstream body is never in the message of a site whose message did not carry it', async () => {
      const CANARY = 'dpf-canary-upstream-body';
      for (const status of [503, 404]) {
        stubDrive((u) => u.includes('/drive/v3/files?'), status, googleError(status, CANARY, [CANARY]));
        const err = await failureOf(service().drive.listFiles(BIZ, {}));
        expect(err.message).toBe('Failed to list Google Drive files');
        expect(JSON.stringify(err.getResponse())).not.toContain(CANARY);
      }
    });
  });
});
