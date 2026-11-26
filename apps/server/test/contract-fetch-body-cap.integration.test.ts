/**
 * FU-DOC-FETCH-BODY-CAP (P111 / D-246): contract document fetches cap the body size, decompressed.
 *
 * ContractClauseService.resolveBytes previously read `res.arrayBuffer()` with no size cap. Because
 * WHATWG fetch automatically decompresses gzip/deflate/brotli, a public host serving a small
 * compressed body (or a large/chunked stream) could expand to gigabytes in memory within the 30 s
 * fetch deadline.
 *
 *   BC-01  Declared Content-Length > 25 MB is rejected BEFORE reading the body; socket closes
 *          before body chunks are sent; final 400 names the limit, not the host.
 *   BC-02  Chunked transfer (no Content-Length) exceeding 25 MB (both 40 MiB stream and exact
 *          25 MiB + 1 byte boundary) is aborted mid-stream; socket closes early; final 400.
 *   BC-03  Real Content-Encoding: gzip bombs (streamed 60 MiB gzip bomb AND pre-compressed 40 MiB
 *          gzip bomb with tiny wire Content-Length) abort once decompressed bytes pass 25 MiB;
 *          socket closes early, parser never receives the inflated buffer; final 400.
 *   BC-04  Real Content-Encoding: br (brotli) bomb with tiny wire Content-Length AND a lying small
 *          Content-Length header whose body stream exceeds 25 MiB both abort at the cap; final 400.
 *   BC-05  The contract's own asset URL (contract.sourceAssetId) AND a public 302 redirect to a
 *          gzip bomb enforce the exact same 25 MB decompressed cap.
 *   BC-06  The refusal is final through FlowOrchestratorService + ActionDispatcherService: never
 *          remapped to 503, never retried, and counts 0 failures on the circuit breaker.
 *   BC-07  Positive controls & boundaries: exact 25 MiB succeeds, valid small gzipped document
 *          parses to decompressed text, valid plain URL & asset URL succeed, and non-public SSRF
 *          addresses stay refused with the outbound-address guard message.
 *
 * Exercises REAL ContractClauseService, REAL Node/undici fetch (real gzip & brotli decompression,
 * real AbortSignal, real TCP sockets), REAL local http.createServer, and REAL FlowOrchestratorService
 * + ActionDispatcherService, with an in-memory Prisma/parser/model double (no DB rows touched).
 */
import 'reflect-metadata';
import http from 'node:http';
import dns from 'node:dns';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { BadRequestException, HttpException, Logger, ServiceUnavailableException } from '@nestjs/common';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MiB (25 MB)
const TOO_LARGE_MESSAGE = 'The document exceeds the 25 MB limit';
const URL_REFUSED_MESSAGE = 'The document URL must be a public http or https address';
const PUBLIC_HOST = 'docs.cap-public.test';
const PUBLIC_ADDRESS = '203.0.113.42';
const TOOL = 'contract_extract_clauses';
const BIZ_ID = 'biz-doc-cap';
const OWNER_ID = 'user-doc-cap';
const CONTRACT_URL_ID = 'contract-url-cap';
const CONTRACT_ASSET_BOMB_ID = 'contract-asset-bomb-cap';
const CONTRACT_ASSET_VALID_ID = 'contract-asset-valid-cap';
const ASSET_BOMB_ID = 'asset-bomb-cap';
const ASSET_VALID_ID = 'asset-valid-cap';
const CLOSED_CIRCUIT = { open: false, failures: 0, lastFailure: null };

interface RouteStats {
  hits: number;
  bodyChunksSent: number;
  bytesSent: number;
  uncompressedChunksFed: number;
  closedEarly: boolean;
  finishedNormally: boolean;
}

const statsByPath = new Map<string, RouteStats>();
function getStats(pathname: string): RouteStats {
  let s = statsByPath.get(pathname);
  if (!s) {
    s = {
      hits: 0,
      bodyChunksSent: 0,
      bytesSent: 0,
      uncompressedChunksFed: 0,
      closedEarly: false,
      finishedNormally: false,
    };
    statsByPath.set(pathname, s);
  }
  return s;
}

const fetches: Array<{ url: string; dispatcher?: unknown }> = [];
const parsedPayloads: Array<{ byteLength: number; head: string }> = [];
let modelCalls = 0;
let customResponseOverride: ((pathname: string) => Response | null) | null = null;

