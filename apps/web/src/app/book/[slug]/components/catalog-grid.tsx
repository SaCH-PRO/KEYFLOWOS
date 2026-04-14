"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import {
  Search,
  Clock,
  Plus,
  Minus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Package,
  ShoppingBag,
  Wrench,
  Gift,
  X,
  SlidersHorizontal,
  Star,
  TrendingUp,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import type { CatalogItem, FilterTab, SortOption, ReviewAggregate } from "./types";
import { typeBadge } from "./utils";
import { getThemeStyles, getTabClasses, getButtonStyles, getItemAccent, type ThemeKey } from "@/lib/storefront-themes";
import type { StorefrontConfig } from "@/lib/client";
import { Heart } from "lucide-react";
import { StarRatingDisplay } from "./review-display";

type Props = {
  catalogItems: CatalogItem[];
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  isInCart: (itemId: string, itemType: string) => boolean;
  addToCart: (item: CatalogItem) => void;
  removeFromCart: (itemId: string, itemType: string) => void;
  onUpdateQuantity?: (itemId: string, itemType: string, delta: number) => void;
  cartItems?: { id: string; itemType: string; quantity: number }[];
  badges?: Record<string, string>;
  featuredItemIds?: string[];
  onItemClick?: (item: CatalogItem) => void;
  config?: StorefrontConfig | null;
  reviewAggregates?: Record<string, ReviewAggregate>;
  isWishlisted?: (itemId: string) => boolean;
  onToggleWishlist?: (item: CatalogItem) => void;
};

const catalogBadgeConfig: Record<string, { label: string; icon: typeof Star; gradient: string }> = {
  popular: { label: "Popular", icon: TrendingUp, gradient: "from-amber-500/30 to-orange-500/30" },
  new: { label: "New", icon: Sparkles, gradient: "from-emerald-500/30 to-teal-500/30" },
  best_seller: { label: "Best Seller", icon: Star, gradient: "from-violet-500/30 to-purple-500/30" },
  limited: { label: "Limited", icon: Clock, gradient: "from-red-500/30 to-rose-500/30" },
};

const filterIcons: Record<string, typeof Package> = {
  all: ShoppingBag,
  service: Wrench,
  product: Package,
  package: Gift,
};

