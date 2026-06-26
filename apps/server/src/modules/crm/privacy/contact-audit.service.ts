import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';

/**
 * Per-contact audit log writer (M7).
 *
 * Records every meaningful mutation on a Contact (or its child rows)
 * into `ContactAuditEntry`. Each entry is content-addressable by a
 * stable `contactHash` derived from `(businessId, contactId)` so the
 * compliance trail survives even after the contact row itself is
 * hard-deleted in the GDPR "forget" purge — at which point the
 * `contactId` foreign-key is nulled and identifiers in the entries
 * are scrubbed.
 *
 * All writes are best-effort: a DB hiccup must never break the actual
 * mutation it audits. Failures are logged and swallowed.
 */
export type ContactAuditAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'restored'
  | 'merged'
  | 'reassigned'
  | 'shared'
  | 'imported'
  | 'exported'
  | 'export_downloaded'
  | 'forget_requested'
  | 'forget_cancelled'
  | 'forget_purged'
  | 'note_added'
  | 'note_updated'
  | 'note_deleted'
  | 'task_added'
  | 'task_updated'
  | 'task_deleted'
  | 'task_completed'
  | 'communication_logged'
  | 'child_updated'
  | 'bulk_updated'
  | 'bulk_deleted';

export type ContactAuditEntityType =
  | 'contact'
  | 'note'
  | 'task'
  | 'event'
  | 'invoice'
  | 'quote'
  | 'booking'
  | 'media'
  | 'sequence';

export interface ContactAuditActor {
  type: 'USER' | 'SYSTEM' | 'API';
  id?: string | null;
  label?: string | null;
}

export interface ContactAuditWriteOptions {
  businessId: string;
  contactId: string;
  action: ContactAuditAction;
  entityType?: ContactAuditEntityType;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  actor?: ContactAuditActor | null;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class ContactAuditService {
  private readonly logger = new Logger(ContactAuditService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Stable, deterministic hash for `(businessId, contactId)`. Used so
   * the audit trail outlives the contact row after a GDPR purge.
   */
  hashContact(businessId: string, contactId: string): string {
    const h = createHash('sha256');
    h.update(`${businessId}:${contactId}`);
    return `sha256:${h.digest('hex')}`;
  }

  /**
   * Diff two plain objects and return only the fields whose values
   * differ. Skips internal/computed fields. Truncates long string
   * values so audit rows stay small.
   */
  diff(
    before: Record<string, unknown> | null | undefined,
    after: Record<string, unknown> | null | undefined,
    skip: string[] = ['updatedAt', 'createdAt', 'lastInteractionAt'],
  ): { changed: string[]; before: Record<string, unknown>; after: Record<string, unknown> } {
    const skipSet = new Set(skip);
    const beforeOut: Record<string, unknown> = {};
    const afterOut: Record<string, unknown> = {};
    const changed: string[] = [];
    const keys = new Set<string>([
      ...Object.keys(before ?? {}),
      ...Object.keys(after ?? {}),
    ]);
    for (const key of keys) {
      if (skipSet.has(key)) continue;
      const a = before ? (before as Record<string, unknown>)[key] : undefined;
      const b = after ? (after as Record<string, unknown>)[key] : undefined;
      if (this.eq(a, b)) continue;
      changed.push(key);
      beforeOut[key] = this.truncate(a);
      afterOut[key] = this.truncate(b);
    }
    return { changed, before: beforeOut, after: afterOut };
  }

  private eq(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null && b == null) return true;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => this.eq(v, b[i]));
    }
    if (typeof a === 'object' && typeof b === 'object' && a && b) {
      try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
    }
    return false;
  }

  private truncate(v: unknown): unknown {
    if (typeof v === 'string' && v.length > 1024) return v.slice(0, 1024) + '…[truncated]';
    return v;
  }

  /** Write a single audit entry. Never throws. */
  async write(opts: ContactAuditWriteOptions): Promise<void> {
    try {
      const diffed =
        opts.before !== undefined || opts.after !== undefined
          ? this.diff(opts.before as any, opts.after as any)
          : { changed: [], before: {}, after: {} };
      await this.prisma.client.contactAuditEntry.create({
        data: {
          businessId: opts.businessId,
          contactId: opts.contactId,
          contactHash: this.hashContact(opts.businessId, opts.contactId),
          action: opts.action,
          entityType: opts.entityType ?? 'contact',
          entityId: opts.entityId ?? null,
          actor: (opts.actor ?? null) as never,
          before: (diffed.before ?? null) as never,
          after: (diffed.after ?? null) as never,
          changedFields: diffed.changed,
          reason: opts.reason?.slice(0, 500) ?? null,
          ip: opts.ip?.slice(0, 64) ?? null,
          userAgent: opts.userAgent?.slice(0, 512) ?? null,
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `[ContactAudit] write failed action=${opts.action} contact=${opts.contactId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /** List audit entries for a contact with optional filters. */
  async list(params: {
    businessId: string;
    contactId: string;
    action?: string;
    actorId?: string;
    since?: Date;
    until?: Date;
    limit?: number;
    cursor?: string;
  }) {
    const where: Record<string, unknown> = {
      businessId: params.businessId,
      contactId: params.contactId,
    };
    if (params.action) where.action = params.action;
    if (params.since || params.until) {
      const range: Record<string, Date> = {};
      if (params.since) range.gte = params.since;
      if (params.until) range.lte = params.until;
      where.createdAt = range;
    }
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));
    const entries = await this.prisma.client.contactAuditEntry.findMany({
      where: params.actorId
        ? { ...where, actor: { path: ['id'], equals: params.actorId } }
        : where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
    const hasMore = entries.length > limit;
    const sliced = hasMore ? entries.slice(0, limit) : entries;
    return {
      entries: sliced,
      nextCursor: hasMore && sliced.length > 0 ? sliced[sliced.length - 1].id : null,
      hasMore,
    };
  }
}
