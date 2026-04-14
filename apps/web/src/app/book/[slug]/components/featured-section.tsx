"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Star, Plus, CheckCircle2, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
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
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [visible, setVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const cardW = 260;
    el.scrollBy({ left: dir === "left" ? -cardW : cardW, behavior: "smooth" });
  };

  if (!items || items.length === 0) return null;

  return (
    <section
      ref={sectionRef}
      className="space-y-5"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: "opacity 0.6s ease-out, transform 0.6s ease-out",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${primaryColor}20, ${secondaryColor}15)` }}
          >
            <Sparkles className="w-4 h-4" style={{ color: primaryColor }} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Featured</h3>
            <p className="text-[11px] text-gray-400 font-medium mt-0.5">Handpicked for you</p>
          </div>
        </div>
        {items.length > 2 && (
          <div className="hidden sm:flex items-center gap-1.5">
            <button
              onClick={() => scroll("left")}
              disabled={!canScrollLeft}
              className="w-9 h-9 rounded-xl flex items-center justify-center border border-gray-200 bg-white hover:bg-gray-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px] min-w-[44px]"
              aria-label="Previous items"
            >
              <ChevronLeft className="w-4 h-4 text-gray-500" />
            </button>
            <button
              onClick={() => scroll("right")}
              disabled={!canScrollRight}
              className="w-9 h-9 rounded-xl flex items-center justify-center border border-gray-200 bg-white hover:bg-gray-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px] min-w-[44px]"
              aria-label="Next items"
            >
              <ChevronRight className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        )}
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory"
          style={{ scrollbarWidth: "none" }}
        >
          {items.map((item, idx) => {
            const inCart = isInCart(item.id, item.itemType);
            const itemColor = item.itemType === "service" ? primaryColor : item.itemType === "product" ? secondaryColor : accentColor;
            return (
              <div
                key={`featured_${item.id}`}
                className="flex-shrink-0 w-60 sm:w-64 snap-start rounded-2xl border border-gray-200 bg-white hover:border-gray-300 transition-all duration-300 overflow-hidden cursor-pointer group relative hover:shadow-lg hover:-translate-y-1"
                onClick={() => onItemClick(item)}
                style={{
                  opacity: visible ? 1 : 0,
                  transform: visible ? "translateY(0)" : "translateY(12px)",
                  transition: `opacity 0.5s ${idx * 0.08}s, transform 0.5s ${idx * 0.08}s, box-shadow 0.3s, border-color 0.3s`,
                }}
              >
                <div
                  className="absolute top-0 left-0 right-0 h-[2px] z-10"
                  style={{ background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})` }}
                />
                {item.imageUrl ? (
                  <div className="w-full h-36 overflow-hidden relative">
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  </div>
                ) : (
                  <div
                    className="w-full h-36 flex items-center justify-center text-4xl font-bold relative overflow-hidden"
                    style={{ background: `linear-gradient(135deg, ${itemColor}15, ${itemColor}06)`, color: `${itemColor}35` }}
                  >
                    <span className="relative z-10 group-hover:scale-110 transition-transform duration-300">
                      {item.name.charAt(0).toUpperCase()}
                    </span>
                    <div
                      className="absolute inset-0 opacity-30"
                      style={{ background: `radial-gradient(circle at 30% 50%, ${itemColor}12, transparent 60%)` }}
                    />
                  </div>
                )}
                <div className="p-4 space-y-2.5">
                  <div className="flex items-center gap-1.5">
                    <Star className="w-3 h-3" style={{ color: primaryColor }} fill={primaryColor} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: primaryColor }}>Featured</span>
                  </div>
                  <h4 className="text-sm font-semibold text-gray-800 truncate group-hover:text-gray-900 transition-colors">{item.name}</h4>
                  {item.description && (
                    <p className="text-[12px] text-gray-400 line-clamp-2 leading-relaxed">{item.description}</p>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-sm font-bold tabular-nums" style={{ color: itemColor }}>
                      {formatPrice(item.price, item.currency)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!inCart) addToCart(item);
                      }}
                      className="w-9 h-9 min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center transition-all active:scale-90 hover:scale-105"
                      style={{
                        backgroundColor: inCart ? "rgba(16,185,129,0.12)" : `${primaryColor}12`,
                        color: inCart ? "#34d399" : primaryColor,
                        border: inCart ? "1px solid rgba(16,185,129,0.2)" : `1px solid ${primaryColor}15`,
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
        {canScrollLeft && (
          <div className="absolute left-0 top-0 bottom-3 w-10 bg-gradient-to-r from-white/90 to-transparent pointer-events-none rounded-l-2xl" />
        )}
        {canScrollRight && (
          <div className="absolute right-0 top-0 bottom-3 w-10 bg-gradient-to-l from-white/90 to-transparent pointer-events-none rounded-r-2xl" />
        )}
      </div>
    </section>
  );
}
