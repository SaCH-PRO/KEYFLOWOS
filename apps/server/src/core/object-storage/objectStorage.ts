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
 * unchanged after the Replit-sidecar removal.
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
      } catch (err) {
        // eslint-disable-next-line no-console
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

function trimSlashes(s: string): string {
  return s.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Service used by the rest of the app. The public surface mirrors the
 * pre-decoupling Replit object-storage helper so existing callers
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
    } catch (error) {
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
  async getObjectEntityUploadURL(): Promise<string> {
    const { client, bucket } = getClient();
    const privateDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const key = `${privateDir}/uploads/${objectId}`;

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
    const subdir = trimSlashes(opts.subdir || "uploads");
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
   * Convert a presigned/public S3 URL (or already-canonical `/objects/...`
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
    let pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");

    // Path-style URLs (MinIO, R2 with custom endpoint) include the bucket
    // name as the first segment — strip it.
    const { bucket } = getClient();
    if (pathname.startsWith(`${bucket}/`)) {
      pathname = pathname.slice(bucket.length + 1);
    }

    if (!pathname.startsWith(`${privateDir}/`)) {
      // Not within our private dir — return raw path so caller can fall back.
      return `/${pathname}`;
    }

    const entityId = pathname.slice(privateDir.length + 1);
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
