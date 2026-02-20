"use client";

import { useState } from "react";
import {
  Search,
  Clock,
  Plus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import type { CatalogItem, FilterTab, SortOption } from "./types";
import { typeBadge } from "./utils";

type Props = {
  catalogItems: CatalogItem[];
  primaryColor: string;
  secondaryColor: string;
  isInCart: (itemId: string, itemType: string) => boolean;
  addToCart: (item: CatalogItem) => void;
  removeFromCart: (itemId: string, itemType: string) => void;
  badges?: Record<string, string>;
  featuredItemIds?: string[];
  onItemClick?: (item: CatalogItem) => void;
};

const catalogBadgeConfig: Record<string, { label: string; bg: string; text: string }> = {
  popular: { label: "Popular", bg: "bg-amber-500/20", text: "text-amber-400" },
  new: { label: "New", bg: "bg-emerald-500/20", text: "text-emerald-400" },
  best_seller: { label: "Best Seller", bg: "bg-violet-500/20", text: "text-violet-400" },
  limited: { label: "Limited", bg: "bg-red-500/20", text: "text-red-400" },
};

function ItemPlaceholder({ name, color }: { name: string; color: string }) {
  return (
    <div
      className="w-full h-40 rounded-t-2xl flex items-center justify-center text-4xl font-bold"
      style={{
        background: `linear-gradient(135deg, ${color}15, ${color}08)`,
        color: `${color}40`,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export function CatalogGrid({
  catalogItems,
  primaryColor,
  secondaryColor,
  isInCart,
  addToCart,
  removeFromCart,
  badges,
  featuredItemIds,
  onItemClick,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [sortOption, setSortOption] = useState<SortOption>("default");
  const [sortOpen, setSortOpen] = useState(false);

  const hasServices = catalogItems.some((i) => i.itemType === "service");
  const hasProducts = catalogItems.some((i) => i.itemType === "product");
  const hasPackages = catalogItems.some((i) => i.itemType === "package");

  const sortedCatalog = (() => {
    if (!featuredItemIds || featuredItemIds.length === 0) return catalogItems;
    const featuredSet = new Set(featuredItemIds);
    return [...catalogItems].sort((a, b) => {
      const aF = featuredSet.has(a.id) ? 0 : 1;
      const bF = featuredSet.has(b.id) ? 0 : 1;
      return aF - bF;
    });
  })();

  const filteredItems = (() => {
    let items = activeTab === "all" ? sortedCatalog : sortedCatalog.filter((i) => i.itemType === activeTab);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (i) => i.name.toLowerCase().includes(q) || (i.description && i.description.toLowerCase().includes(q))
      );
    }
    if (sortOption === "price_asc") items = [...items].sort((a, b) => a.price - b.price);
    else if (sortOption === "price_desc") items = [...items].sort((a, b) => b.price - a.price);
    else if (sortOption === "duration")
      items = [...items].sort((a, b) => (a.duration ?? 9999) - (b.duration ?? 9999));
    return items;
  })();

  if (catalogItems.length === 0) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-12 text-center space-y-4">
        <Sparkles className="w-10 h-10 text-white/20 mx-auto" />
        <h2 className="text-lg font-semibold text-white/60">Coming Soon</h2>
        <p className="text-sm text-white/30 max-w-sm mx-auto">
          This business is setting up their online store. Check back soon!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search services, products..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 transition-all"
            style={{ "--tw-ring-color": primaryColor } as React.CSSProperties}
          />
        </div>
        <div className="relative">
          <button
            onClick={() => setSortOpen(!sortOpen)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-white/60 hover:border-white/20 transition-all"
          >
            Sort
            {sortOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {sortOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-white/10 bg-[#16161f] backdrop-blur-xl shadow-2xl z-30 overflow-hidden">
              {([
                ["default", "Default"],
                ["price_asc", "Price: Low \u2192 High"],
                ["price_desc", "Price: High \u2192 Low"],
                ["duration", "Duration"],
              ] as [SortOption, string][]).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => { setSortOption(val); setSortOpen(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                    sortOption === val ? "text-white bg-white/5" : "text-white/50 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {(
          [
            ["all", "All"],
            ...(hasServices ? [["service", "Services"]] : []),
            ...(hasProducts ? [["product", "Products"]] : []),
            ...(hasPackages ? [["package", "Packages"]] : []),
          ] as [FilterTab, string][]
        ).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              activeTab === tab ? "text-white" : "text-white/40 bg-white/[0.03] hover:text-white/60"
            }`}
            style={activeTab === tab ? { backgroundColor: `${primaryColor}25`, color: primaryColor } : {}}
          >
            {label}
          </button>
        ))}
      </div>

      {filteredItems.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {filteredItems.map((item) => {
            const inCart = isInCart(item.id, item.itemType);
            const badge = typeBadge(item.itemType, primaryColor, secondaryColor);
            const accentColor = item.itemType === "service" ? primaryColor : item.itemType === "product" ? secondaryColor : "#a78bfa";
            return (
              <div
                key={`${item.id}_${item.itemType}`}
                className={`rounded-2xl border backdrop-blur transition-all group cursor-pointer ${
                  inCart
                    ? "border-white/20 bg-white/[0.06]"
                    : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                }`}
                onClick={() => onItemClick?.(item)}
              >
                <div className="relative">
                  {item.imageUrl ? (
                    <div className="w-full h-40 rounded-t-2xl overflow-hidden">
                      <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    </div>
                  ) : (
                    <ItemPlaceholder name={item.name} color={accentColor} />
                  )}
                  {badges?.[item.id] && catalogBadgeConfig[badges[item.id]] && (
                    <span
                      className={`absolute top-2 right-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${catalogBadgeConfig[badges[item.id]].bg} ${catalogBadgeConfig[badges[item.id]].text} backdrop-blur-sm`}
                    >
                      {catalogBadgeConfig[badges[item.id]].label}
                    </span>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{ backgroundColor: `${badge.color}20`, color: badge.color }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div className="flex items-start justify-between">
                    <h4 className="font-semibold text-white text-sm leading-tight pr-2">{item.name}</h4>
                    <div className="text-sm font-bold whitespace-nowrap" style={{ color: primaryColor }}>
                      {formatPrice(item.price, item.currency)}
                    </div>
                  </div>
                  {item.description && (
                    <p className="text-xs text-white/50 line-clamp-2 leading-relaxed">{item.description}</p>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    {item.duration ? (
                      <span className="flex items-center gap-1 text-xs text-white/40">
                        <Clock className="w-3 h-3" /> {item.duration} min
                      </span>
                    ) : (
                      <span />
                    )}
                    {inCart ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFromCart(item.id, item.itemType); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all text-emerald-400 bg-emerald-400/10 hover:bg-red-400/10 hover:text-red-400"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> In Cart
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); addToCart(item); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-105"
                        style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}
                      >
                        <Plus className="w-3.5 h-3.5" /> Add
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center space-y-3">
          <Search className="w-8 h-8 text-white/20 mx-auto" />
          <p className="text-sm text-white/40">No items match your search.</p>
        </div>
      )}
    </div>
  );
}
