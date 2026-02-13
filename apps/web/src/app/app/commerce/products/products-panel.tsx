"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Package, Plus } from "lucide-react";
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
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return products;
    const q = productSearch.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q))
    );
  }, [products, productSearch]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Search products..."
          value={productSearch}
          onChange={(e) => setProductSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-card border border-border/60 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
        />
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
          {productSearch.trim() ? (
            <>
              <h3 className="text-lg font-semibold mb-1">No products found</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                No products match your search. Try a different term or clear the
                search.
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
