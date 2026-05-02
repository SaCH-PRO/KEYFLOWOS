"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import {
  Store,
  Briefcase,
  ShoppingBag,
  Package,
  Search,
  Filter,
  ChevronDown,
  X,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  GripVertical,
  Eye,
  EyeOff,
  Edit3,
  Tag,
  Clock,
  TrendingUp,
  Layers,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { Product } from "@/lib/client";
import type { BadgeType, CatalogVisibilityRule, CatalogItemOverride } from "@/lib/client";
import { formatPrice } from "@/lib/format";

function formatRelativeTime(dateStr: string | undefined | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-TT", { month: "short", day: "numeric" });
}

type Props = {
  products: Product[];
  liveProductIds: Set<string>;
  graphProductToServiceMap: Map<string, string>;
  storeItemCount: number;
  processingItems: Set<string>;
  confirmRemove: string | null;
  onToggleItem: (product: Product) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onConfirmRemoveChange: (id: string | null) => void;
  onDeleteFromStore: (serviceId: string, productName?: string) => void;
  services: { id: string; name: string }[];
  onReorder?: (orderedIds: string[]) => void;
  itemOverrides?: Record<string, CatalogItemOverride>;
  onItemOverrideChange?: (productId: string, override: Partial<CatalogItemOverride>) => void;
  categoryEmphasis?: Record<string, "high" | "medium" | "low" | "default">;
  onCategoryEmphasisChange?: (category: string, emphasis: "high" | "medium" | "low" | "default") => void;
};

const BADGE_OPTIONS: { value: BadgeType | "none"; label: string; color: string }[] = [
  { value: "none", label: "None", color: "hsl(var(--kf-muted-foreground))" },
  { value: "popular", label: "Popular", color: "hsl(45 93% 55%)" },
  { value: "new", label: "New", color: "hsl(160 84% 39%)" },
  { value: "best_seller", label: "Best Seller", color: "hsl(263 70% 58%)" },
  { value: "limited", label: "Limited", color: "hsl(0 72% 51%)" },
  { value: "sale", label: "Sale", color: "hsl(340 82% 52%)" },
  { value: "best_value", label: "Best Value", color: "hsl(199 89% 48%)" },
  { value: "fast_delivery", label: "Fast Delivery", color: "hsl(142 70% 45%)" },
  { value: "book_today", label: "Book Today", color: "hsl(28 90% 55%)" },
  { value: "verified", label: "Verified", color: "hsl(211 90% 55%)" },
  { value: "digital_delivery", label: "Digital Delivery", color: "hsl(271 81% 65%)" },
  { value: "staff_pick", label: "Staff Pick", color: "hsl(335 80% 60%)" },
];

const VISIBILITY_RULES: { value: CatalogVisibilityRule; label: string; icon: React.ElementType; color: string }[] = [
  { value: "visible", label: "Visible", icon: Eye, color: "hsl(142 70% 45%)" },
  { value: "hidden", label: "Hidden", icon: EyeOff, color: "hsl(var(--kf-muted-foreground))" },
  { value: "preorder", label: "Pre-order", icon: Clock, color: "hsl(45 93% 55%)" },
  { value: "low_stock", label: "Low Stock", icon: AlertTriangle, color: "hsl(28 90% 55%)" },
  { value: "consultation_first", label: "Consultation First", icon: Briefcase, color: "hsl(263 70% 58%)" },
  { value: "service_only", label: "Service Only", icon: Tag, color: "hsl(217 91% 60%)" },
  { value: "digital_only", label: "Digital Only", icon: Layers, color: "hsl(271 81% 65%)" },
];

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  SERVICE: Briefcase,
  PRODUCT: ShoppingBag,
  PACKAGE: Package,
};

const CATEGORY_FILTERS = ["ALL", "SERVICE", "PRODUCT", "PACKAGE"] as const;

const EMPHASIS_OPTIONS = [
  { value: "high", label: "High", color: "hsl(142 70% 45%)" },
  { value: "medium", label: "Medium", color: "hsl(45 93% 55%)" },
  { value: "low", label: "Low", color: "hsl(var(--kf-muted-foreground))" },
  { value: "default", label: "Default", color: "hsl(var(--kf-muted-foreground) / 0.5)" },
] as const;

