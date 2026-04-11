import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface BusinessContext {
  name: string;
  industry: string;
  businessStage: string;
  archetype: string;
  teamSize: string;
  tagline: string;
  description: string;
  location: string;
  currency: string;
  skills: string[];
  revenueModel: string;
  businessHours: string;
  servicesSummary: string;
  productsSummary: string;
  contactStats: string;
  bookingStats: string;
  revenueSnapshot: string;
  socialPresence: string;
  guidanceInsights: string;
  identityBrand: string;
  founderTeam: string;
  marketCustomer: string;
  offerPricing: string;
  revenueFinance: string;
  operationsData: string;
  growthMarketing: string;
  salesData: string;
  complianceLegal: string;
  goalsStrategy: string;
  technologyData: string;
  partnershipsData: string;
  ipData: string;
  peopleHR: string;
}

const MAX_CONTEXT_CHARS = 12000;

const SECTION_PRIORITIES: Record<string, number> = {
  core: 100,
  identityBrand: 90,
  offerPricing: 88,
  marketCustomer: 85,
  revenueFinance: 80,
  salesData: 78,
  growthMarketing: 75,
  operationsData: 70,
  goalsStrategy: 68,
  founderTeam: 65,
  peopleHR: 60,
  technologyData: 55,
  complianceLegal: 50,
  partnershipsData: 45,
  ipData: 40,
};

