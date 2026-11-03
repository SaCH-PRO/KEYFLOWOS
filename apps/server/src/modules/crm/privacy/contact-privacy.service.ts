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
import { Prisma } from '@prisma/client';
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
import { safeInterval } from '../../../core/scheduling/safe-interval';
import { schedulersDisabled } from '../../../core/config/env';

const DEFAULT_PURGE_INTERVAL_MS = 30 * 60_000;
const DEFAULT_GRACE_DAYS = 7;
const DOWNLOAD_TTL_SECONDS = 24 * 60 * 60; // signed-URL validity (1 day)
const EXPORT_TTL_DAYS = 7;

/**
 * What a GDPR purge sets on the Contact row (D-25, CF-48). Every field that
 * identifies or describes the person is cleared; the row keeps only its id,
 * business, status, ownership/visibility, timestamps and derived scores, so the
 * invoices, quotes and bookings retained below still have the row they
 * reference. Json columns are set to SQL NULL, `custom` and `tags` to empty.
 */
const ERASED_CONTACT_FIELDS = {
  firstName: null,
  lastName: null,
  displayName: null,
  email: null,
  emailNormalized: null,
  secondaryEmail: null,
  phone: null,
  phoneNormalized: null,
  secondaryPhone: null,
  whatsappNumber: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  timezone: null,
  language: null,
  companyName: null,
  jobTitle: null,
  department: null,
  industry: null,
  ageGroup: null,
  notesInternal: null,
  source: null,
  sourceDetail: null,
  segment: null,
  preferredChannel: null,
  bestChannel: null,
  bestChannelConfidence: null,
  bestTimeWindowJson: Prisma.DbNull,
  preferredServices: Prisma.DbNull,
  riskFlags: Prisma.DbNull,
  opportunities: Prisma.DbNull,
  nextBestAction: null,
  accountId: null,
  tags: [] as string[],
  custom: {},
};

/**
 * The basis on which a purge keeps the records that reference the contact:
 * invoices, quotes and bookings are financial and transaction records the
 * business must retain (GDPR Art. 17(3)(b), legal obligation).
 */
const PURGE_RETAINED_BASIS = 'legal_obligation:financial_records';
const PURGE_RETAINED_BASIS_DETAIL =
  'Invoices, quotes and bookings are retained as financial and transaction records ' +
  '(GDPR Art. 17(3)(b)); they keep referencing the anonymised, deleted contact row.';

/**
 * What the forget_purged entry says the purge did NOT sweep (CR-2): it erases
 * exactly the contact rows and the tables it counts, nothing more is claimed.
 */
const PURGE_NOT_SWEPT =
  'Records of other modules that reference the contact id and are not counted under erased or retained ' +
  '(for example messaging, campaigns, deals and journeys) are not swept by this purge.';

/** Audit action recording export bundle objects the purge could not delete from storage. */
const STORAGE_CLEANUP_FAILED_ACTION = 'forget_storage_cleanup_failed';

/**
 * A merge operation's repointedCounts reduced to its counts. The stored value
 * also carries `_deletedSnapshots` (whole rows of the duplicate, kept for the
 * undo), which a purge must not leave behind.
 */
