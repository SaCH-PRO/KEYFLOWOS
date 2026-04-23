export type ThemeKey =
  | "default"
  | "minimal"
  | "bold"
  | "elegant"
  | "luxe"
  | "fresh"
  | "conversion_first"
  | "premium_services"
  | "luxury_editorial"
  | "booking_optimized"
  | "catalog_heavy"
  | "authority_brand"
  | "creator_expert"
  | "hybrid_storefront";

export interface StorefrontModel {
  key: ThemeKey;
  label: string;
  tagline: string;
  businessFit: string;
  visualTone: string;
  conversionEmphasis: string;
  bestFor: string[];
}

export const STOREFRONT_MODELS: StorefrontModel[] = [
  {
    key: "conversion_first",
    label: "Conversion First",
    tagline: "Built to turn browsers into buyers",
    businessFit: "E-commerce, retail, product-led businesses",
    visualTone: "Bold, high-contrast, action-driven",
    conversionEmphasis: "Prominent CTAs, urgency signals, price placement",
    bestFor: ["Online shops", "Product sellers", "High-volume retail"],
  },
  {
    key: "premium_services",
    label: "Premium Services",
    tagline: "Elevate perceived value, command higher prices",
    businessFit: "Consulting, coaching, high-end services",
    visualTone: "Confident, refined, spacious",
    conversionEmphasis: "Trust signals, outcome-focused language, expertise framing",
    bestFor: ["Consultants", "Coaches", "Professional services"],
  },
  {
    key: "luxury_editorial",
    label: "Luxury Editorial",
    tagline: "When brand prestige is the product",
    businessFit: "Luxury brands, exclusive services, high-ticket offers",
    visualTone: "Editorial, cinematic, intentionally minimal",
    conversionEmphasis: "Aspiration over urgency, exclusivity signals",
    bestFor: ["Luxury brands", "Premium spas", "Exclusive agencies"],
  },
  {
    key: "booking_optimized",
    label: "Booking Optimized",
    tagline: "Get appointments booked, reduce no-shows",
    businessFit: "Service businesses that live by the calendar",
    visualTone: "Clean, task-focused, frictionless",
    conversionEmphasis: "Booking flow prominence, availability cues, reassurance",
    bestFor: ["Salons", "Clinics", "Fitness studios", "Consultants"],
  },
  {
    key: "catalog_heavy",
    label: "Catalog Heavy",
    tagline: "Showcase a wide inventory with clarity",
    businessFit: "Businesses with large product or service catalogs",
    visualTone: "Organized, scannable, category-driven",
    conversionEmphasis: "Filter/search prominence, comparison-friendly layout",
    bestFor: ["Multi-category stores", "Wholesalers", "Large service menus"],
  },
  {
    key: "authority_brand",
    label: "Authority Brand",
    tagline: "Position as the definitive expert in your niche",
    businessFit: "Thought leaders, educators, established brands",
    visualTone: "Authoritative, structured, credential-forward",
    conversionEmphasis: "Social proof, credentials, media mentions, testimonials",
    bestFor: ["Industry experts", "Training providers", "Established agencies"],
  },
  {
    key: "creator_expert",
    label: "Creator / Expert Brand",
    tagline: "Personal brand meets professional store",
    businessFit: "Content creators, solo practitioners, personal brands",
    visualTone: "Warm, personal, community-driven",
    conversionEmphasis: "Story-driven, community signals, personal connection",
    bestFor: ["Solo entrepreneurs", "Content creators", "Personal trainers"],
  },
  {
    key: "hybrid_storefront",
    label: "Hybrid Storefront",
    tagline: "Products and services under one roof",
    businessFit: "Businesses that sell both products and book services",
    visualTone: "Balanced, versatile, dual-channel clarity",
    conversionEmphasis: "Clear product/service separation, dual CTAs",
    bestFor: ["Salons with retail", "Clinics with products", "Studios with merch"],
  },
];

export const LEGACY_MODELS: StorefrontModel[] = [
  {
    key: "default",
    label: "Classic",
    tagline: "Clean and professional",
    businessFit: "General purpose",
    visualTone: "Neutral, versatile",
    conversionEmphasis: "Balanced",
    bestFor: ["General business"],
  },
  {
    key: "minimal",
    label: "Minimal",
    tagline: "Content-first simplicity",
    businessFit: "Content-focused businesses",
    visualTone: "Zen, airy",
    conversionEmphasis: "Content over decoration",
    bestFor: ["Portfolios", "Studios"],
  },
  {
    key: "bold",
    label: "Bold",
    tagline: "High energy, high impact",
    businessFit: "Energetic brands",
    visualTone: "Dynamic, high-contrast",
    conversionEmphasis: "Visual impact",
    bestFor: ["Gyms", "Sports", "Events"],
  },
  {
    key: "elegant",
    label: "Elegant",
    tagline: "Refined editorial luxury",
    businessFit: "Upscale brands",
    visualTone: "Soft, editorial",
    conversionEmphasis: "Quality signals",
    bestFor: ["Fashion", "Beauty", "Wellness"],
  },
  {
    key: "luxe",
    label: "Luxe",
    tagline: "Cinematic prestige",
    businessFit: "Luxury brands",
    visualTone: "Dark, cinematic",
    conversionEmphasis: "Exclusivity",
    bestFor: ["Luxury", "Premium"],
  },
  {
    key: "fresh",
    label: "Fresh",
    tagline: "Friendly and modern",
    businessFit: "Consumer brands",
    visualTone: "Bright, playful",
    conversionEmphasis: "Approachability",
    bestFor: ["Beauty", "Food", "Lifestyle"],
  },
];

export const ALL_MODELS: StorefrontModel[] = [...STOREFRONT_MODELS, ...LEGACY_MODELS];

export function getModelByKey(key: ThemeKey): StorefrontModel | undefined {
  return ALL_MODELS.find((m) => m.key === key);
}

export interface HeroComposerConfig {
  headline?: string;
  subheadline?: string;
  primaryCtaLabel?: string;
  primaryCtaAction?: "scroll_catalog" | "open_booking" | "contact" | "custom";
  primaryCtaUrl?: string;
  secondaryCtaLabel?: string;
  secondaryCtaAction?: "scroll_catalog" | "open_booking" | "contact" | "custom";
  secondaryCtaUrl?: string;
  coverImageUrl?: string;
  coverVideoUrl?: string;
  promotionalRibbon?: string;
  promotionalRibbonColor?: string;
  proofChips?: Array<{ label: string; icon?: string }>;
  layout?: "centered" | "left_aligned" | "split";
  showOpenStatus?: boolean;
  showSocialLinks?: boolean;
}

export interface SectionStyleConfig {
  heroBg?: string;
  heroTextAlign?: "center" | "left";
  heroImageStyle?: "cover" | "contained" | "none";
  productRailColumns?: 2 | 3 | 4;
  productRailShowBadges?: boolean;
  faqStyle?: "accordion" | "cards";
  trustLayout?: "row" | "grid";
  trustShowCertifications?: boolean;
}

export interface BrandPalettePreset {
  id: string;
  name: string;
  personality: string;
  primary: string;
  secondary: string;
  accent: string;
}

