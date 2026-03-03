"use client";

import React, { useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  FileText,
  Hash,
} from "lucide-react";
import { Button } from "@keyflow/ui";
import { CATEGORIES, ProductForm } from "../components/commerce-types";

const CATEGORY_CARDS: {
  value: "SERVICE" | "PRODUCT" | "PACKAGE";
  label: string;
  icon: React.ReactNode;
  description: string;
  color: string;
}[] = [
  {
    value: "SERVICE",
    label: "Service",
    icon: <Briefcase className="w-5 h-5" />,
    description: "Time-based offering",
    color: "from-blue-500/20 to-blue-600/10 border-blue-500/40 text-blue-300",
  },
  {
    value: "PRODUCT",
    label: "Product",
    icon: <ShoppingBag className="w-5 h-5" />,
    description: "Physical or digital item",
    color: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/40 text-emerald-300",
  },
  {
    value: "PACKAGE",
    label: "Package",
    icon: <Layers className="w-5 h-5" />,
    description: "Bundled offering",
    color: "from-purple-500/20 to-purple-600/10 border-purple-500/40 text-purple-300",
  },
];

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

interface ProductFormModalProps {
  open: boolean;
  editingProductId: string | null;
  productForm: ProductForm;
  setProductForm: React.Dispatch<React.SetStateAction<ProductForm>>;
  formError: string | null;
  imagePreview: string | null;
  imageMode: "upload" | "url";
  setImageMode: (mode: "upload" | "url") => void;
  setImagePreview: (preview: string | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onSave: () => void;
  onFileSelect: (file: File) => void;
  onRemoveImage: () => void;
  currency?: string;
}

export const ProductFormModal = React.memo(function ProductFormModal({
  open,
  editingProductId,
  productForm,
  setProductForm,
  formError,
  imagePreview,
  imageMode,
  setImageMode,
  setImagePreview,
  fileInputRef,
  onClose,
  onSave,
  onFileSelect,
  onRemoveImage,
  currency = "TTD",
}: ProductFormModalProps) {
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

  const inputClass =
    "w-full rounded-xl border border-border/50 bg-white/[0.03] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 focus:border-[hsl(var(--kf-accent1))]/50 placeholder:text-muted-foreground/50";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-8 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-modal-title"
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: "spring", duration: 0.4 }}
            className="w-full max-w-lg rounded-2xl border border-border/50 bg-card shadow-2xl overflow-hidden my-auto"
          >
            <div className="p-5 border-b border-border/50 flex items-center justify-between sticky top-0 bg-card z-10">
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
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="p-5 space-y-6 max-h-[calc(100vh-10rem)] overflow-y-auto">
              {formError && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  {formError}
                </div>
              )}

              <section>
                <SectionHeader
                  icon={<Tag className="w-3.5 h-3.5 text-muted-foreground/60" />}
                  title="Basic Info"
                />
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 block">
                      Name *
                    </label>
                    <input
                      type="text"
                      value={productForm.name}
                      onChange={(e) =>
                        setProductForm((f) => ({ ...f, name: e.target.value }))
                      }
                      placeholder="e.g. Haircut, Web Design Package"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 block">
                      Description
                    </label>
                    <textarea
                      value={productForm.description}
                      onChange={(e) =>
                        setProductForm((f) => ({ ...f, description: e.target.value }))
                      }
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
                            {cat.icon}
                            <span className="text-xs font-semibold">{cat.label}</span>
                            <span className="text-[9px] opacity-60 leading-tight">
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
                    <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 block">
                      Price ({currency}) *
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
                        placeholder="0.00"
                        className={inputClass}
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
                            ? 'bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30'
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
                            ? 'bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30'
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
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.add("border-[hsl(var(--kf-accent1))]/60", "bg-[hsl(var(--kf-accent1))]/5");
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove("border-[hsl(var(--kf-accent1))]/60", "bg-[hsl(var(--kf-accent1))]/5");
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove("border-[hsl(var(--kf-accent1))]/60", "bg-[hsl(var(--kf-accent1))]/5");
                        const file = e.dataTransfer.files[0];
                        if (file) onFileSelect(file);
                      }}
                      className="w-full h-36 rounded-xl border-2 border-dashed border-border/50 bg-white/[0.02] flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[hsl(var(--kf-accent1))]/40 hover:bg-white/[0.04] transition-all"
                    >
                      <div className="w-12 h-12 rounded-xl bg-white/[0.04] flex items-center justify-center">
                        <ImageIcon className="w-6 h-6 text-muted-foreground/50" />
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-medium text-muted-foreground/70">
                          Click or drag & drop to upload
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
                  >
                    <div
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
                        productForm.isActive ? "translate-x-5" : ""
                      }`}
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

            <div className="p-5 border-t border-border/50 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={onSave}>
                {editingProductId ? "Update Product" : "Create Product"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
