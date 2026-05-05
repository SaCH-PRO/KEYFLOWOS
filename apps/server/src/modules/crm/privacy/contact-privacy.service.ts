import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ObjectStorageService } from '../../../core/object-storage';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ContactAuditService,
  ContactAuditActor,
} from './contact-audit.service';
import { buildZip, sha256Hex } from './contact-zip.util';

const DEFAULT_PURGE_INTERVAL_MS = 30 * 60_000;
const DEFAULT_GRACE_DAYS = 7;
const DOWNLOAD_TTL_SECONDS = 24 * 60 * 60; // signed-URL validity (1 day)
const EXPORT_TTL_DAYS = 7;

/**
 * GDPR export & forget service (M7).
 *
 * Two flows:
 *
 *   1. **Export** — collects every row we hold about a contact
 *      (contact, communications/events, deals/quotes/invoices,
 *      bookings, notes, tasks, attachments/media, audit log, sequence
 *      enrollments), serialises to JSON, packages JSON + ZIP into
 *      object storage, returns a one-time signed download token, and
 *      writes an `exported` audit entry on each successful download.
 *
 *   2. **Forget** — soft-deletes the contact, opens a
 *      `ContactForgetRequest` with `purgeAt = now + graceDays` (per
 *      business setting; default 7), and lets the operator cancel
 *      during the window. After `purgeAt` a scheduled purge job hard-
 *      deletes the contact + child rows in a single transaction and
 *      replaces identifiers in the audit log with hashed placeholders
 *      so the compliance trail survives without PII.
 */
