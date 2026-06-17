import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import type {
  BlueprintData,
  BlueprintDocumentProfile,
  BlueprintGeneratedDocument,
} from '../blueprint/blueprint.types';
import { DocumentsService } from '../documents/documents.service';
import { DOCUMENT_TYPES } from '../documents/document-taxonomy';
import { GovernanceService } from '../governance/governance.service';
import type { GeneratedDoc, GenesisDocumentPackResult } from './business-genesis.types';
import { inferTrinidadCompliance } from './trinidad-compliance-rules';

interface PackSelection {
  slug: string;
  title: string;
  condition: boolean;
}

@Injectable()
export class GenesisDocumentPackService {
  private readonly logger = new Logger(GenesisDocumentPackService.name);

  constructor(
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(GovernanceService) private readonly governance: GovernanceService,
  ) {}

  async generatePack(businessId: string): Promise<GenesisDocumentPackResult> {
    const blueprint = await this.blueprint.getBlueprint(businessId);

    if (!blueprint.legalProfile?.disclaimerAcceptedAt) {
      throw new ForbiddenException('Legal disclaimer must be accepted first.');
    }

    const selections = this.buildSelections(blueprint);
    const generatedDocs: GeneratedDoc[] = [];
    const missing: string[] = [];

    for (const selection of selections) {
      if (selection.slug === 'registration-checklist-tt') {
        const doc = await this.generateRegistrationChecklist(businessId, blueprint);
        if (doc) {
          generatedDocs.push(this.toGeneratedDoc(doc, selection.slug));
        } else {
          missing.push(selection.slug);
        }
        continue;
      }

      const typeDef = DOCUMENT_TYPES.find((d) => d.slug === selection.slug);
      if (!typeDef) {
        this.logger.warn(
          `Document type "${selection.slug}" (${selection.title}) is not available in the taxonomy; skipping.`,
        );
        missing.push(selection.slug);
        continue;
      }

      try {
        const instance = await this.documents.generateDocument(businessId, {
          documentTypeSlug: selection.slug,
          title: selection.title,
          contextInputs: this.buildContextInputs(blueprint),
        });
        generatedDocs.push(this.toGeneratedDoc(instance, selection.slug));
      } catch (err) {
        this.logger.warn(
          `Failed to generate document ${selection.slug} for ${businessId}: ${(err as Error).message}`,
        );
        missing.push(selection.slug);
      }
    }

    await this.persistPackState(businessId, blueprint, generatedDocs, missing);

    return { generated: generatedDocs, missing };
  }

  async getPack(businessId: string): Promise<GenesisDocumentPackResult> {
    const blueprint = await this.blueprint.getBlueprint(businessId);
    const profile = blueprint.documentProfile || {};
    const generatedRecords = profile.generatedDocuments || [];
    const missing = profile.missingDocuments || [];

    const instances = await this.prisma.client.documentInstance.findMany({
      where: { businessId, id: { in: generatedRecords.map((r) => r.instanceId) } },
      include: { documentType: true },
    });
    const instanceMap = new Map(instances.map((i) => [i.id, i]));

    const generated: GeneratedDoc[] = generatedRecords.map((record) => {
      const instance = instanceMap.get(record.instanceId);
      return {
        instanceId: record.instanceId,
        documentTypeSlug: record.documentTypeSlug,
        title: instance?.title || record.title,
        status: instance?.status || 'UNKNOWN',
        createdAt: instance?.createdAt?.toISOString() || record.generatedAt,
      };
    });

    return { generated, missing };
  }

  private buildSelections(blueprint: BlueprintData): PackSelection[] {
    const hasDigitalPresence = this.hasDigitalPresence(blueprint);
    const hasOnlineChannels = this.hasOnlineChannels(blueprint);
    const hasEmployees = this.hasEmployees(blueprint);
    const hasPartners = blueprint.ownershipProfile?.hasPartners === true;
    const hasContractors = blueprint.taxProfile?.contractorPaymentsExpected === true;

    return [
      {
        slug: 'registration-checklist-tt',
        title: 'Trinidad & Tobago Business Registration Checklist',
        condition: true,
      },
      { slug: 'legal-readiness-checklist', title: 'Legal Readiness Checklist', condition: true },
      { slug: 'privacy-policy', title: 'Privacy Policy', condition: hasDigitalPresence },
      { slug: 'website-terms', title: 'Website Terms of Use', condition: hasOnlineChannels },
      { slug: 'service-agreement', title: 'Service Agreement', condition: true },
      { slug: 'offer-letter', title: 'Employment Offer Letter', condition: hasEmployees },
      { slug: 'employee-handbook', title: 'Employee Handbook', condition: hasEmployees },
      { slug: 'nda-employee', title: 'Employee Confidentiality Agreement', condition: hasEmployees },
      { slug: 'founder-agreement', title: 'Founder Agreement', condition: hasPartners },
      { slug: 'shareholder-agreement', title: 'Shareholder Agreement', condition: hasPartners },
      {
        slug: 'contractor-agreement',
        title: 'Independent Contractor Agreement',
        condition: hasContractors,
      },
    ].filter((s) => s.condition);
  }

