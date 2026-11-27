import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Response } from "express";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

/**
 * Lightweight handle representing an object stored in any S3-compatible
 * bucket (AWS S3, Cloudflare R2, MinIO, Supabase Storage, Wasabi, etc.).
 *
 * The shape mirrors the very small subset of `@google-cloud/storage`'s `File`
 * surface that the rest of the app actually used, so consumers compile
 * unchanged after the platform abstraction.
 */
export interface S3FileRef {
  bucket: string;
  key: string;
  /** Returns a flat metadata dict (user-defined `x-amz-meta-*` keys). */
  getMetadata(): Promise<Record<string, string>>;
  /** Replaces user-defined metadata via copy-in-place. */
  setMetadata(metadata: Record<string, string>): Promise<void>;
  exists(): Promise<boolean>;
  /** Streams object bytes plus content metadata. */
  read(): Promise<{
    body: Readable;
    contentType?: string;
    contentLength?: number;
  }>;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
  publicUrl?: string;
}

function readS3Config(): S3Config {
  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  const region = process.env.S3_REGION?.trim() || "us-east-1";
  const bucket = process.env.S3_BUCKET?.trim() || "";
  const accessKeyId =
    process.env.S3_ACCESS_KEY_ID?.trim() ||
    process.env.AWS_ACCESS_KEY_ID?.trim() ||
    undefined;
  const secretAccessKey =
    process.env.S3_SECRET_ACCESS_KEY?.trim() ||
    process.env.AWS_SECRET_ACCESS_KEY?.trim() ||
    undefined;
  const forcePathStyle =
    (process.env.S3_FORCE_PATH_STYLE || "").toLowerCase() === "true" ||
    Boolean(endpoint && !endpoint.includes("amazonaws.com"));
  const publicUrl = process.env.S3_PUBLIC_URL?.trim() || undefined;

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
    publicUrl,
  };
}

let cachedClient: { client: S3Client; bucket: string } | null = null;
let cachedConfig: S3Config | null = null;

function getClient(): { client: S3Client; bucket: string; config: S3Config } {
  if (cachedClient && cachedConfig) {
    return { ...cachedClient, config: cachedConfig };
  }
  const config = readS3Config();
  if (!config.bucket) {
    throw new Error(
      "S3_BUCKET is not set. Configure object storage by setting " +
        "S3_BUCKET, S3_REGION, S3_ENDPOINT (optional), S3_ACCESS_KEY_ID and " +
        "S3_SECRET_ACCESS_KEY env vars. See MIGRATION.md for examples.",
    );
  }
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          }
        : undefined,
  });
  cachedClient = { client, bucket: config.bucket };
  cachedConfig = config;
  return { client, bucket: config.bucket, config };
}

function makeFileRef(bucket: string, key: string, client: S3Client): S3FileRef {
  return {
    bucket,
    key,
    async getMetadata() {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        return head.Metadata ?? {};
      } catch (err: any) {
        console.error(`Failed to read object metadata: ${(err as Error).message}`);
        return {};
      }
    },
    async setMetadata(metadata) {
      // S3 metadata is immutable — replace via copy-in-place.
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: key,
          CopySource: `/${bucket}/${encodeURIComponent(key)}`,
          Metadata: metadata,
          MetadataDirective: "REPLACE",
        }),
      );
    },
    async exists() {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        return true;
      } catch (err: unknown) {
        const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404) {
          return false;
        }
        throw err;
      }
    },
    async read() {
      const out = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      const body = out.Body as Readable;
      return {
        body,
        contentType: out.ContentType,
        contentLength:
          typeof out.ContentLength === "number" ? out.ContentLength : undefined,
      };
    },
  };
}

/**
 * FU-OUTBOUND-ATTACHMENT-URL review round 1 (S1-1): the most getObjectEntityBuffer
 * reads into memory (twice the 10 MB upload limit POST /uploads/request-url states).
 */
export const MAX_OBJECT_READ_BYTES = 20 * 1024 * 1024;

/** Bucket sub-directory (under PRIVATE_OBJECT_DIR) of client uploads, one folder per business. */
export const BUSINESS_UPLOAD_NAMESPACE = "uploads";

const SAFE_KEY_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;

/** One key segment: no slash, no dot or empty segment, no encoding tricks. */
export function isSafeKeySegment(segment: unknown): segment is string {
  return (
    typeof segment === "string" &&
    SAFE_KEY_SEGMENT.test(segment) &&
    segment !== "." &&
    segment !== ".."
  );
}

/**
 * True only for `/objects/uploads/<businessId>/<id>`, exactly: three safe
 * segments, the second equal to `businessId`.
 */
