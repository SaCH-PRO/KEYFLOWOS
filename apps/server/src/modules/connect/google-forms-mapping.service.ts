import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@keyflow/db';
import { QuoteStatus } from '@prisma/client';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GoogleFormsService } from './google-forms.service';
import { CrmService } from '../crm/crm.service';
import { configuringMember, syncPrincipals, type SyncPrincipals } from './google-contacts-sync.service';

export type CrmField =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'companyName'
  | 'jobTitle'
  | 'addressLine1'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'country'
  | 'notesInternal'
  | 'tag'
  | 'opportunity.title'
  | 'opportunity.description'
  | 'opportunity.budget'
  | 'opportunity.notes'
  | 'ignore';

export interface FieldMappingEntry {
  questionId: string;
  questionTitle?: string;
  crmField: CrmField;
}

export interface OpportunityDefaults {
  enabled: boolean;
  titleTemplate?: string;
  defaultBudget?: number;
  defaultCurrency?: string;
  defaultStatus?: string;
  /**
   * W9-FORMS-QUOTE-GATE review SEC-W9FQG-1 (D-46, D-93): the member who last
   * saved a mapping that names opportunity defaults (the configuring member).
   * Only the server writes it (saveMapping sets it after the body's defaults
   * are spread, so a body cannot name one), and its revenue write bounds every
   * run of a mapping that creates quotes, whoever starts it (as
   * connector-form-mapping's configuredBy bounds a backfill, SEC-W6CTM-2). A
   * mapping saved before records none: a run no member starts then runs as the
   * business owner (D-93).
   */
  configuredBy?: string | null;
}

interface RawFormResponse {
  responseId: string;
  createTime?: string;
  lastSubmittedTime?: string;
  respondentEmail?: string;
  answers?: Record<
    string,
    {
      questionId: string;
      textAnswers?: { answers?: Array<{ value?: string }> };
      fileUploadAnswers?: { answers?: Array<{ fileName?: string; fileId?: string }> };
    }
  >;
}

interface ProcessResult {
  responsesProcessed: number;
  responsesSkipped: number;
  contactsCreated: number;
  opportunitiesCreated: number;
  errors: string[];
  lastResponseTime?: string;
}

/**
 * W9-FORMS-QUOTE-GATE review SEC-W9FQG-2: who starts a run. `request`: a
 * member's request (the backfill and process-new routes pass their caller);
 * `poller`: the connector.synced listener, which a member's request starts
 * when the registry emits inside it (POST connectors/.../sync/google_forms)
 * and no member starts when the nightly connector sync emits it.
 */
type FormRunStart = { kind: 'request'; caller: string | null } | { kind: 'poller' };

interface MappingRow {
  id: string;
  businessId: string;
  formId: string;
  formTitle: string | null;
  fieldMappings: FieldMappingEntry[];
  opportunityDefaults: OpportunityDefaults | null;
  autoCreate: boolean;
  lastSeenResponseTime: Date | null;
  processedResponseIds: string[];
}

const CRM_FIELDS: CrmField[] = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'companyName',
  'jobTitle',
  'addressLine1',
  'city',
  'state',
  'postalCode',
  'country',
  'notesInternal',
  'tag',
  'opportunity.title',
  'opportunity.description',
  'opportunity.budget',
  'opportunity.notes',
  'ignore',
];

// Bounded ring buffer of seen response IDs to keep idempotency cheap.
const PROCESSED_ID_CAP = 5000;

function parseFieldMappings(value: Prisma.JsonValue | null | undefined): FieldMappingEntry[] {
  if (!Array.isArray(value)) return [];
  const out: FieldMappingEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const obj = raw as Record<string, unknown>;
    const questionId = typeof obj.questionId === 'string' ? obj.questionId : null;
    const crmField = typeof obj.crmField === 'string' ? (obj.crmField as CrmField) : null;
    if (!questionId || !crmField || !CRM_FIELDS.includes(crmField)) continue;
    out.push({
      questionId,
      questionTitle: typeof obj.questionTitle === 'string' ? obj.questionTitle : undefined,
      crmField,
    });
  }
  return out;
}

