import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { BusinessContextService } from '../identity/business-context.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import { getDocumentBlueprint, getCategoryDirective, getSensitivityLayers } from './document-blueprints';

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
    const blueprint = getDocumentBlueprint(body.documentTypeSlug);
    const categoryDirective = getCategoryDirective(docType.category.slug);
    const sensitivityLayers = getSensitivityLayers({
      brandSensitive: (docType as Record<string, unknown>).brandSensitive as boolean || false,
      financialSensitive: (docType as Record<string, unknown>).financialSensitive as boolean || false,
      legalSensitive: (docType as Record<string, unknown>).legalSensitive as boolean || false,
      jurisdictionSensitive: (docType as Record<string, unknown>).jurisdictionSensitive as boolean || false,
    });

    const systemPromptParts = [
      `You are a senior business document architect operating at the highest professional standard.`,
      `You produce comprehensive, authoritative documents for Caribbean and international small-to-medium businesses.`,
      ``,
      `QUALITY STANDARDS:`,
      `- COMPREHENSIVE: Every section must be substantive and thorough — no placeholder text, no "insert here" gaps, no single-sentence sections. Each section should contain real, actionable content specific to this business.`,
      `- APPLICABLE: All content must be immediately usable by the business without further drafting. Use the business's actual details, industry context, and operational reality — not generic templates.`,
      `- MODERN: Reflect current best practices, digital-first operations, remote/hybrid work realities, modern compliance standards, and contemporary business language. Reference current legislation and frameworks.`,
      `- RELIABLE: Every factual claim must be defensible, every legal clause must be structurally sound, every financial figure must be internally consistent. The document should withstand scrutiny from regulators, auditors, clients, or counterparties.`,
      ``,
      riskInstructions,
    ];

    if (categoryDirective) {
      systemPromptParts.push('', `CATEGORY STANDARDS:`, categoryDirective);
    }

    if (sensitivityLayers.length > 0) {
      systemPromptParts.push('', ...sensitivityLayers);
    }

    if (blueprint?.qualityDirective) {
      systemPromptParts.push('', `DOCUMENT-SPECIFIC DIRECTIVE:`, blueprint.qualityDirective);
    }
    if (blueprint?.legalFramework) {
      systemPromptParts.push('', `LEGAL FRAMEWORK:`, blueprint.legalFramework);
    }
    if (blueprint?.financialStandards) {
      systemPromptParts.push('', `FINANCIAL STANDARDS:`, blueprint.financialStandards);
    }
    if (blueprint?.modernPractices) {
      systemPromptParts.push('', `MODERN PRACTICES:`, blueprint.modernPractices);
    }

    systemPromptParts.push(
      '',
      `Tone: ${toneStr}`,
      '',
      `STRUCTURAL RULES:`,
      `- Each section must contain at least 3-5 paragraphs or equivalent substantive content (lists, clauses, tables).`,
      `- Use numbered clauses (1.1, 1.2) for legal/policy documents, narrative paragraphs for brand/messaging documents, and step-by-step instructions for operational documents.`,
      `- Never use placeholder brackets like [Company Name] — always substitute the actual business details from the context provided.`,
      `- For legal documents: use defined terms consistently (capitalize defined terms), include recitals, and use "shall" for obligations, "may" for permissions.`,
      `- For financial documents: use precise numeric formatting, include currency codes, and show all calculations.`,
      `- For brand documents: write in the brand's authentic voice, use specific examples from the business, and avoid corporate jargon.`,
      '',
      `Output format: Return a JSON object with this structure:`,
      `{ "title": "document title", "sections": [ { "key": "section_key", "name": "Section Name", "content": "section content text", "riskScore": "GREEN|YELLOW|RED", "editableMode": "FREE|GUIDED|RESTRICTED" } ] }`,
      `Return ONLY valid JSON, no markdown formatting.`,
    );

    const systemPrompt = systemPromptParts.join('\n');

    const userPromptParts = [
      `BUSINESS CONTEXT:\n${contextBlock}`,
      '',
      `DOCUMENT TYPE: ${docType.name}`,
      `CATEGORY: ${docType.category.name} (${docType.category.tier})`,
      `RISK TIER: ${docType.riskTier}`,
      docType.description ? `PURPOSE: ${docType.description}` : '',
    ];

    if (blueprint?.sections) {
      userPromptParts.push('', `REQUIRED SECTIONS (generate ALL of these in this order):`);
      for (const sec of blueprint.sections) {
        const risk = sec.riskScore ? ` [Risk: ${sec.riskScore}]` : '';
        const mode = sec.editableMode ? ` [EditMode: ${sec.editableMode}]` : '';
        userPromptParts.push(`- ${sec.key} | "${sec.name}"${risk}${mode}: ${sec.guidance}`);
      }
    }

    if (body.contextInputs) {
      userPromptParts.push('', `ADDITIONAL CONTEXT:\n${JSON.stringify(body.contextInputs, null, 2)}`);
    }
    if (missingFields.length > 0) {
      userPromptParts.push(`NOTE: Missing profile fields (infer reasonable, industry-appropriate defaults): ${missingFields.join(', ')}`);
    }

    userPromptParts.push(
      '',
      blueprint
        ? `Generate a complete, authoritative ${docType.name} document following the section structure above. Each section must be substantive, specific to this business, and meet the quality standards specified. Do not skip any section.`
        : `Generate a complete, well-structured ${docType.name} document with comprehensive sections appropriate for this document type. Each section should be substantive (minimum 3 paragraphs or equivalent) and specific to this business. Consider what a professional consultant or attorney would include in a best-practice version of this document.`,
    );

    const userPrompt = userPromptParts.filter(Boolean).join('\n');

    const tokenBudget = blueprint ? 6000 : (docType.riskTier === 'RED' ? 5000 : 4500);

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'document-generate',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: tokenBudget,
      temperature: 0.4,
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
          hasBlueprint: !!blueprint,
          blueprintSections: blueprint?.sections?.length || 0,
          qualityLayers: [
            ...(categoryDirective ? ['category-directive'] : []),
            ...(blueprint?.qualityDirective ? ['document-blueprint'] : []),
            ...(blueprint?.legalFramework ? ['legal-framework'] : []),
            ...(blueprint?.financialStandards ? ['financial-standards'] : []),
            ...(blueprint?.modernPractices ? ['modern-practices'] : []),
            ...((docType as Record<string, unknown>).legalSensitive ? ['legal-sensitivity'] : []),
            ...((docType as Record<string, unknown>).financialSensitive ? ['financial-sensitivity'] : []),
            ...((docType as Record<string, unknown>).brandSensitive ? ['brand-sensitivity'] : []),
            ...((docType as Record<string, unknown>).jurisdictionSensitive ? ['jurisdiction-sensitivity'] : []),
          ],
          tokenBudget,
          temperature: 0.4,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
          estimatedCost: result.usage.estimatedCost,
          creditsUsed: result.usage.creditsUsed,
          sectionsGenerated: (parsed.sections || []).length,
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
      'You are a senior document editor operating at the highest professional standard for Caribbean and international businesses.',
      'You adapt business documents based on user instructions while maintaining structure, compliance, and quality.',
      '',
      'EDITING STANDARDS:',
      '- Maintain the same comprehensive quality as the original — never reduce section depth or remove substantive content.',
      '- Preserve all defined terms, clause numbering, and cross-references when making changes.',
      '- Ensure edits are internally consistent with unchanged sections.',
      '- Apply the user\'s instruction precisely but also improve adjacent content if the change creates inconsistencies.',
      '',
      `Document risk tier: ${inst.documentType.riskTier}`,
      inst.documentType.riskTier === 'RED'
        ? 'HIGH-RISK: Translate the instruction into structured clause changes. Do not freestyle legal language. Maintain conservative, precise phrasing. If the instruction would weaken legal protections, note this in the content.'
        : inst.documentType.riskTier === 'YELLOW'
          ? 'MEDIUM-RISK: Apply changes with professional precision. Maintain any caveats or conditions that protect the business.'
          : 'STANDARD: Apply changes naturally while maintaining brand voice and readability.',
      '',
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
        return [
          'HIGH-RISK DOCUMENT — ELEVATED DRAFTING STANDARDS:',
          '- Use conservative, precise legal/regulatory language throughout. Every word carries weight.',
          '- Structure with numbered clauses and sub-clauses (1.1, 1.1.1) for legal enforceability and cross-referencing.',
          '- Define all key terms upon first use or in a dedicated Definitions section. Capitalize defined terms consistently.',
          '- Include appropriate disclaimers, limitation of liability, and professional review recommendations.',
          '- Mark sections containing legal conclusions, liability allocation, or financial commitments with riskScore: "RED" and editableMode: "RESTRICTED".',
          '- Never use casual language, colloquialisms, or ambiguous phrasing in operative clauses.',
          '- Include a final note: "This document was generated using AI-assisted drafting and should be reviewed by a qualified professional before execution or reliance."',
          '- Use "shall" for binding obligations, "may" for discretionary permissions, "will" for statements of fact or intent.',
          '- Address edge cases and exception handling — what happens when things go wrong.',
        ].join('\n');
      case 'YELLOW':
        return [
          'MEDIUM-RISK DOCUMENT — PROFESSIONAL DRAFTING STANDARDS:',
          '- Use professional, structured language that balances precision with accessibility.',
          '- Include relevant caveats, conditions, and exceptions where they strengthen the document.',
          '- Structure with clear headings and logical flow. Use numbered lists for procedures and policies.',
          '- Address foreseeable scenarios and provide clear guidance for each.',
          '- Mark financially or legally sensitive sections with riskScore: "YELLOW".',
          '- Include review dates and version control where applicable.',
        ].join('\n');
      default:
        return [
          'STANDARD DOCUMENT — PROFESSIONAL QUALITY:',
          '- Use clear, engaging language appropriate to the business\'s brand and audience.',
          '- Prioritize readability, practical utility, and brand personality.',
          '- Structure content for easy scanning: use headings, bullet points, and concise paragraphs.',
          '- Personalize extensively using business context — this should feel custom-crafted, not templated.',
          '- Include actionable recommendations and concrete examples where applicable.',
        ].join('\n');
    }
  }

  async sendDocumentEmailPublic(businessId: string, instanceId: string, actorUserId?: string) {
    const instance = await this.getInstance(businessId, instanceId);
    const result = await this.sendDocumentEmail(businessId, instance, actorUserId);
    if (!result) {
      return { sent: false, reason: 'No recipient email address found' };
    }
    return { sent: true };
  }

  private async sendDocumentEmail(businessId: string, instance: {
    id: string;
    title: string;
    currentVersionNum: number;
    documentType: { name: string; riskTier: string; category: { name: string } };
    sections: Array<{ sectionName: string; content: string }>;
  }, actorUserId?: string): Promise<boolean> {
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
        include: { members: { include: { user: { select: { email: true, name: true, firstName: true } } }, take: 1 } },
      });
      if (!business || business.members.length === 0) return false;
      user = business.members[0].user;
    }

    if (!user?.email) return false;

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
    return true;
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
