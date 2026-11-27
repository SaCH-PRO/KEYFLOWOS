import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereBase, contactWhereWithId } from './crm.helpers';
import { CrmService, contactIdentityViolation } from './crm.service';
import { CrmDuplicateDetectionService } from './crm-duplicate-detection.service';
import { livePhoneHolderIds, normalizeEmail, normalizePhone } from './crm-duplicate.util';
import { resolveCrmAccess, visibilityClause } from './crm-permissions.helper';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ContactAuditService } from './privacy/contact-audit.service';
import {
  DATA_QUALITY_KINDS,
  type DataQualityKind,
  computeQualityScore,
  contactPhoneForStorage,
  isStale,
  missingRequiredFields,
  normalizeToE164,
  phoneFlagFor,
  severityFor,
  validateEmail,
} from './crm-data-quality.util';

/** The answer a contact write gets when a live contact already holds the number (CrmService's 409). */
const PHONE_TAKEN_MESSAGE = 'A contact with this phone number already exists in this business';

/** The answer a contact write gets when a live contact already holds the email (CrmService's 409). */
const EMAIL_TAKEN_MESSAGE = 'A contact with this email already exists in this business';

/** What an issue id the member may not act on answers: an unknown id's answer, word for word. */
const ISSUE_NOT_FOUND_MESSAGE = 'Issue not found';

/**
 * FU-DATAQUALITY-MASS-ASSIGN: the action a fix of each issue kind takes (the action the scan
 * recommends for it; an invalid_email issue with no suggested address recommends edit_email,
 * and the member then sends replace_email with the address). A request may name only its
 * issue kind's action; any other is refused 400 with nothing written, so an issue of one kind
 * cannot write the fields another kind fixes.
 */
const FIX_ACTIONS: Readonly<Record<DataQualityKind, readonly string[]>> = {
  invalid_email: ['replace_email'],
  invalid_phone: ['replace_phone'],
  missing_required: ['fill_fields'],
  stale_data: ['mark_verified'],
  suspected_duplicate: ['merge'],
};

/**
 * The contact fields a missing_required fill may write: the fields a relationship type can
 * require (crm-data-quality.util requiredFieldsFor). An issue fills only the ones it lists.
 */
const FILLABLE_REQUIRED_FIELDS = ['email', 'phone', 'companyName'] as const;
type FillableField = typeof FILLABLE_REQUIRED_FIELDS[number];

/** What bulk-apply reports for a fix that failed for a reason that is not the caller's to read. */
const FIX_FAILED_MESSAGE = 'The fix could not be applied.';

