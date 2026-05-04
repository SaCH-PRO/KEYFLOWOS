import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@keyflow/db';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import type { CrmField, FieldMappingEntry } from './google-forms-mapping.service';

const SUPPORTED_SOURCES = ['typeform', 'jotform', 'webhook_form'] as const;
export type ConnectorFormSource = (typeof SUPPORTED_SOURCES)[number];

const CONNECTOR_KEY: Record<ConnectorFormSource, string> = {
  typeform: 'typeform',
  jotform: 'jotform',
  webhook_form: 'webhook_form',
};

const VALID_CRM_FIELDS = new Set<CrmField>([
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
]);

interface PerFormMapping {
  formId: string;
  formTitle?: string | null;
  fieldMappings: FieldMappingEntry[];
  defaultTags?: string[];
  defaultStatus?: string | null;
  autoCreate?: boolean;
  processedSubmissionIds?: string[];
  lastBackfillAt?: string;
}

interface MappingMetadata {
  formMappings?: Record<string, PerFormMapping>;
}

interface ProcessResult {
  responsesProcessed: number;
  responsesSkipped: number;
  contactsCreated: number;
  errors: string[];
}

const PROCESSED_ID_CAP = 5000;

export function isSupportedSource(s: string): s is ConnectorFormSource {
  return (SUPPORTED_SOURCES as readonly string[]).includes(s);
}

