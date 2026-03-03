"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import {
  X,
  Pencil,
  Trash2,
  Copy,
  Tag,
  Clock,
  Hash,
  DollarSign,
  Package,
  ToggleLeft,
  ToggleRight,
  Calendar,
  TrendingUp,
  Layers,
  Image as ImageIcon,
  ExternalLink,
  ShoppingCart,
  FileText,
  BarChart3,
  Zap,
} from "lucide-react";
import type { Product } from "@/lib/client";
import { formatCurrency } from "@/lib/currency";

interface ProductDetailPanelProps {
  product: Product | null;
  onClose: () => void;
  onEdit: (product: Product) => void;
  onDelete: (productId: string) => void;
  onDuplicate?: (product: Product) => void;
  onToggleActive?: (product: Product) => void;
  onCreateQuote?: (product: Product) => void;
  onCreateInvoice?: (product: Product) => void;
  currency?: string;
  cachedImage?: string;
  invoiceCount?: number;
  quoteCount?: number;
  totalRevenue?: number;
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: typeof Package; color: string; bgGradient: string }> = {
  SERVICE: {
    label: "Service",
    icon: Zap,
    color: "text-teal-400",
    bgGradient: "from-teal-500/30 via-teal-600/10 to-transparent",
  },
  PRODUCT: {
    label: "Product",
    icon: Package,
    color: "text-blue-400",
    bgGradient: "from-blue-500/30 via-blue-600/10 to-transparent",
  },
  PACKAGE: {
    label: "Package",
    icon: Layers,
    color: "text-purple-400",
    bgGradient: "from-purple-500/30 via-purple-600/10 to-transparent",
  },
};

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof DollarSign; label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-border/30 p-3 space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 ${accent ?? "text-muted-foreground/60"}`} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">{label}</span>
      </div>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

export function ProductDetailPanel({
  product,
  onClose,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleActive,
  onCreateQuote,
  onCreateInvoice,
  currency = "TTD",
  cachedImage,
  invoiceCount = 0,
  quoteCount = 0,
  totalRevenue = 0,
}: ProductDetailPanelProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [activeSection, setActiveSection] = useState<"overview" | "usage">("overview");

  const handleDragEnd = useCallback((_: any, info: PanInfo) => {
    if (info.offset.y > 100 || info.velocity.y > 500) onClose();
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showDeleteConfirm) setShowDeleteConfirm(false);
        else onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, showDeleteConfirm]);

  if (!product) return null;

  const config = CATEGORY_CONFIG[product.category] ?? CATEGORY_CONFIG.SERVICE;
  const CategoryIcon = config.icon;
  const isInactive = product.isActive === false;
  const displayImage = cachedImage || product.imageUrl;
  const displayCurrency = product.currency ?? currency;
  const createdDate = product.createdAt ? new Date(product.createdAt as string).toLocaleDateString("en-TT", { year: "numeric", month: "short", day: "numeric" }) : null;

  return (
    <AnimatePresence>
      <motion.div
        key="product-detail-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Product details: ${product.name}`}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.5 }}
          onDragEnd={handleDragEnd}
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-0 left-0 right-0 max-h-[92vh] rounded-t-2xl bg-card border-t border-x border-border/50 overflow-hidden flex flex-col sm:max-w-lg sm:left-auto sm:right-4 sm:bottom-4 sm:rounded-2xl sm:border sm:max-h-[88vh]"
        >
          <div className="flex justify-center pt-2 pb-0 sm:hidden">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          <div className="relative overflow-hidden">
            {displayImage && !imgError ? (
              <div className="w-full h-44 sm:h-52 overflow-hidden relative">
                <img
                  src={displayImage}
                  alt={product.name}
                  className="w-full h-full object-cover"
                  onError={() => setImgError(true)}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />
              </div>
            ) : (
              <div className={`w-full h-32 sm:h-40 bg-gradient-to-br ${config.bgGradient} relative`}>
                <div className="absolute inset-0 flex items-center justify-center">
                  <CategoryIcon className={`w-12 h-12 ${config.color} opacity-20`} />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
              </div>
            )}

            <button
              onClick={onClose}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white/80 hover:text-white hover:bg-black/60 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="absolute bottom-0 left-0 right-0 px-4 pb-3">
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border backdrop-blur-sm ${
                      product.category === "SERVICE" ? "bg-teal-500/15 text-teal-400 border-teal-500/30" :
                      product.category === "PRODUCT" ? "bg-blue-500/15 text-blue-400 border-blue-500/30" :
                      "bg-purple-500/15 text-purple-400 border-purple-500/30"
                    }`}>
                      <CategoryIcon className="w-3 h-3" />
                      {config.label}
                    </span>
                    {isInactive && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/20 backdrop-blur-sm">
                        Inactive
                      </span>
                    )}
                  </div>
                  <h2 className="text-lg font-bold truncate">{product.name}</h2>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xl font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>
                    {formatCurrency(product.price, displayCurrency)}
                  </p>
                  <p className="text-[10px] text-muted-foreground/50 font-medium">{displayCurrency}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-border/30">
            {(["overview", "usage"] as const).map((section) => (
              <button
                key={section}
                onClick={() => setActiveSection(section)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeSection === section
                    ? "bg-white/[0.08] text-foreground border border-border/50"
                    : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-white/[0.03]"
                }`}
              >
                {section === "overview" ? "Overview" : "Usage & Stats"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-4">
            {activeSection === "overview" && (
              <>
                {product.description && (
                  <div>
                    <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-1.5">Description</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">{product.description}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <StatCard icon={DollarSign} label="Price" value={formatCurrency(product.price, displayCurrency)} accent="text-[hsl(var(--kf-accent1))]" />
                  <StatCard icon={Tag} label="Category" value={config.label} accent={config.color} />
                  {product.sku && (
                    <StatCard icon={Hash} label="SKU" value={product.sku} />
                  )}
                  {product.category === "SERVICE" && product.duration && (
                    <StatCard icon={Clock} label="Duration" value={`${product.duration} min`} />
                  )}
                  <StatCard
                    icon={isInactive ? ToggleLeft : ToggleRight}
                    label="Status"
                    value={isInactive ? "Inactive" : "Active"}
                    accent={isInactive ? "text-red-400" : "text-emerald-400"}
                  />
                  {createdDate && (
                    <StatCard icon={Calendar} label="Created" value={createdDate} />
                  )}
                </div>

                {displayImage && !imgError && (
                  <div>
                    <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-1.5">Product Image</h4>
                    <div className="rounded-xl overflow-hidden border border-border/30 bg-white/[0.02]">
                      <img
                        src={displayImage}
                        alt={product.name}
                        className="w-full max-h-48 object-contain"
                        onError={() => setImgError(true)}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {activeSection === "usage" && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <StatCard icon={TrendingUp} label="Revenue" value={formatCurrency(totalRevenue, displayCurrency)} accent="text-emerald-400" />
                  <StatCard icon={FileText} label="Invoices" value={invoiceCount} accent="text-blue-400" />
                  <StatCard icon={ShoppingCart} label="Quotes" value={quoteCount} accent="text-amber-400" />
                </div>

                <div className="rounded-xl bg-white/[0.02] border border-border/30 p-4 text-center">
                  <BarChart3 className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground/60">Detailed usage analytics coming soon</p>
                </div>
              </>
            )}
          </div>

          <div className="px-4 py-3 border-t border-border/30 space-y-2">
            <div className="flex items-center gap-2">
              {onCreateQuote && (
                <button
                  onClick={() => onCreateQuote(product)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-gradient-to-r from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  Quote
                </button>
              )}
              {onCreateInvoice && (
                <button
                  onClick={() => onCreateInvoice(product)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-gradient-to-r from-blue-500/15 to-blue-500/5 text-blue-400 hover:from-blue-500/25 hover:to-blue-500/10 transition-all"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Invoice
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onEdit(product)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground border border-border/30 transition-all"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
              {onDuplicate && (
                <button
                  onClick={() => onDuplicate(product)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground border border-border/30 transition-all"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Duplicate
                </button>
              )}
              {onToggleActive && (
                <button
                  onClick={() => onToggleActive(product)}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-border/30 transition-all ${
                    isInactive
                      ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                      : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                  }`}
                >
                  {isInactive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                </button>
              )}
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="inline-flex items-center justify-center px-3 py-2 rounded-xl text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <AnimatePresence>
            {showDeleteConfirm && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-20"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-3 rounded-full bg-red-500/10">
                  <Trash2 className="w-6 h-6 text-red-400" />
                </div>
                <div className="text-center px-6">
                  <h3 className="text-sm font-semibold mb-1">Delete "{product.name}"?</h3>
                  <p className="text-xs text-muted-foreground">This action cannot be undone. The product will be permanently removed.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-5 py-2 rounded-xl text-xs font-medium bg-muted hover:bg-muted/80 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { onDelete(product.id); onClose(); }}
                    className="px-5 py-2 rounded-xl text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors"
                  >
                    Delete Product
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
