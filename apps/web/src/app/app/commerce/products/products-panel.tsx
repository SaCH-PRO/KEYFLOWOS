"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Package, Plus, X, Eye, EyeOff, ArrowUpDown, CheckSquare, Square, Trash2, ToggleLeft, ToggleRight, ChevronDown } from "lucide-react";
import { Button } from "@keyflow/ui";
import { toast } from "sonner";
import type { Product } from "@/lib/client";
import { bulkUpdateProducts, createProduct } from "@/lib/client";
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
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
  cachedImages?: Record<string, string>;
  businessId?: string | null;
  onProductCreated?: (product: Product) => void;
  onBulkAction?: () => void;
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

const QUICK_ADD_CATEGORIES = [
  { value: "SERVICE", label: "Service" },
  { value: "PRODUCT", label: "Product" },
  { value: "PACKAGE", label: "Package" },
] as const;

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
  deleteConfirm,
  setDeleteConfirm,
  cachedImages = {},
  businessId,
  onProductCreated,
  onBulkAction,
}: ProductsPanelProps) {
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [showInactive, setShowInactive] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickPrice, setQuickPrice] = useState("");
  const [quickCategory, setQuickCategory] = useState<string>("SERVICE");
  const [quickAdding, setQuickAdding] = useState(false);
  const quickNameRef = useRef<HTMLInputElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

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

  const handleQuickAdd = useCallback(async () => {
    if (!businessId || !quickName.trim() || !quickPrice.trim()) return;
    const price = parseFloat(quickPrice);
    if (isNaN(price) || price <= 0) { toast.error("Enter a valid price"); return; }
    setQuickAdding(true);
    const { data, error } = await createProduct({
      businessId,
      name: quickName.trim(),
      price,
      category: quickCategory,
    });
    setQuickAdding(false);
    if (error) { toast.error(error); return; }
    if (data) {
      onProductCreated?.(data);
      setQuickName("");
      setQuickPrice("");
      toast.success(`"${data.name}" added`);
      quickNameRef.current?.focus();
    }
  }, [businessId, quickName, quickPrice, quickCategory, onProductCreated]);

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
              className={`inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-lg border border-border/40 bg-white/[0.02] hover:bg-white/[0.05] transition-all shrink-0 ${sortBy !== "newest" ? "ring-1 ring-[hsl(var(--kf-accent1))]/30 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/60"}`}
              aria-label="Sort products"
            >
              <ArrowUpDown className="w-3 h-3" />
              <ChevronDown className="w-2.5 h-2.5" />
            </button>
            <AnimatePresence>
              {showSortMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-1 w-44 rounded-xl border border-border/50 bg-card shadow-xl z-20 py-1 overflow-hidden"
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

          <button
            onClick={() => { setShowQuickAdd(!showQuickAdd); if (!showQuickAdd) setTimeout(() => quickNameRef.current?.focus(), 100); }}
            className={`inline-flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-lg transition-all shrink-0 ${
              showQuickAdd
                ? "bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30"
                : "bg-gradient-to-r from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10"
            }`}
            aria-label="Quick add product"
          >
            <Plus className="w-3 h-3" />
            <span className="hidden sm:inline">Quick Add</span>
          </button>

          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-lg border border-border/40 bg-white/[0.02] hover:bg-white/[0.05] text-muted-foreground/60 hover:text-foreground transition-all shrink-0"
            aria-label="Full product form"
          >
            <Package className="w-3 h-3" />
            <span className="hidden sm:inline">Full Form</span>
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
        {showQuickAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-[hsl(var(--kf-accent1))]/20 bg-card p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-2">
                <Plus className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
                <span className="text-xs font-semibold text-[hsl(var(--kf-accent1))]">Quick Add</span>
                <span className="text-[10px] text-muted-foreground/50">Press Enter to add instantly</span>
              </div>
              <form
                onSubmit={(e) => { e.preventDefault(); handleQuickAdd(); }}
                className="flex items-center gap-2"
              >
                <input
                  ref={quickNameRef}
                  type="text"
                  placeholder="Product name..."
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-2 text-sm bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 placeholder:text-muted-foreground/40"
                  disabled={quickAdding}
                />
                <div className="relative w-28 shrink-0">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50">TTD</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={quickPrice}
                    onChange={(e) => setQuickPrice(e.target.value)}
                    className="w-full pl-9 pr-2 py-2 text-sm bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 placeholder:text-muted-foreground/40"
                    disabled={quickAdding}
                  />
                </div>
                <select
                  value={quickCategory}
                  onChange={(e) => setQuickCategory(e.target.value)}
                  className="w-24 shrink-0 px-2 py-2 text-sm bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40"
                  disabled={quickAdding}
                >
                  {QUICK_ADD_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={quickAdding || !quickName.trim() || !quickPrice.trim()}
                  className="px-3 py-2 text-sm font-medium rounded-lg bg-[hsl(var(--kf-accent1))] text-white hover:bg-[hsl(var(--kf-accent1))]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0"
                >
                  {quickAdding ? "..." : "Add"}
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border/50 bg-card p-4 animate-pulse space-y-3"
            >
              <div className="h-24 bg-muted/30 rounded-lg w-full" />
              <div className="h-4 bg-muted/30 rounded w-3/4" />
              <div className="h-3 bg-muted/30 rounded w-full" />
              <div className="flex gap-2 mt-2">
                <div className="h-5 bg-muted/30 rounded-md w-16" />
                <div className="h-5 bg-muted/30 rounded-md w-12" />
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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowQuickAdd(true); setTimeout(() => quickNameRef.current?.focus(), 100); }}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-gradient-to-r from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all"
                >
                  <Plus className="w-4 h-4" /> Quick Add
                </button>
                <Button onClick={onAdd} className="gap-2">
                  <Package className="w-4 h-4" /> Full Form
                </Button>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