/** What a contact the member may not open answers (GET contacts/:contactId's 404). */
const CONTACT_NOT_FOUND_MESSAGE = 'Contact not found';

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
  /** The member the list is for: it lists only issues of contacts they may open. */
  actorId: string;
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
    // FU-DATAQUALITY-MASS-ASSIGN: a fill is the contact PATCH's own write (normalisers,
    // identity rules, edit scope, audit); the other fixes audit their own write.
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(ContactAuditService) private readonly contactAudit: ContactAuditService,
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
      whatsappNumber: string | null;
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
          whatsappNumber: true,
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
        // WA-E164-SERVER: the write paths flag a WhatsApp number that does not
        // read under the business's country (CrmService.syncPhoneFlag); the
        // scan reads it the same way, so it keeps that flag open. A contact has
        // one invalid_phone issue (ContactDataIssue is unique per contact and
        // kind): a phone that does not read comes first, then a WhatsApp number
        // that does not read, and only then a phone that reads but can be
        // reformatted (review COR-E164-6: a phone kept as typed with '+' and
        // spaces must not take the slot from the WhatsApp flag).
        const whatsappFlag = contact.phone && !phoneRes.ok
          ? null
          : phoneFlagFor({ whatsappNumber: contact.whatsappNumber }, business.country);
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
        } else if (whatsappFlag) {
          drafts.push({
            contactId: contact.id,
            kind: 'invalid_phone',
            severity: severityFor('invalid_phone'),
            field: whatsappFlag.field,
            message: whatsappFlag.message,
            recommendedFix: whatsappFlag.recommendedFix,
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
    } catch (err: any) {
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

  /**
   * Mark a contact verified (POST contacts/:contactId/data-quality/mark-verified), as `actorId`.
   * FU-DATAQUALITY-MASS-ASSIGN review repair SEC-DQ-3: the route writes the contact, so it keeps
   * what the 'mark_verified' fix through apply keeps: the contact PATCH's edit rule
   * (CrmService.assertCanEditContact: 403 for crm_edit 'none' and for a contact outside crm_edit
   * 'owned'; the controller has already answered a contact the member may not open 404), the
   * stamp written with its ContactAuditEntry in one transaction (writeAudited, owner ruling D-25),
   * and the contact's open stale-data issue resolved by the member.
   */
  async markContactVerified(businessId: string, contactId: string, actorId: string): Promise<{ ok: boolean }> {
    await this.crm.assertCanEditContact(businessId, contactId, actorId);
    await this.writeAudited(businessId, contactId, actorId, { lastVerifiedAt: new Date() }, CONTACT_NOT_FOUND_MESSAGE);
    // Resolve any open stale_data issue of this contact: the member explicitly verified the record.
    await this.prisma.client.contactDataIssue.updateMany({
      where: { businessId, contactId, kind: 'stale_data', status: 'open' },
      data: { status: 'resolved', resolvedAt: new Date(), resolvedBy: actorId },
    });
    return { ok: true };
  }

  /**
   * The contacts of the business `actorId` may open, by the rule GET contacts/:contactId applies
   * (assertContactVisible: the business, deletedAt null, visibilityClause). resolveCrmAccess
   * refuses a non-member 403. The OWNER and SUPER_ADMIN open every live contact.
   */
  private async contactsOpenTo(businessId: string, actorId: string): Promise<Prisma.ContactWhereInput> {
    const access = await resolveCrmAccess(this.prisma, businessId, actorId);
    const visClause = visibilityClause(access, actorId);
    const where: Prisma.ContactWhereInput = { ...contactWhereBase(businessId) };
    if (visClause) where.AND = [visClause as Prisma.ContactWhereInput];
    return where;
  }

  /**
   * The data-quality queue (GET .../data-quality/issues) for `filters.actorId`.
   *
   * FU-DATAQUALITY-MASS-ASSIGN review repairs SEC-DQ-1 / COR-DQMA-2 (owner rulings D-63, D-133;
   * the W11-CRM-COUNTS-RULING hand-off SEC-W11CCR-2): the items, the total and the open counts
   * by kind (byKind) cover only the issues of the contacts the member may open (contactsOpenTo),
   * so a member a visibility rule hides a contact from is not served its issue, its name, email
   * or phone, is not counted it, and cannot find it by searching; the issues listed are the ones
   * apply, bulk-apply and dismiss act on (findIssueFor). Review repair COR-DQMA-1: for every
   * member, the OWNER included, the issues of a soft-deleted contact (deleted, or merged into
   * another) are neither listed nor counted: no fix or dismissal can reach them, and the scan
   * visits live contacts only.
   */
  async listIssues(filters: IssueListFilters) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const status = filters.status ?? 'open';
    const openable = await this.contactsOpenTo(filters.businessId, filters.actorId);
    const searched: Prisma.ContactWhereInput | null = filters.search
      ? {
          OR: [
            { firstName: { contains: filters.search, mode: 'insensitive' } },
            { lastName: { contains: filters.search, mode: 'insensitive' } },
            { displayName: { contains: filters.search, mode: 'insensitive' } },
            { email: { contains: filters.search, mode: 'insensitive' } },
            { phone: { contains: filters.search } },
          ],
        }
      : null;
    const where: Prisma.ContactDataIssueWhereInput = {
      businessId: filters.businessId,
      status,
      ...(filters.kinds && filters.kinds.length > 0 ? { kind: { in: filters.kinds } } : {}),
      ...(filters.severities && filters.severities.length > 0 ? { severity: { in: filters.severities } } : {}),
      contact: { is: searched ? { AND: [openable, searched] } : openable },
    };

    const [items, total, openCounts] = await Promise.all([
      this.prisma.client.contactDataIssue.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
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
        where: { businessId: filters.businessId, status: 'open', contact: { is: openable } },
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

  /**
   * The business-wide data-quality stats (GET .../data-quality/stats for the OWNER and
   * SUPER_ADMIN; CrmStatsService.dataQualityCountsFor works out a member's over the contacts they
   * may open, D-133). FU-DATAQUALITY-MASS-ASSIGN review repair COR-DQMA-1: issueCounts counts the
   * open issues of live contacts only, as totalContacts and averageScore count live contacts: an
   * issue left on a deleted or merged contact is in no list and no fix can reach it.
   */
  async getStats(businessId: string) {
    const [byKind, totals, scoreAgg, business] = await Promise.all([
      this.prisma.client.contactDataIssue.groupBy({
        by: ['kind'],
        where: { businessId, status: 'open', contact: { is: contactWhereBase(businessId) } },
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

  /**
   * The issue `issueId` of the business, on a contact `actorId` may open
   * (FU-DATAQUALITY-MASS-ASSIGN): a live contact of the business inside the
   * member's visibilityClause, the rule GET contacts/:contactId applies
   * (assertContactVisible). An issue of any other contact (outside the
   * member's book, another member's PRIVATE contact, a soft-deleted contact's
   * leftover issue) answers exactly as an unknown issue id does: 404 'Issue
   * not found'. resolveCrmAccess refuses a non-member 403 first.
   */
  private async findIssueFor(businessId: string, issueId: string, actorId: string) {
    const contactWhere = await this.contactsOpenTo(businessId, actorId);
    // An id is text: anything else (a filter object Prisma would read as a pattern) names no
    // issue (review SEC-DQ-2; bulkApplyFix refuses it 400 before this).
    if (typeof issueId !== 'string') throw new NotFoundException(ISSUE_NOT_FOUND_MESSAGE);
    const issue = await this.prisma.client.contactDataIssue.findFirst({
      where: { id: issueId, businessId, contact: { is: contactWhere } },
    });
    if (!issue) throw new NotFoundException(ISSUE_NOT_FOUND_MESSAGE);
    return issue;
  }

  /**
   * Apply an issue's fix, as `actorId` (FU-DATAQUALITY-MASS-ASSIGN):
   *  - the issue must be on a contact the member may open (findIssueFor), and,
   *    since every fix writes the contact, the member must be allowed to edit
   *    it by the contact PATCH's rule (CrmService.assertCanEditContact: 403
   *    for crm_edit 'none', and for a contact outside crm_edit 'owned');
   *  - the action is the issue kind's (FIX_ACTIONS), and it writes only the
   *    fields the issue fixes: replace_email the email, replace_phone the
   *    phone of an issue that flags the phone, fill_fields the fields a
   *    missing_required issue lists, mark_verified the verification stamp,
   *    merge nothing. Any other action or key is refused 400 with nothing
   *    written and the issue left open;
   *  - a value the member sends is checked as the contact PATCH DTO checks it
   *    (UpdateContactDto); a fill is written by the PATCH's own write
   *    (CrmService.updateContact: its normalisers, E.164 phones, the identity
   *    409s, its audit entry), and the other fixes record their
   *    ContactAuditEntry in their write's transaction (owner ruling D-25).
   */
  async applyFix(input: { businessId: string; issueId: string; actorId: string; override?: Record<string, unknown> }) {
    const issue = await this.findIssueFor(input.businessId, input.issueId, input.actorId);
    const contactId = issue.contactId;
    await this.crm.assertCanEditContact(input.businessId, contactId, input.actorId);
    if (issue.status !== 'open') return { issueId: issue.id, status: issue.status, applied: false };

    const fix = (issue.recommendedFix as Record<string, unknown> | null) ?? null;
    const override = this.overrideOf(input.override);
    const action = override?.action ?? fix?.action;
    const kindActions = (FIX_ACTIONS as Readonly<Record<string, readonly string[] | undefined>>)[issue.kind] ?? [];
    if (typeof action !== 'string' || !kindActions.includes(action)) {
      const named = typeof action === 'string' && /^[a-z_]{1,40}$/.test(action) ? action : 'unknown';
      throw new BadRequestException(`Unsupported fix action: ${named}`);
    }

    switch (action) {
      case 'replace_email': {
        const value = await this.checkedValue('email', override?.value ?? fix?.value, 'Replacement email is required');
        await this.replaceEmail(input.businessId, contactId, value, input.actorId);
        break;
      }
      case 'replace_phone': {
        // An invalid_phone issue that flags the WhatsApp number does not fix the phone.
        if (issue.field && issue.field !== 'phone') {
          throw new BadRequestException('This issue does not flag the phone number');
        }
        const value = await this.checkedValue('phone', override?.value ?? fix?.value, 'Replacement phone is required');
        await this.replacePhone(input.businessId, contactId, value, input.actorId);
        break;
      }
      case 'mark_verified': {
        await this.writeAudited(input.businessId, contactId, input.actorId, { lastVerifiedAt: new Date() });
        break;
      }
      case 'fill_fields': {
        const values = await this.checkedFill(issue, override?.values);
        // The contact PATCH's own write, as the member.
        await this.crm.updateContact({ businessId: input.businessId, contactId, actorUserId: input.actorId, ...values });
        break;
      }
      case 'merge':
        // Merging is a multi-step user flow handled by the duplicates page; we
        // just acknowledge here so the issue can be dismissed once the merge
        // completes.
        break;
    }

    await this.prisma.client.contactDataIssue.update({
      where: { id: issue.id },
      data: { status: 'resolved', resolvedAt: new Date(), resolvedBy: input.actorId },
    });
    return { issueId: issue.id, status: 'resolved' as const, applied: true };
  }

  /** The request's override: absent, or an object (anything else is refused 400). */
  private overrideOf(override: unknown): Record<string, unknown> | undefined {
    if (override === undefined || override === null) return undefined;
    if (typeof override !== 'object' || Array.isArray(override)) {
      throw new BadRequestException('override must be an object');
    }
    return override as Record<string, unknown>;
  }

  /**
   * The fields a missing_required issue lists (its recommendedFix.fields, else
   * its field) among FILLABLE_REQUIRED_FIELDS: the only fields its fill may
   * write.
   */
  private fillableFields(issue: { field: string | null; recommendedFix: unknown }): FillableField[] {
    const fix = issue.recommendedFix as { fields?: unknown } | null;
    const listed: unknown[] = Array.isArray(fix?.fields) ? fix.fields : issue.field ? [issue.field] : [];
    return FILLABLE_REQUIRED_FIELDS.filter((field) => listed.includes(field));
  }

  /**
   * A fill's values (FU-DATAQUALITY-MASS-ASSIGN): an object whose keys are
   * fields the issue lists, each a non-blank text checked as the contact
   * PATCH DTO checks it. Anything else is refused 400 before anything is
   * written.
   */
  private async checkedFill(
    issue: { field: string | null; recommendedFix: unknown },
    values: unknown,
  ): Promise<Partial<Record<FillableField, string>>> {
    if (values === undefined || values === null) throw new BadRequestException('No field values provided');
    if (typeof values !== 'object' || Array.isArray(values)) {
      throw new BadRequestException('Field values must be an object of field names and values');
    }
    const keys = Object.keys(values);
    if (keys.length === 0) throw new BadRequestException('No field values provided');
    const fillable: readonly string[] = this.fillableFields(issue);
    if (fillable.length === 0 || keys.some((key) => !fillable.includes(key))) {
      throw new BadRequestException(fillable.length > 0 ? `This fix fills only: ${fillable.join(', ')}` : 'This fix fills no field');
    }
    const checked: Partial<Record<FillableField, string>> = {};
    for (const key of keys as FillableField[]) {
      checked[key] = await this.checkedValue(key, (values as Record<string, unknown>)[key], `${key} is required`);
    }
    return checked;
  }

  /**
   * One value a fix writes to `field`, checked as the contact PATCH DTO checks
   * it (UpdateContactDto, with its transforms: IsEmail, the lengths, the
   * sanitiser). It must be a non-blank text; the DTO's refusal is answered
   * 400 with its messages (one line, so bulk-apply can report it).
   */
  private async checkedValue(field: FillableField, value: unknown, requiredMessage: string): Promise<string> {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      throw new BadRequestException(requiredMessage);
    }
    if (typeof value !== 'string') throw new BadRequestException(`${field} must be a text value`);
    const dto = plainToInstance(UpdateContactDto, { [field]: value });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      throw new BadRequestException(errors.flatMap((error) => Object.values(error.constraints ?? {})).join('; '));
    }
    const checked = (dto as unknown as Record<string, unknown>)[field];
    if (typeof checked !== 'string' || checked.trim() === '') throw new BadRequestException(requiredMessage);
    return checked;
  }

  /**
   * A fix's own contact write, audited (owner ruling D-25;
   * FU-DATAQUALITY-MASS-ASSIGN): the row is locked and read in the business,
   * written, and its ContactAuditEntry ('updated', the member as USER actor,
   * the diff) is written in the same transaction, so the change and its entry
   * commit together or not at all. A contact gone by then answers 404 with
   * `notFoundMessage` (an issue's fix: 'Issue not found'; mark-verified:
   * 'Contact not found').
   */
  private async writeAudited(
    businessId: string,
    contactId: string,
    actorId: string,
    data: Prisma.ContactUpdateInput,
    notFoundMessage: string = ISSUE_NOT_FOUND_MESSAGE,
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM contacts WHERE id = ${contactId} AND business_id = ${businessId} FOR UPDATE`;
      const before = await tx.contact.findFirst({ where: contactWhereWithId(businessId, contactId) });
      if (!before) throw new NotFoundException(notFoundMessage);
      const after = await tx.contact.update({ where: { id: contactId }, data });
      await this.contactAudit.write({
        businessId,
        contactId,
        action: 'updated',
        before,
        after,
        actor: { type: 'USER', id: actorId },
      }, tx);
    });
  }

  async bulkApplyFix(input: { businessId: string; issueIds: unknown[]; actorId: string }) {
    if (!Array.isArray(input.issueIds) || input.issueIds.length === 0) {
      throw new BadRequestException('issueIds is required');
    }
    if (input.issueIds.length > 200) {
      throw new BadRequestException('Maximum 200 issues per bulk fix');
    }
    // FU-DATAQUALITY-MASS-ASSIGN review repair SEC-DQ-2: every element is an issue id (text). An
    // object would reach the issue lookup as a Prisma filter ({ endsWith: ... }) and apply the fix
    // of an issue the member never named, or probe ids by prefix; the whole request is refused 400
    // before any fix is applied, and the element is not echoed back.
    if (!input.issueIds.every((id): id is string => typeof id === 'string')) {
      throw new BadRequestException('issueIds must be a list of issue ids');
    }
    const results: Array<{ issueId: string; ok: boolean; error?: string }> = [];
    for (const id of input.issueIds) {
      try {
        await this.applyFix({ businessId: input.businessId, issueId: id, actorId: input.actorId });
        results.push({ issueId: id, ok: true });
      } catch (err: unknown) {
        // The refusals applyFix raises itself (not found, unsupported, the
        // phone another contact holds) are written for the caller; anything
        // else (a database error, with its query and server path) is logged
        // here and reported plainly (WA-E164-SERVER review COR-E164-4).
        if (err instanceof HttpException) {
          results.push({ issueId: id, ok: false, error: err.message });
        } else {
          this.logger.warn(`Bulk fix of issue ${id} failed: ${(err as Error)?.message ?? String(err)}`);
          results.push({ issueId: id, ok: false, error: FIX_FAILED_MESSAGE });
        }
      }
    }
    return { results, applied: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }

  /**
   * The 'replace_email' fix (FU-DATAQUALITY-MASS-ASSIGN): the address, checked
   * as the contact PATCH DTO checks it, is stored with the PATCH's normaliser
   * (normalizeEmail) and the verification stamp, audited; an address another
   * live contact of the business holds is refused by the identity unique and
   * answered with the contact writes' 409 contact_email_taken, naming the
   * holder only when the actor may open it.
   */
  private async replaceEmail(businessId: string, contactId: string, value: string, actorId: string): Promise<void> {
    const email = value.trim();
    const emailNormalized = normalizeEmail(email);
    try {
      await this.writeAudited(businessId, contactId, actorId, { email, emailNormalized, lastVerifiedAt: new Date() });
    } catch (err: unknown) {
      if (contactIdentityViolation(err) !== 'email') throw err;
      const holders = await this.prisma.client.contact.findMany({
        where: { ...contactWhereBase(businessId), emailNormalized, id: { not: contactId } },
        select: { id: true },
      });
      await this.rejectIdentityTaken('email', businessId, holders.map((h: { id: string }) => h.id), actorId);
    }
  }

  /**
   * The 'replace_phone' fix (WA-E164-SERVER review COR-E164-4): the phone is
   * stored as a contact write stores it (read under the business's country:
   * E.164, or as written with its country code), and it keeps the identity
   * rule the writes keep: a number another live contact of the business holds
   * (under its E.164 key, or under a key stored before E.164 that reads as it)
   * is refused with the same 409 contact_phone_taken, naming the holder only
   * when the actor may open it (the M7 clause CrmService applies). The scan
   * offers a reformat for a number stored before E.164 that may be held so.
   */
  private async replacePhone(businessId: string, contactId: string, value: string, actorId: string): Promise<void> {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId }, select: { country: true } });
    const country = business?.country ?? null;
    const phone = contactPhoneForStorage(value, country);
    if (!phone.e164 || !phone.value) {
      throw new BadRequestException('Replacement phone is not a recognisable phone number');
    }
    const holders = await livePhoneHolderIds(this.prisma.client, businessId, phone.e164, country, { exceptId: contactId });
    if (holders.length > 0) await this.rejectIdentityTaken('phone', businessId, holders, actorId);
    try {
      // Audited in the write's own transaction (FU-DATAQUALITY-MASS-ASSIGN, D-25).
      await this.writeAudited(businessId, contactId, actorId, {
        phone: phone.value,
        phoneNormalized: normalizePhone(phone.value),
        lastVerifiedAt: new Date(),
      });
    } catch (err: unknown) {
      // A holder that committed after the read: the identity unique refuses it (D-16).
      if ((err as { code?: unknown } | null)?.code !== 'P2002') throw err;
      const raced = await livePhoneHolderIds(this.prisma.client, businessId, phone.e164, country, { exceptId: contactId });
      await this.rejectIdentityTaken('phone', businessId, raced, actorId);
    }
  }

  /**
   * CrmService's bounded 409 contact_phone_taken / contact_email_taken: the
   * holder's id only when the actor may open it (the M7 clause CrmService
   * applies).
   */
  private async rejectIdentityTaken(
    field: 'phone' | 'email',
    businessId: string,
    holderIds: string[],
    actorId: string,
  ): Promise<never> {
    let existing: { id: string } | null = null;
    if (holderIds.length > 0) {
      const where: Prisma.ContactWhereInput = { ...contactWhereBase(businessId), id: { in: holderIds } };
      const access = await resolveCrmAccess(this.prisma, businessId, actorId);
      const visClause = visibilityClause(access, actorId);
      if (visClause) where.AND = [visClause as Prisma.ContactWhereInput];
      existing = await this.prisma.client.contact.findFirst({ where, select: { id: true }, orderBy: { createdAt: 'asc' } });
    }
    throw new ConflictException({
      code: field === 'email' ? 'contact_email_taken' : 'contact_phone_taken',
      message: field === 'email' ? EMAIL_TAKEN_MESSAGE : PHONE_TAKEN_MESSAGE,
      existingContactId: existing?.id ?? null,
    });
  }

  /**
   * Dismiss an issue, as `actorId`: only an issue on a contact the member may
   * open (findIssueFor; any other answers as an unknown issue id does).
   * FU-DATAQUALITY-MASS-ASSIGN.
   */
  async dismissIssue(input: { businessId: string; issueId: string; actorId: string }) {
    const issue = await this.findIssueFor(input.businessId, input.issueId, input.actorId);
    await this.prisma.client.contactDataIssue.update({
      where: { id: issue.id },
      data: { status: 'dismissed', resolvedAt: new Date(), resolvedBy: input.actorId },
    });
    return { issueId: issue.id, status: 'dismissed' as const };
  }

  /**
   * The fix wizard's queue (GET .../data-quality/wizard) for `actorId`: the open issues of the
   * contacts the member may open (FU-DATAQUALITY-MASS-ASSIGN review repairs SEC-DQ-1 /
   * COR-DQMA-2, as listIssues), so a hidden contact's issue is neither offered nor takes one of
   * the queue's places; the issues of a deleted or merged contact are left out for every member
   * (COR-DQMA-1).
   */
  async wizardQueue(input: { businessId: string; actorId: string; limit?: number }) {
    const { businessId } = input;
    const limit = input.limit ?? 25;
    const openable = await this.contactsOpenTo(businessId, input.actorId);
    const items = await this.prisma.client.contactDataIssue.findMany({
      where: { businessId, status: 'open', contact: { is: openable } },
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