let server: http.Server;
let port = 0;
let realFetch: typeof fetch;
let clauses: any;
let flow: any;
let makeDispatcher: () => any;
let PinnedDispatcherCtor: any;

let staticGzipBomb: Buffer;
let staticBrotliBomb: Buffer;
let validGzipDoc: Buffer;
const VALID_DOC_TEXT = 'Master Services Agreement between Acme Corp and Beta LLC. Governing Law: Delaware.';

function resetState() {
  statsByPath.clear();
  fetches.length = 0;
  parsedPayloads.length = 0;
  modelCalls = 0;
  customResponseOverride = null;
}

function expectBodyTooLarge(
  outcome: { ok: boolean; error?: unknown; value?: unknown },
  label: string,
) {
  expect(
    outcome.ok,
    `${label}: expected 400 refusal, got success ${JSON.stringify((outcome as any).value)}`,
  ).toBe(false);
  expect(outcome.error, `${label}: expected BadRequestException`).toBeInstanceOf(BadRequestException);
  expect(outcome.error, `${label}: must not be remapped to 503`).not.toBeInstanceOf(
    ServiceUnavailableException,
  );
  const err = outcome.error as HttpException;
  expect(err.getStatus(), label).toBe(400);
  expect(err.message, `${label}: message must name the 25 MB limit`).toBe(TOO_LARGE_MESSAGE);
  expect(err.message, `${label}: message must not leak the host`).not.toContain(PUBLIC_HOST);
  expect(err.message, `${label}: message must not leak loopback`).not.toContain('127.0.0.1');
  expect(err.cause, `${label}: refusal must be final (no outage cause)`).toBeUndefined();
}

