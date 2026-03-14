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
}

export function getThemeStyles(theme: ThemeKey, primaryColor: string, secondaryColor: string): ThemeStyles {
  switch (theme) {

    case "minimal":
      return {
        cardBg: "rgba(255,255,255,0.015)",
        cardBgHover: "rgba(255,255,255,0.03)",
        cardBorder: "1px solid rgba(255,255,255,0.04)",
        cardBorderHover: "1px solid rgba(255,255,255,0.1)",
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
        accentOpacity: "06",
        buttonRadius: "rounded",
        buttonStyle: "ghost",
        searchRadius: "rounded-md",
        tabStyle: "underline",
        spacing: "relaxed",
        cardShadow: "none",
        cardHoverTransform: "hover:opacity-90",
        sectionDivider: "1px solid rgba(255,255,255,0.03)",
        priceWeight: "font-light",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "tracking-[0.2em] uppercase text-[9px] font-light",
      };

    case "bold":
      return {
        cardBg: `rgba(255,255,255,0.06)`,
        cardBgHover: `rgba(255,255,255,0.1)`,
        cardBorder: `2px solid rgba(255,255,255,0.1)`,
        cardBorderHover: `2px solid ${primaryColor}70`,
        cardRadius: "rounded-2xl",
        headerWeight: "font-black",
        bodyWeight: "font-medium",
        textStyle: "uppercase tracking-wider",
        fontClass: "",
        heroGlow: true,
        heroGlowIntensity: 0.22,
        heroOverlay: `linear-gradient(160deg, ${primaryColor}20, transparent 60%, ${secondaryColor}10)`,
        badgeRadius: "rounded-xl",
        imageHeight: "h-48",
        imageHeightSm: "h-24",
        accentOpacity: "25",
        buttonRadius: "rounded-xl",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "block",
        spacing: "normal",
        cardShadow: `0 8px 32px ${primaryColor}15`,
        cardHoverTransform: "hover:scale-[1.03] hover:-translate-y-1.5",
        sectionDivider: `2px solid ${primaryColor}18`,
        priceWeight: "font-black",
        nameSize: "text-base",
        nameSizeSm: "text-[11px]",
        descSize: "text-sm",
        footerStyle: "font-black uppercase tracking-[0.15em]",
      };

    case "elegant":
      return {
        cardBg: "rgba(255,255,255,0.02)",
        cardBgHover: "rgba(255,255,255,0.04)",
        cardBorder: `1px solid ${secondaryColor}12`,
        cardBorderHover: `1px solid ${secondaryColor}30`,
        cardRadius: "rounded-3xl",
        headerWeight: "font-normal",
        bodyWeight: "font-light",
        textStyle: "italic",
        fontClass: "font-serif",
        heroGlow: false,
        heroGlowIntensity: 0.03,
        heroOverlay: `linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.5))`,
        badgeRadius: "rounded-full",
        imageHeight: "h-48",
        imageHeightSm: "h-20",
        accentOpacity: "10",
        buttonRadius: "rounded-full",
        buttonStyle: "pill",
        searchRadius: "rounded-full",
        tabStyle: "chip",
        spacing: "relaxed",
        cardShadow: `0 4px 20px rgba(0,0,0,0.25)`,
        cardHoverTransform: "hover:-translate-y-0.5",
        sectionDivider: `1px solid rgba(255,255,255,0.05)`,
        priceWeight: "font-normal",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "font-serif italic tracking-wide text-[11px]",
      };

    case "luxe":
      return {
        cardBg: "rgba(0,0,0,0.3)",
        cardBgHover: "rgba(0,0,0,0.2)",
        cardBorder: `1px solid ${secondaryColor}10`,
        cardBorderHover: `1px solid ${secondaryColor}25`,
        cardRadius: "rounded-none",
        headerWeight: "font-extralight",
        bodyWeight: "font-extralight",
        textStyle: "tracking-[0.2em] uppercase",
        fontClass: "font-serif",
        heroGlow: false,
        heroGlowIntensity: 0,
        heroOverlay: `linear-gradient(180deg, rgba(0,0,0,0.5), transparent 40%, rgba(0,0,0,0.7))`,
        badgeRadius: "rounded-none",
        imageHeight: "h-56",
        imageHeightSm: "h-24",
        accentOpacity: "06",
        buttonRadius: "rounded-none",
        buttonStyle: "outline",
        searchRadius: "rounded-none",
        tabStyle: "underline",
        spacing: "relaxed",
        cardShadow: "none",
        cardHoverTransform: "hover:opacity-80",
        sectionDivider: `1px solid ${secondaryColor}08`,
        priceWeight: "font-extralight",
        nameSize: "text-base",
        nameSizeSm: "text-xs",
        descSize: "text-sm",
        footerStyle: "font-serif tracking-[0.25em] uppercase text-[9px] font-extralight",
      };

    case "fresh":
      return {
        cardBg: "rgba(255,255,255,0.05)",
        cardBgHover: "rgba(255,255,255,0.08)",
        cardBorder: "1px solid rgba(255,255,255,0.07)",
        cardBorderHover: `1px solid ${primaryColor}35`,
        cardRadius: "rounded-3xl",
        headerWeight: "font-bold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: true,
        heroGlowIntensity: 0.1,
        heroOverlay: `linear-gradient(135deg, ${primaryColor}10, ${secondaryColor}08)`,
        badgeRadius: "rounded-2xl",
        imageHeight: "h-44",
        imageHeightSm: "h-20",
        accentOpacity: "14",
        buttonRadius: "rounded-full",
        buttonStyle: "filled",
        searchRadius: "rounded-full",
        tabStyle: "pill",
        spacing: "normal",
        cardShadow: `0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)`,
        cardHoverTransform: "hover:scale-[1.02] hover:-translate-y-1",
        sectionDivider: "1px solid rgba(255,255,255,0.04)",
        priceWeight: "font-bold",
        nameSize: "text-sm",
        nameSizeSm: "text-[11px]",
        descSize: "text-xs",
        footerStyle: "font-semibold text-[11px]",
      };

    default:
      return {
        cardBg: "rgba(255,255,255,0.03)",
        cardBgHover: "rgba(255,255,255,0.06)",
        cardBorder: "1px solid rgba(255,255,255,0.08)",
        cardBorderHover: "1px solid rgba(255,255,255,0.18)",
        cardRadius: "rounded-2xl",
        headerWeight: "font-bold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: false,
        heroGlowIntensity: 0.06,
        heroOverlay: `radial-gradient(ellipse at 50% 0%, ${primaryColor}20, transparent 70%)`,
        badgeRadius: "rounded-full",
        imageHeight: "h-40",
        imageHeightSm: "h-20",
        accentOpacity: "15",
        buttonRadius: "rounded-xl",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "pill",
        spacing: "normal",
        cardShadow: "0 2px 12px rgba(0,0,0,0.1)",
        cardHoverTransform: "hover:-translate-y-0.5",
        sectionDivider: "1px solid rgba(255,255,255,0.06)",
        priceWeight: "font-bold",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "font-semibold",
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