/**
 * W5-D92-RESIDUALS review SEC-D92R-1: the status of the quote (opportunity) a
 * form response creates. A new quote is a DRAFT, as CommerceService.createQuote
 * creates every quote; it is sent, decided and converted only through the quote
 * doors and their transition table (quote-workflow.ts QUOTE_TRANSITIONS). This
 * path wrote opportunityDefaults.defaultStatus as given, so a mapping could
 * create quotes already ACCEPTED, PAID or CONVERTED around that table (the
 * defect class SEC-3 / SEC-V50-4 closed on the commerce AI route).
 */
const FORM_QUOTE_STATUS: QuoteStatus = 'DRAFT';

/**
 * SEC-D92R-1: the setting stores only DRAFT (in any case or padding); null or
 * no status is DRAFT; any other value is a 400 and nothing is stored.
 */
function settingFormQuoteStatus(value: unknown): QuoteStatus {
  if (value === undefined || value === null) return FORM_QUOTE_STATUS;
  if (typeof value === 'string' && (value.trim() === '' || value.trim().toUpperCase() === FORM_QUOTE_STATUS)) {
    return FORM_QUOTE_STATUS;
  }
  throw new BadRequestException(
    `"${String(value)}" is not a status a form creates a quote with: a form creates a ${FORM_QUOTE_STATUS} quote`,
  );
}

/**
 * The opportunity defaults as stored; SEC-D92R-1: the quote status reads as
 * DRAFT whatever a mapping stored before holds, so what a read reports is what
 * a backfill creates.
 */
function draftOpportunityDefaults(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return { ...(value as Prisma.JsonObject), defaultStatus: FORM_QUOTE_STATUS };
}

function parseOpportunityDefaults(
  value: Prisma.JsonValue | null | undefined,
): OpportunityDefaults | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  return {
    enabled: Boolean(obj.enabled),
    titleTemplate: typeof obj.titleTemplate === 'string' ? obj.titleTemplate : undefined,
    defaultBudget: typeof obj.defaultBudget === 'number' ? obj.defaultBudget : undefined,
    defaultCurrency:
      typeof obj.defaultCurrency === 'string' ? obj.defaultCurrency : undefined,
    // SEC-D92R-1: a stored value is never applied; the quote is a DRAFT.
    defaultStatus: FORM_QUOTE_STATUS,
    // W9-FORMS-QUOTE-GATE review SEC-W9FQG-1: the configuring member (server-written).
    configuredBy: typeof obj.configuredBy === 'string' && obj.configuredBy ? obj.configuredBy : null,
  };
}

