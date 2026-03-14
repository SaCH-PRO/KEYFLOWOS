export type ThemeKey = "default" | "minimal" | "bold" | "elegant" | "luxe" | "fresh";

export interface ThemeStyles {
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
}

export function getThemeStyles(theme: ThemeKey, primaryColor: string, secondaryColor: string, accentColor: string): ThemeStyles {
  switch (theme) {

    case "minimal":
      return {
        cardBg: `${primaryColor}04`,
        cardBgHover: `${primaryColor}08`,
        cardBorder: `1px solid ${primaryColor}08`,
        cardBorderHover: `1px solid ${primaryColor}18`,
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
        cardShadow: "none",
        cardHoverTransform: "hover:opacity-90",
        sectionDivider: `1px solid ${primaryColor}08`,
        priceWeight: "font-light",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "tracking-[0.2em] uppercase text-[9px] font-light",
        serviceBg: `linear-gradient(135deg, ${primaryColor}0A, ${primaryColor}03)`,
        productBg: `linear-gradient(135deg, ${secondaryColor}0A, ${secondaryColor}03)`,
        packageBg: `linear-gradient(135deg, ${accentColor}0A, ${accentColor}03)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `radial-gradient(ellipse at 50% 0%, ${primaryColor}0C, transparent 60%)`,
        heroAccentBar: `linear-gradient(to right, transparent, ${primaryColor}10, ${secondaryColor}08, transparent)`,
        searchBg: `${primaryColor}04`,
        searchBorder: `${primaryColor}10`,
        ctaBg: "transparent",
        ctaText: primaryColor,
        ctaBorder: `1px solid ${primaryColor}25`,
        footerAccent: `${primaryColor}50`,
      };

    case "bold":
      return {
        cardBg: `${primaryColor}0C`,
        cardBgHover: `${primaryColor}18`,
        cardBorder: `2px solid ${primaryColor}25`,
        cardBorderHover: `2px solid ${primaryColor}70`,
        cardRadius: "rounded-2xl",
        headerWeight: "font-black",
        bodyWeight: "font-medium",
        textStyle: "uppercase tracking-wider",
        fontClass: "",
        heroGlow: true,
        heroGlowIntensity: 0.25,
        heroOverlay: `linear-gradient(160deg, ${primaryColor}30, ${secondaryColor}18 50%, ${accentColor}12)`,
        badgeRadius: "rounded-xl",
        imageHeight: "h-48",
        imageHeightSm: "h-24",
        accentOpacity: "30",
        buttonRadius: "rounded-xl",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "block",
        spacing: "normal",
        cardShadow: `0 8px 32px ${primaryColor}20`,
        cardHoverTransform: "hover:scale-[1.03] hover:-translate-y-1.5",
        sectionDivider: `2px solid ${primaryColor}20`,
        priceWeight: "font-black",
        nameSize: "text-base",
        nameSizeSm: "text-[11px]",
        descSize: "text-sm",
        footerStyle: "font-black uppercase tracking-[0.15em]",
        serviceBg: `linear-gradient(135deg, ${primaryColor}28, ${primaryColor}0C)`,
        productBg: `linear-gradient(135deg, ${secondaryColor}28, ${secondaryColor}0C)`,
        packageBg: `linear-gradient(135deg, ${accentColor}28, ${accentColor}0C)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(160deg, ${primaryColor}30, ${secondaryColor}18 50%, ${accentColor}12)`,
        heroAccentBar: `linear-gradient(to right, ${primaryColor}50, ${secondaryColor}35, ${accentColor}25)`,
        searchBg: `${primaryColor}12`,
        searchBorder: `${primaryColor}25`,
        ctaBg: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
        ctaText: "white",
        ctaBorder: "none",
        footerAccent: primaryColor,
      };

    case "elegant":
      return {
        cardBg: `${secondaryColor}06`,
        cardBgHover: `${secondaryColor}0C`,
        cardBorder: `1px solid ${secondaryColor}15`,
        cardBorderHover: `1px solid ${secondaryColor}30`,
        cardRadius: "rounded-3xl",
        headerWeight: "font-normal",
        bodyWeight: "font-light",
        textStyle: "italic",
        fontClass: "font-serif",
        heroGlow: false,
        heroGlowIntensity: 0.05,
        heroOverlay: `linear-gradient(180deg, ${primaryColor}10, transparent 40%, ${secondaryColor}08)`,
        badgeRadius: "rounded-full",
        imageHeight: "h-48",
        imageHeightSm: "h-20",
        accentOpacity: "14",
        buttonRadius: "rounded-full",
        buttonStyle: "pill",
        searchRadius: "rounded-full",
        tabStyle: "chip",
        spacing: "relaxed",
        cardShadow: `0 4px 20px ${primaryColor}10`,
        cardHoverTransform: "hover:-translate-y-0.5",
        sectionDivider: `1px solid ${secondaryColor}0C`,
        priceWeight: "font-normal",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "font-serif italic tracking-wide text-[11px]",
        serviceBg: `linear-gradient(180deg, ${primaryColor}12, transparent)`,
        productBg: `linear-gradient(180deg, ${secondaryColor}12, transparent)`,
        packageBg: `linear-gradient(180deg, ${accentColor}12, transparent)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(180deg, ${primaryColor}10, transparent 50%, ${secondaryColor}06)`,
        heroAccentBar: `linear-gradient(to right, transparent, ${secondaryColor}18, ${primaryColor}12, transparent)`,
        searchBg: `${secondaryColor}06`,
        searchBorder: `${secondaryColor}12`,
        ctaBg: `${primaryColor}12`,
        ctaText: primaryColor,
        ctaBorder: `1px solid ${primaryColor}20`,
        footerAccent: `${secondaryColor}60`,
      };

    case "luxe":
      return {
        cardBg: `${primaryColor}06`,
        cardBgHover: `${primaryColor}0C`,
        cardBorder: `1px solid ${secondaryColor}12`,
        cardBorderHover: `1px solid ${secondaryColor}28`,
        cardRadius: "rounded-none",
        headerWeight: "font-extralight",
        bodyWeight: "font-extralight",
        textStyle: "tracking-[0.2em] uppercase",
        fontClass: "font-serif",
        heroGlow: false,
        heroGlowIntensity: 0,
        heroOverlay: `linear-gradient(180deg, rgba(0,0,0,0.5), ${primaryColor}08 40%, rgba(0,0,0,0.7))`,
        badgeRadius: "rounded-none",
        imageHeight: "h-56",
        imageHeightSm: "h-24",
        accentOpacity: "0A",
        buttonRadius: "rounded-none",
        buttonStyle: "outline",
        searchRadius: "rounded-none",
        tabStyle: "underline",
        spacing: "relaxed",
        cardShadow: "none",
        cardHoverTransform: "hover:opacity-80",
        sectionDivider: `1px solid ${secondaryColor}0A`,
        priceWeight: "font-extralight",
        nameSize: "text-base",
        nameSizeSm: "text-xs",
        descSize: "text-sm",
        footerStyle: "font-serif tracking-[0.25em] uppercase text-[9px] font-extralight",
        serviceBg: `linear-gradient(180deg, ${primaryColor}08, transparent)`,
        productBg: `linear-gradient(180deg, ${secondaryColor}08, transparent)`,
        packageBg: `linear-gradient(180deg, ${accentColor}08, transparent)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(180deg, ${primaryColor}08, transparent 40%, ${secondaryColor}05)`,
        heroAccentBar: `linear-gradient(to right, transparent, ${secondaryColor}12, transparent)`,
        searchBg: "rgba(0,0,0,0.2)",
        searchBorder: `${secondaryColor}10`,
        ctaBg: "transparent",
        ctaText: primaryColor,
        ctaBorder: `1px solid ${primaryColor}30`,
        footerAccent: `${secondaryColor}40`,
      };

    case "fresh":
      return {
        cardBg: `${primaryColor}08`,
        cardBgHover: `${primaryColor}12`,
        cardBorder: `1px solid ${primaryColor}10`,
        cardBorderHover: `1px solid ${primaryColor}35`,
        cardRadius: "rounded-3xl",
        headerWeight: "font-bold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: true,
        heroGlowIntensity: 0.15,
        heroOverlay: `linear-gradient(135deg, ${primaryColor}18, ${secondaryColor}12, ${accentColor}08)`,
        badgeRadius: "rounded-2xl",
        imageHeight: "h-44",
        imageHeightSm: "h-20",
        accentOpacity: "18",
        buttonRadius: "rounded-full",
        buttonStyle: "filled",
        searchRadius: "rounded-full",
        tabStyle: "pill",
        spacing: "normal",
        cardShadow: `0 4px 24px ${primaryColor}12, 0 1px 4px ${primaryColor}08`,
        cardHoverTransform: "hover:scale-[1.02] hover:-translate-y-1",
        sectionDivider: `1px solid ${primaryColor}08`,
        priceWeight: "font-bold",
        nameSize: "text-sm",
        nameSizeSm: "text-[11px]",
        descSize: "text-xs",
        footerStyle: "font-semibold text-[11px]",
        serviceBg: `linear-gradient(135deg, ${primaryColor}1A, ${primaryColor}08)`,
        productBg: `linear-gradient(135deg, ${secondaryColor}1A, ${secondaryColor}08)`,
        packageBg: `linear-gradient(135deg, ${accentColor}1A, ${accentColor}08)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(135deg, ${primaryColor}18, ${secondaryColor}10, ${accentColor}08)`,
        heroAccentBar: `linear-gradient(to right, ${primaryColor}30, ${secondaryColor}20, ${accentColor}18)`,
        searchBg: `${primaryColor}08`,
        searchBorder: `${primaryColor}15`,
        ctaBg: `${primaryColor}20`,
        ctaText: primaryColor,
        ctaBorder: `1px solid ${primaryColor}30`,
        footerAccent: primaryColor,
      };

    default:
      return {
        cardBg: `${primaryColor}06`,
        cardBgHover: `${primaryColor}0C`,
        cardBorder: `1px solid ${primaryColor}10`,
        cardBorderHover: `1px solid ${primaryColor}22`,
        cardRadius: "rounded-2xl",
        headerWeight: "font-bold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: false,
        heroGlowIntensity: 0.08,
        heroOverlay: `radial-gradient(ellipse at 50% 0%, ${primaryColor}25, transparent 70%)`,
        badgeRadius: "rounded-full",
        imageHeight: "h-40",
        imageHeightSm: "h-20",
        accentOpacity: "18",
        buttonRadius: "rounded-xl",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "pill",
        spacing: "normal",
        cardShadow: `0 2px 12px ${primaryColor}08`,
        cardHoverTransform: "hover:-translate-y-0.5",
        sectionDivider: `1px solid ${primaryColor}0A`,
        priceWeight: "font-bold",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "font-semibold",
        serviceBg: `linear-gradient(135deg, ${primaryColor}18, ${primaryColor}06)`,
        productBg: `linear-gradient(135deg, ${secondaryColor}18, ${secondaryColor}06)`,
        packageBg: `linear-gradient(135deg, ${accentColor}18, ${accentColor}06)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `radial-gradient(ellipse at 50% 0%, ${primaryColor}25, transparent 70%)`,
        heroAccentBar: `linear-gradient(to right, transparent, ${primaryColor}20, ${secondaryColor}15, transparent)`,
        searchBg: `${primaryColor}06`,
        searchBorder: `${primaryColor}12`,
        ctaBg: `${primaryColor}20`,
        ctaText: primaryColor,
        ctaBorder: `1px solid ${primaryColor}30`,
        footerAccent: primaryColor,
      };
  }
}

