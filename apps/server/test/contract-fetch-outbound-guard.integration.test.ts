/**
 * FU-CONTRACT-FETCH-OUTBOUND-GUARD (owner ruling D-246) on the real database: KEY's contract_extract_clauses
 * makes the server fetch a document, from a URL the call names or from the contract's own asset
 * (ContractClauseService.resolveBytes). Before this packet neither fetch passed the outbound-address guard
 * (core/security/outbound-address.ts, the one webhooks and the CRM link import use), so a member could have
 * the server request a private, loopback, link-local or cloud metadata address, have fetch follow a redirect
 * to one, and read the upstream status back from the 400 ('Could not fetch document URL (401)').
 *
 *   CF-01  a loopback address the server can reach (a local listener): refused before a connection is made;
 *          a redirect from it is never followed.
 *   CF-02  every non-public spelling (private, loopback, link-local, metadata 169.254.169.254, IPv6 forms
 *          incl. IPv4-mapped, decimal / octal / hex IPv4, localhost, DNS names that resolve to a non-public
 *          address or to a mix), a non-http scheme, credentials in the URL and an unparsable URL: refused
 *          before any request is made, with one body that names no address and no status.
 *   CF-03  the contract's own asset URL passes the same guard.
 *   CF-04  a redirect from a public host is re-checked at every hop: one to a non-public address (by
 *          literal, by name, by IPv4-mapped form), to a non-http scheme, or a chain past the hop limit, is
 *          refused without requesting the target; a redirect to another public host is followed.
 *   CF-05  a public host still works, and its fetch is pinned to the address that was checked (a second DNS
 *          answer, DNS rebinding, is never used); the host is resolved once per hop.
 *   CF-06  the refusal is final (the plan queue answers it once and counts it toward no circuit), while a
 *          public host that did not answer (5xx, 408, 429) stays the retried, counted failure
 *          W11-DISPATCH-REFUSAL-FINAL made it (DS-08, DS-09), and a public host that refused (404) is still
 *          the final 400 it was.
 *
 * No request leaves for a third party: the global fetch is wrapped so every request the service makes is
 * recorded; a request to the local listener goes to the real fetch, every other one is answered by the
 * wrapper (as the addressed host would) without touching the network. DNS (dns.promises.lookup, what the
 * guard resolves with) is answered from a table; a name outside it is ENOTFOUND.
 *
 * Real: PrismaService, FlowOrchestratorService.executeToolDirectly / executeTool (the contract_extract_clauses
 * case), ContractClauseService, ActionDispatcherService and AiExecutionLogService, against DATABASE_URL.
 * Stand-ins: the document parser and the model (no provider traffic), governance (allows), the event emitter.
 *
 * Fixtures: prefix `v99h_` (registered in test/helpers/fixture-prefixes.json), hard-deleted by raw SQL with
 * sqlLikePrefix() in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import http from 'node:http';
import dns from 'node:dns';
import type { AddressInfo } from 'node:net';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { BadRequestException, HttpException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v99h_';
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contract: `${P}contract`, // no asset: the URL the call names
  contractAssetMeta: `${P}contract_asset_meta`,
  contractAssetLoop: `${P}contract_asset_loop`,
  contractAssetPublic: `${P}contract_asset_public`,
  assetMeta: `${P}asset_meta`,
  assetLoop: `${P}asset_loop`,
  assetPublic: `${P}asset_public`,
};
const TOOL = 'contract_extract_clauses';
/** The one body every refused document URL is answered with. */
const REFUSAL = 'The document URL must be a public http or https address';
/** A redirect chain past the hop limit: final, and true (acceptance review, correctness M2). */
const TOO_MANY_REDIRECTS = 'The document URL redirected too many times';
const NO_SOURCE = 'No source document available for this contract (upload one or link an asset/document)';
const PUBLIC_HOST = 'docs.v99h-public.test';
const PUBLIC_ADDRESS = '203.0.113.10';
const OTHER_PUBLIC_HOST = 'mirror.v99h-public.test';
const OTHER_PUBLIC_ADDRESS = '198.51.100.20';
const CLOSED = { open: false, failures: 0, lastFailure: null };

let db: any;
let prisma: any;
let flow: any;
let PinnedDispatcher: any;
/** The real ContractClauseService the tool runs (CF-08 shortens its deadline). */
let clauses: any;
let ContractClauseServiceCtor: any;
let makeDispatcher: () => any;
let realFetch: typeof fetch;
let server: http.Server;
let port = 0;

