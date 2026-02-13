"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Pencil, Trash2, Tag, Clock, DollarSign, Package } from "lucide-react";
import type { Product } from "@/lib/client";

interface ProductCardProps {
  product: Product;
  onEdit: (product: Product) => void;
  onDelete: (productId: string) => void;
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
}

const CATEGORY_STYLES: Record<string, string> = {
  SERVICE: "bg-teal-500/15 text-teal-400 border-teal-500/30",
  PRODUCT: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  PACKAGE: "bg-purple-500/15 text-purple-400 border-purple-500/30",
};

export function ProductCard({
  product,
  onEdit,
  onDelete,
  deleteConfirm,
  setDeleteConfirm,
}: ProductCardProps) {
  const isInactive = product.isActive === false;
  const isDeleting = deleteConfirm === product.id;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={`group relative rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm p-5 hover:shadow-lg hover:shadow-primary/5 hover:border-primary/40 transition-all ${
        isInactive ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base truncate">{product.name}</h3>
            {isInactive && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border/40">
                Inactive
              </span>
            )}
          </div>
          {product.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
              {product.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={() => onEdit(product)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setDeleteConfirm(product.id)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${
            CATEGORY_STYLES[product.category] ?? CATEGORY_STYLES.SERVICE
          }`}
        >
          <Tag className="w-3 h-3" />
          {product.category === "SERVICE"
            ? "Service"
            : product.category === "PACKAGE"
            ? "Package"
            : "Product"}
        </span>
        {product.category === "SERVICE" && product.duration && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            {product.duration} min
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/40">
        <DollarSign className="w-4 h-4 text-primary" />
        <span className="text-lg font-bold text-primary">
          {product.price.toFixed(2)}
        </span>
        <span className="text-xs text-muted-foreground ml-1">
          {product.currency}
        </span>
      </div>

      <AnimatePresence>
        {isDeleting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 rounded-2xl bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-10"
          >
            <p className="text-sm font-medium">Delete this product?</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => onDelete(product.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors"
              >
                Delete
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