  private hasDigitalPresence(blueprint: BlueprintData): boolean {
    if (this.channelsIncludeOnline(blueprint.operatingModel?.channels)) return true;
    if (this.isOnlineDelivery(blueprint.operatingModel?.deliveryMode)) return true;
    if (blueprint.workflowModel?.ecommerceFulfillment) return true;
    const marketingChannels = blueprint.marketingSystem?.channels
      ?.map((c) => c.channel)
      .filter((c): c is string => typeof c === 'string');
    if (this.channelsIncludeOnline(marketingChannels)) return true;
    return false;
  }

  private hasOnlineChannels(blueprint: BlueprintData): boolean {
    return this.hasDigitalPresence(blueprint);
  }

  private hasEmployees(blueprint: BlueprintData): boolean {
    const status = blueprint.registrationProfile?.nisEmployerStatus;
    return status !== undefined && status !== 'NOT_NEEDED';
  }

  private channelsIncludeOnline(channels: string[] | undefined): boolean {
    if (!channels) return false;
    const online = new Set(['website', 'online', 'ecommerce', 'e-commerce', 'web', 'social media']);
    return channels.some((c) => online.has(c.toLowerCase()));
  }

  private isOnlineDelivery(mode: string | undefined): boolean {
    if (!mode) return false;
    const lower = mode.toLowerCase();
    return lower.includes('online') || lower.includes('digital') || lower.includes('ecommerce');
  }

  private buildContextInputs(blueprint: BlueprintData): Record<string, string> {
    return {
      businessName: blueprint.identity?.name || '',
      industry: blueprint.identity?.industry || '',
      country: blueprint.identity?.country || '',
      entityType: blueprint.legalProfile?.recommendedEntityType || '',
    };
  }

  private async generateRegistrationChecklist(
    businessId: string,
    blueprint: BlueprintData,
  ): Promise<{ id: string; title: string; status: string; createdAt: Date } | null> {
    const ttSlug = 'registration-checklist-tt';
    const fallbackSlug = 'compliance-policy';

    if (DOCUMENT_TYPES.some((d) => d.slug === ttSlug)) {
      return this.documents.generateDocument(businessId, {
        documentTypeSlug: ttSlug,
        title: 'Trinidad & Tobago Business Registration Checklist',
        contextInputs: this.buildContextInputs(blueprint),
      });
    }

    if (DOCUMENT_TYPES.some((d) => d.slug === fallbackSlug)) {
      this.logger.log(
        `registration-checklist-tt not in taxonomy; generating deterministic checklist under ${fallbackSlug} for ${businessId}.`,
      );
      return this.createManualRegistrationChecklist(businessId, blueprint);
    }

    this.logger.warn(
      `Cannot create Trinidad & Tobago registration checklist: neither registration-checklist-tt nor compliance-policy exists in taxonomy.`,
    );
    return null;
  }

