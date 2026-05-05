import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { CatalogService } from '../catalog/catalog.service';
import { matchIndustryTemplate, getTemplateById, IndustryTemplate, INDUSTRY_TEMPLATES } from './industry-templates';

export interface SetupStatus {
  products: boolean;
  businessHours: boolean;
  payments: boolean;
  storefront: boolean;
  contacts: boolean;
  profile: boolean;
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
  metaData: Prisma.JsonValue;
}

interface AutoConfigureResult {
  templateId: string;
  templateLabel: string;
  productsCreated?: number;
  productsSkipped?: boolean;
  businessHoursSet?: boolean;
  paymentMethodsSet?: boolean;
  storefrontEnabled?: boolean;
}

type BusinessMetaData = Record<string, Prisma.JsonValue | undefined>;

function parseMetaData(raw: Prisma.JsonValue | null | undefined): BusinessMetaData {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as BusinessMetaData;
  }
  return {};
}

@Injectable()
export class OnboardingConciergeService {
  private readonly logger = new Logger(OnboardingConciergeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  async getSetupStatus(businessId: string): Promise<SetupStatus> {
    const [business, productCount, contactCount] = await Promise.all([
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
    ]);

    const meta = parseMetaData(business?.metaData);

    const profile = !!(business?.name && business.name.length > 0 && (business.phone || business.email));
    const products = productCount > 0;
    const businessHours = !!business?.businessHours;
    const payments = !!(meta.paymentMethodsConfigured);
    const storefront = !!(business?.slug && business?.storeEnabled);
    const contacts = contactCount > 0;

    const steps = [profile, products, businessHours, payments, storefront, contacts];
    const completedCount = steps.filter(Boolean).length;

    return {
      products,
      businessHours,
      payments,
      storefront,
      contacts,
      profile,
      completedCount,
      totalSteps: steps.length,
      percentage: Math.round((completedCount / steps.length) * 100),
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
    } = options;

    const results: Partial<AutoConfigureResult> = {};

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
              currency: p.currency,
              category: p.category,
              duration: p.duration ?? null,
              description: p.description ?? null,
              isActive: true,
            });
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
        select: { metaData: true, slug: true, storeEnabled: true },
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

      if (configureStorefront && !business?.storeEnabled) {
        businessUpdate.storeEnabled = true;
        results.storefrontEnabled = true;
      }

      await tx.business.update({
        where: { id: businessId },
        data: businessUpdate,
      });
    });

    await this.awardSetupMilestone(businessId, 'conciergeSetupComplete');

    return {
      templateId: template.id,
      templateLabel: template.label,
      ...results,
    };
  }

  async detectBusinessType(businessDescription: string): Promise<{
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
          metaData: true,
        },
      }),
    ]);

    const meta = parseMetaData(business?.metaData);
    const templateId = meta.conciergeTemplateId as string | undefined;
    const detection = await this.detectBusinessType(
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
      return parsed;
    } catch (error) {
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

    return `You are the KeyFlowOS Onboarding Concierge — a friendly, knowledgeable business setup assistant for Caribbean entrepreneurs.

CONTEXT:
- Business: ${business?.name || 'New Business'}
- Industry: ${business?.industry || detection.template.label}
- Business Type: ${detection.template.label} (${detection.confidence} confidence)
- Location: ${business?.country || 'Trinidad and Tobago'}
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

GUIDELINES:
1. Be warm, encouraging, and conversational — like a helpful friend who knows Caribbean business.
2. Use TTD (Trinidad & Tobago Dollar) for all pricing references.
3. Guide the user through setup one step at a time, focusing on the most impactful incomplete step first.
4. When suggesting products/services, use realistic TTD pricing for the Caribbean market.
5. Explain what you can set up automatically and let the user confirm or customize each section individually.
6. Keep responses concise — 2-4 sentences max per response.
7. When all steps are complete, congratulate them and suggest next actions.
8. Always end with a question or clear next step.
9. When presenting auto-configured sections, offer explicit accept/customize options for each: products, hours, payments, storefront.

RESPONSE FORMAT:
Reply with your message text. If you want to suggest quick reply options, add them on a new line starting with "QUICK_REPLIES:" followed by comma-separated options.
If you want to suggest an action, add on a new line "ACTION:" followed by the action type and label, separated by pipe (|).
For per-section actions, use "ACTION:confirm|Accept Products,ACTION:customize|Customize Products" etc.
Example:
Great! I can set up your salon with popular services and TTD pricing. Want me to go ahead?
QUICK_REPLIES:Yes, set it up!,Let me customize,Tell me more
ACTION:confirm|Set Up Salon Defaults`;
  }

  private parseAiResponse(content: string, setupStatus: SetupStatus): ConciergeMessage {
    const lines = content.split('\n');
    let messageText = '';
    const quickReplies: string[] = [];
    const actions: ConciergeAction[] = [];

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
      }
    }

    return {
      role: 'assistant',
      content: messageText.trim(),
      quickReplies: quickReplies.length > 0 ? quickReplies : undefined,
      actions: actions.length > 0 ? actions : undefined,
      setupStatus,
    };
  }

  private getFallbackResponse(setupStatus: SetupStatus): ConciergeMessage {
    const incompleteSteps: string[] = [];
    if (!setupStatus.profile) incompleteSteps.push('business profile');
    if (!setupStatus.products) incompleteSteps.push('products');
    if (!setupStatus.businessHours) incompleteSteps.push('business hours');
    if (!setupStatus.payments) incompleteSteps.push('payment methods');
    if (!setupStatus.storefront) incompleteSteps.push('storefront');
    if (!setupStatus.contacts) incompleteSteps.push('contacts');

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
      const detection = await this.detectBusinessType(business.businessIntent);
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
    const [setupStatus, business] = await Promise.all([
      this.getSetupStatus(businessId),
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { metaData: true, onboardingComplete: true, createdAt: true },
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

  async markOnboardingComplete(businessId: string) {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { onboardingComplete: true },
    });

    await this.awardSetupMilestone(businessId, 'onboardingComplete');

    return { complete: true };
  }

  private async awardSetupMilestone(businessId: string, milestone: string) {
    try {
      const business = await this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { metaData: true },
      });
      const meta = parseMetaData(business?.metaData);
      const milestones = (Array.isArray(meta.setupMilestones) ? meta.setupMilestones : []) as string[];

      if (!milestones.includes(milestone)) {
        milestones.push(milestone);
        await this.prisma.client.business.update({
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
    } catch (error) {
      this.logger.warn(`Failed to award milestone ${milestone}: ${(error as Error).message}`);
    }
  }
}
