"use client";

import React, { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Upload,
  Camera,
  FileSpreadsheet,
  Check,
  Trash2,
  Loader2,
  AlertCircle,
  Package,
  Edit3,
  ChevronDown,
  Briefcase,
  ShoppingBag,
  Layers,
  Download,
} from "lucide-react";
import { Button } from "@keyflow/ui";
import { toast } from "sonner";
import {
  scanProductImage,
  importProductsFile,
  confirmProductImport,
  type ExtractedProduct,
  type Product,
} from "@/lib/client";
import { formatCurrency } from "@/lib/currency";
import { notifyProductsChanged } from "@/lib/product-sync";

type ImportMode = "choose" | "file" | "scan";
type ImportStep = "upload" | "preview" | "importing";

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  SERVICE: <Briefcase className="w-3.5 h-3.5" />,
  PRODUCT: <ShoppingBag className="w-3.5 h-3.5" />,
  PACKAGE: <Layers className="w-3.5 h-3.5" />,
};

interface ProductImportModalProps {
  open: boolean;
  onClose: () => void;
  businessId: string | null;
  currency?: string;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
}

export const ProductImportModal = React.memo(function ProductImportModal({
  open,
  onClose,
  businessId,
  currency = "TTD",
  setProducts,
}: ProductImportModalProps) {
  const [mode, setMode] = useState<ImportMode>("choose");
  const [step, setStep] = useState<ImportStep>("upload");
  const [extracted, setExtracted] = useState<ExtractedProduct[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const resetState = useCallback(() => {
    setMode("choose");
    setStep("upload");
    setExtracted([]);
    setSelected(new Set());
    setLoading(false);
    setEditingIdx(null);
    setError(null);
    setImagePreview(null);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await importProductsFile(file, businessId);
      if (err || !data) {
        setError(err || "Failed to parse file");
        return;
      }
      if (data.extracted.length === 0) {
        setError("No products found in file. Make sure it has a header row with columns like Name, Price, Category.");
        return;
      }
      setExtracted(data.extracted);
      setSelected(new Set(data.extracted.map((_, i) => i)));
      setStep("preview");
    } catch {
      setError("Failed to process file");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  const handleImageCapture = useCallback(async (file: File) => {
    if (!businessId) return;
    setLoading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);

    try {
      const { data, error: err } = await scanProductImage(file, businessId, currency);
      if (err || !data) {
        setError(err || "Failed to analyze image");
        return;
      }
      if (data.extracted.length === 0) {
        setError("No products found in this image. Try a clearer photo of a menu, price list, or catalog.");
        return;
      }
      setExtracted(data.extracted);
      setSelected(new Set(data.extracted.map((_, i) => i)));
      setStep("preview");
    } catch {
      setError("Failed to analyze image");
    } finally {
      setLoading(false);
    }
  }, [businessId, currency]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (mode === "file") {
      if (!file.name.match(/\.(csv|tsv|txt)$/i)) {
        setError("Please upload a CSV file");
        return;
      }
      handleFileUpload(file);
    } else if (mode === "scan") {
      if (!file.type.startsWith("image/")) {
        setError("Please upload an image file");
        return;
      }
      handleImageCapture(file);
    }
  }, [mode, handleFileUpload, handleImageCapture]);

  const toggleItem = useCallback((idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selected.size === extracted.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(extracted.map((_, i) => i)));
    }
  }, [selected.size, extracted.length]);

  const updateExtractedItem = useCallback((idx: number, updates: Partial<ExtractedProduct>) => {
    setExtracted(prev => prev.map((item, i) => i === idx ? { ...item, ...updates } : item));
  }, []);

  const removeItem = useCallback((idx: number) => {
    setExtracted(prev => prev.filter((_, i) => i !== idx));
    setSelected(prev => {
      const next = new Set<number>();
      prev.forEach(i => {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      });
      return next;
    });
    if (editingIdx === idx) setEditingIdx(null);
  }, [editingIdx]);

  const handleConfirmImport = useCallback(async () => {
    if (!businessId) return;
    const toImport = extracted
      .filter((_, i) => selected.has(i))
      .map(p => ({
        name: p.name!,
        price: p.price ?? 0,
        currency: p.currency || currency,
        description: p.description || undefined,
        category: p.category || "PRODUCT",
        duration: p.duration || undefined,
        sku: p.sku || undefined,
        isActive: true,
      }));

    if (toImport.length === 0) {
      toast.error("Select at least one product to import");
      return;
    }

    setStep("importing");
    setLoading(true);
    try {
      const { data, error: err } = await confirmProductImport(toImport, businessId);
      if (err || !data) {
        setError(err || "Failed to import products");
        setStep("preview");
        return;
      }
      if (data.created && data.created.length > 0) {
        setProducts(prev => [...data.created, ...prev]);
        notifyProductsChanged();
      }
      const errorCount = (data as any).errors?.length ?? 0;
      if (errorCount > 0) {
        toast.warning(`${data.count} imported, ${errorCount} failed`);
      } else {
        toast.success(`${data.count} product${data.count === 1 ? '' : 's'} imported successfully`);
      }
      handleClose();
    } catch {
      setError("Failed to import products");
      setStep("preview");
    } finally {
      setLoading(false);
    }
  }, [businessId, extracted, selected, currency, handleClose, setProducts]);

  const handleDownloadTemplate = useCallback(() => {
    const csv = "Name,Price,Category,Description,Duration,SKU\nHaircut,150,SERVICE,\"Basic men's haircut\",30,SVC-HAIR-001\nShampoo,45,PRODUCT,\"Professional shampoo\",,"
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "product-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleClose}
      >
        <motion.div
          className="relative w-full max-w-2xl max-h-[85vh] mx-4 rounded-2xl border border-white/10 bg-[hsl(var(--kf-card))]/95 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20">
                <Package className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Import Products</h2>
                <p className="text-[12px] text-muted-foreground">
                  {mode === "choose" ? "Choose import method" :
                   mode === "file" ? "Import from CSV file" :
                   "Scan from image"}
                </p>
              </div>
            </div>
            <button onClick={handleClose} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="Close">
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <AnimatePresence mode="wait">
              {mode === "choose" && (
                <motion.div
                  key="choose"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                >
                  <button
                    onClick={() => setMode("file")}
                    className="group p-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-[hsl(var(--kf-accent1))]/40 transition-all text-left"
                  >
                    <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 w-fit mb-4">
                      <FileSpreadsheet className="w-6 h-6 text-emerald-400" />
                    </div>
                    <h3 className="text-white font-medium mb-1">Import CSV File</h3>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">
                      Upload a spreadsheet with your product catalog. Supports CSV files with columns like Name, Price, Category, etc.
                    </p>
                  </button>

                  <button
                    onClick={() => setMode("scan")}
                    className="group p-6 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-[hsl(var(--kf-accent2))]/40 transition-all text-left"
                  >
                    <div className="p-3 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-600/10 w-fit mb-4">
                      <Camera className="w-6 h-6 text-violet-400" />
                    </div>
                    <h3 className="text-white font-medium mb-1">Scan Image</h3>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">
                      Take a photo or upload an image of a menu, price list, catalog, or flyer. AI will extract the products.
                    </p>
                  </button>
                </motion.div>
              )}

              {mode === "file" && step === "upload" && (
                <motion.div
                  key="file-upload"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <div
                    className="border-2 border-dashed border-white/20 rounded-xl p-10 text-center hover:border-[hsl(var(--kf-accent1))]/40 hover:bg-white/5 transition-all cursor-pointer"
                    onDrop={handleDrop}
                    onDragOver={e => e.preventDefault()}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {loading ? (
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-10 h-10 text-[hsl(var(--kf-accent1))] animate-spin" />
                        <p className="text-white font-medium">Parsing file...</p>
                      </div>
                    ) : (
                      <>
                        <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                        <p className="text-white font-medium mb-1">Drop your CSV file here</p>
                        <p className="text-[12px] text-muted-foreground">or click to browse</p>
                      </>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.tsv,.txt"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                  />

                  {error && (
                    <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <p className="text-[12px] text-red-300">{error}</p>
                    </div>
                  )}

                  <div className="mt-6 flex items-center justify-between">
                    <button
                      onClick={() => setMode("choose")}
                      className="text-[12px] text-muted-foreground hover:text-white transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleDownloadTemplate}
                      className="flex items-center gap-1.5 text-[12px] text-[hsl(var(--kf-accent1))] hover:underline"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download template
                    </button>
                  </div>
                </motion.div>
              )}

              {mode === "scan" && step === "upload" && (
                <motion.div
                  key="scan-upload"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <div
                    className="border-2 border-dashed border-white/20 rounded-xl p-10 text-center hover:border-[hsl(var(--kf-accent2))]/40 hover:bg-white/5 transition-all cursor-pointer"
                    onDrop={handleDrop}
                    onDragOver={e => e.preventDefault()}
                    onClick={() => imageInputRef.current?.click()}
                  >
                    {loading ? (
                      <div className="flex flex-col items-center gap-3">
                        {imagePreview && (
                          <img src={imagePreview} alt="Scanning" className="w-32 h-32 object-cover rounded-lg mb-2 opacity-70" />
                        )}
                        <Loader2 className="w-10 h-10 text-[hsl(var(--kf-accent2))] animate-spin" />
                        <p className="text-white font-medium">AI is analyzing your image...</p>
                        <p className="text-[12px] text-muted-foreground">Extracting products, prices, and details</p>
                      </div>
                    ) : (
                      <>
                        <Camera className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                        <p className="text-white font-medium mb-1">Upload or take a photo</p>
                        <p className="text-[12px] text-muted-foreground">Menu, price list, catalog, flyer, or any product listing</p>
                      </>
                    )}
                  </div>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleImageCapture(file);
                    }}
                  />

                  {error && (
                    <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <p className="text-[12px] text-red-300">{error}</p>
                    </div>
                  )}

                  <div className="mt-6">
                    <button
                      onClick={() => { setMode("choose"); setError(null); setImagePreview(null); }}
                      className="text-[12px] text-muted-foreground hover:text-white transition-colors"
                    >
                      Back
                    </button>
                  </div>
                </motion.div>
              )}

              {step === "preview" && (
                <motion.div
                  key="preview"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">
                        {extracted.length} product{extracted.length === 1 ? '' : 's'} found
                      </p>
                      <p className="text-[12px] text-muted-foreground">
                        {selected.size} selected for import. Click to edit details.
                      </p>
                    </div>
                    <button
                      onClick={toggleAll}
                      className="text-[12px] text-[hsl(var(--kf-accent1))] hover:underline"
                    >
                      {selected.size === extracted.length ? "Deselect all" : "Select all"}
                    </button>
                  </div>

                  {error && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <p className="text-[12px] text-red-300">{error}</p>
                    </div>
                  )}

                  <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                    {extracted.map((item, idx) => (
                      <div
                        key={idx}
                        className={`rounded-xl border transition-all ${
                          selected.has(idx)
                            ? "border-[hsl(var(--kf-accent1))]/30 bg-[hsl(var(--kf-accent1))]/5"
                            : "border-white/10 bg-white/5 opacity-60"
                        }`}
                      >
                        <div className="flex items-center gap-3 p-3">
                          <button
                            onClick={() => toggleItem(idx)}
                            className="shrink-0"
                            aria-label={selected.has(idx) ? "Deselect" : "Select"}
                          >
                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                              selected.has(idx)
                                ? "bg-[hsl(var(--kf-accent1))] border-[hsl(var(--kf-accent1))]"
                                : "border-white/30"
                            }`}>
                              {selected.has(idx) && <Check className="w-3 h-3 text-white" />}
                            </div>
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-white font-medium truncate">{item.name || "Unnamed"}</span>
                              {item.category && (
                                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-muted-foreground shrink-0">
                                  {CATEGORY_ICONS[item.category]}
                                  {item.category}
                                </span>
                              )}
                            </div>
                            {item.description && (
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5">{item.description}</p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {item.price != null && (
                              <span className="text-white font-medium text-[13px]">
                                {formatCurrency(item.price, item.currency || currency)}
                              </span>
                            )}
                            <button
                              onClick={() => setEditingIdx(editingIdx === idx ? null : idx)}
                              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                              aria-label="Edit"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                            <button
                              onClick={() => removeItem(idx)}
                              className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors"
                              aria-label="Remove"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-red-400" />
                            </button>
                          </div>
                        </div>

                        <AnimatePresence>
                          {editingIdx === idx && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="px-3 pb-3 pt-1 border-t border-white/10 grid grid-cols-2 gap-3">
                                <div>
                                  <label className="text-[11px] text-muted-foreground mb-1 block">Name</label>
                                  <input
                                    value={item.name || ""}
                                    onChange={e => updateExtractedItem(idx, { name: e.target.value })}
                                    className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-[13px] focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] text-muted-foreground mb-1 block">Price</label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={item.price ?? ""}
                                    onChange={e => updateExtractedItem(idx, { price: parseFloat(e.target.value) || 0 })}
                                    className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-[13px] focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] text-muted-foreground mb-1 block">Category</label>
                                  <select
                                    value={item.category || "PRODUCT"}
                                    onChange={e => updateExtractedItem(idx, { category: e.target.value as ExtractedProduct['category'] })}
                                    className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-[13px] focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                                  >
                                    <option value="SERVICE">Service</option>
                                    <option value="PRODUCT">Product</option>
                                    <option value="PACKAGE">Package</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[11px] text-muted-foreground mb-1 block">SKU</label>
                                  <input
                                    value={item.sku || ""}
                                    onChange={e => updateExtractedItem(idx, { sku: e.target.value })}
                                    className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-[13px] focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                                    placeholder="Optional"
                                  />
                                </div>
                                <div className="col-span-2">
                                  <label className="text-[11px] text-muted-foreground mb-1 block">Description</label>
                                  <input
                                    value={item.description || ""}
                                    onChange={e => updateExtractedItem(idx, { description: e.target.value })}
                                    className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-[13px] focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                                    placeholder="Optional"
                                  />
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {step === "importing" && (
                <motion.div
                  key="importing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center gap-4 py-10"
                >
                  <Loader2 className="w-12 h-12 text-[hsl(var(--kf-accent1))] animate-spin" />
                  <p className="text-white font-medium">Importing {selected.size} product{selected.size === 1 ? '' : 's'}...</p>
                  <p className="text-[12px] text-muted-foreground">This may take a moment</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {step === "preview" && (
            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between">
              <button
                onClick={() => {
                  setStep("upload");
                  setExtracted([]);
                  setSelected(new Set());
                  setError(null);
                }}
                className="text-[13px] text-muted-foreground hover:text-white transition-colors"
              >
                Back
              </button>
              <Button
                onClick={handleConfirmImport}
                disabled={selected.size === 0 || loading}
                className="bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] text-white font-medium px-6"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Check className="w-4 h-4 mr-2" />
                )}
                Import {selected.size} Product{selected.size === 1 ? '' : 's'}
              </Button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
});
