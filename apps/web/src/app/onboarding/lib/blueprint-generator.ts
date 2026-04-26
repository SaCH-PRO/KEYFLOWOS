import type { BusinessBlueprint, BlueprintBusinessType, BlueprintPrimaryOfferType } from "@/types/blueprint";
import { DEFAULT_BLUEPRINT_STYLE, OFFER_DEFAULT_BY_BUSINESS_TYPE } from "./blueprint-presets";

type BusinessSnapshotInput = {
  businessName: string;
  industry: string;
  businessType: BlueprintBusinessType;
  currency?: string;
  country?: string;
  timezone?: string;
};

function toSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function offerTypeForBusinessType(businessType: BlueprintBusinessType): BlueprintPrimaryOfferType {
  switch (businessType) {
    case "product":
      return "product";
    case "consulting":
      return "quote";
    case "hybrid":
      return "package";
    default:
      return "appointment";
  }
}

export function generateInitialBlueprint(input: BusinessSnapshotInput): BusinessBlueprint {
  const slugBase = toSlug(input.businessName || input.industry || "launchpad");
  const offerType = offerTypeForBusinessType(input.businessType);
  const offerTemplate = OFFER_DEFAULT_BY_BUSINESS_TYPE[input.businessType];

  return {
    schemaVersion: "1.0",
    businessIdentity: {
      businessName: input.businessName,
      industry: input.industry,
      businessType: input.businessType,
      timezone: input.timezone,
      country: input.country,
      currency: input.currency ?? "TTD",
    },
    audience: {},
    offerModel: {
      primaryOfferType: offerType,
      offers: [
        {
          name: offerTemplate.name,
          description: offerTemplate.description,
          category: offerType === "product" ? "product" : "service",
          currency: input.currency ?? "TTD",
          price: offerTemplate.price,
          requiresBooking: offerType === "appointment",
          status: "draft",
        },
      ],
      pricingStyle: "fixed",
    },
    brand: {
      tone: "professional",
      stylePreset: DEFAULT_BLUEPRINT_STYLE,
      shortDescription: `${input.businessName} serves ${input.industry} customers with a premium first experience.`,
    },
    storefront: {
      slug: slugBase || "launchpad",
      headline: `${input.businessName} — Ready to launch`,
      subheadline: "Book, buy, or request your first service in minutes.",
      sections: [
        { key: "hero", enabled: true, order: 1 },
        { key: "featured_offers", enabled: true, order: 2 },
        { key: "trust", enabled: true, order: 3 },
        { key: "faq", enabled: true, order: 4 },
        { key: "closing_cta", enabled: true, order: 5 },
      ],
      defaultCta: "book_now",
    },
    paymentAndClosing: {
      enabledGateways: ["manual", "bank_transfer", "invoice"],
      acceptsManualPayment: true,
      acceptsBankTransfer: true,
      acceptsCash: true,
      requiresDeposit: false,
      closePathway: "invoice_first",
    },
    automationPlan: {
      recommendedPlaybooks: [],
      enabledPlaybooks: [],
    },
    activation: {
      onboardingCompleted: false,
      storefrontPublished: false,
      paymentPathConfigured: false,
      firstOfferCreated: false,
      firstShareCompleted: false,
      firstTransactionIntentCreated: false,
    },
  };
}

type OnboardingOfferInput = {
  name: string;
  description?: string;
  price?: number;
  currency: string;
  category: "service" | "product" | "package" | "consultation" | "deposit" | "quote";
  durationMins?: number;
  requiresBooking?: boolean;
  requiresDelivery?: boolean;
  requiresDeposit?: boolean;
  depositAmount?: number;
  status?: "draft" | "active";
};

type OnboardingSnapshotInput = {
  businessName: string;
  industry: string;
  businessType: BlueprintBusinessType;
  currency?: string;
  country?: string;
  timezone?: string;
  profile?: {
    idealCustomer?: string;
    painPoints?: string[];
    customerGoals?: string[];
    commonQuestions?: string[];
  };
  offers?: OnboardingOfferInput[];
  brand?: Partial<BusinessBlueprint["brand"]>;
  storefront?: Partial<BusinessBlueprint["storefront"]>;
  paymentAndClosing?: Partial<BusinessBlueprint["paymentAndClosing"]>;
};

function normalizeOfferType(offers: OnboardingOfferInput[], businessType: BlueprintBusinessType): BlueprintPrimaryOfferType {
  if (offers.length > 0) {
    const first = offers[0];
    if (first.category === "product") return "product";
    if (first.category === "package") return "package";
    if (first.category === "quote") return "quote";
    if (first.category === "deposit") return "deposit";
  }
  return offerTypeForBusinessType(businessType);
}

export function buildBlueprintFromOnboardingSnapshot(input: OnboardingSnapshotInput): BusinessBlueprint {
  const baseline = generateInitialBlueprint({
    businessName: input.businessName,
    industry: input.industry,
    businessType: input.businessType,
    currency: input.currency,
    country: input.country,
    timezone: input.timezone,
  });

  const offers =
    input.offers && input.offers.length > 0
      ? input.offers.map((offer) => ({
          ...offer,
          status: offer.status ?? "active",
        }))
      : baseline.offerModel.offers;

  const primaryOfferType = normalizeOfferType(offers, input.businessType);

  return {
    ...baseline,
    audience: {
      idealCustomer: input.profile?.idealCustomer,
      customerPainPoints: input.profile?.painPoints ?? [],
      customerGoals: input.profile?.customerGoals ?? [],
      commonQuestions: input.profile?.commonQuestions ?? [],
    },
    offerModel: {
      ...baseline.offerModel,
      primaryOfferType,
      offers,
    },
    brand: {
      ...baseline.brand,
      ...(input.brand ?? {}),
      stylePreset: input.brand?.stylePreset ?? baseline.brand.stylePreset,
      tone: input.brand?.tone ?? baseline.brand.tone,
    },
    storefront: {
      ...baseline.storefront,
      ...(input.storefront ?? {}),
      slug: input.storefront?.slug ?? baseline.storefront.slug,
      sections: input.storefront?.sections ?? baseline.storefront.sections,
    },
    paymentAndClosing: {
      ...baseline.paymentAndClosing,
      ...(input.paymentAndClosing ?? {}),
      enabledGateways: input.paymentAndClosing?.enabledGateways ?? baseline.paymentAndClosing.enabledGateways,
      closePathway: input.paymentAndClosing?.closePathway ?? baseline.paymentAndClosing.closePathway,
    },
  };
}
