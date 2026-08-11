"use client";

import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, useDragControls } from "framer-motion";
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
  ShoppingCart,
  FileText,
  Zap,
  Upload,
  Link2,
  ImageIcon,
  Wand2,
  Briefcase,
  ShoppingBag,
  Save,
  AlertTriangle,
  Activity,
  Sparkles,
  Percent,
} from "lucide-react";
import type { Product } from "@/lib/client";
import { fetchProductCostProfile, updateProductCostProfile } from "@/lib/client";
import { formatCurrency } from "@/lib/currency";
import { PRODUCT_CATEGORY_CONFIG, type ProductForm } from "../components/commerce-types";
import { ProductWholesalePrice } from "./product-wholesale-price";
import Image from "next/image";
import { toast } from "sonner";

const CATEGORY_ICONS = { SERVICE: Zap, PRODUCT: Package, PACKAGE: Layers } as const;

interface ProductDetailPanelProps {
  product: Product | null;
  onClose: () => void;
  onSave: (form: ProductForm, imageFile?: File | null) => void | Promise<void>;
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
  onAiPricing?: (product: Product) => void;
}

const CATEGORY_CARDS: { value: "SERVICE" | "PRODUCT" | "PACKAGE"; label: string; icon: typeof Package; desc: string; color: string }[] = [
  { value: "SERVICE", label: "Service", icon: Briefcase, desc: "Time-based", color: "from-blue-500/20 to-blue-600/10 border-blue-500/40 text-blue-300" },
  { value: "PRODUCT", label: "Product", icon: ShoppingBag, desc: "Item", color: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/40 text-emerald-300" },
  { value: "PACKAGE", label: "Package", icon: Layers, desc: "Bundle", color: "from-purple-500/20 to-purple-600/10 border-purple-500/40 text-purple-300" },
];

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof DollarSign; label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-border/30 p-2.5 space-y-0.5">
      <div className="flex items-center gap-1.5">
        <Icon className={`w-3 h-3 ${accent ?? "text-muted-foreground/60"}`} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">{label}</span>
      </div>
      <p className="text-sm font-semibold truncate">{value}</p>
    </div>
  );
}

function productToForm(product: Product): ProductForm {
  return {
    name: product.name,
    description: product.description ?? "",
    price: String(product.price),
    category: (product.category as "SERVICE" | "PRODUCT" | "PACKAGE") ?? "SERVICE",
    duration: product.duration ? String(product.duration) : "",
    imageUrl: product.imageUrl ?? "",
    sku: product.sku ?? "",
    isActive: product.isActive !== false,
  };
}

