/**
 * FU-OUTBOUND-ATTACHMENT-URL (P1): a client-supplied URL never goes to the document model as is.
 *
 * DocumentIntelligenceService.extractFromDocument put `req.url` into the provider request
 * (as `image_url`, or as "Document URL: <url>" text), and every caller filled it from the client:
 *  - flow chat's attachment fallback after an objectPath refusal (`att.url`);
 *  - POST /businesses/:id/expenses/extract-receipt (`body.url`);
 *  - payment evidence (`evidenceUrl`; the web sends the presigned PUT URL, query string and all,
 *    so a write-capable URL went to the provider);
 *  - POST /businesses/:id/agent/documents/process (`body.url`);
 *  - device capture auto-extraction (`publicUrl`), contract term extraction (`url`, `asset.url`).
 *
 * The rule, enforced once in extractFromDocument:
 *  - a URL that names one of our stored objects (a `/objects/...` path, a URL whose path holds
 *    `/objects/...`, or a bucket URL, signed or not) is honoured only when
 *    ObjectStorageService.resolveObjectForBusiness admits it for the request's business; the
 *    server then reads the bytes and sends them as content: no URL leaves the server;
 *  - any other URL is not forwarded: the request answers as for an absent file (no provider call);
 *  - contract term extraction keeps forwarding an external (not ours) URL: its form and its asset
 *    links take external documents today (reported, owner decision); an URL of ours is held to
 *    the same rule there too.
 *
 * On the in-memory S3 double of FU-ATTACHMENT-OBJECT-TENANCY (S3Client.send replaced; nothing
 * reaches a bucket, a network or a provider: the model gateway is a recording stub).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { posix } from 'node:path';
import { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { UploadsController } from '../src/modules/uploads/uploads.controller';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { DocumentIntelligenceService } from '../src/modules/ai/document-intelligence.service';
import { FlowOrchestratorService } from '../src/modules/ai/flow-orchestrator.service';
import { ExpensesController } from '../src/modules/expenses/expenses.controller';
import { AgentController } from '../src/modules/ai/agent.controller';
import { PaymentEvidenceService } from '../src/modules/commerce/payment-evidence.service';
import { ContractsService } from '../src/modules/contracts/contracts.service';

const P = 'v85u_';
const BIZ_A = `${P}biz_a`;
const BIZ_B = `${P}biz_b`;
const PRIVATE_DIR = 'private';
const BUCKET = `${P}bucket`;
const ENDPOINT = 'http://127.0.0.1:9';
const B_SECRET = `${P}B-PAYROLL-SECRET`;
const A_OWN = `${P}A-own-receipt-total-42`;
const EXTERNAL = `https://attacker.example/${P}probe.png?t=1`;

// ─── in-memory bucket (as in attachment-object-tenancy) ─────────────────────

const bucket = new Map<string, { body: Buffer; contentType?: string }>();
const norm = (key: string) => posix.normalize(key).replace(/^\/+/, '');
const ENV_KEYS = ['S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'PRIVATE_OBJECT_DIR'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.S3_BUCKET = BUCKET;
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_ENDPOINT = ENDPOINT; // never contacted: send() is replaced
  process.env.S3_ACCESS_KEY_ID = 'test-access-key';
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.PRIVATE_OBJECT_DIR = PRIVATE_DIR;
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (cmd: any) => {
    const key = norm(String(cmd.input?.Key ?? ''));
    if (cmd instanceof PutObjectCommand) {
      bucket.set(key, { body: Buffer.from(cmd.input.Body as any), contentType: cmd.input.ContentType });
      return {} as any;
    }
    const hit = bucket.get(key);
    if (cmd instanceof HeadObjectCommand) {
      if (!hit) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
      return { Metadata: {} } as any;
    }
    if (cmd instanceof GetObjectCommand) {
      if (!hit) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
      return { Body: Readable.from([hit.body]), ContentType: hit.contentType, ContentLength: hit.body.length } as any;
    }
    throw new Error(`unexpected S3 command in test: ${cmd?.constructor?.name}`);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => bucket.clear());

/** A member of `businessId` uploads `content` as the web client does; returns what the client holds. */
async function uploadAs(businessId: string, content: string) {
  const res = await new UploadsController(new UploadsService()).requestUploadUrl(businessId, { name: 'r.png', contentType: 'image/png' });
  const key = norm(decodeURIComponent(new URL(res.uploadURL).pathname).replace(/^\/+/, '').replace(`${BUCKET}/`, ''));
  bucket.set(key, { body: Buffer.from(content), contentType: 'image/png' });
  return {
    objectPath: res.objectPath,
    presignedPut: res.uploadURL,
    /** What KEY chat and device capture send: the PUT URL without its query string. */
    bucketUrl: res.uploadURL.split('?')[0],
    /** What the expense receipt form sends: `${API_BASE}${objectPath}`. */
    apiUrl: `http://127.0.0.1:9/api${res.objectPath}`,
  };
}