  private async createManualRegistrationChecklist(
    businessId: string,
    blueprint: BlueprintData,
  ): Promise<{ id: string; title: string; status: string; createdAt: Date } | null> {
    const docType = await this.prisma.client.documentType.findUnique({
      where: { slug: 'compliance-policy' },
    });
    if (!docType) {
      this.logger.warn(`compliance-policy document type not found in database for ${businessId}.`);
      return null;
    }

    const profileVersion = await this.getOrCreateProfileVersion(businessId);
    const complianceItems = inferTrinidadCompliance({
      entityType: blueprint.legalProfile?.recommendedEntityType,
      hasEmployees: this.hasEmployees(blueprint),
      estimatedAnnualRevenue: blueprint.taxProfile?.estimatedAnnualRevenue,
      industry: blueprint.identity?.industry,
      regulatedIndustry: blueprint.legalProfile?.regulatedIndustry,
      hasPhysicalLocation: blueprint.legalProfile?.hasPhysicalLocation,
    });

    const title = 'Trinidad & Tobago Business Registration Checklist';
    const sections = complianceItems.map((item, index) => {
      const sectionKey = item.id || `tt-item-${index}`;
      const sectionName = item.label || `Registration item ${index + 1}`;
      return {
        sectionKey,
        sectionName,
        content: this.buildChecklistSectionContent({
          id: sectionKey,
          label: sectionName,
          priority: item.priority,
          authority: item.authority,
          status: item.status,
          notes: item.notes,
        }),
        contentSource: 'AI_GENERATED' as const,
        editableMode: 'GUIDED' as const,
        riskScore: item.priority === 'CRITICAL' ? 'RED' : 'YELLOW',
        reviewRequired: item.priority === 'CRITICAL',
        sortOrder: index,
      };
    });

    const sectionSnapshots = sections.map((s) => ({
      key: s.sectionKey,
      name: s.sectionName,
      content: s.content,
    }));

    return this.prisma.client.documentInstance.create({
      data: {
        businessId,
        documentTypeId: docType.id,
        templateId: null,
        profileVersionId: profileVersion.id,
        title,
        status: 'DRAFT',
        healthStatus: 'CURRENT',
        currentVersionNum: 1,
        contextInputs: this.buildContextInputs(blueprint),
        toneSettings: {},
        generationMeta: {
          generatedAt: new Date().toISOString(),
          source: 'genesis-deterministic-checklist',
          jurisdiction: 'Trinidad and Tobago',
          itemCount: complianceItems.length,
          profileVersionNumber: profileVersion.versionNumber,
        },
        sections: { create: sections },
        versions: {
          create: {
            versionNumber: 1,
            content: { title, sections: sectionSnapshots },
            sectionSnapshots,
            status: 'DRAFT',
            createdBy: 'system',
            basedOnProfile: profileVersion.versionNumber,
            basedOnTemplate: null,
          },
        },
      },
      include: {
        documentType: { include: { category: true } },
        sections: { orderBy: { sortOrder: 'asc' } },
        versions: true,
      },
    });
  }

  private buildChecklistSectionContent(item: {
    id: string;
    label: string;
    priority?: string;
    authority?: string;
    status?: string;
    notes?: string;
  }): string {
    const parts = [
      `Priority: ${item.priority || 'MEDIUM'}`,
      item.authority ? `Authority: ${item.authority}` : '',
      `Status: ${item.status || 'NOT_STARTED'}`,
      '',
      `Action: ${item.label}`,
      item.notes ? `\nNotes: ${item.notes}` : '',
    ];
    return parts.filter(Boolean).join('\n');
  }

  private async getOrCreateProfileVersion(businessId: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) {
      throw new Error(`Business ${businessId} not found`);
    }

    const latest = await this.prisma.client.businessProfileVersion.findFirst({
      where: { businessId },
      orderBy: { versionNumber: 'desc' },
    });

    const snapshot = {
      name: business.name,
      tagline: business.tagline,
      description: business.description,
      address: business.address,
      city: business.city,
      country: business.country,
      phone: business.phone,
      email: business.email,
      website: business.website,
      industry: business.industry,
      teamSize: business.teamSize,
      revenueModel: business.revenueModel,
      businessStage: business.businessStage,
      skills: business.skills,
    };

    if (latest) {
      const latestSnap = latest.snapshot as Record<string, unknown>;
      const changed = Object.keys(snapshot).filter(
        (k) => JSON.stringify(latestSnap[k]) !== JSON.stringify(snapshot[k as keyof typeof snapshot]),
      );
      if (changed.length === 0) return latest;

      return this.prisma.client.businessProfileVersion.create({
        data: {
          businessId,
          versionNumber: latest.versionNumber + 1,
          snapshot,
          changedFields: changed,
        },
      });
    }

    return this.prisma.client.businessProfileVersion.create({
      data: {
        businessId,
        versionNumber: 1,
        snapshot,
        changedFields: [],
      },
    });
  }

  private toGeneratedDoc(
    instance: { id: string; title: string; status: string; createdAt: Date },
    slug: string,
  ): GeneratedDoc {
    return {
      instanceId: instance.id,
      documentTypeSlug: slug,
      title: instance.title,
      status: instance.status,
      createdAt: instance.createdAt.toISOString(),
    };
  }

  private async persistPackState(
    businessId: string,
    blueprint: BlueprintData,
    generated: GeneratedDoc[],
    missing: string[],
  ): Promise<void> {
    const existing = blueprint.documentProfile?.generatedDocuments || [];
    const merged = new Map<string, BlueprintGeneratedDocument>();

    for (const record of existing) {
      merged.set(record.instanceId, record);
    }

    for (const doc of generated) {
      merged.set(doc.instanceId, {
        instanceId: doc.instanceId,
        documentTypeSlug: doc.documentTypeSlug,
        title: doc.title,
        generatedAt: doc.createdAt,
      });
    }

    const nextProfile: BlueprintDocumentProfile = {
      generatedDocuments: Array.from(merged.values()),
      missingDocuments: missing,
    };

    await this.blueprint.updateBlueprint(businessId, { documentProfile: nextProfile });
  }
}
