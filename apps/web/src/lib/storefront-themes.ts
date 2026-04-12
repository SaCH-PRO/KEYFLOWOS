export type ThemeKey = "default" | "minimal" | "bold" | "elegant" | "luxe" | "fresh";

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
}

export function getThemeStyles(theme: ThemeKey, primaryColor: string, secondaryColor: string, accentColor: string): ThemeStyles {
  switch (theme) {

    case "minimal":
      return {
        pageBg: `#fafafa`,
        pageGradient: `radial-gradient(ellipse at 50% 0%, ${primaryColor}06, transparent 50%), radial-gradient(ellipse at 100% 100%, ${secondaryColor}04, transparent 40%)`,
        cardBg: `#ffffff`,
        cardBgHover: `${primaryColor}06`,
        cardBorder: `1px solid #e5e7eb`,
        cardBorderHover: `1px solid ${primaryColor}30`,
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
        sectionDivider: `1px solid #e5e7eb`,
        priceWeight: "font-light",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "tracking-[0.2em] uppercase text-[9px] font-light",
        serviceBg: `linear-gradient(135deg, ${primaryColor}08, ${primaryColor}03)`,
        productBg: `linear-gradient(135deg, ${secondaryColor}08, ${secondaryColor}03)`,
        packageBg: `linear-gradient(135deg, ${accentColor}08, ${accentColor}03)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `radial-gradient(ellipse at 50% 0%, ${primaryColor}08, transparent 60%)`,
        heroAccentBar: `linear-gradient(to right, transparent, ${primaryColor}10, ${secondaryColor}08, transparent)`,
        searchBg: `#f3f4f6`,
        searchBorder: `#d1d5db`,
        ctaBg: "transparent",
        ctaText: primaryColor,
        ctaBorder: `1px solid ${primaryColor}35`,
        footerAccent: `${primaryColor}70`,
      };

    case "bold":
      return {
        pageBg: `#f8fafc`,
        pageGradient: `linear-gradient(160deg, ${primaryColor}08, transparent 40%), linear-gradient(340deg, ${secondaryColor}06, transparent 40%), radial-gradient(ellipse at 50% 80%, ${accentColor}05, transparent 50%)`,
        cardBg: `#ffffff`,
        cardBgHover: `${primaryColor}08`,
        cardBorder: `2px solid ${primaryColor}18`,
        cardBorderHover: `2px solid ${primaryColor}50`,
        cardRadius: "rounded-2xl",
        headerWeight: "font-black",
        bodyWeight: "font-medium",
        textStyle: "uppercase tracking-wider",
        fontClass: "",
        heroGlow: true,
        heroGlowIntensity: 0.1,
        heroOverlay: `linear-gradient(160deg, ${primaryColor}15, ${secondaryColor}0A 50%, ${accentColor}08)`,
        badgeRadius: "rounded-xl",
        imageHeight: "h-48",
        imageHeightSm: "h-24",
        accentOpacity: "20",
        buttonRadius: "rounded-xl",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "block",
        spacing: "normal",
        cardShadow: `0 4px 16px ${primaryColor}12`,
        cardHoverTransform: "hover:scale-[1.03] hover:-translate-y-1.5",
        sectionDivider: `2px solid ${primaryColor}12`,
        priceWeight: "font-black",
        nameSize: "text-base",
        nameSizeSm: "text-[11px]",
        descSize: "text-sm",
        footerStyle: "font-black uppercase tracking-[0.15em]",
        serviceBg: `linear-gradient(135deg, ${primaryColor}12, ${primaryColor}06)`,
        productBg: `linear-gradient(135deg, ${secondaryColor}12, ${secondaryColor}06)`,
        packageBg: `linear-gradient(135deg, ${accentColor}12, ${accentColor}06)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(160deg, ${primaryColor}15, ${secondaryColor}0A 50%, ${accentColor}08)`,
        heroAccentBar: `linear-gradient(to right, ${primaryColor}30, ${secondaryColor}20, ${accentColor}15)`,
        searchBg: `${primaryColor}06`,
        searchBorder: `${primaryColor}18`,
        ctaBg: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
        ctaText: "white",
        ctaBorder: "none",
        footerAccent: primaryColor,
      };

    case "elegant":
      return {
        pageBg: `#fafaf9`,
        pageGradient: `radial-gradient(ellipse at 30% 0%, ${primaryColor}06, transparent 45%), radial-gradient(ellipse at 70% 100%, ${secondaryColor}05, transparent 40%)`,
        cardBg: `#ffffff`,
        cardBgHover: `${secondaryColor}06`,
        cardBorder: `1px solid ${secondaryColor}12`,
        cardBorderHover: `1px solid ${secondaryColor}25`,
        cardRadius: "rounded-3xl",
        headerWeight: "font-normal",
        bodyWeight: "font-light",
        textStyle: "italic",
        fontClass: "font-serif",
        heroGlow: false,
        heroGlowIntensity: 0.02,
        heroOverlay: `linear-gradient(180deg, ${primaryColor}08, transparent 40%, ${secondaryColor}05)`,
        badgeRadius: "rounded-full",
        imageHeight: "h-48",
        imageHeightSm: "h-20",
        accentOpacity: "12",
        buttonRadius: "rounded-full",
        buttonStyle: "pill",
        searchRadius: "rounded-full",
        tabStyle: "chip",
        spacing: "relaxed",
        cardShadow: `0 2px 12px ${primaryColor}08`,
        cardHoverTransform: "hover:-translate-y-0.5",
        sectionDivider: `1px solid ${secondaryColor}0A`,
        priceWeight: "font-normal",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "font-serif italic tracking-wide text-[11px]",
        serviceBg: `linear-gradient(180deg, ${primaryColor}0A, transparent)`,
        productBg: `linear-gradient(180deg, ${secondaryColor}0A, transparent)`,
        packageBg: `linear-gradient(180deg, ${accentColor}0A, transparent)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(180deg, ${primaryColor}08, transparent 50%, ${secondaryColor}04)`,
        heroAccentBar: `linear-gradient(to right, transparent, ${secondaryColor}12, ${primaryColor}0A, transparent)`,
        searchBg: `#f5f5f4`,
        searchBorder: `${secondaryColor}10`,
        ctaBg: `${primaryColor}0A`,
        ctaText: primaryColor,
        ctaBorder: `1px solid ${primaryColor}18`,
        footerAccent: `${secondaryColor}70`,
      };

    case "luxe":
      return {
        pageBg: `#f9fafb`,
        pageGradient: `linear-gradient(180deg, ${primaryColor}04, transparent 30%), linear-gradient(0deg, ${secondaryColor}03, transparent 30%)`,
        cardBg: `#ffffff`,
        cardBgHover: `${primaryColor}06`,
        cardBorder: `1px solid ${secondaryColor}10`,
        cardBorderHover: `1px solid ${secondaryColor}20`,
        cardRadius: "rounded-none",
        headerWeight: "font-extralight",
        bodyWeight: "font-extralight",
        textStyle: "tracking-[0.2em] uppercase",
        fontClass: "font-serif",
        heroGlow: false,
        heroGlowIntensity: 0,
        heroOverlay: `linear-gradient(180deg, rgba(0,0,0,0.03), ${primaryColor}05 40%, rgba(0,0,0,0.02))`,
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
        sectionDivider: `1px solid ${secondaryColor}08`,
        priceWeight: "font-extralight",
        nameSize: "text-base",
        nameSizeSm: "text-xs",
        descSize: "text-sm",
        footerStyle: "font-serif tracking-[0.25em] uppercase text-[9px] font-extralight",
        serviceBg: `linear-gradient(180deg, ${primaryColor}06, transparent)`,
        productBg: `linear-gradient(180deg, ${secondaryColor}06, transparent)`,
        packageBg: `linear-gradient(180deg, ${accentColor}06, transparent)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(180deg, ${primaryColor}06, transparent 40%, ${secondaryColor}04)`,
        heroAccentBar: `linear-gradient(to right, transparent, ${secondaryColor}0A, transparent)`,
        searchBg: "#f3f4f6",
        searchBorder: `${secondaryColor}0A`,
        ctaBg: "transparent",
        ctaText: primaryColor,
        ctaBorder: `1px solid ${primaryColor}25`,
        footerAccent: `${secondaryColor}50`,
      };

    case "fresh":
      return {
        pageBg: `#fefefe`,
        pageGradient: `radial-gradient(ellipse at 20% 20%, ${primaryColor}08, transparent 40%), radial-gradient(ellipse at 80% 60%, ${secondaryColor}06, transparent 40%), radial-gradient(ellipse at 50% 100%, ${accentColor}05, transparent 35%)`,
        cardBg: `#ffffff`,
        cardBgHover: `${primaryColor}08`,
        cardBorder: `1px solid ${primaryColor}0C`,
        cardBorderHover: `1px solid ${primaryColor}25`,
        cardRadius: "rounded-3xl",
        headerWeight: "font-bold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: true,
        heroGlowIntensity: 0.06,
        heroOverlay: `linear-gradient(135deg, ${primaryColor}0C, ${secondaryColor}08, ${accentColor}05)`,
        badgeRadius: "rounded-2xl",
        imageHeight: "h-44",
        imageHeightSm: "h-20",
        accentOpacity: "12",
        buttonRadius: "rounded-full",
        buttonStyle: "filled",
        searchRadius: "rounded-full",
        tabStyle: "pill",
        spacing: "normal",
        cardShadow: `0 2px 12px ${primaryColor}08, 0 1px 3px rgba(0,0,0,0.04)`,
        cardHoverTransform: "hover:scale-[1.02] hover:-translate-y-1",
        sectionDivider: `1px solid ${primaryColor}06`,
        priceWeight: "font-bold",
        nameSize: "text-sm",
        nameSizeSm: "text-[11px]",
        descSize: "text-xs",
        footerStyle: "font-semibold text-[11px]",
        serviceBg: `linear-gradient(135deg, ${primaryColor}0C, ${primaryColor}05)`,
        productBg: `linear-gradient(135deg, ${secondaryColor}0C, ${secondaryColor}05)`,
        packageBg: `linear-gradient(135deg, ${accentColor}0C, ${accentColor}05)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `linear-gradient(135deg, ${primaryColor}0C, ${secondaryColor}08, ${accentColor}05)`,
        heroAccentBar: `linear-gradient(to right, ${primaryColor}18, ${secondaryColor}12, ${accentColor}0C)`,
        searchBg: `${primaryColor}05`,
        searchBorder: `${primaryColor}0C`,
        ctaBg: `${primaryColor}12`,
        ctaText: primaryColor,
        ctaBorder: `1px solid ${primaryColor}20`,
        footerAccent: primaryColor,
      };

    default:
      return {
        pageBg: `#ffffff`,
        pageGradient: `radial-gradient(ellipse at 50% 0%, ${primaryColor}08, transparent 50%), radial-gradient(ellipse at 80% 100%, ${secondaryColor}05, transparent 40%)`,
        cardBg: `#ffffff`,
        cardBgHover: `${primaryColor}06`,
        cardBorder: `1px solid #e5e7eb`,
        cardBorderHover: `1px solid ${primaryColor}20`,
        cardRadius: "rounded-2xl",
        headerWeight: "font-bold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: false,
        heroGlowIntensity: 0.04,
        heroOverlay: `radial-gradient(ellipse at 50% 0%, ${primaryColor}12, transparent 70%)`,
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
        sectionDivider: `1px solid #e5e7eb`,
        priceWeight: "font-bold",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "font-semibold",
        serviceBg: `linear-gradient(135deg, ${primaryColor}0C, ${primaryColor}04)`,
        productBg: `linear-gradient(135deg, ${secondaryColor}0C, ${secondaryColor}04)`,
        packageBg: `linear-gradient(135deg, ${accentColor}0C, ${accentColor}04)`,
        serviceAccent: primaryColor,
        productAccent: secondaryColor,
        packageAccent: accentColor,
        heroBg: `radial-gradient(ellipse at 50% 0%, ${primaryColor}12, transparent 70%)`,
        heroAccentBar: `linear-gradient(to right, transparent, ${primaryColor}12, ${secondaryColor}0A, transparent)`,
        searchBg: `#f3f4f6`,
        searchBorder: `#d1d5db`,
        ctaBg: `${primaryColor}12`,
        ctaText: primaryColor,
        ctaBorder: `1px solid ${primaryColor}20`,
        footerAccent: primaryColor,
      };
  }
}