@Injectable()
export class ConnectorFormMappingService {
  private readonly logger = new Logger(ConnectorFormMappingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmService) private readonly crm: CrmService,
  ) {}

  /** List virtual LeadForm rows + submission counts for an external source. */
  async listForms(businessId: string, source: ConnectorFormSource) {
    const forms = await this.prisma.client.leadForm.findMany({
      where: {
        businessId,
        deletedAt: null,
        embedCode: { startsWith: `${source}:` },
      },
      include: { _count: { select: { submissions: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    const meta = await this.readMetadata(businessId, source);
    return forms.map((f) => {
      const externalFormId = (f.embedCode ?? '').slice(source.length + 1);
      const mapping = meta.formMappings?.[externalFormId];
      const processedCount = mapping?.processedSubmissionIds?.length ?? 0;
      const submissionCount = f._count.submissions;
      const pendingCount = Math.max(0, submissionCount - processedCount);
      return {
        leadFormId: f.id,
        externalFormId,
        name: f.name,
        submissionCount,
        processedCount,
        pendingCount,
        hasMapping: !!mapping?.fieldMappings?.length,
        autoCreate: mapping?.autoCreate ?? true,
        lastBackfillAt: mapping?.lastBackfillAt ?? null,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      };
    });
  }

  /** Recent submissions for a single virtual leadFormId. */
  async listSubmissions(businessId: string, source: ConnectorFormSource, leadFormId: string, limit = 50) {
    const form = await this.prisma.client.leadForm.findFirst({
      where: { id: leadFormId, businessId, deletedAt: null, embedCode: { startsWith: `${source}:` } },
      select: { id: true, name: true, embedCode: true },
    });
    if (!form) throw new NotFoundException('Form not found for this provider');
    const submissions = await this.prisma.client.leadFormSubmission.findMany({
      where: { businessId, formId: leadFormId },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 200)),
      select: { id: true, data: true, contactId: true, createdAt: true, source: true },
    });
    return {
      form: {
        leadFormId: form.id,
        externalFormId: (form.embedCode ?? '').slice(source.length + 1),
        name: form.name,
      },
      submissions,
    };
  }

  async getMapping(businessId: string, source: ConnectorFormSource, externalFormId: string) {
    const meta = await this.readMetadata(businessId, source);
    return meta.formMappings?.[externalFormId] ?? null;
  }

  async saveMapping(
    businessId: string,
    source: ConnectorFormSource,
    externalFormId: string,
    input: Partial<PerFormMapping>,
  ): Promise<PerFormMapping> {
    if (!externalFormId) throw new BadRequestException('externalFormId required');
    const cleaned = this.validateMappings(input.fieldMappings ?? []);
    const meta = await this.readMetadata(businessId, source);
    const prev = meta.formMappings?.[externalFormId] ?? { formId: externalFormId, fieldMappings: [] };
    const next: PerFormMapping = {
      formId: externalFormId,
      formTitle: input.formTitle ?? prev.formTitle ?? null,
      fieldMappings: cleaned,
      defaultTags: Array.isArray(input.defaultTags)
        ? input.defaultTags.filter((s) => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
        : (prev.defaultTags ?? []),
      defaultStatus:
        input.defaultStatus !== undefined ? input.defaultStatus : (prev.defaultStatus ?? null),
      autoCreate: input.autoCreate ?? prev.autoCreate ?? true,
      processedSubmissionIds: prev.processedSubmissionIds ?? [],
      lastBackfillAt: prev.lastBackfillAt,
    };
    const formMappings = { ...(meta.formMappings ?? {}), [externalFormId]: next };
    await this.writeMetadata(businessId, source, { ...meta, formMappings });
    return next;
  }

  async deleteMapping(businessId: string, source: ConnectorFormSource, externalFormId: string) {
    const meta = await this.readMetadata(businessId, source);
    if (!meta.formMappings?.[externalFormId]) return { success: true };
    const formMappings = { ...meta.formMappings };
    delete formMappings[externalFormId];
    await this.writeMetadata(businessId, source, { ...meta, formMappings });
    return { success: true };
  }

  /** Re-apply the mapping to every existing submission for a form (idempotent). */
  async backfill(
    businessId: string,
    source: ConnectorFormSource,
    leadFormId: string,
  ): Promise<ProcessResult> {
    const form = await this.prisma.client.leadForm.findFirst({
      where: { id: leadFormId, businessId, deletedAt: null, embedCode: { startsWith: `${source}:` } },
      select: { id: true, name: true, embedCode: true },
    });
    if (!form) throw new NotFoundException('Form not found for this provider');
    const externalFormId = (form.embedCode ?? '').slice(source.length + 1);
    const meta = await this.readMetadata(businessId, source);
    const mapping = meta.formMappings?.[externalFormId];
    if (!mapping || !mapping.fieldMappings.length) {
      throw new BadRequestException('No mapping configured for this form');
    }

    const submissions = await this.prisma.client.leadFormSubmission.findMany({
      where: { businessId, formId: leadFormId },
      orderBy: { createdAt: 'asc' },
    });

    const seen = new Set(mapping.processedSubmissionIds ?? []);
    const result: ProcessResult = {
      responsesProcessed: 0,
      responsesSkipped: 0,
      contactsCreated: 0,
      errors: [],
    };
    const newlyProcessed: string[] = [];

    for (const sub of submissions) {
      if (seen.has(sub.id)) {
        result.responsesSkipped += 1;
        continue;
      }
      try {
        const out = await this.applyToSubmission(businessId, mapping, form.name, sub);
        result.responsesProcessed += 1;
        if (out.contactCreated) result.contactsCreated += 1;
        newlyProcessed.push(sub.id);
      } catch (err) {
        result.errors.push(`${sub.id}: ${(err as Error).message}`);
      }
    }

    const merged = [...(mapping.processedSubmissionIds ?? []), ...newlyProcessed];
    const trimmed = merged.length > PROCESSED_ID_CAP ? merged.slice(merged.length - PROCESSED_ID_CAP) : merged;
    const formMappings = {
      ...(meta.formMappings ?? {}),
      [externalFormId]: {
        ...mapping,
        processedSubmissionIds: trimmed,
        lastBackfillAt: new Date().toISOString(),
      },
    };
    await this.writeMetadata(businessId, source, { ...meta, formMappings });
    return result;
  }

  private async applyToSubmission(
    businessId: string,
    mapping: PerFormMapping,
    formName: string,
    submission: { id: string; data: unknown; contactId: string | null },
  ): Promise<{ contactCreated: boolean }> {
    const data = (submission.data ?? {}) as Record<string, unknown>;
    const values: Partial<Record<CrmField, string>> = {};
    const tags: string[] = [...(mapping.defaultTags ?? [])];

    for (const entry of mapping.fieldMappings) {
      const v = data[entry.questionId];
      const text = v == null ? '' : String(v).trim();
      if (!text) continue;
      if (entry.crmField === 'ignore') continue;
      if (entry.crmField === 'tag') {
        tags.push(text);
        continue;
      }
      values[entry.crmField] = text;
    }
    if (submission.contactId) {
      // Existing contact already linked — merge (never replace) tags / status.
      try {
        if (tags.length || mapping.defaultStatus) {
          const existing = await this.prisma.client.contact.findUnique({
            where: { id: submission.contactId },
            select: { tags: true },
          });
          const merged = Array.from(
            new Set([...(existing?.tags ?? []), ...tags].map((t) => t.trim()).filter(Boolean)),
          );
          await this.prisma.client.contact.update({
            where: { id: submission.contactId },
            data: {
              ...(tags.length ? { tags: { set: merged } } : {}),
              ...(mapping.defaultStatus ? { status: mapping.defaultStatus } : {}),
            },
          });
        }
      } catch (err) {
        this.logger.warn(`Could not enrich contact ${submission.contactId}: ${(err as Error).message}`);
      }
      return { contactCreated: false };
    }
    if (!values.email && !values.phone) return { contactCreated: false };
    if (mapping.autoCreate === false) {
      // User has disabled auto-create — only enrich existing contacts, never create new ones.
      return { contactCreated: false };
    }
    const contact = await this.crm.createContact({
      businessId,
      firstName: values.firstName ?? null,
      lastName: values.lastName ?? null,
      email: values.email ?? null,
      phone: values.phone ?? null,
      companyName: values.companyName ?? undefined,
      jobTitle: values.jobTitle ?? undefined,
      addressLine1: values.addressLine1 ?? undefined,
      city: values.city ?? undefined,
      state: values.state ?? undefined,
      postalCode: values.postalCode ?? undefined,
      country: values.country ?? undefined,
      notesInternal: values.notesInternal ?? undefined,
      source: 'connector_form',
      sourceDetail: formName,
      tags,
      custom: { externalFormId: mapping.formId, submissionId: submission.id },
    });
    if (mapping.defaultStatus) {
      await this.prisma.client.contact
        .update({ where: { id: contact.id }, data: { status: mapping.defaultStatus } })
        .catch(() => undefined);
    }
    await this.prisma.client.leadFormSubmission
      .update({ where: { id: submission.id }, data: { contactId: contact.id } })
      .catch(() => undefined);
    return { contactCreated: true };
  }

  private validateMappings(entries: FieldMappingEntry[]): FieldMappingEntry[] {
    if (!Array.isArray(entries)) {
      throw new BadRequestException('fieldMappings must be an array');
    }
    return entries
      .filter((e) => e && typeof e.questionId === 'string')
      .map((e) => {
        if (!VALID_CRM_FIELDS.has(e.crmField)) {
          throw new BadRequestException(`Unknown CRM field "${e.crmField}"`);
        }
        return {
          questionId: e.questionId,
          questionTitle: e.questionTitle ?? undefined,
          crmField: e.crmField,
        };
      });
  }

  private async readMetadata(
    businessId: string,
    source: ConnectorFormSource,
  ): Promise<MappingMetadata> {
    const row = await this.prisma.client.connectorStatus.findUnique({
      where: {
        businessId_connectorType: { businessId, connectorType: CONNECTOR_KEY[source] },
      },
      select: { metadata: true },
    });
    return ((row?.metadata as MappingMetadata | null | undefined) ?? {}) as MappingMetadata;
  }

  private async writeMetadata(
    businessId: string,
    source: ConnectorFormSource,
    next: MappingMetadata,
  ) {
    const existing = await this.prisma.client.connectorStatus.findUnique({
      where: {
        businessId_connectorType: { businessId, connectorType: CONNECTOR_KEY[source] },
      },
      select: { metadata: true },
    });
    const meta = (existing?.metadata ?? {}) as Record<string, unknown>;
    const merged = { ...meta, ...next };
    await this.prisma.client.connectorStatus.upsert({
      where: {
        businessId_connectorType: { businessId, connectorType: CONNECTOR_KEY[source] },
      },
      create: {
        businessId,
        connectorType: CONNECTOR_KEY[source],
        status: 'disconnected',
        metadata: merged as unknown as Prisma.InputJsonValue,
      },
      update: { metadata: merged as unknown as Prisma.InputJsonValue },
    });
  }
}
