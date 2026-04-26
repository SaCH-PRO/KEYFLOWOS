export type BlueprintBusinessType =
  | "service"
  | "product"
  | "hybrid"
  | "consulting"
  | "clinic"
  | "creative"
  | "wellness"
  | "food"
  | "retail"
  | "other";

export type BlueprintPrimaryOfferType =
  | "appointment"
  | "product"
  | "package"
  | "quote"
  | "deposit"
  | "subscription"
  | "manual_close";

export type BlueprintPricingStyle =
  | "fixed"
  | "starting_at"
  | "quote_required"
  | "deposit_then_balance"
  | "free_consultation";

export type BlueprintBrandTone =
  | "premium"
  | "friendly"
  | "clinical"
  | "bold"
  | "minimal"
  | "luxury"
  | "warm"
  | "professional";

export type BlueprintStylePreset =
  | "clean"
  | "luxury"
  | "bold"
  | "wellness"
  | "clinical"
  | "creative"
  | "local";

export type BlueprintGatewayKey =
  | "wipay"
  | "paypal"
  | "google_pay"
  | "bank_transfer"
  | "cash"
  | "manual"
  | "payment_link"
  | "invoice";

export type BlueprintClosePathway =
  | "instant_checkout"
  | "deposit_checkout"
  | "request_quote"
  | "whatsapp_close"
  | "invoice_first"
  | "booking_first";

export type BlueprintOfferCategory =
  | "service"
  | "product"
  | "package"
  | "consultation"
  | "deposit"
  | "quote";

export type BlueprintOfferStatus = "draft" | "active";

export type BlueprintSectionKey =
  | "hero"
  | "featured_offers"
  | "booking"
  | "products"
  | "packages"
  | "testimonials"
  | "faq"
  | "contact"
  | "trust"
  | "closing_cta";

export type BlueprintDefaultCta =
  | "book_now"
  | "buy_now"
  | "request_quote"
  | "pay_deposit"
  | "message_us";

export interface BusinessBlueprintOffer {
  id?: string;
  name: string;
  description?: string;
  price?: number;
  currency: string;
  category: BlueprintOfferCategory;
  durationMins?: number;
  requiresBooking?: boolean;
  requiresDelivery?: boolean;
  requiresDeposit?: boolean;
  depositAmount?: number;
  imagePrompt?: string;
  status: BlueprintOfferStatus;
}

export interface BusinessBlueprintSectionConfig {
  key: BlueprintSectionKey;
  enabled: boolean;
  order: number;
}

export interface BusinessBlueprint {
  schemaVersion: "1.0";
  businessIdentity: {
    businessName: string;
    ownerName?: string;
    industry: string;
    subIndustry?: string;
    businessType: BlueprintBusinessType;
    location?: string;
    timezone?: string;
    currency: string;
    country?: string;
  };
  audience: {
    idealCustomer?: string;
    customerPainPoints?: string[];
    customerGoals?: string[];
    commonQuestions?: string[];
  };
  offerModel: {
    primaryOfferType: BlueprintPrimaryOfferType;
    offers: BusinessBlueprintOffer[];
    pricingStyle: BlueprintPricingStyle;
  };
  brand: {
    tone: BlueprintBrandTone;
    primaryColor?: string;
    secondaryColor?: string;
    stylePreset: BlueprintStylePreset;
    tagline?: string;
    shortDescription?: string;
    trustSignals?: string[];
  };
  storefront: {
    slug: string;
    headline: string;
    subheadline: string;
    sections: BusinessBlueprintSectionConfig[];
    defaultCta: BlueprintDefaultCta;
    socialLinks?: Record<string, string>;
    whatsapp?: string;
  };
  paymentAndClosing: {
    enabledGateways: BlueprintGatewayKey[];
    preferredGateway?: BlueprintGatewayKey;
    acceptsManualPayment: boolean;
    acceptsBankTransfer: boolean;
    acceptsCash: boolean;
    requiresDeposit: boolean;
    depositPercent?: number;
    closePathway: BlueprintClosePathway;
  };
  automationPlan: {
    recommendedPlaybooks: string[];
    enabledPlaybooks: string[];
  };
  activation: {
    onboardingCompleted: boolean;
    storefrontPublished: boolean;
    paymentPathConfigured: boolean;
    firstOfferCreated: boolean;
    firstShareCompleted: boolean;
    firstTransactionIntentCreated: boolean;
  };
}

export type BlueprintActivationProgress = {
  completed: number;
  total: number;
  percentage: number;
};
