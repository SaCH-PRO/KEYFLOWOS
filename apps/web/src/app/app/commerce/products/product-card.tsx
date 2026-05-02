"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Clock, Package, Layers, Zap, Sparkles, AlertTriangle } from "lucide-react";
import type { Product } from "@/lib/client";
import { formatCurrency } from "@/lib/currency";
import { PRODUCT_CATEGORY_CONFIG } from "../components/commerce-types";
import Image from "next/image";

const CATEGORY_ICONS = { SERVICE: Zap, PRODUCT: Package, PACKAGE: Layers } as const;

interface ProductCardProps {
  product: Product;
  onClick: (product: Product) => void;
  cachedImage?: string;
  currency?: string;
  onAiPricing?: (product: Product) => void;
  invoiceCount?: number;
  quoteCount?: number;
}

export const ProductCard = React.memo(function ProductCard({
  product,
  onClick,
  cachedImage,
  currency = "TTD",
  onAiPricing,
  invoiceCount = 0,
  quoteCount = 0,
}: ProductCardProps) {
  const [imgError, setImgError] = useState(false);
  const config = PRODUCT_CATEGORY_CONFIG[product.category as keyof typeof PRODUCT_CATEGORY_CONFIG] ?? PRODUCT_CATEGORY_CONFIG.SERVICE;
  const CategoryIcon = CATEGORY_ICONS[product.category as keyof typeof CATEGORY_ICONS] ?? Zap;
  const isInactive = product.isActive === false;
  const displayImage = cachedImage || product.imageUrl;
  const displayCurrency = product.currency ?? currency;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.15 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onClick(product)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(product); } }}
      className={`group relative rounded-xl border border-border/50 bg-card overflow-hidden transition-all duration-200 cursor-pointer text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--kf-accent1))]/40 ${
        isInactive ? "opacity-50 grayscale-[40%]" : ""
      } hover:border-border/80 hover:shadow-lg hover:shadow-black/20`}
      aria-label={`${product.name} — ${formatCurrency(product.price, displayCurrency)}`}
    >
      <div className="h-[72px] relative overflow-hidden">
        {displayImage && !imgError ? (
          <Image
            src={displayImage}
            alt=""
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
            onError={() => setImgError(true)}
           fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
        ) : (
          <div className={`absolute inset-0 bg-gradient-to-br ${config.accent} flex items-center justify-center`}>
            <CategoryIcon className="w-7 h-7 text-muted-foreground/10" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute top-1 left-1">
          <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold border backdrop-blur-md ${config.badge}`}>
            <CategoryIcon className="w-2 h-2" />
            {config.label}
          </span>
        </div>
        <div className="absolute top-1 right-1 flex items-center gap-0.5">
          {isInactive && (
            <span className="px-1 py-0.5 rounded text-[9px] font-medium bg-red-500/20 text-red-400 border border-red-500/25 backdrop-blur-md">Off</span>
          )}
          {!isInactive && invoiceCount === 0 && quoteCount === 0 && (() => {

            const rawCreatedAt = (product as Record<string, unknown>)["createdAt"];
            const daysSince = rawCreatedAt ? Math.floor((Date.now() - new Date(rawCreatedAt as string).getTime()) / (1000 * 60 * 60 * 24)) : 0;
            if (daysSince > 90) return (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-amber-500/20 text-amber-400 border border-amber-500/25 backdrop-blur-md">
                <AlertTriangle className="w-2 h-2" />
              </span>
            );
            return null;
          })()}
        </div>
        {onAiPricing && (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onAiPricing(product); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onAiPricing(product); } }}
            className="absolute bottom-1 right-1 p-1 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/25 backdrop-blur-md hover:bg-purple-500/30 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
            title="AI Pricing Advisor"
            aria-label="AI Pricing Advisor"
          >
            <Sparkles className="w-2.5 h-2.5" />
          </div>
        )}
      </div>

      <div className="px-2 py-1.5">
        <h3 className="font-medium text-[12px] truncate leading-tight">{product.name}</h3>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <span className="text-[12px] font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>
            {formatCurrency(product.price, displayCurrency)}
          </span>
          {product.category === "SERVICE" && product.duration && (
            <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground/60">
              <Clock className="w-2 h-2" />
              {product.duration}m
            </span>
          )}
        </div>
        {product.description && (
          <p className="text-[10px] text-muted-foreground/50 truncate mt-0.5 hidden group-hover:block">{product.description}</p>
        )}
      </div>
    </motion.div>
  );
});
