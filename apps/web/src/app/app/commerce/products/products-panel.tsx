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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search products..."
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-card border border-border/60 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="w-4 h-4 text-muted-foreground" />
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setCategoryFilter(f.value)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                categoryFilter === f.value
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "text-muted-foreground hover:bg-muted border border-transparent"
              }`}
            >
              {f.label}
              <span className="ml-1 opacity-60">{categoryCounts[f.value as keyof typeof categoryCounts]}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowInactive(!showInactive)}
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors border ${
            showInactive
              ? "bg-muted text-foreground border-border"
              : "text-muted-foreground hover:bg-muted border-transparent"
          }`}
        >
          {showInactive ? "Hide" : "Show"} inactive
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-border/60 bg-card p-6 animate-pulse space-y-3"
            >
              <div className="h-4 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted rounded w-full" />
              <div className="h-3 bg-muted rounded w-1/2" />
              <div className="flex gap-2 mt-2">
                <div className="h-5 bg-muted rounded-md w-16" />
                <div className="h-5 bg-muted rounded-md w-12" />
              </div>
              <div className="h-6 bg-muted rounded w-24 mt-2" />
            </div>
          ))}
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
            <Package className="w-8 h-8 text-muted-foreground" />
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onEdit={onEdit}
                onDelete={onDelete}
                deleteConfirm={deleteConfirm}
                setDeleteConfirm={setDeleteConfirm}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
