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
        cardBg: "transparent",
        cardBgHover: "rgba(255,255,255,0.02)",
        cardBorder: "1px solid rgba(255,255,255,0.06)",
        cardBorderHover: "1px solid rgba(255,255,255,0.12)",
        cardRadius: "rounded-xl",
        headerWeight: "font-light",
        bodyWeight: "font-light",
        textStyle: "tracking-wide",
        fontClass: "",
        heroGlow: false,
        heroGlowIntensity: 0.03,
        heroOverlay: "none",
        badgeRadius: "rounded",
        imageHeight: "h-36",
        imageHeightSm: "h-16",
        accentOpacity: "08",
        buttonRadius: "rounded-lg",
        buttonStyle: "outline",
        searchRadius: "rounded-lg",
        tabStyle: "underline",
        spacing: "relaxed",
        cardShadow: "none",
        cardHoverTransform: "hover:-translate-y-0.5",
        sectionDivider: `1px solid rgba(255,255,255,0.04)`,
        priceWeight: "font-normal",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "tracking-widest uppercase text-[10px]",
      };

    case "bold":
      return {
        cardBg: `rgba(255,255,255,0.05)`,
        cardBgHover: `rgba(255,255,255,0.08)`,
        cardBorder: `2px solid rgba(255,255,255,0.1)`,
        cardBorderHover: `2px solid ${primaryColor}60`,
        cardRadius: "rounded-2xl",
        headerWeight: "font-black",
        bodyWeight: "font-medium",
        textStyle: "uppercase tracking-wider",
        fontClass: "",
        heroGlow: true,
        heroGlowIntensity: 0.18,
        heroOverlay: `linear-gradient(135deg, ${primaryColor}12, ${secondaryColor}08)`,
        badgeRadius: "rounded-xl",
        imageHeight: "h-48",
        imageHeightSm: "h-24",
        accentOpacity: "20",
        buttonRadius: "rounded-xl",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "block",
        spacing: "normal",
        cardShadow: `0 4px 24px ${primaryColor}10`,
        cardHoverTransform: "hover:scale-[1.02] hover:-translate-y-1",
        sectionDivider: `2px solid ${primaryColor}15`,
        priceWeight: "font-black",
        nameSize: "text-base",
        nameSizeSm: "text-[11px]",
        descSize: "text-sm",
        footerStyle: "font-black uppercase tracking-widest",
      };

    case "elegant":
      return {
        cardBg: "rgba(255,255,255,0.02)",
        cardBgHover: "rgba(255,255,255,0.04)",
        cardBorder: "1px solid rgba(255,255,255,0.08)",
        cardBorderHover: `1px solid ${secondaryColor}40`,
        cardRadius: "rounded-3xl",
        headerWeight: "font-medium",
        bodyWeight: "font-normal",
        textStyle: "italic tracking-wide",
        fontClass: "font-serif",
        heroGlow: false,
        heroGlowIntensity: 0.05,
        heroOverlay: `linear-gradient(180deg, transparent, ${secondaryColor}05)`,
        badgeRadius: "rounded-full",
        imageHeight: "h-44",
        imageHeightSm: "h-20",
        accentOpacity: "10",
        buttonRadius: "rounded-full",
        buttonStyle: "pill",
        searchRadius: "rounded-full",
        tabStyle: "chip",
        spacing: "relaxed",
        cardShadow: `0 2px 16px rgba(0,0,0,0.2)`,
        cardHoverTransform: "hover:-translate-y-0.5",
        sectionDivider: `1px solid rgba(255,255,255,0.06)`,
        priceWeight: "font-semibold",
        nameSize: "text-sm",
        nameSizeSm: "text-[10px]",
        descSize: "text-xs",
        footerStyle: "font-serif italic tracking-wide",
      };

    case "luxe":
      return {
        cardBg: "rgba(255,255,255,0.02)",
        cardBgHover: "rgba(255,255,255,0.04)",
        cardBorder: `1px solid ${secondaryColor}15`,
        cardBorderHover: `1px solid ${secondaryColor}35`,
        cardRadius: "rounded-3xl",
        headerWeight: "font-light",
        bodyWeight: "font-light",
        textStyle: "tracking-[0.15em] uppercase",
        fontClass: "font-serif",
        heroGlow: false,
        heroGlowIntensity: 0.04,
        heroOverlay: `linear-gradient(180deg, rgba(0,0,0,0.4), transparent 50%, rgba(0,0,0,0.6))`,
        badgeRadius: "rounded-full",
        imageHeight: "h-52",
        imageHeightSm: "h-24",
        accentOpacity: "08",
        buttonRadius: "rounded-full",
        buttonStyle: "outline",
        searchRadius: "rounded-full",
        tabStyle: "underline",
        spacing: "relaxed",
        cardShadow: `0 8px 32px rgba(0,0,0,0.3)`,
        cardHoverTransform: "hover:-translate-y-1",
        sectionDivider: `1px solid ${secondaryColor}10`,
        priceWeight: "font-light",
        nameSize: "text-base",
        nameSizeSm: "text-xs",
        descSize: "text-sm",
        footerStyle: "font-serif tracking-[0.2em] uppercase text-[10px]",
      };

    case "fresh":
      return {
        cardBg: "rgba(255,255,255,0.04)",
        cardBgHover: "rgba(255,255,255,0.07)",
        cardBorder: "1px solid rgba(255,255,255,0.08)",
        cardBorderHover: `1px solid ${primaryColor}40`,
        cardRadius: "rounded-2xl",
        headerWeight: "font-semibold",
        bodyWeight: "font-normal",
        textStyle: "",
        fontClass: "",
        heroGlow: true,
        heroGlowIntensity: 0.08,
        heroOverlay: `linear-gradient(135deg, ${primaryColor}08, ${secondaryColor}05)`,
        badgeRadius: "rounded-lg",
        imageHeight: "h-44",
        imageHeightSm: "h-20",
        accentOpacity: "12",
        buttonRadius: "rounded-2xl",
        buttonStyle: "filled",
        searchRadius: "rounded-2xl",
        tabStyle: "pill",
        spacing: "normal",
        cardShadow: `0 2px 12px rgba(0,0,0,0.15)`,
        cardHoverTransform: "hover:scale-[1.01] hover:-translate-y-0.5",
        sectionDivider: "1px solid rgba(255,255,255,0.05)",
        priceWeight: "font-semibold",
        nameSize: "text-sm",
        nameSizeSm: "text-[11px]",
        descSize: "text-xs",
        footerStyle: "font-medium",
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
        heroGlowIntensity: 0.07,
        heroOverlay: `radial-gradient(ellipse at 50% 0%, ${primaryColor}, transparent 70%)`,
        badgeRadius: "rounded-full",
        imageHeight: "h-40",
        imageHeightSm: "h-20",
        accentOpacity: "15",
        buttonRadius: "rounded-xl",
        buttonStyle: "filled",
        searchRadius: "rounded-xl",
        tabStyle: "pill",
        spacing: "normal",
        cardShadow: "none",
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
        className: `flex items-center gap-1.5 px-3 py-1.5 ${ts.buttonRadius} text-xs font-medium transition-all hover:scale-105`,
        style: { color: primaryColor, background: "transparent" },
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
