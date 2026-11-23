/**
 * FU-ATTACHMENT-OBJECT-TENANCY (P0): an object path from the client is honoured only for the
 * caller's own business.
 *
 * The hole: POST /ai/businesses/:businessId/flow/chat(/stream) takes body.attachments[].objectPath
 * and FlowOrchestratorService.buildAttachmentContext read it through
 * ObjectStorageService.getObjectEntityBuffer, which mapped any `/objects/<id>` to the bucket key
 * `<PRIVATE_OBJECT_DIR>/<id>` with no check on business. POST /uploads/request-url minted keys
 * `uploads/<uuid>` that carried no business at all, so nothing could tell whose an object was.
 * A member of business A who knew (from a shared avatar or logo, a log, a member of both) one of
 * business B's object paths had B's file read and extracted into A's KEY chat.
 *
 * Pinned here, through the real UploadsController, UploadsService, ObjectStorageService and
 * FlowOrchestratorService.buildAttachmentContext, on an in-memory S3 double (S3Client.send is
 * replaced; the presigner signs locally with dummy credentials; nothing reaches a bucket, a
 * network or a provider):
 *  - an issued upload path is bound to the business that asked for it;
 *  - business B's object, by its bound path, by its unbound legacy path, or reached by a dot
 *    segment from A's own namespace, is never read for A: the document service sees no bytes
 *    of it, and the turn reads exactly as for an object that does not exist;
 *  - A's own upload is still read and extracted as before.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { posix } from 'node:path';
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { resolveRequestBusinessId } from '../src/core/auth/request-business-id';
import { Readable } from 'node:stream';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { UploadsController } from '../src/modules/uploads/uploads.controller';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { ObjectStorageService } from '../src/core/object-storage';
import { FlowOrchestratorService } from '../src/modules/ai/flow-orchestrator.service';

const P = 'v77o_';
const BIZ_A = `${P}biz_a`;
const BIZ_B = `${P}biz_b`;
const PRIVATE_DIR = 'private';
const B_SECRET = `${P}B-PAYROLL-SECRET-do-not-leak`;
const A_OWN = `${P}A-own-receipt-total-42`;

// ─── in-memory bucket ───────────────────────────────────────────────────────

/**
 * Keys are normalised the way some S3-compatible stores (MinIO, gateways in front of R2) treat
 * dot segments, so a path that walks out of its namespace is modelled at its worst.
 */
const bucket = new Map<string, { body: Buffer; contentType?: string }>();
const norm = (key: string) => posix.normalize(key).replace(/^\/+/, '');

const ENV_KEYS = ['S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'PRIVATE_OBJECT_DIR'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.S3_BUCKET = `${P}bucket`;
  process.env.S3_REGION = 'us-east-1';
  // Never contacted: every send() is answered by the double below.
  process.env.S3_ENDPOINT = 'http://127.0.0.1:9';
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

// ─── helpers ────────────────────────────────────────────────────────────────

const controller = () => new UploadsController(new UploadsService());

/** A member of `businessId` asks for an upload URL and PUTs `content` to it, as the web client does. */
async function uploadAs(businessId: string, content: string): Promise<string> {
  const res = await controller().requestUploadUrl(businessId, { name: 'file.pdf', contentType: 'application/pdf' });
  const key = norm(decodeURIComponent(new URL(res.uploadURL).pathname).replace(/^\/+/, '').replace(`${process.env.S3_BUCKET}/`, ''));
  bucket.set(key, { body: Buffer.from(content), contentType: 'application/pdf' });
  return res.objectPath;
}

/** The pre-fix key shape (`uploads/<uuid>`, no business): an object issued before the fix. */
function putLegacy(content: string): string {
  const id = `uploads/${P}legacy-0b6f2c1e-4d1a-4f43-9a55-3c1f6e2f9b10`;
  bucket.set(`${PRIVATE_DIR}/${id}`, { body: Buffer.from(content), contentType: 'application/pdf' });
  return `/objects/${id}`;
}

interface Seen { calls: any[] }

function orchestrator(seen: Seen) {
  const warn = vi.fn();
  const docIntel = {
    extractFromDocument: vi.fn(async (input: any) => {
      seen.calls.push(input);
      const text = input.base64Content ? Buffer.from(input.base64Content, 'base64').toString('utf8') : '';
      return { documentType: 'other', rawText: text, confidence: 0 };
    }),
  };
  const svc = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: { warn, log: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getDocumentIntelligence: () => docIntel,
  });
  return { svc, warn };
}