function runExtract(args: { contractId: string; url?: string }) {
  return clauses
    .extractClauses(BIZ_ID, args.contractId, args.url ? { url: args.url } : {})
    .then(
      (value: unknown) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
}

function runTool(args: Record<string, unknown>) {
  return flow
    .executeToolDirectly(BIZ_ID, TOOL, args, undefined, {
      surface: 'CHAT',
      principalUserId: OWNER_ID,
    })
    .then(
      (value: unknown) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
}

async function waitForServerClose(pathname: string, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = statsByPath.get(pathname);
    if (s && (s.closedEarly || s.finishedNormally)) return;
    await new Promise((r) => setTimeout(r, 15));
  }
}

beforeAll(async () => {
  // Pre-build static compressed payloads once: ~40 KB gzip -> 40 MiB, ~100 B brotli -> 32 MiB.
  staticGzipBomb = zlib.gzipSync(Buffer.alloc(40 * 1024 * 1024, 0x41));
  staticBrotliBomb = zlib.brotliCompressSync(Buffer.alloc(32 * 1024 * 1024, 0x42), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 },
  });
  validGzipDoc = zlib.gzipSync(Buffer.from(VALID_DOC_TEXT, 'utf8'));

  // Start a real local HTTP server serving boundary, chunked, oversized Content-Length, and compressed bomb routes.
  server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    const stats = getStats(pathname);
    stats.hits += 1;

    let stopped = false;
    const markClose = () => {
      stopped = true;
      if (!res.writableEnded) {
        stats.closedEarly = true;
      }
    };
    res.on('close', markClose);
    res.on('finish', () => {
      stats.finishedNormally = true;
    });

    if (pathname === '/valid-plain') {
      const body = Buffer.from(VALID_DOC_TEXT, 'utf8');
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': String(body.length),
      });
      stats.bodyChunksSent += 1;
      stats.bytesSent += body.length;
      res.end(body);
      return;
    }

    if (pathname === '/valid-gzip') {
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-encoding': 'gzip',
        'content-length': String(validGzipDoc.length),
      });
      stats.bodyChunksSent += 1;
      stats.bytesSent += validGzipDoc.length;
      res.end(validGzipDoc);
      return;
    }

    if (pathname === '/exact-cap') {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-length': String(MAX_DOC_BYTES),
      });
      const chunkSize = 1024 * 1024;
      const chunk = Buffer.alloc(chunkSize, 0x41);
      let remaining = MAX_DOC_BYTES;
      const writeNext = () => {
        while (!stopped && remaining > 0) {
          const toWrite = remaining >= chunkSize ? chunk : chunk.subarray(0, remaining);
          remaining -= toWrite.length;
          stats.bodyChunksSent += 1;
          stats.bytesSent += toWrite.length;
          if (!res.write(toWrite)) {
            res.once('drain', writeNext);
            return;
          }
        }
        if (!stopped && remaining === 0) res.end();
      };
      writeNext();
      return;
    }

    if (pathname === '/over-content-length') {
      const declared = MAX_DOC_BYTES + 1;
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': String(declared),
      });
      res.flushHeaders();
      // Delay body transmission briefly so a client that rejects Content-Length up front closes the
      // socket before a single body byte is transmitted, while an uncapped client still finishes quickly.
      const timer = setTimeout(() => {
        if (stopped || res.destroyed) return;
        const chunkSize = 256 * 1024;
        const chunk = Buffer.alloc(chunkSize, 0x43);
        let remaining = declared;
        const pump = () => {
          while (!stopped && !res.destroyed && remaining > 0) {
            const slice = remaining >= chunkSize ? chunk : chunk.subarray(0, remaining);
            remaining -= slice.length;
            stats.bodyChunksSent += 1;
            stats.bytesSent += slice.length;
            if (!res.write(slice)) {
              res.once('drain', pump);
              return;
            }
          }
          if (!stopped && !res.destroyed && remaining === 0) res.end();
        };
        pump();
      }, 60);
      timer.unref();
      res.on('close', () => clearTimeout(timer));
      return;
    }

    if (pathname === '/chunked-over-cap') {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.flushHeaders();
      const chunkSize = 512 * 1024;
      const chunk = Buffer.alloc(chunkSize, 0x44);
      const totalChunks = 80; // 40 MiB total if never aborted
      let sent = 0;
      const sendOne = () => {
        if (stopped || res.destroyed) return;
        if (sent >= totalChunks) {
          res.end();
          return;
        }
        sent += 1;
        stats.bodyChunksSent += 1;
        stats.bytesSent += chunk.length;
        const ok = res.write(chunk);
        const schedule = () => {
          const t = setTimeout(sendOne, 2);
          t.unref();
        };
        if (ok) schedule();
        else res.once('drain', schedule);
      };
      sendOne();
      return;
    }

    if (pathname === '/chunked-exact-plus-one') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      const chunkSize = 1024 * 1024;
      const chunk = Buffer.alloc(chunkSize, 0x45);
      let remaining = MAX_DOC_BYTES + 1;
      const pump = () => {
        while (!stopped && !res.destroyed && remaining > 0) {
          const slice = remaining >= chunkSize ? chunk : chunk.subarray(0, remaining);
          remaining -= slice.length;
          stats.bodyChunksSent += 1;
          stats.bytesSent += slice.length;
          if (!res.write(slice)) {
            res.once('drain', pump);
            return;
          }
        }
        if (!stopped && !res.destroyed && remaining === 0) res.end();
      };
      pump();
      return;
    }

    if (pathname === '/gzip-bomb-stream') {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
      });
      res.flushHeaders();
      const gzip = zlib.createGzip({ level: 1 });
      gzip.on('data', (compressed: Buffer) => {
        if (stopped || res.destroyed) return;
        stats.bodyChunksSent += 1;
        stats.bytesSent += compressed.length;
        res.write(compressed);
      });
      gzip.on('end', () => {
        if (!stopped && !res.destroyed) res.end();
      });
      gzip.on('error', () => undefined);
      res.on('close', () => {
        gzip.destroy();
      });

      const oneMiB = Buffer.alloc(1024 * 1024, 0x5a);
      const totalMiB = 60; // 60 MiB uncompressed if never aborted (~60 KB compressed on wire)
      let fed = 0;
      const feedNext = () => {
        if (stopped || res.destroyed || gzip.destroyed) return;
        if (fed >= totalMiB) {
          gzip.end();
          return;
        }
        fed += 1;
        stats.uncompressedChunksFed += 1;
        gzip.write(oneMiB);
        gzip.flush(zlib.constants.Z_SYNC_FLUSH, () => {
          if (stopped || res.destroyed || gzip.destroyed) return;
          const t = setTimeout(feedNext, 4);
          t.unref();
        });
      };
      feedNext();
      return;
    }

    if (pathname === '/gzip-bomb-static') {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
        'content-length': String(staticGzipBomb.length),
      });
      stats.bodyChunksSent += 1;
      stats.bytesSent += staticGzipBomb.length;
      res.end(staticGzipBomb);
      return;
    }

    if (pathname === '/brotli-bomb-static') {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': 'br',
        'content-length': String(staticBrotliBomb.length),
      });
      stats.bodyChunksSent += 1;
      stats.bytesSent += staticBrotliBomb.length;
      res.end(staticBrotliBomb);
      return;
    }

    if (pathname === '/redirect-to-bomb') {
      res.writeHead(302, {
        location: `http://${PUBLIC_HOST}:${port}/gzip-bomb-static`,
      });
      res.end();
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;

  // Stub DNS lookup so PUBLIC_HOST resolves to a public documentation IP (passes SSRF guard).
  vi.spyOn(dns.promises, 'lookup').mockImplementation((async (hostname: string) => {
    const name = hostname.toLowerCase().replace(/\.$/, '');
    if (name === PUBLIC_HOST) {
      return [{ address: PUBLIC_ADDRESS, family: 4 }];
    }
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
  }) as any);

  // Route real undici fetch for PUBLIC_HOST:port to our local HTTP listener (preserving signal & redirect),
  // while asserting every outbound fetch used a PinnedDispatcher.
  realFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    async (input: string | URL | Request, init?: RequestInit & { dispatcher?: unknown }) => {
      const rawUrl = String(input instanceof Request ? input.url : input);
      fetches.push({ url: rawUrl, dispatcher: init?.dispatcher });
      const parsed = new URL(rawUrl);
      if (parsed.hostname === PUBLIC_HOST && parsed.port === String(port)) {
        if (customResponseOverride) {
          const override = customResponseOverride(parsed.pathname);
          if (override) return override;
        }
        const localUrl = `http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`;
        const { dispatcher: _pinned, ...rest } = init ?? {};
        return realFetch(localUrl, rest);
      }
      throw new Error(`Unexpected outbound fetch in body-cap test: ${rawUrl}`);
    },
  );

  const { ContractClauseService } = await import(
    '../src/modules/contracts/contract-clause.service'
  );
  const { DocumentParsingService } = await import(
    '../src/modules/ingestion/document-parsing.service'
  );
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { FlowOrchestratorService } = await import(
    '../src/modules/ai/flow-orchestrator.service'
  );
  const { ActionDispatcherService } = await import(
    '../src/modules/ai/action-dispatcher.service'
  );
  ({ PinnedDispatcher: PinnedDispatcherCtor } = await import(
    '../src/core/security/outbound-address'
  ));

  const contractsById: Record<string, any> = {
    [CONTRACT_URL_ID]: {
      id: CONTRACT_URL_ID,
      businessId: BIZ_ID,
      title: 'URL Contract',
      sourceAssetId: null,
    },
    [CONTRACT_ASSET_BOMB_ID]: {
      id: CONTRACT_ASSET_BOMB_ID,
      businessId: BIZ_ID,
      title: 'Asset Bomb Contract',
      sourceAssetId: ASSET_BOMB_ID,
    },
    [CONTRACT_ASSET_VALID_ID]: {
      id: CONTRACT_ASSET_VALID_ID,
      businessId: BIZ_ID,
      title: 'Asset Valid Contract',
      sourceAssetId: ASSET_VALID_ID,
    },
  };

  const assetsById: Record<string, any> = {
    [ASSET_BOMB_ID]: {
      id: ASSET_BOMB_ID,
      businessId: BIZ_ID,
      name: 'bomb.pdf',
      mimeType: 'application/pdf',
      url: `http://${PUBLIC_HOST}:${port}/gzip-bomb-static`,
    },
    [ASSET_VALID_ID]: {
      id: ASSET_VALID_ID,
      businessId: BIZ_ID,
      name: 'valid.txt',
      mimeType: 'text/plain',
      url: `http://${PUBLIC_HOST}:${port}/valid-plain`,
    },
  };

  const prismaStub = {
    client: {
      contract: {
        findFirst: async ({ where }: any) => {
          const row = contractsById[where.id];
          return row && row.businessId === where.businessId ? row : null;
        },
        update: async ({ where, data }: any) => ({ ...contractsById[where.id], ...data }),
      },
      asset: {
        findFirst: async ({ where }: any) => {
          const row = assetsById[where.id];
          return row && row.businessId === where.businessId ? row : null;
        },
      },
      businessSetting: {
        findUnique: async () => ({
          businessId: BIZ_ID,
          aiAutonomyLevel: 'full',
          aiAlwaysRequireApproval: [],
        }),
      },
    },
  };

  const parserStub = {
    parse: async (buffer: Buffer) => {
      parsedPayloads.push({
        byteLength: buffer.byteLength,
        head: buffer.subarray(0, 128).toString('utf8'),
      });
      return { markdown: buffer.subarray(0, 2048).toString('utf8') };
    },
  };

  const modelStub = {
    trackAndComplete: async () => {
      modelCalls += 1;
      return { content: '{"clauses":[{"label":"Governing Law","present":true}]}' };
    },
  };

  clauses = new ContractClauseService(prismaStub as any, {
    get: (token: unknown) => {
      if (token === DocumentParsingService) return parserStub;
      if (token === AiUsageService) return modelStub;
      throw new Error(`Unexpected token resolved in body-cap test: ${String(token)}`);
    },
  } as any);

  flow = Object.create(FlowOrchestratorService.prototype);
  Object.assign(flow, {
    prisma: prismaStub,
    logger: new Logger('doc-cap-flow'),
    governance: { getToolTier: () => 1 },
    executionLog: { logToolExecution: async () => 'doc-cap-log' },
    businessGraph: { invalidateCache: () => undefined },
    moduleRef: {
      get: (token: unknown) => {
        if (token === ContractClauseService) return clauses;
        throw new Error(`Unexpected flow token in body-cap test: ${String(token)}`);
      },
    },
  });

  const ALLOW = {
    allowed: true,
    tier: 1,
    reason: 'allowed in body-cap test',
    requiresFormalApproval: false,
    requiresAdminApproval: false,
    requiresQuickConfirm: false,
  };
  const governanceStub = {
    evaluate: async () => ({ ...ALLOW }),
    evaluateAutoApproval: async () => ({ ...ALLOW, autoApproved: true }),
    getToolTier: () => 1,
  };
  const execLogStub = { log: async () => ({ id: 'doc-cap-exec' }) };
  const eventsStub = { emit: () => true };

  makeDispatcher = () => {
    const dispatcher = new ActionDispatcherService(
      prismaStub as any,
      eventsStub as any,
      execLogStub as any,
      governanceStub as any,
      flow as any,
      { registerAction: async () => undefined } as any,
    );
    (dispatcher as unknown as { RETRY_DELAYS: number[] }).RETRY_DELAYS = [0, 0];
    return dispatcher;
  };
});

