import type {
  BlueprintStylePreset,
  BusinessBlueprint,
  BlueprintBusinessType,
  BlueprintClosePathway,
  BlueprintPrimaryOfferType,
  BlueprintPricingStyle,
} from "@/types/blueprint";

type SnapshotInput = {
  businessName: string;
  industry: string;
  businessType: BlueprintBusinessType;
  currency?: string;
  country?: string;
  location?: string;
  tone?: BusinessBlueprint["brand"]["tone"];
};

const DEFAULT_TRUST_SIGNALS: Record<BlueprintBusinessType, string[]> = {
  service: ["Trusted local service", "Fast response", "Flexible scheduling"],
  product: ["Secure checkout", "Fresh inventory", "Reliable support"],
  hybrid: ["Book or buy in one place", "Secure checkout", "Fast support"],
  consulting: ["Professional expertise", "Strategy-first approach", "Results-focused delivery"],
  clinic: ["Licensed professionals", "Personalized care", "Confidential service"],
  creative: ["Custom creative work", "Collaborative process", "Clear timelines"],
  wellness: ["Holistic approach", "Calm client experience", "Personalized recommendations"],
  food: ["Freshly prepared", "Local quality ingredients", "Flexible ordering"],
  retail: ["Quality curated products", "Secure payments", "Friendly support"],
  other: ["Trusted local business", "Responsive support", "Clear next steps"],
};

type OfferPreset = {
  name: string;
  category: "service" | "product" | "package" | "consultation" | "deposit" | "quote";
  offerType: BlueprintPrimaryOfferType;
  closePathway: BlueprintClosePathway;
  pricingStyle: BlueprintPricingStyle;
  price?: number;
  durationMins?: number;
  requiresBooking?: boolean;
  requiresDeposit?: boolean;
  depositPercent?: number;
};

const OFFER_PRESETS: Record<BlueprintBusinessType, OfferPreset> = {
  clinic: {
    name: "Initial Consultation",
    category: "consultation",
    offerType: "appointment",
    closePathway: "booking_first",
    pricingStyle: "fixed",
    price: 500,
    durationMins: 60,
    requiresBooking: true,
  },
  service: {
    name: "Signature Service",
    category: "service",
    offerType: "appointment",
    closePathway: "booking_first",
    pricingStyle: "fixed",
    price: 250,
    durationMins: 60,
    requiresBooking: true,
  },
  product: {
    name: "Featured Product",
    category: "product",
    offerType: "product",
    closePathway: "instant_checkout",
    pricingStyle: "fixed",
    price: 180,
  },
  hybrid: {
    name: "Starter Package",
    category: "package",
    offerType: "package",
    closePathway: "deposit_checkout",
    pricingStyle: "deposit_then_balance",
    price: 650,
    requiresDeposit: true,
    depositPercent: 30,
  },
  consulting: {
    name: "Discovery Session",
    category: "consultation",
    offerType: "quote",
    closePathway: "request_quote",
    pricingStyle: "quote_required",
  },
  creative: {
    name: "Creative Project Kickoff",
    category: "quote",
    offerType: "quote",
    closePathway: "request_quote",
    pricingStyle: "quote_required",
  },
  wellness: {
    name: "Wellness Session",
    category: "service",
    offerType: "appointment",
    closePathway: "booking_first",
    pricingStyle: "fixed",
    price: 300,
    durationMins: 60,
    requiresBooking: true,
  },
  food: {
    name: "Signature Order",
    category: "product",
    offerType: "product",
    closePathway: "instant_checkout",
    pricingStyle: "fixed",
    price: 180,
  },
  retail: {
    name: "Featured Collection Item",
    category: "product",
    offerType: "product",
    closePathway: "instant_checkout",
    pricingStyle: "fixed",
    price: 220,
  },
  other: {
    name: "Featured Offer",
    category: "service",
    offerType: "appointment",
    closePathway: "booking_first",
    pricingStyle: "fixed",
    price: 200,
    durationMins: 60,
    requiresBooking: true,
  },
};

const STYLE_PRESETS: Record<BlueprintBusinessType, BlueprintStylePreset> = {
  clinic: "clinical",
  service: "clean",
    product: "bold",
    hybrid: "clean",
    consulting: "clean",
  creative: "creative",
  wellness: "wellness",
    food: "local",
  retail: "bold",
  other: "clean",
};

export function buildBlueprintSeed(input: SnapshotInput): Pick<BusinessBlueprint, "businessIdentity" | "brand"> {
  const stylePreset = STYLE_PRESETS[input.businessType];

  return {
    businessIdentity: {
      businessName: input.businessName,
      industry: input.industry,
      businessType: input.businessType,
      currency: input.currency || "TTD",
      country: input.country,
      location: input.location,
    },
    brand: {
      tone: input.tone ?? "professional",
      stylePreset,
      trustSignals: DEFAULT_TRUST_SIGNALS[input.businessType],
    },
  };
}

export function getOfferPreset(type: BlueprintBusinessType): OfferPreset {
  return OFFER_PRESETS[type];
}

export const OFFER_DEFAULT_BY_BUSINESS_TYPE = {
  service: {
    name: OFFER_PRESETS.service.name,
    description: "Core service offer designed for quick conversion.",
    price: OFFER_PRESETS.service.price ?? 250,
  },
  product: {
    name: OFFER_PRESETS.product.name,
    description: "Featured product your customers can buy immediately.",
    price: OFFER_PRESETS.product.price ?? 180,
  },
  hybrid: {
    name: OFFER_PRESETS.hybrid.name,
    description: "Bundle that combines products and service delivery.",
    price: OFFER_PRESETS.hybrid.price ?? 650,
  },
  consulting: {
    name: OFFER_PRESETS.consulting.name,
    description: "Consulting entry point that leads to a scoped engagement.",
    price: OFFER_PRESETS.consulting.price ?? 300,
  },
  clinic: {
    name: OFFER_PRESETS.clinic.name,
    description: "Clinical first session for assessment and treatment planning.",
    price: OFFER_PRESETS.clinic.price ?? 500,
  },
  creative: {
    name: OFFER_PRESETS.creative.name,
    description: "Creative kickoff offer to scope and initiate delivery.",
    price: OFFER_PRESETS.creative.price ?? 400,
  },
  wellness: {
    name: OFFER_PRESETS.wellness.name,
    description: "Wellness-focused offer for immediate booking.",
    price: OFFER_PRESETS.wellness.price ?? 300,
  },
  food: {
    name: OFFER_PRESETS.food.name,
    description: "Signature order customers can place with confidence.",
    price: OFFER_PRESETS.food.price ?? 180,
  },
  retail: {
    name: OFFER_PRESETS.retail.name,
    description: "Top retail item highlighted for first-time shoppers.",
    price: OFFER_PRESETS.retail.price ?? 220,
  },
  other: {
    name: OFFER_PRESETS.other.name,
    description: "General purpose offer to activate your storefront fast.",
    price: OFFER_PRESETS.other.price ?? 200,
  },
} as const;

export const DEFAULT_BLUEPRINT_STYLE: BlueprintStylePreset = "clean";