@Injectable()
export class ContactPrivacyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContactPrivacyService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private purgeRunning = false;
  private storage = new ObjectStorageService();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContactAuditService) private readonly audit: ContactAuditService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_FORGET_SCHEDULER === 'true') {
      this.logger.log('[ContactPrivacy] forget purge scheduler disabled via env');
      return;
    }
    this.intervalRef = setInterval(() => {
      void this.runPurgeCycle();
    }, DEFAULT_PURGE_INTERVAL_MS);
    this.logger.log(
      `[ContactPrivacy] forget purge scheduler started (interval=${DEFAULT_PURGE_INTERVAL_MS / 60_000}m)`,
    );
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  // ------------------------- Privacy settings -------------------------

  async getSettings(businessId: string) {
    const biz = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        forgetGraceDays: true,
        defaultForgetReason: true,
      },
    });
    if (!biz) throw new NotFoundException('Business not found');
    const recentForget = await this.prisma.client.contactForgetRequest.findMany({
      where: { businessId },
      orderBy: { requestedAt: 'desc' },
      take: 25,
    });
    return {
      forgetGraceDays: biz.forgetGraceDays,
      defaultForgetReason: biz.defaultForgetReason,
      recentForget,
    };
  }

  async updateSettings(input: {
    businessId: string;
    forgetGraceDays?: number;
    defaultForgetReason?: string | null;
  }) {
    const data: Record<string, unknown> = {};
    if (typeof input.forgetGraceDays === 'number') {
      if (input.forgetGraceDays < 0 || input.forgetGraceDays > 90) {
        throw new BadRequestException('forgetGraceDays must be between 0 and 90');
      }
      data.forgetGraceDays = input.forgetGraceDays;
    }
    if (input.defaultForgetReason !== undefined) {
      data.defaultForgetReason = input.defaultForgetReason?.slice(0, 500) || null;
    }
    if (Object.keys(data).length === 0) return this.getSettings(input.businessId);
    await this.prisma.client.business.update({
      where: { id: input.businessId },
      data,
    });
    return this.getSettings(input.businessId);
  }

  // ------------------------- Export flow -------------------------

  /**
   * Builds a JSON + ZIP export bundle for a single contact, uploads
   * both files to object storage, and returns a signed download URL.
   * The bundle is regenerated on each call so it always reflects
   * latest data.
   */
  async exportContact(input: {
    businessId: string;
    contactId: string;
    actor?: ContactAuditActor;
    ip?: string | null;
    userAgent?: string | null;
  }) {
    const bundle = await this.collectBundle(input.businessId, input.contactId);
    const json = JSON.stringify(bundle, null, 2);
    const jsonBuf = Buffer.from(json, 'utf8');
    const zipBuf = buildZip([
      { name: `contact-${input.contactId}/bundle.json`, data: jsonBuf },
      {
        name: `contact-${input.contactId}/README.txt`,
        data:
          `Keyflow GDPR contact export\n` +
          `Generated: ${new Date().toISOString()}\n` +
          `Contact ID: ${input.contactId}\n` +
          `Business ID: ${input.businessId}\n` +
          `SHA-256(bundle.json): ${sha256Hex(jsonBuf)}\n` +
          `\n` +
          `This archive contains every row we hold about this contact:\n` +
          `contact profile, communications, deals (quotes + invoices),\n` +
          `bookings, notes, tasks, attachments and the audit log.\n`,
      },
    ]);

    const token = randomBytes(32).toString('base64url');
    const stamp = Date.now();
    const jsonKey = this.storageKey(input.businessId, input.contactId, stamp, 'json');
    const zipKey = this.storageKey(input.businessId, input.contactId, stamp, 'zip');

    const { client, bucket } = this.s3();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: jsonKey,
        Body: jsonBuf,
        ContentType: 'application/json',
      }),
    );
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: zipKey,
        Body: zipBuf,
        ContentType: 'application/zip',
      }),
    );

    const expiresAt = new Date(Date.now() + EXPORT_TTL_DAYS * 24 * 60 * 60_000);
    const job = await this.prisma.client.contactExportJob.create({
      data: {
        businessId: input.businessId,
        contactId: input.contactId,
        requestedById: input.actor?.id ?? null,
        token,
        jsonKey,
        zipKey,
        byteSize: jsonBuf.length + zipBuf.length,
        expiresAt,
      },
    });

    await this.audit.write({
      businessId: input.businessId,
      contactId: input.contactId,
      action: 'exported',
      entityType: 'contact',
      entityId: job.id,
      actor: input.actor ?? { type: 'SYSTEM' },
      reason: 'GDPR export bundle generated',
      ip: input.ip,
      userAgent: input.userAgent,
      after: { jobId: job.id, byteSize: job.byteSize, expiresAt: job.expiresAt },
    });

    return {
      jobId: job.id,
      token,
      expiresAt,
      byteSize: job.byteSize,
      sha256: sha256Hex(jsonBuf),
      filename: `contact-${input.contactId}.zip`,
    };
  }

  /**
   * Resolve a download token to a short-lived presigned URL for the
   * requested format ("zip" or "json"). Records a `download` audit
   * entry on each call.
   */
  async resolveDownload(input: {
    token: string;
    format?: 'zip' | 'json';
    ip?: string | null;
    userAgent?: string | null;
  }) {
    const job = await this.prisma.client.contactExportJob.findUnique({
      where: { token: input.token },
    });
    if (!job) throw new NotFoundException('Download not found');
    if (job.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException('Download link has expired');
    }
    if (job.consumedAt) {
      throw new NotFoundException('Download link already used');
    }
    if (job.downloadCount >= job.maxDownloads) {
      throw new NotFoundException('Download link already used');
    }
    const format = input.format ?? 'zip';
    const key = format === 'json' ? job.jsonKey : job.zipKey;
    const contentType = format === 'json' ? 'application/json' : 'application/zip';
    const filename =
      format === 'json'
        ? `contact-${job.contactId}.json`
        : `contact-${job.contactId}.zip`;

    const { client, bucket } = this.s3();
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
      }),
      { expiresIn: 300 }, // signed URL valid 5 minutes
    );

    const now = new Date();
    const willConsume = job.downloadCount + 1 >= job.maxDownloads;
    await this.prisma.client.contactExportJob.update({
      where: { id: job.id },
      data: {
        downloadCount: { increment: 1 },
        lastDownloadedAt: now,
        consumedAt: willConsume ? now : undefined,
      },
    });

    // Audit each download separately so abuse is visible.
    await this.audit.write({
      businessId: job.businessId,
      contactId: job.contactId,
      action: 'exported',
      entityType: 'contact',
      entityId: job.id,
      actor: { type: 'SYSTEM', label: 'export-download' },
      reason: `download (${format})`,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return { url, contentType, filename, expiresInSeconds: 300, ttlSeconds: DOWNLOAD_TTL_SECONDS };
  }

  // ------------------------- Forget flow -------------------------

  async requestForget(input: {
    businessId: string;
    contactId: string;
    reason?: string | null;
    actor?: ContactAuditActor;
    ip?: string | null;
    userAgent?: string | null;
  }) {
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: input.contactId, businessId: input.businessId },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    const biz = await this.prisma.client.business.findUnique({
      where: { id: input.businessId },
      select: { forgetGraceDays: true, defaultForgetReason: true },
    });
    const graceDays = biz?.forgetGraceDays ?? DEFAULT_GRACE_DAYS;
    const reason = (input.reason || biz?.defaultForgetReason || null)?.slice(0, 500) || null;
    const purgeAt = new Date(Date.now() + graceDays * 24 * 60 * 60_000);

    const existing = await this.prisma.client.contactForgetRequest.findUnique({
      where: { contactId: input.contactId },
    });
    if (existing && existing.status === 'requested') {
      return existing;
    }

    const contactHash = this.audit.hashContact(input.businessId, input.contactId);
    const result = await this.prisma.client.$transaction(async (tx) => {
      // Soft-delete the contact (recoverable until purgeAt).
      await tx.contact.update({
        where: { id: input.contactId },
        data: { deletedAt: new Date() },
      });
      const upserted = await tx.contactForgetRequest.upsert({
        where: { contactId: input.contactId },
        create: {
          businessId: input.businessId,
          contactId: input.contactId,
          contactHash,
          requestedById: input.actor?.id ?? null,
          reason,
          status: 'requested',
          purgeAt,
        },
        update: {
          status: 'requested',
          contactHash,
          requestedById: input.actor?.id ?? null,
          reason,
          purgeAt,
          requestedAt: new Date(),
          purgedAt: null,
          cancelledAt: null,
        },
      });
      return upserted;
    });

    await this.audit.write({
      businessId: input.businessId,
      contactId: input.contactId,
      action: 'forget_requested',
      actor: input.actor ?? { type: 'SYSTEM' },
      reason,
      ip: input.ip,
      userAgent: input.userAgent,
      after: { purgeAt, graceDays },
    });

    return result;
  }

  async cancelForget(input: {
    businessId: string;
    contactId: string;
    actor?: ContactAuditActor;
    ip?: string | null;
    userAgent?: string | null;
  }) {
    const req = await this.prisma.client.contactForgetRequest.findUnique({
      where: { contactId: input.contactId },
    });
    if (!req || req.businessId !== input.businessId) {
      throw new NotFoundException('Forget request not found');
    }
    if (req.status !== 'requested') {
      throw new BadRequestException(`Forget request already ${req.status}`);
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.contact.update({
        where: { id: input.contactId },
        data: { deletedAt: null },
      });
      await tx.contactForgetRequest.update({
        where: { id: req.id },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
    });

    await this.audit.write({
      businessId: input.businessId,
      contactId: input.contactId,
      action: 'forget_cancelled',
      actor: input.actor ?? { type: 'SYSTEM' },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return { ok: true };
  }

  /** Run-once helper exposed for ops + tests. */
  async runPurgeCycle(): Promise<{ purged: number }> {
    if (this.purgeRunning) return { purged: 0 };
    this.purgeRunning = true;
    try {
      const due = await this.prisma.client.contactForgetRequest.findMany({
        where: { status: 'requested', purgeAt: { lte: new Date() } },
        take: 50,
      });
      let purged = 0;
      for (const req of due) {
        if (!req.contactId) continue; // already detached from a purged contact
        try {
          await this.purgeOne(req.businessId, req.contactId);
          purged += 1;
        } catch (err) {
          this.logger.warn(
            `[ContactPrivacy] purge failed contact=${req.contactId}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (purged > 0) {
        this.logger.log(`[ContactPrivacy] purged ${purged} forgotten contacts`);
      }
      return { purged };
    } finally {
      this.purgeRunning = false;
    }
  }

  /**
   * Hard-delete a contact and all its child rows; scrub identifiers
   * in the audit log (replace contactId + actor PII with hashed
   * placeholders) so the compliance trail survives without leaking
   * PII. Performed in a single transaction.
   */
  private async purgeOne(businessId: string, contactId: string): Promise<void> {
    const contactHash = this.audit.hashContact(businessId, contactId);
    const purgeStart = Date.now();
    const expiredJobs = await this.prisma.client.contactExportJob.findMany({
      where: { contactId },
      select: { id: true, jsonKey: true, zipKey: true },
    });

    await this.prisma.client.$transaction(async (tx) => {
      // Snapshot child counts before deletion (for audit metadata).
      const counts = {
        events: await tx.contactEvent.count({ where: { contactId } }),
        notes: await tx.contactNote.count({ where: { contactId } }),
        tasks: await tx.contactTask.count({ where: { contactId } }),
        media: await tx.contactMedia.count({ where: { contactId } }),
        invoices: await tx.invoice.count({ where: { contactId } }),
        quotes: await tx.quote.count({ where: { contactId } }),
        bookings: await tx.booking.count({ where: { contactId } }),
      };

      // Scrub identifiers in the audit log: keep the entries (they are
      // tamper-evident compliance evidence) but null out direct PII so
      // the contact is unrecoverable from this table.
      await tx.contactAuditEntry.updateMany({
        where: { contactId },
        data: {
          contactId: null,
          before: {} as never,
          after: {} as never,
          actor: { type: 'SYSTEM', label: 'purged' } as never,
          reason: 'PII scrubbed on GDPR purge',
        },
      });

      // Hard-delete child rows. Order matters where foreign keys
      // restrict (most use ON DELETE CASCADE so contact.delete would
      // suffice, but explicit deletes give us confidence under strict
      // FK constraints we don't fully control here).
      await tx.contactImportContact.updateMany({
        where: { contactId },
        data: { contactId: null, status: 'PURGED' },
      });
      await tx.contactExportJob.deleteMany({ where: { contactId } });
      // Decouple the forget request from the contact BEFORE we delete
      // the contact so the request survives the hard-purge for
      // compliance review (status=purged, contactId=null, hash kept).
      await tx.contactForgetRequest.update({
        where: { contactId },
        data: {
          status: 'purged',
          purgedAt: new Date(),
          contactId: null,
          contactHash,
        },
      });

      // The Contact row owns CASCADEs for events / notes / tasks /
      // media / quotes / invoices / bookings — deleting it cleans
      // those up automatically.
      await tx.contact.delete({ where: { id: contactId } });

      // Final audit entry, anchored only by the hash.
      await tx.contactAuditEntry.create({
        data: {
          businessId,
          contactId: null,
          contactHash,
          action: 'forget_purged',
          entityType: 'contact',
          actor: { type: 'SYSTEM', label: 'forget-purge' } as never,
          after: { ...counts, durationMs: Date.now() - purgeStart } as never,
          reason: 'GDPR purge completed',
          changedFields: [],
        },
      });
    });

    // Best-effort cleanup of export bundles in object storage.
    if (expiredJobs.length > 0) {
      const { client, bucket } = this.s3();
      await Promise.allSettled(
        expiredJobs.flatMap((job) => [
          client.send(new DeleteObjectCommand({ Bucket: bucket, Key: job.jsonKey })),
          client.send(new DeleteObjectCommand({ Bucket: bucket, Key: job.zipKey })),
        ]),
      );
    }
  }

  // ------------------------- Helpers -------------------------

  private async collectBundle(businessId: string, contactId: string) {
    const c = this.prisma.client;
    const [contact, events, notes, tasks, media, quotes, invoices, bookings, audit, sequences] =
      await Promise.all([
        c.contact.findFirst({ where: { id: contactId, businessId } }),
        c.contactEvent.findMany({ where: { contactId, businessId }, orderBy: { createdAt: 'desc' } }),
        c.contactNote.findMany({ where: { contactId, businessId }, orderBy: { createdAt: 'desc' } }),
        c.contactTask.findMany({ where: { contactId, businessId }, orderBy: { createdAt: 'desc' } }),
        c.contactMedia.findMany({ where: { contactId, businessId } }),
        c.quote.findMany({ where: { contactId, businessId } }),
        c.invoice.findMany({ where: { contactId, businessId } }),
        c.booking.findMany({ where: { contactId, businessId } }),
        c.contactAuditEntry.findMany({
          where: { contactId, businessId },
          orderBy: { createdAt: 'desc' },
          take: 5000,
        }),
        c.crmSequenceEnrollment.findMany({ where: { contactId } }).catch(() => []),
      ]);
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return {
      meta: {
        format: 'keyflow.contact-export.v1',
        generatedAt: new Date().toISOString(),
        businessId,
        contactId,
      },
      contact,
      communications: events,
      notes,
      tasks,
      attachments: media,
      deals: { quotes, invoices },
      bookings,
      sequenceEnrollments: sequences,
      auditLog: audit,
    };
  }

  private storageKey(businessId: string, contactId: string, stamp: number, ext: 'json' | 'zip'): string {
    const dir = (process.env.PRIVATE_OBJECT_DIR || 'private').replace(/^\/+|\/+$/g, '');
    return `${dir}/contact-exports/${businessId}/${contactId}/${stamp}.${ext}`;
  }

  private s3Client: { client: S3Client; bucket: string } | null = null;
  private s3(): { client: S3Client; bucket: string } {
    if (this.s3Client) return this.s3Client;
    const bucket = process.env.S3_BUCKET?.trim() || '';
    if (!bucket) {
      throw new Error('S3_BUCKET not configured for contact export storage');
    }
    const region = process.env.S3_REGION?.trim() || 'us-east-1';
    const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
    const accessKeyId =
      process.env.S3_ACCESS_KEY_ID?.trim() || process.env.AWS_ACCESS_KEY_ID?.trim() || undefined;
    const secretAccessKey =
      process.env.S3_SECRET_ACCESS_KEY?.trim() || process.env.AWS_SECRET_ACCESS_KEY?.trim() || undefined;
    const forcePathStyle =
      (process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true' ||
      Boolean(endpoint && !endpoint.includes('amazonaws.com'));
    const client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    });
    this.s3Client = { client, bucket };
    return this.s3Client;
  }
}

// keep imported sha256 referenced even if unused above
void createHash;