function countsOnly(value: Prisma.JsonValue | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Prisma.DbNull;
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.startsWith('_') || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const count = (entry as Record<string, unknown>).count;
    if (typeof count === 'number') out[key] = count;
  }
  return out;
}

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
 *      during the window. After `purgeAt` a scheduled purge erases the
 *      contact's personal fields in place (and those of every duplicate
 *      merged into it), deletes its personal child rows, scrubs merge
 *      snapshots and the audit log, and records one `forget_purged`
 *      audit entry naming what was erased and what was retained and on
 *      which basis, all in a single transaction (D-25). The contact row
 *      itself stays, anonymised and soft-deleted: invoices, quotes and
 *      bookings reference it (ON DELETE NO ACTION) and are retained as
 *      financial records.
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
    if (schedulersDisabled()) {
      this.logger.log('Scheduler disabled (DISABLE_SCHEDULERS, KF_DISABLE_SCHEDULERS or NODE_ENV=test)');
      return;
    }
    if (process.env.DISABLE_FORGET_SCHEDULER === 'true') {
      this.logger.log('[ContactPrivacy] forget purge scheduler disabled via env');
      return;
    }
    this.intervalRef = safeInterval('ContactPrivacyService', DEFAULT_PURGE_INTERVAL_MS, () => this.runPurgeCycle(), this.logger);
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
      action: 'export_downloaded',
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
      // Bound to the same claim the purge takes (SEC-V138-2): only a request
      // that is still 'requested' and still names this contact can be
      // cancelled. If the purge committed after the read above, nothing
      // matches and the cancel aborts, so it can neither overwrite 'purged'
      // nor un-delete the anonymised row.
      const cancelled = await tx.contactForgetRequest.updateMany({
        where: { id: req.id, businessId: input.businessId, contactId: input.contactId, status: 'requested' },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      if (cancelled.count === 0) {
        throw new BadRequestException('Forget request is no longer open (already purged or cancelled)');
      }
      await tx.contact.updateMany({
        where: { id: input.contactId, businessId: input.businessId },
        data: { deletedAt: null },
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
  async runPurgeCycle(): Promise<{ purged: number; repaired: number }> {
    if (this.purgeRunning) return { purged: 0, repaired: 0 };
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
          if (await this.purgeOne(req.id, req.businessId, req.contactId)) purged += 1;
        } catch (err: any) {
          this.logger.warn(
            `[ContactPrivacy] purge failed request=${req.id} contact=${req.contactId}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (purged > 0) {
        this.logger.log(`[ContactPrivacy] purged ${purged} forgotten contacts`);
      }
      const repaired = await this.repairLegacyPurges();
      return { purged, repaired };
    } finally {
      this.purgeRunning = false;
    }
  }

  /**
   * Erase one forgotten contact (D-25, CF-48). In a single transaction:
   *
   *   1. claim the request (requested -> purged, detached, hashed, reason
   *      cleared); a request that is no longer 'requested', or whose grace
   *      period was renewed after the due list was read, is a no-op;
   *   2. erase the person: see eraseForgottenContact;
   *   3. write the forget_purged entry naming what was erased, what was
   *      retained and on which basis. It is mandatory: if it cannot be
   *      written, nothing above commits.
   *
   * The row is not deleted. `contact.delete` is a soft delete under the
   * soft-delete extension (the old purge recorded 'GDPR purge completed' over
   * a row that kept every personal field), and invoices and bookings reference
   * the row with ON DELETE NO ACTION because they are retained records.
   *
   * Returns true when this call purged the contact, false when the request
   * had already left 'requested'.
   */
  private async purgeOne(requestId: string, businessId: string, contactId: string): Promise<boolean> {
    const contactHash = this.audit.hashContact(businessId, contactId);
    const purgeStart = Date.now();

    const exportKeys = await this.prisma.client.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.contactForgetRequest.updateMany({
        where: { id: requestId, businessId, contactId, status: 'requested', purgeAt: { lte: now } },
        // The reason is free text an operator typed (often the subject's name
        // or email) and is readable from privacy-settings (SEC-V138-3).
        data: { status: 'purged', purgedAt: now, contactId: null, contactHash, reason: null },
      });
      if (claimed.count === 0) return null;
      return this.eraseForgottenContact(tx as unknown as Prisma.TransactionClient, { requestId, businessId, contactId, contactHash, now, purgeStart });
    });

    if (exportKeys === null) return false;
    await this.deleteExportBundles(requestId, businessId, contactHash, exportKeys);
    return true;
  }

  /**
   * CR-3: a request the pre-D-25 purge closed is 'purged' and detached
   * (contactId null), but that purge only soft-deleted the contact, so the row
   * and its child records kept every personal field. Such a request has no
   * forget_purged entry naming it (the old entry carried no entityId; the
   * current one always names its request). The hash is the only pointer back
   * to the row: hashContact is sha256("<businessId>:<contactId>"), recomputed
   * here in SQL and checked again in code before anything is erased.
   */
  private async repairLegacyPurges(): Promise<number> {
    let legacy: Array<{ requestId: string; businessId: string; contactId: string; contactHash: string; purgedAt: Date | null }>;
    try {
      legacy = await this.prisma.client.$queryRaw`
        SELECT r.id AS "requestId", r.business_id AS "businessId", c.id AS "contactId",
               r.contact_hash AS "contactHash", r.purged_at AS "purgedAt"
          FROM contact_forget_requests r
          JOIN contacts c
            ON c.business_id = r.business_id
           AND c.deleted_at IS NOT NULL
           AND r.contact_hash = 'sha256:' || encode(sha256(convert_to(c.business_id || ':' || c.id, 'UTF8')), 'hex')
         WHERE r.status = 'purged'
           AND r.contact_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM contact_audit_entries a
              WHERE a.business_id = r.business_id AND a.action = 'forget_purged' AND a.entity_id = r.id)
         LIMIT 50`;
    } catch (err: unknown) {
      this.logger.warn(`[ContactPrivacy] legacy purge lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }

    let repaired = 0;
    for (const row of legacy) {
      if (this.audit.hashContact(row.businessId, row.contactId) !== row.contactHash) continue;
      try {
        if (await this.repairLegacyPurge(row)) repaired += 1;
      } catch (err: unknown) {
        this.logger.warn(
          `[ContactPrivacy] legacy purge repair failed request=${row.requestId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (repaired > 0) {
      this.logger.log(`[ContactPrivacy] erased ${repaired} contacts an earlier purge had left intact`);
    }
    return repaired;
  }

  private async repairLegacyPurge(row: {
    requestId: string;
    businessId: string;
    contactId: string;
    contactHash: string;
    purgedAt: Date | null;
  }): Promise<boolean> {
    const purgeStart = Date.now();
    const exportKeys = await this.prisma.client.$transaction(async (tx) => {
      const now = new Date();
      // Claim on the purgedAt we read: a concurrent repair of the same request
      // re-evaluates this after the first commits and matches nothing.
      const claimed = await tx.contactForgetRequest.updateMany({
        where: {
          id: row.requestId,
          businessId: row.businessId,
          status: 'purged',
          contactId: null,
          contactHash: row.contactHash,
          purgedAt: row.purgedAt,
        },
        data: { purgedAt: now, reason: null },
      });
      if (claimed.count === 0) return null;
      return this.eraseForgottenContact(tx as unknown as Prisma.TransactionClient, {
        requestId: row.requestId,
        businessId: row.businessId,
        contactId: row.contactId,
        contactHash: row.contactHash,
        now,
        purgeStart,
        legacyPurgedAt: row.purgedAt,
      });
    });
    if (exportKeys === null) return false;
    await this.deleteExportBundles(row.requestId, row.businessId, row.contactHash, exportKeys);
    return true;
  }

  /**
   * The erasure itself, inside the caller's transaction, after it has claimed
   * the request:
   *
   *   1. erase the Contact row's personal fields IN THE REQUEST'S BUSINESS; a
   *      request naming another business's contact erases nothing and the
   *      claim rolls back;
   *   2. erase every contact merged into it, recursively, in the same business
   *      (SEC-V138-1): a merged duplicate is the same person, soft-deleted
   *      with every personal field intact;
   *   3. scrub the merge operations naming any of them (the duplicate snapshot
   *      and resolved fields hold both people's values) and close their undo
   *      window, so a revert cannot bring the person back;
   *   4. delete the personal child rows of all of them and blank import raw
   *      data;
   *   5. scrub their audit trails down to the hash;
   *   6. write the forget_purged entry.
   *
   * Returns the export bundle object keys to delete once the transaction has
   * committed.
   */
  private async eraseForgottenContact(
    tx: Prisma.TransactionClient,
    p: {
      requestId: string;
      businessId: string;
      contactId: string;
      contactHash: string;
      now: Date;
      purgeStart: number;
      legacyPurgedAt?: Date | null;
    },
  ): Promise<string[]> {
    const { requestId, businessId, contactId, contactHash, now } = p;

    // 1. Tenant-bound: the contact must belong to the request's business.
    const erased = await tx.contact.updateMany({
      where: { id: contactId, businessId },
      data: ERASED_CONTACT_FIELDS,
    });
    if (erased.count !== 1) {
      throw new NotFoundException(
        `Forget request ${requestId} names no contact of business ${businessId}; nothing was purged`,
      );
    }

    // 2. Merged duplicates. Raw SQL because the soft-delete extension hides
    //    deleted rows from findMany, and every merged duplicate is deleted.
    //    UNION (not UNION ALL) ends the walk on a cycle.
    const duplicateRows = await tx.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE merged(id) AS (
        SELECT id FROM contacts WHERE business_id = ${businessId} AND merged_into_id = ${contactId}
        UNION
        SELECT c.id FROM contacts c JOIN merged m ON c.merged_into_id = m.id WHERE c.business_id = ${businessId}
      )
      SELECT id FROM merged`;
    const duplicateIds = duplicateRows.map((r) => r.id).filter((id) => id !== contactId);
    if (duplicateIds.length > 0) {
      await tx.contact.updateMany({
        where: { id: { in: duplicateIds }, businessId },
        data: ERASED_CONTACT_FIELDS,
      });
    }
    const ids = [contactId, ...duplicateIds];
    // The request soft-deleted the subject; keep that deletedAt, or set one
    // where a row was restored outside the forget flow.
    await tx.contact.updateMany({
      where: { id: { in: ids }, businessId, deletedAt: null },
      data: { deletedAt: now },
    });

    // 3. Merge operations naming any of them: no personal values, no undo.
    const mergeOps = await tx.mergeOperation.findMany({
      where: { businessId, OR: [{ primaryId: { in: ids } }, { duplicateId: { in: ids } }] },
      select: { id: true, expiresAt: true, repointedCounts: true },
    });
    for (const op of mergeOps) {
      await tx.mergeOperation.update({
        where: { id: op.id },
        data: {
          // duplicate_snapshot is NOT NULL; an empty snapshot is also what
          // revertMerge refuses ('Merge snapshot is missing').
          duplicateSnapshot: {},
          resolvedFields: Prisma.DbNull,
          fieldOverrides: Prisma.DbNull,
          repointedCounts: countsOnly(op.repointedCounts),
          expiresAt: op.expiresAt.getTime() > now.getTime() ? now : op.expiresAt,
        },
      });
    }

    // 4. Personal child rows of the subject and its duplicates. None of these
    //    is a retained record.
    const byContact = { contactId: { in: ids }, businessId };
    const events = await tx.contactEvent.deleteMany({ where: byContact });
    const notes = await tx.contactNote.deleteMany({ where: byContact });
    const tasks = await tx.contactTask.deleteMany({ where: byContact });
    const media = await tx.contactMedia.deleteMany({ where: byContact });
    const customFieldValues = await tx.contactCustomFieldValue.deleteMany({ where: { contactId: { in: ids } } });
    const contactTags = await tx.contactTag.deleteMany({ where: { contactId: { in: ids } } });
    const exportJobs = await tx.contactExportJob.findMany({
      where: byContact,
      select: { jsonKey: true, zipKey: true },
    });
    const exportJobRows = await tx.contactExportJob.deleteMany({ where: byContact });
    const importRecords = await tx.contactImportContact.updateMany({
      where: { contactId: { in: ids } },
      data: { contactId: null, status: 'PURGED', rawData: {} },
    });
    // CR-2 / SEC-V138-3: corrected email/phone values, store customer ids,
    // free-text activity and task descriptions, relationship notes.
    const dataIssues = await tx.contactDataIssue.deleteMany({ where: byContact });
    const externalMappings = await tx.contactExternalMapping.deleteMany({ where: byContact });
    const crmActivities = await tx.crmActivity.deleteMany({ where: byContact });
    const crmTasks = await tx.crmTask.deleteMany({ where: byContact });
    const relationships = await tx.contactRelationship.deleteMany({
      where: { businessId, OR: [{ fromContactId: { in: ids } }, { toContactId: { in: ids } }] },
    });

    // 5. Scrub the audit trails: keep the entries (tamper-evident compliance
    //    evidence), anchored by each contact's hash only and carrying no
    //    personal data. A forget_purged entry carries none and is kept as is.
    const SCRUBBED = {
      contactId: null,
      before: {} as never,
      after: {} as never,
      actor: { type: 'SYSTEM', label: 'purged' } as never,
      reason: 'PII scrubbed on GDPR purge',
      ip: null,
      userAgent: null,
    };
    let auditEntriesScrubbed = 0;
    for (const id of ids) {
      const hash = id === contactId ? contactHash : this.audit.hashContact(businessId, id);
      const r = await tx.contactAuditEntry.updateMany({
        where: {
          businessId,
          OR: [{ contactId: id }, { contactHash: hash }],
          NOT: { action: { in: ['forget_purged', STORAGE_CLEANUP_FAILED_ACTION] } },
        },
        data: { ...SCRUBBED, contactHash: hash },
      });
      auditEntriesScrubbed += r.count;
    }

    // What stays, and why. aggregate() also counts soft-deleted rows (the
    // soft-delete extension filters count()), so these are every retained row.
    const invoices = await tx.invoice.aggregate({ where: byContact, _count: { _all: true } });
    const quotes = await tx.quote.aggregate({ where: byContact, _count: { _all: true } });
    const bookings = await tx.booking.aggregate({ where: byContact, _count: { _all: true } });

    const exportKeys = exportJobs.flatMap((job) => [job.jsonKey, job.zipKey]);
    const legacy = p.legacyPurgedAt !== undefined;
    await tx.contactAuditEntry.create({
      data: {
        businessId,
        contactId: null,
        contactHash,
        action: 'forget_purged',
        entityType: 'contact',
        entityId: requestId,
        actor: { type: 'SYSTEM', label: 'forget-purge' } as never,
        after: {
          retainedBasis: PURGE_RETAINED_BASIS,
          retainedBasisDetail: PURGE_RETAINED_BASIS_DETAIL,
          retained: {
            contactRow: 'anonymised',
            invoices: invoices._count._all,
            quotes: quotes._count._all,
            bookings: bookings._count._all,
          },
          erased: {
            contactFields: Object.keys(ERASED_CONTACT_FIELDS).length,
            mergedDuplicates: duplicateIds.length,
            mergeOperationsScrubbed: mergeOps.length,
            events: events.count,
            notes: notes.count,
            tasks: tasks.count,
            media: media.count,
            customFieldValues: customFieldValues.count,
            contactTags: contactTags.count,
            exportJobs: exportJobRows.count,
            importRecords: importRecords.count,
            dataIssues: dataIssues.count,
            externalMappings: externalMappings.count,
            crmActivities: crmActivities.count,
            crmTasks: crmTasks.count,
            relationships: relationships.count,
            auditEntriesScrubbed,
          },
          // Deleted from object storage after this transaction commits; a key
          // that cannot be deleted is recorded in a forget_storage_cleanup_failed entry.
          exportBundleObjects: exportKeys.length,
          // Honest scope: only what is counted above was swept.
          notSwept: PURGE_NOT_SWEPT,
          ...(legacy
            ? { legacyRepairOf: { previousPurgedAt: p.legacyPurgedAt?.toISOString() ?? null } }
            : {}),
          durationMs: Date.now() - p.purgeStart,
        } as never,
        reason: legacy
          ? 'GDPR purge repair: an earlier purge recorded erasure that had not happened; the contact, its merged duplicates and the records counted in erased are now erased; financial records retained (legal obligation)'
          : 'GDPR purge: the contact, its merged duplicates and the records counted in erased were erased; financial records retained (legal obligation)',
        changedFields: Object.keys(ERASED_CONTACT_FIELDS),
      },
    });
    return exportKeys;
  }

  /**
   * Delete export bundle objects once the purge has committed. A failure does
   * not fail the purge (the database erasure stands), but it is never silent
   * (SEC-V138-4): the job rows that held the keys are gone, so every key that
   * could not be deleted is logged and recorded in a
   * forget_storage_cleanup_failed audit entry, anchored by the hash and naming
   * the request, from which the cleanup can be retried.
   */
  private async deleteExportBundles(
    requestId: string,
    businessId: string,
    contactHash: string,
    keys: string[],
  ): Promise<void> {
    if (keys.length === 0) return;
    const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);
    const failed: Array<{ key: string; error: string }> = [];
    try {
      const { client, bucket } = this.s3();
      const results = await Promise.allSettled(
        keys.map((Key) => client.send(new DeleteObjectCommand({ Bucket: bucket, Key }))),
      );
      results.forEach((r, i) => {
        if (r.status === 'rejected') failed.push({ key: keys[i], error: message(r.reason) });
      });
    } catch (err: unknown) {
      for (const key of keys) failed.push({ key, error: message(err) });
    }
    if (failed.length === 0) return;

    this.logger.warn(
      `[ContactPrivacy] export bundle cleanup failed request=${requestId}: ${failed.length}/${keys.length} object(s) not deleted: ${failed.map((f) => `${f.key} (${f.error})`).join(', ')}`,
    );
    try {
      await this.prisma.client.contactAuditEntry.create({
        data: {
          businessId,
          contactId: null,
          contactHash,
          action: STORAGE_CLEANUP_FAILED_ACTION,
          entityType: 'contact',
          entityId: requestId,
          actor: { type: 'SYSTEM', label: 'forget-purge' } as never,
          after: { failedKeys: failed.map((f) => f.key), errors: failed.map((f) => f.error) } as never,
          reason: 'GDPR purge committed, but these export bundle objects could not be deleted from storage; delete them by key',
          changedFields: [],
        },
      });
    } catch (err: unknown) {
      this.logger.error(
        `[ContactPrivacy] could not record failed export bundle cleanup request=${requestId}: ${message(err)}`,
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