export function getTabClasses(ts: ThemeStyles, active: boolean, primaryColor: string): { className: string; style: React.CSSProperties } {
  switch (ts.tabStyle) {
    case "underline":
      return {
        className: `px-3 py-2 text-sm font-medium whitespace-nowrap transition-all border-b-2 ${
          active ? "text-gray-900" : "text-gray-400 border-transparent hover:text-gray-600"
        }`,
        style: active ? { borderColor: primaryColor, color: primaryColor } : {},
      };
    case "block":
      return {
        className: `px-5 py-2.5 text-sm ${ts.headerWeight} whitespace-nowrap transition-all ${ts.buttonRadius} ${
          active ? "text-gray-900" : "text-gray-400 hover:text-gray-600"
        }`,
        style: active ? { backgroundColor: `${primaryColor}12`, color: primaryColor, border: `1px solid ${primaryColor}20` } : { border: "1px solid transparent" },
      };
    case "chip":
      return {
        className: `px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all rounded-full ${
          active ? "text-gray-900" : "text-gray-400 bg-gray-100 hover:text-gray-600"
        }`,
        style: active ? { backgroundColor: `${primaryColor}10`, color: primaryColor, border: `1px solid ${primaryColor}18` } : { border: "1px solid transparent" },
      };
    default:
      return {
        className: `px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
          active ? "text-gray-900" : "text-gray-400 bg-gray-100 hover:text-gray-600"
        }`,
        style: active ? { backgroundColor: `${primaryColor}12`, color: primaryColor } : {},
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
        style: { backgroundColor: `${primaryColor}10`, color: primaryColor, border: `1px solid ${primaryColor}15` },
      };
    default:
      return {
        className: `flex items-center gap-1.5 px-3 py-1.5 ${ts.buttonRadius} text-xs font-medium transition-all hover:scale-105`,
        style: { backgroundColor: `${primaryColor}12`, color: primaryColor },
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
