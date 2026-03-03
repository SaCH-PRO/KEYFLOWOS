"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Package, Plus, X, Eye, EyeOff } from "lucide-react";
import { Button } from "@keyflow/ui";
import type { Product } from "@/lib/client";
import { ProductCard } from "./product-card";

interface ProductsPanelProps {
  products: Product[];
  loading: boolean;
  productSearch: string;
  setProductSearch: (value: string) => void;
  onEdit: (product: Product) => void;
  onDelete: (productId: string) => void;
  onAdd: () => void;
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
  cachedImages?: Record<string, string>;
}

const CATEGORY_FILTERS = [
  { value: "ALL", label: "All" },
  { value: "SERVICE", label: "Services" },
  { value: "PRODUCT", label: "Products" },
  { value: "PACKAGE", label: "Packages" },
] as const;

export function ProductsPanel({
  products,
  loading,
  productSearch,
  setProductSearch,
  onEdit,
  onDelete,
  onAdd,
  deleteConfirm,
  setDeleteConfirm,
  cachedImages = {},
}: ProductsPanelProps) {
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [showInactive, setShowInactive] = useState(false);

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
          (p.description && p.description.toLowerCase().includes(q))
      );
    }
    return result;
  }, [products, productSearch, categoryFilter, showInactive]);

  const categoryCounts = useMemo(() => {
    const active = showInactive ? products : products.filter((p) => p.isActive !== false);
    return {
      ALL: active.length,
      SERVICE: active.filter((p) => p.category === "SERVICE").length,
      PRODUCT: active.filter((p) => p.category === "PRODUCT").length,
      PACKAGE: active.filter((p) => p.category === "PACKAGE").length,
    };
  }, [products, showInactive]);

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
              placeholder="Search products..."
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

          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all shrink-0"
            aria-label="Add product"
          >
            <Plus className="w-3 h-3" />
            <span className="hidden sm:inline">Add Product</span>
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
            <span className="hidden sm:inline">{showInactive ? "Hide" : "Show"} inactive</span>
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
                Create your first product or service to start building invoices
                and quotes.
              </p>
              <Button onClick={onAdd} className="gap-2">
                <Plus className="w-4 h-4" />
                Add Your First Product
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence mode="popLayout">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onEdit={onEdit}
                onDelete={onDelete}
                deleteConfirm={deleteConfirm}
                setDeleteConfirm={setDeleteConfirm}
                cachedImage={cachedImages[product.id]}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
