"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Tag,
  Clock,
  Zap,
  Package,
  Layers,
} from "lucide-react";
import type { Product } from "@/lib/client";
import { formatCurrency } from "@/lib/currency";

interface ProductCardProps {
  product: Product;
  onClick: (product: Product) => void;
  cachedImage?: string;
  currency?: string;
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: typeof Package; badge: string; accent: string }> = {
  SERVICE: {
    label: "Service",
    icon: Zap,
    badge: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    accent: "from-teal-500/25 via-teal-600/10 to-card",
  },
  PRODUCT: {
    label: "Product",
    icon: Package,
    badge: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    accent: "from-blue-500/25 via-blue-600/10 to-card",
  },
  PACKAGE: {
    label: "Package",
    icon: Layers,
    badge: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    accent: "from-purple-500/25 via-purple-600/10 to-card",
  },
};

export function ProductCard({
  product,
  onClick,
  cachedImage,
  currency = "TTD",
}: ProductCardProps) {
  const [imgError, setImgError] = useState(false);
  const config = CATEGORY_CONFIG[product.category] ?? CATEGORY_CONFIG.SERVICE;
  const CategoryIcon = config.icon;
  const isInactive = product.isActive === false;
  const displayImage = cachedImage || product.imageUrl;
  const displayCurrency = product.currency ?? currency;

  return (
    <motion.button
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => onClick(product)}
      className={`group relative aspect-square rounded-xl border border-border/50 bg-card overflow-hidden transition-all duration-300 cursor-pointer text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--kf-accent1))]/40 ${
        isInactive ? "opacity-50 grayscale-[40%]" : ""
      } hover:border-border/80 hover:shadow-lg hover:shadow-black/20`}
      aria-label={`${product.name} — ${formatCurrency(product.price, displayCurrency)}`}
    >
      {displayImage && !imgError ? (
        <img
          src={displayImage}
          alt=""
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${config.accent}`}>
          <div className="absolute inset-0 flex items-center justify-center">
            <CategoryIcon className="w-10 h-10 text-muted-foreground/10" />
          </div>
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

      <div className="absolute top-1.5 left-1.5 right-1.5 flex items-start justify-between">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border backdrop-blur-md ${config.badge}`}>
          <CategoryIcon className="w-2.5 h-2.5" />
          {config.label}
        </span>
        {isInactive && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400 border border-red-500/25 backdrop-blur-md">
            Off
          </span>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-2 space-y-0.5">
        <h3 className="font-semibold text-xs text-white truncate leading-tight">{product.name}</h3>

        <div className="flex items-end justify-between gap-1">
          <span className="text-sm font-bold text-white/95" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}>
            {formatCurrency(product.price, displayCurrency)}
          </span>
          {product.category === "SERVICE" && product.duration && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-white/60 font-medium">
              <Clock className="w-2.5 h-2.5" />
              {product.duration}m
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}
