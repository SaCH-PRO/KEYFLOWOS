import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@keyflow/db';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { canonicalContactStatus } from '../crm/crm.constants';
import { contactWhereWithId } from '../crm/crm.helpers';
import type { CrmField, FieldMappingEntry } from './google-forms-mapping.service';
import {
  configuringMember,
  contactWritableBy,
  membersMayCreateContacts,
  settingDefaultContactStatus,
  syncPrincipals,
  type SyncPrincipals,
} from './google-contacts-sync.service';

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
  /**
   * W6-CONNECT-TAG-MERGE (SEC-D92R-2): the member who last saved this mapping,
   * whom a backfill writes existing contacts as. Only the server writes it
   * (saveMapping); a mapping saved before W6 records none (D-93: the owner).
   */
  configuredBy?: string | null;
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

/**
 * W6-CONNECT-TAG-MERGE review repairs SEC-W6CTM-2/3: who a backfill run writes
 * as (syncPrincipals), and whether its members may create contacts, asked once
 * when the run first needs to create one.
 */
interface BackfillGate {
  principals: SyncPrincipals;
  mayCreate?: boolean;
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
    const mapping = meta.formMappings?.[externalFormId];
    // D-92: report the default status a backfill applies (see applyToSubmission).
    return mapping ? { ...mapping, defaultStatus: canonicalContactStatus(mapping.defaultStatus) } : null;
  }

  async saveMapping(
    businessId: string,
    source: ConnectorFormSource,
    externalFormId: string,
    input: Partial<PerFormMapping>,
    actorUserId?: string,
  ): Promise<PerFormMapping> {
    if (!externalFormId) throw new BadRequestException('externalFormId required');
    // D-92 (W5-D92-RESIDUALS): a default status is stored only as a ContactStatus;
    // one with none is a 400 before anything is read or written.
    const defaultStatus = settingDefaultContactStatus(input.defaultStatus);
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
        defaultStatus !== undefined ? defaultStatus : canonicalContactStatus(prev.defaultStatus),
      autoCreate: input.autoCreate ?? prev.autoCreate ?? true,
      processedSubmissionIds: prev.processedSubmissionIds ?? [],
      lastBackfillAt: prev.lastBackfillAt,
      // W6-CONNECT-TAG-MERGE (SEC-D92R-2): the member saving the mapping (the
      // route does not pass its caller: the member the TenantInterceptor bound
      // to the request), never a value from the body.
      configuredBy: configuringMember(businessId, actorUserId) ?? prev.configuredBy ?? null,
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

    // W6-CONNECT-TAG-MERGE (SEC-D92R-2; D-93; review SEC-W6CTM-2): the member
    // this backfill writes as and records on every contact it writes (the
    // member who starts it), and every member each write must be allowed for.
    const principals = await syncPrincipals(this.prisma, businessId, mapping.configuredBy);
    const gate: BackfillGate = { principals };
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
        const out = await this.applyToSubmission(businessId, mapping, form.name, sub, gate);
        if (out.skipped) {
          // Not marked processed: a later backfill whose members may write the
          // contact applies it.
          result.responsesSkipped += 1;
          continue;
        }
        result.responsesProcessed += 1;
        if (out.contactCreated) result.contactsCreated += 1;
        newlyProcessed.push(sub.id);
      } catch (err: any) {
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

  /**
   * W6-CONNECT-TAG-MERGE (W5-D92-RESIDUALS review SEC-D92R-2; D-93): merge
   * `tags` into a live contact of this business as the run's actor, through
   * the CRM's own tag merge (CrmService.bulkUpdateContacts addTags, the PATCH
   * contacts/bulk door): a member who is not the owner reaches it only when
   * they can open it (the GET detail visibility clause) and their edit scope
   * reaches it; the ContactEvent (bulk.updated) and the ContactAuditEntry
   * (bulk_updated) record that member. Review SEC-W6CTM-2: every other member
   * of the run (the configuring member) must be able to edit it too. False
   * when nothing was merged for these members: the contact is left exactly as
   * it is. Before W6 the backfill merged the tags with prisma.contact.update,
   * into any live contact of the business, the owner's PRIVATE ones included,
   * with no actor.
   */
  private async mergeTagsAs(
    businessId: string,
    contactId: string,
    tags: string[],
    { actor, members }: SyncPrincipals,
  ): Promise<boolean> {
    if (!actor) return false;
    const addTags = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
    if (addTags.length === 0) return true;
    const others = members.filter((m) => m !== actor);
    if (others.length > 0 && !(await contactWritableBy(this.prisma, this.crm, businessId, contactId, others))) {
      return false;
    }
    try {
      const out = await this.crm.bulkUpdateContacts({ businessId, contactIds: [contactId], addTags, actorUserId: actor });
      return out.updated > 0;
    } catch (err: unknown) {
      if (!(err instanceof ForbiddenException || err instanceof NotFoundException)) {
        this.logger.warn(`Could not enrich contact ${contactId}: ${(err as Error).message}`);
      }
      return false;
    }
  }

  private async applyToSubmission(
    businessId: string,
    mapping: PerFormMapping,
    formName: string,
    submission: { id: string; data: unknown; contactId: string | null },
    gate: BackfillGate,
  ): Promise<{ contactCreated: boolean; skipped?: boolean }> {
    const data = (submission.data ?? {}) as Record<string, unknown>;
    const values: Partial<Record<CrmField, string>> = {};
    const tags: string[] = [...(mapping.defaultTags ?? [])];
    // D-92 (W5-D92-RESIDUALS): a mapping stored before D-92 may hold any value,
    // so it is applied through canonicalContactStatus: a legacy DORMANT or
    // CUSTOMER is CLIENT, and a value with no ContactStatus writes no status.
    const defaultStatus = canonicalContactStatus(mapping.defaultStatus);

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
      // Existing contact already linked: merge (never replace) its tags.
      // W5-D92-RESIDUALS review SEC-D92R-2: the mapping's default status is for
      // the contacts it creates. An existing contact's status is the business's
      // (an external adapter never overwrites it, crm.constants.ts), so it is
      // never written here; this overwrote it by id before (a LOST contact
      // became CLIENT, a trashed one was rewritten). And only a live contact of
      // this business is enriched: a trashed contact, or a contact id that is
      // not this business's, is left as it is.
      // W6-CONNECT-TAG-MERGE (SEC-D92R-2): and only as the run's members may
      // write it (mergeTagsAs); a contact they cannot open or edit is left as
      // it is and the submission reported skipped (pending).
      if (!tags.length) return { contactCreated: false };
      // Review CR-CTM-1: a submission whose contact is not a live contact of
      // this business is processed with nothing written, as before W6; only a
      // refusal for this run's members leaves it pending.
      const live = await this.prisma.client.contact.findFirst({
        where: contactWhereWithId(businessId, submission.contactId),
        select: { id: true },
      });
      if (!live) return { contactCreated: false };
      const merged = await this.mergeTagsAs(businessId, submission.contactId, tags, gate.principals);
      return { contactCreated: false, skipped: !merged };
    }
    if (!values.email && !values.phone) return { contactCreated: false };
    if (mapping.autoCreate === false) {
      // User has disabled auto-create — only enrich existing contacts, never create new ones.
      return { contactCreated: false };
    }
    // Review SEC-W6CTM-3: a contact is created only when the CRM create door
    // admits every member of the run (CrmService.createContact checks the
    // actor it is given; the configuring member is asked here too). Otherwise
    // the submission is reported skipped and stays pending; before, the contact
    // was created and its audit entry named a member the door refuses.
    const { actor, members } = gate.principals;
    gate.mayCreate ??= await membersMayCreateContacts(
      this.crm,
      businessId,
      members.filter((m) => m !== actor),
    );
    if (!gate.mayCreate) return { contactCreated: false, skipped: true };
    // W6-CONNECT-TAG-MERGE: the contact a backfill creates records the acting
    // member too (ContactEvent contact.created and the 'created' audit entry).
    const audit = actor ? { actor: { type: 'USER' as const, id: actor } } : undefined;
    let contact: Awaited<ReturnType<CrmService['createContact']>>;
    try {
      contact = await this.crm.createContact({
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
        // SEC-W6CTM-3: the CRM create door's own check of the actor.
        ...(actor ? { actorUserId: actor } : {}),
      }, audit);
    } catch (err: unknown) {
      if (err instanceof ForbiddenException) return { contactCreated: false, skipped: true };
      throw err;
    }
    if (defaultStatus) {
      await this.prisma.client.contact
        .update({ where: { id: contact.id }, data: { status: defaultStatus } })
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