@Injectable()
export class BusinessContextService {
  private readonly logger = new Logger(BusinessContextService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async gatherContext(businessId: string): Promise<BusinessContext> {
    const db = this.prisma.client;

    const [biz, serviceData, productData, contactStats, bookingStats, revenueData, guidanceProfile] = await Promise.all([
      db.business.findUnique({ where: { id: businessId } }),
      db.service.findMany({
        where: { businessId, deletedAt: null },
        select: { name: true, price: true, duration: true, description: true },
        take: 20,
      }),
      db.product.findMany({
        where: { businessId, deletedAt: null },
        select: { name: true, price: true, category: true },
        take: 20,
      }),
      db.contact.aggregate({
        where: { businessId, deletedAt: null },
        _count: true,
      }),
      db.booking.aggregate({
        where: { businessId, deletedAt: null },
        _count: true,
      }),
      db.invoice.aggregate({
        where: { businessId, status: 'PAID' },
        _sum: { total: true },
        _count: true,
      }),
      db.businessGuidanceProfile.findUnique({
        where: { businessId },
        include: {
          identity: true,
          founder: true,
          offer: true,
          customer: true,
          revenue: true,
          finance: true,
          operations: true,
          compliance: true,
          growth: true,
          goals: true,
          sales: true,
          marketingStrategy: true,
          people: true,
          technology: true,
          partnerships: true,
          intellectualProperty: true,
        },
      }).catch(() => null),
    ]);

    if (!biz) {
      return this.emptyContext();
    }

    const locationParts = [biz.city, biz.country].filter(Boolean);
    const location = locationParts.length > 0 ? locationParts.join(', ') : '';

    const skills: string[] = Array.isArray(biz.skills) ? biz.skills as string[] : [];

    let servicesSummary = '';
    if (serviceData.length > 0) {
      const serviceNames = serviceData.map(s => s.name);
      const avgPrice = serviceData.reduce((sum, s) => sum + (Number(s.price) || 0), 0) / serviceData.length;
      servicesSummary = `Offers ${serviceData.length} service(s): ${serviceNames.slice(0, 8).join(', ')}${serviceNames.length > 8 ? ` (+${serviceNames.length - 8} more)` : ''}`;
      if (avgPrice > 0) servicesSummary += `. Average price: ${biz.currency || 'TTD'} ${avgPrice.toFixed(0)}`;
      const durationsMin = serviceData.map(s => s.duration).filter(Boolean);
      if (durationsMin.length > 0) {
        const avgDuration = Math.round(durationsMin.reduce((a, b) => a + b, 0) / durationsMin.length);
        servicesSummary += `. Average duration: ${avgDuration} min`;
      }
    }

    let productsSummary = '';
    if (productData.length > 0) {
      const productNames = productData.map(p => p.name);
      const categories = [...new Set(productData.map(p => p.category).filter(Boolean))];
      productsSummary = `Sells ${productData.length} product(s): ${productNames.slice(0, 8).join(', ')}${productNames.length > 8 ? ` (+${productNames.length - 8} more)` : ''}`;
      if (categories.length > 0) productsSummary += `. Categories: ${categories.join(', ')}`;
    }

    const contactCount = contactStats._count || 0;
    const contactSummary = contactCount > 0 ? `${contactCount} contacts in CRM` : '';

    const bookingCount = bookingStats._count || 0;
    const bookingSummary = bookingCount > 0 ? `${bookingCount} total bookings` : '';

    let revenueSnapshot = '';
    if (revenueData._count > 0) {
      const totalRev = Number(revenueData._sum.total) || 0;
      revenueSnapshot = `${revenueData._count} paid invoices totaling ${biz.currency || 'TTD'} ${totalRev.toFixed(0)}`;
    }

    const socialPlatforms: string[] = [];
    if (biz.facebook) socialPlatforms.push('Facebook');
    if (biz.instagram) socialPlatforms.push('Instagram');
    if (biz.twitter) socialPlatforms.push('Twitter/X');
    if (biz.linkedin) socialPlatforms.push('LinkedIn');
    if (biz.tiktok) socialPlatforms.push('TikTok');
    if (biz.youtube) socialPlatforms.push('YouTube');
    if (biz.whatsapp) socialPlatforms.push('WhatsApp');
    if (biz.website) socialPlatforms.push(`Website: ${biz.website}`);
    const socialPresence = socialPlatforms.length > 0 ? socialPlatforms.join(', ') : '';

    let guidanceInsights = '';
    let identityBrand = '';
    let founderTeam = '';
    let marketCustomer = '';
    let offerPricing = '';
    let revenueFinance = '';
    let operationsData = '';
    let growthMarketing = '';
    let salesData = '';
    let complianceLegal = '';
    let goalsStrategy = '';
    let technologyData = '';
    let partnershipsData = '';
    let ipData = '';
    let peopleHR = '';

    if (guidanceProfile) {
      const { identity, founder, offer, customer, revenue, finance, operations, compliance, growth, goals, sales, marketingStrategy, people, technology, partnerships, intellectualProperty } = guidanceProfile;

      if (identity) {
        const p: string[] = [];
        if (identity.missionStatement) p.push(`Mission: ${identity.missionStatement}`);
        if (identity.visionStatement) p.push(`Vision: ${identity.visionStatement}`);
        if (identity.coreValues?.length) p.push(`Core values: ${identity.coreValues.join(', ')}`);
        if (identity.targetMarket) p.push(`Target market: ${identity.targetMarket}`);
        if (identity.uniqueSellingPoint) p.push(`USP: ${identity.uniqueSellingPoint}`);
        if (identity.brandPersonality) p.push(`Brand personality: ${identity.brandPersonality}`);
        identityBrand = p.join('. ');
      }

      if (founder) {
        const p: string[] = [];
        if (founder.yearsExperience) p.push(`${founder.yearsExperience} years experience`);
        if (founder.technicalSkills?.length) p.push(`Skills: ${founder.technicalSkills.join(', ')}`);
        if (founder.leadershipStyle) p.push(`Leadership: ${founder.leadershipStyle}`);
        if (founder.previousExits) p.push(`Previous exits: ${founder.previousExits}`);
        if (founder.motivations?.length) p.push(`Motivations: ${founder.motivations.join(', ')}`);
        if (founder.weeklyHoursAvailable) p.push(`${founder.weeklyHoursAvailable}h/week available`);
        if (founder.coFounders) p.push(`${founder.coFounders} co-founder(s)`);
        founderTeam = p.join('. ');
      }

      if (offer) {
        const p: string[] = [];
        if (offer.primaryOffer) p.push(`Core offer: ${offer.primaryOffer}`);
        if (offer.valueProposition) p.push(`Value proposition: ${offer.valueProposition}`);
        if (offer.differentiators?.length) p.push(`Differentiators: ${offer.differentiators.join(', ')}`);
        if (offer.offerType) p.push(`Type: ${offer.offerType}`);
        if (offer.pricingModel) p.push(`Pricing: ${offer.pricingModel}`);
        if (offer.priceRangeLow != null || offer.priceRangeHigh != null) p.push(`Price range: ${offer.priceRangeLow ?? '?'}-${offer.priceRangeHigh ?? '?'}`);
        if (offer.deliveryMethod) p.push(`Delivery: ${offer.deliveryMethod}`);
        if (offer.marginPercent != null) p.push(`Margin: ${offer.marginPercent}%`);
        offerPricing = p.join('. ');
      }

      if (customer) {
        const p: string[] = [];
        if (customer.targetDemographic) p.push(`Demographics: ${customer.targetDemographic}`);
        if (customer.customerPainPoints?.length) p.push(`Pain points: ${customer.customerPainPoints.join(', ')}`);
        if (customer.geographicFocus) p.push(`Geographic focus: ${customer.geographicFocus}`);
        if (customer.incomeLevel) p.push(`Income level: ${customer.incomeLevel}`);
        if (customer.acquisitionChannels?.length) p.push(`Acquisition: ${customer.acquisitionChannels.join(', ')}`);
        if (customer.retentionStrategy) p.push(`Retention: ${customer.retentionStrategy}`);
        if (customer.customerLifetimeValue) p.push(`LTV: ${customer.customerLifetimeValue}`);
        if (customer.currentCustomerCount) p.push(`Current customers: ${customer.currentCustomerCount}`);
        if (customer.churnRatePercent != null) p.push(`Churn: ${customer.churnRatePercent}%`);
        marketCustomer = p.join('. ');
      }

      const revParts: string[] = [];
      if (revenue) {
        if (revenue.monthlyRevenue) revParts.push(`Monthly revenue: ${revenue.monthlyRevenue}`);
        if (revenue.annualRevenue) revParts.push(`Annual revenue: ${revenue.annualRevenue}`);
        if (revenue.revenueStreams?.length) revParts.push(`Streams: ${revenue.revenueStreams.join(', ')}`);
        if (revenue.recurringPercent != null) revParts.push(`Recurring: ${revenue.recurringPercent}%`);
        if (revenue.averageOrderValue) revParts.push(`AOV: ${revenue.averageOrderValue}`);
        if (revenue.revenueGrowthRate != null) revParts.push(`Growth rate: ${revenue.revenueGrowthRate}%`);
        if (revenue.targetMonthlyRevenue) revParts.push(`Target monthly: ${revenue.targetMonthlyRevenue}`);
      }
      if (finance) {
        if (finance.currentCashReserve) revParts.push(`Cash reserve: ${finance.currentCashReserve}`);
        if (finance.monthlyBurnRate) revParts.push(`Burn rate: ${finance.monthlyBurnRate}`);
        if (finance.monthlyFixedCosts) revParts.push(`Fixed costs: ${finance.monthlyFixedCosts}`);
        if (finance.debtTotal) revParts.push(`Debt: ${finance.debtTotal}`);
        if (finance.profitMarginPercent != null) revParts.push(`Profit margin: ${finance.profitMarginPercent}%`);
        if (finance.runwayMonths) revParts.push(`Runway: ${finance.runwayMonths} months`);
        if (finance.fundingSources?.length) revParts.push(`Funding: ${finance.fundingSources.join(', ')}`);
      }
      revenueFinance = revParts.join('. ');

      if (operations) {
        const p: string[] = [];
        if (operations.teamSize) p.push(`Team: ${operations.teamSize}`);
        if (operations.fullTimeEmployees) p.push(`FT: ${operations.fullTimeEmployees}`);
        if (operations.partTimeEmployees) p.push(`PT: ${operations.partTimeEmployees}`);
        if (operations.contractors) p.push(`Contractors: ${operations.contractors}`);
        if (operations.toolsUsed?.length) p.push(`Tools: ${operations.toolsUsed.join(', ')}`);
        if (operations.automationLevel) p.push(`Automation: ${operations.automationLevel}`);
        if (operations.bottlenecks?.length) p.push(`Bottlenecks: ${operations.bottlenecks.join(', ')}`);
        if (operations.keyProcesses?.length) p.push(`Key processes: ${operations.keyProcesses.join(', ')}`);
        operationsData = p.join('. ');
      }

      const growthParts: string[] = [];
      if (growth) {
        if (growth.growthStage) growthParts.push(`Growth stage: ${growth.growthStage}`);
        if (growth.marketingChannels?.length) growthParts.push(`Marketing channels: ${growth.marketingChannels.join(', ')}`);
        if (growth.marketingBudget) growthParts.push(`Marketing budget: ${growth.marketingBudget}`);
        if (growth.customerAcquisitionCost) growthParts.push(`CAC: ${growth.customerAcquisitionCost}`);
        if (growth.competitiveAdvantage) growthParts.push(`Competitive advantage: ${growth.competitiveAdvantage}`);
        if (growth.marketSize) growthParts.push(`Market size: ${growth.marketSize}`);
      }
      if (marketingStrategy) {
        if (marketingStrategy.brandVoice) growthParts.push(`Brand voice: ${marketingStrategy.brandVoice}`);
        if (marketingStrategy.messagingFramework) growthParts.push(`Messaging: ${marketingStrategy.messagingFramework}`);
        if (marketingStrategy.contentPillars?.length) growthParts.push(`Content pillars: ${marketingStrategy.contentPillars.join(', ')}`);
        if (marketingStrategy.socialStrategy) growthParts.push(`Social strategy: ${marketingStrategy.socialStrategy}`);
        if (marketingStrategy.emailStrategy) growthParts.push(`Email strategy: ${marketingStrategy.emailStrategy}`);
        if (marketingStrategy.seoStrategy) growthParts.push(`SEO: ${marketingStrategy.seoStrategy}`);
      }
      growthMarketing = growthParts.join('. ');

      if (sales) {
        const p: string[] = [];
        if (sales.salesProcess) p.push(`Process: ${sales.salesProcess}`);
        if (sales.salesCycle) p.push(`Cycle: ${sales.salesCycle}`);
        if (sales.conversionRate != null) p.push(`Conversion: ${sales.conversionRate}%`);
        if (sales.averageDealSize) p.push(`Avg deal: ${sales.averageDealSize}`);
        if (sales.salesChannels?.length) p.push(`Channels: ${sales.salesChannels.join(', ')}`);
        if (sales.crmApproach) p.push(`CRM: ${sales.crmApproach}`);
        if (sales.leadSources?.length) p.push(`Lead sources: ${sales.leadSources.join(', ')}`);
        if (sales.followUpStrategy) p.push(`Follow-up: ${sales.followUpStrategy}`);
        salesData = p.join('. ');
      }

      if (compliance) {
        const p: string[] = [];
        if (compliance.registrationType) p.push(`Registration: ${compliance.registrationType}`);
        if (compliance.businessRegistered != null) p.push(`Registered: ${compliance.businessRegistered ? 'Yes' : 'No'}`);
        if (compliance.insuranceTypes?.length) p.push(`Insurance: ${compliance.insuranceTypes.join(', ')}`);
        if (compliance.licensesHeld?.length) p.push(`Licenses held: ${compliance.licensesHeld.join(', ')}`);
        if (compliance.industryRegulations?.length) p.push(`Regulations: ${compliance.industryRegulations.join(', ')}`);
        complianceLegal = p.join('. ');
      }

      if (goals) {
        const p: string[] = [];
        if (goals.shortTermGoals?.length) p.push(`Short-term: ${goals.shortTermGoals.join(', ')}`);
        if (goals.longTermGoals?.length) p.push(`Long-term: ${goals.longTermGoals.join(', ')}`);
        if (goals.revenueTarget12m) p.push(`12m revenue target: ${goals.revenueTarget12m}`);
        if (goals.exitStrategy) p.push(`Exit strategy: ${goals.exitStrategy}`);
        if (goals.biggestChallenges?.length) p.push(`Challenges: ${goals.biggestChallenges.join(', ')}`);
        if (goals.timelineUrgency) p.push(`Urgency: ${goals.timelineUrgency}`);
        goalsStrategy = p.join('. ');
      }

      if (technology) {
        const p: string[] = [];
        if (technology.techStack?.length) p.push(`Stack: ${technology.techStack.join(', ')}`);
        if (technology.digitalMaturity) p.push(`Digital maturity: ${technology.digitalMaturity}`);
        if (technology.cybersecurityPosture) p.push(`Cybersecurity: ${technology.cybersecurityPosture}`);
        if (technology.dataStrategy) p.push(`Data strategy: ${technology.dataStrategy}`);
        if (technology.websitePlatform) p.push(`Website: ${technology.websitePlatform}`);
        if (technology.automationTools?.length) p.push(`Automation: ${technology.automationTools.join(', ')}`);
        technologyData = p.join('. ');
      }

      if (partnerships) {
        const p: string[] = [];
        if (partnerships.keySuppliers?.length) p.push(`Suppliers: ${partnerships.keySuppliers.join(', ')}`);
        if (partnerships.strategicAlliances?.length) p.push(`Alliances: ${partnerships.strategicAlliances.join(', ')}`);
        if (partnerships.distributionPartners?.length) p.push(`Distribution: ${partnerships.distributionPartners.join(', ')}`);
        if (partnerships.industryAssociations?.length) p.push(`Associations: ${partnerships.industryAssociations.join(', ')}`);
        if (partnerships.partnershipGoals) p.push(`Goals: ${partnerships.partnershipGoals}`);
        partnershipsData = p.join('. ');
      }

      if (intellectualProperty) {
        const p: string[] = [];
        if (intellectualProperty.trademarks?.length) p.push(`Trademarks: ${intellectualProperty.trademarks.join(', ')}`);
        if (intellectualProperty.patents?.length) p.push(`Patents: ${intellectualProperty.patents.join(', ')}`);
        if (intellectualProperty.proprietaryProcesses?.length) p.push(`Proprietary processes: ${intellectualProperty.proprietaryProcesses.join(', ')}`);
        if (intellectualProperty.ipProtectionStrategy) p.push(`IP strategy: ${intellectualProperty.ipProtectionStrategy}`);
        if (intellectualProperty.licensingStrategy) p.push(`Licensing: ${intellectualProperty.licensingStrategy}`);
        ipData = p.join('. ');
      }

      if (people) {
        const p: string[] = [];
        if (people.companyCulture) p.push(`Culture: ${people.companyCulture}`);
        if (people.hiringCriteria) p.push(`Hiring criteria: ${people.hiringCriteria}`);
        if (people.compensationPhilosophy) p.push(`Compensation: ${people.compensationPhilosophy}`);
        if (people.orgStructure) p.push(`Org structure: ${people.orgStructure}`);
        if (people.keyRoles?.length) p.push(`Key roles: ${people.keyRoles.join(', ')}`);
        if (people.remotePolicy) p.push(`Remote policy: ${people.remotePolicy}`);
        if (people.trainingApproach) p.push(`Training: ${people.trainingApproach}`);
        peopleHR = p.join('. ');
      }

      const legacyParts: string[] = [];
      if (offer?.primaryOffer) legacyParts.push(`Core offer: ${offer.primaryOffer}`);
      if (offer?.valueProposition) legacyParts.push(`Value proposition: ${offer.valueProposition}`);
      if (offer?.differentiators?.length) legacyParts.push(`Differentiators: ${offer.differentiators.join(', ')}`);
      if (customer?.targetDemographic) legacyParts.push(`Demographics: ${customer.targetDemographic}`);
      if (customer?.customerPainPoints?.length) legacyParts.push(`Customer pain points: ${customer.customerPainPoints.join(', ')}`);
      guidanceInsights = legacyParts.join('. ');
    }

    let businessHoursSummary = '';
    if (biz.businessHours && typeof biz.businessHours === 'object') {
      const hours = biz.businessHours as Record<string, { open?: string; close?: string; closed?: boolean }>;
      const openDays = Object.entries(hours)
        .filter(([, v]) => !v.closed)
        .map(([day, v]) => `${day}: ${v.open || '09:00'}-${v.close || '17:00'}`);
      if (openDays.length > 0) businessHoursSummary = openDays.join(', ');
    }

    return {
      name: biz.name || '',
      industry: biz.industry || '',
      businessStage: biz.businessStage || '',
      archetype: biz.archetype || '',
      teamSize: biz.teamSize || '',
      tagline: biz.tagline || '',
      description: biz.description || '',
      location,
      currency: biz.currency || 'TTD',
      skills,
      revenueModel: biz.revenueModel || '',
      businessHours: businessHoursSummary,
      servicesSummary,
      productsSummary,
      contactStats: contactSummary,
      bookingStats: bookingSummary,
      revenueSnapshot,
      socialPresence,
      guidanceInsights,
      identityBrand,
      founderTeam,
      marketCustomer,
      offerPricing,
      revenueFinance,
      operationsData,
      growthMarketing,
      salesData,
      complianceLegal,
      goalsStrategy,
      technologyData,
      partnershipsData,
      ipData,
      peopleHR,
    };
  }

  buildContextBlock(ctx: BusinessContext, formOverrides?: Record<string, string>): string {
    const merged = { ...ctx };
    if (formOverrides) {
      if (formOverrides.name) merged.name = formOverrides.name;
      if (formOverrides.tagline) merged.tagline = formOverrides.tagline;
      if (formOverrides.description) merged.description = formOverrides.description;
      if (formOverrides.teamSize) merged.teamSize = formOverrides.teamSize;
      if (formOverrides.industry) merged.industry = formOverrides.industry;
      if (formOverrides.businessStage) merged.businessStage = formOverrides.businessStage;
    }

    type Section = { label: string; lines: string[]; priority: number };
    const sections: Section[] = [];

    const coreLines: string[] = [];
    coreLines.push(`Business: "${merged.name}"`);
    if (merged.industry) coreLines.push(`Industry: ${merged.industry}`);
    if (merged.businessStage) coreLines.push(`Stage: ${merged.businessStage}`);
    if (merged.archetype) coreLines.push(`Type: ${merged.archetype.replace(/_/g, ' ').toLowerCase()}`);
    if (merged.teamSize) coreLines.push(`Team: ${merged.teamSize.replace(/_/g, ' ').toLowerCase()}`);
    if (merged.location) coreLines.push(`Location: ${merged.location}`);
    if (merged.currency) coreLines.push(`Currency: ${merged.currency}`);
    if (merged.revenueModel) coreLines.push(`Revenue model: ${merged.revenueModel}`);
    if (merged.tagline) coreLines.push(`Tagline: "${merged.tagline}"`);
    if (merged.description) coreLines.push(`Description: "${merged.description}"`);
    if (merged.skills.length > 0) coreLines.push(`Skills: ${merged.skills.join(', ')}`);
    if (merged.servicesSummary) coreLines.push(merged.servicesSummary);
    if (merged.productsSummary) coreLines.push(merged.productsSummary);
    if (merged.contactStats) coreLines.push(merged.contactStats);
    if (merged.bookingStats) coreLines.push(merged.bookingStats);
    if (merged.revenueSnapshot) coreLines.push(merged.revenueSnapshot);
    if (merged.businessHours) coreLines.push(`Hours: ${merged.businessHours}`);
    if (merged.socialPresence) coreLines.push(`Online presence: ${merged.socialPresence}`);
    sections.push({ label: 'BUSINESS OVERVIEW', lines: coreLines, priority: SECTION_PRIORITIES.core });

    const domainSections: Array<{ key: string; label: string; value: string }> = [
      { key: 'identityBrand', label: 'IDENTITY & BRAND', value: merged.identityBrand },
      { key: 'founderTeam', label: 'FOUNDER & TEAM', value: merged.founderTeam },
      { key: 'offerPricing', label: 'OFFER & PRICING', value: merged.offerPricing },
      { key: 'marketCustomer', label: 'MARKET & CUSTOMER', value: merged.marketCustomer },
      { key: 'revenueFinance', label: 'REVENUE & FINANCE', value: merged.revenueFinance },
      { key: 'salesData', label: 'SALES', value: merged.salesData },
      { key: 'growthMarketing', label: 'GROWTH & MARKETING', value: merged.growthMarketing },
      { key: 'operationsData', label: 'OPERATIONS', value: merged.operationsData },
      { key: 'peopleHR', label: 'PEOPLE & HR', value: merged.peopleHR },
      { key: 'goalsStrategy', label: 'GOALS & STRATEGY', value: merged.goalsStrategy },
      { key: 'technologyData', label: 'TECHNOLOGY', value: merged.technologyData },
      { key: 'complianceLegal', label: 'COMPLIANCE & LEGAL', value: merged.complianceLegal },
      { key: 'partnershipsData', label: 'PARTNERSHIPS', value: merged.partnershipsData },
      { key: 'ipData', label: 'INTELLECTUAL PROPERTY', value: merged.ipData },
    ];

    for (const ds of domainSections) {
      if (ds.value) {
        sections.push({
          label: ds.label,
          lines: [ds.value],
          priority: SECTION_PRIORITIES[ds.key] || 30,
        });
      }
    }

    if (merged.guidanceInsights) {
      const hasRicherData = merged.offerPricing || merged.marketCustomer;
      if (!hasRicherData) {
        sections.push({ label: 'GUIDANCE INSIGHTS', lines: [merged.guidanceInsights], priority: 35 });
      }
    }

    sections.sort((a, b) => b.priority - a.priority);

    const built: string[] = [];
    let totalLen = 0;

    for (const sec of sections) {
      const block = `[${sec.label}]\n${sec.lines.join('\n')}`;
      if (totalLen + block.length + 2 > MAX_CONTEXT_CHARS) {
        const remaining = MAX_CONTEXT_CHARS - totalLen - 30;
        if (remaining > 100) {
          built.push(block.slice(0, remaining) + '...');
        }
        break;
      }
      built.push(block);
      totalLen += block.length + 2;
    }

    const result = built.join('\n\n');

    if (result.length > MAX_CONTEXT_CHARS) {
      this.logger.warn(
        `Business context is ${result.length} chars, truncating to ${MAX_CONTEXT_CHARS}`,
      );
      return result.slice(0, MAX_CONTEXT_CHARS) + '\n[...context truncated]';
    }

    return result;
  }

  private emptyContext(): BusinessContext {
    return {
      name: '', industry: '', businessStage: '', archetype: '', teamSize: '',
      tagline: '', description: '', location: '', currency: 'TTD', skills: [],
      revenueModel: '', businessHours: '', servicesSummary: '', productsSummary: '',
      contactStats: '', bookingStats: '', revenueSnapshot: '', socialPresence: '',
      guidanceInsights: '', identityBrand: '', founderTeam: '', marketCustomer: '',
      offerPricing: '', revenueFinance: '', operationsData: '', growthMarketing: '',
      salesData: '', complianceLegal: '', goalsStrategy: '', technologyData: '',
      partnershipsData: '', ipData: '', peopleHR: '',
    };
  }
}