export function getTabClasses(ts: ThemeStyles, active: boolean, primaryColor: string): { className: string; style: React.CSSProperties } {
  switch (ts.tabStyle) {
    case "underline":
      return {
        className: `px-3 py-2 text-sm font-medium whitespace-nowrap transition-all border-b-2 ${
          active ? "text-white" : "text-white/40 border-transparent hover:text-white/60"
        }`,
        style: active ? { borderColor: primaryColor, color: primaryColor } : {},
      };
    case "block":
      return {
        className: `px-5 py-2.5 text-sm ${ts.headerWeight} whitespace-nowrap transition-all ${ts.buttonRadius} ${
          active ? "text-white" : "text-white/40 hover:text-white/60"
        }`,
        style: active ? { backgroundColor: `${primaryColor}30`, color: primaryColor, border: `1px solid ${primaryColor}40` } : { border: "1px solid transparent" },
      };
    case "chip":
      return {
        className: `px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all rounded-full ${
          active ? "text-white" : "text-white/40 bg-white/[0.03] hover:text-white/60"
        }`,
        style: active ? { backgroundColor: `${primaryColor}18`, color: primaryColor, border: `1px solid ${primaryColor}25` } : { border: "1px solid transparent" },
      };
    default:
      return {
        className: `px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
          active ? "text-white" : "text-white/40 bg-white/[0.03] hover:text-white/60"
        }`,
        style: active ? { backgroundColor: `${primaryColor}25`, color: primaryColor } : {},
      };
  }
}

export function getButtonStyles(ts: ThemeStyles, primaryColor: string): { className: string; style: React.CSSProperties } {
  switch (ts.buttonStyle) {
    case "outline":
      return {
        className: `flex items-center gap-1.5 px-3 py-1.5 ${ts.buttonRadius} text-xs font-medium transition-all hover:scale-105`,
        style: { border: `1px solid ${primaryColor}40`, color: primaryColor, background: "transparent" },
      };
    case "ghost":
      return {
        className: `flex items-center gap-1.5 px-3 py-1.5 ${ts.buttonRadius} text-xs font-medium transition-all hover:opacity-70`,
        style: { color: primaryColor, background: "transparent", borderBottom: `1px solid ${primaryColor}30` },
      };
    case "pill":
      return {
        className: `flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-105`,
        style: { backgroundColor: `${primaryColor}15`, color: primaryColor, border: `1px solid ${primaryColor}20` },
      };
    default:
      return {
        className: `flex items-center gap-1.5 px-3 py-1.5 ${ts.buttonRadius} text-xs font-medium transition-all hover:scale-105`,
        style: { backgroundColor: `${primaryColor}20`, color: primaryColor },
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
