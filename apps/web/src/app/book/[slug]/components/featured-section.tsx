"use client";

import { Star, Plus, CheckCircle2 } from "lucide-react";
import { formatPrice } from "@/lib/format";
import type { CatalogItem } from "./types";

type Props = {
  items: CatalogItem[];
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  isInCart: (itemId: string, itemType: string) => boolean;
  addToCart: (item: CatalogItem) => void;
  onItemClick: (item: CatalogItem) => void;
  badges?: Record<string, string>;
};

export function FeaturedSection({
  items,
  primaryColor,
  secondaryColor,
  accentColor,
  isInCart,
  addToCart,
  onItemClick,
  badges,
}: Props) {
  if (!items || items.length === 0) return null;

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: `linear-gradient(135deg, ${primaryColor}20, ${secondaryColor}15)` }}
        >
          <Star className="w-4 h-4" style={{ color: primaryColor }} />
        </div>
        <h3 className="text-lg font-semibold text-white/80">Featured</h3>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory" style={{ scrollbarWidth: "none" }}>
        {items.map((item) => {
          const inCart = isInCart(item.id, item.itemType);
          const itemColor = item.itemType === "service" ? primaryColor : item.itemType === "product" ? secondaryColor : accentColor;
          return (
            <div
              key={`featured_${item.id}`}
              className="flex-shrink-0 w-56 snap-start rounded-2xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/[0.15] transition-all duration-300 overflow-hidden cursor-pointer group relative"
              onClick={() => onItemClick(item)}
            >
              <div
                className="absolute top-0 left-0 right-0 h-[2px]"
                style={{ background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})` }}
              />
              {item.imageUrl ? (
                <div className="w-full h-32 overflow-hidden">
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  />
                </div>
              ) : (
                <div
                  className="w-full h-32 flex items-center justify-center text-3xl font-bold"
                  style={{ background: `linear-gradient(135deg, ${itemColor}20, ${itemColor}08)`, color: `${itemColor}40` }}
                >
                  {item.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="p-3.5 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Star className="w-3 h-3" style={{ color: primaryColor }} fill={primaryColor} />
                  <span className="text-[10px] font-semibold text-white/40">Featured</span>
                </div>
                <h4 className="text-sm font-semibold text-white truncate">{item.name}</h4>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold" style={{ color: itemColor }}>
                    {formatPrice(item.price, item.currency)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!inCart) addToCart(item);
                    }}
                    className="w-8 h-8 min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center transition-all active:scale-90"
                    style={{
                      backgroundColor: inCart ? "rgba(16,185,129,0.15)" : `${primaryColor}15`,
                      color: inCart ? "#34d399" : primaryColor,
                    }}
                  >
                    {inCart ? <CheckCircle2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
