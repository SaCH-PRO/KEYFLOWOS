import type { Business } from '@prisma/client';
import type { BusinessBlueprint, BlueprintOffer, BlueprintClosePathway, PaymentGatewayKey, StorefrontSectionConfig } from './blueprint.types';

export type BusinessLike = Partial<
  Pick<
    Business,
    'name' | 'industry' | 'city' | 'country' | 'timezone' | 'currency' | 'primaryColor' | 'secondaryColor' | 'tagline' | 'description' | 'slug' | 'whatsapp'
  >
>;

const DEFAULT_SECTIONS: StorefrontSectionConfig[] = [
  { key: 'hero', enabled: true, order: 1 },
  { key: 'featured_offers', enabled: true, order: 2 },
  { key: 'trust', enabled: true, order: 3 },
  { key: 'faq', enabled: true, order: 4 },
  { key: 'contact', enabled: true, order: 5 },
  { key: 'closing_cta', enabled: true, order: 6 },
];

function toSlug(value: string | null | undefined): string {
  const base = (value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `launchpad-${Date.now()}`;
}

function pickBusinessType(industry: string | null | undefined): BusinessBlueprint['businessIdentity']['businessType'] {
  const normalized = (industry ?? '').toLowerCase();
  if (normalized.includes('clinic') || normalized.includes('medical')) return 'clinic';
  if (normalized.includes('retail') || normalized.includes('shop')) return 'retail';
  if (normalized.includes('food') || normalized.includes('restaurant')) return 'food';
  if (normalized.includes('creative') || normalized.includes('design')) return 'creative';
  if (normalized.includes('wellness') || normalized.includes('fitness')) return 'wellness';
  if (normalized.includes('consult')) return 'consulting';
  return 'service';
}

function buildOffer(currency: string, businessType: BusinessBlueprint['businessIdentity']['businessType']): BlueprintOffer {
  if (businessType === 'retail' || businessType === 'product') {
    return {
      name: 'Featured Product',
      description: 'Our best-selling item.',
      category: 'product',
      currency,
      price: 199,
      requiresDelivery: true,
      status: 'active',
    };
  }

  return {
    name: 'Signature Service',
    description: 'A focused service designed to get results quickly.',
    category: 'service',
    currency,
    price: 250,
    durationMins: 60,
    requiresBooking: true,
    status: 'active',
  };
}

function resolveClosePathway(offer: BlueprintOffer): BlueprintClosePathway {
  if (offer.category === 'product') return 'instant_checkout';
  if (offer.category === 'deposit') return 'deposit_checkout';
  if (offer.category === 'quote') return 'request_quote';
  return 'booking_first';
}

function resolveGateways(pathway: BlueprintClosePathway): PaymentGatewayKey[] {
  if (pathway === 'instant_checkout') return ['payment_link', 'paypal', 'manual', 'bank_transfer'];
  if (pathway === 'deposit_checkout') return ['payment_link', 'bank_transfer', 'manual'];
  return ['manual', 'bank_transfer', 'cash', 'invoice'];
}

export function buildDefaultBlueprint(business: BusinessLike): BusinessBlueprint {
  const currency = business.currency || 'TTD';
  const businessType = pickBusinessType(business.industry);
  const firstOffer = buildOffer(currency, businessType);
  const closePathway = resolveClosePathway(firstOffer);
  const gateways = resolveGateways(closePathway);

  return {
    schemaVersion: '1.0',
    businessIdentity: {
      businessName: business.name || 'My Business',
      industry: business.industry || 'General',
      businessType,
      location: business.city || undefined,
      timezone: business.timezone || undefined,
      currency,
      country: business.country || undefined,
    },
    audience: {
      idealCustomer: '',
      customerPainPoints: [],
      customerGoals: [],
      commonQuestions: [],
    },
    offerModel: {
      primaryOfferType: firstOffer.category === 'product' ? 'product' : 'appointment',
      offers: [firstOffer],
      pricingStyle: 'fixed',
    },
    brand: {
      tone: 'professional',
      stylePreset: 'clean',
      primaryColor: business.primaryColor || undefined,
      secondaryColor: business.secondaryColor || undefined,
      tagline: business.tagline || undefined,
      shortDescription: business.description || undefined,
      trustSignals: [],
    },
    storefront: {
      slug: toSlug(business.slug || business.name),
      headline: `${business.name || 'Your business'} is open for bookings and orders`,
      subheadline: 'Book, buy, or request your first service in minutes.',
      sections: DEFAULT_SECTIONS,
      defaultCta: closePathway === 'booking_first' ? 'book_now' : 'buy_now',
      socialLinks: {},
      whatsapp: business.whatsapp || undefined,
    },
    paymentAndClosing: {
      enabledGateways: gateways,
      preferredGateway: gateways[0],
      acceptsManualPayment: true,
      acceptsBankTransfer: gateways.includes('bank_transfer'),
      acceptsCash: gateways.includes('cash'),
      requiresDeposit: closePathway === 'deposit_checkout',
      depositPercent: closePathway === 'deposit_checkout' ? 30 : undefined,
      closePathway,
    },
    automationPlan: {
      recommendedPlaybooks: [],
      enabledPlaybooks: [],
    },
    activation: {
      onboardingCompleted: false,
      storefrontPublished: false,
      paymentPathConfigured: false,
      firstOfferCreated: true,
      firstShareCompleted: false,
      firstTransactionIntentCreated: false,
    },
  };
}

export function mergeBlueprintPatch(
  base: BusinessBlueprint,
  patch: Partial<BusinessBlueprint>,
): BusinessBlueprint {
  return {
    ...base,
    ...patch,
    businessIdentity: { ...base.businessIdentity, ...(patch.businessIdentity ?? {}) },
    audience: { ...base.audience, ...(patch.audience ?? {}) },
    offerModel: {
      ...base.offerModel,
      ...(patch.offerModel ?? {}),
      offers: patch.offerModel?.offers ?? base.offerModel.offers,
    },
    brand: { ...base.brand, ...(patch.brand ?? {}) },
    storefront: {
      ...base.storefront,
      ...(patch.storefront ?? {}),
      sections: patch.storefront?.sections ?? base.storefront.sections,
    },
    paymentAndClosing: { ...base.paymentAndClosing, ...(patch.paymentAndClosing ?? {}) },
    automationPlan: { ...base.automationPlan, ...(patch.automationPlan ?? {}) },
    activation: { ...base.activation, ...(patch.activation ?? {}) },
  };
}

export function normalizeBlueprintForStorage(blueprint: BusinessBlueprint): BusinessBlueprint {
  return JSON.parse(JSON.stringify(blueprint)) as BusinessBlueprint;
}