// ─── the document service with a recording provider ─────────────────────────

const MODEL_ANSWER = JSON.stringify({ documentType: 'receipt', confidence: 0.9, rawText: 'read', suggestedActions: [] });

function docIntelWithProvider() {
  const calls: any[] = [];
  const warn = vi.fn();
  const svc = Object.assign(Object.create(DocumentIntelligenceService.prototype), {
    logger: { warn, log: vi.fn(), error: vi.fn(), debug: vi.fn() },
    aiUsage: {
      trackAndComplete: vi.fn(async (_b: string, _u: unknown, _k: string, opts: any) => {
        calls.push(opts.messages);
        return { content: MODEL_ANSWER };
      }),
    },
    executionLog: { log: vi.fn(async () => undefined) },
    events: { emit: vi.fn() },
    moduleRef: { get: () => ({ parse: async () => { throw new Error('no docling in test'); } }) },
  }) as DocumentIntelligenceService;
  return { svc, calls, warn };
}

/** Everything the provider was sent, as one string. */
const sent = (calls: any[]) => JSON.stringify(calls);
/** The decoded bytes of every data: URL the provider was sent. */
function sentBytes(calls: any[]): string {
  const out: string[] = [];
  for (const m of JSON.stringify(calls).matchAll(/data:[^;"]+;base64,([A-Za-z0-9+/=]+)/g)) {
    out.push(Buffer.from(m[1], 'base64').toString('utf8'));
  }
  return out.join('\n');
}
const NO_URL = /https?:\/\/|\/objects\//;

const extract = (svc: DocumentIntelligenceService, businessId: string, url: string, mimeType = 'image/png') =>
  svc.extractFromDocument({ businessId, source: 'upload', mimeType, url, filename: 'r.png' });

// ─── tests ──────────────────────────────────────────────────────────────────

describe('FU-OUTBOUND-ATTACHMENT-URL: extractFromDocument never forwards a client URL', () => {
  it('an external URL is not sent to the provider; the request reads as an absent file', async () => {
    const { svc, calls } = docIntelWithProvider();
    const r = await extract(svc, BIZ_A, EXTERNAL);
    expect(sent(calls)).not.toContain('attacker.example');
    expect(calls).toHaveLength(0);
    expect(r).toMatchObject({ documentType: 'unknown', confidence: 0 });
  });

  it('an external URL is not sent as text either (non-image mime type)', async () => {
    const { svc, calls } = docIntelWithProvider();
    await extract(svc, BIZ_A, EXTERNAL, 'text/plain');
    expect(sent(calls)).not.toContain('attacker.example');
  });

  it("another business's bucket URL gives A none of B's bytes and sends no URL", async () => {
    const b = await uploadAs(BIZ_B, B_SECRET);
    for (const url of [b.bucketUrl, b.presignedPut, b.apiUrl, b.objectPath]) {
      const { svc, calls } = docIntelWithProvider();
      await extract(svc, BIZ_A, url);
      expect(sentBytes(calls), url).not.toContain(B_SECRET);
      expect(sent(calls), url).not.toMatch(NO_URL);
    }
  });

  it('a refused URL answers exactly like an absent object of our own (existence is not revealed)', async () => {
    const b = await uploadAs(BIZ_B, B_SECRET);
    const a = await uploadAs(BIZ_A, A_OWN);
    const absent = a.bucketUrl.replace(/[^/]+$/, `${P}absent`);
    const foreign = docIntelWithProvider();
    const missing = docIntelWithProvider();
    const r1 = await extract(foreign.svc, BIZ_A, b.bucketUrl);
    const r2 = await extract(missing.svc, BIZ_A, absent);
    expect(r1).toEqual(r2);
    expect(foreign.calls).toEqual(missing.calls);
    expect(foreign.warn.mock.calls).toEqual(missing.warn.mock.calls);
  });

  it("A's own upload, by any form the web client sends, is read by the server and sent as content, never as a URL", async () => {
    const a = await uploadAs(BIZ_A, A_OWN);
    for (const url of [a.bucketUrl, a.presignedPut, a.apiUrl, a.objectPath]) {
      const { svc, calls } = docIntelWithProvider();
      const r = await extract(svc, BIZ_A, url);
      expect(sentBytes(calls), url).toContain(A_OWN);
      expect(sent(calls), url).not.toMatch(NO_URL);
      expect(sent(calls), url).not.toContain('X-Amz-Signature');
      expect(r.documentType, url).toBe('receipt');
    }
  });
});

describe('FU-OUTBOUND-ATTACHMENT-URL: through each caller', () => {
  it('flow chat: an objectPath refusal does not fall back to forwarding att.url, and the warn log does not echo the client path', async () => {
    const b = await uploadAs(BIZ_B, B_SECRET);
    const { svc: docIntel, calls } = docIntelWithProvider();
    const warn = vi.fn();
    const flow = Object.assign(Object.create(FlowOrchestratorService.prototype), {
      logger: { warn, log: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getDocumentIntelligence: () => docIntel,
    });
    const probe = `${b.objectPath}<script>${'x'.repeat(500)}`;
    await (flow as any).buildAttachmentContext(BIZ_A, [
      { type: 'image', name: 'a.png', mimeType: 'image/png', objectPath: probe, url: EXTERNAL },
      { type: 'image', name: 'b.png', mimeType: 'image/png', objectPath: b.objectPath, url: b.bucketUrl },
    ]);
    expect(sent(calls)).not.toMatch(NO_URL);
    expect(sentBytes(calls)).not.toContain(B_SECRET);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('<script>');
    expect(logged).not.toContain(b.objectPath);
  });

  it('POST expenses/extract-receipt: the receipt URL the form sends is read server-side for A, refused for B, external not forwarded', async () => {
    const a = await uploadAs(BIZ_A, A_OWN);
    const b = await uploadAs(BIZ_B, B_SECRET);
    const run = async (url: string) => {
      const { svc, calls } = docIntelWithProvider();
      const ctl = Object.assign(Object.create(ExpensesController.prototype), { docIntel: svc }) as ExpensesController;
      await ctl.extractReceipt(BIZ_A, { url, filename: 'receipt.jpg' });
      return calls;
    };
    expect(sentBytes(await run(a.apiUrl))).toContain(A_OWN);
    expect(sentBytes(await run(b.apiUrl))).not.toContain(B_SECRET);
    for (const url of [a.apiUrl, b.apiUrl, EXTERNAL]) expect(sent(await run(url)), url).not.toMatch(NO_URL);
  });

  it('payment evidence (upload): the presigned PUT URL the web sends never reaches the provider', async () => {
    const a = await uploadAs(BIZ_A, A_OWN);
    const { svc, calls } = docIntelWithProvider();
    const pe = Object.assign(Object.create(PaymentEvidenceService.prototype), { docIntel: svc }) as PaymentEvidenceService;
    await pe.extractEvidence({ businessId: BIZ_A, evidenceUrl: a.presignedPut, evidenceMimeType: 'image/png', filename: 'p.png', source: 'upload' } as any);
    expect(sent(calls)).not.toContain('X-Amz-Signature');
    expect(sent(calls)).not.toMatch(NO_URL);
    expect(sentBytes(calls)).toContain(A_OWN);
  });

  it('POST agent/documents/process: an external URL is not forwarded', async () => {
    const { svc, calls } = docIntelWithProvider();
    const ctl = Object.assign(Object.create(AgentController.prototype), { docIntel: svc }) as AgentController;
    await ctl.processDocument(BIZ_A, { filename: 'x.png', mimeType: 'image/png', url: EXTERNAL });
    expect(sent(calls)).not.toContain('attacker.example');
  });

  /** ContractsService.extractTermsFromDocument, the route's method, with its contract lookups stubbed. */
  function contractsWith(svc: DocumentIntelligenceService) {
    return Object.assign(Object.create(ContractsService.prototype), {
      docIntel: svc,
      getContract: vi.fn(async () => ({ id: `${P}contract` })),
      applyExtractionResult: vi.fn(async () => undefined),
    }) as ContractsService;
  }
  const extractTerms = (c: ContractsService, url: string) =>
    c.extractTermsFromDocument(BIZ_A, `${P}contract`, { url, mimeType: 'image/png', filename: 'c.png' } as any).catch(() => undefined);

  it('contract terms: a URL of ours is held to the business rule (B refused, A read as content)', async () => {
    const a = await uploadAs(BIZ_A, A_OWN);
    const b = await uploadAs(BIZ_B, B_SECRET);
    for (const [url, own] of [[a.bucketUrl, true], [b.bucketUrl, false]] as const) {
      const { svc, calls } = docIntelWithProvider();
      await extractTerms(contractsWith(svc), url);
      expect(sent(calls), url).not.toMatch(NO_URL);
      if (own) expect(sentBytes(calls)).toContain(A_OWN);
      else expect(sentBytes(calls)).not.toContain(B_SECRET);
    }
  });

  it('contract terms: an external document URL is still forwarded (unchanged; owner decision reported)', async () => {
    const { svc, calls } = docIntelWithProvider();
    await extractTerms(contractsWith(svc), 'https://docs.example.com/contract.pdf');
    expect(sent(calls)).toContain('https://docs.example.com/contract.pdf');
  });

  it('the external-URL allowance is not reachable from the request object: only the contracts service grants it', async () => {
    const { svc, calls } = docIntelWithProvider();
    await svc.extractFromDocument({ businessId: BIZ_A, source: 'upload', mimeType: 'image/png', url: EXTERNAL, filename: 'x.png', forwardExternalUrl: true, allowExternalUrl: true } as any);
    expect(sent(calls)).not.toContain('attacker.example');
  });
});