/** Every request the listener took (method and path). */
const listenerHits: string[] = [];
/** Every request the service handed fetch: url and the init it gave. */
const fetches: Array<{ url: string; init?: RequestInit & { dispatcher?: unknown } }> = [];
/** Every name the guard resolved. */
const lookups: string[] = [];
/** How each host the wrapper stands in for answers: host -> (path, n-th request to that host) -> Response. */
let hostAnswers: Record<string, (path: string, n: number) => Response> = {};
/** How many times each name has been resolved (DNS rebinding answers differently the second time). */
const lookupCount: Record<string, number> = {};
/** Model calls (a refused document never reaches the model). */
let modelCalls = 0;

const DNS: Record<string, (n: number) => Array<{ address: string; family: number }>> = {
  [PUBLIC_HOST]: () => [{ address: PUBLIC_ADDRESS, family: 4 }],
  [OTHER_PUBLIC_HOST]: () => [{ address: OTHER_PUBLIC_ADDRESS, family: 4 }],
  'internal.v99h.test': () => [{ address: '10.0.0.5', family: 4 }],
  'metadata.v99h.test': () => [{ address: '169.254.169.254', family: 4 }],
  'loop.v99h.test': () => [{ address: '127.0.0.1', family: 4 }],
  'v6loop.v99h.test': () => [{ address: '::1', family: 6 }],
  'mapped.v99h.test': () => [{ address: '::ffff:169.254.169.254', family: 6 }],
  // IPv4-translated 169.254.169.254 (acceptance review, security MINOR-1).
  'xlat.v99h.test': () => [{ address: '::ffff:0:a9fe:a9fe', family: 6 }],
  'ula.v99h.test': () => [{ address: 'fd00:ec2::254', family: 6 }],
  'mixed.v99h.test': () => [{ address: PUBLIC_ADDRESS, family: 4 }, { address: '192.168.1.10', family: 4 }],
  // The resolver could not answer now (review: correctness 1, security 1): no answer about the name.
  'blip.v99h.test': () => { throw Object.assign(new Error('getaddrinfo EAI_AGAIN blip.v99h.test'), { code: 'EAI_AGAIN' }); },
  // DNS rebinding: public to the first question, loopback to every one after it.
  'rebind.v99h.test': (n) => [{ address: n === 1 ? PUBLIC_ADDRESS : '127.0.0.1', family: 4 }],
};

const text = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain', ...headers } });
const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });
const INTERNAL_SECRET = 'v99h internal secret';
/** Every response body the service cancelled, by label (acceptance review, correctness M1). */
const cancelled: string[] = [];
/** A response whose body trickles (never ends on its own) and records being cancelled. */
const trickling = (label: string, status: number, headers: Record<string, string> = {}) =>
  new Response(
    new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('v99h partial ')); },
      cancel() { cancelled.push(label); },
    }),
    { status, headers: { 'content-type': 'text/plain', ...headers } },
  );

