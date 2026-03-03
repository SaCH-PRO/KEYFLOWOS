"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Pencil,
  Trash2,
  Tag,
  Clock,
  Hash,
  Copy,
  ChevronDown,
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
  currency?: string;
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
  currency = "TTD",
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
      className={`group relative rounded-xl border border-border/50 bg-card overflow-hidden transition-all duration-300 cursor-pointer ${style.border} ${
        isInactive ? "opacity-60 grayscale-[30%]" : ""
      } ${expanded ? "shadow-lg shadow-[hsl(var(--kf-accent1))]/5 border-border/80" : "hover:shadow-md hover:shadow-[hsl(var(--kf-accent1))]/5"}`}
      onClick={() => setExpanded(!expanded)}
    >
      {displayImage && !imgError ? (
        <div className="w-full aspect-[4/3] overflow-hidden relative">
          <img
            src={displayImage}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            onError={() => setImgError(true)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
          <div className="absolute bottom-0 left-0 right-0 p-2">
            <h3 className="font-semibold text-xs text-white truncate">{product.name}</h3>
          </div>
        </div>
      ) : (
        <div className={`w-full aspect-[4/3] bg-gradient-to-br ${style.accent} flex items-center justify-center relative`}>
          <span className="text-2xl font-bold text-muted-foreground/20">
            {product.name.charAt(0).toUpperCase()}
          </span>
          <div className="absolute bottom-0 left-0 right-0 p-2">
            <h3 className="font-semibold text-xs truncate">{product.name}</h3>
          </div>
        </div>
      )}

      <div className="px-2 py-1.5">
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-bold tracking-tight" style={{ color: "hsl(var(--kf-accent1))" }}>
            {product.price.toLocaleString("en-TT", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
          </span>
          <div className="flex items-center gap-1">
            <span
              className={`inline-flex items-center px-1 py-0.5 rounded text-[10px] font-semibold border leading-none ${style.badge}`}
            >
              {CATEGORY_LABELS[product.category]?.charAt(0) ?? "S"}
            </span>
            {isInactive && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" title="Inactive" />
            )}
            <ChevronDown className={`w-3 h-3 text-muted-foreground/40 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground/50">
          {product.currency ?? currency}
        </span>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 pb-2 space-y-2 border-t border-border/30 pt-2">
              {product.description && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">{product.description}</p>
              )}

              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <span className={`inline-flex items-center gap-1 text-[10px] font-medium border px-1.5 py-0.5 rounded-md ${style.badge}`}>
                  <Tag className="w-2.5 h-2.5" />
                  {CATEGORY_LABELS[product.category] ?? "Service"}
                </span>
                {product.sku && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
                    <Hash className="w-2.5 h-2.5" />
                    {product.sku}
                  </span>
                )}
                {product.category === "SERVICE" && product.duration && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
                    <Clock className="w-2.5 h-2.5" />
                    {product.duration}m
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 pt-1">
                <button
                  onClick={() => onEdit(product)}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
                  title="Edit"
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
                {onDuplicate && (
                  <button
                    onClick={() => onDuplicate(product)}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
                    title="Duplicate"
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </button>
                )}
                {onToggleActive && (
                  <button
                    onClick={() => onToggleActive(product)}
                    className={`flex-1 inline-flex items-center justify-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                      isInactive
                        ? "text-emerald-400/70 hover:text-emerald-400 hover:bg-emerald-500/10"
                        : "text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10"
                    }`}
                    title={isInactive ? "Activate" : "Deactivate"}
                  >
                    {isInactive ? <ToggleLeft className="w-3 h-3" /> : <ToggleRight className="w-3 h-3" />}
                    {isInactive ? "On" : "Off"}
                  </button>
                )}
                <button
                  onClick={() => setDeleteConfirm(product.id)}
                  className="inline-flex items-center justify-center px-1.5 py-1 rounded-md text-[10px] font-medium text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isDeleting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 rounded-xl bg-background/90 backdrop-blur-sm flex flex-col items-center justify-center gap-2 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-medium">Delete?</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-muted hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => onDelete(product.id)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors"
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
