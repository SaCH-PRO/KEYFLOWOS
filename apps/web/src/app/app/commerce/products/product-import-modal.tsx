"use client";

import React, { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Camera,
  FileSpreadsheet,
  Check,
  Trash2,
  Loader2,
  AlertCircle,
  Package,
  Edit3,
  Download,
  Globe,
  Briefcase,
  ShoppingBag,
  Layers,
  Upload,
  Image as ImageIcon,
  ScanLine,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
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

type ImportMode = "file" | "scan" | "url";

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  SERVICE: <Briefcase className="w-3.5 h-3.5" />,
  PRODUCT: <ShoppingBag className="w-3.5 h-3.5" />,
  PACKAGE: <Layers className="w-3.5 h-3.5" />,
};

const MODES: { key: ImportMode; label: string; sublabel: string; icon: typeof Upload; color: string }[] = [
  { key: "file", label: "File", sublabel: "CSV spreadsheet", icon: Upload, color: "hsl(var(--kf-accent2))" },
  { key: "scan", label: "Scan", sublabel: "Photo or menu", icon: Camera, color: "#a855f7" },
  { key: "url", label: "URL", sublabel: "Link to file", icon: Globe, color: "#10b981" },
];

interface ProductImportModalProps {
  open: boolean;
  onClose: () => void;
  businessId: string | null;
  currency?: string;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  variant?: "modal" | "inline";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ProductImportModal = React.memo(function ProductImportModal({
  open,
  onClose,
  businessId,
  currency = "TTD",
  setProducts,
  variant = "modal",
}: ProductImportModalProps) {
  const [expanded, setExpanded] = useState(true);
  const [activeMode, setActiveMode] = useState<ImportMode | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedProduct[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [scanProcessing, setScanProcessing] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const resetState = useCallback(() => {
    setExpanded(true);
    setActiveMode(null);
    setFile(null);
    setLink("");
    setIsDragging(false);
    setLoading(false);
    setError(null);
    setExtracted([]);
    setSelected(new Set());
    setEditingIdx(null);
    setShowPreview(false);
    setScanPreview(null);
    setScanProcessing(false);
    setScanResult(null);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleModeSelect = useCallback((mode: ImportMode) => {
    setActiveMode(mode);
    setError(null);
  }, []);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (!droppedFile) return;
    if (droppedFile.size > 10 * 1024 * 1024) {
      toast.error("File too large (max 10MB)");
      return;
    }
    if (activeMode === "scan") {
      if (!droppedFile.type.startsWith("image/")) {
        setError("Please upload an image file");
        return;
      }
      setFile(droppedFile);
      const reader = new FileReader();
      reader.onload = () => setScanPreview(reader.result as string);
      reader.readAsDataURL(droppedFile);
    } else {
      if (!droppedFile.name.match(/\.(csv|tsv|txt)$/i)) {
        setError("Please upload a CSV file");
        return;
      }
      setFile(droppedFile);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (f.size > 10 * 1024 * 1024) {
        toast.error("File too large (max 10MB)");
        return;
      }
      setFile(f);
    }
  };

  const handleFileImport = useCallback(async () => {
    if (!businessId || !file) return;
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
      setSelected(new Set(data.extracted.map((_: ExtractedProduct, i: number) => i)));
      setShowPreview(true);
    } catch {
      setError("Failed to process file");
    } finally {
      setLoading(false);
    }
  }, [businessId, file]);

  const handleScanCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => setScanPreview(reader.result as string);
    reader.readAsDataURL(f);
  };

  const clearScan = () => {
    setFile(null);
    setScanPreview(null);
    setScanResult(null);
    setScanProcessing(false);
  };

  const handleProcessScan = useCallback(async () => {
    if (!businessId || !file) return;
    setScanProcessing(true);
    setError(null);
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
      setSelected(new Set(data.extracted.map((_: ExtractedProduct, i: number) => i)));
      setScanResult(`${data.extracted.length} product${data.extracted.length === 1 ? "" : "s"} found`);
      setShowPreview(true);
    } catch {
      setError("Failed to analyze image");
    } finally {
      setScanProcessing(false);
    }
  }, [businessId, file, currency]);

  const handleLinkImport = useCallback(async () => {
    if (!businessId || !link.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(link.trim());
      if (!res.ok) {
        setError("Could not fetch file from that URL");
        return;
      }
      const blob = await res.blob();
      const csvFile = new File([blob], "import.csv", { type: blob.type || "text/csv" });
      const { data, error: err } = await importProductsFile(csvFile, businessId);
      if (err || !data) {
        setError(err || "Failed to parse file");
        return;
      }
      if (data.extracted.length === 0) {
        setError("No products found. Make sure the CSV has columns like Name, Price, Category.");
        return;
      }
      setExtracted(data.extracted);
      setSelected(new Set(data.extracted.map((_: ExtractedProduct, i: number) => i)));
      setShowPreview(true);
    } catch {
      setError("Failed to fetch or process URL");
    } finally {
      setLoading(false);
    }
  }, [businessId, link]);

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
      setSelected(new Set(extracted.map((_: ExtractedProduct, i: number) => i)));
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

    setLoading(true);
    try {
      const { data, error: err } = await confirmProductImport(toImport, businessId);
      if (err || !data) {
        setError(err || "Failed to import products");
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
        toast.success(`${data.count} product${data.count === 1 ? "" : "s"} imported successfully`);
      }
      handleClose();
    } catch {
      setError("Failed to import products");
    } finally {
      setLoading(false);
    }
  }, [businessId, extracted, selected, currency, handleClose, setProducts]);

  const downloadTemplate = useCallback(() => {
    const csv = "Name,Price,Category,Description,Duration,SKU\nHaircut,150,SERVICE,\"Basic men's haircut\",30,SVC-HAIR-001\nShampoo,45,PRODUCT,\"Professional shampoo\",,";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "product-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  if (!open) return null;

  const importContent = (
    <AnimatePresence mode="wait">
      {showPreview ? (
              <motion.div
                key="preview"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-4 pt-2"
              >
                <button
                  onClick={() => { setShowPreview(false); setExtracted([]); setSelected(new Set()); setError(null); }}
                  className="text-xs text-muted-foreground hover:text-foreground mb-3 flex items-center gap-1"
                >
                  ← Back
                </button>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {extracted.length} product{extracted.length === 1 ? "" : "s"} found
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {selected.size} selected · tap to edit
                      </p>
                    </div>
                    <button
                      onClick={toggleAll}
                      className="text-[11px] text-[hsl(var(--kf-accent1))] hover:underline"
                    >
                      {selected.size === extracted.length ? "Deselect All" : "Select All"}
                    </button>
                  </div>

                  <div className="max-h-64 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                    {extracted.map((item, i) => (
                      <div key={i} className="flex items-center gap-3 p-2.5">
                        <button
                          onClick={() => toggleItem(i)}
                          className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 transition-all ${
                            selected.has(i)
                              ? "bg-[hsl(var(--kf-accent1))] border-[hsl(var(--kf-accent1))]"
                              : "border-border hover:border-[hsl(var(--kf-accent1))]/50"
                          }`}
                        >
                          {selected.has(i) && <Check className="w-3 h-3 text-white" />}
                        </button>

                        {editingIdx === i ? (
                          <div className="flex-1 space-y-2 min-w-0">
                            <input
                              value={item.name || ""}
                              onChange={e => updateExtractedItem(i, { name: e.target.value })}
                              className="w-full px-2 py-1.5 rounded-lg bg-white/5 border border-border text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                              placeholder="Product name"
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <input
                                type="number"
                                value={item.price ?? ""}
                                onChange={e => updateExtractedItem(i, { price: parseFloat(e.target.value) || 0 })}
                                className="w-24 px-2 py-1.5 rounded-lg bg-white/5 border border-border text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                                placeholder="Price"
                              />
                              <select
                                value={item.category || "PRODUCT"}
                                onChange={e => updateExtractedItem(i, { category: e.target.value as "SERVICE" | "PACKAGE" | "PRODUCT" })}
                                className="flex-1 px-2 py-1.5 rounded-lg bg-white/5 border border-border text-sm focus:outline-none"
                              >
                                <option value="SERVICE">Service</option>
                                <option value="PRODUCT">Product</option>
                                <option value="PACKAGE">Package</option>
                              </select>
                            </div>
                            <input
                              value={item.description || ""}
                              onChange={e => updateExtractedItem(i, { description: e.target.value })}
                              className="w-full px-2 py-1.5 rounded-lg bg-white/5 border border-border text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                              placeholder="Description (optional)"
                            />
                            <button
                              onClick={() => setEditingIdx(null)}
                              className="text-[11px] text-[hsl(var(--kf-accent1))] hover:underline"
                            >
                              Done editing
                            </button>
                          </div>
                        ) : (
                          <div
                            className="min-w-0 flex-1 cursor-pointer"
                            onClick={() => setEditingIdx(i)}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="text-muted-foreground">
                                {CATEGORY_ICONS[item.category || "PRODUCT"]}
                              </span>
                              <p className="text-sm font-medium truncate">
                                {item.name || "Unnamed Product"}
                              </p>
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {formatCurrency(item.price ?? 0, item.currency || currency)}
                              {item.description ? ` · ${item.description}` : ""}
                            </p>
                          </div>
                        )}

                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => setEditingIdx(editingIdx === i ? null : i)}
                            className="p-1 hover:bg-muted rounded-full"
                          >
                            <Edit3 className="w-3 h-3 text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => removeItem(i)}
                            className="p-1 hover:bg-muted rounded-full"
                          >
                            <Trash2 className="w-3 h-3 text-muted-foreground" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {error && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-red-300">{error}</p>
                    </div>
                  )}

                  <button
                    onClick={handleConfirmImport}
                    disabled={selected.size === 0 || loading}
                    className="kf-btn-primary w-full disabled:opacity-50"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Importing...
                      </span>
                    ) : (
                      `Import ${selected.size} Product${selected.size === 1 ? "" : "s"}`
                    )}
                  </button>
                </div>
              </motion.div>
            ) : !activeMode ? (
              <motion.div
                key="modes"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="p-4 pt-2"
              >
                <p className="text-xs text-muted-foreground mb-3">Choose how you'd like to import products</p>
                <div className="grid grid-cols-2 gap-2">
                  {MODES.map(({ key, label, sublabel, icon: Icon, color }) => (
                    <button
                      key={key}
                      onClick={() => handleModeSelect(key)}
                      className="flex items-center gap-3 p-3 rounded-xl border border-border hover:border-[hsl(var(--kf-accent1))]/30 hover:bg-muted/30 transition-all text-left group"
                    >
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105"
                        style={{ background: `${color}15` }}
                      >
                        <Icon className="w-5 h-5" style={{ color }} />
                      </div>
                      <div className="min-w-0">
                        <span className="text-sm font-medium block">{label}</span>
                        <span className="text-[11px] text-muted-foreground">{sublabel}</span>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="mt-3 p-2.5 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-[11px] text-muted-foreground text-center">
                    Supports CSV files, AI image scanning, and URL imports
                  </p>
                </div>
              </motion.div>
            ) : activeMode === "scan" ? (
              <motion.div
                key="scan"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-4 pt-2"
              >
                <button
                  onClick={() => { setActiveMode(null); clearScan(); setError(null); }}
                  className="text-xs text-muted-foreground hover:text-foreground mb-3 flex items-center gap-1"
                >
                  ← Back
                </button>

                {!scanPreview ? (
                  <div className="space-y-3">
                    <div className="text-center py-3">
                      <div className="mx-auto w-14 h-14 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-3">
                        <ScanLine className="w-7 h-7 text-purple-500" />
                      </div>
                      <h3 className="font-semibold text-sm mb-1">Scan a Menu or Price List</h3>
                      <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                        Take a photo or upload an image — we'll extract products, prices, and details automatically
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-purple-500/30 hover:border-purple-500/60 hover:bg-purple-500/5 transition-all"
                      >
                        <Camera className="w-6 h-6 text-purple-500" />
                        <span className="text-xs font-medium">Take Photo</span>
                      </button>
                      <button
                        onClick={() => galleryInputRef.current?.click()}
                        className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-purple-500/30 hover:border-purple-500/60 hover:bg-purple-500/5 transition-all"
                      >
                        <ImageIcon className="w-6 h-6 text-purple-500" />
                        <span className="text-xs font-medium">From Gallery</span>
                      </button>
                    </div>

                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleScanCapture}
                      className="hidden"
                    />
                    <input
                      ref={galleryInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleScanCapture}
                      className="hidden"
                    />

                    {error && (
                      <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-red-300">{error}</p>
                      </div>
                    )}

                    <div className="p-2.5 rounded-xl bg-purple-500/5 border border-purple-500/10">
                      <p className="text-[11px] text-purple-400 flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        Works best with menus, price lists, catalogs, or product labels
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="relative rounded-xl overflow-hidden border border-border">
                      <img
                        src={scanPreview}
                        alt="Scan preview"
                        className="w-full max-h-48 object-contain bg-black/20"
                      />
                      <button
                        onClick={clearScan}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {error && (
                      <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-red-300">{error}</p>
                      </div>
                    )}

                    {scanResult ? (
                      <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                        <span className="text-sm text-green-500 font-medium">{scanResult}</span>
                      </div>
                    ) : (
                      <button
                        onClick={handleProcessScan}
                        disabled={scanProcessing}
                        className="kf-btn-primary w-full flex items-center justify-center gap-2"
                      >
                        {scanProcessing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Extracting products...
                          </>
                        ) : (
                          <>
                            <ScanLine className="w-4 h-4" />
                            Extract Products
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            ) : activeMode === "file" ? (
              <motion.div
                key="file"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-4 pt-2"
              >
                <button
                  onClick={() => { setActiveMode(null); setFile(null); setError(null); }}
                  className="text-xs text-muted-foreground hover:text-foreground mb-3 flex items-center gap-1"
                >
                  ← Back
                </button>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1.5">
                      <span className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[hsl(var(--kf-accent1))] text-white">
                        CSV
                      </span>
                    </div>
                    <button
                      onClick={downloadTemplate}
                      className="flex items-center gap-1 text-[11px] text-[hsl(var(--kf-accent2))] hover:underline"
                    >
                      <Download className="w-3 h-3" />
                      Template
                    </button>
                  </div>

                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                      isDragging
                        ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/10"
                        : file
                        ? "border-green-500/50 bg-green-500/5"
                        : "border-border hover:border-[hsl(var(--kf-accent1))]/50 hover:bg-muted/30"
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.tsv,.txt"
                      onChange={handleFileSelect}
                      className="hidden"
                    />

                    {file ? (
                      <div className="flex items-center gap-3">
                        <FileSpreadsheet className="w-6 h-6 text-[hsl(var(--kf-accent1))]" />
                        <div className="text-left">
                          <p className="font-medium text-sm">{file.name}</p>
                          <p className="text-[11px] text-muted-foreground">{formatFileSize(file.size)}</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setFile(null); }}
                          className="p-1 hover:bg-muted rounded-full"
                        >
                          <X className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <FileSpreadsheet className="w-6 h-6 text-muted-foreground" />
                        <p className="text-sm font-medium">
                          {isDragging ? "Drop file here" : "Drop or tap to upload"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          CSV files up to 10MB
                        </p>
                      </>
                    )}
                  </div>

                  <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    Columns: Name, Price, Category, Description, Duration, SKU
                  </p>

                  {error && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-red-300">{error}</p>
                    </div>
                  )}

                  <button
                    onClick={handleFileImport}
                    disabled={!file || loading}
                    className="kf-btn-primary w-full disabled:opacity-50"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Importing...
                      </span>
                    ) : (
                      `Import ${file ? file.name.split(".")[0] : "Products"}`
                    )}
                  </button>
                </div>
              </motion.div>
            ) : activeMode === "url" ? (
              <motion.div
                key="url"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-4 pt-2"
              >
                <button
                  onClick={() => { setActiveMode(null); setLink(""); setError(null); }}
                  className="text-xs text-muted-foreground hover:text-foreground mb-3 flex items-center gap-1"
                >
                  ← Back
                </button>

                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-medium mb-1">Import from URL</h3>
                    <p className="text-[11px] text-muted-foreground">
                      Paste a direct link to a CSV file hosted online
                    </p>
                  </div>

                  <input
                    type="url"
                    placeholder="https://docs.google.com/spreadsheets/.../export?format=csv"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && link.trim()) handleLinkImport(); }}
                    className="kf-input w-full text-sm"
                    autoFocus
                  />

                  <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    For Google Sheets: File → Share → Publish to web → CSV format
                  </p>

                  {error && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-red-300">{error}</p>
                    </div>
                  )}

                  <button
                    onClick={handleLinkImport}
                    disabled={!link.trim() || loading}
                    className="kf-btn-primary w-full disabled:opacity-50"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Importing...
                      </span>
                    ) : (
                      "Import from URL"
                    )}
                  </button>
                </div>
              </motion.div>
            ) : null}
    </AnimatePresence>
  );

  if (variant === "inline") {
    return (
      <div className="kf-card overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[hsl(var(--kf-accent1))]/10">
              <Upload className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
            </div>
            <div className="text-left">
              <span className="font-medium">Import Products</span>
              <p className="text-xs text-muted-foreground">CSV, AI Scan, or URL</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {showPreview && extracted.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-[hsl(var(--kf-accent1))]">
                <CheckCircle2 className="w-4 h-4" />
                {extracted.length} found
              </span>
            )}
            {expanded ? (
              <ChevronUp className="w-5 h-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
        </button>
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="border-t border-border"
            >
              {importContent}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
      <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 sm:pt-20 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          className="w-full sm:w-[440px] kf-card border border-border shadow-2xl rounded-2xl max-h-[80vh] overflow-y-auto pointer-events-auto"
        >
          <div className="flex items-center justify-between p-4 pb-2">
            <h2 className="font-semibold text-base">Import Products</h2>
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          {importContent}
        </motion.div>
      </div>
    </>
  );
});
