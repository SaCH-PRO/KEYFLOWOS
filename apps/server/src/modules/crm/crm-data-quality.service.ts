import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereBase, contactWhereWithId } from './crm.helpers';
import { CrmDuplicateDetectionService } from './crm-duplicate-detection.service';
import {
  DATA_QUALITY_KINDS,
  type DataQualityKind,
  computeQualityScore,
  isStale,
  missingRequiredFields,
  normalizeToE164,
  severityFor,
  validateEmail,
} from './crm-data-quality.util';

type IssueDraft = {
  contactId: string;
  kind: DataQualityKind;
  severity: 'low' | 'medium' | 'high';
  field?: string | null;
  message: string;
  recommendedFix?: Record<string, unknown> | null;
};

type ScanSummary = {
  businessId: string;
  scanned: number;
  issuesUpserted: number;
  issuesResolved: number;
  averageScore: number;
  durationMs: number;
};

type IssueListFilters = {
  businessId: string;
  kinds?: DataQualityKind[];
  severities?: Array<'low' | 'medium' | 'high'>;
  status?: 'open' | 'resolved' | 'dismissed';
  search?: string;
  limit?: number;
  offset?: number;
};

const SCAN_BATCH_SIZE = 200;

@Injectable()
export class CrmDataQualityService {
  private readonly logger = new Logger(CrmDataQualityService.name);
  private readonly inflightScans = new Map<string, Promise<ScanSummary>>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmDuplicateDetectionService) private readonly duplicates: CrmDuplicateDetectionService,
  ) {}

  /**
   * Run all validators across every active contact for a business and upsert
   * `ContactDataIssue` rows. Existing open issues that no longer fire are
   * resolved automatically so the UI never shows stale fixes.
   *
   * Concurrent scans for the same business are deduplicated to avoid the
   * scheduler stomping on a manual "scan now" trigger.
   */
  async scanBusiness(businessId: string): Promise<ScanSummary> {
    const existing = this.inflightScans.get(businessId);
    if (existing) return existing;
    const promise = this.runScan(businessId).finally(() => {
      this.inflightScans.delete(businessId);
    });
    this.inflightScans.set(businessId, promise);
    return promise;
  }

  private async runScan(businessId: string): Promise<ScanSummary> {
    const started = Date.now();
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { id: true, dataQualityStaleDays: true, country: true },
    });
    if (!business) throw new NotFoundException('Business not found');
    const staleDays = business.dataQualityStaleDays ?? 180;

    let scanned = 0;
    let issuesUpserted = 0;
    let issuesResolved = 0;
    let scoreSum = 0;
    let scoreCount = 0;

    const duplicateContactIds = await this.collectDuplicateIds(businessId);

    let cursor: string | null = null;
    type ContactRow = {
      id: string;
      email: string | null;
      phone: string | null;
      firstName: string | null;
      lastName: string | null;
      companyName: string | null;
      relationshipType: string | null;
      createdAt: Date;
      lastInteractionAt: Date | null;
      lastVerifiedAt: Date | null;
    };
    while (true) {
      const batch: ContactRow[] = await this.prisma.client.contact.findMany({
        where: { ...contactWhereBase(businessId) },
        orderBy: { id: 'asc' },
        take: SCAN_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          companyName: true,
          relationshipType: true,
          createdAt: true,
          lastInteractionAt: true,
          lastVerifiedAt: true,
        },
      }) as unknown as ContactRow[];
      if (batch.length === 0) break;

      for (const contact of batch) {
        scanned += 1;
        const drafts: IssueDraft[] = [];

        const emailRes = await validateEmail(contact.email);
        if (contact.email && !emailRes.ok) {
          drafts.push({
            contactId: contact.id,
            kind: 'invalid_email',
            severity: severityFor('invalid_email'),
            field: 'email',
            message: emailRes.reason === 'no_mx'
              ? 'Email domain has no mail server (MX record missing).'
              : 'Email address is not in a valid format.',
            recommendedFix: emailRes.suggestedFix
              ? { action: 'replace_email', value: emailRes.suggestedFix }
              : { action: 'edit_email' },
          });
        }

        const phoneRes = normalizeToE164(contact.phone, business.country ?? undefined);
        if (contact.phone && !phoneRes.ok) {
          drafts.push({
            contactId: contact.id,
            kind: 'invalid_phone',
            severity: severityFor('invalid_phone'),
            field: 'phone',
            message: 'Phone number is not in a recognisable international format.',
            recommendedFix: phoneRes.suggestedFix
              ? { action: 'replace_phone', value: phoneRes.suggestedFix }
              : { action: 'edit_phone' },
          });
        } else if (contact.phone && phoneRes.ok && phoneRes.suggestedFix && phoneRes.suggestedFix !== contact.phone) {
          drafts.push({
            contactId: contact.id,
            kind: 'invalid_phone',
            severity: 'low',
            field: 'phone',
            message: 'Phone number can be reformatted to E.164.',
            recommendedFix: { action: 'replace_phone', value: phoneRes.suggestedFix },
          });
        }

        const missing = missingRequiredFields(contact);
        if (missing.length > 0) {
          drafts.push({
            contactId: contact.id,
            kind: 'missing_required',
            severity: severityFor('missing_required'),
            field: missing[0],
            message: `Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
            recommendedFix: { action: 'fill_fields', fields: missing },
          });
        }

        const stale = isStale({
          lastInteractionAt: contact.lastInteractionAt,
          lastVerifiedAt: contact.lastVerifiedAt,
          createdAt: contact.createdAt,
          staleDays,
        });
        if (stale) {
          drafts.push({
            contactId: contact.id,
            kind: 'stale_data',
            severity: severityFor('stale_data'),
            field: null,
            message: `No verified contact in over ${staleDays} days.`,
            recommendedFix: { action: 'mark_verified' },
          });
        }

        const duplicateMeta = duplicateContactIds.get(contact.id);
        if (duplicateMeta) {
          drafts.push({
            contactId: contact.id,
            kind: 'suspected_duplicate',
            severity: severityFor('suspected_duplicate'),
            field: null,
            message: `Possible duplicate of another contact (${duplicateMeta.reason}).`,
            recommendedFix: {
              action: 'merge',
              primaryId: duplicateMeta.primaryId,
              duplicateId: duplicateMeta.duplicateId,
              confidence: duplicateMeta.confidence,
            },
          });
        }

        const upserted = await this.persistIssues(businessId, contact.id, drafts);
        issuesUpserted += upserted.upserted;
        issuesResolved += upserted.resolved;

        const score = computeQualityScore({
          emailValid: !contact.email || emailRes.ok,
          emailPresent: !!contact.email,
          phoneValid: !contact.phone || phoneRes.ok,
          phonePresent: !!contact.phone,
          hasMissingRequired: missing.length > 0,
          hasDuplicate: !!duplicateMeta,
          isStale: stale,
        });
        scoreSum += score;
        scoreCount += 1;
        await this.prisma.client.contact.update({
          where: { id: contact.id },
          data: { dataQualityScore: score, dataQualityCheckedAt: new Date() },
        });
      }

      if (batch.length < SCAN_BATCH_SIZE) break;
      cursor = batch[batch.length - 1].id;
    }

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { dataQualityLastRunAt: new Date() },
    });

    const summary: ScanSummary = {
      businessId,
      scanned,
      issuesUpserted,
      issuesResolved,
      averageScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 100,
      durationMs: Date.now() - started,
    };
    this.logger.log(
      `Data-quality scan complete for ${businessId}: scanned=${summary.scanned} upserted=${summary.issuesUpserted} resolved=${summary.issuesResolved} avg=${summary.averageScore} ${summary.durationMs}ms`,
    );
    return summary;
  }

  private async collectDuplicateIds(businessId: string): Promise<Map<string, { primaryId: string; duplicateId: string; reason: string; confidence: number }>> {
    const map = new Map<string, { primaryId: string; duplicateId: string; reason: string; confidence: number }>();
    try {
      const { pairs } = await this.duplicates.findCandidatesScoped({ businessId, minConfidence: 0.7, limit: 200, offset: 0 });
      for (const pair of pairs) {
        // Map both sides so the issue surfaces wherever the user looks first.
        if (!map.has(pair.duplicateId)) {
          map.set(pair.duplicateId, { primaryId: pair.primaryId, duplicateId: pair.duplicateId, reason: pair.reason, confidence: pair.confidence });
        }
        if (!map.has(pair.primaryId)) {
          map.set(pair.primaryId, { primaryId: pair.primaryId, duplicateId: pair.duplicateId, reason: pair.reason, confidence: pair.confidence });
        }
      }
    } catch (err) {
      this.logger.warn(`Duplicate detection failed during scan: ${(err as Error).message}`);
    }
    return map;
  }

  private async persistIssues(businessId: string, contactId: string, drafts: IssueDraft[]): Promise<{ upserted: number; resolved: number }> {
    const wantedKinds = new Set(drafts.map((d) => d.kind));
    let upserted = 0;
    let resolved = 0;

    for (const draft of drafts) {
      await this.prisma.client.contactDataIssue.upsert({
        where: { contactId_kind: { contactId, kind: draft.kind } },
        create: {
          businessId,
          contactId,
          kind: draft.kind,
          severity: draft.severity,
          field: draft.field ?? null,
          message: draft.message,
          recommendedFix: (draft.recommendedFix ?? null) as Prisma.InputJsonValue,
          status: 'open',
        },
        update: {
          severity: draft.severity,
          field: draft.field ?? null,
          message: draft.message,
          recommendedFix: (draft.recommendedFix ?? null) as Prisma.InputJsonValue,
          // Re-open if a previous fix has regressed.
          status: 'open',
          resolvedAt: null,
          resolvedBy: null,
        },
      });
      upserted += 1;
    }

    // Auto-resolve open issues that no longer apply.
    const stale = await this.prisma.client.contactDataIssue.findMany({
      where: { businessId, contactId, status: 'open', kind: { notIn: Array.from(wantedKinds) } },
      select: { id: true },
    });
    if (stale.length > 0) {
      await this.prisma.client.contactDataIssue.updateMany({
        where: { id: { in: stale.map((s) => s.id) } },
        data: { status: 'resolved', resolvedAt: new Date(), resolvedBy: 'system' },
      });
      resolved += stale.length;
    }
    return { upserted, resolved };
  }

  async listIssues(filters: IssueListFilters) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const status = filters.status ?? 'open';
    const where: Prisma.ContactDataIssueWhereInput = {
      businessId: filters.businessId,
      status,
      ...(filters.kinds && filters.kinds.length > 0 ? { kind: { in: filters.kinds } } : {}),
      ...(filters.severities && filters.severities.length > 0 ? { severity: { in: filters.severities } } : {}),
      ...(filters.search
        ? {
            contact: {
              OR: [
                { firstName: { contains: filters.search, mode: 'insensitive' } },
                { lastName: { contains: filters.search, mode: 'insensitive' } },
                { displayName: { contains: filters.search, mode: 'insensitive' } },
                { email: { contains: filters.search, mode: 'insensitive' } },
                { phone: { contains: filters.search } },
              ],
            },
          }
        : {}),
    };

    const [items, total, openCounts] = await Promise.all([
      this.prisma.client.contactDataIssue.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
        include: {
          contact: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
              email: true,
              phone: true,
              companyName: true,
              dataQualityScore: true,
              relationshipType: true,
            },
          },
        },
      }),
      this.prisma.client.contactDataIssue.count({ where }),
      this.prisma.client.contactDataIssue.groupBy({
        by: ['kind'],
        where: { businessId: filters.businessId, status: 'open' },
        _count: { _all: true },
      }),
    ]);

    const byKind: Record<string, number> = {};
    for (const c of openCounts) byKind[c.kind] = c._count._all;

    return { items, total, limit, offset, byKind };
  }

  async getContactIssues(businessId: string, contactId: string) {
    await this.assertContact(businessId, contactId);
    const items = await this.prisma.client.contactDataIssue.findMany({
      where: { businessId, contactId, status: 'open' },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    });
    return { items };
  }

  async getStats(businessId: string) {
    const [byKind, totals, scoreAgg, business] = await Promise.all([
      this.prisma.client.contactDataIssue.groupBy({
        by: ['kind'],
        where: { businessId, status: 'open' },
        _count: { _all: true },
      }),
      this.prisma.client.contact.count({ where: { ...contactWhereBase(businessId) } }),
      this.prisma.client.contact.aggregate({
        where: { ...contactWhereBase(businessId), dataQualityScore: { not: null } },
        _avg: { dataQualityScore: true },
      }),
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { dataQualityLastRunAt: true, dataQualityStaleDays: true },
      }),
    ]);

    const issueCounts: Record<string, number> = {};
    for (const k of DATA_QUALITY_KINDS) issueCounts[k] = 0;
    for (const row of byKind) issueCounts[row.kind] = row._count._all;

    return {
      totalContacts: totals,
      averageScore: Math.round(scoreAgg._avg.dataQualityScore ?? 100),
      issueCounts,
      lastRunAt: business?.dataQualityLastRunAt ?? null,
      staleDays: business?.dataQualityStaleDays ?? 180,
    };
  }

  async applyFix(input: { businessId: string; issueId: string; actorId?: string; override?: Record<string, unknown> }) {
    const issue = await this.prisma.client.contactDataIssue.findFirst({
      where: { id: input.issueId, businessId: input.businessId },
      include: { contact: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    if (issue.status !== 'open') return { issueId: issue.id, status: issue.status, applied: false };

    const fix = (issue.recommendedFix as Record<string, unknown> | null) ?? null;
    const action = (input.override?.action ?? fix?.action) as string | undefined;
    const contactId = issue.contactId;

    switch (action) {
      case 'replace_email': {
        const value = String(input.override?.value ?? fix?.value ?? '').trim();
        if (!value) throw new BadRequestException('Replacement email is required');
        await this.prisma.client.contact.update({
          where: { id: contactId },
          data: { email: value, emailNormalized: value.toLowerCase(), lastVerifiedAt: new Date() },
        });
        break;
      }
      case 'replace_phone': {
        const value = String(input.override?.value ?? fix?.value ?? '').trim();
        if (!value) throw new BadRequestException('Replacement phone is required');
        const normalized = value.replace(/[^0-9+]/g, '');
        await this.prisma.client.contact.update({
          where: { id: contactId },
          data: { phone: value, phoneNormalized: normalized, lastVerifiedAt: new Date() },
        });
        break;
      }
      case 'mark_verified': {
        await this.prisma.client.contact.update({ where: { id: contactId }, data: { lastVerifiedAt: new Date() } });
        break;
      }
      case 'fill_fields': {
        const values = (input.override?.values ?? {}) as Record<string, unknown>;
        if (!values || Object.keys(values).length === 0) {
          throw new BadRequestException('No field values provided');
        }
        await this.prisma.client.contact.update({ where: { id: contactId }, data: values as Prisma.ContactUpdateInput });
        break;
      }
      case 'merge':
        // Merging is a multi-step user flow handled by the duplicates page; we
        // just acknowledge here so the issue can be dismissed once the merge
        // completes.
        break;
      default:
        throw new BadRequestException(`Unsupported fix action: ${action ?? 'unknown'}`);
    }

    await this.prisma.client.contactDataIssue.update({
      where: { id: issue.id },
      data: { status: 'resolved', resolvedAt: new Date(), resolvedBy: input.actorId ?? 'system' },
    });
    return { issueId: issue.id, status: 'resolved' as const, applied: true };
  }

  async bulkApplyFix(input: { businessId: string; issueIds: string[]; actorId?: string }) {
    if (!Array.isArray(input.issueIds) || input.issueIds.length === 0) {
      throw new BadRequestException('issueIds is required');
    }
    if (input.issueIds.length > 200) {
      throw new BadRequestException('Maximum 200 issues per bulk fix');
    }
    const results: Array<{ issueId: string; ok: boolean; error?: string }> = [];
    for (const id of input.issueIds) {
      try {
        await this.applyFix({ businessId: input.businessId, issueId: id, actorId: input.actorId });
        results.push({ issueId: id, ok: true });
      } catch (err) {
        results.push({ issueId: id, ok: false, error: (err as Error).message });
      }
    }
    return { results, applied: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }

  async dismissIssue(input: { businessId: string; issueId: string; actorId?: string }) {
    const issue = await this.prisma.client.contactDataIssue.findFirst({
      where: { id: input.issueId, businessId: input.businessId },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    await this.prisma.client.contactDataIssue.update({
      where: { id: issue.id },
      data: { status: 'dismissed', resolvedAt: new Date(), resolvedBy: input.actorId ?? 'system' },
    });
    return { issueId: issue.id, status: 'dismissed' as const };
  }

  async wizardQueue(businessId: string, limit = 25) {
    const items = await this.prisma.client.contactDataIssue.findMany({
      where: { businessId, status: 'open' },
      orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            email: true,
            phone: true,
            companyName: true,
            dataQualityScore: true,
            relationshipType: true,
          },
        },
      },
    });
    return { items };
  }

  async updateSettings(input: { businessId: string; staleDays?: number }) {
    const data: Prisma.BusinessUpdateInput = {};
    if (input.staleDays !== undefined) {
      if (!Number.isFinite(input.staleDays) || input.staleDays < 7 || input.staleDays > 365) {
        throw new BadRequestException('staleDays must be between 7 and 365');
      }
      data.dataQualityStaleDays = Math.floor(input.staleDays);
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No settings provided');
    }
    const updated = await this.prisma.client.business.update({
      where: { id: input.businessId },
      data,
      select: { dataQualityStaleDays: true, dataQualityLastRunAt: true },
    });
    return updated;
  }

  async listAllBusinessIds(): Promise<string[]> {
    const rows = await this.prisma.client.business.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async assertContact(businessId: string, contactId: string) {
    const c = await this.prisma.client.contact.findFirst({
      where: { ...contactWhereWithId(businessId, contactId) },
      select: { id: true },
    });
    if (!c) throw new ForbiddenException('Contact not found');
    return c;
  }
}