export const BRAND_PALETTE_PRESETS: BrandPalettePreset[] = [
  { id: "slate-blue", name: "Executive", personality: "Professional, trustworthy", primary: "#1e40af", secondary: "#0f766e", accent: "#7c3aed" },
  { id: "rose-gold", name: "Luxe Rose", personality: "Elegant, feminine, premium", primary: "#be185d", secondary: "#92400e", accent: "#7c3aed" },
  { id: "emerald", name: "Fresh Green", personality: "Natural, healthy, organic", primary: "#065f46", secondary: "#0369a1", accent: "#d97706" },
  { id: "amber-orange", name: "Energy", personality: "Bold, energetic, action-driven", primary: "#c2410c", secondary: "#92400e", accent: "#4338ca" },
  { id: "violet", name: "Creative", personality: "Creative, innovative, modern", primary: "#6d28d9", secondary: "#0e7490", accent: "#d97706" },
  { id: "midnight", name: "Premium Dark", personality: "Sophisticated, exclusive, premium", primary: "#1e293b", secondary: "#334155", accent: "#f59e0b" },
  { id: "coral", name: "Warm & Welcoming", personality: "Friendly, approachable, warm", primary: "#e11d48", secondary: "#d97706", accent: "#0891b2" },
  { id: "teal-gold", name: "Coastal Luxury", personality: "Fresh, luxurious, coastal", primary: "#0f766e", secondary: "#b45309", accent: "#7c3aed" },
];

export function getAIPaletteForPersonality(personality: string): BrandPalettePreset[] {
  const lower = personality.toLowerCase();
  if (lower.includes("luxury") || lower.includes("premium") || lower.includes("exclusiv")) {
    return BRAND_PALETTE_PRESETS.filter((p) => ["rose-gold", "midnight", "teal-gold"].includes(p.id));
  }
  if (lower.includes("health") || lower.includes("wellness") || lower.includes("natural") || lower.includes("organic")) {
    return BRAND_PALETTE_PRESETS.filter((p) => ["emerald", "teal-gold"].includes(p.id));
  }
  if (lower.includes("creative") || lower.includes("art") || lower.includes("design")) {
    return BRAND_PALETTE_PRESETS.filter((p) => ["violet", "coral"].includes(p.id));
  }
  if (lower.includes("tech") || lower.includes("professional") || lower.includes("consulting")) {
    return BRAND_PALETTE_PRESETS.filter((p) => ["slate-blue", "midnight", "violet"].includes(p.id));
  }
  if (lower.includes("energy") || lower.includes("sport") || lower.includes("fitness")) {
    return BRAND_PALETTE_PRESETS.filter((p) => ["amber-orange", "coral"].includes(p.id));
  }
  return BRAND_PALETTE_PRESETS.slice(0, 3);
}

