import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { BusinessContextService } from '../identity/business-context.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(AiUsageService) private aiUsage: AiUsageService,
    @Inject(BusinessContextService) private bizContext: BusinessContextService,
    @Inject(TransactionalEmailService) private emailService: TransactionalEmailService,
  ) {}

  async getCategories(businessId?: string) {
    const categories = await this.prisma.client.documentCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        documentTypes: {
          orderBy: { sortOrder: 'asc' },
          include: {
            _count: businessId
              ? { select: { instances: { where: { businessId } } } }
              : undefined,
          },
        },
      },
    });
    return categories;
  }

  async getDocumentTypes(categorySlug?: string) {
    return this.prisma.client.documentType.findMany({
      where: categorySlug ? { category: { slug: categorySlug } } : undefined,
      orderBy: { sortOrder: 'asc' },
      include: { category: true },
    });
  }

  async getDocumentType(slug: string) {
    const dt = await this.prisma.client.documentType.findUnique({
      where: { slug },
      include: {
        category: true,
        templates: { where: { isActive: true }, include: { clauses: { include: { variants: true }, orderBy: { sortOrder: 'asc' } } } },
        impactRules: true,
      },
    });
    if (!dt) throw new NotFoundException('Document type not found');
    return dt;
  }

  async getInstances(businessId: string, filters?: { status?: string; categorySlug?: string; healthStatus?: string }) {
    return this.prisma.client.documentInstance.findMany({
      where: {
        businessId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.healthStatus ? { healthStatus: filters.healthStatus } : {}),
        ...(filters?.categorySlug ? { documentType: { category: { slug: filters.categorySlug } } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        documentType: { include: { category: true } },
        _count: { select: { versions: true, reviewTasks: true } },
      },
    });
  }

  async getInstance(businessId: string, instanceId: string) {
    const inst = await this.prisma.client.documentInstance.findFirst({
      where: { id: instanceId, businessId },
      include: {
        documentType: { include: { category: true } },
        sections: { orderBy: { sortOrder: 'asc' } },
        versions: { orderBy: { versionNumber: 'desc' }, take: 10 },
        reviewTasks: { orderBy: { createdAt: 'desc' } },
        changeLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
        profileVersion: true,
      },
    });
    if (!inst) throw new NotFoundException('Document not found');
    return inst;
  }

  async generateDocument(
    businessId: string,
    body: {
      documentTypeSlug: string;
      title?: string;
      contextInputs?: Record<string, string>;
      toneSettings?: { style?: string; riskAppetite?: string; length?: string; formality?: string };
    },
    actorUserId?: string,
  ) {
    const docType = await this.prisma.client.documentType.findUnique({
      where: { slug: body.documentTypeSlug },
      include: { category: true, templates: { where: { isActive: true }, take: 1 } },
    });
    if (!docType) throw new NotFoundException('Document type not found');

    const missingFields = await this.checkMissingFields(businessId, docType.requiredProfileFields);

    const ctx = await this.bizContext.gatherContext(businessId);
    const contextBlock = this.bizContext.buildContextBlock(ctx, body.contextInputs || {});

    const profileVersion = await this.getOrCreateProfileVersion(businessId);

    const toneStr = body.toneSettings
      ? Object.entries(body.toneSettings).map(([k, v]) => `${k}: ${v}`).join(', ')
      : 'professional, clear, modern';

    const riskInstructions = this.getRiskInstructions(docType.riskTier);

    const systemPrompt = [
      `You are a professional business document drafting engine for Caribbean and international small businesses.`,
      `You generate structured, well-organized documents from business intelligence data.`,
      riskInstructions,
      `Tone: ${toneStr}`,
      `Output format: Return a JSON object with this structure:`,
      `{ "title": "document title", "sections": [ { "key": "section_key", "name": "Section Name", "content": "section content text", "riskScore": "GREEN|YELLOW|RED", "editableMode": "FREE|GUIDED|RESTRICTED" } ] }`,
      `Return ONLY valid JSON, no markdown formatting.`,
    ].join('\n');

    const userPrompt = [
      `BUSINESS CONTEXT:\n${contextBlock}`,
      '',
      `DOCUMENT TYPE: ${docType.name}`,
      `CATEGORY: ${docType.category.name}`,
      `RISK TIER: ${docType.riskTier}`,
      docType.description ? `PURPOSE: ${docType.description}` : '',
      body.contextInputs ? `ADDITIONAL CONTEXT:\n${JSON.stringify(body.contextInputs, null, 2)}` : '',
      missingFields.length > 0 ? `NOTE: Missing profile fields (use reasonable defaults): ${missingFields.join(', ')}` : '',
      '',
      `Generate a complete, well-structured ${docType.name} document with appropriate sections. Each section should be substantive and specific to this business.`,
    ].filter(Boolean).join('\n');

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'document-generate',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: 4000,
      temperature: 0.7,
    });

    let parsed: { title?: string; sections?: Array<{ key: string; name: string; content: string; riskScore?: string; editableMode?: string }> };
    try {
      const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {
        title: body.title || docType.name,
        sections: [{ key: 'main', name: 'Document Content', content: result.content, riskScore: 'GREEN', editableMode: 'GUIDED' }],
      };
    }

    const template = docType.templates[0] || null;
    const instance = await this.prisma.client.documentInstance.create({
      data: {
        businessId,
        documentTypeId: docType.id,
        templateId: template?.id || null,
        profileVersionId: profileVersion.id,
        title: body.title || parsed.title || docType.name,
        status: 'DRAFT',
        healthStatus: 'CURRENT',
        currentVersionNum: 1,
        contextInputs: body.contextInputs || {},
        toneSettings: body.toneSettings || {},
        generationMeta: {
          model: 'gpt-4o',
          missingFields,
          riskTier: docType.riskTier,
          profileVersionNumber: profileVersion.versionNumber,
          generatedAt: new Date().toISOString(),
        },
        sections: {
          create: (parsed.sections || []).map((s, i) => ({
            sectionKey: s.key || `section_${i}`,
            sectionName: s.name,
            content: s.content,
            contentSource: 'AI_GENERATED',
            editableMode: s.editableMode || (docType.riskTier === 'RED' ? 'RESTRICTED' : 'GUIDED'),
            riskScore: s.riskScore || docType.riskTier,
            reviewRequired: docType.riskTier === 'RED',
            sortOrder: i,
          })),
        },
        versions: {
          create: {
            versionNumber: 1,
            content: parsed,
            sectionSnapshots: parsed.sections,
            status: 'DRAFT',
            createdBy: 'system',
            basedOnProfile: profileVersion.versionNumber,
            basedOnTemplate: template?.version || null,
          },
        },
      },
      include: {
        documentType: { include: { category: true } },
        sections: { orderBy: { sortOrder: 'asc' } },
        versions: true,
      },
    });

    await this.logChange(businessId, instance.id, 'GENERATED', 'LOGIC', null, null, null, 'system', 'Document generated from business context', {
      documentType: docType.slug,
      riskTier: docType.riskTier,
      profileVersion: profileVersion.versionNumber,
    });

    if (docType.riskTier === 'RED') {
      await this.prisma.client.reviewTask.create({
        data: {
          businessId,
          instanceId: instance.id,
          reviewType: 'GENERATION_REVIEW',
          status: 'PENDING',
          notes: `High-risk ${docType.name} generated — review recommended before use.`,
        },
      });
    }

    this.sendDocumentEmail(businessId, instance, actorUserId).catch((err) => {
      this.logger.warn(`Document email failed: ${(err as Error).message}`);
    });

    return instance;
  }

  async tweakDocument(
    businessId: string,
    instanceId: string,
    body: { instruction: string; sectionKey?: string },
  ) {
    const inst = await this.getInstance(businessId, instanceId);
    const targetSections = body.sectionKey
      ? inst.sections.filter((s) => s.sectionKey === body.sectionKey)
      : inst.sections;

    if (targetSections.length === 0) throw new BadRequestException('Section not found');

    const currentContent = targetSections.map((s) => `### ${s.sectionName}\n${s.content}`).join('\n\n');

    const systemPrompt = [
      'You are a professional document editor for Caribbean and international small businesses.',
      'You adapt business documents based on user instructions while maintaining structure and compliance.',
      `Document risk tier: ${inst.documentType.riskTier}`,
      inst.documentType.riskTier === 'RED'
        ? 'This is a HIGH-RISK document. Translate the instruction into structured changes where possible. Do not freestyle legal clauses.'
        : '',
      'Return a JSON object: { "sections": [ { "key": "section_key", "content": "updated content" } ] }',
      'Return ONLY valid JSON.',
    ].filter(Boolean).join('\n');

    const userPrompt = [
      `CURRENT DOCUMENT CONTENT:\n${currentContent}`,
      '',
      `USER INSTRUCTION: ${body.instruction}`,
      '',
      'Apply the instruction to the document content. Keep the same section structure.',
    ].join('\n');

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'document-tweak',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: 4000,
      temperature: 0.6,
    });

    let updates: Array<{ key: string; content: string }>;
    try {
      const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      updates = parsed.sections || [];
    } catch {
      if (body.sectionKey) {
        updates = [{ key: body.sectionKey, content: result.content }];
      } else {
        updates = [{ key: targetSections[0].sectionKey, content: result.content }];
      }
    }

    for (const upd of updates) {
      const section = inst.sections.find((s) => s.sectionKey === upd.key);
      if (section) {
        const prevContent = section.content;
        await this.prisma.client.documentSection.update({
          where: { id: section.id },
          data: { content: upd.content, contentSource: 'AI_GENERATED', lastModifiedBy: 'ai-tweak' },
        });
        await this.logChange(businessId, instanceId, 'AI_TWEAK', 'CHANGE', upd.key, prevContent, upd.content, 'ai-tweak', body.instruction);
      }
    }

    const newVersionNum = inst.currentVersionNum + 1;
    const updatedSections = await this.prisma.client.documentSection.findMany({
      where: { instanceId },
      orderBy: { sortOrder: 'asc' },
    });

    await this.prisma.client.documentVersion.create({
      data: {
        instanceId,
        versionNumber: newVersionNum,
        content: { sections: updatedSections.map((s) => ({ key: s.sectionKey, name: s.sectionName, content: s.content })) },
        sectionSnapshots: updatedSections.map((s) => ({ key: s.sectionKey, name: s.sectionName, content: s.content })),
        status: 'DRAFT',
        createdBy: 'ai-tweak',
        changeNotes: body.instruction,
      },
    });

    await this.prisma.client.documentInstance.update({
      where: { id: instanceId },
      data: { currentVersionNum: newVersionNum },
    });

    return this.getInstance(businessId, instanceId);
  }

  async updateSection(
    businessId: string,
    instanceId: string,
    sectionKey: string,
    body: { content: string; changedBy?: string },
  ) {
    const inst = await this.getInstance(businessId, instanceId);
    const section = inst.sections.find((s) => s.sectionKey === sectionKey);
    if (!section) throw new NotFoundException('Section not found');

    if (section.editableMode === 'RESTRICTED' && section.content !== body.content) {
      await this.prisma.client.reviewTask.create({
        data: {
          businessId,
          instanceId,
          sectionKey,
          reviewType: 'INLINE_EDIT_REVIEW',
          status: 'PENDING',
          notes: 'Restricted section was manually edited — review required.',
        },
      });
    }

    const prevContent = section.content;
    await this.prisma.client.documentSection.update({
      where: { id: section.id },
      data: { content: body.content, contentSource: 'USER_EDITED', lastModifiedBy: body.changedBy || 'user' },
    });

    await this.logChange(businessId, instanceId, 'INLINE_EDIT', 'CHANGE', sectionKey, prevContent, body.content, body.changedBy || 'user');

    return this.getInstance(businessId, instanceId);
  }

  async updateStatus(businessId: string, instanceId: string, status: string) {
    const inst = await this.getInstance(businessId, instanceId);

    if (status === 'APPROVED') {
      const pendingReviews = inst.reviewTasks.filter((r) => r.status === 'PENDING');
      if (pendingReviews.length > 0) {
        throw new BadRequestException(`Cannot approve: ${pendingReviews.length} pending review(s)`);
      }
    }

    await this.prisma.client.documentInstance.update({
      where: { id: instanceId },
      data: { status },
    });

    if (status === 'APPROVED') {
      const currentVersion = inst.versions[0];
      if (currentVersion) {
        await this.prisma.client.documentVersion.update({
          where: { id: currentVersion.id },
          data: { approvalStatus: 'APPROVED', approvedAt: new Date() },
        });
      }
    }

    await this.logChange(businessId, instanceId, 'STATUS_CHANGE', 'CHANGE', null, inst.status, status, 'user');
    return this.getInstance(businessId, instanceId);
  }

  async getDocumentHealth(businessId: string) {
    const instances = await this.prisma.client.documentInstance.findMany({
      where: { businessId },
      include: { documentType: { include: { category: true } } },
    });

    const total = instances.length;
    const current = instances.filter((i) => i.healthStatus === 'CURRENT').length;
    const stale = instances.filter((i) => i.healthStatus === 'STALE').length;
    const impacted = instances.filter((i) => i.healthStatus === 'IMPACTED').length;
    const pendingReview = instances.filter((i) => i.healthStatus === 'PENDING_REVIEW').length;
    const expired = instances.filter((i) => i.healthStatus === 'EXPIRED').length;

    const byCategory = instances.reduce(
      (acc, inst) => {
        const cat = inst.documentType.category.slug;
        if (!acc[cat]) acc[cat] = { total: 0, current: 0, issues: 0, name: inst.documentType.category.name };
        acc[cat].total++;
        if (inst.healthStatus === 'CURRENT') acc[cat].current++;
        else acc[cat].issues++;
        return acc;
      },
      {} as Record<string, { total: number; current: number; issues: number; name: string }>,
    );

    const healthScore = total > 0 ? Math.round((current / total) * 100) : 100;

    return { total, current, stale, impacted, pendingReview, expired, healthScore, byCategory, documents: instances };
  }

  async detectImpact(businessId: string, changedFields: string[]) {
    const rules = await this.prisma.client.impactRule.findMany({
      where: { profileField: { in: changedFields } },
      include: { documentType: true },
    });

    if (rules.length === 0) return { affected: 0, documents: [] };

    const docTypeIds = [...new Set(rules.map((r) => r.documentTypeId))];
    const affected = await this.prisma.client.documentInstance.findMany({
      where: { businessId, documentTypeId: { in: docTypeIds }, status: { not: 'ARCHIVED' } },
      include: { documentType: true },
    });

    for (const doc of affected) {
      await this.prisma.client.documentInstance.update({
        where: { id: doc.id },
        data: { healthStatus: 'IMPACTED', healthReason: `Profile field(s) changed: ${changedFields.join(', ')}` },
      });
    }

    return {
      affected: affected.length,
      documents: affected.map((d) => ({
        id: d.id,
        title: d.title,
        type: d.documentType.name,
        riskTier: d.documentType.riskTier,
      })),
    };
  }

  async getVersionComparison(businessId: string, instanceId: string, v1: number, v2: number) {
    const inst = await this.prisma.client.documentInstance.findFirst({
      where: { id: instanceId, businessId },
    });
    if (!inst) throw new NotFoundException('Document not found');

    const [version1, version2] = await Promise.all([
      this.prisma.client.documentVersion.findFirst({ where: { instanceId, versionNumber: v1 } }),
      this.prisma.client.documentVersion.findFirst({ where: { instanceId, versionNumber: v2 } }),
    ]);

    if (!version1 || !version2) throw new NotFoundException('Version not found');
    return { version1, version2 };
  }

  async resolveReview(businessId: string, reviewId: string, body: { status: string; notes?: string; resolvedBy?: string }) {
    const review = await this.prisma.client.reviewTask.findFirst({
      where: { id: reviewId, businessId },
    });
    if (!review) throw new NotFoundException('Review task not found');

    return this.prisma.client.reviewTask.update({
      where: { id: reviewId },
      data: { status: body.status, notes: body.notes, resolvedBy: body.resolvedBy || 'user', resolvedAt: new Date() },
    });
  }

  async getOrgStandards(businessId: string) {
    return this.prisma.client.orgStandard.findMany({
      where: { businessId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async upsertOrgStandard(businessId: string, body: { id?: string; category: string; rule: string }) {
    if (body.id) {
      return this.prisma.client.orgStandard.update({
        where: { id: body.id },
        data: { category: body.category, rule: body.rule },
      });
    }
    return this.prisma.client.orgStandard.create({
      data: { businessId, category: body.category, rule: body.rule },
    });
  }

  async deleteOrgStandard(businessId: string, standardId: string) {
    return this.prisma.client.orgStandard.update({
      where: { id: standardId },
      data: { isActive: false },
    });
  }

  async deleteInstance(businessId: string, instanceId: string) {
    const inst = await this.prisma.client.documentInstance.findFirst({
      where: { id: instanceId, businessId },
    });
    if (!inst) throw new NotFoundException('Document not found');

    await this.prisma.client.documentInstance.delete({ where: { id: instanceId } });
    return { deleted: true };
  }

  private async getOrCreateProfileVersion(businessId: string) {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException('Business not found');

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
      const changed = Object.keys(snapshot).filter((k) => JSON.stringify(latestSnap[k]) !== JSON.stringify(snapshot[k as keyof typeof snapshot]));
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

  private async checkMissingFields(businessId: string, requiredFields: string[]) {
    if (requiredFields.length === 0) return [];
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    if (!business) return requiredFields;
    return requiredFields.filter((f) => !(business as Record<string, unknown>)[f]);
  }

  private getRiskInstructions(riskTier: string): string {
    switch (riskTier) {
      case 'RED':
        return 'HIGH-RISK DOCUMENT: Use conservative, precise language. Include appropriate disclaimers. Mark sections that need legal/professional review. Never use casual or informal phrasing in legal clauses. Use controlled clause structures where possible.';
      case 'YELLOW':
        return 'MEDIUM-RISK DOCUMENT: Use professional language with clear structure. Include relevant caveats where appropriate. Balance completeness with readability.';
      default:
        return 'LOW-RISK DOCUMENT: Use clear, engaging language appropriate to the brand. Prioritize readability and personality.';
    }
  }

  private async sendDocumentEmail(businessId: string, instance: {
    id: string;
    title: string;
    currentVersionNum: number;
    documentType: { name: string; riskTier: string; category: { name: string } };
    sections: Array<{ sectionName: string; content: string }>;
  }, actorUserId?: string) {
    let user: { email: string | null; name: string | null; firstName: string | null } | null = null;

    if (actorUserId) {
      user = await this.prisma.client.user.findUnique({
        where: { id: actorUserId },
        select: { email: true, name: true, firstName: true },
      });
    }

    if (!user || !user.email) {
      const business = await this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { users: { select: { email: true, name: true, firstName: true }, take: 1 } },
      });
      if (!business || business.users.length === 0) return;
      user = business.users[0];
    }

    if (!user?.email) return;

    const documentUrl = `${process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'https://keyflowos.com'}/app/documents/${instance.id}`;

    await this.emailService.send({
      businessId,
      type: 'document_generated',
      recipientEmail: user.email,
      recipientName: user.name || user.firstName || 'there',
      templateData: {
        documentTitle: instance.title,
        documentTypeName: instance.documentType.name,
        categoryName: instance.documentType.category.name,
        riskTier: instance.documentType.riskTier,
        documentId: instance.id,
        version: instance.currentVersionNum,
        sections: instance.sections.map((s) => ({ name: s.sectionName, content: s.content })),
        documentUrl,
      },
    });

    this.logger.log(`Document email sent for ${instance.title} to ${user.email}`);
  }

  private async logChange(
    businessId: string,
    instanceId: string | null,
    changeType: string,
    auditLevel: string,
    sectionKey: string | null,
    previousValue: string | null,
    newValue: string | null,
    changedBy: string | null,
    reason?: string,
    metadata?: Record<string, unknown>,
  ) {
    await this.prisma.client.documentChangeLog.create({
      data: { businessId, instanceId, changeType, auditLevel, sectionKey, previousValue, newValue, changedBy, reason, metadata: metadata || undefined },
    });
  }
}
