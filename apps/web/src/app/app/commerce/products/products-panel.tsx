"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Package, Plus, X, Eye, EyeOff, ArrowUpDown, CheckSquare, Square, Trash2, ToggleLeft, ToggleRight, ChevronDown, Upload, LayoutGrid, List, Camera, Sparkles } from "lucide-react";
import { ProductImportModal } from "./product-import-modal";
import { toast } from "sonner";
import type { Product } from "@/lib/client";
import { bulkUpdateProducts } from "@/lib/client";
import { formatCurrency } from "@/lib/currency";
import type { ProductForm } from "../components/commerce-types";
import type { ProductSlots } from "../utils/commerce-slots";
import { useCommerceSearch } from "../hooks/use-commerce-search";
import { useProductStats } from "../hooks/use-product-stats";
import { ProductCard } from "./product-card";
import { ProductDetailPanel } from "./product-detail-panel";

type ViewMode = "grid" | "list";
function getStoredViewMode(): ViewMode {
  if (typeof window === "undefined") return "grid";
  return (localStorage.getItem("kf-products-view") as ViewMode) || "grid";
}
function storeViewMode(mode: ViewMode) {
  if (typeof window !== "undefined") localStorage.setItem("kf-products-view", mode);
}

interface ProductsPanelProps {
  products: Product[];
  loading: boolean;
  productSearch: string;
  setProductSearch: (value: string) => void;
  onEdit: (product: Product) => void;
  onDelete: (productId: string) => void;
  onDuplicate?: (product: Product) => void;
  onToggleActive?: (product: Product) => void;
  onInlineSave?: (productId: string, form: ProductForm, imageFile?: File | null) => Promise<void>;
  onAdd: () => void;
  setProducts?: React.Dispatch<React.SetStateAction<Product[]>>;
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
  cachedImages?: Record<string, string>;
  businessId?: string | null;
  onBulkAction?: () => void;
  currency?: string;
  onCreateQuote?: (product: Product) => void;
  onCreateInvoice?: (product: Product) => void;
  invoices?: Array<{ items?: Array<{ productId?: string | null }>; status?: string }>;
  quotes?: Array<{ items?: Array<{ productId?: string | null }> }>;
  slots?: ProductSlots;
  onAiPricing?: (product: Product) => void;
  onAiHealthScan?: () => void;
}

const CATEGORY_FILTERS = [
  { value: "ALL", label: "All" },
  { value: "SERVICE", label: "Services" },
  { value: "PRODUCT", label: "Products" },
  { value: "PACKAGE", label: "Packages" },
] as const;

type SortOption = "name-asc" | "name-desc" | "price-asc" | "price-desc" | "newest" | "oldest";
const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "name-asc", label: "Name A → Z" },
  { value: "name-desc", label: "Name Z → A" },
  { value: "price-asc", label: "Price Low → High" },
  { value: "price-desc", label: "Price High → Low" },
];