export const ProductDetailPanel = React.memo(function ProductDetailPanel({
  product,
  onClose,
  onSave,
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
  onAiPricing,
}: ProductDetailPanelProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProductForm>(() => product ? productToForm(product) : { name: "", description: "", price: "", category: "SERVICE", duration: "", imageUrl: "", sku: "", isActive: true });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState<"upload" | "url">("upload");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragY = useMotionValue(0);
  const dragOpacity = useTransform(dragY, [0, 200], [1, 0.2]);
  const dragScale = useTransform(dragY, [0, 200], [1, 0.92]);
  const dragControls = useDragControls();

  const [margin, setMargin] = useState<{ grossMargin: number | null; marginBand: string | null; landedCost: number | null } | null>(null);
  const [editingCost, setEditingCost] = useState(false);
  const [costForm, setCostForm] = useState({ sourceCost: "", shippingEstimate: "", dutiesEstimate: "", packagingCost: "", transactionCost: "" });
  const [savingCost, setSavingCost] = useState(false);

  useEffect(() => {
    if (product) {
      setForm(productToForm(product));
      setEditing(false);
      setShowDeleteConfirm(false);
      setImgError(false);
      setImageFile(null);
      setImagePreview(cachedImage || product.imageUrl || null);
      setSaving(false);
      dragY.set(0);
      // Fetch margin data
      fetchProductCostProfile(product.id).then((res) => {
        if (res.data) {
          setMargin({
            grossMargin: res.data.grossMargin,
            marginBand: res.data.marginBand,
            landedCost: res.data.landedCost,
          });
        } else {
          setMargin(null);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-runs only when the selected product identity changes, to reset all editor state. Including `product`/`cachedImage`/`dragY` would clobber in-progress edits whenever any field of the same product mutated.
  }, [product?.id]);

  useEffect(() => {
    if (product && !editing) {
      setForm(productToForm(product));
      setImagePreview(cachedImage || product.imageUrl || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-syncs the form from the current product fields only; including `product`/`cachedImage`/`editing` directly would either refetch on identity churn or fight the `editing` guard.
  }, [product?.name, product?.price, product?.description, product?.category, product?.sku, product?.duration, product?.imageUrl, product?.isActive]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showDeleteConfirm) setShowDeleteConfirm(false);
        else if (editing) setEditing(false);
        else onClose();
      }
      if (e.key === "e" && !editing && !showDeleteConfirm && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setEditing(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, showDeleteConfirm, editing]);

  const handleFileSelect = useCallback((file: File) => {
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    setForm(f => ({ ...f, imageUrl: "__local__" }));
  }, []);

  const handleRemoveImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    setForm(f => ({ ...f, imageUrl: "" }));
  }, []);

  const generateSku = useCallback(() => {
    const prefixMap: Record<string, string> = { SERVICE: "SVC", PRODUCT: "PRD", PACKAGE: "PKG" };
    const prefix = prefixMap[form.category] || "ITM";
    const namePart = form.name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    const suffix = String(Math.floor(Math.random() * 900) + 100);
    setForm(f => ({ ...f, sku: `${prefix}-${namePart || "ITEM"}-${suffix}` }));
  }, [form.category, form.name]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(form, imageFile);
      setEditing(false);
    } catch {
    } finally {
      setSaving(false);
    }
  }, [form, imageFile, onSave]);

  const formattedPrice = useMemo(() => {
    const num = parseFloat(form.price);
    if (isNaN(num) || num <= 0) return null;
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2 }).format(num);
    } catch { return `${currency} ${num.toFixed(2)}`; }
  }, [form.price, currency]);

  if (!product) return null;

  const config = PRODUCT_CATEGORY_CONFIG[product.category as keyof typeof PRODUCT_CATEGORY_CONFIG] ?? PRODUCT_CATEGORY_CONFIG.SERVICE;
  const CategoryIcon = CATEGORY_ICONS[product.category as keyof typeof CATEGORY_ICONS] ?? Zap;
  const isInactive = product.isActive === false;
  const displayImage = imagePreview || cachedImage || product.imageUrl;
  const displayCurrency = product.currency ?? currency;
  const createdDate = product.createdAt ? new Date(product.createdAt as string).toLocaleDateString("en-TT", { year: "numeric", month: "short", day: "numeric" }) : null;

  const inputClass = "w-full rounded-lg border border-border/50 bg-white/[0.03] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 focus:border-[hsl(var(--kf-accent1))]/50 placeholder:text-muted-foreground/50";

  return (
    <AnimatePresence>
      <motion.div
        key="product-detail-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{ opacity: dragOpacity }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
        onClick={onClose}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Product details: ${product.name}`}
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 200 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          style={{ y: dragY, scale: dragScale }}
          drag="y"
          dragListener={false}
          dragControls={dragControls}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.05, bottom: 0.5 }}
          onDragEnd={(_e, info) => {
            if (info.offset.y > 120 || info.velocity.y > 500) {
              onClose();
            } else {
              dragY.set(0);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-3rem)] rounded-2xl bg-card border border-border/50 overflow-hidden flex flex-col shadow-2xl"
        >
          <div
            onPointerDown={(e) => dragControls.start(e)}
            className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing shrink-0 select-none"
            style={{ touchAction: "none" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>
          <div className="relative overflow-hidden shrink-0">
            {!editing && displayImage && !imgError ? (
              <div className="w-full h-36 sm:h-44 overflow-hidden relative">
                <Image src={displayImage} alt={product.name} className="w-full h-full object-cover" onError={() => setImgError(true)}  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
                <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />
              </div>
            ) : !editing ? (
              <div className={`w-full h-24 sm:h-32 bg-gradient-to-br ${config.bgGradient} relative`}>
                <div className="absolute inset-0 flex items-center justify-center">
                  <CategoryIcon className={`w-10 h-10 ${config.color} opacity-20`} />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
              </div>
            ) : (
              <div className="w-full h-12 bg-gradient-to-r from-[hsl(var(--kf-accent1))]/10 to-transparent" />
            )}

            <div className="absolute top-2 right-2 flex items-center gap-1.5">
              {!editing && (
                <button
                  onClick={() => setEditing(true)}
                  className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white/80 hover:text-white hover:bg-black/60 transition-colors"
                  aria-label="Edit product"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white/80 hover:text-white hover:bg-black/60 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!editing && (
              <div className="absolute bottom-0 left-0 right-0 px-4 pb-2.5">
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border backdrop-blur-sm ${config.badge}`}>
                        <CategoryIcon className="w-2.5 h-2.5" />
                        {config.label}
                      </span>
                      {isInactive && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/20 backdrop-blur-sm">
                          Inactive
                        </span>
                      )}
                    </div>
                    <h2 className="text-base font-bold truncate">{product.name}</h2>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>
                      {formatCurrency(product.price, displayCurrency)}
                    </p>
                    <p className="text-[10px] text-muted-foreground/50 font-medium">{displayCurrency}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            {editing ? (
              <div className="p-4 space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-border/30">
                  <Pencil className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Edit Product</span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground/70 mb-1 block">Name *</label>
                    <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Haircut, Web Design" className={inputClass} />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground/70 mb-1 block">Description</label>
                    <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe your product..." rows={2} className={`${inputClass} resize-none`} />
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 block">Category</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {CATEGORY_CARDS.map((cat) => {
                        const CatIcon = cat.icon;
                        const selected = form.category === cat.value;
                        return (
                          <button key={cat.value} type="button" onClick={() => setForm(f => ({ ...f, category: cat.value }))}
                            className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all text-center ${selected ? `bg-gradient-to-b ${cat.color} ring-1 ring-white/10` : "border-border/40 bg-white/[0.02] hover:bg-white/[0.04] text-muted-foreground"}`}
                          >
                            <CatIcon className="w-4 h-4" />
                            <span className="text-[11px] font-semibold">{cat.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground/70 mb-1 block">Price ({currency}) *</label>
                      <div className="relative">
                        <input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" className={inputClass} />
                        {formattedPrice && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-emerald-400 pointer-events-none">{formattedPrice}</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-medium text-muted-foreground/70">SKU</label>
                        <button type="button" onClick={generateSku} className="flex items-center gap-0.5 text-[10px] font-medium px-1 py-0.5 rounded bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors">
                          <Wand2 className="w-2.5 h-2.5" /> Auto
                        </button>
                      </div>
                      <input type="text" value={form.sku} onChange={(e) => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="SVC-001" className={inputClass} />
                    </div>
                  </div>

                  {form.category === "SERVICE" && (
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground/70 mb-1 block">Duration (min)</label>
                      <div className="relative">
                        <input type="number" min="0" value={form.duration} onChange={(e) => setForm(f => ({ ...f, duration: e.target.value }))} placeholder="60" className={inputClass} />
                        <Clock className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-medium text-muted-foreground/70">Image</label>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => setImageMode("upload")} className={`px-1.5 py-0.5 text-[10px] rounded-md transition-colors ${imageMode === "upload" ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30" : "text-muted-foreground hover:bg-muted/50 border border-transparent"}`}>
                          <Upload className="w-2.5 h-2.5 inline mr-0.5" /> Upload
                        </button>
                        <button type="button" onClick={() => setImageMode("url")} className={`px-1.5 py-0.5 text-[10px] rounded-md transition-colors ${imageMode === "url" ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30" : "text-muted-foreground hover:bg-muted/50 border border-transparent"}`}>
                          <Link2 className="w-2.5 h-2.5 inline mr-0.5" /> URL
                        </button>
                      </div>
                    </div>
                    {imagePreview && form.imageUrl ? (
                      <div className="relative rounded-lg border border-border/50 overflow-hidden bg-muted/20 group/img">
                        {/* eslint-disable-next-line @next/next/no-img-element -- user-supplied URL with unknown host (cannot pre-configure remotePatterns) */}
                        <img src={imagePreview} alt="Preview" className="w-full h-28 object-cover" onError={() => { setImagePreview(null); }} />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <button type="button" onClick={() => fileInputRef.current?.click()} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"><Upload className="w-3.5 h-3.5" /></button>
                          <button type="button" onClick={handleRemoveImage} className="p-1.5 rounded-lg bg-red-500/30 hover:bg-red-500/50 text-white transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    ) : imageMode === "upload" ? (
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-[hsl(var(--kf-accent1))]/60"); }}
                        onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove("border-[hsl(var(--kf-accent1))]/60"); }}
                        onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("border-[hsl(var(--kf-accent1))]/60"); const file = e.dataTransfer.files[0]; if (file) handleFileSelect(file); }}
                        className="w-full h-20 rounded-lg border-2 border-dashed border-border/50 bg-white/[0.02] flex items-center justify-center gap-2 cursor-pointer hover:border-[hsl(var(--kf-accent1))]/40 transition-all"
                      >
                        <ImageIcon className="w-5 h-5 text-muted-foreground/40" />
                        <span className="text-xs text-muted-foreground/50">Click or drop image</span>
                      </div>
                    ) : (
                      <input type="url" value={form.imageUrl === "__local__" ? "" : form.imageUrl} onChange={(e) => { setForm(f => ({ ...f, imageUrl: e.target.value })); setImagePreview(e.target.value || null); }} placeholder="https://example.com/image.jpg" className={inputClass} />
                    )}
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileSelect(file); }} />
                  </div>

                  <div className="flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.02] border border-border/40">
                    <button type="button" onClick={() => setForm(f => ({ ...f, isActive: !f.isActive }))}
                      className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? "bg-emerald-500" : "bg-muted"}`}
                    >
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${form.isActive ? "translate-x-5" : ""}`} />
                    </button>
                    <div>
                      <span className="text-xs font-medium">{form.isActive ? "Active" : "Inactive"}</span>
                      <p className="text-[10px] text-muted-foreground/50">{form.isActive ? "Visible in store" : "Hidden"}</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {product.description && (
                  <p className="text-sm text-muted-foreground leading-relaxed">{product.description}</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <StatCard icon={DollarSign} label="Price" value={formatCurrency(product.price, displayCurrency)} accent="text-[hsl(var(--kf-accent1))]" />
                  <StatCard icon={Tag} label="Category" value={config.label} accent={config.color} />
                  {product.sku && <StatCard icon={Hash} label="SKU" value={product.sku} />}
                  {product.category === "SERVICE" && product.duration && <StatCard icon={Clock} label="Duration" value={`${product.duration} min`} />}
                  <StatCard icon={isInactive ? ToggleLeft : ToggleRight} label="Status" value={isInactive ? "Inactive" : "Active"} accent={isInactive ? "text-red-400" : "text-emerald-400"} />
                  {createdDate && <StatCard icon={Calendar} label="Created" value={createdDate} />}
                  {margin?.grossMargin != null && (
                    <StatCard
                      icon={Percent}
                      label="Gross margin"
                      value={`${margin.grossMargin}%`}
                      accent={
                        margin.marginBand === "premium"
                          ? "text-emerald-400"
                          : margin.marginBand === "high"
                            ? "text-blue-400"
                            : margin.marginBand === "medium"
                              ? "text-amber-400"
                              : "text-red-400"
                      }
                    />
                  )}
                  {margin?.landedCost != null && (
                    <StatCard
                      icon={DollarSign}
                      label="Landed cost"
                      value={formatCurrency(margin.landedCost, displayCurrency)}
                      accent="text-muted-foreground/60"
                    />
                  )}
                </div>

                {/* Cost Profile Editor */}
                {editingCost ? (
                  <div className="space-y-2 rounded-xl border border-border/30 bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Edit Cost Profile</span>
                      <button onClick={() => setEditingCost(false)} className="text-[10px] text-muted-foreground hover:text-foreground">Cancel</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: "sourceCost" as const, label: "Source Cost" },
                        { key: "shippingEstimate" as const, label: "Shipping" },
                        { key: "dutiesEstimate" as const, label: "Duties" },
                        { key: "packagingCost" as const, label: "Packaging" },
                        { key: "transactionCost" as const, label: "Transaction" },
                      ].map((f) => (
                        <div key={f.key} className="space-y-0.5">
                          <label className="text-[10px] text-muted-foreground/60">{f.label}</label>
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={costForm[f.key]}
                            onChange={(e) => setCostForm((p) => ({ ...p, [f.key]: e.target.value }))}
                            className="w-full rounded-lg border border-border/30 bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-[hsl(var(--kf-accent1))]/40"
                            placeholder="0.00"
                          />
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={async () => {
                        if (!product) return;
                        setSavingCost(true);
                        try {
                          const res = await updateProductCostProfile(product.id, {
                            sourceCost: parseFloat(costForm.sourceCost) || 0,
                            shippingEstimate: parseFloat(costForm.shippingEstimate) || 0,
                            dutiesEstimate: parseFloat(costForm.dutiesEstimate) || 0,
                            packagingCost: parseFloat(costForm.packagingCost) || 0,
                            transactionCost: parseFloat(costForm.transactionCost) || 0,
                          });
                          if (res.data) {
                            setMargin({ grossMargin: res.data.grossMargin, marginBand: res.data.marginBand, landedCost: res.data.landedCost });
                            setEditingCost(false);
                            toast.success("Cost profile updated");
                          } else {
                            toast.error("Failed to update cost profile");
                          }
                        } catch {
                          toast.error("Failed to update cost profile");
                        } finally {
                          setSavingCost(false);
                        }
                      }}
                      disabled={savingCost}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-gradient-to-r from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/30 hover:to-[hsl(var(--kf-accent1))]/15 border border-[hsl(var(--kf-accent1))]/20 transition-all disabled:opacity-50"
                    >
                      <Save className="w-3 h-3" />
                      {savingCost ? "Saving..." : "Save Cost Profile"}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setCostForm({
                        sourceCost: margin?.landedCost ? String(margin.landedCost) : "",
                        shippingEstimate: "",
                        dutiesEstimate: "",
                        packagingCost: "",
                        transactionCost: "",
                      });
                      setEditingCost(true);
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground border border-border/30 transition-all"
                  >
                    <Pencil className="w-3 h-3" /> Edit Cost Profile
                  </button>
                )}

                <ProductWholesalePrice product={product} />

                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/20">
                  <StatCard icon={TrendingUp} label="Revenue" value={formatCurrency(totalRevenue, displayCurrency)} accent="text-emerald-400" />
                  <StatCard icon={FileText} label="Invoices" value={invoiceCount} accent="text-blue-400" />
                  <StatCard icon={ShoppingCart} label="Quotes" value={quoteCount} accent="text-amber-400" />
                </div>

                {(() => {
                  const healthIssues: string[] = [];
                  let score = 100;
                  if (!product.description || product.description.length < 10) { healthIssues.push("Missing or short description"); score -= 20; }
                  if (!product.sku) { healthIssues.push("No SKU assigned"); score -= 10; }
                  if (!product.imageUrl && !cachedImage) { healthIssues.push("No product image"); score -= 15; }
                  if (invoiceCount === 0 && quoteCount === 0) { healthIssues.push("No sales activity"); score -= 25; }
                  const price = Number(product.price ?? 0);
                  if (price === 0) { healthIssues.push("Price is zero"); score -= 30; }

                  const rawCreatedAt = (product as Record<string, unknown>)["createdAt"];
                  const daysSinceCreated = rawCreatedAt ? Math.floor((Date.now() - new Date(rawCreatedAt as string).getTime()) / (1000 * 60 * 60 * 24)) : 0;
                  if (daysSinceCreated > 180 && invoiceCount === 0) { healthIssues.push("Stale — no sales in 6+ months"); score -= 20; }
                  score = Math.max(0, score);
                  const scoreColor = score >= 80 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";
                  return (
                    <div className="pt-2 border-t border-border/20 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Activity className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Product Health</span>
                        </div>
                        <span className={`text-sm font-bold ${scoreColor}`}>{score}/100</span>
                      </div>
                      {healthIssues.length > 0 && (
                        <div className="space-y-1">
                          {healthIssues.map((issue, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-[10px]">
                              <AlertTriangle className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                              <span className="text-muted-foreground/60">{issue}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {onAiPricing && (
                        <button
                          onClick={() => onAiPricing(product)}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-500/25 bg-purple-500/5 hover:bg-purple-500/10 text-[10px] font-medium text-purple-300 transition-colors"
                        >
                          <Sparkles className="w-3 h-3" />
                          AI Pricing Advisor
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-border/30 space-y-2 shrink-0">
            {editing ? (
              <div className="flex items-center gap-2">
                <button onClick={() => { setForm(productToForm(product)); setEditing(false); }} disabled={saving}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] text-muted-foreground border border-border/30 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-gradient-to-r from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/30 hover:to-[hsl(var(--kf-accent1))]/15 border border-[hsl(var(--kf-accent1))]/20 transition-all disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  {onCreateQuote && (
                    <button onClick={() => onCreateQuote(product)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-gradient-to-r from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" /> Quote
                    </button>
                  )}
                  {onCreateInvoice && (
                    <button onClick={() => onCreateInvoice(product)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-gradient-to-r from-blue-500/15 to-blue-500/5 text-blue-400 hover:from-blue-500/25 hover:to-blue-500/10 transition-all"
                    >
                      <FileText className="w-3.5 h-3.5" /> Invoice
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setEditing(true)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground border border-border/30 transition-all"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  {onDuplicate && (
                    <button onClick={() => onDuplicate(product)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground border border-border/30 transition-all"
                    >
                      <Copy className="w-3.5 h-3.5" /> Duplicate
                    </button>
                  )}
                  {onToggleActive && (
                    <button onClick={() => onToggleActive(product)}
                      className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-border/30 transition-all ${isInactive ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"}`}
                    >
                      {isInactive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <button onClick={() => setShowDeleteConfirm(true)}
                    className="inline-flex items-center justify-center px-3 py-2 rounded-xl text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>

          <AnimatePresence>
            {showDeleteConfirm && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-20 rounded-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-3 rounded-full bg-red-500/10">
                  <Trash2 className="w-6 h-6 text-red-400" />
                </div>
                <div className="text-center px-6">
                  <h3 className="text-sm font-semibold mb-1">Delete &ldquo;{product.name}&rdquo;?</h3>
                  <p className="text-xs text-muted-foreground">This cannot be undone.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowDeleteConfirm(false)} className="px-5 py-2 rounded-xl text-xs font-medium bg-muted hover:bg-muted/80 transition-colors">Cancel</button>
                  <button onClick={() => { onDelete(product.id); onClose(); }} className="px-5 py-2 rounded-xl text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors">Delete</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
});