@Injectable()
export class GoogleFormsMappingService {
  private readonly logger = new Logger(GoogleFormsMappingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GoogleFormsService) private readonly forms: GoogleFormsService,
    @Inject(CrmService) private readonly crm: CrmService,
  ) {}

  private toRow(record: {
    id: string;
    businessId: string;
    formId: string;
    formTitle: string | null;
    fieldMappings: Prisma.JsonValue;
    opportunityDefaults: Prisma.JsonValue | null;
    autoCreate: boolean;
    lastSeenResponseTime: Date | null;
    processedResponseIds: string[];
  }): MappingRow {
    return {
      id: record.id,
      businessId: record.businessId,
      formId: record.formId,
      formTitle: record.formTitle,
      fieldMappings: parseFieldMappings(record.fieldMappings),
      opportunityDefaults: parseOpportunityDefaults(record.opportunityDefaults),
      autoCreate: record.autoCreate,
      lastSeenResponseTime: record.lastSeenResponseTime,
      processedResponseIds: record.processedResponseIds ?? [],
    };
  }

  async getMapping(businessId: string, formId: string) {
    const record = await this.prisma.client.googleFormMapping.findUnique({
      where: { businessId_formId: { businessId, formId } },
    });
    // SEC-D92R-1: report the quote status a backfill creates (DRAFT).
    return record ? { ...record, opportunityDefaults: draftOpportunityDefaults(record.opportunityDefaults) } : null;
  }

  async listForBusiness(businessId: string) {
    return this.prisma.client.googleFormMapping.findMany({
      where: { businessId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * W9-FORMS-QUOTE-GATE review SEC-W9FQG-1 (D-46, D-93): `actorUserId` is the
   * member saving the mapping (the route passes its caller; else the member
   * the TenantInterceptor bound to the request for this business). A mapping
   * whose opportunity defaults are enabled creates a quote with every
   * response, so only a member with revenue:write saves one (403 otherwise,
   * nothing stored), and the mapping records them as its configuring member.
   * Before this any member saved one (the route is AuthGuard + BusinessGuard
   * only) and the poller, running as the owner, created the quotes they chose.
   */
  async saveMapping(input: {
    businessId: string;
    formId: string;
    formTitle?: string | null;
    fieldMappings: FieldMappingEntry[];
    opportunityDefaults?: OpportunityDefaults | null;
    autoCreate?: boolean;
    actorUserId?: string | null;
  }) {
    const cleaned = this.validateMappings(input.fieldMappings);
    const fieldJson = cleaned as unknown as Prisma.InputJsonValue;
    const opp = input.opportunityDefaults;
    // SEC-D92R-1: the quote a response creates is a DRAFT; any other status is a 400 before anything is written.
    const defaultStatus = opp ? settingFormQuoteStatus(opp.defaultStatus) : null;
    // SEC-W9FQG-1: enabled as a run reads it (parseOpportunityDefaults: Boolean(enabled)).
    const savedBy = configuringMember(input.businessId, input.actorUserId);
    if (opp && Boolean(opp.enabled)) {
      const level = await this.memberRevenueLevel(input.businessId, savedBy);
      if (rankOf(level) < LEVEL_RANK.write) {
        throw new ForbiddenException(
          `Insufficient permissions: revenue requires write access (you have ${level}); ` +
            'only a member with revenue write sets up a form that creates a quote with each response',
        );
      }
    }
    const oppJson: Prisma.InputJsonValue | typeof Prisma.JsonNull = opp
      ? ({
          ...opp,
          defaultStatus,
          // SEC-W9FQG-1: the configuring member is the server's, never the body's.
          configuredBy: savedBy,
        } as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;

    return this.prisma.client.googleFormMapping.upsert({
      where: {
        businessId_formId: { businessId: input.businessId, formId: input.formId },
      },
      create: {
        businessId: input.businessId,
        formId: input.formId,
        formTitle: input.formTitle ?? null,
        fieldMappings: fieldJson,
        opportunityDefaults: oppJson,
        autoCreate: input.autoCreate ?? true,
      },
      update: {
        formTitle: input.formTitle ?? undefined,
        fieldMappings: fieldJson,
        opportunityDefaults: oppJson,
        autoCreate: input.autoCreate ?? true,
      },
    });
  }

  async deleteMapping(businessId: string, formId: string) {
    await this.prisma.client.googleFormMapping
      .delete({ where: { businessId_formId: { businessId, formId } } })
      .catch(() => undefined);
    return { success: true };
  }

  private validateMappings(entries: FieldMappingEntry[]): FieldMappingEntry[] {
    if (!Array.isArray(entries)) {
      throw new BadRequestException('fieldMappings must be an array');
    }
    return entries
      .filter((e) => e && typeof e.questionId === 'string')
      .map((e) => {
        if (!CRM_FIELDS.includes(e.crmField)) {
          throw new BadRequestException(`Unknown CRM field "${e.crmField}"`);
        }
        return {
          questionId: e.questionId,
          questionTitle: e.questionTitle ?? undefined,
          crmField: e.crmField,
        };
      });
  }

  /**
   * W9-FORMS-QUOTE-GATE: `memberId`'s revenue level in `businessId`, read as
   * the quote door reads it (CommerceService.assertActorMayWriteRevenue,
   * memberRevenueLevel in ai/plan-step-authority.ts): the Membership's scope
   * map, else its role defaults. No Membership is none, a platform SUPER_ADMIN
   * included (D-46), and so is no member.
   */
  private async memberRevenueLevel(businessId: string, memberId: string | null): Promise<string> {
    if (!memberId) return 'none';
    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: memberId, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (!membership) return 'none';
    const scopes: Record<string, string> =
      membership.permissionScopes && typeof membership.permissionScopes === 'object'
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);
    return scopes.revenue || 'none';
  }

  /**
   * W9-FORMS-QUOTE-GATE (W5-D92-RESIDUALS review SEC-D92R-1 follow-up; owner
   * rulings D-46, D-93) and its review repairs SEC-W9FQG-1/2: why a run of
   * `mapping` started by `start` may not create the quotes the mapping asks
   * for, or null when it may (or the mapping creates none). The quote a
   * response creates is written here (applyResponse), not through
   * CommerceService.createQuote, whose route needs revenue:write
   * (ModuleScopeGuard), while the forms routes carry AuthGuard and
   * BusinessGuard only. Who the run is held to (syncPrincipals, the W6 rule
   * for contact syncs and connector form backfills, review SEC-W6CTM-2):
   *  - the run's member: the caller of a backfill or process-new request; for
   *    the poller, the member whose request emitted connector.synced (the
   *    TenantInterceptor binds them for this business), and only for a run no
   *    member starts, the configuring member, else the business owner (D-93).
   *    SEC-W9FQG-2: the poller ran as the owner even inside a member's
   *    request, so a member refused here created the quotes through POST
   *    connectors/.../sync/google_forms;
   *  - and the configuring member, whose revenue write bounds every run
   *    (SEC-W9FQG-1).
   * Every one must hold revenue:write. The answer starts with the words
   * ModuleScopeGuard answers POST quotes with for the same member.
   */
  private async formQuoteRefusal(mapping: MappingRow, start: FormRunStart): Promise<string | null> {
    if (!mapping.opportunityDefaults?.enabled) return null;
    const configured = mapping.opportunityDefaults.configuredBy ?? null;
    let principals: SyncPrincipals;
    if (start.kind === 'request') {
      const actor = configuringMember(mapping.businessId, start.caller);
      principals = { actor, members: Array.from(new Set([actor, configured].filter((m): m is string => !!m))) };
    } else {
      principals = await syncPrincipals(this.prisma, mapping.businessId, configured);
    }
    const actorLevel = await this.memberRevenueLevel(mapping.businessId, principals.actor);
    if (rankOf(actorLevel) < LEVEL_RANK.write) {
      return (
        `Insufficient permissions: revenue requires write access (you have ${actorLevel}); ` +
        'this form creates a quote with each response, so its responses wait for a run by a member with revenue write'
      );
    }
    for (const member of principals.members) {
      if (member === principals.actor) continue;
      const level = await this.memberRevenueLevel(mapping.businessId, member);
      if (rankOf(level) < LEVEL_RANK.write) {
        return (
          `Insufficient permissions: revenue requires write access (the member who set up this form has ${level}); ` +
          'this form creates a quote with each response, so its responses wait until a member with revenue write saves its mapping again'
        );
      }
    }
    return null;
  }

  /** Apply mapping to a single response, creating/updating a contact (and optional opportunity). */
  private async applyResponse(
    mapping: MappingRow,
    response: RawFormResponse,
  ): Promise<{ contactCreated: boolean; opportunityCreated: boolean }> {
    const values: Partial<Record<CrmField, string>> = {};
    const tags: string[] = [];

    for (const entry of mapping.fieldMappings) {
      const raw = response.answers?.[entry.questionId];
      const text = raw?.textAnswers?.answers
        ?.map((x) => x.value)
        .filter(Boolean)
        .join(', ');
      if (!text) continue;
      if (entry.crmField === 'ignore') continue;
      if (entry.crmField === 'tag') {
        tags.push(text);
        continue;
      }
      values[entry.crmField] = text;
    }

    const email = values.email || response.respondentEmail || null;
    const sourceDetail = mapping.formTitle || `Google Form ${mapping.formId}`;

    // Find or create contact (idempotent on email)
    const existingByEmail = email
      ? await this.prisma.client.contact.findFirst({
          where: {
            businessId: mapping.businessId,
            emailNormalized: email.toLowerCase().trim(),
            deletedAt: null,
          },
        })
      : null;

    let contactId: string;
    let contactCreated = false;
    if (existingByEmail) {
      contactId = existingByEmail.id;
    } else {
      const contact = await this.crm.createContact({
        businessId: mapping.businessId,
        firstName: values.firstName ?? null,
        lastName: values.lastName ?? null,
        email,
        phone: values.phone ?? null,
        companyName: values.companyName ?? undefined,
        jobTitle: values.jobTitle ?? undefined,
        addressLine1: values.addressLine1 ?? undefined,
        city: values.city ?? undefined,
        state: values.state ?? undefined,
        postalCode: values.postalCode ?? undefined,
        country: values.country ?? undefined,
        notesInternal: values.notesInternal ?? undefined,
        source: 'google_forms',
        sourceDetail,
        tags,
        custom: {
          googleFormResponseId: response.responseId,
          googleFormId: mapping.formId,
        },
      });
      contactId = contact.id;
      contactCreated = true;
    }

    // Optional opportunity (Quote). Idempotent per (form response → contact)
    // by checking the contact's existing quotes for this response id.
    let opportunityCreated = false;
    const opp = mapping.opportunityDefaults;
    if (opp?.enabled && contactId) {
      const titleSeed =
        values['opportunity.title'] ||
        opp.titleTemplate?.replace('{form}', mapping.formTitle ?? 'Form') ||
        `Lead from ${mapping.formTitle ?? 'Google Form'}`;
      const description =
        values['opportunity.description'] || values['opportunity.notes'] || sourceDetail;
      const budgetText = values['opportunity.budget'];
      const budget = budgetText
        ? Number(budgetText.replace(/[^0-9.]/g, ''))
        : opp.defaultBudget ?? 0;

      // Idempotency: skip if a quote already exists for this exact response id.
      const tag = `[gf:${response.responseId}]`;
      const existingQuote = await this.prisma.client.quote.findFirst({
        where: {
          businessId: mapping.businessId,
          contactId,
          notes: { contains: tag },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!existingQuote) {
        try {
          const quoteNumber = `GF-${Date.now()}-${Math.floor(Math.random() * 1000)
            .toString()
            .padStart(3, '0')}`;
          const notes = `${titleSeed}\n\n${description}\n\n${tag}`;
          await this.prisma.client.quote.create({
            data: {
              businessId: mapping.businessId,
              contactId,
              quoteNumber,
              // SEC-D92R-1: a DRAFT, never the stored opportunityDefaults.defaultStatus.
              status: FORM_QUOTE_STATUS,
              subtotal: budget || 0,
              total: budget || 0,
              currency: opp.defaultCurrency ?? 'TTD',
              notes,
            },
          });
          opportunityCreated = true;
        } catch (err: any) {
          this.logger.warn(
            `Failed to create opportunity from form ${mapping.formId}: ${(err as Error).message}`,
          );
        }
      }
    }

    return { contactCreated, opportunityCreated };
  }

  /**
   * W9-FORMS-QUOTE-GATE: a request run of a mapping that creates quotes, by a
   * member who may not create them (formQuoteRefusal), is refused with 403
   * before any response is read: nothing is applied or written (no quote, no
   * contact, no processed id, no watermark, no lastBackfillAt), so every
   * response stays pending for a run by a member who may. Review CR-W9FQG-2:
   * the refusal is a 403, not a 201 with zero counts, so a caller that checks
   * for an error (the web forms drawer's backfill) shows why.
   */
  private async assertRequestMayRun(mapping: MappingRow, caller: string | null): Promise<void> {
    const refusal = await this.formQuoteRefusal(mapping, { kind: 'request', caller });
    if (refusal) throw new ForbiddenException(refusal);
  }

  /**
   * Process all responses since the mapping's lastSeenResponseTime.
   * W9-FORMS-QUOTE-GATE: `actorUserId` is the member whose request runs it
   * (the route's caller); see assertRequestMayRun.
   */
  async processNewResponses(businessId: string, formId: string, actorUserId?: string | null): Promise<ProcessResult> {
    const record = await this.getMapping(businessId, formId);
    if (!record) throw new NotFoundException('No mapping configured for this form');
    const mapping = this.toRow(record);
    await this.assertRequestMayRun(mapping, actorUserId ?? null);
    return this.runProcess(mapping, { onlyNew: true });
  }

  /**
   * Backfill: apply mapping to every response on the form (idempotent).
   * W9-FORMS-QUOTE-GATE: `actorUserId` as for processNewResponses.
   */
  async backfill(businessId: string, formId: string, actorUserId?: string | null): Promise<ProcessResult> {
    const record = await this.getMapping(businessId, formId);
    if (!record) throw new NotFoundException('No mapping configured for this form');
    const mapping = this.toRow(record);
    await this.assertRequestMayRun(mapping, actorUserId ?? null);
    const result = await this.runProcess(mapping, { onlyNew: false });
    await this.prisma.client.googleFormMapping.update({
      where: { id: record.id },
      data: { lastBackfillAt: new Date() },
    });
    return result;
  }

  private async runProcess(
    mapping: MappingRow,
    opts: { onlyNew: boolean },
  ): Promise<ProcessResult> {
    const result: ProcessResult = {
      responsesProcessed: 0,
      responsesSkipped: 0,
      contactsCreated: 0,
      opportunitiesCreated: 0,
      errors: [],
    };

    const seen = new Set(mapping.processedResponseIds);
    const newlyProcessed: string[] = [];
    let pageToken: string | undefined;
    let latest: Date | null = mapping.lastSeenResponseTime;

    do {
      const page = (await this.forms.listResponses(
        mapping.businessId,
        mapping.formId,
        pageToken,
      )) as { responses?: RawFormResponse[]; nextPageToken?: string };
      const responses = page.responses ?? [];
      for (const response of responses) {
        const submitted = response.lastSubmittedTime ?? response.createTime;
        if (opts.onlyNew && mapping.lastSeenResponseTime && submitted) {
          if (new Date(submitted) <= mapping.lastSeenResponseTime) {
            result.responsesSkipped += 1;
            continue;
          }
        }
        if (seen.has(response.responseId)) {
          result.responsesSkipped += 1;
          continue;
        }
        try {
          const out = await this.applyResponse(mapping, response);
          result.responsesProcessed += 1;
          if (out.contactCreated) result.contactsCreated += 1;
          if (out.opportunityCreated) result.opportunitiesCreated += 1;
          newlyProcessed.push(response.responseId);
        } catch (err: any) {
          result.errors.push(`${response.responseId}: ${(err as Error).message}`);
        }
        if (submitted) {
          const t = new Date(submitted);
          if (!latest || t > latest) latest = t;
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken);

    // Cap stored IDs to avoid unbounded growth.
    const merged = [...mapping.processedResponseIds, ...newlyProcessed];
    const trimmed =
      merged.length > PROCESSED_ID_CAP ? merged.slice(merged.length - PROCESSED_ID_CAP) : merged;

    await this.prisma.client.googleFormMapping.update({
      where: { id: mapping.id },
      data: {
        lastSeenResponseTime: latest ?? undefined,
        responsesProcessed: { increment: result.responsesProcessed },
        contactsCreated: { increment: result.contactsCreated },
        opportunitiesCreated: { increment: result.opportunitiesCreated },
        processedResponseIds: trimmed,
      },
    });

    if (latest) result.lastResponseTime = latest.toISOString();
    return result;
  }

  /** Listen for connector sync events and auto-process new Google Forms responses. */
  @OnEvent('connector.synced')
  async onConnectorSynced(payload: { connectorType: string; businessId: string }) {
    if (payload.connectorType !== 'google_forms') return;
    const mappings = await this.prisma.client.googleFormMapping.findMany({
      where: { businessId: payload.businessId, autoCreate: true },
    });
    for (const record of mappings) {
      try {
        const mapping = this.toRow(record);
        // W9-FORMS-QUOTE-GATE (D-93) and review SEC-W9FQG-1/2: a sync a
        // member's request starts runs each form as that member; only a run no
        // member starts runs as the configuring member, else the business
        // owner; and the configuring member bounds every run. A run that may
        // not create the mapping's quotes reads and writes nothing (no quote,
        // no contact, no processed id, no watermark): the responses stay
        // pending for a run that may. Applying the contact alone would lose
        // the quote (a processed response is never applied again).
        const refusal = await this.formQuoteRefusal(mapping, { kind: 'poller' });
        if (refusal) {
          this.logger.warn(`Auto-process held for form ${record.formId} (business ${payload.businessId}): ${refusal}`);
          continue;
        }
        await this.runProcess(mapping, { onlyNew: true });
      } catch (err: any) {
        this.logger.warn(
          `Auto-process failed for form ${record.formId} (business ${payload.businessId}): ${(err as Error).message}`,
        );
      }
    }
  }
}