export const ProductsPanel = React.memo(function ProductsPanel({
  products,
  loading,
  productSearch,
  setProductSearch,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleActive,
  onInlineSave,
  onAdd,
  setProducts,
  deleteConfirm,
  setDeleteConfirm,
  cachedImages = {},
  businessId,
  onBulkAction,
  currency = "TTD",
  onCreateQuote,
  onCreateInvoice,
  invoices = [],
  quotes = [],
  slots,
  onAiPricing,
  onAiHealthScan,
}: ProductsPanelProps) {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode);
  const [showImport, setShowImport] = useState(false);

  const handleViewToggle = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    storeViewMode(mode);
  }, []);

  useEffect(() => {
    if (selectedProduct) {
      const updated = products.find(p => p.id === selectedProduct.id);
      if (updated && updated !== selectedProduct) setSelectedProduct(updated);
      else if (!updated) setSelectedProduct(null);
    }
  }, [products]);

  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [showInactive, setShowInactive] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSortMenu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowSortMenu(false);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const buttons = sortMenuRef.current?.querySelectorAll("button");
        if (!buttons || buttons.length === 0) return;
        const focused = document.activeElement as HTMLElement;
        const idx = Array.from(buttons).indexOf(focused as HTMLButtonElement);
        let next = e.key === "ArrowDown" ? idx + 1 : idx - 1;
        if (next < 0) next = buttons.length - 1;
        if (next >= buttons.length) next = 0;
        buttons[next].focus();
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        sortRef.current && !sortRef.current.contains(target) &&
        sortMenuRef.current && !sortMenuRef.current.contains(target)
      ) {
        setShowSortMenu(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    const menuRef = sortMenuRef.current;
    if (menuRef) {
      const buttons = menuRef.querySelectorAll("button");
      if (buttons.length > 0) buttons[0].focus();
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showSortMenu]);

  const searchableFields = useCallback((p: Product) => {
    const skipKeys = new Set(["id", "imageUrl", "createdAt", "updatedAt", "businessId"]);
    const parts: string[] = [
      p.name,
      p.description || "",
      p.sku || "",
      p.category || "",
      p.currency || "",
      String(p.price),
      p.duration != null ? `${p.duration} min ${p.duration} minutes` : "",
      p.isActive === false ? "inactive" : "active",
    ];
    for (const [k, v] of Object.entries(p)) {
      if (!skipKeys.has(k) && v != null && typeof v !== "object") {
        parts.push(String(v));
      }
    }
    return parts.join(" ");
  }, []);

  const preFilteredProducts = useMemo(() => {
    let result = products;
    if (!showInactive) {
      result = result.filter((p) => p.isActive !== false);
    }
    if (categoryFilter !== "ALL") {
      result = result.filter((p) => p.category === categoryFilter);
    }
    return result;
  }, [products, showInactive, categoryFilter]);

  const { filtered: searchedProducts } = useCommerceSearch(preFilteredProducts, searchableFields, productSearch);

  const filteredProducts = useMemo(() => {
    const sorted = [...searchedProducts];
    switch (sortBy) {
      case "name-asc": sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "name-desc": sorted.sort((a, b) => b.name.localeCompare(a.name)); break;
      case "price-asc": sorted.sort((a, b) => a.price - b.price); break;
      case "price-desc": sorted.sort((a, b) => b.price - a.price); break;
      case "oldest": sorted.sort((a, b) => new Date(String(a.createdAt ?? 0)).getTime() - new Date(String(b.createdAt ?? 0)).getTime()); break;
      case "newest":
      default: sorted.sort((a, b) => new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime()); break;
    }
    return sorted;
  }, [searchedProducts, sortBy]);

  const categoryCounts = useMemo(() => {
    const counts = { ALL: 0, SERVICE: 0, PRODUCT: 0, PACKAGE: 0 };
    for (const p of products) {
      if (!showInactive && p.isActive === false) continue;
      counts.ALL++;
      if (p.category === "SERVICE") counts.SERVICE++;
      else if (p.category === "PRODUCT") counts.PRODUCT++;
      else if (p.category === "PACKAGE") counts.PACKAGE++;
    }
    return counts;
  }, [products, showInactive]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredProducts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProducts.map((p) => p.id)));
    }
  }, [filteredProducts, selectedIds.size]);

  const handleBulkAction = useCallback(async (action: "activate" | "deactivate" | "delete") => {
    if (!businessId || selectedIds.size === 0) return;
    setBulkLoading(true);
    const { data, error } = await bulkUpdateProducts(businessId, Array.from(selectedIds), action);
    setBulkLoading(false);
    if (error) { toast.error(error); return; }
    toast.success(`${data?.updated ?? 0} product(s) ${action === "delete" ? "deleted" : action === "activate" ? "activated" : "deactivated"}`);
    setSelectedIds(new Set());
    setBulkMode(false);
    onBulkAction?.();
  }, [businessId, selectedIds, onBulkAction]);

  const productStats = useProductStats({
    productId: selectedProduct?.id ?? null,
    invoices,
    quotes,
  });

  const handleDetailSave = useCallback(async (form: ProductForm, imageFile?: File | null) => {
    if (onInlineSave && selectedProduct) {
      await onInlineSave(selectedProduct.id, form, imageFile);
    } else if (selectedProduct) {
      setSelectedProduct(null);
      onEdit(selectedProduct);
    }
  }, [onInlineSave, selectedProduct, onEdit]);

  const handleDetailDelete = useCallback((id: string) => {
    setSelectedProduct(null);
    onDelete(id);
  }, [onDelete]);

  const handleDetailDuplicate = useMemo(() => {
    if (!onDuplicate) return undefined;
    return (p: Product) => { setSelectedProduct(null); onDuplicate(p); };
  }, [onDuplicate]);

  const handleDetailToggleActive = useMemo(() => {
    if (!onToggleActive) return undefined;
    return (p: Product) => { onToggleActive(p); setSelectedProduct({ ...p, isActive: !(p.isActive ?? true) }); };
  }, [onToggleActive]);

  const handleDetailClose = useCallback(() => setSelectedProduct(null), []);

  const handleProductClick = useCallback((p: Product) => {
    if (!bulkMode) setSelectedProduct(p);
  }, [bulkMode]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      <div className="rounded-2xl border border-border/50 bg-card p-3 sm:p-4 space-y-3 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
            <input
              type="text"
              placeholder="Search by name, price, category..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              aria-label="Search products"
              className="w-full pl-9 pr-8 py-2 text-sm bg-white/[0.03] border border-border/40 rounded-xl focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 focus:border-[hsl(var(--kf-accent1))]/40 placeholder:text-muted-foreground/40 transition-all"
            />
            {productSearch && (
              <button
                onClick={() => setProductSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-md hover:bg-muted/50 transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3 h-3 text-muted-foreground/50" />
              </button>
            )}
          </div>
          <button
            onClick={onAdd}
            className="p-2 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all flex-shrink-0"
            aria-label="Add product"
            title="Add product"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            <div className="relative" ref={sortRef}>
              <button
                onClick={() => setShowSortMenu(!showSortMenu)}
                className={`p-2 rounded-xl transition-all flex-shrink-0 ${showSortMenu || sortBy !== "newest" ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
                aria-label="Sort products"
                aria-haspopup="listbox"
                aria-expanded={showSortMenu}
                title="Sort"
              >
                <ArrowUpDown className="w-4 h-4" />
              </button>
              <AnimatePresence>
                {showSortMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
                    <motion.div
                      ref={sortMenuRef}
                      initial={{ opacity: 0, y: -4, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="fixed left-2 right-2 top-20 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1 z-50 bg-popover/95 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl py-1 sm:w-44 max-h-[80vh] overflow-y-auto"
                      role="listbox"
                      aria-label="Sort options"
                    >
                      {SORT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => { setSortBy(opt.value); setShowSortMenu(false); }}
                          className={`w-full text-left px-3 py-2.5 text-xs hover:bg-white/[0.05] transition-colors ${
                            sortBy === opt.value
                              ? "text-[hsl(var(--kf-accent1))] font-semibold"
                              : "text-muted-foreground"
                          }`}
                          role="option"
                          aria-selected={sortBy === opt.value}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
            <button
              onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }}
              className={`p-2 rounded-xl transition-all flex-shrink-0 ${bulkMode ? "bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
              aria-label={bulkMode ? "Exit bulk select" : "Bulk select"}
              title={bulkMode ? "Exit bulk select" : "Bulk select"}
            >
              <CheckSquare className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowInactive(!showInactive)}
              className={`p-2 rounded-xl transition-all flex-shrink-0 ${showInactive ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
              aria-label={showInactive ? "Hide inactive" : "Show inactive"}
              title={showInactive ? "Hide inactive" : "Show inactive"}
            >
              {showInactive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            {setProducts && (
              <button
                onClick={() => setShowImport(!showImport)}
                className={`p-2 rounded-xl transition-all flex-shrink-0 ${showImport ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
                aria-label="Import products"
                title="Import products"
              >
                <Upload className="w-4 h-4" />
              </button>
            )}
            {onAiHealthScan && (
              <button
                onClick={onAiHealthScan}
                className="p-2 rounded-xl transition-all flex-shrink-0 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20"
                aria-label="AI Health Scan"
                title="AI Health Scan — audit products for issues"
              >
                <Sparkles className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-0.5 border-l border-border/30 pl-2 flex-shrink-0">
            <button
              onClick={() => handleViewToggle("grid")}
              className={`p-2 rounded-xl transition-all ${viewMode === "grid" ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
              aria-label="Grid view"
              title="Grid view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleViewToggle("list")}
              className={`p-2 rounded-xl transition-all ${viewMode === "list" ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60 hover:bg-white/[0.04] hover:text-muted-foreground"}`}
              aria-label="List view"
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          {slots?.renderHeaderExtra?.()}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-0.5" role="group" aria-label="Filter by category">
          {CATEGORY_FILTERS.map((f) => {
            const count = categoryCounts[f.value as keyof typeof categoryCounts];
            return (
              <button
                key={f.value}
                onClick={() => setCategoryFilter(f.value)}
                className={`px-2.5 py-1.5 text-[11px] rounded-lg transition-all inline-flex items-center gap-1.5 font-medium whitespace-nowrap shrink-0 ${
                  categoryFilter === f.value
                    ? "bg-white/[0.08] border border-border/60 text-foreground"
                    : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05] hover:text-muted-foreground"
                }`}
                aria-pressed={categoryFilter === f.value}
              >
                {f.label}
                <span className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                  categoryFilter === f.value ? "bg-white/10" : "bg-white/[0.04] text-muted-foreground/50"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
          <span className="ml-auto text-[10px] text-muted-foreground/50 whitespace-nowrap shrink-0 pl-2" aria-live="polite" role="status">
            {filteredProducts.length} of {categoryCounts.ALL}
          </span>
        </div>
      </div>

      <AnimatePresence>
        {bulkMode && selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30"
          >
            <div className="flex items-center gap-3 px-5 py-3 rounded-2xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
              <span className="text-sm font-semibold text-[hsl(var(--kf-accent1))]">
                {selectedIds.size} selected
              </span>
              <div className="w-px h-5 bg-border/50" />
              <button
                onClick={() => handleBulkAction("activate")}
                disabled={bulkLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/30 transition-all disabled:opacity-50"
              >
                <ToggleRight className="w-3.5 h-3.5" /> Activate
              </button>
              <button
                onClick={() => handleBulkAction("deactivate")}
                disabled={bulkLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/30 transition-all disabled:opacity-50"
              >
                <ToggleLeft className="w-3.5 h-3.5" /> Deactivate
              </button>
              <button
                onClick={() => handleBulkAction("delete")}
                disabled={bulkLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30 transition-all disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
              <div className="w-px h-5 bg-border/50" />
              <button
                onClick={() => { setBulkMode(false); setSelectedIds(new Set()); }}
                className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {slots?.renderInsightBanner?.()}

      <AnimatePresence>
        {showImport && setProducts && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <ProductImportModal
              open={showImport}
              onClose={() => setShowImport(false)}
              businessId={businessId ?? null}
              currency={currency}
              setProducts={setProducts}
              variant="inline"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        viewMode === "list" ? (
          <div className="space-y-1" role="status" aria-label="Loading products">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/30 bg-white/[0.02]"
                style={{ animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite` }}
              >
                <div className="w-10 h-10 rounded-lg bg-muted/30 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-muted/30 rounded w-2/3" />
                  <div className="h-2.5 bg-muted/20 rounded w-1/3" />
                </div>
                <div className="h-3.5 bg-muted/30 rounded w-16 shrink-0" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="relative rounded-xl border border-border/50 bg-card overflow-hidden"
                style={{ animation: `pulse 1.5s ease-in-out ${i * 0.08}s infinite` }}
              >
                <div className="h-[72px] bg-muted/20 w-full" />
                <div className="px-2 py-1.5 space-y-1">
                  <div className="h-3 bg-muted/30 rounded w-3/4" />
                  <div className="h-3 bg-muted/30 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )
      ) : filteredProducts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-white/[0.03] border border-border/50 flex items-center justify-center mb-4">
            <Package className="w-7 h-7 text-muted-foreground/50" />
          </div>
          {productSearch.trim() || categoryFilter !== "ALL" ? (
            <>
              <h3 className="text-lg font-semibold mb-1">No products found</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                No products match your filters. Try adjusting your search or category.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold mb-1">No products yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm mb-4">
                Create your first product or service to start building invoices and quotes.
              </p>
              <div className="flex items-center gap-3 flex-wrap justify-center">
                <button
                  onClick={onAdd}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl bg-gradient-to-r from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/30 hover:to-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/20 transition-all"
                >
                  <Plus className="w-4 h-4" /> Add Product
                </button>
                {setProducts && (
                  <button
                    onClick={() => setShowImport(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl bg-white/5 border border-white/10 text-muted-foreground hover:bg-white/10 hover:text-white transition-all"
                  >
                    <Upload className="w-4 h-4" /> Import
                  </button>
                )}
              </div>
              {setProducts && (
                <button
                  onClick={() => setShowImport(true)}
                  className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  <Camera className="w-3.5 h-3.5" />
                  Or snap a photo of a menu or price list — AI will extract your products
                </button>
              )}
              {slots?.renderEmptyExtra?.()}
            </>
          )}
        </div>
      ) : (
        <>
          {bulkMode && (
            <div className="flex items-center gap-2 px-1">
              <button
                onClick={toggleSelectAll}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground transition-colors"
              >
                {selectedIds.size === filteredProducts.length ? (
                  <CheckSquare className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
                {selectedIds.size === filteredProducts.length ? "Deselect All" : "Select All"}
              </button>
            </div>
          )}
          {viewMode === "grid" ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
              <AnimatePresence mode="popLayout">
                {filteredProducts.map((product) => (
                  <div key={product.id} className="relative">
                    {bulkMode && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSelect(product.id); }}
                        className="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-md flex items-center justify-center bg-background/80 backdrop-blur-sm border border-border/50 transition-all hover:border-[hsl(var(--kf-accent1))]/50"
                        aria-label={selectedIds.has(product.id) ? "Deselect" : "Select"}
                      >
                        {selectedIds.has(product.id) ? (
                          <CheckSquare className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                        ) : (
                          <Square className="w-4 h-4 text-muted-foreground/50" />
                        )}
                      </button>
                    )}
                    <ProductCard
                      product={product}
                      onClick={handleProductClick}
                      cachedImage={cachedImages[product.id]}
                      currency={currency}
                      onAiPricing={onAiPricing}
                    />
                    {slots?.renderCardBadge?.(product)}
                  </div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="space-y-1">
              <AnimatePresence mode="popLayout">
                {filteredProducts.map((product) => {
                  const isInactive = product.isActive === false;
                  const displayCurrency = product.currency ?? currency;
                  const img = cachedImages[product.id] || product.imageUrl;
                  return (
                    <motion.button
                      key={product.id}
                      layout
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                      onClick={() => handleProductClick(product)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/30 bg-white/[0.02] hover:bg-white/[0.05] hover:border-border/50 transition-all text-left group ${isInactive ? "opacity-50" : ""}`}
                    >
                      {bulkMode && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleSelect(product.id); }}
                          className="shrink-0"
                          aria-label={selectedIds.has(product.id) ? "Deselect" : "Select"}
                        >
                          {selectedIds.has(product.id) ? (
                            <CheckSquare className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                          ) : (
                            <Square className="w-4 h-4 text-muted-foreground/50" />
                          )}
                        </button>
                      )}
                      <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-white/[0.04] border border-border/20">
                        {img ? (
                          <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Package className="w-4 h-4 text-muted-foreground/30" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{product.name}</p>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
                          <span className="capitalize">{(product.category ?? "service").toLowerCase()}</span>
                          {product.sku && <span className="font-mono">{product.sku}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
                          {formatCurrency(product.price, displayCurrency)}
                        </p>
                        {product.category === "SERVICE" && product.duration && (
                          <p className="text-[10px] text-muted-foreground/50">{product.duration}m</p>
                        )}
                      </div>
                      {onAiPricing && (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); onAiPricing(product); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onAiPricing(product); } }}
                          className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer"
                          title="AI Pricing Advisor"
                          aria-label="AI Pricing Advisor"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      {selectedProduct && (
        <ProductDetailPanel
          product={selectedProduct}
          onClose={handleDetailClose}
          onSave={handleDetailSave}
          onDelete={handleDetailDelete}
          onDuplicate={handleDetailDuplicate}
          onToggleActive={handleDetailToggleActive}
          onCreateQuote={onCreateQuote}
          onCreateInvoice={onCreateInvoice}
          currency={currency}
          cachedImage={cachedImages[selectedProduct.id]}
          invoiceCount={productStats.invoiceCount}
          quoteCount={productStats.quoteCount}
          totalRevenue={productStats.totalRevenue}
        />
      )}
    </motion.div>
  );
});
