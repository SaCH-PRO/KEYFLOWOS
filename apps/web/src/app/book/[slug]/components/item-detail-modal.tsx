"use client";

import { useState } from "react";
import { X, Clock, ShoppingBag, Plus, CheckCircle2, Star, Shield, Zap, ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { formatPrice } from "@/lib/format";
import type { CatalogItem } from "./types";

type Props = {
  item: CatalogItem;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  isInCart: boolean;
  addToCart: (item: CatalogItem) => void;
  removeFromCart: (itemId: string, itemType: string) => void;
  relatedItems: CatalogItem[];
  businessPhone?: string | null;
  onClose: () => void;
  onSelectItem: (item: CatalogItem) => void;
  badges?: Record<string, string>;
};

const badgeConfig: Record<string, { label: string; bg: string; text: string }> = {
  popular: { label: "Popular", bg: "bg-amber-500/20", text: "text-amber-400" },
  new: { label: "New", bg: "bg-emerald-500/20", text: "text-emerald-400" },
  best_seller: { label: "Best Seller", bg: "bg-violet-500/20", text: "text-violet-400" },
  limited: { label: "Limited", bg: "bg-red-500/20", text: "text-red-400" },
};

function ModalPlaceholder({ name, color }: { name: string; color: string }) {
  return (
    <div
      className="w-full h-56 sm:h-72 flex items-center justify-center text-6xl font-bold"
      style={{
        background: `linear-gradient(135deg, ${color}25, ${color}10)`,
        color: `${color}50`,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export function ItemDetailModal({
  item,
  primaryColor,
  secondaryColor,
  accentColor: brandAccent,
  isInCart,
  addToCart,
  removeFromCart,
  relatedItems,
  businessPhone,
  onClose,
  onSelectItem,
  badges,
}: Props) {
  const itemAccent = item.itemType === "service" ? primaryColor : item.itemType === "product" ? secondaryColor : brandAccent;
  const badgeKey = badges?.[item.id];
  const badge = badgeKey ? badgeConfig[badgeKey] : null;

  const cleanPhone = businessPhone?.replace(/[^0-9+]/g, "").replace(/^\+/, "") || "";
  const waPhone = cleanPhone.startsWith("1") || cleanPhone.length > 10 ? cleanPhone : `1868${cleanPhone}`;
  const waLink = businessPhone
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(`Hi, I'm interested in ${item.name}`)}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-2xl max-h-[95vh] sm:max-h-[90vh] bg-[#12121a] sm:rounded-2xl overflow-y-auto border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/50 backdrop-blur text-white/70 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {item.imageUrl ? (
          <div className="w-full h-56 sm:h-72 overflow-hidden">
            <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
          </div>
        ) : (
          <ModalPlaceholder name={item.name} color={itemAccent} />
        )}

        <div className="p-5 sm:p-6 space-y-5">
          {badge && (
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
              {badge.label}
            </span>
          )}

          <h2 className="text-2xl font-bold text-white leading-tight">{item.name}</h2>

          <div className="flex items-center gap-4">
            <span className="text-2xl font-bold" style={{ color: primaryColor }}>
              {formatPrice(item.price, item.currency)}
            </span>
            {item.duration && (
              <span className="flex items-center gap-1.5 text-sm text-white/50">
                <Clock className="w-4 h-4" /> {item.duration} min
              </span>
            )}
          </div>

          {item.description && (
            <p className="text-sm text-white/60 leading-relaxed whitespace-pre-line">{item.description}</p>
          )}

          <div className="flex flex-wrap gap-3 py-2">
            <div className="flex items-center gap-1.5 text-xs text-white/40">
              <Star className="w-3.5 h-3.5" style={{ color: primaryColor }} />
              Quality Guaranteed
            </div>
            <div className="flex items-center gap-1.5 text-xs text-white/40">
              <Shield className="w-3.5 h-3.5" style={{ color: primaryColor }} />
              Secure Booking
            </div>
            <div className="flex items-center gap-1.5 text-xs text-white/40">
              <Zap className="w-3.5 h-3.5" style={{ color: primaryColor }} />
              Instant Confirmation
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-medium bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition-all"
              >
                <MessageCircle className="w-4 h-4" />
                Ask about this
              </a>
            )}

            {isInCart ? (
              <button
                onClick={() => removeFromCart(item.id, item.itemType)}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-medium transition-all text-emerald-400 bg-emerald-400/10 hover:bg-red-400/10 hover:text-red-400"
              >
                <CheckCircle2 className="w-4 h-4" />
                In Cart — Remove
              </button>
            ) : (
              <button
                onClick={() => addToCart(item)}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-medium transition-all hover:scale-[1.02]"
                style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}
              >
                <Plus className="w-4 h-4" />
                Add to Cart
              </button>
            )}
          </div>

          {relatedItems.length > 0 && (
            <div className="pt-4 border-t border-white/10 space-y-3">
              <h3 className="text-sm font-semibold text-white/60">You might also like</h3>
              <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
                {relatedItems.slice(0, 4).map((ri) => {
                  const riAccent = ri.itemType === "service" ? primaryColor : ri.itemType === "product" ? secondaryColor : brandAccent;
                  return (
                    <button
                      key={`${ri.id}_${ri.itemType}`}
                      onClick={() => onSelectItem(ri)}
                      className="flex-shrink-0 w-36 rounded-xl border border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06] transition-all overflow-hidden text-left"
                    >
                      {ri.imageUrl ? (
                        <div className="w-full h-20 overflow-hidden">
                          <img src={ri.imageUrl} alt={ri.name} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div
                          className="w-full h-20 flex items-center justify-center text-2xl font-bold"
                          style={{
                            background: `linear-gradient(135deg, ${riAccent}15, ${riAccent}08)`,
                            color: `${riAccent}40`,
                          }}
                        >
                          {ri.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="p-2 space-y-1">
                        <p className="text-xs font-medium text-white truncate">{ri.name}</p>
                        <p className="text-xs font-semibold" style={{ color: primaryColor }}>
                          {formatPrice(ri.price, ri.currency)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
