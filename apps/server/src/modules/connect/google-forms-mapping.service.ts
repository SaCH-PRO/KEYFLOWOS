import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@keyflow/db';
import { QuoteStatus } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GoogleFormsService } from './google-forms.service';
import { CrmService } from '../crm/crm.service';

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
    defaultStatus:
      typeof obj.defaultStatus === 'string' ? obj.defaultStatus : undefined,
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
    return this.prisma.client.googleFormMapping.findUnique({
      where: { businessId_formId: { businessId, formId } },
    });
  }

  async listForBusiness(businessId: string) {
    return this.prisma.client.googleFormMapping.findMany({
      where: { businessId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async saveMapping(input: {
    businessId: string;
    formId: string;
    formTitle?: string | null;
    fieldMappings: FieldMappingEntry[];
    opportunityDefaults?: OpportunityDefaults | null;
    autoCreate?: boolean;
  }) {
    const cleaned = this.validateMappings(input.fieldMappings);
    const fieldJson = cleaned as unknown as Prisma.InputJsonValue;
    const oppJson: Prisma.InputJsonValue | typeof Prisma.JsonNull = input.opportunityDefaults
      ? (input.opportunityDefaults as unknown as Prisma.InputJsonValue)
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
              status: (opp.defaultStatus as QuoteStatus | undefined) ?? 'DRAFT',
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

  /** Process all responses since the mapping's lastSeenResponseTime. */
  async processNewResponses(businessId: string, formId: string): Promise<ProcessResult> {
    const record = await this.getMapping(businessId, formId);
    if (!record) throw new NotFoundException('No mapping configured for this form');
    return this.runProcess(this.toRow(record), { onlyNew: true });
  }

  /** Backfill: apply mapping to every response on the form (idempotent). */
  async backfill(businessId: string, formId: string): Promise<ProcessResult> {
    const record = await this.getMapping(businessId, formId);
    if (!record) throw new NotFoundException('No mapping configured for this form');
    const result = await this.runProcess(this.toRow(record), { onlyNew: false });
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
        await this.runProcess(this.toRow(record), { onlyNew: true });
      } catch (err: any) {
        this.logger.warn(
          `Auto-process failed for form ${record.formId} (business ${payload.businessId}): ${(err as Error).message}`,
        );
      }
    }
  }
}