export function isObjectPathOfBusiness(
  objectPath: unknown,
  businessId: unknown,
): boolean {
  if (typeof objectPath !== "string" || !isSafeKeySegment(businessId)) {
    return false;
  }
  if (!objectPath.startsWith("/objects/")) return false;
  const segments = objectPath.slice("/objects/".length).split("/");
  return (
    segments.length === 3 &&
    segments[0] === BUSINESS_UPLOAD_NAMESPACE &&
    segments[1] === businessId &&
    isSafeKeySegment(segments[2])
  );
}

/** The path of an S3 endpoint URL without its slashes ("" for none or an unparsable endpoint). */
function endpointPathPrefix(endpoint: string | undefined): string {
  if (!endpoint) return "";
  try {
    return decodeURIComponent(new URL(endpoint).pathname).replace(/^\/+/, "").replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function trimSlashes(s: string): string {
  return s.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Service used by the rest of the app. The public surface mirrors the
 * original object-storage helper so existing callers
 * (`uploads.service.ts`, `routes.ts`) compile unchanged.
 */
export class ObjectStorageService {
  constructor() {}

  /**
   * Public search prefixes (e.g. `public/branding`).
   * Reads the same `PUBLIC_OBJECT_SEARCH_PATHS` env as before — but values
   * are now bucket-relative key prefixes, not GCS-style `/<bucket>/<path>`.
   */
  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((p) => trimSlashes(p.trim()))
          .filter((p) => p.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Set it to a comma-separated " +
          "list of bucket key prefixes (e.g. 'public/branding,public/avatars').",
      );
    }
    return paths;
  }

  /**
   * Bucket key prefix used for private uploads (e.g. `private/uploads`).
   */
  getPrivateObjectDir(): string {
    const dir = trimSlashes(process.env.PRIVATE_OBJECT_DIR || "");
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Set it to a bucket key prefix (e.g. 'private').",
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<S3FileRef | null> {
    const { client, bucket } = getClient();
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const key = `${searchPath}/${trimSlashes(filePath)}`;
      const ref = makeFileRef(bucket, key, client);
      if (await ref.exists()) {
        return ref;
      }
    }
    return null;
  }

  async downloadObject(
    file: S3FileRef,
    res: Response,
    cacheTtlSec: number = 3600,
  ) {
    try {
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";
      const { body, contentType, contentLength } = await file.read();

      res.set({
        "Content-Type": contentType || "application/octet-stream",
        "Cache-Control": `${
          isPublic ? "public" : "private"
        }, max-age=${cacheTtlSec}`,
      });
      if (typeof contentLength === "number") {
        res.set("Content-Length", String(contentLength));
      }

      body.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });
      body.pipe(res);
    } catch (error: any) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  /**
   * Returns a presigned PUT URL good for 15 minutes. The client uploads the
   * file directly to this URL.
   */
  async getObjectEntityUploadURL(businessId: string): Promise<string> {
    // FU-ATTACHMENT-OBJECT-TENANCY: the key names the business that asked for
    // it, so resolveObjectForBusiness can tell whose an object is.
    if (!isSafeKeySegment(businessId)) {
      throw new Error("A business id is required to issue an upload URL");
    }
    const { client, bucket } = getClient();
    const privateDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const key = `${privateDir}/${BUSINESS_UPLOAD_NAMESPACE}/${businessId}/${objectId}`;

    return await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 900 },
    );
  }

  /**
   * Server-side upload of an in-memory buffer to a deterministic key.
   * Returns the canonical `/objects/<id>` path the rest of the app uses.
   */
  async uploadBuffer(
    buffer: Buffer,
    opts: { contentType?: string; subdir?: string; filename?: string } = {},
  ): Promise<{ objectPath: string; key: string }> {
    const { client, bucket } = getClient();
    const privateDir = this.getPrivateObjectDir();
    const subdir = trimSlashes(opts.subdir || BUSINESS_UPLOAD_NAMESPACE);
    // FU-ATTACHMENT-OBJECT-TENANCY review round 3: `uploads/<businessId>/` is
    // the namespace resolveObjectForBusiness trusts as a client's own upload,
    // so a server-side write may not land in it, by name or by a dot or empty
    // segment a normalising store would fold into it. The bare default
    // (`uploads/<uuid>[_name]`) stays: two segments, refused by the resolver.
    const subdirSegments = subdir.split("/");
    if (
      !subdirSegments.every((seg) => isSafeKeySegment(seg)) ||
      (subdirSegments[0] === BUSINESS_UPLOAD_NAMESPACE && subdirSegments.length > 1)
    ) {
      throw new Error(`uploadBuffer: subdir "${subdir}" is not allowed`);
    }
    const objectId = randomUUID();
    const safeName = (opts.filename || "")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(0, 80);
    const tail = safeName ? `${objectId}_${safeName}` : objectId;
    const key = `${privateDir}/${subdir}/${tail}`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: opts.contentType || "application/octet-stream",
      }),
    );
    const entityId = `${subdir}/${tail}`;
    return { objectPath: `/objects/${entityId}`, key };
  }

  /**
   * Presigned GET URL for an object previously uploaded via uploadBuffer().
   * Default TTL = 1 hour.
   *
   * Server-trusted paths only (one the server just wrote): no business check.
   * A path from a client goes through resolveObjectForBusiness.
   */
  async getReadSignedUrl(
    objectPath: string,
    opts: { expiresIn?: number; downloadFilename?: string } = {},
  ): Promise<string> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const entityId = objectPath.slice("/objects/".length);
    const { client, bucket } = getClient();
    const privateDir = this.getPrivateObjectDir();
    const key = `${privateDir}/${entityId}`;
    return await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(opts.downloadFilename
          ? {
              ResponseContentDisposition: `attachment; filename="${opts.downloadFilename.replace(/"/g, "")}"`,
            }
          : {}),
      }),
      { expiresIn: opts.expiresIn ?? 3600 },
    );
  }

  /**
   * Server-trusted paths only: no business check. A path from a client (a
   * request body, a chat history, a stored field) goes through
   * resolveObjectForBusiness.
   */
  async getObjectEntityFile(objectPath: string): Promise<S3FileRef> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const entityId = objectPath.slice("/objects/".length);
    if (!entityId) {
      throw new ObjectNotFoundError();
    }

    const { client, bucket } = getClient();
    const privateDir = this.getPrivateObjectDir();
    const key = `${privateDir}/${entityId}`;
    const ref = makeFileRef(bucket, key, client);
    if (!(await ref.exists())) {
      throw new ObjectNotFoundError();
    }
    return ref;
  }

  /**
   * FU-ATTACHMENT-OBJECT-TENANCY: resolve an object path that came from a
   * client (a request body, a chat history, a stored field) for `businessId`.
   *
   * Honoured only for a canonical `/objects/uploads/<businessId>/<id>` path
   * issued to that business by getObjectEntityUploadURL. Anything else (another
   * business's object, an upload issued before uploads were bound to a business,
   * a server-side namespace such as accountant exports, a dot or empty segment,
   * a non-canonical form) throws the same ObjectNotFoundError as an object that
   * does not exist, before the bucket is asked, so a refusal does not reveal
   * whether the object exists. No owner or visibility rule exists for uploads
   * (no caller sets an ACL policy), so business is the boundary.
   */
  async resolveObjectForBusiness(
    objectPath: string,
    businessId: string,
  ): Promise<S3FileRef> {
    if (!isObjectPathOfBusiness(objectPath, businessId)) {
      throw new ObjectNotFoundError();
    }
    return this.getObjectEntityFile(objectPath);
  }

  /**
   * P222 (FU-RECEIPT-READ-ROUTE): inspect a client-supplied `/objects/...`
   * path for `businessId` via a single `HeadObjectCommand`. Fails closed with
   * `ObjectNotFoundError` before touching S3 when `objectPath` is outside
   * `businessId`'s upload namespace (zero existence oracle).
   */
  async statObjectForBusiness(
    objectPath: string,
    businessId: string,
  ): Promise<{ contentType?: string; contentLength?: number }> {
    if (!isObjectPathOfBusiness(objectPath, businessId)) {
      throw new ObjectNotFoundError();
    }
    const entityId = objectPath.slice("/objects/".length);
    const { client, bucket } = getClient();
    const privateDir = this.getPrivateObjectDir();
    const key = `${privateDir}/${entityId}`;
    try {
      const head = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return {
        contentType: head.ContentType,
        contentLength:
          typeof head.ContentLength === "number" ? head.ContentLength : undefined,
      };
    } catch (err: unknown) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (
        e?.name === "NotFound" ||
        e?.name === "NoSuchKey" ||
        e?.$metadata?.httpStatusCode === 404
      ) {
        throw new ObjectNotFoundError();
      }
      throw err;
    }
  }

  /**
   * Read a client-supplied `/objects/<id>` path into memory for `businessId`
   * (resolveObjectForBusiness): an object of another business reads as absent.
   */
  async getObjectEntityBuffer(objectPath: string, businessId: string): Promise<{
    buffer: Buffer;
    contentType?: string;
    contentLength?: number;
  }> {
    const ref = await this.resolveObjectForBusiness(objectPath, businessId);
    const { body, contentType, contentLength } = await ref.read();
    // FU-OUTBOUND-ATTACHMENT-URL review round 1 (S1-1): the presigned PUT does
    // not bound an upload's size, so an object over MAX_OBJECT_READ_BYTES is not
    // buffered: by its reported length, or once the stream passes the cap. It
    // reads as absent (the caller's own object; nothing to hide, nothing read).
    if (typeof contentLength === "number" && contentLength > MAX_OBJECT_READ_BYTES) {
      body.destroy();
      throw new ObjectNotFoundError();
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > MAX_OBJECT_READ_BYTES) {
        body.destroy();
        throw new ObjectNotFoundError();
      }
      chunks.push(buf);
    }
    return { buffer: Buffer.concat(chunks), contentType, contentLength };
  }

  /**
   * FU-OUTBOUND-ATTACHMENT-URL / P222: the canonical `/objects/...` path a
   * client URL names when it points at our storage, or null when it does not
   * (an external URL, or not a URL at all). Recognised: a `/objects/...` path;
   * a relative proxy path `/__api/objects/...`; an http(s) URL whose path
   * holds `/objects/...` (the web's `${API_BASE}/objects/...`); a bucket URL
   * under PRIVATE_OBJECT_DIR, signed or not (the query string is dropped).
   * The host is not trusted for anything: the path is only ever read through
   * resolveObjectForBusiness / statObjectForBusiness, so naming another host
   * gains nothing.
   */
  objectPathFromClientUrl(raw: unknown): string | null {
    if (typeof raw !== "string" || raw.length === 0) return null;
    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i);
      if (code <= 0x1f || code === 0x7f) return null;
    }
    if (raw.startsWith("/") && !raw.startsWith("//")) {
      if (raw.includes("\\")) return null;
      const pathOnly = raw.split(/[?#]/, 1)[0];
      const relMatch = /^\/(?:__api\/)?objects\//i.exec(pathOnly);
      if (relMatch) {
        return `/objects/${pathOnly.slice(relMatch[0].length)}`;
      }
      return null;
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const objectsMatch = /\/objects\//i.exec(url.pathname);
    if (objectsMatch) return `/objects/${url.pathname.slice(objectsMatch.index + objectsMatch[0].length)}`;
    try {
      const path = this.normalizeObjectEntityPath(`${url.origin}${url.pathname}`);
      return path.startsWith("/objects/") ? path : null;
    } catch {
      // Storage not configured, or a malformed %-escape: not ours.
      return null;
    }
  }

  /**
   * Convert a presigned/public S3 URL (or already-canonical `/objects/<id>`
   * path) into the canonical `/objects/<id>` path used everywhere in the app.
   */
  normalizeObjectEntityPath(rawPath: string): string {
    if (rawPath.startsWith("/objects/")) {
      return rawPath;
    }
    let url: URL;
    try {
      url = new URL(rawPath);
    } catch {
      // not a valid URL, return as-is
      return rawPath;
    }

    const privateDir = this.getPrivateObjectDir();
    let pathname = decodeURIComponent(url.pathname)
      .replace(/\/{2,}/g, "/")
      .replace(/^\/+/, "");

    // FU-OUTBOUND-ATTACHMENT-URL review round 1 (C1-3) & round 2 (SEC-FUOAU-2)
    // & P222 R2 (SEC-P222-8): an endpoint with a path (Supabase Storage:
    // https://<proj>.supabase.co/storage/v1/s3) prefixes every path-style URL
    // with it — collapse repeated slashes and strip it first.
    const { bucket, config } = getClient();
    const endpointPath = endpointPathPrefix(config.endpoint).replace(/\/{2,}/g, "/");
    if (endpointPath && pathname.startsWith(`${endpointPath}/`)) {
      pathname = pathname.slice(endpointPath.length + 1).replace(/^\/+/, "");
    }

    // Path-style URLs (MinIO, R2 with custom endpoint) include the bucket
    // name as the first segment — strip it and any repeated slashes.
    if (pathname.startsWith(`${bucket}/`)) {
      pathname = pathname.slice(bucket.length + 1).replace(/^\/+/, "");
    }

    if (!pathname.startsWith(`${privateDir}/`)) {
      // Not within our private dir — return raw path so caller can fall back.
      return `/${pathname}`;
    }

    const entityId = pathname.slice(privateDir.length + 1).replace(/^\/+/, "");
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/objects/")) {
      return normalizedPath;
    }
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: S3FileRef;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}
