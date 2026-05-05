"use client";

import React, { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, useDragControls } from "framer-motion";
import {
  Package,
  X,
  Upload,
  Link2,
  Trash2,
  ImageIcon,
  Tag,
  DollarSign,
  Eye,
  Wand2,
  Briefcase,
  ShoppingBag,
  Layers,
  Clock,
  Loader2,
  Sparkles,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@keyflow/ui";
import { ProductForm } from "../components/commerce-types";
import Image from "next/image";

const CATEGORY_CARDS: {
  value: "SERVICE" | "PRODUCT" | "PACKAGE";
  label: string;
  icon: React.ReactNode;
  description: string;
  color: string;
  selectedBg: string;
}[] = [
  {
    value: "SERVICE",
    label: "Service",
    icon: <Briefcase className="w-5 h-5" />,
    description: "Time-based offering",
    color: "from-blue-500/20 to-blue-600/10 border-blue-500/40 text-blue-300",
    selectedBg: "bg-blue-500/10",
  },
  {
    value: "PRODUCT",
    label: "Product",
    icon: <ShoppingBag className="w-5 h-5" />,
    description: "Physical or digital item",
    color: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/40 text-emerald-300",
    selectedBg: "bg-emerald-500/10",
  },
  {
    value: "PACKAGE",
    label: "Package",
    icon: <Layers className="w-5 h-5" />,
    description: "Bundled offering",
    color: "from-purple-500/20 to-purple-600/10 border-purple-500/40 text-purple-300",
    selectedBg: "bg-purple-500/10",
  },
];

const DESC_MAX_LENGTH = 500;

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 pb-2 mb-3 border-b border-border/30">
      <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-white/[0.04]">
        {icon}
      </div>
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
        {title}
      </span>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <motion.p
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-1 mt-1 text-[11px] text-red-400"
    >
      <AlertCircle className="w-3 h-3 flex-shrink-0" />
      {message}
    </motion.p>
  );
}

function CompletionRing({ percent }: { percent: number }) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const color = percent === 100 ? "stroke-emerald-400" : percent >= 60 ? "stroke-[hsl(var(--kf-accent1))]" : "stroke-muted-foreground/40";

  return (
    <div className="relative w-10 h-10 flex items-center justify-center">
      <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-white/[0.06]"
        />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`${color} transition-all duration-500 ease-out`}
        />
      </svg>
      <span className="absolute text-[10px] font-bold text-muted-foreground">
        {percent}%
      </span>
    </div>
  );
}