beforeEach(() => {
  resetState();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('FU-DOC-FETCH-BODY-CAP (P111): contract document fetches cap decompressed body bytes at 25 MB', () => {
  it('BC-01 rejects a declared Content-Length over 25 MB before reading the body and closes the socket', async () => {
    const url = `http://${PUBLIC_HOST}:${port}/over-content-length`;
    const outcome = await runExtract({ contractId: CONTRACT_URL_ID, url });

    expectBodyTooLarge(outcome, 'Content-Length > 25 MB');
    await waitForServerClose('/over-content-length');

    const stats = getStats('/over-content-length');
    expect(stats.hits).toBe(1);
    expect(stats.bodyChunksSent, 'must reject before reading any body bytes').toBe(0);
    expect(stats.bytesSent, 'zero body bytes transmitted').toBe(0);
    expect(stats.closedEarly, 'socket closed before body finished').toBe(true);
    expect(parsedPayloads).toEqual([]);
    expect(modelCalls).toBe(0);
    expect(fetches[0]?.dispatcher).toBeInstanceOf(PinnedDispatcherCtor);
  });

  it('BC-02 aborts chunked responses (no Content-Length) past 25 MB and rejects exact MAX + 1 bytes', async () => {
    const streamUrl = `http://${PUBLIC_HOST}:${port}/chunked-over-cap`;
    const streamed = await runExtract({ contractId: CONTRACT_URL_ID, url: streamUrl });

    expectBodyTooLarge(streamed, 'chunked 40 MiB stream');
    await waitForServerClose('/chunked-over-cap');

    const streamStats = getStats('/chunked-over-cap');
    expect(streamStats.hits).toBe(1);
    expect(streamStats.closedEarly, 'socket closed mid-stream past 25 MB').toBe(true);
    expect(
      streamStats.bytesSent,
      'must abort before reading the full 40 MiB stream',
    ).toBeLessThan(36 * 1024 * 1024);
    expect(parsedPayloads).toEqual([]);
    expect(modelCalls).toBe(0);

    resetState();

    // Exact boundary: 25 MiB + 1 byte chunked must be rejected.
    const boundaryUrl = `http://${PUBLIC_HOST}:${port}/chunked-exact-plus-one`;
    const boundary = await runExtract({ contractId: CONTRACT_URL_ID, url: boundaryUrl });
    expectBodyTooLarge(boundary, 'chunked MAX + 1');
    expect(parsedPayloads).toEqual([]);
    expect(modelCalls).toBe(0);
  });

  it('BC-03 aborts real gzip bombs (streamed 60 MiB and static small-Content-Length 40 MiB) once decompressed bytes pass 25 MB', async () => {
    // 1. Streamed 60 MiB gzip bomb: proves socket closes early and server stops inflating/sending.
    const streamBombUrl = `http://${PUBLIC_HOST}:${port}/gzip-bomb-stream`;
    const streamed = await runExtract({ contractId: CONTRACT_URL_ID, url: streamBombUrl });

    expectBodyTooLarge(streamed, 'streamed gzip bomb');
    await waitForServerClose('/gzip-bomb-stream');

    const bombStats = getStats('/gzip-bomb-stream');
    expect(bombStats.hits).toBe(1);
    expect(bombStats.closedEarly, 'socket must close before 60 MiB bomb completes').toBe(true);
    expect(
      bombStats.uncompressedChunksFed,
      'must stop well before feeding all 60 MiB of compressed bomb',
    ).toBeLessThan(45);
    expect(parsedPayloads).toEqual([]);
    expect(modelCalls).toBe(0);

    resetState();

    // 2. Static pre-compressed 40 MiB gzip bomb whose wire Content-Length is tiny (~40 KB << 25 MB).
    expect(staticGzipBomb.length).toBeLessThan(200 * 1024);
    const staticBombUrl = `http://${PUBLIC_HOST}:${port}/gzip-bomb-static`;
    const staticRes = await runExtract({ contractId: CONTRACT_URL_ID, url: staticBombUrl });

    expectBodyTooLarge(staticRes, 'static gzip bomb with tiny Content-Length');
    expect(parsedPayloads).toEqual([]);
    expect(modelCalls).toBe(0);
  });

  it('BC-04 aborts real brotli bombs and lying small Content-Length streams once decompressed bytes pass 25 MB', async () => {
    // 1. Static brotli bomb: tiny wire Content-Length (~100 B) inflating to 32 MiB.
    expect(staticBrotliBomb.length).toBeLessThan(64 * 1024);
    const brUrl = `http://${PUBLIC_HOST}:${port}/brotli-bomb-static`;
    const brOutcome = await runExtract({ contractId: CONTRACT_URL_ID, url: brUrl });

    expectBodyTooLarge(brOutcome, 'brotli bomb');
    expect(parsedPayloads).toEqual([]);
    expect(modelCalls).toBe(0);

    resetState();

    // 2. Lying small Content-Length header (1024) on a stream that emits 26 MiB -> cancelled at 25 MiB + 1 chunk.
    let chunksPulled = 0;
    let streamCancelled = false;
    const oneMiB = new Uint8Array(1024 * 1024).fill(0x4c);
    customResponseOverride = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (chunksPulled >= 32) {
              controller.close();
              return;
            }
            chunksPulled += 1;
            controller.enqueue(oneMiB);
          },
          cancel() {
            streamCancelled = true;
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/pdf',
            'content-length': '1024',
          },
        },
      );

    const lyingUrl = `http://${PUBLIC_HOST}:${port}/lying-content-length`;
    const lyingOutcome = await runExtract({ contractId: CONTRACT_URL_ID, url: lyingUrl });

    expectBodyTooLarge(lyingOutcome, 'lying Content-Length stream');
    expect(streamCancelled, 'overflowing stream must be cancelled').toBe(true);
    expect(chunksPulled, 'must stop pulling chunks once 25 MiB is exceeded').toBeLessThanOrEqual(27);
    expect(parsedPayloads).toEqual([]);
    expect(modelCalls).toBe(0);
  });

  it('BC-05 enforces the 25 MB cap on the contract sourceAssetId fetch and across public redirects', async () => {
    const assetOutcome = await runExtract({ contractId: CONTRACT_ASSET_BOMB_ID });
    expectBodyTooLarge(assetOutcome, 'contract sourceAssetId gzip bomb');
    expect(parsedPayloads).toEqual([]);
    expect(modelCalls).toBe(0);

    resetState();

    const redirectOutcome = await runExtract({
      contractId: CONTRACT_URL_ID,
      url: `http://${PUBLIC_HOST}:${port}/redirect-to-bomb`,
    });
    expectBodyTooLarge(redirectOutcome, 'redirect -> gzip bomb');
    expect(fetches).toHaveLength(2);
    expect(parsedPayloads).toEqual([]);
    expect(modelCalls).toBe(0);
  });

  it('BC-06 body-cap refusal is final through FlowOrchestratorService and ActionDispatcherService (no 503, no retries, circuit stays closed)', async () => {
    const url = `http://${PUBLIC_HOST}:${port}/over-content-length`;
    const toolOutcome = await runTool({ contractId: CONTRACT_URL_ID, url });
    expectBodyTooLarge(toolOutcome, 'flow tool refusal');
    resetState();

    const dispatcher = makeDispatcher();
    const dispatched = await dispatcher.dispatch({
      businessId: BIZ_ID,
      toolName: TOOL,
      args: { contractId: CONTRACT_URL_ID, url },
      retryCount: 2,
    });
    expect(dispatched).toMatchObject({ success: false, error: TOO_LARGE_MESSAGE });
    expect(fetches, 'final 400 must be attempted once, never retried').toHaveLength(1);
    expect(dispatcher.getCircuitStatus(TOOL, BIZ_ID)).toEqual(CLOSED_CIRCUIT);
  });

  it('BC-07 allows exact 25 MiB, valid small gzipped/plain documents (URL and asset), and preserves the SSRF guard', async () => {
    // 1. Exact 25 MiB boundary succeeds.
    const exactOutcome = await runExtract({
      contractId: CONTRACT_URL_ID,
      url: `http://${PUBLIC_HOST}:${port}/exact-cap`,
    });
    expect(exactOutcome.ok, JSON.stringify((exactOutcome as any).error?.message)).toBe(true);
    expect(parsedPayloads).toHaveLength(1);
    expect(parsedPayloads[0].byteLength).toBe(MAX_DOC_BYTES);
    expect(modelCalls).toBe(1);

    resetState();

    // 2. Valid small gzipped document decompresses and parses properly.
    const gzipOutcome = await runExtract({
      contractId: CONTRACT_URL_ID,
      url: `http://${PUBLIC_HOST}:${port}/valid-gzip`,
    });
    expect(gzipOutcome.ok, JSON.stringify((gzipOutcome as any).error?.message)).toBe(true);
    expect(parsedPayloads).toHaveLength(1);
    expect(parsedPayloads[0].head).toBe(VALID_DOC_TEXT);
    expect(modelCalls).toBe(1);

    resetState();

    // 3. Valid contract sourceAssetId document parses properly.
    const assetOutcome = await runExtract({ contractId: CONTRACT_ASSET_VALID_ID });
    expect(assetOutcome.ok, JSON.stringify((assetOutcome as any).error?.message)).toBe(true);
    expect((assetOutcome as any).value).toMatchObject({ source: 'asset', total: 1 });
    expect(parsedPayloads[0].head).toBe(VALID_DOC_TEXT);

    resetState();

    // 4. Existing SSRF guard remains intact for loopback and metadata URLs.
    for (const badUrl of [
      `http://127.0.0.1:${port}/valid-plain`,
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      const refused = await runExtract({ contractId: CONTRACT_URL_ID, url: badUrl });
      expect(refused.ok).toBe(false);
      expect(refused.error).toBeInstanceOf(BadRequestException);
      expect((refused.error as HttpException).message).toBe(URL_REFUSED_MESSAGE);
      expect(fetches).toEqual([]);
    }
  });
});
