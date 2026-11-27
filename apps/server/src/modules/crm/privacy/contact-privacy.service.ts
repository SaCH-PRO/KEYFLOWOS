import {
  BadRequestException,
  ConflictException,
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
import { contactIdentityViolation } from '../crm.service';
import { contactWhereBase } from '../crm.helpers';
import { resolveCrmAccess, visibilityClause } from '../crm-permissions.helper';
import { safeInterval } from '../../../core/scheduling/safe-interval';
import { schedulersDisabled } from '../../../core/config/env';
import {
  CONTACT_CHILD_ROUTES,
  CONTACT_REFERENCE_KEYS,
  CONTACT_ROUTE_PREFIX,
  FORGOTTEN_EVENT_METADATA_KEYS,
  KEY_BUS_SOURCE,
} from '../../business-events/business-event.service';

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
  '(for example messaging, campaigns, deals and journeys) are not swept by this purge. Business events are ' +
  'swept when their subject is the contact, their route named it (routeContactId), or, for a contact ' +
  'subject or a CRM note, task or contact-child route, the server response snapshot names it at the top level ' +
  '(contactId, fromContactId, toContactId, targetContactId); so are the KEY cortex bus copies of such events. ' +
  'Events of the retained records (invoices, quotes, bookings) and other non-contact ' +
  'subjects are kept under the retained basis even when they carry its contactId, and events whose ' +
  'snapshot names the person only inside a nested structure ' +
  '(for example duplicate-check and import requests), or only in the request body (never read: a caller ' +
  'could plant a contact id there), are not reached and not swept; nor are rows written before routeContactId ' +
  'was recorded whose only pointer to the person was the route (outside the contact-child routes), nor the ' +
  'copies the KEY cortex bus keeps in cognitive_events.';

/** SQL: the route expression is a contact-child route (CONTACT_CHILD_ROUTES or under CONTACT_ROUTE_PREFIX). */
function childRoute(route: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(${route} = ANY(${[...CONTACT_CHILD_ROUTES]}::text[]) OR ${route} = ${CONTACT_ROUTE_PREFIX} OR ${route} LIKE ${`${CONTACT_ROUTE_PREFIX}/%`})`;
}

/**
 * V1-72 review round 2: the purge transaction scrubs the business's event log,
 * which no index narrows by snapshot key, so it may not run under Prisma's 5 s
 * interactive default; a timeout there would roll the whole erasure back on
 * every cycle.
 */
const PURGE_TX_OPTIONS = { maxWait: 10_000, timeout: 120_000 } as const;

/** Audit action recording export bundle objects the purge could not delete from storage. */
const STORAGE_CLEANUP_FAILED_ACTION = 'forget_storage_cleanup_failed';

/**
 * RR-RETENTION-EXPIRED-EXPORTS (V1-72, D-261): the retention sweep of contact
 * export bundles. An export job whose link expired more than
 * EXPORT_SWEEP_GRACE_MS ago, or whose downloads are used up, has its two
 * stored objects deleted on the purge cycle; the row is kept (it records that
 * an export happened: who, when, which contact) and one
 * `export_bundle_deleted` audit entry names the job, so the sweep never
 * selects it again. No schema change: the keys stay on the row.
 */
const EXPORT_BUNDLE_DELETED_ACTION = 'export_bundle_deleted';
const EXPORT_JOB_ENTITY_TYPE = 'contact_export_job';
const EXPORT_SWEEP_GRACE_MS = 24 * 60 * 60_000;
/** A consumed job waits this long after its last download: resolveDownload signs a 5-minute URL before it marks the job consumed. */
const EXPORT_CONSUMED_GRACE_MS = 15 * 60_000;
const EXPORT_SWEEP_BATCH = 100;

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
    // RR-PRIVACY-DELETED-CONTACT-GATES (R35, D-25): refuse soft-deleted or
    // forget-pending contacts before collecting child records, uploading
    // objects, or creating an export job. Read past the soft-delete extension
    // (tenant-scoped) so a deleted contact answers 409 CONTACT_DELETED while
    // an absent or foreign contact keeps answering 404 Contact not found.
    const statusRows = await this.prisma.client.$queryRaw<
      Array<{ id: string; deletedAt: Date | null; forgetStatus: string | null }>
    >`
      SELECT c.id, c.deleted_at AS "deletedAt", r.status AS "forgetStatus"
        FROM contacts c
        LEFT JOIN contact_forget_requests r
          ON r.contact_id = c.id
         AND r.business_id = c.business_id
         AND r.status = 'requested'
       WHERE c.id = ${input.contactId}
         AND c.business_id = ${input.businessId}`;
    if (statusRows.length === 0) {
      throw new NotFoundException('Contact not found');
    }
    if (statusRows[0].deletedAt !== null || statusRows[0].forgetStatus === 'requested') {
      throw new ConflictException({
        code: 'CONTACT_DELETED',
        message: 'Cannot export a soft-deleted or forget-pending contact; restore the contact first',
      });
    }

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
    const biz = await this.prisma.client.business.findUnique({
      where: { id: input.businessId },
      select: { forgetGraceDays: true, defaultForgetReason: true },
    });
    const graceDays = biz?.forgetGraceDays ?? DEFAULT_GRACE_DAYS;
    const reason = (input.reason || biz?.defaultForgetReason || null)?.slice(0, 500) || null;
    const purgeAt = new Date(Date.now() + graceDays * 24 * 60 * 60_000);
    const contactHash = this.audit.hashContact(input.businessId, input.contactId);

    const result = await this.prisma.client.$transaction(async (tx) => {
      // Serialize concurrent requestForget calls and read past softDeleteExtension
      // under a row lock so an already soft-deleted contact keeps its earlier
      // deletedAt while a concurrent second call on a live contact cannot corrupt
      // deletedByForget provenance or overwrite an open request (P163 R1 MAJOR-1/2/3).
      const lockedRows = await tx.$queryRaw<
        Array<{ id: string; deletedAt: Date | null; mergedIntoId: string | null }>
      >`
        SELECT id, deleted_at AS "deletedAt", merged_into_id AS "mergedIntoId"
          FROM contacts
         WHERE id = ${input.contactId}
           AND business_id = ${input.businessId}
           FOR UPDATE`;
      if (lockedRows.length === 0 || lockedRows[0].mergedIntoId !== null) {
        throw new NotFoundException('Contact not found');
      }

      const existing = await tx.contactForgetRequest.findUnique({
        where: { contactId: input.contactId },
      });
      if (existing && existing.businessId === input.businessId && existing.status === 'requested') {
        return existing;
      }

      // purgeOne detaches contactId: null on purged requests while keeping
      // businessId + contactHash; check both so an already-purged contact can
      // never be re-opened for forget (P163 R1 MAJOR-2).
      const purged = await tx.contactForgetRequest.findFirst({
        where: { businessId: input.businessId, contactHash, status: 'purged' },
        select: { id: true },
      });
      if (purged || (existing && existing.status === 'purged')) {
        throw new BadRequestException('Contact has already been purged');
      }

      const now = new Date();
      const priorDeletedAt = lockedRows[0].deletedAt;
      const deletedByForget = priorDeletedAt === null;

      if (deletedByForget) {
        await tx.contact.updateMany({
          where: { id: input.contactId, businessId: input.businessId, deletedAt: null },
          data: { deletedAt: now },
        });
      }

      const upserted = await tx.contactForgetRequest.upsert({
        where: { contactId: input.contactId },
        create: {
          businessId: input.businessId,
          contactId: input.contactId,
          contactHash,
          requestedById: input.actor?.id ?? null,
          reason,
          status: 'requested',
          requestedAt: now,
          purgeAt,
        },
        update: {
          status: 'requested',
          contactHash,
          requestedById: input.actor?.id ?? null,
          reason,
          purgeAt,
          requestedAt: now,
          purgedAt: null,
          cancelledAt: null,
        },
      });

      // Record provenance atomically inside the transaction bound to upserted.id
      // and requestedAt so cancelForget knows with certainty whether this forget
      // cycle caused the soft delete (R54 / RR-FORGET-CANCEL-KEEPS-PRIOR-DELETE).
      await this.audit.write(
        {
          businessId: input.businessId,
          contactId: input.contactId,
          action: 'forget_requested',
          entityId: upserted.id,
          actor: input.actor ?? { type: 'SYSTEM' },
          reason,
          ip: input.ip,
          userAgent: input.userAgent,
          after: {
            purgeAt,
            graceDays,
            requestedAt: now.toISOString(),
            deletedByForget,
            ...(priorDeletedAt ? { priorDeletedAt: priorDeletedAt.toISOString() } : {}),
          },
        },
        tx,
      );

      return upserted;
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

    let restored: boolean;
    try {
      const outcome = await this.prisma.client.$transaction(async (tx) => {
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

        // Restore deletedAt to null ONLY when this forget cycle was the
        // deletion's source (R54 / RR-FORGET-CANCEL-KEEPS-PRIOR-DELETE).
        // Match by entityId === req.id and requestedAt timestamp first; legacy
        // pre-patch rows have no entityId/deletedByForget and keep restoring.
        const reqAudits = await tx.contactAuditEntry.findMany({
          where: {
            businessId: input.businessId,
            contactId: input.contactId,
            action: 'forget_requested',
            entityId: req.id,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 10,
          select: { after: true },
        });
        const expectedRequestedAt = req.requestedAt.toISOString();
        const parseAfter = (entry: { after: Prisma.JsonValue | null } | undefined): Record<string, unknown> | null =>
          entry?.after && typeof entry.after === 'object' && !Array.isArray(entry.after)
            ? (entry.after as Record<string, unknown>)
            : null;
        const matchedAudit =
          reqAudits.find((e) => parseAfter(e)?.requestedAt === expectedRequestedAt) ?? reqAudits[0];
        const reqAfter = parseAfter(matchedAudit);
        const shouldRestore = reqAfter?.deletedByForget !== false;

        if (shouldRestore) {
          await tx.contact.updateMany({
            where: { id: input.contactId, businessId: input.businessId, mergedIntoId: null },
            data: { deletedAt: null },
          });
        }
        return { restored: shouldRestore };
      });
      restored = outcome.restored;
    } catch (err: unknown) {
      // Since D-16 a forgotten contact releases its email and phone for the
      // grace period, so another live contact may hold one of them by now; the
      // un-delete is then a P2002 on an identity unique and the transaction has
      // rolled back (the request is still 'requested', the contact still
      // deleted, nothing is audited). It answers like every other identity
      // conflict, revertMerge's included: 409 contact_email_taken /
      // contact_phone_taken naming the live holder the actor may see
      // (FOLLOW3-D8). Anything else is rethrown untouched.
      if (contactIdentityViolation(err)) {
        await this.rejectIdentityTaken(err, input.businessId, input.contactId, input.actor);
      }
      throw err;
    }

    const priorSoftDeletePreserved = !restored;
    await this.audit.write({
      businessId: input.businessId,
      contactId: input.contactId,
      action: 'forget_cancelled',
      entityId: req.id,
      actor: input.actor ?? { type: 'SYSTEM' },
      ip: input.ip,
      userAgent: input.userAgent,
      after: { restored, priorSoftDeletePreserved },
    });

    return restored ? { ok: true } : { ok: true, restored: false, priorSoftDeletePreserved: true };
  }

  /**
   * The 409 of a cancel whose un-delete met a contact identity unique: the
   * body CrmService.rejectContactIdentityTaken gives every other identity
   * conflict (same code, message and existingContactId field). The value is
   * the forgotten contact's own normalized email or phone, read past the
   * soft-delete extension (it hides the deleted row from every find). The
   * live holder is looked up after the rolled-back transaction, tenant-scoped
   * and, for a USER actor, under the M7 visibility clause GET detail applies:
   * the id is a working key, so a member who may not open the holder gets
   * existingContactId null with the same message. A SYSTEM or API actor is
   * tenant-scoped only, as rejectContactIdentityTaken treats a call without
   * an actor.
   */
  private async rejectIdentityTaken(
    err: unknown,
    businessId: string,
    contactId: string,
    actor: ContactAuditActor | undefined,
  ): Promise<never> {
    const field = contactIdentityViolation(err);
    if (!field) throw err;

    const rows = await this.prisma.client.$queryRaw<Array<{ email: string | null; phone: string | null }>>`
      SELECT email_normalized AS "email", phone_normalized AS "phone"
        FROM contacts
       WHERE id = ${contactId} AND business_id = ${businessId}`;
    const value = field === 'email' ? rows[0]?.email : rows[0]?.phone;
    let existing: { id: string } | null = null;
    if (value) {
      const where: Prisma.ContactWhereInput = field === 'email'
        ? { ...contactWhereBase(businessId), emailNormalized: value }
        : { ...contactWhereBase(businessId), phoneNormalized: value };
      const actorUserId = actor?.type === 'USER' ? actor.id : null;
      if (actorUserId) {
        const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
        const visClause = visibilityClause(access, actorUserId);
        if (visClause) where.AND = [visClause as Prisma.ContactWhereInput];
      }
      existing = await this.prisma.client.contact.findFirst({ where, select: { id: true } });
    }
    const label = field === 'email' ? 'email' : 'phone number';
    throw new ConflictException({
      code: field === 'email' ? 'contact_email_taken' : 'contact_phone_taken',
      message: `A contact with this ${label} already exists in this business`,
      existingContactId: existing?.id ?? null,
    });
  }

  /** Run-once helper exposed for ops + tests. */
  async runPurgeCycle(): Promise<{ purged: number; repaired: number; swept: number }> {
    if (this.purgeRunning) return { purged: 0, repaired: 0, swept: 0 };
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
      const swept = await this.sweepExportBundles();
      return { purged, repaired, swept };
    } finally {
      this.purgeRunning = false;
    }
  }

  /**
   * RR-RETENTION-EXPIRED-EXPORTS: delete the stored objects of export jobs
   * that nobody can download any more. Selected: expiresAt more than 24h ago,
   * or consumed (consumedAt set or downloadCount >= maxDownloads, the same
   * conditions under which resolveDownload refuses) for at least 15 minutes
   * (resolveDownload signs a 5-minute URL before it marks the job consumed),
   * with no export_bundle_deleted entry yet; at most EXPORT_SWEEP_BATCH per
   * cycle, jobs with a recorded storage failure after the others, then oldest
   * link first, so a job storage keeps refusing never starves the batch. For
   * each job both objects are deleted; when both deletes succeed one
   * export_bundle_deleted entry is written (the row is kept, every field
   * unchanged); when any delete fails nothing is written but, once per job, a
   * forget_storage_cleanup_failed entry naming the job and the keys, as
   * deleteExportBundles records; later failures only warn, and the job is
   * selected again every cycle. When storage is not configured at all the
   * cycle is skipped with one warning and nothing is written. Each deletion
   * is by the row's own id and businessId; no AI call.
   */
  private async sweepExportBundles(): Promise<number> {
    try {
      this.s3();
    } catch (err: unknown) {
      this.logger.warn(
        `[ContactPrivacy] export retention sweep skipped: storage not configured (${err instanceof Error ? err.message : String(err)})`,
      );
      return 0;
    }
    const cutoff = new Date(Date.now() - EXPORT_SWEEP_GRACE_MS);
    const consumedCutoff = new Date(Date.now() - EXPORT_CONSUMED_GRACE_MS);
    let jobs: Array<{ id: string; businessId: string; contactId: string; jsonKey: string; zipKey: string; failedBefore: boolean }>;
    try {
      jobs = await this.prisma.client.$queryRaw`
        SELECT j.id, j.business_id AS "businessId", j.contact_id AS "contactId",
               j.json_key AS "jsonKey", j.zip_key AS "zipKey",
               EXISTS (
                 SELECT 1 FROM contact_audit_entries f
                  WHERE f.business_id = j.business_id
                    AND f.action = ${STORAGE_CLEANUP_FAILED_ACTION}
                    AND f.entity_type = ${EXPORT_JOB_ENTITY_TYPE}
                    AND f.entity_id = j.id) AS "failedBefore"
          FROM contact_export_jobs j
         WHERE (j.expires_at < ${cutoff}
                OR (j.consumed_at IS NOT NULL AND j.consumed_at < ${consumedCutoff})
                OR (j.download_count >= j.max_downloads
                    AND COALESCE(j.last_downloaded_at, j.created_at) < ${consumedCutoff}))
           AND NOT EXISTS (
             SELECT 1 FROM contact_audit_entries a
              WHERE a.business_id = j.business_id
                AND a.action = ${EXPORT_BUNDLE_DELETED_ACTION}
                AND a.entity_type = ${EXPORT_JOB_ENTITY_TYPE}
                AND a.entity_id = j.id)
         ORDER BY "failedBefore" ASC, j.expires_at ASC
         LIMIT ${EXPORT_SWEEP_BATCH}`;
    } catch (err: unknown) {
      this.logger.warn(
        `[ContactPrivacy] export retention sweep could not list due jobs: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
    let swept = 0;
    for (const job of jobs) {
      const keys = [job.jsonKey, job.zipKey];
      const contactHash = this.audit.hashContact(job.businessId, job.contactId);
      try {
        const failed = await this.deleteBundleObjects(keys);
        if (failed.length > 0) {
          this.logger.warn(
            `[ContactPrivacy] export bundle retention failed job=${job.id}: ${failed.length}/${keys.length} object(s) not deleted: ${failed.map((f) => `${f.key} (${f.error})`).join(', ')}${job.failedBefore ? ' (already recorded; retried next cycle)' : ''}`,
          );
          if (job.failedBefore) continue;
          await this.recordBundleCleanupFailure({
            businessId: job.businessId,
            contactId: job.contactId,
            contactHash,
            entityType: EXPORT_JOB_ENTITY_TYPE,
            entityId: job.id,
            actorLabel: 'export-retention',
            failed,
            reason: 'export bundle expired or consumed, but these objects could not be deleted from storage; the next purge cycle retries them',
          });
          continue;
        }
        await this.prisma.client.contactAuditEntry.create({
          data: {
            businessId: job.businessId,
            contactId: job.contactId,
            contactHash,
            action: EXPORT_BUNDLE_DELETED_ACTION,
            entityType: EXPORT_JOB_ENTITY_TYPE,
            entityId: job.id,
            actor: { type: 'SYSTEM', label: 'export-retention' } as never,
            after: { jsonKey: job.jsonKey, zipKey: job.zipKey } as never,
            reason: 'export bundle expired or consumed: its objects were deleted from storage; the job row is kept as the record of the export',
            changedFields: [],
          },
        });
        swept += 1;
      } catch (err: unknown) {
        this.logger.warn(
          `[ContactPrivacy] export bundle retention failed job=${job.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (swept > 0) this.logger.log(`[ContactPrivacy] deleted the stored bundles of ${swept} expired or consumed export job(s)`);
    return swept;
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
    }, PURGE_TX_OPTIONS);

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
    }, PURGE_TX_OPTIONS);
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
   *   6. scrub the business event log rows naming any of them (V1-72);
   *   7. write the forget_purged entry.
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

    // 6. The business event log (V1-72, RR-ERASURE-BUSINESS-EVENTS). The
    //    BusinessEventInterceptor stores the request body and the response of
    //    every mutation, so a contact create or update holds the person's name,
    //    email and phone, and its metadata the caller's ip. A row names them
    //    when its subject is one of them (subject_type 'contact'), when the
    //    route's :contactId the interceptor recorded (metadata.routeContactId)
    //    is one of them, or, for a contact subject, when its after (the server's response; never
    //    before, the raw request body a caller could plant a key in, SEC-1)
    //    carries one of their ids as the top-level contactId (a
    //    note, a task, the forget request itself), or another
    //    CONTACT_REFERENCE_KEYS key (a relationship, a referral): the same rule
    //    BusinessEventService.emit applies to rows written after the request.
    //    The row is kept (event type, action, actor, subject, timestamps are
    //    the business's evidence that something happened); before and after
    //    become NULL and metadata keeps only FORGOTTEN_EVENT_METADATA_KEYS.
    //    Raw SQL because the JSON paths are not Prisma-filterable in one
    //    statement. Only rows that still hold something are counted.
    const keptKeys = [...FORGOTTEN_EVENT_METADATA_KEYS];
    const refKeys = [...CONTACT_REFERENCE_KEYS];
    const businessEventsScrubbed = await tx.$executeRaw`
      UPDATE business_events
         SET "before" = NULL,
             "after" = NULL,
             metadata = CASE
               WHEN metadata IS NULL THEN NULL
               WHEN jsonb_typeof(metadata) = 'object' THEN (
                 SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                   FROM jsonb_each(metadata) e WHERE e.key = ANY(${keptKeys}))
               ELSE NULL
             END
       WHERE business_id = ${businessId}
         AND (
           (lower(subject_type) = 'contact' AND subject_id = ANY(${ids}))
           OR ((lower(subject_type) = 'contact' OR ${childRoute(Prisma.sql`metadata ->> 'route'`)})
               AND EXISTS (SELECT 1 FROM unnest(${refKeys}::text[]) k WHERE "after" ->> k = ANY(${ids})))
           OR metadata ->> 'routeContactId' = ANY(${ids})
           -- The KEY cortex bus copy of a business event: the same rule over
           -- the event it copies (its after), never that event's before.
           OR (source = ${KEY_BUS_SOURCE} AND jsonb_typeof("after") = 'object' AND (
                (lower("after" ->> 'subjectType') = 'contact' AND "after" ->> 'subjectId' = ANY(${ids}))
                OR ((lower("after" ->> 'subjectType') = 'contact' OR ${childRoute(Prisma.sql`"after" -> 'metadata' ->> 'route'`)})
                    AND EXISTS (SELECT 1 FROM unnest(${refKeys}::text[]) k WHERE "after" -> 'after' ->> k = ANY(${ids})))
                OR "after" -> 'metadata' ->> 'routeContactId' = ANY(${ids})
              ))
         )
         AND (
           "before" IS NOT NULL
           OR "after" IS NOT NULL
           OR (metadata IS NOT NULL AND CASE
             WHEN jsonb_typeof(metadata) = 'object'
               THEN EXISTS (SELECT 1 FROM jsonb_object_keys(metadata) k WHERE NOT (k = ANY(${keptKeys})))
             ELSE true
           END)
         )`;

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
            businessEventsScrubbed,
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
    const failed = await this.deleteBundleObjects(keys);
    if (failed.length === 0) return;

    this.logger.warn(
      `[ContactPrivacy] export bundle cleanup failed request=${requestId}: ${failed.length}/${keys.length} object(s) not deleted: ${failed.map((f) => `${f.key} (${f.error})`).join(', ')}`,
    );
    await this.recordBundleCleanupFailure({
      businessId,
      contactId: null,
      contactHash,
      entityType: 'contact',
      entityId: requestId,
      actorLabel: 'forget-purge',
      failed,
      reason: 'GDPR purge committed, but these export bundle objects could not be deleted from storage; delete them by key',
    });
  }

  /** Delete the given object keys; returns the keys that could not be deleted, with the error text. */
  private async deleteBundleObjects(keys: string[]): Promise<Array<{ key: string; error: string }>> {
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
    return failed;
  }

  /** The forget_storage_cleanup_failed entry: the keys that stayed in storage, from which the cleanup can be retried. */
  private async recordBundleCleanupFailure(p: {
    businessId: string;
    contactId: string | null;
    contactHash: string;
    entityType: string;
    entityId: string;
    actorLabel: string;
    failed: Array<{ key: string; error: string }>;
    reason: string;
  }): Promise<void> {
    try {
      await this.prisma.client.contactAuditEntry.create({
        data: {
          businessId: p.businessId,
          contactId: p.contactId,
          contactHash: p.contactHash,
          action: STORAGE_CLEANUP_FAILED_ACTION,
          entityType: p.entityType,
          entityId: p.entityId,
          actor: { type: 'SYSTEM', label: p.actorLabel } as never,
          after: { failedKeys: p.failed.map((f) => f.key), errors: p.failed.map((f) => f.error) } as never,
          reason: p.reason,
          changedFields: [],
        },
      });
    } catch (err: unknown) {
      this.logger.error(
        `[ContactPrivacy] could not record failed export bundle cleanup ${p.entityType}=${p.entityId}: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
      );
    }
  }

  // ------------------------- Helpers -------------------------

  private async collectBundle(businessId: string, contactId: string) {
    const c = this.prisma.client;
    const contact = await c.contact.findFirst({ where: { id: contactId, businessId, deletedAt: null } });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    if (contact.deletedAt !== null) {
      throw new ConflictException({
        code: 'CONTACT_DELETED',
        message: 'Cannot export a soft-deleted or forget-pending contact; restore the contact first',
      });
    }
    const [events, notes, tasks, media, quotes, invoices, bookings, audit, sequences] =
      await Promise.all([
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