function LivePreviewCard({
  form,
  imagePreview,
  currency,
}: {
  form: ProductForm;
  imagePreview: string | null;
  currency: string;
}) {
  const formattedPrice = useMemo(() => {
    const num = parseFloat(form.price);
    if (isNaN(num) || num <= 0) return null;
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
      }).format(num);
    } catch {
      return `${currency} ${num.toFixed(2)}`;
    }
  }, [form.price, currency]);

  const categoryCard = CATEGORY_CARDS.find((c) => c.value === form.category) ?? CATEGORY_CARDS[0];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-xl border border-border/40 bg-white/[0.02] overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-border/30 flex items-center gap-1.5">
        <Sparkles className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Live Preview
        </span>
      </div>
      <div className="p-3 flex gap-3">
        <div className="w-16 h-16 rounded-lg bg-white/[0.04] border border-border/30 flex-shrink-0 overflow-hidden flex items-center justify-center">
          {imagePreview ? (
            <Image
              src={imagePreview}
              alt="Preview"
              className="w-full h-full object-cover"
             fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
          ) : (
            <Package className="w-6 h-6 text-muted-foreground/30" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {form.name || "Product Name"}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-md border ${categoryCard.color}`}>
              {categoryCard.label}
            </span>
            {form.sku && (
              <span className="text-[10px] text-muted-foreground/50 font-mono">
                {form.sku}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-sm font-bold text-emerald-400">
              {formattedPrice ?? `${currency} 0.00`}
            </span>
            {form.category === "SERVICE" && form.duration && (
              <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {form.duration} min
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

interface ProductFormModalProps {
  open: boolean;
  editingProductId: string | null;
  productForm: ProductForm;
  setProductForm: React.Dispatch<React.SetStateAction<ProductForm>>;
  formError: string | null;
  saving?: boolean;
  imagePreview: string | null;
  imageMode: "upload" | "url";
  setImageMode: (mode: "upload" | "url") => void;
  setImagePreview: (preview: string | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onSave: () => void;
  onSaveAndAddAnother?: () => void;
  onFileSelect: (file: File) => void;
  onRemoveImage: () => void;
  currency?: string;
}

type FieldErrors = {
  name?: string;
  price?: string;
};

export const ProductFormModal = React.memo(function ProductFormModal({
  open,
  editingProductId,
  productForm,
  setProductForm,
  formError,
  saving = false,
  imagePreview,
  imageMode,
  setImageMode,
  setImagePreview,
  fileInputRef,
  onClose,
  onSave,
  onSaveAndAddAnother,
  onFileSelect,
  onRemoveImage,
  currency = "TTD",
}: ProductFormModalProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const dragY = useMotionValue(0);
  const dragOpacity = useTransform(dragY, [0, 200], [1, 0.2]);
  const dragScale = useTransform(dragY, [0, 200], [1, 0.92]);
  const dragControls = useDragControls();

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
      setFieldErrors({});
      setTouched(new Set());
      dragY.set(0);
      const timer = setTimeout(() => nameRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [open, dragY]);

  const validateField = useCallback(
    (field: string, value: string) => {
      setFieldErrors((prev) => {
        const next = { ...prev };
        if (field === "name") {
          if (!value.trim()) next.name = "Product name is required";
          else if (value.trim().length < 2) next.name = "Name must be at least 2 characters";
          else delete next.name;
        }
        if (field === "price") {
          const num = parseFloat(value);
          if (!value) next.price = "Price is required";
          else if (isNaN(num) || num <= 0) next.price = "Enter a valid price greater than 0";
          else if (num > 999999) next.price = "Price seems too high — double check";
          else delete next.price;
        }
        return next;
      });
    },
    [],
  );

  const handleBlur = useCallback(
    (field: string, value: string) => {
      setTouched((prev) => new Set(prev).add(field));
      validateField(field, value);
    },
    [validateField],
  );

  const hasUnsavedData = useMemo(() => {
    return !!(productForm.name || productForm.price || productForm.description || imagePreview);
  }, [productForm.name, productForm.price, productForm.description, imagePreview]);

  const handleClose = useCallback(() => {
    if (hasUnsavedData && !editingProductId) {
      const confirmed = window.confirm(
        "You have unsaved changes. Are you sure you want to close?",
      );
      if (!confirmed) return;
    }
    onClose();
  }, [hasUnsavedData, editingProductId, onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, handleClose, onSave]);

  const formattedPrice = useMemo(() => {
    const num = parseFloat(productForm.price);
    if (isNaN(num) || num <= 0) return null;
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
      }).format(num);
    } catch {
      return `${currency} ${num.toFixed(2)}`;
    }
  }, [productForm.price, currency]);

  const generateSku = useCallback(() => {
    const prefixMap: Record<string, string> = {
      SERVICE: "SVC",
      PRODUCT: "PRD",
      PACKAGE: "PKG",
    };
    const prefix = prefixMap[productForm.category] || "ITM";
    const namePart = productForm.name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8);
    const suffix = String(Math.floor(Math.random() * 900) + 100);
    setProductForm((f) => ({ ...f, sku: `${prefix}-${namePart || "ITEM"}-${suffix}` }));
  }, [productForm.category, productForm.name, setProductForm]);

  const completionPercent = useMemo(() => {
    let filled = 0;
    const total = 5;
    if (productForm.name.trim()) filled++;
    if (productForm.price && parseFloat(productForm.price) > 0) filled++;
    if (productForm.description.trim()) filled++;
    if (imagePreview) filled++;
    if (productForm.sku.trim()) filled++;
    return Math.round((filled / total) * 100);
  }, [productForm.name, productForm.price, productForm.description, productForm.sku, imagePreview]);

  const descLength = productForm.description.length;

  const nameValid = touched.has("name") && !fieldErrors.name && productForm.name.trim().length >= 2;
  const priceValid = touched.has("price") && !fieldErrors.price && parseFloat(productForm.price) > 0;

  const inputClass =
    "w-full rounded-xl border border-border/50 bg-white/[0.03] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 focus:border-[hsl(var(--kf-accent1))]/50 placeholder:text-muted-foreground/50 transition-all";

  const inputErrorClass =
    "w-full rounded-xl border border-red-500/50 bg-red-500/[0.03] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500/50 placeholder:text-muted-foreground/50 transition-all";

  const inputSuccessClass =
    "w-full rounded-xl border border-emerald-500/30 bg-white/[0.03] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40 placeholder:text-muted-foreground/50 transition-all";

  const getInputClass = (field: "name" | "price") => {
    if (touched.has(field) && fieldErrors[field]) return inputErrorClass;
    if (field === "name" && nameValid) return inputSuccessClass;
    if (field === "price" && priceValid) return inputSuccessClass;
    return inputClass;
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ opacity: dragOpacity }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-8 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-modal-title"
          onClick={(e) => e.target === e.currentTarget && handleClose()}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 200 }}
            transition={{ type: "spring", duration: 0.4 }}
            style={{ y: dragY, scale: dragScale }}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.5 }}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 120 || info.velocity.y > 500) {
                handleClose();
              } else {
                dragY.set(0);
              }
            }}
            className="w-full max-w-lg rounded-2xl border border-border/50 bg-card shadow-2xl overflow-hidden my-auto"
          >
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing select-none"
              style={{ touchAction: "none" }}
            >
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>
            <div className="p-5 pt-2 border-b border-border/50 flex items-center justify-between sticky top-0 bg-card z-10">
              <div className="flex items-center gap-3">
                <h2 id="product-modal-title" className="text-lg font-semibold flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center"
                    style={{
                      background:
                        "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.3), hsl(var(--kf-accent2) / 0.3))",
                    }}
                  >
                    <Package className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  </div>
                  {editingProductId ? "Edit Product" : "New Product"}
                </h2>
                <CompletionRing percent={completionPercent} />
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="p-5 space-y-6 max-h-[calc(100vh-10rem)] overflow-y-auto">
              {formError && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-200 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
                  {formError}
                </motion.div>
              )}

              <LivePreviewCard
                form={productForm}
                imagePreview={imagePreview}
                currency={currency}
              />

              <section>
                <SectionHeader
                  icon={<Tag className="w-3.5 h-3.5 text-muted-foreground/60" />}
                  title="Basic Info"
                />
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 flex items-center justify-between">
                      <span>Name <span className="text-red-400">*</span></span>
                      {nameValid && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                    </label>
                    <input
                      ref={nameRef}
                      type="text"
                      value={productForm.name}
                      onChange={(e) =>
                        setProductForm((f) => ({ ...f, name: e.target.value }))
                      }
                      onBlur={(e) => handleBlur("name", e.target.value)}
                      placeholder="e.g. Haircut, Web Design Package"
                      className={getInputClass("name")}
                      autoComplete="off"
                    />
                    <FieldError message={touched.has("name") ? fieldErrors.name : undefined} />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 flex items-center justify-between">
                      <span>Description</span>
                      <span
                        className={`text-[10px] tabular-nums ${
                          descLength > DESC_MAX_LENGTH
                            ? "text-red-400"
                            : descLength > DESC_MAX_LENGTH * 0.8
                            ? "text-amber-400"
                            : "text-muted-foreground/40"
                        }`}
                      >
                        {descLength}/{DESC_MAX_LENGTH}
                      </span>
                    </label>
                    <textarea
                      value={productForm.description}
                      onChange={(e) => {
                        if (e.target.value.length <= DESC_MAX_LENGTH) {
                          setProductForm((f) => ({ ...f, description: e.target.value }));
                        }
                      }}
                      placeholder="Describe your product or service..."
                      rows={2}
                      className={`${inputClass} resize-none`}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground/70 mb-2 block">
                      Category
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {CATEGORY_CARDS.map((cat) => {
                        const selected = productForm.category === cat.value;
                        return (
                          <button
                            key={cat.value}
                            type="button"
                            onClick={() =>
                              setProductForm((f) => ({ ...f, category: cat.value }))
                            }
                            className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center ${
                              selected
                                ? `bg-gradient-to-b ${cat.color} ring-1 ring-white/10`
                                : "border-border/40 bg-white/[0.02] hover:bg-white/[0.04] hover:border-border/60 text-muted-foreground"
                            }`}
                          >
                            {selected && (
                              <motion.div
                                layoutId="category-indicator"
                                className="absolute inset-0 rounded-xl ring-1 ring-white/20"
                                transition={{ type: "spring", duration: 0.3 }}
                              />
                            )}
                            {cat.icon}
                            <span className="text-xs font-semibold">{cat.label}</span>
                            <span className="text-[10px] opacity-60 leading-tight">
                              {cat.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <SectionHeader
                  icon={<DollarSign className="w-3.5 h-3.5 text-muted-foreground/60" />}
                  title="Pricing & Details"
                />
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 flex items-center justify-between">
                      <span>Price ({currency}) <span className="text-red-400">*</span></span>
                      {priceValid && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={productForm.price}
                        onChange={(e) =>
                          setProductForm((f) => ({ ...f, price: e.target.value }))
                        }
                        onBlur={(e) => handleBlur("price", e.target.value)}
                        placeholder="0.00"
                        className={getInputClass("price")}
                      />
                      {formattedPrice && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-emerald-400 pointer-events-none"
                        >
                          {formattedPrice}
                        </motion.div>
                      )}
                    </div>
                    <FieldError message={touched.has("price") ? fieldErrors.price : undefined} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] font-medium text-muted-foreground/70">
                          SKU
                        </label>
                        <button
                          type="button"
                          onClick={generateSku}
                          className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
                          title="Auto-generate SKU from category and name"
                        >
                          <Wand2 className="w-3 h-3" />
                          Auto
                        </button>
                      </div>
                      <input
                        type="text"
                        value={productForm.sku}
                        onChange={(e) =>
                          setProductForm((f) => ({ ...f, sku: e.target.value }))
                        }
                        placeholder="e.g. SVC-001"
                        className={inputClass}
                      />
                    </div>
                    {productForm.category === "SERVICE" && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 block">
                          Duration (min)
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            value={productForm.duration}
                            onChange={(e) =>
                              setProductForm((f) => ({
                                ...f,
                                duration: e.target.value,
                              }))
                            }
                            placeholder="e.g. 60"
                            className={inputClass}
                          />
                          <Clock className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
                        </div>
                      </div>
                    )}
                  </div>

                  {productForm.category === "PRODUCT" && (
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 block">
                          Inventory mode
                        </label>
                        <select
                          value={productForm.inventoryMode ?? "tracked"}
                          onChange={(e) =>
                            setProductForm((f) => ({
                              ...f,
                              inventoryMode: e.target.value as "tracked" | "untracked" | "virtual",
                            }))
                          }
                          className={inputClass}
                        >
                          <option value="tracked">Tracked (count stock)</option>
                          <option value="untracked">Untracked (always available)</option>
                          <option value="virtual">Virtual / digital</option>
                        </select>
                      </div>
                      {(productForm.inventoryMode ?? "tracked") === "tracked" && (
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 block">
                            When out of stock
                          </label>
                          <select
                            value={productForm.outOfStockBehavior ?? "hide"}
                            onChange={(e) =>
                              setProductForm((f) => ({
                                ...f,
                                outOfStockBehavior: e.target.value as "hide" | "show_oos" | "allow_backorder",
                              }))
                            }
                            className={inputClass}
                          >
                            <option value="hide">Hide from storefront</option>
                            <option value="show_oos">Show as &ldquo;Sold Out&rdquo;</option>
                            <option value="allow_backorder">Allow backorder</option>
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section>
                <SectionHeader
                  icon={<ImageIcon className="w-3.5 h-3.5 text-muted-foreground/60" />}
                  title="Media"
                />
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-medium text-muted-foreground/70">
                      Product Image
                    </label>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setImageMode("upload")}
                        className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${
                          imageMode === "upload"
                            ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30"
                            : "text-muted-foreground hover:bg-muted/50 border border-transparent"
                        }`}
                      >
                        <Upload className="w-3 h-3 inline mr-1" />
                        Upload
                      </button>
                      <button
                        type="button"
                        onClick={() => setImageMode("url")}
                        className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${
                          imageMode === "url"
                            ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30"
                            : "text-muted-foreground hover:bg-muted/50 border border-transparent"
                        }`}
                      >
                        <Link2 className="w-3 h-3 inline mr-1" />
                        URL
                      </button>
                    </div>
                  </div>
                  {imagePreview ? (
                    <div className="relative rounded-xl border border-border/50 overflow-hidden bg-muted/20 group/img">
                      {/* eslint-disable-next-line @next/next/no-img-element -- user-supplied URL with unknown host (cannot pre-configure remotePatterns) */}
                      <img
                        src={imagePreview}
                        alt="Preview"
                        className="w-full h-44 object-cover"
                        onError={() => setImagePreview(null)}
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="p-2 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"
                          title="Replace image"
                        >
                          <Upload className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={onRemoveImage}
                          className="p-2 rounded-lg bg-red-500/30 hover:bg-red-500/50 text-white transition-colors"
                          title="Remove image"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : imageMode === "upload" ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        const file = e.dataTransfer.files[0];
                        if (file) onFileSelect(file);
                      }}
                      className={`w-full h-36 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${
                        isDragging
                          ? "border-[hsl(var(--kf-accent1))]/60 bg-[hsl(var(--kf-accent1))]/5 scale-[1.02]"
                          : "border-border/50 bg-white/[0.02] hover:border-[hsl(var(--kf-accent1))]/40 hover:bg-white/[0.04]"
                      }`}
                    >
                      <motion.div
                        animate={isDragging ? { scale: 1.1, y: -4 } : { scale: 1, y: 0 }}
                        className="w-12 h-12 rounded-xl bg-white/[0.04] flex items-center justify-center"
                      >
                        <ImageIcon className={`w-6 h-6 ${isDragging ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground/50"}`} />
                      </motion.div>
                      <div className="text-center">
                        <p className="text-xs font-medium text-muted-foreground/70">
                          {isDragging ? "Drop your image here" : "Click or drag & drop to upload"}
                        </p>
                        <p className="text-[10px] text-muted-foreground/50 mt-1">
                          PNG, JPG, WEBP up to 5 MB
                        </p>
                      </div>
                    </div>
                  ) : (
                    <input
                      type="url"
                      value={
                        productForm.imageUrl === "__local__" ? "" : productForm.imageUrl
                      }
                      onChange={(e) => {
                        setProductForm((f) => ({ ...f, imageUrl: e.target.value }));
                        setImagePreview(e.target.value || null);
                      }}
                      placeholder="https://example.com/image.jpg"
                      className={inputClass}
                    />
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onFileSelect(file);
                    }}
                  />
                </div>
              </section>

              <section>
                <SectionHeader
                  icon={<Eye className="w-3.5 h-3.5 text-muted-foreground/60" />}
                  title="Visibility"
                />
                <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-border/40">
                  <button
                    type="button"
                    onClick={() =>
                      setProductForm((f) => ({ ...f, isActive: !f.isActive }))
                    }
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      productForm.isActive ? "bg-emerald-500" : "bg-muted"
                    }`}
                    role="switch"
                    aria-checked={productForm.isActive}
                  >
                    <motion.div
                      animate={{ x: productForm.isActive ? 20 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm"
                    />
                  </button>
                  <div>
                    <span className="text-sm font-medium">
                      {productForm.isActive ? "Active" : "Inactive"}
                    </span>
                    <p className="text-[10px] text-muted-foreground/50">
                      {productForm.isActive
                        ? "Visible in store and bookings"
                        : "Hidden from customers"}
                    </p>
                  </div>
                </div>
              </section>
            </div>

            <div className="p-5 border-t border-border/50">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={handleClose} disabled={saving}>
                    Cancel
                  </Button>
                  <span className="text-[10px] text-muted-foreground/40 hidden sm:inline">
                    {navigator.platform?.includes("Mac") ? "⌘" : "Ctrl"}+Enter to save
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!editingProductId && onSaveAndAddAnother && (
                    <button
                      type="button"
                      onClick={onSaveAndAddAnother}
                      disabled={saving}
                      className="px-4 py-2 text-sm font-medium rounded-xl border border-[hsl(var(--kf-accent1))]/30 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors disabled:opacity-50"
                    >
                      {saving ? (
                        <Loader2 className="w-4 h-4 animate-spin inline mr-1" />
                      ) : null}
                      Save & Add Another
                    </button>
                  )}
                  <Button onClick={onSave} disabled={saving}>
                    {saving ? (
                      <Loader2 className="w-4 h-4 animate-spin inline mr-1.5" />
                    ) : null}
                    {editingProductId ? "Update Product" : "Create Product"}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