export function CatalogGrid({
  catalogItems,
  primaryColor,
  secondaryColor,
  accentColor,
  isInCart,
  addToCart,
  removeFromCart,
  onUpdateQuantity,
  cartItems,
  badges,
  featuredItemIds,
  onItemClick,
  config,
  reviewAggregates,
  isWishlisted,
  onToggleWishlist,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [sortOption, setSortOption] = useState<SortOption>("default");
  const [sortOpen, setSortOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  const theme = (config?.appearance?.theme ?? "default") as ThemeKey;
  const cardStylePref = config?.appearance?.cardStyle ?? "grid";
  const showPrices = config?.appearance?.showPrices ?? true;
  const showDuration = config?.appearance?.showDuration ?? true;
  const ts = getThemeStyles(theme, primaryColor, secondaryColor, accentColor);
  const btnStyles = getButtonStyles(ts, primaryColor);

  const hasServices = catalogItems.some((i) => i.itemType === "service");
  const hasProducts = catalogItems.some((i) => i.itemType === "product");
  const hasPackages = catalogItems.some((i) => i.itemType === "package");

  const tabCounts = useMemo(() => ({
    all: catalogItems.length,
    service: catalogItems.filter((i) => i.itemType === "service").length,
    product: catalogItems.filter((i) => i.itemType === "product").length,
    package: catalogItems.filter((i) => i.itemType === "package").length,
  }), [catalogItems]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    }
    if (sortOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [sortOpen]);

  const sortedCatalog = useMemo(() => {
    if (!featuredItemIds || featuredItemIds.length === 0) return catalogItems;
    const featuredSet = new Set(featuredItemIds);
    return [...catalogItems].sort((a, b) => {
      const aF = featuredSet.has(a.id) ? 0 : 1;
      const bF = featuredSet.has(b.id) ? 0 : 1;
      return aF - bF;
    });
  }, [catalogItems, featuredItemIds]);

  const filteredItems = useMemo(() => {
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
    else if (sortOption === "highest_rated" && reviewAggregates)
      items = [...items].sort((a, b) => (reviewAggregates[b.id]?.averageRating ?? 0) - (reviewAggregates[a.id]?.averageRating ?? 0));
    return items;
  }, [sortedCatalog, activeTab, searchQuery, sortOption, reviewAggregates]);

  const sortLabels: Record<SortOption, string> = {
    default: "Default",
    price_asc: "Price: Low → High",
    price_desc: "Price: High → Low",
    duration: "Duration",
    highest_rated: "Highest Rated",
  };

  function renderGridCard(item: CatalogItem) {
    const inCart = isInCart(item.id, item.itemType);
    const badge = typeBadge(item.itemType, primaryColor, secondaryColor, accentColor);
    const ia = getItemAccent(ts, item.itemType);
    const itemColor = ia.color;
    const isFeatured = featuredItemIds?.includes(item.id);
    const itemBadge = badges?.[item.id] ? catalogBadgeConfig[badges[item.id]] : null;
    const reviewAgg = reviewAggregates?.[item.id];
    const wishlisted = isWishlisted?.(item.id);
    const hasHighRating = reviewAgg && reviewAgg.averageRating >= 4;

    return (
      <div
        key={`${item.id}_${item.itemType}`}
        className={`${ts.cardRadius} border backdrop-blur-xl transition-all duration-300 group cursor-pointer relative overflow-hidden ${ts.fontClass}`}
        style={{
          background: inCart
            ? `linear-gradient(135deg, ${itemColor}08, ${itemColor}04)`
            : ts.cardBg,
          border: inCart ? `1px solid ${itemColor}30` : ts.cardBorder,
          boxShadow: inCart
            ? `0 0 20px ${itemColor}10, ${ts.cardShadow}`
            : ts.cardShadow,
          transform: "translateZ(0)",
        }}
        onClick={() => onItemClick?.(item)}
        onMouseEnter={(e) => {
          const el = e.currentTarget;
          el.style.transform = "translateY(-4px) translateZ(0)";
          el.style.boxShadow = `0 12px 40px ${itemColor}15, 0 4px 12px rgba(0,0,0,0.3)`;
          el.style.border = inCart ? `1px solid ${itemColor}50` : ts.cardBorderHover;
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget;
          el.style.transform = "translateZ(0)";
          el.style.boxShadow = inCart ? `0 0 20px ${itemColor}10` : (ts.cardShadow || "none");
          el.style.border = inCart ? `1px solid ${itemColor}30` : ts.cardBorder;
        }}
      >
        {isFeatured && (
          <div
            className="absolute top-0 left-0 right-0 h-[2px] z-10"
            style={{ background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})` }}
          />
        )}

        <div className="relative overflow-hidden">
          {item.imageUrl ? (
            <div className={`w-full ${ts.imageHeight} overflow-hidden`}
              style={{ borderTopLeftRadius: "inherit", borderTopRightRadius: "inherit" }}>
              <img
                src={item.imageUrl}
                alt={item.name}
                loading="lazy"
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
          ) : (
            <div
              className={`w-full ${ts.imageHeight} flex items-center justify-center text-4xl ${ts.headerWeight} relative overflow-hidden`}
              style={{
                background: ia.bg,
                color: `${itemColor}50`,
                borderTopLeftRadius: "inherit",
                borderTopRightRadius: "inherit",
              }}
            >
              <span className="relative z-10 transition-transform duration-300 group-hover:scale-110">
                {item.name.charAt(0).toUpperCase()}
              </span>
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  background: `radial-gradient(circle at 30% 50%, ${itemColor}15, transparent 60%)`,
                }}
              />
            </div>
          )}

          {itemBadge && (
            <span
              className={`absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold backdrop-blur-md bg-gradient-to-r ${itemBadge.gradient} border border-gray-200 shadow-lg`}
              style={{ color: "white" }}
            >
              <itemBadge.icon className="w-3 h-3" />
              {itemBadge.label}
            </span>
          )}

          {isFeatured && !itemBadge && (
            <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold backdrop-blur-md bg-gradient-to-r from-amber-500/30 to-orange-500/30 border border-gray-200 text-gray-900 shadow-lg">
              <Star className="w-3 h-3" />
              Featured
            </span>
          )}

          {onToggleWishlist && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleWishlist(item); }}
              className="absolute top-2.5 left-2.5 w-8 h-8 rounded-full backdrop-blur-md flex items-center justify-center transition-all hover:scale-110 z-10"
              style={{
                backgroundColor: wishlisted ? `${primaryColor}30` : "rgba(0,0,0,0.4)",
                border: wishlisted ? `1px solid ${primaryColor}40` : "1px solid rgba(0,0,0,0.06)",
              }}
              title={wishlisted ? "Remove from wishlist" : "Save for later"}
            >
              <Heart
                className="w-3.5 h-3.5 transition-colors"
                style={{ color: wishlisted ? primaryColor : "rgba(0,0,0,0.5)" }}
                fill={wishlisted ? primaryColor : "none"}
              />
            </button>
          )}
        </div>

        <div className={`${ts.spacing === "relaxed" ? "p-5" : "p-4"} space-y-3`}>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold ${ts.badgeRadius} transition-colors duration-200`}
              style={{ backgroundColor: `${badge.color}15`, color: badge.color }}
            >
              {badge.label}
            </span>
          </div>

          <div className="flex items-start justify-between gap-2">
            <h4 className={`${ts.nameSize} ${ts.headerWeight} text-gray-900 leading-tight ${ts.textStyle} group-hover:text-gray-900 transition-colors`}>
              {item.name}
            </h4>
            {showPrices && (
              <div
                className={`text-base ${ts.priceWeight} whitespace-nowrap tabular-nums`}
                style={{ color: itemColor }}
              >
                {formatPrice(item.price, item.currency)}
              </div>
            )}
          </div>

          {item.description && (
            <p className={`${ts.descSize} text-gray-900/45 line-clamp-2 leading-relaxed ${ts.bodyWeight}`}>
              {item.description}
            </p>
          )}

          {reviewAgg && reviewAgg.reviewCount > 0 && (
            <StarRatingDisplay rating={reviewAgg.averageRating} count={reviewAgg.reviewCount} />
          )}

          <div className="flex items-center justify-between pt-1">
            {showDuration && item.duration ? (
              <span className={`flex items-center gap-1.5 ${ts.descSize} text-gray-900/35 bg-gray-50 px-2 py-1 rounded-lg`}>
                <Clock className="w-3 h-3" /> {item.duration} min
              </span>
            ) : (
              <span />
            )}
            {inCart ? (
              item.itemType === "service" ? (
                <button
                  onClick={(e) => { e.stopPropagation(); removeFromCart(item.id, item.itemType); }}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 ${ts.buttonRadius} text-xs font-medium transition-all duration-200 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Added
                </button>
              ) : (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onUpdateQuantity ? onUpdateQuantity(item.id, item.itemType, -1) : removeFromCart(item.id, item.itemType)}
                    className={`w-8 h-8 min-h-[44px] min-w-[44px] ${ts.buttonRadius} bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center transition-all duration-200 hover:bg-red-500/10 hover:border-red-500/20 group/minus active:scale-90`}
                  >
                    <Minus className="w-3 h-3 text-emerald-400 group-hover/minus:text-red-400" />
                  </button>
                  <span className="w-6 text-center text-xs font-semibold tabular-nums text-emerald-400">
                    {cartItems?.find((c) => c.id === item.id && c.itemType === item.itemType)?.quantity ?? 1}
                  </span>
                  <button
                    onClick={() => onUpdateQuantity ? onUpdateQuantity(item.id, item.itemType, 1) : addToCart(item)}
                    className={`w-8 h-8 min-h-[44px] min-w-[44px] ${ts.buttonRadius} bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center transition-all duration-200 hover:bg-emerald-500/20 active:scale-90`}
                  >
                    <Plus className="w-3 h-3 text-emerald-400" />
                  </button>
                </div>
              )
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); addToCart(item); }}
                className={`${btnStyles.className} shadow-sm hover:shadow-md active:scale-95`}
                style={btnStyles.style}
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            )}
          </div>
        </div>

        {hasHighRating && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: `linear-gradient(90deg, #f59e0b, ${primaryColor})` }} />
        )}
      </div>
    );
  }

  function renderListCard(item: CatalogItem) {
    const inCart = isInCart(item.id, item.itemType);
    const badge = typeBadge(item.itemType, primaryColor, secondaryColor, accentColor);
    const ia = getItemAccent(ts, item.itemType);
    const itemColor = ia.color;
    const isFeatured = featuredItemIds?.includes(item.id);
    const itemBadge = badges?.[item.id] ? catalogBadgeConfig[badges[item.id]] : null;
    const reviewAgg = reviewAggregates?.[item.id];

    return (
      <div
        key={`${item.id}_${item.itemType}`}
        className={`${ts.cardRadius} border backdrop-blur-xl transition-all duration-300 group cursor-pointer ${ts.fontClass} flex gap-4 ${ts.spacing === "relaxed" ? "p-4" : "p-3"} relative overflow-hidden`}
        style={{
          background: inCart
            ? `linear-gradient(135deg, ${itemColor}08, ${itemColor}04)`
            : ts.cardBg,
          border: inCart ? `1px solid ${itemColor}30` : ts.cardBorder,
          boxShadow: ts.cardShadow,
        }}
        onClick={() => onItemClick?.(item)}
        onMouseEnter={(e) => {
          const el = e.currentTarget;
          el.style.transform = "translateX(4px)";
          el.style.boxShadow = `0 4px 20px ${itemColor}10`;
          el.style.border = ts.cardBorderHover;
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget;
          el.style.transform = "translateX(0)";
          el.style.boxShadow = ts.cardShadow || "none";
          el.style.border = inCart ? `1px solid ${itemColor}30` : ts.cardBorder;
        }}
      >
        {isFeatured && (
          <div
            className="absolute top-0 left-0 bottom-0 w-[2px]"
            style={{ background: `linear-gradient(180deg, ${primaryColor}, ${secondaryColor})` }}
          />
        )}

        {item.imageUrl ? (
          <div className="w-24 h-24 flex-shrink-0 overflow-hidden relative" style={{ borderRadius: "inherit" }}>
            <img src={item.imageUrl} alt={item.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
          </div>
        ) : (
          <div
            className={`w-24 h-24 flex-shrink-0 flex items-center justify-center text-3xl ${ts.headerWeight} relative overflow-hidden`}
            style={{
              background: ia.bg,
              color: `${itemColor}50`,
              borderRadius: "inherit",
            }}
          >
            <span className="relative z-10 group-hover:scale-110 transition-transform duration-300">
              {item.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold ${ts.badgeRadius}`}
                  style={{ backgroundColor: `${badge.color}15`, color: badge.color }}
                >
                  {badge.label}
                </span>
                {itemBadge && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gradient-to-r ${itemBadge.gradient} border border-gray-200 text-gray-900`}>
                    <itemBadge.icon className="w-2.5 h-2.5" />
                    {itemBadge.label}
                  </span>
                )}
              </div>
              <h4 className={`${ts.nameSize} ${ts.headerWeight} text-gray-900 leading-tight ${ts.textStyle}`}>{item.name}</h4>
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              {showPrices && (
                <div className={`text-base ${ts.priceWeight} whitespace-nowrap tabular-nums`} style={{ color: itemColor }}>
                  {formatPrice(item.price, item.currency)}
                </div>
              )}
            </div>
          </div>
          {item.description && (
            <p className={`${ts.descSize} text-gray-900/45 line-clamp-2 leading-relaxed ${ts.bodyWeight}`}>{item.description}</p>
          )}
          {reviewAgg && reviewAgg.reviewCount > 0 && (
            <StarRatingDisplay rating={reviewAgg.averageRating} count={reviewAgg.reviewCount} />
          )}
          <div className="flex items-center justify-between pt-0.5">
            {showDuration && item.duration ? (
              <span className={`flex items-center gap-1.5 ${ts.descSize} text-gray-900/35 bg-gray-50 px-2 py-1 rounded-lg`}>
                <Clock className="w-3 h-3" /> {item.duration} min
              </span>
            ) : (
              <span />
            )}
            {inCart ? (
              item.itemType === "service" ? (
                <button
                  onClick={(e) => { e.stopPropagation(); removeFromCart(item.id, item.itemType); }}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 ${ts.buttonRadius} text-xs font-medium transition-all duration-200 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Added
                </button>
              ) : (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onUpdateQuantity ? onUpdateQuantity(item.id, item.itemType, -1) : removeFromCart(item.id, item.itemType)}
                    className={`w-8 h-8 min-h-[44px] min-w-[44px] ${ts.buttonRadius} bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center transition-all duration-200 hover:bg-red-500/10 hover:border-red-500/20 group/minus active:scale-90`}
                  >
                    <Minus className="w-3 h-3 text-emerald-400 group-hover/minus:text-red-400" />
                  </button>
                  <span className="w-6 text-center text-xs font-semibold tabular-nums text-emerald-400">
                    {cartItems?.find((c) => c.id === item.id && c.itemType === item.itemType)?.quantity ?? 1}
                  </span>
                  <button
                    onClick={() => onUpdateQuantity ? onUpdateQuantity(item.id, item.itemType, 1) : addToCart(item)}
                    className={`w-8 h-8 min-h-[44px] min-w-[44px] ${ts.buttonRadius} bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center transition-all duration-200 hover:bg-emerald-500/20 active:scale-90`}
                  >
                    <Plus className="w-3 h-3 text-emerald-400" />
                  </button>
                </div>
              )
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); addToCart(item); }}
                className={`${btnStyles.className} shadow-sm hover:shadow-md active:scale-95`}
                style={btnStyles.style}
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const tabs = [
    ["all", "All"],
    ...(hasServices ? [["service", "Services"]] : []),
    ...(hasProducts ? [["product", "Products"]] : []),
    ...(hasPackages ? [["package", "Packages"]] : []),
  ] as [FilterTab, string][];

  const [sectionVisible, setSectionVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setSectionVisible(true); obs.disconnect(); }
    }, { threshold: 0.08 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (catalogItems.length === 0) {
    return (
      <div className={`${ts.cardRadius} border border-gray-200 bg-gradient-to-br from-white/[0.03] to-white/[0.01] backdrop-blur-xl p-16 text-center space-y-5 ${ts.fontClass}`}>
        <div className="w-20 h-20 mx-auto rounded-2xl bg-gray-50 flex items-center justify-center">
          <Sparkles className="w-10 h-10 text-gray-300" />
        </div>
        <div className="space-y-2">
          <h2 className={`text-xl ${ts.headerWeight} text-gray-600 ${ts.textStyle}`}>Coming Soon</h2>
          <p className={`text-sm text-gray-400 max-w-sm mx-auto leading-relaxed ${ts.bodyWeight}`}>
            This business is setting up their online store. Check back soon for services, products, and packages!
          </p>
        </div>
        <div className="flex items-center justify-center gap-6 pt-2">
          {["Services", "Products", "Packages"].map((label) => (
            <div key={label} className="flex items-center gap-1.5 text-xs text-gray-300">
              <div className="w-1.5 h-1.5 rounded-full bg-gray-200" />
              {label}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={sectionRef}
      className={`space-y-6 ${ts.fontClass}`}
      style={{
        opacity: sectionVisible ? 1 : 0,
        transform: sectionVisible ? "translateY(0)" : "translateY(16px)",
        transition: "opacity 0.6s ease-out, transform 0.6s ease-out",
      }}
    >
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 group/search">
          <Search
            className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors duration-200 ${
              searchFocused ? "text-gray-500" : "text-gray-900/25"
            }`}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search services, products..."
            className={`w-full pl-10 pr-10 py-2.5 ${ts.searchRadius} border text-sm text-gray-900 placeholder:text-gray-900/25 focus:outline-none transition-all duration-200`}
            style={{
              background: ts.searchBg,
              borderColor: searchFocused ? `${primaryColor}50` : ts.searchBorder,
              boxShadow: searchFocused ? `0 0 0 3px ${primaryColor}15, 0 2px 12px ${primaryColor}10` : "none",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 w-7 h-7 min-h-[44px] min-w-[44px] rounded-full bg-gray-200/50 flex items-center justify-center hover:bg-gray-200 transition-colors"
            >
              <X className="w-3 h-3 text-gray-500" />
            </button>
          )}
        </div>

        <div className="relative" ref={sortRef}>
          <button
            onClick={() => setSortOpen(!sortOpen)}
            className={`flex items-center gap-2 px-4 py-2.5 ${ts.searchRadius} border text-sm transition-all duration-200 hover:bg-gray-50`}
            style={{
              borderColor: sortOpen ? `${primaryColor}40` : "rgba(0,0,0,0.05)",
              backgroundColor: sortOpen ? "rgba(0,0,0,0.03)" : "rgba(0,0,0,0.02)",
              color: sortOption !== "default" ? primaryColor : "rgba(0,0,0,0.4)",
            }}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{sortLabels[sortOption]}</span>
            <span className="sm:hidden">Sort</span>
            {sortOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {sortOpen && (
            <div
              className={`absolute right-0 top-full mt-2 w-52 ${ts.cardRadius} border border-gray-200 bg-white/95 backdrop-blur-2xl shadow-2xl z-30 overflow-hidden`}
              style={{ animation: "fadeSlideDown 0.15s ease-out" }}
            >
              {(Object.entries(sortLabels) as [SortOption, string][]).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => { setSortOption(val); setSortOpen(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-all duration-150 flex items-center justify-between ${
                    sortOption === val
                      ? "text-gray-900 bg-gray-100"
                      : "text-gray-900/45 hover:text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {label}
                  {sortOption === val && (
                    <CheckCircle2 className="w-3.5 h-3.5" style={{ color: primaryColor }} />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {tabs.map(([tab, label]) => {
          const TabIcon = filterIcons[tab] || ShoppingBag;
          const count = tabCounts[tab];
          const tabProps = getTabClasses(ts, activeTab === tab, primaryColor);
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`${tabProps.className} flex items-center gap-1.5 group/tab`}
              style={tabProps.style}
            >
              <TabIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${activeTab === tab ? "scale-110" : "group-hover/tab:scale-105"}`} />
              {label}
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full transition-all duration-200 ${
                  activeTab === tab ? "bg-white/15 text-gray-800" : "bg-gray-100 text-gray-400"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {searchQuery && (
        <div className="flex items-center gap-2 text-xs text-gray-900/35">
          <Search className="w-3 h-3" />
          <span>
            {filteredItems.length} result{filteredItems.length !== 1 ? "s" : ""} for &ldquo;{searchQuery}&rdquo;
          </span>
          {activeTab !== "all" && (
            <span className="text-gray-300">
              in {tabs.find(([t]) => t === activeTab)?.[1]}
            </span>
          )}
        </div>
      )}

      {filteredItems.length > 0 ? (
        cardStylePref === "list" ? (
          <div className="space-y-3">
            {filteredItems.map((item) => (
              <div key={`${item.id}_${item.itemType}`} className="animate-[fadeIn_0.3s_ease-out]">
                {renderListCard(item)}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
            {filteredItems.map((item, idx) => (
              <div
                key={`${item.id}_${item.itemType}`}
                className="animate-[fadeIn_0.3s_ease-out]"
                style={{ animationDelay: `${idx * 50}ms`, animationFillMode: "backwards" }}
              >
                {renderGridCard(item)}
              </div>
            ))}
          </div>
        )
      ) : (
        <div className={`${ts.cardRadius} border border-gray-200 bg-gradient-to-br from-white/[0.03] to-white/[0.01] backdrop-blur-xl p-12 text-center space-y-4`}>
          <div className="w-14 h-14 mx-auto rounded-xl bg-gray-100 flex items-center justify-center">
            <Search className="w-7 h-7 text-gray-300" />
          </div>
          <div className="space-y-1.5">
            <p className={`text-sm ${ts.headerWeight} text-gray-500`}>No items found</p>
            <p className={`text-xs text-gray-400 ${ts.bodyWeight}`}>
              {searchQuery
                ? `Try a different search term or browse all categories`
                : `No items available in this category`}
            </p>
          </div>
          {(searchQuery || activeTab !== "all") && (
            <button
              onClick={() => { setSearchQuery(""); setActiveTab("all"); }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium text-gray-500 bg-gray-100 hover:bg-gray-100 transition-all duration-200"
            >
              <X className="w-3 h-3" /> Clear filters
            </button>
          )}
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeSlideDown {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
