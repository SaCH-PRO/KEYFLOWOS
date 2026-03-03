"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Package, Plus, X, Eye, EyeOff, ArrowUpDown, CheckSquare, Square, Trash2, ToggleLeft, ToggleRight, ChevronDown, Upload } from "lucide-react";
import { toast } from "sonner";
import type { Product } from "@/lib/client";
import { bulkUpdateProducts } from "@/lib/client";
import { ProductCard } from "./product-card";

interface ProductsPanelProps {
  products: Product[];
  loading: boolean;
  productSearch: string;
  setProductSearch: (value: string) => void;
  onEdit: (product: Product) => void;
  onDelete: (productId: string) => void;
  onDuplicate?: (product: Product) => void;
  onToggleActive?: (product: Product) => void;
  onAdd: () => void;
  onImport?: () => void;
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
  cachedImages?: Record<string, string>;
  businessId?: string | null;
  onBulkAction?: () => void;
  currency?: string;
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

export function ProductsPanel({
  products,
  loading,
  productSearch,
  setProductSearch,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleActive,
  onAdd,
  onImport,
  deleteConfirm,
  setDeleteConfirm,
  cachedImages = {},
  businessId,
  onBulkAction,
  currency = "TTD",
}: ProductsPanelProps) {
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
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showSortMenu]);

  useEffect(() => {
    if (!showSortMenu || !sortMenuRef.current) return;
    const buttons = sortMenuRef.current.querySelectorAll("button");
    if (buttons.length > 0) {
      buttons[0].focus();
    }
  }, [showSortMenu]);

  const filteredProducts = useMemo(() => {
    let result = products;
    if (!showInactive) {
      result = result.filter((p) => p.isActive !== false);
    }
    if (categoryFilter !== "ALL") {
      result = result.filter((p) => p.category === categoryFilter);
    }
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description && p.description.toLowerCase().includes(q)) ||
          (p.sku && p.sku.toLowerCase().includes(q))
      );
    }
    const sorted = [...result];
    switch (sortBy) {
      case "name-asc": sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "name-desc": sorted.sort((a, b) => b.name.localeCompare(a.name)); break;
      case "price-asc": sorted.sort((a, b) => a.price - b.price); break;
      case "price-desc": sorted.sort((a, b) => b.price - a.price); break;
      case "oldest": sorted.sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()); break;
      case "newest":
      default: sorted.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()); break;
    }
    return sorted;
  }, [products, productSearch, categoryFilter, showInactive, sortBy]);

  const categoryCounts = useMemo(() => {
    const active = showInactive ? products : products.filter((p) => p.isActive !== false);
    return {
      ALL: active.length,
      SERVICE: active.filter((p) => p.category === "SERVICE").length,
      PRODUCT: active.filter((p) => p.category === "PRODUCT").length,
      PACKAGE: active.filter((p) => p.category === "PACKAGE").length,
    };
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      <div className="rounded-2xl border border-border/50 bg-card p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Search products, services, SKU..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-1.5 text-sm bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 focus:border-[hsl(var(--kf-accent1))]/40 placeholder:text-muted-foreground/40 transition-all"
              aria-label="Search products"
            />
            {productSearch && (
              <button
                onClick={() => setProductSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-md hover:bg-muted/50 transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3 h-3 text-muted-foreground/40" />
              </button>
            )}
          </div>

          <div className="relative" ref={sortRef}>
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              className={`inline-flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-lg border border-border/40 bg-white/[0.02] hover:bg-white/[0.05] transition-all shrink-0 ${sortBy !== "newest" ? "ring-1 ring-[hsl(var(--kf-accent1))]/30 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60"}`}
              aria-label={`Sort products: currently sorted by ${SORT_OPTIONS.find(o => o.value === sortBy)?.label || "newest"}`}
              aria-expanded={showSortMenu}
              aria-haspopup="listbox"
            >
              <ArrowUpDown className="w-3 h-3" />
              <span className="hidden sm:inline max-w-[60px] truncate">
                {SORT_OPTIONS.find(o => o.value === sortBy)?.label}
              </span>
              <ChevronDown className="w-2.5 h-2.5" />
            </button>
            <AnimatePresence>
              {showSortMenu && (
                <motion.div
                  ref={sortMenuRef}
                  initial={{ opacity: 0, y: -4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-border/50 bg-card shadow-xl z-20 py-1 overflow-hidden"
                  role="listbox"
                  aria-label="Sort options"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setSortBy(opt.value); setShowSortMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors ${
                        sortBy === opt.value
                          ? "bg-white/[0.08] text-[hsl(var(--kf-accent1))]"
                          : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                      }`}
                      role="option"
                      aria-selected={sortBy === opt.value}
                    >
                      {opt.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }}
            className={`inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-lg border border-border/40 bg-white/[0.02] hover:bg-white/[0.05] transition-all shrink-0 ${bulkMode ? "ring-1 ring-[hsl(var(--kf-accent1))]/40 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60"}`}
            aria-label="Bulk select"
            aria-pressed={bulkMode}
          >
            <CheckSquare className="w-3 h-3" />
          </button>

          <button
            onClick={() => setShowInactive(!showInactive)}
            className={`inline-flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-lg border border-border/40 bg-white/[0.02] hover:bg-white/[0.05] transition-all shrink-0 ${
              showInactive ? "ring-1 ring-[hsl(var(--kf-accent1))]/40" : ""
            }`}
            aria-label={showInactive ? "Hide inactive products" : "Show inactive products"}
            aria-pressed={showInactive}
          >
            {showInactive ? (
              <EyeOff className="w-3 h-3 text-muted-foreground/60" />
            ) : (
              <Eye className="w-3 h-3 text-muted-foreground/60" />
            )}
          </button>

          {onImport && (
            <button
              onClick={onImport}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-white/5 border border-white/10 text-muted-foreground hover:bg-white/10 hover:text-white transition-all shrink-0"
              aria-label="Import products"
            >
              <Upload className="w-3 h-3" />
              <span className="hidden sm:inline">Import</span>
            </button>
          )}

          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all shrink-0"
            aria-label="Add product"
          >
            <Plus className="w-3 h-3" />
            <span className="hidden sm:inline">Add Product</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none" role="group" aria-label="Filter by category">
          {CATEGORY_FILTERS.map((f) => {
            const count = categoryCounts[f.value as keyof typeof categoryCounts];
            return (
              <button
                key={f.value}
                onClick={() => setCategoryFilter(f.value)}
                className={`px-2.5 py-1 text-[11px] rounded-md transition-all inline-flex items-center gap-1.5 font-medium whitespace-nowrap shrink-0 ${
                  categoryFilter === f.value
                    ? "bg-white/[0.08] border border-border/60 text-foreground"
                    : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
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
          <span className="ml-auto text-[10px] text-muted-foreground/50 whitespace-nowrap shrink-0 pl-2">
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

      {loading ? (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border/50 bg-card overflow-hidden animate-pulse"
            >
              <div className="aspect-[4/3] bg-muted/30 w-full" />
              <div className="p-2 space-y-1.5">
                <div className="h-3 bg-muted/30 rounded w-3/4" />
                <div className="h-3 bg-muted/30 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
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
              <div className="flex items-center gap-3">
                <button
                  onClick={onAdd}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl bg-gradient-to-r from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/30 hover:to-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/20 transition-all"
                >
                  <Plus className="w-4 h-4" /> Add Product
                </button>
                {onImport && (
                  <button
                    onClick={onImport}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl bg-white/5 border border-white/10 text-muted-foreground hover:bg-white/10 hover:text-white transition-all"
                  >
                    <Upload className="w-4 h-4" /> Import
                  </button>
                )}
              </div>
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
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <AnimatePresence mode="popLayout">
              {filteredProducts.map((product) => (
                <div key={product.id} className="relative">
                  {bulkMode && (
                    <button
                      onClick={() => toggleSelect(product.id)}
                      className="absolute top-3 left-3 z-10 w-6 h-6 rounded-md flex items-center justify-center bg-background/80 backdrop-blur-sm border border-border/50 transition-all hover:border-[hsl(var(--kf-accent1))]/50"
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
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onDuplicate={onDuplicate}
                    onToggleActive={onToggleActive}
                    deleteConfirm={deleteConfirm}
                    setDeleteConfirm={setDeleteConfirm}
                    cachedImage={cachedImages[product.id]}
                    currency={currency}
                  />
                </div>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}
    </motion.div>
  );
}
