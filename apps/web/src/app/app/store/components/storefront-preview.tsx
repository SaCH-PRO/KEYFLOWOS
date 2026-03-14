"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Clock,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  ShoppingBag,
  Package,
  Search,
  ShoppingCart,
  Store,
  MessageCircle,
  Smartphone,
  Plus,
  ArrowRight,
} from "lucide-react";
import { Service, Product, StorefrontConfig } from "@/lib/client";
import { formatPrice } from "@/lib/format";
import { getThemeStyles, type ThemeKey } from "@/lib/storefront-themes";

type BusinessData = {
  name?: string;
  logoUrl?: string | null;
  tagline?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
};

type Props = {
  businessData: BusinessData | null;
  services: Service[];
  commerceProducts: Product[];
  config?: StorefrontConfig;
};

type PreviewItem = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  duration?: number | null;
  imageUrl?: string | null;
  itemType: "service" | "product" | "package";
};

function TypeBadge({ type, primaryColor, secondaryColor, accentColor, radius }: { type: string; primaryColor: string; secondaryColor: string; accentColor: string; radius: string }) {
  const cfg: Record<string, { icon: ReactNode; label: string; color: string }> = {
    service: { icon: <Briefcase className="w-2 h-2" />, label: "Service", color: primaryColor },
    product: { icon: <ShoppingBag className="w-2 h-2" />, label: "Product", color: secondaryColor },
    package: { icon: <Package className="w-2 h-2" />, label: "Package", color: accentColor },
  };
  const c = cfg[type] || cfg.service;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[8px] font-medium ${radius}`}
      style={{ backgroundColor: `${c.color}15`, color: c.color }}
    >
      {c.icon} {c.label}
    </span>
  );
}

export function StorefrontPreview({ businessData, services, commerceProducts, config }: Props) {
  const pc = (config?.appearance as any)?.primaryColor || businessData?.primaryColor || "#F97316";
  const sc = (config?.appearance as any)?.secondaryColor || businessData?.secondaryColor || "#14B8A6";
  const ac = (config?.appearance as any)?.accentColor || "#a78bfa";

  const hero = config?.hero ?? {};
  const appearance = config?.appearance ?? {};
  const theme = (appearance.theme ?? "default") as ThemeKey;
  const cardStyle = appearance.cardStyle ?? "grid";
  const showPrices = appearance.showPrices ?? true;
  const showDuration = appearance.showDuration ?? true;

  const ts = getThemeStyles(theme, pc, sc, ac);

  const storeNames = new Set(services.map((s) => s.name));
  const allItems: PreviewItem[] = [
    ...services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      price: s.price,
      currency: s.currency ?? "TTD",
      duration: (s as any).durationMins ?? s.duration,
      imageUrl: null as string | null,
      itemType: "service" as const,
    })),
    ...commerceProducts
      .filter((p) => p.category === "PRODUCT" && storeNames.has(p.name))
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        currency: p.currency ?? "TTD",
        duration: null as number | null,
        imageUrl: p.imageUrl ?? null,
        itemType: "product" as const,
      })),
    ...commerceProducts
      .filter((p) => p.category === "PACKAGE" && storeNames.has(p.name))
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        currency: p.currency ?? "TTD",
        duration: p.duration ?? null,
        imageUrl: p.imageUrl ?? null,
        itemType: "package" as const,
      })),
  ];

  const hasServices = allItems.some((i) => i.itemType === "service");
  const hasProducts = allItems.some((i) => i.itemType === "product");
  const hasPackages = allItems.some((i) => i.itemType === "package");
  const tabs = [
    { key: "all", label: "All" },
    ...(hasServices ? [{ key: "service", label: "Services" }] : []),
    ...(hasProducts ? [{ key: "product", label: "Products" }] : []),
    ...(hasPackages ? [{ key: "package", label: "Packages" }] : []),
  ];

  const headline = hero.headline || businessData?.name || "Your Business";
  const subheadline = hero.subheadline || businessData?.tagline || "";
  const showHours = hero.showHours ?? true;
  const showWhatsApp = hero.showWhatsApp ?? true;

  function getTabClass(active: boolean) {
    switch (ts.tabStyle) {
      case "underline":
        return {
          className: `px-2 py-1 text-[9px] font-medium transition-all border-b ${active ? "text-white" : "text-white/35 border-transparent"}`,
          style: active ? { borderColor: pc, color: pc } as React.CSSProperties : {} as React.CSSProperties,
        };
      case "block":
        return {
          className: `px-2 py-1 text-[9px] ${ts.headerWeight} transition-all ${ts.buttonRadius} ${active ? "text-white" : "text-white/35"}`,
          style: active ? { backgroundColor: `${pc}25`, color: pc, border: `1px solid ${pc}35` } as React.CSSProperties : { border: "1px solid transparent" } as React.CSSProperties,
        };
      case "chip":
        return {
          className: `px-2 py-0.5 text-[9px] font-medium transition-all rounded-full ${active ? "text-white" : "text-white/35"}`,
          style: active ? { backgroundColor: `${pc}15`, color: pc, border: `1px solid ${pc}20` } as React.CSSProperties : { border: "1px solid transparent" } as React.CSSProperties,
        };
      default:
        return {
          className: `px-2 py-1 text-[9px] font-medium transition-all rounded-lg ${active ? "text-white" : "text-white/35 bg-white/[0.03]"}`,
          style: active ? { backgroundColor: `${pc}20`, color: pc } as React.CSSProperties : {} as React.CSSProperties,
        };
    }
  }

  function renderAddBtn() {
    switch (ts.buttonStyle) {
      case "outline":
        return (
          <span className={`text-[8px] font-medium flex items-center gap-0.5 px-1.5 py-0.5 ${ts.buttonRadius}`}
            style={{ border: `1px solid ${pc}35`, color: pc }}>
            <Plus className="w-2 h-2" /> Add
          </span>
        );
      case "pill":
        return (
          <span className="text-[8px] font-medium flex items-center gap-0.5 px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${pc}12`, color: pc, border: `1px solid ${pc}18` }}>
            <Plus className="w-2 h-2" /> Add
          </span>
        );
      case "ghost":
        return (
          <span className="text-[8px] font-medium flex items-center gap-0.5 px-1.5 py-0.5"
            style={{ color: pc }}>
            <Plus className="w-2 h-2" /> Add
          </span>
        );
      default:
        return (
          <span className={`text-[8px] font-medium flex items-center gap-0.5 px-1.5 py-0.5 ${ts.buttonRadius}`}
            style={{ backgroundColor: `${pc}18`, color: pc }}>
            <Plus className="w-2 h-2" /> Add
          </span>
        );
    }
  }

  function renderGridItem(item: PreviewItem) {
    const itemAccent = item.itemType === "service" ? ts.serviceAccent : item.itemType === "product" ? ts.productAccent : ts.packageAccent;
    const itemBg = item.itemType === "service" ? ts.serviceBg : item.itemType === "product" ? ts.productBg : ts.packageBg;
    return (
      <div
        key={item.id}
        className={`overflow-hidden transition-all group ${ts.cardRadius}`}
        style={{
          background: ts.cardBg,
          border: ts.cardBorder,
          boxShadow: ts.cardShadow,
        }}
      >
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} className={`w-full ${ts.imageHeightSm} object-cover`} />
        ) : (
          <div
            className={`w-full ${ts.imageHeightSm} flex items-center justify-center text-lg ${ts.headerWeight} ${ts.fontClass}`}
            style={{
              background: itemBg,
              color: `${itemAccent}50`,
            }}
          >
            {item.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className={`p-2 space-y-1 ${ts.spacing === "relaxed" ? "p-3" : "p-2"}`}>
          <TypeBadge type={item.itemType} primaryColor={pc} secondaryColor={sc} accentColor={ac} radius={ts.badgeRadius} />
          <h4 className={`${ts.nameSizeSm} ${ts.headerWeight} text-white leading-tight truncate ${ts.textStyle} ${ts.fontClass}`}>{item.name}</h4>
          {showPrices && (
            <span className={`text-[10px] ${ts.priceWeight} block`} style={{ color: itemAccent }}>
              {formatPrice(item.price, item.currency)}
            </span>
          )}
          {item.description && <p className={`text-[8px] text-white/35 line-clamp-2 ${ts.fontClass}`}>{item.description}</p>}
          <div className="flex items-center justify-between pt-0.5">
            {showDuration && item.duration ? (
              <span className="text-[8px] text-white/25 flex items-center gap-0.5">
                <Clock className="w-2 h-2" />
                {item.duration}m
              </span>
            ) : (
              <span />
            )}
            {renderAddBtn()}
          </div>
        </div>
      </div>
    );
  }

  function renderListItem(item: PreviewItem) {
    const itemAccent = item.itemType === "service" ? ts.serviceAccent : item.itemType === "product" ? ts.productAccent : ts.packageAccent;
    const itemBg = item.itemType === "service" ? ts.serviceBg : item.itemType === "product" ? ts.productBg : ts.packageBg;
    return (
      <div
        key={item.id}
        className={`flex gap-2.5 transition-all ${ts.cardRadius} ${ts.spacing === "relaxed" ? "p-3" : "p-2.5"}`}
        style={{
          background: ts.cardBg,
          border: ts.cardBorder,
          boxShadow: ts.cardShadow,
        }}
      >
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name} className={`w-12 h-12 ${ts.cardRadius} object-cover flex-shrink-0`} />
        ) : (
          <div
            className={`w-12 h-12 ${ts.cardRadius} flex items-center justify-center text-sm flex-shrink-0 ${ts.headerWeight} ${ts.fontClass}`}
            style={{
              background: itemBg,
              color: `${itemAccent}50`,
            }}
          >
            {item.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0">
              <TypeBadge type={item.itemType} primaryColor={pc} secondaryColor={sc} accentColor={ac} radius={ts.badgeRadius} />
              <h4 className={`${ts.nameSizeSm} ${ts.headerWeight} text-white leading-tight truncate mt-0.5 ${ts.textStyle} ${ts.fontClass}`}>{item.name}</h4>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              {showPrices && (
                <span className={`text-[10px] ${ts.priceWeight} whitespace-nowrap`} style={{ color: itemAccent }}>
                  {formatPrice(item.price, item.currency)}
                </span>
              )}
              {renderAddBtn()}
            </div>
          </div>
          {item.description && <p className={`text-[8px] text-white/35 line-clamp-1 ${ts.fontClass}`}>{item.description}</p>}
          {showDuration && item.duration && (
            <span className="text-[8px] text-white/25 flex items-center gap-0.5">
              <Clock className="w-2 h-2" />
              {item.duration}m
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="flex justify-center"
    >
      <div className="relative">
        <div
          className="relative rounded-[2.5rem] p-3 shadow-2xl"
          style={{
            background: "linear-gradient(180deg, hsl(var(--kf-muted) / 0.6), hsl(var(--kf-muted) / 0.3))",
            border: "3px solid hsl(var(--kf-border) / 0.6)",
            width: "380px",
          }}
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-6 rounded-b-2xl"
            style={{ background: "hsl(var(--kf-muted) / 0.8)" }}
          />

          <div className="flex items-center justify-between px-6 pt-2 pb-1">
            <span className="text-[10px] text-muted-foreground/50">9:41</span>
            <div className="flex items-center gap-1">
              <Smartphone className="w-2.5 h-2.5 text-muted-foreground/40" />
              <div className="w-5 h-2 rounded-sm border border-muted-foreground/30">
                <div className="w-3.5 h-full rounded-sm bg-emerald-400/60" />
              </div>
            </div>
          </div>

          <div
            className="rounded-[1.8rem] overflow-hidden"
            style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
          >
            <div className={`bg-[#0a0a0f] overflow-y-auto ${ts.fontClass}`} style={{ maxHeight: "600px" }}>
              {hero.coverImageUrl && (
                <div className="w-full h-20 overflow-hidden relative">
                  <img src={hero.coverImageUrl} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0a0a0f]" />
                </div>
              )}

              <div className={`${ts.spacing === "relaxed" ? "p-5" : "p-4"} space-y-4`}>
                <div className="text-center space-y-2 relative pt-2 pb-1">
                  <div
                    className="absolute inset-0 rounded-2xl"
                    style={{
                      background: ts.heroBg,
                      opacity: ts.heroGlowIntensity || 0.15,
                    }}
                  />
                  <div className="relative">
                    {businessData?.logoUrl ? (
                      <img
                        src={businessData.logoUrl}
                        alt="Logo"
                        className={`h-12 w-12 mx-auto object-cover border border-white/10 shadow-xl ${theme === "elegant" ? "rounded-full" : "rounded-xl"}`}
                      />
                    ) : (
                      <div
                        className={`h-12 w-12 mx-auto flex items-center justify-center border border-white/10 shadow-xl text-lg ${ts.headerWeight} ${theme === "elegant" ? "rounded-full" : "rounded-xl"}`}
                        style={{ background: `linear-gradient(135deg, ${pc}25, ${sc}15)`, color: pc }}
                      >
                        {(businessData?.name || "S").charAt(0)}
                      </div>
                    )}
                    <h2 className={`text-base mt-2 text-white ${ts.headerWeight} ${ts.textStyle} ${ts.fontClass}`}>
                      {headline}
                    </h2>
                    {subheadline && (
                      <p className={`text-[10px] text-white/45 mt-0.5 ${ts.fontClass} ${ts.bodyWeight}`}>{subheadline}</p>
                    )}
                    {(businessData?.address || businessData?.phone || businessData?.email) && (
                      <div className="flex items-center justify-center gap-2.5 text-[9px] text-white/35 flex-wrap mt-1.5">
                        {businessData?.address && (
                          <span className="flex items-center gap-0.5">
                            <MapPin className="w-2.5 h-2.5" /> {businessData.address}
                          </span>
                        )}
                        {businessData?.phone && (
                          <span className="flex items-center gap-0.5">
                            <Phone className="w-2.5 h-2.5" /> {businessData.phone}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {showHours && (
                  <div
                    className={`${ts.cardRadius} p-2.5 space-y-1`}
                    style={{ background: ts.cardBg, border: ts.cardBorder }}
                  >
                    <div className={`flex items-center gap-1.5 text-[9px] text-white/45 ${ts.bodyWeight} mb-1`}>
                      <Clock className="w-2.5 h-2.5" /> Hours
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      {["Mon-Fri"].map((d) => (
                        <div key={d} className="flex justify-between text-[8px]">
                          <span className="text-white/25">{d}</span>
                          <span className="text-white/45">9:00–17:00</span>
                        </div>
                      ))}
                      {["Sat-Sun"].map((d) => (
                        <div key={d} className="flex justify-between text-[8px]">
                          <span className="text-white/25">{d}</span>
                          <span className="text-white/25">Closed</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {showWhatsApp && businessData?.phone && (
                  <div
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-all ${ts.cardRadius}`}
                    style={{
                      background: "rgba(16, 185, 129, 0.06)",
                      border: "1px solid rgba(16, 185, 129, 0.12)",
                    }}
                  >
                    <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                    <span className={`text-[10px] text-emerald-300 ${ts.bodyWeight} ${ts.fontClass}`}>Chat on WhatsApp</span>
                  </div>
                )}

                {allItems.length === 0 ? (
                  <div className="text-center py-6 space-y-2">
                    <Store className="w-6 h-6 text-white/15 mx-auto" />
                    <p className={`text-[10px] text-white/35 ${ts.fontClass}`}>Add items to see your store</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-1 flex-wrap">
                      {tabs.map((tab) => {
                        const tabProps = getTabClass(tab.key === "all");
                        return (
                          <span key={tab.key} className={tabProps.className} style={tabProps.style}>
                            {tab.label}
                          </span>
                        );
                      })}
                      <div className="flex-1" />
                      <div className="relative">
                        <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-white/25" />
                        <div
                          className={`pl-5 pr-2 py-0.5 text-[8px] text-white/20 w-16 ${ts.searchRadius}`}
                          style={{ background: ts.searchBg, border: `1px solid ${ts.searchBorder}` }}
                        >
                          Search
                        </div>
                      </div>
                    </div>

                    {cardStyle === "grid" ? (
                      <div className="grid grid-cols-2 gap-2">
                        {allItems.map(renderGridItem)}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {allItems.map(renderListItem)}
                      </div>
                    )}
                  </div>
                )}

                {hero.ctaLabel && (
                  <div
                    className={`text-center py-2 px-4 text-[10px] flex items-center justify-center gap-1.5 ${ts.headerWeight} ${ts.buttonRadius}`}
                    style={{
                      background: ts.ctaBg,
                      border: ts.ctaBorder,
                      color: ts.ctaText,
                    }}
                  >
                    {hero.ctaLabel}
                    <ArrowRight className="w-2.5 h-2.5" />
                  </div>
                )}

                <div className={`text-center text-[8px] text-white/15 pb-1 ${ts.footerStyle}`}>
                  Powered by <span style={{ color: ts.footerAccent }}>KeyFlowOS</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-center py-2">
            <div className="w-28 h-1 rounded-full bg-muted-foreground/20" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
