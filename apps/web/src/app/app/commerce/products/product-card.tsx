"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Pencil,
  Trash2,
  Tag,
  Clock,
  DollarSign,
  Package,
  Hash,
  Image,
  Copy,
  ChevronDown,
  ChevronUp,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import type { Product } from "@/lib/client";

interface ProductCardProps {
  product: Product;
  onEdit: (product: Product) => void;
  onDelete: (productId: string) => void;
  onDuplicate?: (product: Product) => void;
  onToggleActive?: (product: Product) => void;
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
  cachedImage?: string;
}

const CATEGORY_STYLES: Record<string, { badge: string; accent: string; border: string }> = {
  SERVICE: {
    badge: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    accent: "from-teal-500/20 to-teal-500/5",
    border: "hover:border-teal-500/30",
  },
  PRODUCT: {
    badge: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    accent: "from-blue-500/20 to-blue-500/5",
    border: "hover:border-blue-500/30",
  },
  PACKAGE: {
    badge: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    accent: "from-purple-500/20 to-purple-500/5",
    border: "hover:border-purple-500/30",
  },
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
  onDuplicate,
  onToggleActive,
  deleteConfirm,
  setDeleteConfirm,
  cachedImage,
}: ProductCardProps) {
  const isInactive = product.isActive === false;
  const isDeleting = deleteConfirm === product.id;
  const [imgError, setImgError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const style = CATEGORY_STYLES[product.category] ?? CATEGORY_STYLES.SERVICE;
  const displayImage = cachedImage || product.imageUrl;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={`group relative rounded-xl border border-border/50 bg-card overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-[hsl(var(--kf-accent1))]/5 ${style.border} ${
        isInactive ? "opacity-60 grayscale-[30%]" : ""
      }`}
    >
      <div
        className="relative cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {displayImage && !imgError ? (
          <div className="w-full h-40 overflow-hidden">
            <img
              src={displayImage}
              alt={product.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              onError={() => setImgError(true)}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
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
            <Tag className="w-3 h-3" />
            {CATEGORY_LABELS[product.category] ?? "Service"}
          </span>
          {isInactive && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 backdrop-blur-sm">
              Inactive
            </span>
          )}
        </div>

        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {onDuplicate && (
            <button
              onClick={(e) => { e.stopPropagation(); onDuplicate(product); }}
              className="w-7 h-7 rounded-lg flex items-center justify-center bg-background/80 backdrop-blur-sm text-muted-foreground hover:text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors border border-border/40"
              title="Duplicate product"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(product); }}
            className="w-7 h-7 rounded-lg flex items-center justify-center bg-background/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-background transition-colors border border-border/40"
            title="Edit product"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setDeleteConfirm(product.id); }}
            className="w-7 h-7 rounded-lg flex items-center justify-center bg-background/80 backdrop-blur-sm text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors border border-border/40"
            title="Delete product"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm truncate">{product.name}</h3>
            {product.description && !expanded && (
              <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">
                {product.description}
              </p>
            )}
          </div>
          {onToggleActive && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleActive(product); }}
              className={`shrink-0 transition-colors ${
                isInactive
                  ? "text-muted-foreground/40 hover:text-emerald-400"
                  : "text-emerald-400 hover:text-muted-foreground/60"
              }`}
              title={isInactive ? "Activate product" : "Deactivate product"}
            >
              {isInactive ? (
                <ToggleLeft className="w-6 h-6" />
              ) : (
                <ToggleRight className="w-6 h-6" />
              )}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {product.sku && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 bg-white/[0.03] px-1.5 py-0.5 rounded-md border border-border/40">
              <Hash className="w-3 h-3" />
              {product.sku}
            </span>
          )}
          {product.category === "SERVICE" && product.duration && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <Clock className="w-3 h-3" />
              {product.duration} min
            </span>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold tracking-tight" style={{ color: "hsl(var(--kf-accent1))" }}>
              {product.price.toLocaleString("en-TT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-muted-foreground/50 font-medium">
              {product.currency ?? "TTD"}
            </span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors p-1 rounded"
            title={expanded ? "Collapse" : "View details"}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="pt-2 border-t border-border/30 space-y-2">
                {product.description && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-medium">Description</span>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{product.description}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-medium">Category</span>
                    <p className="text-xs text-foreground mt-0.5">{CATEGORY_LABELS[product.category] ?? "Service"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-medium">Status</span>
                    <p className={`text-xs mt-0.5 ${isInactive ? "text-red-400" : "text-emerald-400"}`}>
                      {isInactive ? "Inactive" : "Active"}
                    </p>
                  </div>
                  {product.sku && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-medium">SKU</span>
                      <p className="text-xs text-foreground mt-0.5 font-mono">{product.sku}</p>
                    </div>
                  )}
                  {product.duration && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-medium">Duration</span>
                      <p className="text-xs text-foreground mt-0.5">{product.duration} min</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit(product); }}
                    className="flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors text-center"
                  >
                    Edit Details
                  </button>
                  {onDuplicate && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDuplicate(product); }}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08] transition-colors border border-border/40"
                    >
                      Duplicate
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
