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
} from "lucide-react";
import { Service, Product } from "@/lib/client";
import { formatPrice } from "@/lib/format";

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

function TypeBadge({ type, primaryColor, secondaryColor }: { type: string; primaryColor: string; secondaryColor: string }) {
  const config: Record<string, { icon: ReactNode; label: string; color: string }> = {
    service: { icon: <Briefcase className="w-2.5 h-2.5" />, label: "Service", color: primaryColor },
    product: { icon: <ShoppingBag className="w-2.5 h-2.5" />, label: "Product", color: secondaryColor },
    package: { icon: <Package className="w-2.5 h-2.5" />, label: "Package", color: "#a78bfa" },
  };
  const c = config[type] || config.service;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
      style={{ backgroundColor: `${c.color}20`, color: c.color }}
    >
      {c.icon} {c.label}
    </span>
  );
}

function ItemPlaceholder({ name, accentColor }: { name: string; accentColor: string }) {
  return (
    <div
      className="w-full h-24 rounded-t-xl flex items-center justify-center text-2xl font-bold"
      style={{
        background: `linear-gradient(135deg, ${accentColor}15, ${accentColor}08)`,
        color: `${accentColor}40`,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export function StorefrontPreview({ businessData, services, commerceProducts }: Props) {
  const pc = businessData?.primaryColor || "#F97316";
  const sc = businessData?.secondaryColor || "#14B8A6";

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
        imageUrl: (p as any).imageUrl ?? null,
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
        duration: (p as any).duration ?? null,
        imageUrl: (p as any).imageUrl ?? null,
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
            <div className="bg-[#0a0a0f] overflow-y-auto" style={{ maxHeight: "600px" }}>
              <div className="p-4 space-y-5">
                <div className="text-center space-y-2 relative pt-3 pb-1">
                  <div
                    className="absolute inset-0 opacity-[0.07] rounded-2xl"
                    style={{ background: `radial-gradient(ellipse at 50% 0%, ${pc}, transparent 70%)` }}
                  />
                  <div className="relative">
                    {businessData?.logoUrl ? (
                      <img
                        src={businessData.logoUrl}
                        alt="Logo"
                        className="h-14 w-14 rounded-2xl mx-auto object-cover border-2 border-white/10 shadow-xl"
                      />
                    ) : (
                      <div
                        className="h-14 w-14 rounded-2xl mx-auto flex items-center justify-center border-2 border-white/10 shadow-xl text-xl font-bold"
                        style={{ background: `linear-gradient(135deg, ${pc}30, ${sc}20)`, color: `${pc}` }}
                      >
                        {(businessData?.name || "S").charAt(0)}
                      </div>
                    )}
                    <h2 className="text-lg font-bold text-white mt-2">{businessData?.name ?? "Your Business"}</h2>
                    {businessData?.tagline && <p className="text-[11px] text-white/50">{businessData.tagline}</p>}
                    {(businessData?.address || businessData?.phone || businessData?.email) && (
                      <div className="flex items-center justify-center gap-3 text-[10px] text-white/40 flex-wrap mt-1.5">
                        {businessData?.address && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-2.5 h-2.5" /> {businessData.address}
                          </span>
                        )}
                        {businessData?.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-2.5 h-2.5" /> {businessData.phone}
                          </span>
                        )}
                        {businessData?.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="w-2.5 h-2.5" /> {businessData.email}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className="rounded-xl p-3 space-y-1.5"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="flex items-center gap-1.5 text-[10px] text-white/50 font-medium mb-1">
                    <Clock className="w-3 h-3" /> Business Hours
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => (
                      <div key={d} className="flex justify-between text-[9px]">
                        <span className="text-white/30">{d}</span>
                        <span className="text-white/50">9:00–17:00</span>
                      </div>
                    ))}
                    {["Sat", "Sun"].map((d) => (
                      <div key={d} className="flex justify-between text-[9px]">
                        <span className="text-white/30">{d}</span>
                        <span className="text-white/30">Closed</span>
                      </div>
                    ))}
                  </div>
                </div>

                {businessData?.phone && (
                  <div
                    className="flex items-center gap-2 rounded-xl px-3 py-2.5 cursor-pointer transition-all hover:border-emerald-500/30"
                    style={{
                      background: "rgba(16, 185, 129, 0.08)",
                      border: "1px solid rgba(16, 185, 129, 0.15)",
                    }}
                  >
                    <MessageCircle className="w-4 h-4 text-emerald-400" />
                    <span className="text-[11px] text-emerald-300 font-medium">Chat on WhatsApp</span>
                    <span className="ml-auto text-[10px] text-emerald-400/50">{businessData.phone}</span>
                  </div>
                )}

                {allItems.length === 0 ? (
                  <div className="text-center py-5 space-y-2">
                    <Store className="w-7 h-7 text-white/20 mx-auto" />
                    <p className="text-xs text-white/40">Your store is empty. Switch to Edit mode to add items.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {tabs.map((tab) => (
                        <span
                          key={tab.key}
                          className={`px-2.5 py-1 rounded-full text-[10px] font-medium cursor-default transition-all ${
                            tab.key === "all" ? "text-white" : "text-white/40 bg-white/[0.03]"
                          }`}
                          style={tab.key === "all" ? { backgroundColor: `${pc}20`, color: pc } : {}}
                        >
                          {tab.label}
                        </span>
                      ))}
                      <div className="flex-1" />
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] pl-6 pr-2 py-1 text-[10px] text-white/25 w-24">
                          Search...
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {allItems.map((item) => {
                        const accentColor = item.itemType === "service" ? pc : item.itemType === "product" ? sc : "#a78bfa";
                        return (
                          <div
                            key={item.id}
                            className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden hover:border-white/20 transition-all group"
                          >
                            {item.imageUrl ? (
                              <img src={item.imageUrl} alt={item.name} className="w-full h-20 object-cover" />
                            ) : (
                              <div
                                className="w-full h-20 flex items-center justify-center text-xl font-bold"
                                style={{
                                  background: `linear-gradient(135deg, ${accentColor}15, ${accentColor}08)`,
                                  color: `${accentColor}40`,
                                }}
                              >
                                {item.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div className="p-2.5 space-y-1.5">
                              <div className="flex items-start justify-between gap-1">
                                <div className="space-y-0.5 min-w-0">
                                  <TypeBadge type={item.itemType} primaryColor={pc} secondaryColor={sc} />
                                  <h4 className="text-[10px] font-semibold text-white leading-tight truncate">{item.name}</h4>
                                </div>
                                <span className="text-[10px] font-bold whitespace-nowrap" style={{ color: accentColor }}>
                                  {formatPrice(item.price, item.currency)}
                                </span>
                              </div>
                              {item.description && <p className="text-[9px] text-white/40 line-clamp-2">{item.description}</p>}
                              <div className="flex items-center justify-between">
                                {item.duration ? (
                                  <span className="text-[9px] text-white/30 flex items-center gap-1">
                                    <Clock className="w-2 h-2" />
                                    {item.duration} min
                                  </span>
                                ) : (
                                  <span />
                                )}
                                <span className="text-[9px] font-medium flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-white/5 text-white/50">
                                  <ShoppingCart className="w-2 h-2" /> Add
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <ShoppingCart className="w-3.5 h-3.5 text-white/40" />
                        <span className="text-[10px] text-white/40">Cart preview</span>
                      </div>
                      <span className="text-[9px] text-white/25">Items appear here</span>
                    </div>
                  </div>
                )}

                <div className="text-center text-[9px] text-white/20 pb-2">
                  Powered by <span className="font-semibold" style={{ color: pc }}>KeyFlowOS</span>
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