export function getContrastRatio(hex1: string, hex2: string): number {
  const luminance = (hex: string) => {
    const clean = hex.startsWith("#") ? hex.slice(1) : hex;
    if (clean.length !== 6) return 0.5;
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  };
  const l1 = luminance(hex1);
  const l2 = luminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getContrastGrade(ratio: number): { grade: "AAA" | "AA" | "AA Large" | "Fail"; pass: boolean; label: string } {
  if (ratio >= 7) return { grade: "AAA", pass: true, label: "Excellent contrast" };
  if (ratio >= 4.5) return { grade: "AA", pass: true, label: "Good contrast" };
  if (ratio >= 3) return { grade: "AA Large", pass: true, label: "Acceptable for large text" };
  return { grade: "Fail", pass: false, label: "Poor contrast — may be hard to read" };
}

export function hexAlpha(hex: string, opacityHex: string): string {
  const clean = hex.startsWith("#") ? hex : `#${hex}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(clean)) {
    return "transparent";
  }
  return `${clean}${opacityHex}`;
}

const SF_BG_WHITE = "hsl(0 0% 100%)";
const SF_BG_NEAR_WHITE = "hsl(0 0% 98%)";
const SF_BG_SUBTLE = "hsl(210 20% 98%)";
const SF_BG_WARM = "hsl(60 9% 98%)";
const SF_BORDER_LIGHT = "hsl(214 32% 91%)";
const SF_INPUT_BG = "hsl(220 14% 96%)";
const SF_INPUT_BORDER = "hsl(214 32% 91%)";

export interface ThemeStyles {
  pageBg: string;
  pageGradient: string;
  cardBg: string;
  cardBgHover: string;
  cardBorder: string;
  cardBorderHover: string;
  cardRadius: string;
  headerWeight: string;
  bodyWeight: string;
  textStyle: string;
  fontClass: string;
  heroGlow: boolean;
  heroGlowIntensity: number;
  heroOverlay: string;
  badgeRadius: string;
  imageHeight: string;
  imageHeightSm: string;
  accentOpacity: string;
  buttonRadius: string;
  buttonStyle: "filled" | "outline" | "ghost" | "pill";
  searchRadius: string;
  tabStyle: "pill" | "underline" | "chip" | "block";
  spacing: "tight" | "normal" | "relaxed";
  cardShadow: string;
  cardHoverTransform: string;
  sectionDivider: string;
  priceWeight: string;
  nameSize: string;
  nameSizeSm: string;
  descSize: string;
  footerStyle: string;
  serviceBg: string;
  productBg: string;
  packageBg: string;
  serviceAccent: string;
  productAccent: string;
  packageAccent: string;
  heroBg: string;
  heroAccentBar: string;
  searchBg: string;
  searchBorder: string;
  ctaBg: string;
  ctaText: string;
  ctaBorder: string;
  footerAccent: string;
  heroLayout: "centered" | "left_aligned" | "split";
  heroCtaSize: "sm" | "md" | "lg";
  sectionSequence: string[];
  trustStyle: "minimal" | "prominent" | "badge_row";
  commercialMode: "conversion" | "authority" | "luxury" | "utility" | "editorial" | "catalog" | "hybrid";
  ctaStrategy: "urgency" | "value" | "exclusivity" | "convenience" | "trust";
  heroHeadlineScale: "compact" | "standard" | "dramatic";
  cardDensity: "dense" | "balanced" | "spacious";
  socialProofWeight: "subtle" | "moderate" | "prominent";
}

export function getThemeStyles(theme: ThemeKey, primaryColor: string, secondaryColor: string, accentColor: string): ThemeStyles {
  switch (theme) {

    case "conversion_first":
      return {
        pageBg: SF_BG_WHITE,
        pageGradient: `linear-gradient(160deg, ${hexAlpha(primaryColor, "06")}, transparent 40%), linear-gradient(340deg, ${hexAlpha(secondaryColor, "04")}, transparent 40%)`,
        cardBg: SF_BG_WHITE,
        cardBgHover: hexAlpha(primaryColor, "06"),
        cardBorder: `1px solid ${SF_BORDER_LIGHT}`,
        cardBorderHover: `1px solid ${hexAlpha(primaryColor, "40")}`,
        cardRadius: "rounded-2xl",
        headerWeight: "font-extrabold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: true,
        heroGlowIntensity: 0.08,
        heroOverlay: `linear-gradient(160deg, ${hexAlpha(primaryColor, "12")}, transparent 50%)`,
        badgeRadius: "rounded-full",
        imageHeight: "h-48",
        imageHeightSm: "h-22",
        accentOpacity: "15",
        buttonRadius: "rounded-xl",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "pill",
        spacing: "normal",
        cardShadow: `0 2px 8px rgba(0,0,0,0.08)`,
        cardHoverTransform: "hover:-translate-y-1",
        sectionDivider: `1px solid ${SF_BORDER_LIGHT}`,
        priceWeight: "font-extrabold",
        nameSize: "text-base",
        nameSizeSm: "text-[11px]",
        descSize: "text-sm",
        footerStyle: "font-semibold",
        serviceBg: `linear-gradient(135deg, ${hexAlpha(primaryColor, "10")}, ${hexAlpha(primaryColor, "04")})`,
        productBg: `linear-gradient(135deg, ${hexAlpha(secondaryColor, "10")}, ${hexAlpha(secondaryColor, "04")})`,
        packageBg: `linear-gradient(135deg, ${hexAlpha(accentColor, "10")}, ${hexAlpha(accentColor, "04")})`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(160deg, ${hexAlpha(primaryColor, "12")}, transparent 60%, ${hexAlpha(secondaryColor, "06")})`,
        heroAccentBar: `linear-gradient(to right, ${hexAlpha(primaryColor, "40")}, ${hexAlpha(secondaryColor, "20")}, transparent)`,
        searchBg: SF_INPUT_BG,
        searchBorder: SF_INPUT_BORDER,
        ctaBg: primaryColor,
        ctaText: "white",
        ctaBorder: "none",
        footerAccent: primaryColor,
        heroLayout: "left_aligned",
        heroCtaSize: "lg",
        sectionSequence: ["hero", "trust", "featured", "catalog", "testimonials", "faq", "contact"],
        trustStyle: "badge_row",
        commercialMode: "conversion",
        ctaStrategy: "urgency",
        heroHeadlineScale: "dramatic",
        cardDensity: "dense",
        socialProofWeight: "prominent",
      };

    case "premium_services":
      return {
        pageBg: SF_BG_NEAR_WHITE,
        pageGradient: `radial-gradient(ellipse at 50% 0%, ${hexAlpha(primaryColor, "06")}, transparent 55%)`,
        cardBg: SF_BG_WHITE,
        cardBgHover: hexAlpha(primaryColor, "04"),
        cardBorder: `1px solid ${SF_BORDER_LIGHT}`,
        cardBorderHover: `1px solid ${hexAlpha(primaryColor, "25")}`,
        cardRadius: "rounded-2xl",
        headerWeight: "font-bold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: false,
        heroGlowIntensity: 0.03,
        heroOverlay: `radial-gradient(ellipse at 50% 0%, ${hexAlpha(primaryColor, "08")}, transparent 60%)`,
        badgeRadius: "rounded-full",
        imageHeight: "h-52",
        imageHeightSm: "h-22",
        accentOpacity: "10",
        buttonRadius: "rounded-xl",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "underline",
        spacing: "relaxed",
        cardShadow: `0 2px 12px rgba(0,0,0,0.06)`,
        cardHoverTransform: "hover:-translate-y-0.5",
        sectionDivider: `1px solid ${SF_BORDER_LIGHT}`,
        priceWeight: "font-bold",
        nameSize: "text-base",
        nameSizeSm: "text-[11px]",
        descSize: "text-sm",
        footerStyle: "font-medium",
        serviceBg: `linear-gradient(135deg, ${hexAlpha(primaryColor, "08")}, ${hexAlpha(primaryColor, "03")})`,
        productBg: `linear-gradient(135deg, ${hexAlpha(secondaryColor, "08")}, ${hexAlpha(secondaryColor, "03")})`,
        packageBg: `linear-gradient(135deg, ${hexAlpha(accentColor, "08")}, ${hexAlpha(accentColor, "03")})`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `radial-gradient(ellipse at 50% 0%, ${hexAlpha(primaryColor, "08")}, transparent 60%)`,
        heroAccentBar: `linear-gradient(to right, transparent, ${hexAlpha(primaryColor, "15")}, ${hexAlpha(secondaryColor, "10")}, transparent)`,
        searchBg: SF_INPUT_BG,
        searchBorder: SF_INPUT_BORDER,
        ctaBg: primaryColor,
        ctaText: "white",
        ctaBorder: "none",
        footerAccent: primaryColor,
        heroLayout: "centered",
        heroCtaSize: "md",
        sectionSequence: ["hero", "trust", "featured", "categories", "catalog", "testimonials", "faq", "contact"],
        trustStyle: "prominent",
        commercialMode: "authority",
        ctaStrategy: "value",
        heroHeadlineScale: "standard",
        cardDensity: "spacious",
        socialProofWeight: "moderate",
      };

    case "luxury_editorial":
      return {
        pageBg: SF_BG_WARM,
        pageGradient: `linear-gradient(180deg, ${hexAlpha(primaryColor, "03")}, transparent 30%), linear-gradient(0deg, ${hexAlpha(secondaryColor, "03")}, transparent 30%)`,
        cardBg: SF_BG_WHITE,
        cardBgHover: hexAlpha(primaryColor, "04"),
        cardBorder: `1px solid ${hexAlpha(secondaryColor, "10")}`,
        cardBorderHover: `1px solid ${hexAlpha(secondaryColor, "20")}`,
        cardRadius: "rounded-none",
        headerWeight: "font-extralight",
        bodyWeight: "font-extralight",
        textStyle: "tracking-[0.2em] uppercase",
        fontClass: "font-serif",
        heroGlow: false,
        heroGlowIntensity: 0,
        heroOverlay: `linear-gradient(180deg, ${hexAlpha(primaryColor, "06")}, transparent 40%, ${hexAlpha(secondaryColor, "04")})`,
        badgeRadius: "rounded-none",
        imageHeight: "h-60",
        imageHeightSm: "h-24",
        accentOpacity: "08",
        buttonRadius: "rounded-none",
        buttonStyle: "outline",
        searchRadius: "rounded-none",
        tabStyle: "underline",
        spacing: "relaxed",
        cardShadow: "0 1px 3px rgba(0,0,0,0.05)",
        cardHoverTransform: "hover:opacity-80",
        sectionDivider: `1px solid ${hexAlpha(secondaryColor, "08")}`,
        priceWeight: "font-extralight",
        nameSize: "text-base",
        nameSizeSm: "text-xs",
        descSize: "text-sm",
        footerStyle: "font-serif tracking-[0.25em] uppercase text-[9px] font-extralight",
        serviceBg: `linear-gradient(180deg, ${hexAlpha(primaryColor, "06")}, transparent)`,
        productBg: `linear-gradient(180deg, ${hexAlpha(secondaryColor, "06")}, transparent)`,
        packageBg: `linear-gradient(180deg, ${hexAlpha(accentColor, "06")}, transparent)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(180deg, ${hexAlpha(primaryColor, "06")}, transparent 40%, ${hexAlpha(secondaryColor, "04")})`,
        heroAccentBar: `linear-gradient(to right, transparent, ${hexAlpha(secondaryColor, "0A")}, transparent)`,
        searchBg: SF_INPUT_BG,
        searchBorder: hexAlpha(secondaryColor, "0A"),
        ctaBg: "transparent",
        ctaText: primaryColor,
        ctaBorder: `1px solid ${hexAlpha(primaryColor, "25")}`,
        footerAccent: hexAlpha(secondaryColor, "50"),
        heroLayout: "centered",
        heroCtaSize: "sm",
        sectionSequence: ["hero", "featured", "catalog", "testimonials", "faq", "contact"],
        trustStyle: "minimal",
        commercialMode: "luxury",
        ctaStrategy: "exclusivity",
        heroHeadlineScale: "dramatic",
        cardDensity: "spacious",
        socialProofWeight: "subtle",
      };

    case "booking_optimized":
      return {
        pageBg: SF_BG_WHITE,
        pageGradient: `radial-gradient(ellipse at 50% 0%, ${hexAlpha(primaryColor, "07")}, transparent 50%)`,
        cardBg: SF_BG_WHITE,
        cardBgHover: hexAlpha(primaryColor, "05"),
        cardBorder: `1px solid ${SF_BORDER_LIGHT}`,
        cardBorderHover: `1px solid ${hexAlpha(primaryColor, "35")}`,
        cardRadius: "rounded-2xl",
        headerWeight: "font-semibold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: false,
        heroGlowIntensity: 0.04,
        heroOverlay: `radial-gradient(ellipse at 50% 0%, ${hexAlpha(primaryColor, "10")}, transparent 65%)`,
        badgeRadius: "rounded-lg",
        imageHeight: "h-44",
        imageHeightSm: "h-20",
        accentOpacity: "10",
        buttonRadius: "rounded-xl",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "chip",
        spacing: "normal",
        cardShadow: `0 2px 8px rgba(0,0,0,0.06)`,
        cardHoverTransform: "hover:-translate-y-0.5",
        sectionDivider: `1px solid ${SF_BORDER_LIGHT}`,
        priceWeight: "font-semibold",
        nameSize: "text-sm",
        nameSizeSm: "text-[11px]",
        descSize: "text-xs",
        footerStyle: "font-medium",
        serviceBg: `linear-gradient(135deg, ${hexAlpha(primaryColor, "0C")}, ${hexAlpha(primaryColor, "04")})`,
        productBg: `linear-gradient(135deg, ${hexAlpha(secondaryColor, "0C")}, ${hexAlpha(secondaryColor, "04")})`,
        packageBg: `linear-gradient(135deg, ${hexAlpha(accentColor, "0C")}, ${hexAlpha(accentColor, "04")})`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `radial-gradient(ellipse at 50% 0%, ${hexAlpha(primaryColor, "10")}, transparent 65%)`,
        heroAccentBar: `linear-gradient(to right, transparent, ${hexAlpha(primaryColor, "12")}, ${hexAlpha(secondaryColor, "08")}, transparent)`,
        searchBg: SF_INPUT_BG,
        searchBorder: SF_INPUT_BORDER,
        ctaBg: primaryColor,
        ctaText: "white",
        ctaBorder: "none",
        footerAccent: primaryColor,
        heroLayout: "centered",
        heroCtaSize: "lg",
        sectionSequence: ["hero", "trust", "categories", "catalog", "faq", "contact"],
        trustStyle: "badge_row",
        commercialMode: "utility",
        ctaStrategy: "convenience",
        heroHeadlineScale: "compact",
        cardDensity: "balanced",
        socialProofWeight: "moderate",
      };

    case "catalog_heavy":
      return {
        pageBg: SF_BG_SUBTLE,
        pageGradient: `linear-gradient(160deg, ${hexAlpha(primaryColor, "05")}, transparent 35%), linear-gradient(340deg, ${hexAlpha(secondaryColor, "04")}, transparent 35%)`,
        cardBg: SF_BG_WHITE,
        cardBgHover: hexAlpha(primaryColor, "06"),
        cardBorder: `1px solid ${SF_BORDER_LIGHT}`,
        cardBorderHover: `1px solid ${hexAlpha(primaryColor, "30")}`,
        cardRadius: "rounded-xl",
        headerWeight: "font-semibold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: false,
        heroGlowIntensity: 0.02,
        heroOverlay: `linear-gradient(160deg, ${hexAlpha(primaryColor, "08")}, transparent 50%)`,
        badgeRadius: "rounded-lg",
        imageHeight: "h-40",
        imageHeightSm: "h-18",
        accentOpacity: "10",
        buttonRadius: "rounded-lg",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "block",
        spacing: "tight",
        cardShadow: `0 1px 4px rgba(0,0,0,0.06)`,
        cardHoverTransform: "hover:shadow-md",
        sectionDivider: `1px solid ${SF_BORDER_LIGHT}`,
        priceWeight: "font-bold",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "font-medium",
        serviceBg: `linear-gradient(135deg, ${hexAlpha(primaryColor, "08")}, ${hexAlpha(primaryColor, "03")})`,
        productBg: `linear-gradient(135deg, ${hexAlpha(secondaryColor, "08")}, ${hexAlpha(secondaryColor, "03")})`,
        packageBg: `linear-gradient(135deg, ${hexAlpha(accentColor, "08")}, ${hexAlpha(accentColor, "03")})`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(160deg, ${hexAlpha(primaryColor, "08")}, transparent 60%)`,
        heroAccentBar: `linear-gradient(to right, ${hexAlpha(primaryColor, "20")}, ${hexAlpha(secondaryColor, "12")}, transparent)`,
        searchBg: SF_BG_WHITE,
        searchBorder: SF_BORDER_LIGHT,
        ctaBg: primaryColor,
        ctaText: "white",
        ctaBorder: "none",
        footerAccent: primaryColor,
        heroLayout: "left_aligned",
        heroCtaSize: "md",
        sectionSequence: ["hero", "categories", "featured", "catalog", "testimonials", "contact"],
        trustStyle: "minimal",
        commercialMode: "catalog",
        ctaStrategy: "convenience",
        heroHeadlineScale: "compact",
        cardDensity: "dense",
        socialProofWeight: "subtle",
      };

    case "authority_brand":
      return {
        pageBg: SF_BG_NEAR_WHITE,
        pageGradient: `radial-gradient(ellipse at 30% 0%, ${hexAlpha(primaryColor, "06")}, transparent 50%), radial-gradient(ellipse at 70% 100%, ${hexAlpha(secondaryColor, "04")}, transparent 40%)`,
        cardBg: SF_BG_WHITE,
        cardBgHover: hexAlpha(primaryColor, "04"),
        cardBorder: `1px solid ${SF_BORDER_LIGHT}`,
        cardBorderHover: `1px solid ${hexAlpha(primaryColor, "25")}`,
        cardRadius: "rounded-2xl",
        headerWeight: "font-bold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: false,
        heroGlowIntensity: 0.03,
        heroOverlay: `radial-gradient(ellipse at 30% 0%, ${hexAlpha(primaryColor, "08")}, transparent 60%)`,
        badgeRadius: "rounded-lg",
        imageHeight: "h-44",
        imageHeightSm: "h-20",
        accentOpacity: "10",
        buttonRadius: "rounded-xl",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "underline",
        spacing: "relaxed",
        cardShadow: `0 2px 10px rgba(0,0,0,0.06)`,
        cardHoverTransform: "hover:-translate-y-0.5",
        sectionDivider: `1px solid ${SF_BORDER_LIGHT}`,
        priceWeight: "font-bold",
        nameSize: "text-base",
        nameSizeSm: "text-[11px]",
        descSize: "text-sm",
        footerStyle: "font-medium tracking-wide",
        serviceBg: `linear-gradient(135deg, ${hexAlpha(primaryColor, "08")}, ${hexAlpha(primaryColor, "03")})`,
        productBg: `linear-gradient(135deg, ${hexAlpha(secondaryColor, "08")}, ${hexAlpha(secondaryColor, "03")})`,
        packageBg: `linear-gradient(135deg, ${hexAlpha(accentColor, "08")}, ${hexAlpha(accentColor, "03")})`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `radial-gradient(ellipse at 30% 0%, ${hexAlpha(primaryColor, "08")}, transparent 60%)`,
        heroAccentBar: `linear-gradient(to right, ${hexAlpha(primaryColor, "20")}, transparent, ${hexAlpha(secondaryColor, "12")})`,
        searchBg: SF_INPUT_BG,
        searchBorder: SF_INPUT_BORDER,
        ctaBg: primaryColor,
        ctaText: "white",
        ctaBorder: "none",
        footerAccent: primaryColor,
        heroLayout: "left_aligned",
        heroCtaSize: "md",
        sectionSequence: ["hero", "trust", "featured", "catalog", "testimonials", "faq", "contact"],
        trustStyle: "prominent",
        commercialMode: "authority",
        ctaStrategy: "trust",
        heroHeadlineScale: "standard",
        cardDensity: "balanced",
        socialProofWeight: "prominent",
      };

    case "creator_expert":
      return {
        pageBg: SF_BG_WHITE,
        pageGradient: `radial-gradient(ellipse at 20% 20%, ${hexAlpha(primaryColor, "08")}, transparent 40%), radial-gradient(ellipse at 80% 60%, ${hexAlpha(secondaryColor, "06")}, transparent 40%)`,
        cardBg: SF_BG_WHITE,
        cardBgHover: hexAlpha(primaryColor, "06"),
        cardBorder: `1px solid ${hexAlpha(primaryColor, "0C")}`,
        cardBorderHover: `1px solid ${hexAlpha(primaryColor, "25")}`,
        cardRadius: "rounded-3xl",
        headerWeight: "font-bold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: true,
        heroGlowIntensity: 0.05,
        heroOverlay: `linear-gradient(135deg, ${hexAlpha(primaryColor, "0A")}, ${hexAlpha(secondaryColor, "07")}, ${hexAlpha(accentColor, "05")})`,
        badgeRadius: "rounded-2xl",
        imageHeight: "h-44",
        imageHeightSm: "h-20",
        accentOpacity: "12",
        buttonRadius: "rounded-full",
        buttonStyle: "filled",
        searchRadius: "rounded-full",
        tabStyle: "chip",
        spacing: "normal",
        cardShadow: `0 2px 12px ${hexAlpha(primaryColor, "08")}, 0 1px 3px rgba(0,0,0,0.04)`,
        cardHoverTransform: "hover:scale-[1.02] hover:-translate-y-1",
        sectionDivider: `1px solid ${hexAlpha(primaryColor, "06")}`,
        priceWeight: "font-bold",
        nameSize: "text-sm",
        nameSizeSm: "text-[11px]",
        descSize: "text-xs",
        footerStyle: "font-semibold text-[11px]",
        serviceBg: `linear-gradient(135deg, ${hexAlpha(primaryColor, "0C")}, ${hexAlpha(primaryColor, "05")})`,
        productBg: `linear-gradient(135deg, ${hexAlpha(secondaryColor, "0C")}, ${hexAlpha(secondaryColor, "05")})`,
        packageBg: `linear-gradient(135deg, ${hexAlpha(accentColor, "0C")}, ${hexAlpha(accentColor, "05")})`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(135deg, ${hexAlpha(primaryColor, "0C")}, ${hexAlpha(secondaryColor, "08")}, ${hexAlpha(accentColor, "05")})`,
        heroAccentBar: `linear-gradient(to right, ${hexAlpha(primaryColor, "18")}, ${hexAlpha(secondaryColor, "12")}, ${hexAlpha(accentColor, "0C")})`,
        searchBg: hexAlpha(primaryColor, "05"),
        searchBorder: hexAlpha(primaryColor, "0C"),
        ctaBg: primaryColor,
        ctaText: "white",
        ctaBorder: "none",
        footerAccent: primaryColor,
        heroLayout: "centered",
        heroCtaSize: "md",
        sectionSequence: ["hero", "featured", "categories", "catalog", "testimonials", "faq", "contact"],
        trustStyle: "badge_row",
        commercialMode: "editorial",
        ctaStrategy: "value",
        heroHeadlineScale: "standard",
        cardDensity: "balanced",
        socialProofWeight: "moderate",
      };

    case "hybrid_storefront":
      return {
        pageBg: SF_BG_WHITE,
        pageGradient: `radial-gradient(ellipse at 50% 0%, ${hexAlpha(primaryColor, "07")}, transparent 50%), radial-gradient(ellipse at 80% 100%, ${hexAlpha(secondaryColor, "05")}, transparent 40%)`,
        cardBg: SF_BG_WHITE,
        cardBgHover: hexAlpha(primaryColor, "05"),
        cardBorder: `1px solid ${SF_BORDER_LIGHT}`,
        cardBorderHover: `1px solid ${hexAlpha(primaryColor, "28")}`,
        cardRadius: "rounded-2xl",
        headerWeight: "font-bold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: false,
        heroGlowIntensity: 0.04,
        heroOverlay: `radial-gradient(ellipse at 50% 0%, ${hexAlpha(primaryColor, "10")}, transparent 65%)`,
        badgeRadius: "rounded-full",
        imageHeight: "h-44",
        imageHeightSm: "h-20",
        accentOpacity: "12",
        buttonRadius: "rounded-xl",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "block",
        spacing: "normal",
        cardShadow: `0 1px 6px rgba(0,0,0,0.06)`,
        cardHoverTransform: "hover:-translate-y-0.5",
        sectionDivider: `1px solid ${SF_BORDER_LIGHT}`,
        priceWeight: "font-bold",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "font-semibold",
        serviceBg: `linear-gradient(135deg, ${hexAlpha(primaryColor, "0C")}, ${hexAlpha(primaryColor, "04")})`,
        productBg: `linear-gradient(135deg, ${hexAlpha(secondaryColor, "0C")}, ${hexAlpha(secondaryColor, "04")})`,
        packageBg: `linear-gradient(135deg, ${hexAlpha(accentColor, "0C")}, ${hexAlpha(accentColor, "04")})`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `radial-gradient(ellipse at 50% 0%, ${hexAlpha(primaryColor, "10")}, transparent 65%)`,
        heroAccentBar: `linear-gradient(to right, transparent, ${hexAlpha(primaryColor, "15")}, ${hexAlpha(secondaryColor, "10")}, transparent)`,
        searchBg: SF_INPUT_BG,
        searchBorder: SF_INPUT_BORDER,
        ctaBg: primaryColor,
        ctaText: "white",
        ctaBorder: "none",
        footerAccent: primaryColor,
        heroLayout: "centered",
        heroCtaSize: "md",
        sectionSequence: ["hero", "trust", "featured", "categories", "catalog", "testimonials", "faq", "contact"],
        trustStyle: "badge_row",
        commercialMode: "hybrid",
        ctaStrategy: "value",
        heroHeadlineScale: "standard",
        cardDensity: "balanced",
        socialProofWeight: "moderate",
      };

    case "minimal":
      return {
        pageBg: SF_BG_NEAR_WHITE,
        pageGradient: `radial-gradient(ellipse at 50% 0%, ${hexAlpha(primaryColor, "06")}, transparent 50%), radial-gradient(ellipse at 100% 100%, ${hexAlpha(secondaryColor, "04")}, transparent 40%)`,
        cardBg: SF_BG_WHITE,
        cardBgHover: hexAlpha(primaryColor, "06"),
        cardBorder: `1px solid ${SF_BORDER_LIGHT}`,
        cardBorderHover: `1px solid ${hexAlpha(primaryColor, "30")}`,
        cardRadius: "rounded-lg",
        headerWeight: "font-normal",
        bodyWeight: "font-light",
        textStyle: "tracking-wide",
        fontClass: "",
        heroGlow: false,
        heroGlowIntensity: 0,
        heroOverlay: "none",
        badgeRadius: "rounded",
        imageHeight: "h-44",
        imageHeightSm: "h-20",
        accentOpacity: "10",
        buttonRadius: "rounded",
        buttonStyle: "ghost",
        searchRadius: "rounded-md",
        tabStyle: "underline",
        spacing: "relaxed",
        cardShadow: "0 1px 3px rgba(0,0,0,0.06)",
        cardHoverTransform: "hover:opacity-90",
        sectionDivider: `1px solid ${SF_BORDER_LIGHT}`,
        priceWeight: "font-light",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "tracking-[0.2em] uppercase text-[9px] font-light",
        serviceBg: `linear-gradient(135deg, ${hexAlpha(primaryColor, "08")}, ${hexAlpha(primaryColor, "03")})`,
        productBg: `linear-gradient(135deg, ${hexAlpha(secondaryColor, "08")}, ${hexAlpha(secondaryColor, "03")})`,
        packageBg: `linear-gradient(135deg, ${hexAlpha(accentColor, "08")}, ${hexAlpha(accentColor, "03")})`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `radial-gradient(ellipse at 50% 0%, ${hexAlpha(primaryColor, "08")}, transparent 60%)`,
        heroAccentBar: `linear-gradient(to right, transparent, ${hexAlpha(primaryColor, "10")}, ${hexAlpha(secondaryColor, "08")}, transparent)`,
        searchBg: SF_INPUT_BG,
        searchBorder: SF_INPUT_BORDER,
        ctaBg: "transparent",
        ctaText: primaryColor,
        ctaBorder: `1px solid ${hexAlpha(primaryColor, "35")}`,
        footerAccent: hexAlpha(primaryColor, "70"),
        heroLayout: "centered",
        heroCtaSize: "sm",
        sectionSequence: ["hero", "catalog", "contact"],
        trustStyle: "minimal",
        commercialMode: "utility",
        ctaStrategy: "convenience",
        heroHeadlineScale: "compact",
        cardDensity: "balanced",
        socialProofWeight: "subtle",
      };

    case "bold":
      return {
        pageBg: SF_BG_SUBTLE,
        pageGradient: `linear-gradient(160deg, ${hexAlpha(primaryColor, "08")}, transparent 40%), linear-gradient(340deg, ${hexAlpha(secondaryColor, "06")}, transparent 40%), radial-gradient(ellipse at 50% 80%, ${hexAlpha(accentColor, "05")}, transparent 50%)`,
        cardBg: SF_BG_WHITE,
        cardBgHover: hexAlpha(primaryColor, "08"),
        cardBorder: `2px solid ${hexAlpha(primaryColor, "18")}`,
        cardBorderHover: `2px solid ${hexAlpha(primaryColor, "50")}`,
        cardRadius: "rounded-2xl",
        headerWeight: "font-black",
        bodyWeight: "font-medium",
        textStyle: "uppercase tracking-wider",
        fontClass: "",
        heroGlow: true,
        heroGlowIntensity: 0.1,
        heroOverlay: `linear-gradient(160deg, ${hexAlpha(primaryColor, "15")}, ${hexAlpha(secondaryColor, "0A")} 50%, ${hexAlpha(accentColor, "08")})`,
        badgeRadius: "rounded-xl",
        imageHeight: "h-48",
        imageHeightSm: "h-24",
        accentOpacity: "20",
        buttonRadius: "rounded-xl",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "block",
        spacing: "normal",
        cardShadow: `0 4px 16px ${hexAlpha(primaryColor, "12")}`,
        cardHoverTransform: "hover:scale-[1.03] hover:-translate-y-1.5",
        sectionDivider: `2px solid ${hexAlpha(primaryColor, "12")}`,
        priceWeight: "font-black",
        nameSize: "text-base",
        nameSizeSm: "text-[11px]",
        descSize: "text-sm",
        footerStyle: "font-black uppercase tracking-[0.15em]",
        serviceBg: `linear-gradient(135deg, ${hexAlpha(primaryColor, "12")}, ${hexAlpha(primaryColor, "06")})`,
        productBg: `linear-gradient(135deg, ${hexAlpha(secondaryColor, "12")}, ${hexAlpha(secondaryColor, "06")})`,
        packageBg: `linear-gradient(135deg, ${hexAlpha(accentColor, "12")}, ${hexAlpha(accentColor, "06")})`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(160deg, ${hexAlpha(primaryColor, "15")}, ${hexAlpha(secondaryColor, "0A")} 50%, ${hexAlpha(accentColor, "08")})`,
        heroAccentBar: `linear-gradient(to right, ${hexAlpha(primaryColor, "30")}, ${hexAlpha(secondaryColor, "20")}, ${hexAlpha(accentColor, "15")})`,
        searchBg: hexAlpha(primaryColor, "06"),
        searchBorder: hexAlpha(primaryColor, "18"),
        ctaBg: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
        ctaText: "white",
        ctaBorder: "none",
        footerAccent: primaryColor,
        heroLayout: "centered",
        heroCtaSize: "lg",
        sectionSequence: ["hero", "trust", "featured", "catalog", "testimonials", "contact"],
        trustStyle: "badge_row",
        commercialMode: "conversion",
        ctaStrategy: "urgency",
        heroHeadlineScale: "dramatic",
        cardDensity: "dense",
        socialProofWeight: "prominent",
      };

    case "elegant":
      return {
        pageBg: SF_BG_WARM,
        pageGradient: `radial-gradient(ellipse at 30% 0%, ${hexAlpha(primaryColor, "06")}, transparent 45%), radial-gradient(ellipse at 70% 100%, ${hexAlpha(secondaryColor, "05")}, transparent 40%)`,
        cardBg: SF_BG_WHITE,
        cardBgHover: hexAlpha(secondaryColor, "06"),
        cardBorder: `1px solid ${hexAlpha(secondaryColor, "12")}`,
        cardBorderHover: `1px solid ${hexAlpha(secondaryColor, "25")}`,
        cardRadius: "rounded-3xl",
        headerWeight: "font-normal",
        bodyWeight: "font-light",
        textStyle: "italic",
        fontClass: "font-serif",
        heroGlow: false,
        heroGlowIntensity: 0.02,
        heroOverlay: `linear-gradient(180deg, ${hexAlpha(primaryColor, "08")}, transparent 40%, ${hexAlpha(secondaryColor, "05")})`,
        badgeRadius: "rounded-full",
        imageHeight: "h-48",
        imageHeightSm: "h-20",
        accentOpacity: "12",
        buttonRadius: "rounded-full",
        buttonStyle: "pill",
        searchRadius: "rounded-full",
        tabStyle: "chip",
        spacing: "relaxed",
        cardShadow: `0 2px 12px ${hexAlpha(primaryColor, "08")}`,
        cardHoverTransform: "hover:-translate-y-0.5",
        sectionDivider: `1px solid ${hexAlpha(secondaryColor, "0A")}`,
        priceWeight: "font-normal",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "font-serif italic tracking-wide text-[11px]",
        serviceBg: `linear-gradient(180deg, ${hexAlpha(primaryColor, "0A")}, transparent)`,
        productBg: `linear-gradient(180deg, ${hexAlpha(secondaryColor, "0A")}, transparent)`,
        packageBg: `linear-gradient(180deg, ${hexAlpha(accentColor, "0A")}, transparent)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(180deg, ${hexAlpha(primaryColor, "08")}, transparent 50%, ${hexAlpha(secondaryColor, "04")})`,
        heroAccentBar: `linear-gradient(to right, transparent, ${hexAlpha(secondaryColor, "12")}, ${hexAlpha(primaryColor, "0A")}, transparent)`,
        searchBg: SF_INPUT_BG,
        searchBorder: hexAlpha(secondaryColor, "10"),
        ctaBg: hexAlpha(primaryColor, "0A"),
        ctaText: primaryColor,
        ctaBorder: `1px solid ${hexAlpha(primaryColor, "18")}`,
        footerAccent: hexAlpha(secondaryColor, "70"),
        heroLayout: "centered",
        heroCtaSize: "sm",
        sectionSequence: ["hero", "featured", "catalog", "testimonials", "contact"],
        trustStyle: "minimal",
        commercialMode: "luxury",
        ctaStrategy: "exclusivity",
        heroHeadlineScale: "standard",
        cardDensity: "spacious",
        socialProofWeight: "subtle",
      };

    case "luxe":
      return {
        pageBg: SF_BG_SUBTLE,
        pageGradient: `linear-gradient(180deg, ${hexAlpha(primaryColor, "04")}, transparent 30%), linear-gradient(0deg, ${hexAlpha(secondaryColor, "03")}, transparent 30%)`,
        cardBg: SF_BG_WHITE,
        cardBgHover: hexAlpha(primaryColor, "06"),
        cardBorder: `1px solid ${hexAlpha(secondaryColor, "10")}`,
        cardBorderHover: `1px solid ${hexAlpha(secondaryColor, "20")}`,
        cardRadius: "rounded-none",
        headerWeight: "font-extralight",
        bodyWeight: "font-extralight",
        textStyle: "tracking-[0.2em] uppercase",
        fontClass: "font-serif",
        heroGlow: false,
        heroGlowIntensity: 0,
        heroOverlay: `linear-gradient(180deg, rgba(0,0,0,0.03), ${hexAlpha(primaryColor, "05")} 40%, rgba(0,0,0,0.02))`,
        badgeRadius: "rounded-none",
        imageHeight: "h-56",
        imageHeightSm: "h-24",
        accentOpacity: "08",
        buttonRadius: "rounded-none",
        buttonStyle: "outline",
        searchRadius: "rounded-none",
        tabStyle: "underline",
        spacing: "relaxed",
        cardShadow: "0 1px 3px rgba(0,0,0,0.05)",
        cardHoverTransform: "hover:opacity-80",
        sectionDivider: `1px solid ${hexAlpha(secondaryColor, "08")}`,
        priceWeight: "font-extralight",
        nameSize: "text-base",
        nameSizeSm: "text-xs",
        descSize: "text-sm",
        footerStyle: "font-serif tracking-[0.25em] uppercase text-[9px] font-extralight",
        serviceBg: `linear-gradient(180deg, ${hexAlpha(primaryColor, "06")}, transparent)`,
        productBg: `linear-gradient(180deg, ${hexAlpha(secondaryColor, "06")}, transparent)`,
        packageBg: `linear-gradient(180deg, ${hexAlpha(accentColor, "06")}, transparent)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(180deg, ${hexAlpha(primaryColor, "06")}, transparent 40%, ${hexAlpha(secondaryColor, "04")})`,
        heroAccentBar: `linear-gradient(to right, transparent, ${hexAlpha(secondaryColor, "0A")}, transparent)`,
        searchBg: SF_INPUT_BG,
        searchBorder: hexAlpha(secondaryColor, "0A"),
        ctaBg: "transparent",
        ctaText: primaryColor,
        ctaBorder: `1px solid ${hexAlpha(primaryColor, "25")}`,
        footerAccent: hexAlpha(secondaryColor, "50"),
        heroLayout: "centered",
        heroCtaSize: "sm",
        sectionSequence: ["hero", "featured", "catalog", "testimonials", "contact"],
        trustStyle: "minimal",
        commercialMode: "luxury",
        ctaStrategy: "exclusivity",
        heroHeadlineScale: "dramatic",
        cardDensity: "spacious",
        socialProofWeight: "subtle",
      };

    case "fresh":
      return {
        pageBg: SF_BG_WHITE,
        pageGradient: `radial-gradient(ellipse at 20% 20%, ${hexAlpha(primaryColor, "08")}, transparent 40%), radial-gradient(ellipse at 80% 60%, ${hexAlpha(secondaryColor, "06")}, transparent 40%), radial-gradient(ellipse at 50% 100%, ${hexAlpha(accentColor, "05")}, transparent 35%)`,
        cardBg: SF_BG_WHITE,
        cardBgHover: hexAlpha(primaryColor, "08"),
        cardBorder: `1px solid ${hexAlpha(primaryColor, "0C")}`,
        cardBorderHover: `1px solid ${hexAlpha(primaryColor, "25")}`,
        cardRadius: "rounded-3xl",
        headerWeight: "font-bold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: true,
        heroGlowIntensity: 0.06,
        heroOverlay: `linear-gradient(135deg, ${hexAlpha(primaryColor, "0C")}, ${hexAlpha(secondaryColor, "08")}, ${hexAlpha(accentColor, "05")})`,
        badgeRadius: "rounded-2xl",
        imageHeight: "h-44",
        imageHeightSm: "h-20",
        accentOpacity: "12",
        buttonRadius: "rounded-full",
        buttonStyle: "filled",
        searchRadius: "rounded-full",
        tabStyle: "pill",
        spacing: "normal",
        cardShadow: `0 2px 12px ${hexAlpha(primaryColor, "08")}, 0 1px 3px rgba(0,0,0,0.04)`,
        cardHoverTransform: "hover:scale-[1.02] hover:-translate-y-1",
        sectionDivider: `1px solid ${hexAlpha(primaryColor, "06")}`,
        priceWeight: "font-bold",
        nameSize: "text-sm",
        nameSizeSm: "text-[11px]",
        descSize: "text-xs",
        footerStyle: "font-semibold text-[11px]",
        serviceBg: `linear-gradient(135deg, ${hexAlpha(primaryColor, "0C")}, ${hexAlpha(primaryColor, "05")})`,
        productBg: `linear-gradient(135deg, ${hexAlpha(secondaryColor, "0C")}, ${hexAlpha(secondaryColor, "05")})`,
        packageBg: `linear-gradient(135deg, ${hexAlpha(accentColor, "0C")}, ${hexAlpha(accentColor, "05")})`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(135deg, ${hexAlpha(primaryColor, "0C")}, ${hexAlpha(secondaryColor, "08")}, ${hexAlpha(accentColor, "05")})`,
        heroAccentBar: `linear-gradient(to right, ${hexAlpha(primaryColor, "18")}, ${hexAlpha(secondaryColor, "12")}, ${hexAlpha(accentColor, "0C")})`,
        searchBg: hexAlpha(primaryColor, "05"),
        searchBorder: hexAlpha(primaryColor, "0C"),
        ctaBg: hexAlpha(primaryColor, "12"),
        ctaText: primaryColor,
        ctaBorder: `1px solid ${hexAlpha(primaryColor, "20")}`,
        footerAccent: primaryColor,
        heroLayout: "centered",
        heroCtaSize: "md",
        sectionSequence: ["hero", "featured", "categories", "catalog", "testimonials", "contact"],
        trustStyle: "badge_row",
        commercialMode: "utility",
        ctaStrategy: "convenience",
        heroHeadlineScale: "standard",
        cardDensity: "balanced",
        socialProofWeight: "moderate",
      };

    default:
      return {
        pageBg: SF_BG_WHITE,
        pageGradient: `radial-gradient(ellipse at 50% 0%, ${hexAlpha(primaryColor, "08")}, transparent 50%), radial-gradient(ellipse at 80% 100%, ${hexAlpha(secondaryColor, "05")}, transparent 40%)`,
        cardBg: SF_BG_WHITE,
        cardBgHover: hexAlpha(primaryColor, "06"),
        cardBorder: `1px solid ${SF_BORDER_LIGHT}`,
        cardBorderHover: `1px solid ${hexAlpha(primaryColor, "20")}`,
        cardRadius: "rounded-2xl",
        headerWeight: "font-bold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: false,
        heroGlowIntensity: 0.04,
        heroOverlay: `radial-gradient(ellipse at 50% 0%, ${hexAlpha(primaryColor, "12")}, transparent 70%)`,
        badgeRadius: "rounded-full",
        imageHeight: "h-40",
        imageHeightSm: "h-20",
        accentOpacity: "12",
        buttonRadius: "rounded-xl",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "pill",
        spacing: "normal",
        cardShadow: `0 1px 6px rgba(0,0,0,0.06)`,
        cardHoverTransform: "hover:-translate-y-0.5",
        sectionDivider: `1px solid ${SF_BORDER_LIGHT}`,
        priceWeight: "font-bold",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "font-semibold",
        serviceBg: `linear-gradient(135deg, ${hexAlpha(primaryColor, "0C")}, ${hexAlpha(primaryColor, "04")})`,
        productBg: `linear-gradient(135deg, ${hexAlpha(secondaryColor, "0C")}, ${hexAlpha(secondaryColor, "04")})`,
        packageBg: `linear-gradient(135deg, ${hexAlpha(accentColor, "0C")}, ${hexAlpha(accentColor, "04")})`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `radial-gradient(ellipse at 50% 0%, ${hexAlpha(primaryColor, "12")}, transparent 70%)`,
        heroAccentBar: `linear-gradient(to right, transparent, ${hexAlpha(primaryColor, "12")}, ${hexAlpha(secondaryColor, "0A")}, transparent)`,
        searchBg: SF_INPUT_BG,
        searchBorder: SF_INPUT_BORDER,
        ctaBg: hexAlpha(primaryColor, "12"),
        ctaText: primaryColor,
        ctaBorder: `1px solid ${hexAlpha(primaryColor, "20")}`,
        footerAccent: primaryColor,
        heroLayout: "centered",
        heroCtaSize: "md",
        sectionSequence: ["hero", "trust", "featured", "categories", "catalog", "testimonials", "faq", "contact"],
        trustStyle: "badge_row",
        commercialMode: "hybrid",
        ctaStrategy: "value",
        heroHeadlineScale: "standard",
        cardDensity: "balanced",
        socialProofWeight: "moderate",
      };
  }
}

