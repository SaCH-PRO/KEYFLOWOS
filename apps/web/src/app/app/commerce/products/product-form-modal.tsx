"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Package, X, Upload, Link2, Trash2, ImageIcon } from "lucide-react";
import { Button } from "@keyflow/ui";
import { CATEGORIES, ProductForm } from "../components/commerce-types";

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
}: ProductFormModalProps) {
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
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="w-full max-w-lg rounded-2xl border border-border/50 bg-card shadow-2xl overflow-hidden my-auto"
          >
            <div className="p-5 border-b border-border/50 flex items-center justify-between sticky top-0 bg-card z-10">
              <h2 id="product-modal-title" className="text-lg font-semibold flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.3), hsl(var(--kf-accent2) / 0.3))" }}>
                  <Package className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                {editingProductId ? "Edit Product" : "New Product"}
              </h2>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <div className="p-5 space-y-4 max-h-[calc(100vh-10rem)] overflow-y-auto">
              {formError && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  {formError}
                </div>
              )}
              <div>
                <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 block">Name *</label>
                <input
                  type="text"
                  value={productForm.name}
                  onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Haircut, Web Design Package"
                  className="w-full rounded-xl border border-border/50 bg-white/[0.03] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 focus:border-[hsl(var(--kf-accent1))]/50 placeholder:text-muted-foreground/50"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 block">Description</label>
                <textarea
                  value={productForm.description}
                  onChange={(e) => setProductForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Describe your product or service..."
                  rows={2}
                  className="w-full rounded-xl border border-border/50 bg-white/[0.03] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 focus:border-[hsl(var(--kf-accent1))]/50 resize-none placeholder:text-muted-foreground/50"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground/70">Product Image</label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setImageMode("upload")}
                      className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${imageMode === "upload" ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30" : "text-muted-foreground hover:bg-muted/50 border border-transparent"}`}
                    >
                      <Upload className="w-3 h-3 inline mr-1" />Upload
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageMode("url")}
                      className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${imageMode === "url" ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30" : "text-muted-foreground hover:bg-muted/50 border border-transparent"}`}
                    >
                      <Link2 className="w-3 h-3 inline mr-1" />URL
                    </button>
                  </div>
                </div>
                {imagePreview ? (
                  <div className="relative rounded-xl border border-border/50 overflow-hidden bg-muted/20 group/img">
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="w-full h-36 object-cover"
                      onError={() => setImagePreview(null)}
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors" title="Replace image">
                        <Upload className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={onRemoveImage} className="p-2 rounded-lg bg-red-500/30 hover:bg-red-500/50 text-white transition-colors" title="Remove image">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : imageMode === "upload" ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-[hsl(var(--kf-accent1))]/60"); }}
                    onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove("border-[hsl(var(--kf-accent1))]/60"); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove("border-[hsl(var(--kf-accent1))]/60");
                      const file = e.dataTransfer.files[0];
                      if (file) onFileSelect(file);
                    }}
                    className="w-full h-28 rounded-xl border-2 border-dashed border-border/50 bg-white/[0.02] flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[hsl(var(--kf-accent1))]/40 transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-white/[0.03] flex items-center justify-center">
                      <ImageIcon className="w-5 h-5 text-muted-foreground/50" />
                    </div>
                    <div className="text-center">
                      <p className="text-[11px] font-medium text-muted-foreground/70">Click or drag to upload</p>
                      <p className="text-[10px] text-muted-foreground/50 mt-0.5">PNG, JPG, WEBP up to 5 MB</p>
                    </div>
                  </div>
                ) : (
                  <input
                    type="url"
                    value={productForm.imageUrl === "__local__" ? "" : productForm.imageUrl}
                    onChange={(e) => {
                      setProductForm((f) => ({ ...f, imageUrl: e.target.value }));
                      setImagePreview(e.target.value || null);
                    }}
                    placeholder="https://example.com/image.jpg"
                    className="w-full rounded-xl border border-border/50 bg-white/[0.03] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 placeholder:text-muted-foreground/50"
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
              <div>
                <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 block">SKU</label>
                <input
                  type="text"
                  value={productForm.sku}
                  onChange={(e) => setProductForm((f) => ({ ...f, sku: e.target.value }))}
                  placeholder="e.g. SVC-001, PKG-DELUXE"
                  className="w-full rounded-xl border border-border/50 bg-white/[0.03] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 placeholder:text-muted-foreground/50"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 block">Price (TTD) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={productForm.price}
                    onChange={(e) => setProductForm((f) => ({ ...f, price: e.target.value }))}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-border/50 bg-white/[0.03] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 placeholder:text-muted-foreground/50"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 block">Category</label>
                  <select
                    value={productForm.category}
                    onChange={(e) => setProductForm((f) => ({ ...f, category: e.target.value as "SERVICE" | "PRODUCT" | "PACKAGE" }))}
                    className="w-full rounded-xl border border-border/50 bg-white/[0.03] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              {productForm.category === "SERVICE" && (
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground/70 mb-1.5 block">Duration (minutes)</label>
                  <input
                    type="number"
                    min="0"
                    value={productForm.duration}
                    onChange={(e) => setProductForm((f) => ({ ...f, duration: e.target.value }))}
                    placeholder="e.g. 30, 60, 90"
                    className="w-full rounded-xl border border-border/50 bg-white/[0.03] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 placeholder:text-muted-foreground/50"
                  />
                </div>
              )}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-border/40">
                <button
                  type="button"
                  onClick={() => setProductForm((f) => ({ ...f, isActive: !f.isActive }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${productForm.isActive ? "bg-emerald-500" : "bg-muted"}`}
                >
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${productForm.isActive ? "translate-x-5" : ""}`} />
                </button>
                <div>
                  <span className="text-sm font-medium">{productForm.isActive ? "Active" : "Inactive"}</span>
                  <p className="text-[10px] text-muted-foreground/50">
                    {productForm.isActive ? "Visible in store and bookings" : "Hidden from customers"}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-border/50 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
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
