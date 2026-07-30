import { Injectable, Inject, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { CatalogService } from '../catalog/catalog.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { DemoDataSeederService } from './demo-data-seeder.service';
import type {
  BlueprintData,
  BlueprintRegistrationProfile,
  DnaSectionKey,
} from '../blueprint/blueprint.types';
import { matchIndustryTemplate, getTemplateById, IndustryTemplate, INDUSTRY_TEMPLATES } from './industry-templates';

function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return Boolean(value);
}

function isRegistrationStepActive(status: unknown): boolean {
  if (typeof status !== 'string') return false;
  const value = status.trim().toUpperCase();
  return value !== 'NOT_STARTED' && value !== 'UNKNOWN' && value !== 'IDEA_ONLY' && value !== '';
}

function isRegistrationStepCompleteForReadiness(status: unknown): boolean {
  if (typeof status !== 'string') return false;
  const value = status.trim().toUpperCase();
  const incomplete = ['NOT_STARTED', 'UNKNOWN', 'IDEA_ONLY', 'PENDING', 'IN_PROGRESS', ''];
  return !incomplete.includes(value);
}

export interface SetupStatus {
  products: boolean;
  businessHours: boolean;
  payments: boolean;
  storefront: boolean;
  contacts: boolean;
  profile: boolean;
  legalProfile: boolean;
  registrationPlan: boolean;
  financeModel: boolean;
  marketStrategy: boolean;
  operationsPlan: boolean;
  complianceChecklist: boolean;
  completedCount: number;
  totalSteps: number;
  percentage: number;
}

export interface ConciergeMessage {
  role: 'assistant' | 'user';
  content: string;
  quickReplies?: string[];
  actions?: ConciergeAction[];
  setupStatus?: SetupStatus;
  extracted?: Record<string, string>;
}

export interface ConciergeAction {
  id: string;
  label: string;
  type: 'confirm' | 'customize' | 'skip' | 'navigate';
  href?: string;
  data?: Record<string, unknown>;
}

export interface NudgeItem {
  id: string;
  type: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  snoozable: boolean;
}

interface BusinessContext {
  name: string | null;
  businessIntent: string | null;
  archetype: string | null;
  industry: string | null;
  country: string | null;
  currency: string | null;
  metaData: Prisma.JsonValue;
}

export interface AutoConfigureResult {
  templateId: string;
  templateLabel: string;
  productsCreated?: number;
  productsSkipped?: boolean;
  businessHoursSet?: boolean;
  paymentMethodsSet?: boolean;
  storefrontEnabled?: boolean;
  storefrontSlug?: string;
}

type BusinessMetaData = Record<string, Prisma.JsonValue | undefined>;

function parseMetaData(raw: Prisma.JsonValue | null | undefined): BusinessMetaData {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as BusinessMetaData;
  }
  return {};
}

type PrismaTx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

@Injectable()
export class OnboardingConciergeService {
  private readonly logger = new Logger(OnboardingConciergeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(DemoDataSeederService) private readonly demoSeeder: DemoDataSeederService,
  ) {}

