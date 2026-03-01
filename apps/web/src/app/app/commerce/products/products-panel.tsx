"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Package, Plus, Filter } from "lucide-react";
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
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
          <input
            type="text"
            placeholder="Search products..."
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white/[0.03] border border-border/40 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 focus:border-[hsl(var(--kf-accent1))]/50 transition-all"
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="w-3.5 h-3.5 text-muted-foreground/50" />
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setCategoryFilter(f.value)}
              className={`px-2.5 py-1.5 text-[11px] rounded-lg transition-colors ${
                categoryFilter === f.value
                  ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30"
                  : "text-muted-foreground/70 hover:bg-white/[0.06] border border-transparent"
              }`}
            >
              {f.label}
              <span className="ml-1 text-muted-foreground/50">{categoryCounts[f.value as keyof typeof categoryCounts]}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowInactive(!showInactive)}
          className={`px-2.5 py-1.5 text-[11px] rounded-lg transition-colors border ${
            showInactive
              ? "bg-white/[0.06] text-foreground border-border/50"
              : "text-muted-foreground/70 hover:bg-white/[0.06] border-transparent"
          }`}
        >
          {showInactive ? "Hide" : "Show"} inactive
        </button>
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
