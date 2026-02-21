"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Pencil, Trash2, Tag, Clock, DollarSign, Package, Hash, Image } from "lucide-react";
import type { Product } from "@/lib/client";

interface ProductCardProps {
  product: Product;
  onEdit: (product: Product) => void;
  onDelete: (productId: string) => void;
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
}

const CATEGORY_STYLES: Record<string, { badge: string; accent: string }> = {
  SERVICE: { badge: "bg-teal-500/15 text-teal-400 border-teal-500/30", accent: "from-teal-500/20 to-teal-500/5" },
  PRODUCT: { badge: "bg-blue-500/15 text-blue-400 border-blue-500/30", accent: "from-blue-500/20 to-blue-500/5" },
  PACKAGE: { badge: "bg-purple-500/15 text-purple-400 border-purple-500/30", accent: "from-purple-500/20 to-purple-500/5" },
};

const CATEGORY_LABELS: Record<string, string> = {
  SERVICE: "Service",
  PRODUCT: "Product",
  PACKAGE: "Package",
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
  const [imgError, setImgError] = useState(false);
  const style = CATEGORY_STYLES[product.category] ?? CATEGORY_STYLES.SERVICE;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={`group relative rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm overflow-hidden hover:shadow-lg hover:shadow-primary/5 hover:border-primary/40 transition-all ${
        isInactive ? "opacity-60" : ""
      }`}
    >
      <div className="relative">
        {product.imageUrl && !imgError ? (
          <div className="w-full h-40 overflow-hidden">
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              onError={() => setImgError(true)}
            />
          </div>
        ) : (
          <div className={`w-full h-28 bg-gradient-to-br ${style.accent} flex items-center justify-center`}>
            <span className="text-3xl font-bold text-muted-foreground/30">
              {product.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}

        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border backdrop-blur-sm ${style.badge}`}
          >
            <Tag className="w-2.5 h-2.5" />
            {CATEGORY_LABELS[product.category] ?? "Service"}
          </span>
          {isInactive && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-background/80 text-muted-foreground border border-border/40 backdrop-blur-sm">
              Inactive
            </span>
          )}
        </div>

        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(product); }}
            className="w-7 h-7 rounded-lg flex items-center justify-center bg-background/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-background transition-colors border border-border/40"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setDeleteConfirm(product.id); }}
            className="w-7 h-7 rounded-lg flex items-center justify-center bg-background/80 backdrop-blur-sm text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors border border-border/40"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-2.5">
        <div>
          <h3 className="font-semibold text-sm truncate">{product.name}</h3>
          {product.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">
              {product.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {product.sku && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-md border border-border/30">
              <Hash className="w-2.5 h-2.5" />
              {product.sku}
            </span>
          )}
          {product.category === "SERVICE" && product.duration && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="w-2.5 h-2.5" />
              {product.duration} min
            </span>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-bold text-primary">
              {product.price.toFixed(2)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {product.currency}
            </span>
          </div>
          <button
            onClick={() => onEdit(product)}
            className="text-[10px] text-muted-foreground hover:text-primary transition-colors font-medium"
          >
            Edit
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isDeleting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 rounded-2xl bg-background/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-10"
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
