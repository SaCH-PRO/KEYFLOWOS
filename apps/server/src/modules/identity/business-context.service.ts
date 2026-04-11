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
}

const MAX_CONTEXT_CHARS = 3000;

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
          offer: { select: { primaryOffer: true, valueProposition: true, differentiators: true } },
          customer: { select: { targetDemographic: true, customerPainPoints: true } },
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
    if (guidanceProfile) {
      const parts: string[] = [];
      const offer = guidanceProfile.offer;
      const customer = guidanceProfile.customer;
      if (offer?.primaryOffer) parts.push(`Core offer: ${offer.primaryOffer}`);
      if (offer?.valueProposition) parts.push(`Value proposition: ${offer.valueProposition}`);
      if (offer?.differentiators?.length) parts.push(`Differentiators: ${offer.differentiators.join(', ')}`);
      if (customer?.targetDemographic) parts.push(`Demographics: ${customer.targetDemographic}`);
      if (customer?.customerPainPoints?.length) parts.push(`Customer pain points: ${customer.customerPainPoints.join(', ')}`);
      guidanceInsights = parts.join('. ');
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

    const lines: string[] = [];
    lines.push(`Business: "${merged.name}"`);
    if (merged.industry) lines.push(`Industry: ${merged.industry}`);
    if (merged.businessStage) lines.push(`Stage: ${merged.businessStage}`);
    if (merged.archetype) lines.push(`Type: ${merged.archetype.replace(/_/g, ' ').toLowerCase()}`);
    if (merged.teamSize) lines.push(`Team: ${merged.teamSize.replace(/_/g, ' ').toLowerCase()}`);
    if (merged.location) lines.push(`Location: ${merged.location}`);
    if (merged.currency) lines.push(`Currency: ${merged.currency}`);
    if (merged.revenueModel) lines.push(`Revenue model: ${merged.revenueModel}`);
    if (merged.tagline) lines.push(`Current tagline: "${merged.tagline}"`);
    if (merged.description) lines.push(`Current description: "${merged.description}"`);
    if (merged.skills.length > 0) lines.push(`Skills: ${merged.skills.join(', ')}`);
    if (merged.servicesSummary) lines.push(merged.servicesSummary);
    if (merged.productsSummary) lines.push(merged.productsSummary);
    if (merged.contactStats) lines.push(merged.contactStats);
    if (merged.bookingStats) lines.push(merged.bookingStats);
    if (merged.revenueSnapshot) lines.push(merged.revenueSnapshot);
    if (merged.businessHours) lines.push(`Hours: ${merged.businessHours}`);
    if (merged.socialPresence) lines.push(`Online presence: ${merged.socialPresence}`);
    if (merged.guidanceInsights) lines.push(`Guidance insights: ${merged.guidanceInsights}`);

    const block = lines.join('\n');

    if (block.length > MAX_CONTEXT_CHARS) {
      this.logger.warn(
        `Business context for is ${block.length} chars, truncating to ${MAX_CONTEXT_CHARS} chars to prevent oversized AI prompts`,
      );
      return block.slice(0, MAX_CONTEXT_CHARS) + '\n[...context truncated for length]';
    }

    return block;
  }

  private emptyContext(): BusinessContext {
    return {
      name: '', industry: '', businessStage: '', archetype: '', teamSize: '',
      tagline: '', description: '', location: '', currency: 'TTD', skills: [],
      revenueModel: '', businessHours: '', servicesSummary: '', productsSummary: '',
      contactStats: '', bookingStats: '', revenueSnapshot: '', socialPresence: '',
      guidanceInsights: '',
    };
  }
}