  async getSetupStatus(businessId: string): Promise<SetupStatus> {
    const [business, productCount, contactCount, blueprint] = await Promise.all([
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: {
          name: true,
          businessHours: true,
          storeEnabled: true,
          onboardingComplete: true,
          metaData: true,
          phone: true,
          email: true,
          logoUrl: true,
          slug: true,
        },
      }),
      this.prisma.client.product.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null } }),
      this.blueprint.getBlueprint(businessId).catch((err: unknown) => {
        this.logger.debug(`Failed to load blueprint for setup status: ${(err as Error).message}`);
        return null;
      }),
    ]);

    const meta = parseMetaData(business?.metaData);

    const profile = !!(business?.name && business.name.length > 0 && (business.phone || business.email));
    const products = productCount > 0;
    const businessHours = !!business?.businessHours;
    const payments = !!(meta.paymentMethodsConfigured);
    const storefront = !!(business?.slug && business?.storeEnabled);
    const contacts = contactCount > 0;

    const genesisStatus = blueprint
      ? this.deriveGenesisSetupStatus(blueprint)
      : {
          legalProfile: false,
          registrationPlan: false,
          financeModel: false,
          marketStrategy: false,
          operationsPlan: false,
          complianceChecklist: false,
        };

    const steps = [
      profile,
      products,
      businessHours,
      payments,
      storefront,
      contacts,
      genesisStatus.legalProfile,
      genesisStatus.registrationPlan,
      genesisStatus.financeModel,
      genesisStatus.marketStrategy,
      genesisStatus.operationsPlan,
      genesisStatus.complianceChecklist,
    ];
    const completedCount = steps.filter(Boolean).length;

    return {
      products,
      businessHours,
      payments,
      storefront,
      contacts,
      profile,
      legalProfile: genesisStatus.legalProfile,
      registrationPlan: genesisStatus.registrationPlan,
      financeModel: genesisStatus.financeModel,
      marketStrategy: genesisStatus.marketStrategy,
      operationsPlan: genesisStatus.operationsPlan,
      complianceChecklist: genesisStatus.complianceChecklist,
      completedCount,
      totalSteps: steps.length,
      percentage: Math.round((completedCount / steps.length) * 100),
    };
  }

  private deriveGenesisSetupStatus(blueprint: BlueprintData) {
    const legalProfile = blueprint.legalProfile || {};
    const registrationProfile = blueprint.registrationProfile || {};
    const projectionProfile = blueprint.projectionProfile || {};
    const customerModel = blueprint.customerModel || {};
    const offerArchitecture = blueprint.offerArchitecture || {};
    const marketingSystem = blueprint.marketingSystem || {};
    const operationsSystem = blueprint.operationsSystem || {};
    const workflowModel = blueprint.workflowModel || {};
    const complianceProfile = blueprint.complianceProfile || {};

    const legalProfileDone = !!(
      legalProfile.recommendedEntityType &&
      legalProfile.recommendedEntityType !== 'UNKNOWN'
    );

    const registrationStatusFields: (keyof BlueprintRegistrationProfile)[] = [
      'companiesRegistryStatus',
      'birStatus',
      'nisEmployerStatus',
      'vatStatus',
      'businessBankStatus',
    ];
    const registrationPlanDone = registrationStatusFields.some((field) =>
      isRegistrationStepActive(registrationProfile[field]),
    );

    const financeModelDone = !!(
      typeof projectionProfile.monthlyFixedCosts === 'number' &&
      typeof projectionProfile.breakEvenRevenue === 'number'
    );

    const marketStrategyDone = !!(
      customerModel.idealCustomer &&
      customerModel.idealCustomer.trim().length > 0 &&
      (isPopulated(offerArchitecture.coreOffer) || (marketingSystem.channels && marketingSystem.channels.length > 0))
    );

    const operationsPlanDone = !!(
      (operationsSystem.coreWorkflows && operationsSystem.coreWorkflows.length > 0) ||
      workflowModel.primaryWorkflow
    );

    const items = complianceProfile.complianceItems || [];
    const complianceChecklistDone = !!(
      items.length > 0 &&
      items.some((item) => item.status === 'DONE' || item.status === 'NOT_APPLICABLE')
    );

    return {
      legalProfile: legalProfileDone,
      registrationPlan: registrationPlanDone,
      financeModel: financeModelDone,
      marketStrategy: marketStrategyDone,
      operationsPlan: operationsPlanDone,
      complianceChecklist: complianceChecklistDone,
    };
  }

  private async generateUniqueSlug(
    tx: Parameters<Parameters<typeof this.prisma.client.$transaction>[0]>[0],
    name: string,
  ): Promise<string> {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'business';

    let slug = base;
    let attempt = 0;
    while (await tx.business.findFirst({ where: { slug, deletedAt: null } })) {
      attempt++;
      const suffix = Math.random().toString(36).slice(2, 6);
      slug = `${base}-${suffix}`;
      if (attempt > 20) {
        const timestampSuffix = Date.now().toString(36);
        slug = `${base}-${timestampSuffix}`;
        break;
      }
    }
    return slug;
  }

  private calculateDomainReadiness(blueprint: BlueprintData) {
    const legal = blueprint.legalProfile || {};
    const registration = blueprint.registrationProfile || {};
    const projection = blueprint.projectionProfile || {};
    const customer = blueprint.customerModel || {};
    const offer = blueprint.offerArchitecture || {};
    const marketing = blueprint.marketingSystem || {};
    const ops = blueprint.operationsSystem || {};
    const workflow = blueprint.workflowModel || {};
    const compliance = blueprint.complianceProfile || {};

    let legalScore = 0;
    if (legal.recommendedEntityType && legal.recommendedEntityType !== 'UNKNOWN') {
      legalScore += 40;
    }
    if (legal.disclaimerAcceptedAt) {
      legalScore += 30;
    }
    const registrationFields: (keyof BlueprintRegistrationProfile)[] = [
      'businessNameStatus',
      'companiesRegistryStatus',
      'birStatus',
      'nisEmployerStatus',
      'vatStatus',
      'businessBankStatus',
    ];
    const completedRegistration = registrationFields.filter((field) =>
      isRegistrationStepCompleteForReadiness(registration[field]),
    ).length;
    legalScore += Math.round((completedRegistration / 6) * 30);

    let financeScore = 0;
    if (typeof projection.startupCapital === 'number' && typeof projection.monthlyFixedCosts === 'number') {
      financeScore += 40;
    }
    if (typeof projection.breakEvenRevenue === 'number') {
      financeScore += 30;
    }
    if (typeof projection.runwayMonths === 'number') {
      financeScore += 30;
    }

    let marketScore = 0;
    if (customer.idealCustomer && customer.idealCustomer.trim().length > 0) {
      marketScore += 40;
    }
    if (offer.coreOffer && Object.keys(offer.coreOffer).length > 0) {
      marketScore += 30;
    }
    if (marketing.channels && marketing.channels.length > 0) {
      marketScore += 30;
    }

    let operationsScore = 0;
    if (ops.coreWorkflows && ops.coreWorkflows.length > 0) {
      operationsScore += 50;
    }
    if (workflow.primaryWorkflow && workflow.primaryWorkflow.trim().length > 0) {
      operationsScore += 30;
    }
    if (typeof blueprint.aiPreferences?.autonomyLevel === 'number') {
      operationsScore += 20;
    }

    const items = compliance.complianceItems || [];
    const complianceScore = items.length > 0
      ? Math.round(
          (items.filter((item) => item.status === 'DONE' || item.status === 'NOT_APPLICABLE').length / items.length) *
            100,
        )
      : 0;

    return {
      legal: Math.min(100, legalScore),
      finance: Math.min(100, financeScore),
      market: Math.min(100, marketScore),
      operations: Math.min(100, operationsScore),
      compliance: Math.min(100, complianceScore),
    };
  }

  getAvailableTemplates() {
    return INDUSTRY_TEMPLATES.map(t => ({
      id: t.id,
      label: t.label,
      keywords: t.keywords,
    }));
  }

  getTemplatePreview(templateId: string) {
    const template = getTemplateById(templateId);
    if (!template) throw new NotFoundException(`Template "${templateId}" not found`);
    return {
      id: template.id,
      label: template.label,
      products: template.defaultProducts,
      businessHours: template.businessHours,
      paymentRecommendations: template.paymentRecommendations,
      emailTemplate: template.emailTemplate,
    };
  }

  async autoConfigureFromTemplate(
    businessId: string,
    templateId: string,
    options: {
      createProducts?: boolean;
      setBusinessHours?: boolean;
      setPaymentMethods?: boolean;
      configureStorefront?: boolean;
      customBusinessName?: string;
    } = {},
  ): Promise<AutoConfigureResult> {
    const template = getTemplateById(templateId);
    if (!template) {
      throw new NotFoundException(`Template "${templateId}" not found`);
    }

    const {
      createProducts = true,
      setBusinessHours = true,
      setPaymentMethods = true,
      configureStorefront = true,
      customBusinessName,
    } = options;

    const normalizedBusinessName = customBusinessName?.trim();

    const results: Partial<AutoConfigureResult> = {};

    // Use the business currency for seeded products so templates work for any region.
    const businessCurrency = await this.prisma.client.business
      .findUnique({ where: { id: businessId }, select: { currency: true } })
      .then((b) => b?.currency || 'TTD');

    await this.prisma.client.$transaction(async (tx) => {
      if (createProducts) {
        const existingProducts = await tx.product.count({
          where: { businessId, deletedAt: null },
        });

        if (existingProducts === 0) {
          let createdCount = 0;
          for (const p of template.defaultProducts) {
            await this.catalog.createProduct({
              businessId,
              name: p.name,
              price: p.price,
              currency: businessCurrency,
              category: p.category,
              duration: p.duration ?? null,
              description: p.description ?? null,
              isActive: true,
            }, tx);
            createdCount++;
          }
          results.productsCreated = createdCount;
        } else {
          results.productsCreated = 0;
          results.productsSkipped = true;
        }
      }

      if (setBusinessHours) {
        await tx.business.update({
          where: { id: businessId },
          data: { businessHours: template.businessHours as Prisma.InputJsonValue },
        });
        results.businessHoursSet = true;
      }

      const business = await tx.business.findUnique({
        where: { id: businessId },
        select: { name: true, metaData: true, slug: true, storeEnabled: true },
      });
      const meta = parseMetaData(business?.metaData);

      const metaUpdates: BusinessMetaData = { ...meta };

      if (setPaymentMethods) {
        metaUpdates.paymentMethodsConfigured = true;
        metaUpdates.paymentRecommendations = template.paymentRecommendations as unknown as Prisma.JsonValue;
        results.paymentMethodsSet = true;
      }

      metaUpdates.conciergeTemplateId = templateId;
      metaUpdates.conciergeSetupAt = new Date().toISOString();

      const businessUpdate: Prisma.BusinessUpdateInput = {
        metaData: metaUpdates as Prisma.InputJsonValue,
      };

      if (normalizedBusinessName) {
        businessUpdate.name = normalizedBusinessName;
      }

      if (configureStorefront && !business?.storeEnabled) {
        businessUpdate.storeEnabled = true;
        results.storefrontEnabled = true;
      }

      if (configureStorefront && !business?.slug) {
        const slugBase = normalizedBusinessName || business?.name || 'business';
        const slug = await this.generateUniqueSlug(tx, slugBase);
        businessUpdate.slug = slug;
        results.storefrontSlug = slug;
      }

      await tx.business.update({
        where: { id: businessId },
        data: businessUpdate,
      });

      await this.awardSetupMilestone(businessId, 'conciergeSetupComplete', tx);

      // Mirror the auto-configured choices into the BusinessBlueprint so KEY
      // and downstream surfaces immediately reflect the new operating DNA.
      try {
        await this.blueprint.inferFromOnboarding(
          businessId,
          {
            archetype: template.id,
            industry: template.label,
            channels: ['STOREFRONT'],
          },
          tx,
        );
      } catch (err: any) {
        this.logger.debug(`Blueprint inference failed: ${(err as Error).message}`);
      }
    });

    return {
      templateId: template.id,
      templateLabel: template.label,
      ...results,
    };
  }

  async detectBusinessType(
    businessId: string,
    businessDescription: string,
  ): Promise<{
    template: { id: string; label: string };
    confidence: 'high' | 'medium' | 'low';
  }> {
    const template = matchIndustryTemplate(businessDescription);
    const lower = businessDescription.toLowerCase();
    const matchCount = template.keywords.filter(kw => lower.includes(kw)).length;

    return {
      template: { id: template.id, label: template.label },
      confidence: matchCount >= 2 ? 'high' : matchCount === 1 ? 'medium' : 'low',
    };
  }

  private sanitizeHistory(
    history: Array<{ role: string; content: string }>,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const ALLOWED_ROLES = new Set(['user', 'assistant']);
    const MAX_HISTORY_LENGTH = 20;
    const MAX_CONTENT_LENGTH = 2000;

    return history
      .filter(m => ALLOWED_ROLES.has(m.role) && typeof m.content === 'string' && m.content.trim().length > 0)
      .slice(-MAX_HISTORY_LENGTH)
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content.slice(0, MAX_CONTENT_LENGTH),
      }));
  }

  async generateConciergeResponse(
    businessId: string,
    userMessage: string,
    conversationHistory: Array<{ role: string; content: string }>,
  ): Promise<ConciergeMessage> {
    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
      throw new BadRequestException('Message is required');
    }

    const sanitizedHistory = this.sanitizeHistory(conversationHistory);

    const [setupStatus, business] = await Promise.all([
      this.getSetupStatus(businessId),
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: {
          name: true,
          businessIntent: true,
          archetype: true,
          industry: true,
          country: true,
          currency: true,
          metaData: true,
        },
      }),
    ]);

    const meta = parseMetaData(business?.metaData);
    const templateId = meta.conciergeTemplateId as string | undefined;
    const detection = await this.detectBusinessType(
      businessId,
      business?.businessIntent || userMessage,
    );

    const systemPrompt = this.buildSystemPrompt(business, setupStatus, detection, templateId);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...sanitizedHistory,
      { role: 'user', content: userMessage.slice(0, 2000) },
    ];

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'onboarding_concierge',
        messages,
        maxTokens: 600,
        temperature: 0.7,
        outputCategory: 'general',
      });

      const parsed = this.parseAiResponse(result.content, setupStatus);
      // Persist extracted intake answers synchronously so nothing is lost.
      try {
        await this.persistIntakeAnswers(businessId, userMessage, parsed.extracted || {}, detection);
      } catch (err) {
        this.logger.warn(`Intake persistence failed: ${(err as Error).message}`);
      }
      return parsed;
    } catch (error: any) {
      this.logger.error(`Concierge AI error: ${(error as Error).message}`);
      return this.getFallbackResponse(setupStatus);
    }
  }

  private buildSystemPrompt(
    business: BusinessContext | null,
    setupStatus: SetupStatus,
    detection: { template: { id: string; label: string }; confidence: string },
    templateId?: string,
  ): string {
    const incompleteSteps: string[] = [];
    if (!setupStatus.profile) incompleteSteps.push('business profile (name, contact info)');
    if (!setupStatus.products) incompleteSteps.push('products/services catalog');
    if (!setupStatus.businessHours) incompleteSteps.push('business hours');
    if (!setupStatus.payments) incompleteSteps.push('payment methods');
    if (!setupStatus.storefront) incompleteSteps.push('online storefront');
    if (!setupStatus.contacts) incompleteSteps.push('customer contacts');
    if (!setupStatus.legalProfile) incompleteSteps.push('legal profile and entity type');
    if (!setupStatus.registrationPlan) incompleteSteps.push('business registration plan');
    if (!setupStatus.financeModel) incompleteSteps.push('financial projections');
    if (!setupStatus.marketStrategy) incompleteSteps.push('market strategy');
    if (!setupStatus.operationsPlan) incompleteSteps.push('operations plan');
    if (!setupStatus.complianceChecklist) incompleteSteps.push('compliance checklist');

    const country = business?.country || 'Trinidad and Tobago';
    const currency = business?.currency || 'TTD';
    const region = country.toLowerCase().includes('trinidad') || country.toLowerCase().includes('tobago')
      ? 'Caribbean'
      : country;

    return `You are the KeyFlowOS Onboarding Concierge — a friendly, knowledgeable business setup assistant for entrepreneurs in ${country}.

CONTEXT:
- Business: ${business?.name || 'New Business'}
- Industry: ${business?.industry || detection.template.label}
- Business Type: ${detection.template.label} (${detection.confidence} confidence)
- Location: ${country}
- Currency: ${currency}
- Template: ${templateId || detection.template.id}
- Setup Progress: ${setupStatus.completedCount}/${setupStatus.totalSteps} steps complete (${setupStatus.percentage}%)
- Incomplete Steps: ${incompleteSteps.length > 0 ? incompleteSteps.join(', ') : 'ALL COMPLETE!'}

COMPLETED STEPS:
- Profile: ${setupStatus.profile ? 'Done' : 'Not done'}
- Products: ${setupStatus.products ? 'Done' : 'Not done'}
- Business Hours: ${setupStatus.businessHours ? 'Done' : 'Not done'}
- Payments: ${setupStatus.payments ? 'Done' : 'Not done'}
- Storefront: ${setupStatus.storefront ? 'Done' : 'Not done'}
- Contacts: ${setupStatus.contacts ? 'Done' : 'Not done'}
- Legal Profile: ${setupStatus.legalProfile ? 'Done' : 'Not done'}
- Registration Plan: ${setupStatus.registrationPlan ? 'Done' : 'Not done'}
- Finance Model: ${setupStatus.financeModel ? 'Done' : 'Not done'}
- Market Strategy: ${setupStatus.marketStrategy ? 'Done' : 'Not done'}
- Operations Plan: ${setupStatus.operationsPlan ? 'Done' : 'Not done'}
- Compliance Checklist: ${setupStatus.complianceChecklist ? 'Done' : 'Not done'}

GUIDELINES:
1. Be warm, encouraging, and conversational — like a helpful friend who knows ${region} business.
2. Use ${currency} for all pricing references.
3. Guide the user through setup one step at a time, focusing on the most impactful incomplete step first.
4. When suggesting products/services, use realistic ${currency} pricing for the ${region} market.
5. Explain what you can set up automatically and let the user confirm or customize each section individually.
6. Keep responses concise — 2-4 sentences max per response.
7. When all steps are complete, congratulate them and suggest next actions.
8. Always end with a question or clear next step.
9. When presenting auto-configured sections, offer explicit accept/customize options for each: products, hours, payments, storefront.

RESPONSE FORMAT:
Reply with your message text. If you want to suggest quick reply options, add them on a new line starting with "QUICK_REPLIES:" followed by comma-separated options.
If you want to suggest an action, add on a new line "ACTION:" followed by the action type and label, separated by pipe (|).
For per-section actions, use "ACTION:confirm|Accept Products,ACTION:customize|Customize Products" etc.
If the user reveals facts about their business, include EXTRACTED lines at the end in the form "EXTRACTED: key=value". Put one fact per line. Useful keys: businessName, businessIntent, industry, archetype, country, revenueModel, teamSize.
Example:
Great! I can set up your salon with popular services and ${currency} pricing. Want me to go ahead?
QUICK_REPLIES:Yes, set it up!,Let me customize,Tell me more
ACTION:confirm|Set Up Salon Defaults
EXTRACTED: industry=Beauty & Personal Care
EXTRACTED: archetype=service_provider`;
  }

  private parseAiResponse(content: string, setupStatus: SetupStatus): ConciergeMessage {
    const lines = content.split('\n');
    let messageText = '';
    const quickReplies: string[] = [];
    const actions: ConciergeAction[] = [];
    const extracted: Record<string, string> = {};

    const VALID_ACTION_TYPES = new Set<ConciergeAction['type']>(['confirm', 'customize', 'skip', 'navigate']);

    for (const line of lines) {
      if (line.startsWith('QUICK_REPLIES:')) {
        const replies = line.replace('QUICK_REPLIES:', '').trim().split(',').map(r => r.trim()).filter(Boolean);
        quickReplies.push(...replies);
      } else if (line.startsWith('ACTION:')) {
        const parts = line.replace('ACTION:', '').trim().split('|');
        if (parts.length >= 2) {
          const actionType = parts[0].trim() as ConciergeAction['type'];
          if (VALID_ACTION_TYPES.has(actionType)) {
            actions.push({
              id: `action_${Date.now()}_${actions.length}`,
              label: parts[1].trim(),
              type: actionType,
            });
          }
        }
      } else if (line.startsWith('EXTRACTED:')) {
        const kv = line.replace('EXTRACTED:', '').trim();
        const eq = kv.indexOf('=');
        if (eq > 0) {
          extracted[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
        }
      } else {
        messageText += (messageText ? '\n' : '') + line;
      }
    }

    if (quickReplies.length === 0) {
      if (!setupStatus.products) {
        quickReplies.push('Set up my products', 'Let me customize', 'Skip for now');
      } else if (!setupStatus.businessHours) {
        quickReplies.push('Set my hours', 'Customize hours', 'Skip for now');
      } else if (!setupStatus.storefront) {
        quickReplies.push('Enable storefront', 'Skip for now');
      } else if (!setupStatus.payments) {
        quickReplies.push('Configure payments', 'Skip for now');
      } else if (!setupStatus.legalProfile || !setupStatus.registrationPlan) {
        quickReplies.push('Set up legal profile', 'Skip for now');
      } else if (!setupStatus.financeModel) {
        quickReplies.push('Build financial model', 'Skip for now');
      }
    }

    return {
      role: 'assistant',
      content: messageText.trim(),
      quickReplies: quickReplies.length > 0 ? quickReplies : undefined,
      actions: actions.length > 0 ? actions : undefined,
      setupStatus,
      extracted: Object.keys(extracted).length > 0 ? extracted : undefined,
    };
  }

  private async persistIntakeAnswers(
    businessId: string,
    userMessage: string,
    extracted: Record<string, string>,
    detection?: { template: { id: string; label: string } },
  ): Promise<void> {
    const answers: Record<string, unknown> = {
      businessIntent: extracted.businessIntent || userMessage,
    };
    if (extracted.businessName) answers.businessName = extracted.businessName;
    if (extracted.industry) answers.industry = extracted.industry;
    if (extracted.archetype) answers.archetype = extracted.archetype;
    if (extracted.country) answers.country = extracted.country;
    if (extracted.revenueModel) answers.revenueModel = extracted.revenueModel;
    if (extracted.teamSize) answers.teamSize = extracted.teamSize;

    if (!answers.industry && detection?.template.label) {
      answers.industry = detection.template.label;
    }
    if (!answers.archetype && detection?.template.id) {
      answers.archetype = detection.template.id;
    }

    const businessUpdate: Prisma.BusinessUpdateInput = {};
    if (typeof answers.businessIntent === 'string') businessUpdate.businessIntent = answers.businessIntent;
    if (typeof answers.industry === 'string') businessUpdate.industry = answers.industry;
    if (typeof answers.archetype === 'string') businessUpdate.archetype = answers.archetype;
    if (typeof answers.country === 'string') businessUpdate.country = answers.country;

    await this.prisma.client.$transaction(async (tx) => {
      if (Object.keys(businessUpdate).length > 0) {
        await tx.business.update({
          where: { id: businessId },
          data: businessUpdate,
        });
      }

      await this.blueprint.inferFromOnboarding(businessId, answers, tx);
    });
  }

  private getFallbackResponse(setupStatus: SetupStatus): ConciergeMessage {
    const incompleteSteps: string[] = [];
    if (!setupStatus.profile) incompleteSteps.push('business profile');
    if (!setupStatus.products) incompleteSteps.push('products');
    if (!setupStatus.businessHours) incompleteSteps.push('business hours');
    if (!setupStatus.payments) incompleteSteps.push('payment methods');
    if (!setupStatus.storefront) incompleteSteps.push('storefront');
    if (!setupStatus.contacts) incompleteSteps.push('contacts');
    if (!setupStatus.legalProfile) incompleteSteps.push('legal profile');
    if (!setupStatus.registrationPlan) incompleteSteps.push('registration plan');
    if (!setupStatus.financeModel) incompleteSteps.push('finance model');
    if (!setupStatus.marketStrategy) incompleteSteps.push('market strategy');
    if (!setupStatus.operationsPlan) incompleteSteps.push('operations plan');
    if (!setupStatus.complianceChecklist) incompleteSteps.push('compliance checklist');

    if (incompleteSteps.length === 0) {
      return {
        role: 'assistant',
        content: 'Your business is fully set up! Head to your dashboard to start managing everything.',
        quickReplies: ['Go to dashboard', 'Review my setup'],
        setupStatus,
      };
    }

    const nextStep = incompleteSteps[0];
    return {
      role: 'assistant',
      content: `Let's continue setting up your business. Next up: ${nextStep}. Would you like me to help with that?`,
      quickReplies: [`Set up ${nextStep}`, 'Skip for now', 'Show all remaining steps'],
      setupStatus,
    };
  }

  async getWelcomeMessage(businessId: string): Promise<ConciergeMessage> {
    const [setupStatus, business] = await Promise.all([
      this.getSetupStatus(businessId),
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { name: true, businessIntent: true, archetype: true, industry: true },
      }),
    ]);

    if (setupStatus.percentage === 100) {
      return {
        role: 'assistant',
        content: `Welcome back! Your business "${business?.name}" is fully configured. Is there anything you'd like to adjust or update?`,
        quickReplies: ['Review my setup', 'Update products', 'Go to dashboard'],
        setupStatus,
      };
    }

    if (business?.businessIntent) {
      const detection = await this.detectBusinessType(businessId, business.businessIntent);
      return {
        role: 'assistant',
        content: `Welcome! I'm your setup assistant. I see you're building a ${detection.template.label.toLowerCase()} business. I can auto-configure your account with industry-standard defaults — products with TTD pricing, business hours, and payment options. Ready to get started?`,
        quickReplies: ['Yes, set it up!', 'Let me customize', 'Tell me about the defaults'],
        actions: [
          { id: 'action_accept_all', label: 'Accept All Defaults', type: 'confirm' },
          { id: 'action_customize', label: 'Review Each Section', type: 'customize' },
        ],
        setupStatus,
      };
    }

    return {
      role: 'assistant',
      content: `Welcome to KeyFlowOS! I'm your onboarding concierge. Tell me a bit about your business — what type of services or products do you offer? I'll set everything up for you in about 5 minutes.`,
      quickReplies: ['Salon & Beauty', 'Fitness & Wellness', 'Food & Catering', 'Photography', 'Consulting', 'Retail / E-commerce'],
      setupStatus,
    };
  }

  async checkAndGenerateNudges(businessId: string): Promise<NudgeItem[]> {
    const [setupStatus, business, blueprint] = await Promise.all([
      this.getSetupStatus(businessId),
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { metaData: true, onboardingComplete: true, createdAt: true },
      }),
      this.blueprint.getBlueprint(businessId).catch((err: unknown) => {
        this.logger.debug(`Failed to load blueprint for nudges: ${(err as Error).message}`);
        return null;
      }),
    ]);

    if (business?.onboardingComplete && setupStatus.percentage === 100) {
      return [];
    }

    const meta = parseMetaData(business?.metaData);
    const nudgeHistory = (meta.nudgeHistory as Record<string, string> | undefined) || {};
    const snoozedUntil = (meta.snoozedNudges as Record<string, string> | undefined) || {};
    const now = new Date();
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

    const nudges: NudgeItem[] = [];
    const domainReadiness = blueprint ? this.calculateDomainReadiness(blueprint) : null;

    const nudgeDefinitions: Array<{
      key: string;
      condition: boolean;
      title: string;
      body: string;
      ctaLabel: string;
      ctaHref: string;
    }> = [
      {
        key: 'products',
        condition: !setupStatus.products,
        title: 'Add your products or services',
        body: "You haven't added any products yet. Want me to help set up your catalog with suggested pricing? Takes about 2 minutes.",
        ctaLabel: 'Set up products',
        ctaHref: '/app/onboarding?step=products',
      },
      {
        key: 'businessHours',
        condition: !setupStatus.businessHours,
        title: 'Set your business hours',
        body: "Customers need to know when you're available. I can set typical Trinidad hours for your business type.",
        ctaLabel: 'Set hours',
        ctaHref: '/app/onboarding?step=hours',
      },
      {
        key: 'storefront',
        condition: !setupStatus.storefront,
        title: 'Enable your online storefront',
        body: "You've added products but haven't enabled your storefront yet — want me to help? Takes about 3 minutes.",
        ctaLabel: 'Set up storefront',
        ctaHref: '/app/onboarding?step=storefront',
      },
      {
        key: 'contacts',
        condition: !setupStatus.contacts && setupStatus.products,
        title: 'Import your contacts',
        body: "You've set up your services but haven't added any customers yet. Import from CSV or add them manually.",
        ctaLabel: 'Import contacts',
        ctaHref: '/app/crm/pipeline?action=import',
      },
      {
        key: 'payments',
        condition: !setupStatus.payments,
        title: 'Configure payment methods',
        body: 'Set up how you accept payments — WiPay for local, PayPal for international clients.',
        ctaLabel: 'Set up payments',
        ctaHref: '/app/settings/business?tab=payments',
      },
      {
        key: 'genesis-legal',
        condition: !setupStatus.legalProfile && (!domainReadiness || domainReadiness.legal < 60),
        title: 'Complete your legal setup',
        body: 'KEY can generate your Trinidad & Tobago registration checklist once you confirm your entity type.',
        ctaLabel: 'Set up legal profile',
        ctaHref: '/app/onboarding',
      },
      {
        key: 'genesis-finance',
        condition: !setupStatus.financeModel && (!domainReadiness || domainReadiness.finance < 60),
        title: 'Build your financial model',
        body: 'Add your startup costs, monthly fixed costs, and pricing so KEY can forecast break-even and runway.',
        ctaLabel: 'Build finance model',
        ctaHref: '/app/onboarding',
      },
      {
        key: 'genesis-market',
        condition: !setupStatus.marketStrategy && (!domainReadiness || domainReadiness.market < 60),
        title: 'Define your market strategy',
        body: 'Tell KEY who your ideal customer is, what your core offer is, and how you plan to reach them.',
        ctaLabel: 'Define market strategy',
        ctaHref: '/app/onboarding',
      },
      {
        key: 'genesis-compliance',
        condition: !setupStatus.complianceChecklist && (!domainReadiness || domainReadiness.compliance < 60),
        title: 'Complete your compliance checklist',
        body: 'Run the Trinidad & Tobago compliance check so you know which registrations and licences you need.',
        ctaLabel: 'Run compliance check',
        ctaHref: '/app/onboarding',
      },
    ];

    for (const def of nudgeDefinitions) {
      if (!def.condition) continue;

      const lastNudged = nudgeHistory[def.key];
      if (lastNudged && (now.getTime() - new Date(lastNudged).getTime()) < THREE_DAYS_MS) {
        continue;
      }

      const snoozed = snoozedUntil[def.key];
      if (snoozed && now < new Date(snoozed)) {
        continue;
      }

      nudges.push({
        id: def.key,
        type: 'onboarding_nudge',
        title: def.title,
        body: def.body,
        ctaLabel: def.ctaLabel,
        ctaHref: def.ctaHref,
        snoozable: true,
      });
    }

    if (nudges.length > 0) {
      const updatedHistory: Record<string, string> = { ...nudgeHistory };
      for (const nudge of nudges) {
        updatedHistory[nudge.id] = now.toISOString();
      }
      await this.prisma.client.business.update({
        where: { id: businessId },
        data: {
          metaData: { ...meta, nudgeHistory: updatedHistory } as Prisma.InputJsonValue,
        },
      });
    }

    return nudges;
  }

  async snoozeNudge(businessId: string, nudgeId: string, days: number = 3) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });

    const meta = parseMetaData(business?.metaData);
    const snoozedNudges = (meta.snoozedNudges as Record<string, string> | undefined) || {};
    const snoozeUntil = new Date();
    snoozeUntil.setDate(snoozeUntil.getDate() + days);

    snoozedNudges[nudgeId] = snoozeUntil.toISOString();

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        metaData: { ...meta, snoozedNudges } as Prisma.InputJsonValue,
      },
    });

    return { snoozed: true, until: snoozeUntil.toISOString() };
  }

  async dismissConcierge(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });

    const meta = parseMetaData(business?.metaData);
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        metaData: {
          ...meta,
          conciergeDismissed: true,
          conciergeDismissedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    return { dismissed: true };
  }

  async resumeConcierge(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });

    const meta = parseMetaData(business?.metaData);
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        metaData: {
          ...meta,
          conciergeDismissed: false,
        } as Prisma.InputJsonValue,
      },
    });

    return { resumed: true };
  }

  async getConciergeState(businessId: string) {
    const [setupStatus, business] = await Promise.all([
      this.getSetupStatus(businessId),
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { metaData: true, onboardingComplete: true },
      }),
    ]);

    const meta = parseMetaData(business?.metaData);

    return {
      setupStatus,
      dismissed: !!(meta.conciergeDismissed),
      templateId: meta.conciergeTemplateId as string | undefined,
      onboardingComplete: business?.onboardingComplete ?? false,
    };
  }

  async seedDemoData(businessId: string) {
    return this.demoSeeder.seedDemoData(businessId);
  }

  async markOnboardingComplete(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { onboardingComplete: true, onboardingCompletedAt: true },
    });

    if (business?.onboardingComplete && business?.onboardingCompletedAt) {
      return { complete: true, alreadyComplete: true };
    }

    const integrity = await this.blueprint.calculateGenomeIntegrity(businessId);
    if (!integrity.threePillarMinimumMet) {
      const pillarKeys: DnaSectionKey[] = ['founder', 'business', 'market'];
      const missingPillars = pillarKeys.filter((key) => integrity.genomeDnaScores[key] < 50);
      throw new ForbiddenException({
        code: 'GENOME_GATE_BLOCKED',
        message: 'Three-Pillar Minimum not met. Complete Founder, Business, and Market DNA before finishing onboarding.',
        genomeIntegrity: integrity.genomeIntegrity,
        missingPillars,
      });
    }

    const demoData = await this.prisma.client.$transaction(async (tx) => {
      await tx.business.update({
        where: { id: businessId },
        data: {
          onboardingComplete: true,
          onboardingCompletedAt: new Date(),
          onboardingStep: 'complete',
        },
      });

      const seeded = await this.demoSeeder.seedDemoData(businessId, tx);
      await this.awardSetupMilestone(businessId, 'onboardingComplete', tx);
      await this.ensureLegalDisclaimerAccepted(businessId, tx);

      return seeded;
    });

    return { complete: true, demoData };
  }

  private async ensureLegalDisclaimerAccepted(businessId: string, tx?: PrismaTx) {
    try {
      const blueprint = await this.blueprint.getBlueprint(businessId, tx).catch(() => null);
      if (!blueprint) return;
      if (blueprint.legalProfile?.disclaimerAcceptedAt) return;

      await this.blueprint.updateBlueprint(
        businessId,
        {
          legalProfile: {
            ...(blueprint.legalProfile || {}),
            disclaimerAcceptedAt: new Date().toISOString(),
          },
        },
        tx,
      );
    } catch (err: any) {
      this.logger.warn(`Failed to record legal disclaimer acceptance: ${(err as Error).message}`);
    }
  }

  private async awardSetupMilestone(
    businessId: string,
    milestone: string,
    tx?: PrismaTx,
  ) {
    try {
      const client = tx ?? this.prisma.client;
      const business = await client.business.findUnique({
        where: { id: businessId },
        select: { metaData: true },
      });
      const meta = parseMetaData(business?.metaData);
      const milestones = (Array.isArray(meta.setupMilestones) ? meta.setupMilestones : []) as string[];

      if (!milestones.includes(milestone)) {
        milestones.push(milestone);
        await client.business.update({
          where: { id: businessId },
          data: {
            metaData: {
              ...meta,
              setupMilestones: milestones,
              [`${milestone}At`]: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
      }
    } catch (error: any) {
      this.logger.warn(`Failed to award milestone ${milestone}: ${(error as Error).message}`);
    }
  }
}