export function getTabClasses(ts: ThemeStyles, active: boolean, primaryColor: string): { className: string; style: React.CSSProperties } {
  switch (ts.tabStyle) {
    case "underline":
      return {
        className: `px-3 py-2 text-sm font-medium whitespace-nowrap transition-all border-b-2 ${
          active ? "text-foreground" : "text-muted-foreground border-transparent hover:text-foreground/70"
        }`,
        style: active ? { borderColor: primaryColor, color: primaryColor } : {},
      };
    case "block":
      return {
        className: `px-5 py-2.5 text-sm ${ts.headerWeight} whitespace-nowrap transition-all ${ts.buttonRadius} ${
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground/70"
        }`,
        style: active ? { backgroundColor: hexAlpha(primaryColor, "12"), color: primaryColor, border: `1px solid ${hexAlpha(primaryColor, "20")}` } : { border: "1px solid transparent" },
      };
    case "chip":
      return {
        className: `px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all rounded-full ${
          active ? "text-foreground" : "text-muted-foreground bg-muted hover:text-foreground/70"
        }`,
        style: active ? { backgroundColor: hexAlpha(primaryColor, "10"), color: primaryColor, border: `1px solid ${hexAlpha(primaryColor, "18")}` } : { border: "1px solid transparent" },
      };
    default:
      return {
        className: `px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
          active ? "text-foreground" : "text-muted-foreground bg-muted hover:text-foreground/70"
        }`,
        style: active ? { backgroundColor: hexAlpha(primaryColor, "12"), color: primaryColor } : {},
      };
  }
}