export function CatalogManager({
  products,
  liveProductIds,
  graphProductToServiceMap,
  storeItemCount,
  processingItems,
  confirmRemove,
  onToggleItem,
  onSelectAll,
  onDeselectAll,
  onConfirmRemoveChange,
  onDeleteFromStore,
  services: _services,
  onReorder,
  itemOverrides = {},
  onItemOverrideChange,
  categoryEmphasis = {},
  onCategoryEmphasisChange,
}: Props) {
  const [searchInput, setSearchInput] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [showFilters, setShowFilters] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<"add" | "remove" | null>(null);
  const [orderedProducts, setOrderedProducts] = useState<Product[]>(products);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [showCategoryEmphasis, setShowCategoryEmphasis] = useState(false);
  const [bulkAction, setBulkAction] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const orderDirty = useRef(false);

  useEffect(() => {
    if (!orderDirty.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
      setOrderedProducts((prev) => {
        const prevIds = new Set(prev.map((p) => p.id));
        const productIds = new Set(products.map((p) => p.id));
        const kept = prev.filter((p) => productIds.has(p.id));
        const added = products.filter((p) => !prevIds.has(p.id));
        if (kept.length + added.length === prev.length && added.length === 0) return prev;
        return [...kept, ...added];
      });
    }
  }, [products]);

  const handleReorder = useCallback((newOrder: Product[]) => {
    orderDirty.current = true;
    setOrderedProducts(newOrder);
  }, []);

  const handleReorderComplete = useCallback(() => {
    if (onReorder && orderDirty.current) {
      onReorder(orderedProducts.map((p) => p.id));
    }
    orderDirty.current = false;
  }, [onReorder, orderedProducts]);

  const notAddedCount = products.filter((p) => !liveProductIds.has(p.id)).length;
  const inStoreCount = storeItemCount;

  const isFiltering = categoryFilter !== "ALL" || searchInput.trim() !== "";

  const filteredProducts = (isFiltering ? products : orderedProducts).filter((p) => {
    if (categoryFilter !== "ALL" && p.category !== categoryFilter) return false;
    if (searchInput.trim()) {
      const q = searchInput.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !(p.description || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const categories = Array.from(new Set(products.map((p) => p.category).filter(Boolean)));

  function handleBulkAdd() {
    if (bulkConfirm === "add") {
      onSelectAll();
      setBulkConfirm(null);
    } else {
      setBulkConfirm("add");
    }
  }

  function handleBulkRemove() {
    if (bulkConfirm === "remove") {
      onDeselectAll();
      setBulkConfirm(null);
    } else {
      setBulkConfirm("remove");
    }
  }

  function toggleSelectItem(id: string) {
    setSelectedItems((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function applyBulkAction(action: string) {
    if (selectedItems.size === 0) return;
    const ids = Array.from(selectedItems);
    if (action === "feature") {
      ids.forEach((id) => onItemOverrideChange?.(id, { featured: true }));
    } else if (action === "unfeature") {
      ids.forEach((id) => onItemOverrideChange?.(id, { featured: false }));
    } else if (action === "hide_price") {
      ids.forEach((id) => onItemOverrideChange?.(id, { hidePrice: true }));
    } else if (action === "show_price") {
      ids.forEach((id) => onItemOverrideChange?.(id, { hidePrice: false }));
    } else if (action === "hide") {
      ids.forEach((id) => onItemOverrideChange?.(id, { visibilityRule: "hidden" }));
    } else if (action === "show") {
      ids.forEach((id) => onItemOverrideChange?.(id, { visibilityRule: "visible" }));
    }
    setSelectedItems(new Set());
    setBulkAction(null);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-background) / 0.6)",
        backdropFilter: "blur(20px)",
        border: "1px solid hsl(var(--kf-accent1) / 0.15)",
        boxShadow: "0 4px 24px hsl(var(--kf-accent1) / 0.05)",
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{
          borderBottom: "1px solid hsl(var(--kf-accent1) / 0.1)",
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), transparent)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}
          >
            <Store className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Store Catalog</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Visibility, ordering, and per-item storefront overrides</p>
            <Link
              href="/app/commerce"
              className="inline-flex items-center gap-1 text-[10px] mt-0.5 hover:underline"
              style={{ color: "hsl(var(--kf-accent2))" }}
            >
              <ExternalLink className="w-3 h-3" />
              Manage in Commerce
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="px-2.5 py-1 rounded-full text-[10px] font-semibold"
            style={{ background: "hsl(142 70% 45% / 0.15)", color: "hsl(142 70% 60%)", border: "1px solid hsl(142 70% 45% / 0.2)" }}
          >
            {inStoreCount} In Store
          </span>
          <span
            className="px-2.5 py-1 rounded-full text-[10px] font-semibold"
            style={{ background: "hsl(var(--kf-muted) / 0.5)", color: "hsl(var(--kf-muted-foreground))", border: "1px solid hsl(var(--kf-border))" }}
          >
            {notAddedCount} Not Added
          </span>
        </div>
      </div>

      {categories.length > 0 && onCategoryEmphasisChange && (
        <div
          className="px-4 pt-3"
          style={{ borderBottom: showCategoryEmphasis ? "1px solid hsl(var(--kf-border) / 0.3)" : "none" }}
        >
          <button
            type="button"
            onClick={() => setShowCategoryEmphasis(!showCategoryEmphasis)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2 pb-2"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Category Emphasis
            <ChevronDown className={`w-3 h-3 transition-transform ${showCategoryEmphasis ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence>
            {showCategoryEmphasis && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="pb-3 space-y-2"
              >
                <p className="text-[10px] text-muted-foreground">Elevate certain categories above others in the storefront display.</p>
                {categories.map((cat) => {
                  const current = (categoryEmphasis[cat] ?? "default") as "high" | "medium" | "low" | "default";
                  const Icon = CATEGORY_ICONS[cat] ?? ShoppingBag;
                  return (
                    <div key={cat} className="flex items-center gap-3">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs flex-1">{cat}</span>
                      <div className="flex gap-1">
                        {EMPHASIS_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => onCategoryEmphasisChange(cat, opt.value)}
                            className="text-[9px] px-2 py-0.5 rounded-md transition-all"
                            style={{
                              background: current === opt.value ? `${opt.color}20` : "hsl(var(--kf-muted) / 0.3)",
                              color: current === opt.value ? opt.color : "hsl(var(--kf-muted-foreground))",
                              border: current === opt.value ? `1px solid ${opt.color}30` : "1px solid transparent",
                              fontWeight: current === opt.value ? 600 : 400,
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {products.length > 0 && (
        <div className="px-4 pt-3 pb-2 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search items..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="kf-input w-full pl-10 text-sm"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`kf-btn-secondary inline-flex items-center gap-2 text-sm ${showFilters ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""}`}
            >
              <Filter className="w-4 h-4" />
              Filter
              <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </button>
          </div>

          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap gap-2"
              >
                {CATEGORY_FILTERS.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-all ${categoryFilter === cat ? "kf-btn-primary" : "kf-btn-secondary"}`}
                  >
                    {cat}
                  </button>
                ))}
                {categoryFilter !== "ALL" && (
                  <button
                    onClick={() => { setCategoryFilter("ALL"); setSearchInput(""); }}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <X className="w-3 h-3" /> Clear
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleBulkAdd}
              disabled={products.every((p) => liveProductIds.has(p.id))}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${
                bulkConfirm === "add"
                  ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-400"
                  : "kf-btn-secondary"
              }`}
              style={{ opacity: products.every((p) => liveProductIds.has(p.id)) ? 0.3 : 1 }}
            >
              <CheckCircle2 className="w-3 h-3 inline mr-1" />
              {bulkConfirm === "add" ? "Confirm Add All?" : "Add All"}
            </button>
            {inStoreCount > 0 && (
              <button
                onClick={handleBulkRemove}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${
                  bulkConfirm === "remove"
                    ? "bg-red-500/20 border border-red-500/30 text-red-400"
                    : "kf-btn-secondary text-red-400"
                }`}
              >
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                {bulkConfirm === "remove" ? "Confirm Remove All?" : "Remove All"}
              </button>
            )}
            {bulkConfirm && (
              <button onClick={() => setBulkConfirm(null)} className="text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            )}

            {selectedItems.size > 0 && (
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-[10px] text-muted-foreground">{selectedItems.size} selected</span>
                <select
                  value={bulkAction ?? ""}
                  onChange={(e) => setBulkAction(e.target.value || null)}
                  className="kf-input text-[10px] py-1 pr-6"
                >
                  <option value="">Bulk action...</option>
                  <option value="feature">Feature</option>
                  <option value="unfeature">Unfeature</option>
                  <option value="hide_price">Hide Price</option>
                  <option value="show_price">Show Price</option>
                  <option value="hide">Hide from store</option>
                  <option value="show">Show on store</option>
                </select>
                {bulkAction && (
                  <button
                    onClick={() => applyBulkAction(bulkAction)}
                    className="kf-btn-primary text-[10px] px-2 py-1"
                  >
                    Apply
                  </button>
                )}
                <button onClick={() => setSelectedItems(new Set())} className="text-[10px] text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {filteredProducts.length > 0 ? (
        <div className="p-3 space-y-2">
          {!isFiltering && (
            <p className="text-[10px] text-muted-foreground/50 px-1 flex items-center gap-1">
              <GripVertical className="w-3 h-3" /> Drag to reorder · Click row for per-item overrides
            </p>
          )}
          <Reorder.Group
            axis="y"
            values={filteredProducts}
            onReorder={isFiltering ? () => {} : handleReorder}
            className="space-y-2"
          >
            {filteredProducts.map((p) => (
              <CatalogItem
                key={p.id}
                product={p}
                isOnStore={liveProductIds.has(p.id)}
                isProcessing={processingItems.has(p.id)}
                isConfirming={confirmRemove === p.id}
                isDraggable={!isFiltering}
                isSelected={selectedItems.has(p.id)}
                override={itemOverrides[p.id]}
                onToggle={() => onToggleItem(p)}
                onConfirmRemoveChange={onConfirmRemoveChange}
                onDeleteFromStore={onDeleteFromStore}
                matchedServiceId={graphProductToServiceMap.get(p.id)}
                onDragEnd={handleReorderComplete}
                onSelect={() => toggleSelectItem(p.id)}
                onOverrideChange={onItemOverrideChange ? (upd) => onItemOverrideChange(p.id, upd) : undefined}
                expanded={expandedItem === p.id}
                onExpandToggle={() => setExpandedItem(expandedItem === p.id ? null : p.id)}
              />
            ))}
          </Reorder.Group>

          <div className="flex items-center justify-between pt-2 px-1">
            <span className="text-xs text-muted-foreground">
              {storeItemCount} of {products.length} item{products.length !== 1 ? "s" : ""} displayed on store
            </span>
          </div>
        </div>
      ) : products.length === 0 ? (
        <div className="p-8 text-center space-y-3">
          <Briefcase className="w-10 h-10 mx-auto" style={{ color: "hsl(var(--kf-accent1) / 0.3)" }} />
          <p className="text-sm font-medium">No items in Commerce yet</p>
          <p className="text-xs text-muted-foreground">
            Add products in the{" "}
            <span className="font-medium" style={{ color: "hsl(var(--kf-accent1))" }}>
              Commerce
            </span>{" "}
            page first, then come back here to add them to your store.
          </p>
        </div>
      ) : (
        <div className="p-8 text-center space-y-2">
          <Search className="w-8 h-8 mx-auto text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No items match your search</p>
        </div>
      )}
    </motion.div>
  );
}

function CatalogItem({
  product: p,
  isOnStore,
  isProcessing,
  isConfirming,
  isDraggable,
  isSelected,
  override,
  onToggle,
  onConfirmRemoveChange,
  onDeleteFromStore,
  matchedServiceId,
  onDragEnd,
  onSelect,
  onOverrideChange,
  expanded,
  onExpandToggle,
}: {
  product: Product;
  isOnStore: boolean;
  isProcessing: boolean;
  isConfirming: boolean;
  isDraggable: boolean;
  isSelected: boolean;
  override?: CatalogItemOverride;
  onToggle: () => void;
  onConfirmRemoveChange: (id: string | null) => void;
  onDeleteFromStore: (serviceId: string, productName?: string) => void;
  matchedServiceId?: string;
  onDragEnd: () => void;
  onSelect: () => void;
  onOverrideChange?: (upd: Partial<CatalogItemOverride>) => void;
  expanded: boolean;
  onExpandToggle: () => void;
}) {
  const visibilityRule = override?.visibilityRule ?? "visible";
  const isHidden = visibilityRule === "hidden";
  const currentBadge = override?.badge;
  const badgeOpt = BADGE_OPTIONS.find((b) => b.value === currentBadge);
  const visOpt = VISIBILITY_RULES.find((v) => v.value === visibilityRule);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [visOpen, setVisOpen] = useState(false);

  return (
    <Reorder.Item
      value={p}
      dragListener={isDraggable}
      onDragEnd={onDragEnd}
      className={`w-full rounded-xl overflow-hidden transition-all ${isProcessing ? "opacity-60 pointer-events-none" : ""}`}
      style={{
        border: isSelected
          ? "1px solid hsl(var(--kf-accent2) / 0.4)"
          : isOnStore
          ? "1px solid hsl(var(--kf-accent1) / 0.25)"
          : "1px solid hsl(var(--kf-border) / 0.5)",
      }}
    >
      <div
        className="relative flex items-center gap-3 px-4 py-3.5 text-left text-sm"
        style={{
          backgroundColor: isSelected
            ? "hsl(var(--kf-accent2) / 0.06)"
            : isOnStore
            ? "hsl(var(--kf-accent1) / 0.08)"
            : "hsl(var(--kf-muted) / 0.3)",
          cursor: isDraggable ? "grab" : "pointer",
        }}
      >
        {isConfirming && (
          <div
            className="absolute inset-0 rounded-xl flex items-center justify-center gap-3 z-10"
            style={{ background: "hsl(var(--kf-background) / 0.95)", backdropFilter: "blur(8px)", border: "1px solid hsl(0 70% 50% / 0.3)" }}
          >
            <span className="text-sm font-medium" style={{ color: "hsl(var(--kf-error))" }}>Remove from store?</span>
            <button onClick={(e) => { e.stopPropagation(); onConfirmRemoveChange(null); }} className="kf-btn-secondary text-xs min-h-[44px]">Cancel</button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (matchedServiceId) onDeleteFromStore(matchedServiceId, p.name);
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium min-h-[44px] transition-colors"
              style={{ background: "hsl(var(--kf-error) / 0.2)", border: "1px solid hsl(var(--kf-error) / 0.3)", color: "hsl(var(--kf-error))" }}
            >
              Confirm
            </button>
          </div>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-all"
          style={{
            borderColor: isSelected ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-border))",
            background: isSelected ? "hsl(var(--kf-accent2))" : "transparent",
          }}
        >
          {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
        </button>

        {isDraggable && (
          <GripVertical className="w-4 h-4 flex-shrink-0 cursor-grab" style={{ color: "hsl(var(--kf-muted-foreground) / 0.4)" }} />
        )}

        <button
          onClick={(e) => { e.stopPropagation(); if (!isProcessing) onToggle(); }}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
          aria-label={isOnStore ? "Remove from store" : "Add to store"}
        >
          <div
            className="h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all"
            style={isOnStore ? { backgroundColor: "hsl(var(--kf-accent1))", borderColor: "hsl(var(--kf-accent1))" } : { borderColor: "hsl(var(--kf-muted-foreground)/0.3)" }}
          >
            {isProcessing ? (
              <div className="w-3 h-3 border-2 border-[hsl(var(--kf-accent1)/0.4)] border-t-[hsl(var(--kf-accent1))] rounded-full animate-spin" />
            ) : isOnStore ? (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} style={{ color: "white" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : null}
          </div>
        </button>

        {p.imageUrl ? (
          <div className="h-10 w-10 rounded-xl overflow-hidden flex-shrink-0" style={{ border: isOnStore ? "1px solid hsl(var(--kf-accent1) / 0.3)" : "1px solid hsl(var(--kf-border))" }}>
            <Image src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
          </div>
        ) : (
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold"
            style={{
              background: isOnStore ? "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.2), hsl(var(--kf-accent2) / 0.1))" : "hsl(var(--kf-muted))",
              border: isOnStore ? "1px solid hsl(var(--kf-accent1) / 0.3)" : "1px solid hsl(var(--kf-border))",
              color: isOnStore ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))",
            }}
          >
            {p.name.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-medium truncate ${isOnStore ? "" : "text-muted-foreground"}`}>
              {override?.label || p.name}
            </span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full uppercase flex-shrink-0 border"
              style={{ borderColor: "hsl(var(--kf-accent1) / 0.2)", color: "hsl(var(--kf-accent1) / 0.7)" }}
            >
              {p.category}
            </span>
            {isHidden && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "hsl(var(--kf-muted) / 0.4)", color: "hsl(var(--kf-muted-foreground))" }}>
                <EyeOff className="w-2.5 h-2.5 inline mr-0.5" /> Hidden
              </span>
            )}
            {visibilityRule !== "visible" && visibilityRule !== "hidden" && visOpt && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: `${visOpt.color}15`, color: visOpt.color }}>
                {visOpt.label}
              </span>
            )}
            {badgeOpt && badgeOpt.value !== "none" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: `${badgeOpt.color}15`, color: badgeOpt.color }}>
                {badgeOpt.label}
              </span>
            )}
            {override?.hidePrice && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "hsl(var(--kf-muted) / 0.4)", color: "hsl(var(--kf-muted-foreground))" }}>
                Price hidden
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[11px] font-medium" style={{ color: isOnStore ? "hsl(var(--kf-success))" : "hsl(var(--kf-muted-foreground) / 0.6)" }}>
              {isProcessing ? "Processing..." : isOnStore ? "✓ On store" : "Not on store"}
            </span>
            {(() => {

              const updated = formatRelativeTime((p as Record<string, unknown>).updatedAt as string | undefined);
              return updated ? <span className="text-[10px] text-muted-foreground/40">· {updated}</span> : null;
            })()}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
            {formatPrice(p.price, p.currency)}
          </span>
          {onOverrideChange && (
            <button
              onClick={(e) => { e.stopPropagation(); onExpandToggle(); }}
              className="p-1.5 rounded-lg hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Per-item overrides"
            >
              <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {expanded && onOverrideChange && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="px-5 py-4 space-y-3"
              style={{ borderTop: "1px solid hsl(var(--kf-border) / 0.3)", background: "hsl(var(--kf-muted) / 0.1)" }}
            >
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Storefront Overrides</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block">Display Label (override)</label>
                  <input
                    type="text"
                    value={override?.label ?? ""}
                    onChange={(e) => onOverrideChange({ label: e.target.value || undefined })}
                    placeholder={p.name}
                    className="kf-input w-full text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block">Short Description</label>
                  <input
                    type="text"
                    value={override?.shortDescription ?? ""}
                    onChange={(e) => onOverrideChange({ shortDescription: e.target.value || undefined })}
                    placeholder="Short tagline for storefront"
                    className="kf-input w-full text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block">Badge Override</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setBadgeOpen(!badgeOpen)}
                      className="kf-btn-secondary text-[10px] w-full px-2 py-1.5 flex items-center justify-between"
                    >
                      <span style={{ color: badgeOpt && badgeOpt.value !== "none" ? badgeOpt.color : undefined }}>
                        {badgeOpt ? badgeOpt.label : "None"}
                      </span>
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    <AnimatePresence>
                      {badgeOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.1 }}
                          className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-50 max-h-48 overflow-y-auto"
                          style={{ background: "hsl(var(--kf-background) / 0.97)", border: "1px solid hsl(var(--kf-border))", boxShadow: "0 8px 24px hsl(0 0% 0% / 0.3)" }}
                        >
                          {BADGE_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => { onOverrideChange({ badge: opt.value }); setBadgeOpen(false); }}
                              className="w-full text-left text-[10px] px-3 py-1.5 hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors"
                              style={{ color: opt.value !== "none" ? opt.color : undefined }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block">Visibility Rule</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setVisOpen(!visOpen)}
                      className="kf-btn-secondary text-[10px] w-full px-2 py-1.5 flex items-center justify-between"
                    >
                      <span style={{ color: visOpt?.color }}>
                        {visOpt?.label ?? "Visible"}
                      </span>
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    <AnimatePresence>
                      {visOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.1 }}
                          className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-50"
                          style={{ background: "hsl(var(--kf-background) / 0.97)", border: "1px solid hsl(var(--kf-border))", boxShadow: "0 8px 24px hsl(0 0% 0% / 0.3)" }}
                        >
                          {VISIBILITY_RULES.map((opt) => {
                            const VIcon = opt.icon;
                            return (
                              <button
                                key={opt.value}
                                onClick={() => { onOverrideChange({ visibilityRule: opt.value }); setVisOpen(false); }}
                                className="w-full text-left text-[10px] px-3 py-1.5 hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors flex items-center gap-1.5"
                                style={{ color: opt.color }}
                              >
                                <VIcon className="w-3 h-3" /> {opt.label}
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-muted-foreground mb-1 block">Options</label>
                  <div className="space-y-1">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={override?.hidePrice ?? false}
                        onChange={(e) => onOverrideChange({ hidePrice: e.target.checked })}
                        className="rounded"
                      />
                      <span className="text-[10px]">Hide price</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={override?.featured ?? false}
                        onChange={(e) => onOverrideChange({ featured: e.target.checked })}
                        className="rounded"
                      />
                      <span className="text-[10px]">Featured</span>
                    </label>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Section / Rail (optional)</label>
                <input
                  type="text"
                  value={override?.section ?? ""}
                  onChange={(e) => onOverrideChange({ section: e.target.value || undefined })}
                  placeholder="e.g. Summer Picks, New Arrivals"
                  className="kf-input w-full text-xs"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  );
}