async function cleanup() {
  for (const sql of [
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contracts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM assets WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_settings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** What the tool path answers on the owner's chat turn: the result, or what executeToolDirectly threw. */
function runTool(args: Record<string, unknown>) {
  return flow.executeToolDirectly(ID.biz, TOOL, args, undefined, { surface: 'CHAT', principalUserId: ID.owner }).then(
    (value: unknown) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

function expectRefused(outcome: { ok: boolean; error?: unknown; value?: unknown }, label: string) {
  expect(outcome.ok, `${label}: answered ${JSON.stringify((outcome as any).value ?? (outcome.error as Error)?.message)}`).toBe(false);
  expect(outcome.error, label).toBeInstanceOf(BadRequestException);
  expect((outcome.error as HttpException).getResponse(), label).toEqual(new BadRequestException(REFUSAL).getResponse());
  expect((outcome.error as HttpException).cause, `${label}: a refusal is no outage`).toBeUndefined();
}

function resetRecords() {
  listenerHits.length = 0;
  fetches.length = 0;
  lookups.length = 0;
  for (const k of Object.keys(lookupCount)) delete lookupCount[k];
  hostAnswers = {};
  modelCalls = 0;
  cancelled.length = 0;
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
  const { ActionDispatcherService } = await import('../src/modules/ai/action-dispatcher.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { ContractClauseService } = await import('../src/modules/contracts/contract-clause.service');
  const { DocumentParsingService } = await import('../src/modules/ingestion/document-parsing.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  ({ PinnedDispatcher } = await import('../src/core/security/outbound-address'));

  prisma = new PrismaService();
  const events = { emit: () => true };

  // The document parser and the model: no provider traffic. The parse is the document's own text.
  const parser = { parse: async (buffer: Buffer) => ({ markdown: buffer.toString('utf8') }) };
  const model = {
    trackAndComplete: async () => {
      modelCalls += 1;
      return { content: '{"clauses":[{"label":"Parties","present":true}]}' };
    },
  };
  ContractClauseServiceCtor = ContractClauseService;
  clauses = new ContractClauseService(prisma, {
    get: (token: unknown) => {
      if (token === DocumentParsingService) return parser;
      if (token === AiUsageService) return model;
      throw new Error(`v99h: the clause service resolves the parser and the model only, not ${String((token as any)?.name ?? token)}`);
    },
  } as any);

  flow = Object.create(FlowOrchestratorService.prototype);
  Object.assign(flow, {
    prisma,
    logger: new Logger('v99h-flow'),
    governance: { getToolTier: () => 1 },
    executionLog: { logToolExecution: async () => 'v99h_log' },
    businessGraph: { invalidateCache: () => undefined },
    moduleRef: {
      get: (token: unknown) => {
        if (token === ContractClauseService) return clauses;
        throw new Error(`v99h: the harness resolves ContractClauseService only, not ${String((token as any)?.name ?? token)}`);
      },
    },
  });

  const ALLOW = { allowed: true, tier: 1, reason: 'v99h: allowed', requiresFormalApproval: false, requiresAdminApproval: false, requiresQuickConfirm: false };
  const governance = { evaluate: async () => ({ ...ALLOW }), evaluateAutoApproval: async () => ({ ...ALLOW, autoApproved: true }), getToolTier: () => 1 };
  makeDispatcher = () => {
    const dispatcher = new ActionDispatcherService(prisma, events as any, new AiExecutionLogService(prisma), governance as any, flow as any, { registerAction: async () => undefined } as any);
    (dispatcher as unknown as { RETRY_DELAYS: number[] }).RETRY_DELAYS = [0, 0];
    return dispatcher;
  };

  // A host the server can reach: a local listener. It hands out a document, and a redirect to itself.
  server = http.createServer((req, res) => {
    listenerHits.push(`${req.method} ${req.url}`);
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/doc` });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(INTERNAL_SECRET);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;

  // Every request the service makes is recorded. Only one to the local listener is a real request.
  realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit & { dispatcher?: unknown }) => {
    const url = String(input instanceof Request ? input.url : input);
    fetches.push({ url, init });
    let parsed: URL | null = null;
    try { parsed = new URL(url); } catch { /* the real fetch would refuse it too */ }
    if (!parsed) throw new TypeError(`v99h: fetch of an unparsable URL ${url}`);
    if (parsed.hostname === '127.0.0.1' && parsed.port === String(port)) return realFetch(url, init as RequestInit);
    const answer = hostAnswers[parsed.hostname];
    const n = fetches.filter((f) => { try { return new URL(f.url).hostname === parsed!.hostname; } catch { return false; } }).length;
    if (answer) return answer(parsed.pathname, n);
    // Any other host is a host on the server's network: it answers with what it holds, and the network is
    // never touched.
    return text(INTERNAL_SECRET);
  });

  vi.spyOn(dns.promises, 'lookup').mockImplementation((async (hostname: string) => {
    lookups.push(hostname);
    const name = hostname.toLowerCase().replace(/\.$/, '');
    lookupCount[name] = (lookupCount[name] ?? 0) + 1;
    // A resolver that never answers (review: correctness 2): settles long after the fetch's 30 s deadline.
    if (name === 'hang.v99h.test') return new Promise((resolve) => setTimeout(() => resolve([{ address: PUBLIC_ADDRESS, family: 4 }]), 5_000).unref());
    const answer = DNS[name];
    if (!answer) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
    return answer(lookupCount[name]);
  }) as any);

  await cleanup();
  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V99H Biz', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.businessSetting.create({ data: { id: `${P}setting`, businessId: ID.biz, aiAutonomyLevel: 'full', aiAlwaysRequireApproval: [] } });
  const asset = (id: string, url: string) => db.asset.create({
    data: { id, businessId: ID.biz, name: `${id}.txt`, type: 'document', url, storageKey: `${P}${id}`, mimeType: 'text/plain', uploadedBy: ID.owner },
  });
  await asset(ID.assetMeta, 'http://169.254.169.254/latest/meta-data/iam/security-credentials/');
  await asset(ID.assetLoop, `http://127.0.0.1:${port}/doc`);
  await asset(ID.assetPublic, `https://${PUBLIC_HOST}/asset.txt`);
  const contract = (id: string, sourceAssetId: string | null) => db.contract.create({
    data: { id, businessId: ID.biz, title: `v99h ${id}`, sourceAssetId },
  });
  await contract(ID.contract, null);
  await contract(ID.contractAssetMeta, ID.assetMeta);
  await contract(ID.contractAssetLoop, ID.assetLoop);
  await contract(ID.contractAssetPublic, ID.assetPublic);
}, 180_000);

afterEach(() => resetRecords());

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (db) {
    await cleanup();
    const left = await db.$queryRawUnsafe(
      `SELECT (SELECT count(*) FROM businesses WHERE id LIKE ${sqlLikePrefix(P)})::int AS businesses,
              (SELECT count(*) FROM users WHERE id LIKE ${sqlLikePrefix(P)})::int AS users,
              (SELECT count(*) FROM contracts WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS contracts,
              (SELECT count(*) FROM assets WHERE business_id LIKE ${sqlLikePrefix(P)})::int AS assets`,
    );
    expect(left[0]).toEqual({ businesses: 0, users: 0, contracts: 0, assets: 0 });
  }
});

describe('FU-CONTRACT-FETCH-OUTBOUND-GUARD (D-246): contract_extract_clauses fetches only a public address', () => {
  it('CF-01 a loopback address the server can reach is refused before a connection is made, and a redirect from it is never followed', async () => {
    for (const url of [`http://127.0.0.1:${port}/doc`, `http://127.0.0.1:${port}/redirect`, `http://localhost:${port}/doc`, `http://2130706433:${port}/doc`]) {
      const outcome = await runTool({ contractId: ID.contract, url });
      expectRefused(outcome, url);
      expect(listenerHits, `${url}: the listener was reached`).toEqual([]);
      expect(fetches, `${url}: a request was made`).toEqual([]);
      expect(modelCalls, url).toBe(0);
      resetRecords();
    }
    const row = await db.contract.findUnique({ where: { id: ID.contract }, select: { clauseAnalysis: true } });
    expect(row.clauseAnalysis, 'nothing read from a refused address is written').toBeNull();
  });

  it('CF-02 every non-public spelling, a non-http scheme, credentials in the URL and an unparsable URL are refused before any request, with one body that names no address and no status', async () => {
    const refused = [
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'http://10.0.0.5/contract.pdf',
      'http://172.16.4.4/contract.pdf',
      'http://192.168.1.1/contract.pdf',
      'http://100.64.0.1/contract.pdf',
      'http://0.0.0.0/contract.pdf',
      'http://0/contract.pdf',
      'http://127.1/contract.pdf',
      'http://2852039166/latest/meta-data/', // 169.254.169.254, decimal
      'http://0xa9fea9fe/latest/meta-data/', // hex
      'http://0251.0376.0251.0376/latest/meta-data/', // octal
      'http://0x7f.0.0.1/contract.pdf',
      'http://[::1]/contract.pdf',
      'http://[::]/contract.pdf',
      'http://[::ffff:127.0.0.1]/contract.pdf',
      'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
      'http://[0:0:0:0:0:ffff:169.254.169.254]/latest/meta-data/',
      'http://[fd00:ec2::254]/latest/meta-data/',
      'http://[fe80::1]/contract.pdf',
      'http://[fc00::1]/contract.pdf',
      'http://localhost/contract.pdf',
      'http://LOCALHOST./contract.pdf',
      'http://api.localhost/contract.pdf',
      'http://internal.v99h.test/contract.pdf',
      'http://metadata.v99h.test/latest/meta-data/',
      'http://loop.v99h.test/contract.pdf',
      'http://v6loop.v99h.test/contract.pdf',
      'http://mapped.v99h.test/contract.pdf',
      'http://ula.v99h.test/contract.pdf',
      'http://mixed.v99h.test/contract.pdf',
      'http://unknown.v99h.test/contract.pdf', // does not resolve
      'file:///etc/passwd',
      'ftp://files.v99h-public.test/contract.pdf',
      'data:text/plain,v99h',
      'gopher://docs.v99h-public.test/',
      `https://user:pass@${PUBLIC_HOST}/contract.pdf`,
      `https://user@${PUBLIC_HOST}/contract.pdf`,
      'not a url',
    ];
    const bodies = new Set<string>();
    for (const url of refused) {
      // The host would answer 401: a refusal never tells the member what an internal host answered.
      hostAnswers = Object.fromEntries(['169.254.169.254', '10.0.0.5', PUBLIC_HOST, 'internal.v99h.test'].map((h) => [h, () => text('denied', 401)]));
      const outcome = await runTool({ contractId: ID.contract, url });
      expectRefused(outcome, url);
      bodies.add(JSON.stringify((outcome.error as HttpException).getResponse()));
      expect(fetches.map((f) => f.url), `${url}: a request was made`).toEqual([]);
      expect(modelCalls, url).toBe(0);
      resetRecords();
    }
    expect([...bodies]).toEqual([JSON.stringify(new BadRequestException(REFUSAL).getResponse())]);
  });

  it("CF-03 the contract's own asset URL passes the same guard", async () => {
    for (const contractId of [ID.contractAssetMeta, ID.contractAssetLoop]) {
      const outcome = await runTool({ contractId });
      expectRefused(outcome, contractId);
      expect(fetches.map((f) => f.url), contractId).toEqual([]);
      expect(listenerHits, contractId).toEqual([]);
      expect(modelCalls, contractId).toBe(0);
      resetRecords();
    }
  });

  it('CF-04 a redirect from a public host is re-checked at every hop: a non-public target, a non-http scheme or a chain past the limit is refused without requesting the target; a public one is followed', async () => {
    const targets = [
      'http://169.254.169.254/latest/meta-data/',
      `http://127.0.0.1:${port}/doc`,
      'http://[::ffff:169.254.169.254]/latest/meta-data/',
      'http://2852039166/latest/meta-data/',
      'http://internal.v99h.test/contract.pdf',
      'http://localhost/contract.pdf',
      'file:///etc/passwd',
      `https://user:pass@${OTHER_PUBLIC_HOST}/contract.pdf`,
    ];
    for (const target of targets) {
      for (const status of [301, 302, 303, 307, 308]) {
        hostAnswers = { [PUBLIC_HOST]: () => redirect(target, status) };
        const label = `${status} -> ${target}`;
        const outcome = await runTool({ contractId: ID.contract, url: `https://${PUBLIC_HOST}/contract.pdf` });
        expectRefused(outcome, label);
        expect(fetches.map((f) => f.url), label).toEqual([`https://${PUBLIC_HOST}/contract.pdf`]);
        expect(listenerHits, label).toEqual([]);
        resetRecords();
      }
    }

    // Two public hops, then a non-public one: the third target is never requested.
    hostAnswers = {
      [PUBLIC_HOST]: () => redirect(`https://${OTHER_PUBLIC_HOST}/hop`),
      [OTHER_PUBLIC_HOST]: () => redirect('http://metadata.v99h.test/latest/meta-data/'),
    };
    expectRefused(await runTool({ contractId: ID.contract, url: `https://${PUBLIC_HOST}/contract.pdf` }), 'chain');
    expect(fetches.map((f) => f.url)).toEqual([`https://${PUBLIC_HOST}/contract.pdf`, `https://${OTHER_PUBLIC_HOST}/hop`]);
    resetRecords();

    // A redirect loop between public hosts: refused once the hop limit is passed, with the same body.
    hostAnswers = { [PUBLIC_HOST]: (_p, n) => redirect(`/loop/${n}`) };
    // Acceptance review correctness M2: its own final 400, which says what happened and names no host.
    const loop = await runTool({ contractId: ID.contract, url: `https://${PUBLIC_HOST}/contract.pdf` });
    expect(loop.ok).toBe(false);
    expect(loop.error).toBeInstanceOf(BadRequestException);
    expect((loop.error as HttpException).getResponse()).toEqual(new BadRequestException(TOO_MANY_REDIRECTS).getResponse());
    expect((loop.error as HttpException).cause, 'final: no outage').toBeUndefined();
    // MAX_DOCUMENT_REDIRECTS (5) redirects followed, so six requests, then the refusal (review: correctness 3).
    expect(fetches).toHaveLength(6);
    resetRecords();
    hostAnswers = { [PUBLIC_HOST]: (_p, n) => redirect(`/loop/${n}`) };
    const loopDispatcher = makeDispatcher();
    expect(await loopDispatcher.dispatch({ businessId: ID.biz, toolName: TOOL, args: { contractId: ID.contract, url: `https://${PUBLIC_HOST}/contract.pdf` }, retryCount: 2 }))
      .toMatchObject({ success: false, error: TOO_MANY_REDIRECTS });
    expect(fetches, 'answered once, not retried').toHaveLength(6);
    expect(loopDispatcher.getCircuitStatus(TOOL, ID.biz)).toEqual(CLOSED);
    resetRecords();

    // A redirect to another public host (and a relative one) is followed, each hop pinned to its own checked address.
    hostAnswers = {
      [PUBLIC_HOST]: (p) => (p === '/contract.pdf' ? redirect('/moved.pdf') : redirect(`https://${OTHER_PUBLIC_HOST}/final.pdf`)),
      [OTHER_PUBLIC_HOST]: () => text('v99h public contract'),
    };
    const followed = await runTool({ contractId: ID.contract, url: `https://${PUBLIC_HOST}/contract.pdf` });
    expect(followed.ok, JSON.stringify((followed as any).error?.message)).toBe(true);
    expect((followed as any).value).toMatchObject({ source: 'url', total: 1 });
    expect(fetches.map((f) => f.url)).toEqual([`https://${PUBLIC_HOST}/contract.pdf`, `https://${PUBLIC_HOST}/moved.pdf`, `https://${OTHER_PUBLIC_HOST}/final.pdf`]);
    expect(fetches.map((f) => f.init?.redirect)).toEqual(['manual', 'manual', 'manual']);
    expect(fetches.map((f) => (f.init?.dispatcher as any)?.target?.addresses)).toEqual([
      [{ address: PUBLIC_ADDRESS, family: 4 }],
      [{ address: PUBLIC_ADDRESS, family: 4 }],
      [{ address: OTHER_PUBLIC_ADDRESS, family: 4 }],
    ]);
  });

  it('CF-05 a public host still works, its fetch pinned to the address that was checked: a second DNS answer (rebinding) is never used', async () => {
    hostAnswers = { [PUBLIC_HOST]: () => text('v99h public contract'), 'rebind.v99h.test': () => text('v99h public contract') };
    const ok = await runTool({ contractId: ID.contract, url: `https://${PUBLIC_HOST}/contract.pdf` });
    expect(ok.ok, JSON.stringify((ok as any).error?.message)).toBe(true);
    expect((ok as any).value).toMatchObject({ source: 'url', total: 1 });
    expect(modelCalls).toBe(1);
    expect(fetches).toHaveLength(1);
    expect(fetches[0].init?.dispatcher).toBeInstanceOf(PinnedDispatcher);
    expect((fetches[0].init?.dispatcher as any).target).toEqual({ hostname: PUBLIC_HOST, addresses: [{ address: PUBLIC_ADDRESS, family: 4 }] });
    resetRecords();

    const rebound = await runTool({ contractId: ID.contract, url: 'https://rebind.v99h.test/contract.pdf' });
    expect(rebound.ok, JSON.stringify((rebound as any).error?.message)).toBe(true);
    expect(lookups, 'the host is resolved once').toEqual(['rebind.v99h.test']);
    expect(fetches).toHaveLength(1);
    expect((fetches[0].init?.dispatcher as any).target).toEqual({ hostname: 'rebind.v99h.test', addresses: [{ address: PUBLIC_ADDRESS, family: 4 }] });
    // The pinned connection answers the checked name with the checked address, without asking DNS again.
    const pinned = await new Promise<string>((resolve, reject) => {
      const lookup = (fetches[0].init?.dispatcher as any).target ? (fetches[0].init?.dispatcher as any) : null;
      if (!lookup) { reject(new Error('no dispatcher')); return; }
      import('../src/core/security/outbound-address').then(({ pinnedLookup }) => {
        pinnedLookup(lookup.target)('rebind.v99h.test', {}, (err: unknown, address: unknown) => (err ? reject(err) : resolve(String(address))));
      }, reject);
    });
    expect(pinned).toBe(PUBLIC_ADDRESS);
    expect(lookups).toEqual(['rebind.v99h.test']);
    resetRecords();

    // The asset of the contract on a public host.
    hostAnswers = { [PUBLIC_HOST]: () => text('v99h public asset') };
    const asset = await runTool({ contractId: ID.contractAssetPublic });
    expect(asset.ok, JSON.stringify((asset as any).error?.message)).toBe(true);
    expect((asset as any).value).toMatchObject({ source: 'asset', total: 1 });
    expect(fetches[0].init?.dispatcher).toBeInstanceOf(PinnedDispatcher);
  });

  it('CF-06 a refusal is final: the plan queue answers it once and counts it toward no circuit; a public host that did not answer stays a retried, counted failure, and one that refused is the final 400 it was', async () => {
    const refusedDispatcher = makeDispatcher();
    const refused = await refusedDispatcher.dispatch({ businessId: ID.biz, toolName: TOOL, args: { contractId: ID.contract, url: 'http://169.254.169.254/latest/meta-data/' }, retryCount: 2 });
    expect(refused).toMatchObject({ success: false, error: REFUSAL });
    expect(fetches).toEqual([]);
    expect(refusedDispatcher.getCircuitStatus(TOOL, ID.biz)).toEqual(CLOSED);
    resetRecords();

    for (const status of [500, 503, 408, 429]) {
      for (const [args, message] of [
        [{ contractId: ID.contract, url: `https://${PUBLIC_HOST}/contract.pdf` }, `Could not fetch document URL (${status})`],
        [{ contractId: ID.contractAssetPublic }, NO_SOURCE],
      ] as Array<[Record<string, unknown>, string]>) {
        const label = `${JSON.stringify(args)} ${status}`;
        hostAnswers = { [PUBLIC_HOST]: () => text('down', status) };
        const outcome = await runTool(args);
        expect(outcome.ok, label).toBe(false);
        expect(outcome.error, label).toBeInstanceOf(ServiceUnavailableException);
        expect((outcome.error as Error).message, label).toBe(message);
        resetRecords();

        hostAnswers = { [PUBLIC_HOST]: () => text('down', status) };
        const dispatcher = makeDispatcher();
        expect(await dispatcher.dispatch({ businessId: ID.biz, toolName: TOOL, args, retryCount: 2 }), label).toMatchObject({ success: false, error: message });
        expect(fetches, label).toHaveLength(3);
        expect(dispatcher.getCircuitStatus(TOOL, ID.biz), label).toMatchObject({ open: false, failures: 1 });
        resetRecords();
      }
    }

    hostAnswers = { [PUBLIC_HOST]: () => text('missing', 404) };
    const missing = await runTool({ contractId: ID.contract, url: `https://${PUBLIC_HOST}/contract.pdf` });
    expect(missing.error).toBeInstanceOf(BadRequestException);
    expect((missing.error as Error).message).toBe('Could not fetch document URL (404)');
  });

  it('CF-07 a resolver that could not answer now (EAI_AGAIN) is no refusal: the plan queue retries it and counts it, as it did a failed fetch, and the answer names no address and no resolver code', async () => {
    const url = 'https://blip.v99h.test/contract.pdf';
    const direct = await runTool({ contractId: ID.contract, url });
    expect(direct.ok).toBe(false);
    expect(direct.error).not.toBeInstanceOf(HttpException);
    expect((direct.error as Error).message).not.toBe(REFUSAL);
    expect((direct.error as Error).message).not.toMatch(/EAI_AGAIN|blip/);
    expect(fetches).toEqual([]);
    resetRecords();

    const dispatcher = makeDispatcher();
    const answered = await dispatcher.dispatch({ businessId: ID.biz, toolName: TOOL, args: { contractId: ID.contract, url }, retryCount: 2 });
    expect(answered).toMatchObject({ success: false });
    expect(lookups, 'tried three times').toEqual([url, url, url].map(() => 'blip.v99h.test'));
    expect(dispatcher.getCircuitStatus(TOOL, ID.biz)).toMatchObject({ open: false, failures: 1 });
    expect(fetches).toEqual([]);
  });

  it('CF-08 the deadline of a document fetch (30 s in production) bounds resolving its host too', async () => {
    // Acceptance review correctness M4: the deadline is the service's documentFetchTimeoutMs, 30 s unless a
    // test shortens it; this case runs it at 300 ms against a lookup that answers after 5 s.
    expect(new ContractClauseServiceCtor(prisma, { get: () => undefined }).documentFetchTimeoutMs).toBe(30_000);
    clauses.documentFetchTimeoutMs = 300;
    const started = Date.now();
    let outcome: any;
    try {
      outcome = await runTool({ contractId: ID.contract, url: 'https://hang.v99h.test/contract.pdf' });
    } finally {
      clauses.documentFetchTimeoutMs = 30_000;
    }
    const elapsed = Date.now() - started;
    expect(outcome.ok).toBe(false);
    // The deadline's own failure (as a stalled fetch failed before the guard): no refusal, so the plan
    // queue retries and counts it (review round 2, correctness 1).
    // (executeToolDirectly hands on a failure that is no HttpException as a plain Error with its message.)
    expect(outcome.error).not.toBeInstanceOf(HttpException);
    expect((outcome.error as Error).message).toBe('The operation was aborted due to timeout');
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed, 'ended by the deadline, not by the lookup').toBeLessThan(3_000);
    expect(fetches).toEqual([]);
  });

  it('CF-09 an IPv4-translated address (::ffff:0:a.b.c.d) is refused on the contract path: literal, by name, after a redirect (acceptance review, security MINOR-1)', async () => {
    for (const url of ['http://[::ffff:0:7f00:1]/contract.pdf', 'http://[::ffff:0:a9fe:a9fe]/latest/meta-data/', 'http://xlat.v99h.test/latest/meta-data/']) {
      expectRefused(await runTool({ contractId: ID.contract, url }), url);
      expect(fetches.map((f) => f.url), url).toEqual([]);
      resetRecords();
    }
    hostAnswers = { [PUBLIC_HOST]: () => redirect('http://[::ffff:0:a9fe:a9fe]/latest/meta-data/') };
    expectRefused(await runTool({ contractId: ID.contract, url: `https://${PUBLIC_HOST}/contract.pdf` }), 'redirect');
    expect(fetches.map((f) => f.url)).toEqual([`https://${PUBLIC_HOST}/contract.pdf`]);
  });

  it('CF-10 a body the service does not read is cancelled (a non-ok answer on either fetch, a redirect), and every hop\'s dispatcher is closed, so a host that trickles holds no connection (acceptance review, correctness M1)', async () => {
    const cases: Array<[string, Record<string, unknown>, number]> = [];
    for (const status of [500, 503, 404, 403]) {
      cases.push([`url ${status}`, { contractId: ID.contract, url: `https://${PUBLIC_HOST}/contract.pdf` }, status]);
      cases.push([`asset ${status}`, { contractId: ID.contractAssetPublic }, status]);
    }
    for (const [label, args, status] of cases) {
      hostAnswers = { [PUBLIC_HOST]: () => trickling(label, status) };
      const started = Date.now();
      const outcome = await runTool(args);
      expect(outcome.ok, label).toBe(false);
      expect(Date.now() - started, `${label}: settles without waiting on the body`).toBeLessThan(5_000);
      expect(cancelled, label).toEqual([label]);
      expect(fetches.map((f) => (f.init?.dispatcher as any)?.closed), label).toEqual([true]);
      resetRecords();
    }

    // A redirect's body is cancelled and its hop's dispatcher closed, then the next hop's.
    hostAnswers = {
      [PUBLIC_HOST]: () => trickling('redirect', 302, { location: `https://${OTHER_PUBLIC_HOST}/final.pdf` }),
      [OTHER_PUBLIC_HOST]: () => text('v99h public contract'),
    };
    const followed = await runTool({ contractId: ID.contract, url: `https://${PUBLIC_HOST}/contract.pdf` });
    expect(followed.ok, JSON.stringify((followed as any).error?.message)).toBe(true);
    expect(cancelled).toEqual(['redirect']);
    expect(fetches.map((f) => (f.init?.dispatcher as any)?.closed)).toEqual([true, true]);
  });
});