export function getButtonStyles(ts: ThemeStyles, primaryColor: string): { className: string; style: React.CSSProperties } {
  switch (ts.buttonStyle) {
    case "outline":
      return {
        className: `flex items-center gap-1.5 px-3 py-1.5 ${ts.buttonRadius} text-xs font-medium transition-all hover:scale-105`,
        style: { border: `1px solid ${hexAlpha(primaryColor, "40")}`, color: primaryColor, background: "transparent" },
      };
    case "ghost":
      return {
        className: `flex items-center gap-1.5 px-3 py-1.5 ${ts.buttonRadius} text-xs font-medium transition-all hover:opacity-70`,
        style: { color: primaryColor, background: "transparent", borderBottom: `1px solid ${hexAlpha(primaryColor, "30")}` },
      };
    case "pill":
      return {
        className: `flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-105`,
        style: { backgroundColor: hexAlpha(primaryColor, "10"), color: primaryColor, border: `1px solid ${hexAlpha(primaryColor, "15")}` },
      };
    default:
      return {
        className: `flex items-center gap-1.5 px-3 py-1.5 ${ts.buttonRadius} text-xs font-medium transition-all hover:scale-105`,
        style: { backgroundColor: hexAlpha(primaryColor, "12"), color: primaryColor },
      };
  }
}

export function getItemAccent(ts: ThemeStyles, itemType: "service" | "product" | "package"): { bg: string; color: string } {
  switch (itemType) {
    case "service":
      return { bg: ts.serviceBg, color: ts.serviceAccent };
    case "product":
      return { bg: ts.productBg, color: ts.productAccent };
    case "package":
      return { bg: ts.packageBg, color: ts.packageAccent };
  }
}