async function attachAs(businessId: string, objectPath: string) {
  const seen: Seen = { calls: [] };
  const { svc, warn } = orchestrator(seen);
  const out: string = await (svc as any).buildAttachmentContext(businessId, [
    { type: 'document', name: 'statement.pdf', mimeType: 'application/pdf', objectPath },
  ]);
  return { out, calls: seen.calls, warn };
}

const sawBytes = (calls: any[], secret: string) =>
  calls.some((c) => c.base64Content && Buffer.from(c.base64Content, 'base64').toString('utf8').includes(secret));

/** The turn's text and the extraction input with the object path masked, to compare a refusal with an absent object. */
function shape(r: { out: string; calls: any[] }, path: string) {
  const mask = (s: string) => s.split(path).join('<PATH>');
  return { out: mask(r.out), calls: r.calls.map((c) => JSON.parse(mask(JSON.stringify(c)))) };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('FU-ATTACHMENT-OBJECT-TENANCY: upload paths are bound to the issuing business', () => {
  it("POST /uploads/request-url issues a path inside the caller's business namespace", async () => {
    const res = await controller().requestUploadUrl(BIZ_A, { name: 'x.pdf', contentType: 'application/pdf' });
    expect(res.objectPath).toMatch(/^\/objects\//);
    expect(res.objectPath.split('/')).toContain(BIZ_A);
    const signedKey = decodeURIComponent(new URL(res.uploadURL).pathname);
    expect(signedKey).toContain(`/${PRIVATE_DIR}${res.objectPath.slice('/objects'.length)}`);
  });

  it('a business id that is not one key segment is a 400, never a key (review round 1, 500 -> 400)', async () => {
    for (const bad of ['a/b', '..', '', ' x', 'x%2Fy']) {
      await expect(controller().requestUploadUrl(bad, {})).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it("the handler binds the tenant BusinessGuard checked (params, then body, then query), never another field (review round 2)", () => {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, UploadsController, 'requestUploadUrl') ?? {};
    const tenantArg = Object.values(args as Record<string, any>).find((a) => a.index === 0);
    expect(tenantArg?.factory, 'parameter 0 is a custom (GuardedBusinessId) decorator').toBeTypeOf('function');
    const ctx = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;
    const cases = [
      { body: { businessId: BIZ_A }, query: { businessId: BIZ_B } },
      { body: { businessId: 7 }, query: { businessId: BIZ_B } },
      { body: {}, query: { businessId: BIZ_B } },
      { params: { businessId: BIZ_A }, body: { businessId: BIZ_B } },
    ];
    for (const req of cases) {
      expect(tenantArg.factory(tenantArg.data, ctx(req))).toBe(resolveRequestBusinessId(req as any));
    }
  });

  it('two businesses never share an upload namespace', async () => {
    const a = await controller().requestUploadUrl(BIZ_A, {});
    const b = await controller().requestUploadUrl(BIZ_B, {});
    const dir = (p: string) => p.slice(0, p.lastIndexOf('/'));
    expect(dir(a.objectPath)).not.toBe(dir(b.objectPath));
  });
});

describe('FU-ATTACHMENT-OBJECT-TENANCY: the client upload namespace is written only by request-url (review round 3)', () => {
  it("a server-side write can not land in a business's client upload namespace", async () => {
    const storage = new ObjectStorageService();
    for (const subdir of [`uploads/${BIZ_A}`, `/uploads/${BIZ_A}/`, 'uploads/x', 'uploads']) {
      const res = await storage.uploadBuffer(Buffer.from(B_SECRET), { subdir }).catch((e: unknown) => e);
      if (res instanceof Error) continue;
      // Written: it must not be reachable as a client upload of any business.
      const path = (res as { objectPath: string }).objectPath;
      const r = await attachAs(BIZ_A, path);
      expect(sawBytes(r.calls, B_SECRET), `${subdir} -> ${path}`).toBe(false);
      expect(path.split('/').length, `${subdir} -> ${path}`).not.toBe(5);
    }
  });

  it('a subdir under uploads/, or with a dot or empty segment, is refused by name (review round 4)', async () => {
    const storage = new ObjectStorageService();
    for (const subdir of [`uploads/${BIZ_A}`, `/uploads/${BIZ_A}/`, 'uploads/x', `./uploads/${BIZ_A}`, `x/../uploads/${BIZ_A}`, `uploads//${BIZ_A}`]) {
      await expect(storage.uploadBuffer(Buffer.from(B_SECRET), { subdir }), subdir).rejects.toThrow(/is not allowed/);
    }
    expect([...bucket.values()].some((o) => o.body.toString('utf8') === B_SECRET)).toBe(false);
  });

  it('the default and the existing server namespaces still write', async () => {
    const storage = new ObjectStorageService();
    await expect(storage.uploadBuffer(Buffer.from('x'))).resolves.toHaveProperty('objectPath');
    await expect(storage.uploadBuffer(Buffer.from('x'), { subdir: `accountant-exports/${BIZ_A}`, filename: 'r.csv' })).resolves.toHaveProperty('objectPath');
  });
});

describe("FU-ATTACHMENT-OBJECT-TENANCY: flow chat never reads another business's object", () => {
  it("A's member attaching B's uploaded object gets none of B's bytes", async () => {
    const bPath = await uploadAs(BIZ_B, B_SECRET);
    const r = await attachAs(BIZ_A, bPath);
    expect(sawBytes(r.calls, B_SECRET)).toBe(false);
    expect(r.out).not.toContain(B_SECRET);
  });

  it("A's member attaching an unbound legacy object (no business in its key) gets none of its bytes", async () => {
    const legacy = putLegacy(B_SECRET);
    const r = await attachAs(BIZ_A, legacy);
    expect(sawBytes(r.calls, B_SECRET)).toBe(false);
    expect(r.out).not.toContain(B_SECRET);
  });

  it("a dot segment from A's own namespace does not reach B's object", async () => {
    const bPath = await uploadAs(BIZ_B, B_SECRET);
    const aPath = await uploadAs(BIZ_A, A_OWN);
    const aDir = aPath.slice('/objects/'.length, aPath.lastIndexOf('/'));
    const bRel = bPath.slice('/objects/'.length);
    const depth = aDir.split('/').length;
    const walk = `/objects/${aDir}/${'../'.repeat(depth)}${bRel}`;
    const r = await attachAs(BIZ_A, walk);
    expect(sawBytes(r.calls, B_SECRET)).toBe(false);
    expect(r.out).not.toContain(B_SECRET);
  });

  it("a refused object reads exactly like an object that does not exist (existence is not revealed)", async () => {
    const bPath = await uploadAs(BIZ_B, B_SECRET);
    // Absent in A's own namespace: a path A could legitimately hold, whose object is not there.
    const aPath = await uploadAs(BIZ_A, A_OWN);
    const missing = aPath.replace(/[^/]+$/, `${P}does-not-exist`);
    const foreign = await attachAs(BIZ_A, bPath);
    const absent = await attachAs(BIZ_A, missing);
    expect(shape(foreign, bPath)).toEqual(shape(absent, missing));
    expect(foreign.warn.mock.calls.length).toBe(absent.warn.mock.calls.length);
    const msg = (c: any[][]) => c.map((x) => String(x[0]));
    expect(msg(foreign.warn.mock.calls).map((m) => m.split(bPath).join('<PATH>')))
      .toEqual(msg(absent.warn.mock.calls).map((m) => m.split(missing).join('<PATH>')));
  });

  it("A's member attaching A's own upload still has it read and extracted", async () => {
    const aPath = await uploadAs(BIZ_A, A_OWN);
    const r = await attachAs(BIZ_A, aPath);
    expect(sawBytes(r.calls, A_OWN)).toBe(true);
    expect(r.out).toContain(A_OWN);
    expect(r.calls[0].source).toBe(aPath);
  });
});
