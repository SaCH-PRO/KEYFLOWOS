"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, useDragControls } from "framer-motion";
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
  ChevronLeft,
  Download,
  Globe,
  Briefcase,
  ShoppingBag,
  Layers,
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

type ImportMode = "file" | "scan" | "url";
type ImportStep = "choose" | "upload" | "preview" | "importing";

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  SERVICE: <Briefcase className="w-3.5 h-3.5" />,
  PRODUCT: <ShoppingBag className="w-3.5 h-3.5" />,
  PACKAGE: <Layers className="w-3.5 h-3.5" />,
};

const MODES: { key: ImportMode; label: string; sublabel: string; icon: typeof Upload; color: string }[] = [
  { key: "file", label: "CSV File", sublabel: "Spreadsheet import", icon: FileSpreadsheet, color: "#10b981" },
  { key: "scan", label: "AI Scan", sublabel: "Photo or menu", icon: Camera, color: "#a855f7" },
  { key: "url", label: "URL", sublabel: "Link to file", icon: Globe, color: "#3b82f6" },
];

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
  const [mode, setMode] = useState<ImportMode | null>(null);
  const [step, setStep] = useState<ImportStep>("choose");
  const [extracted, setExtracted] = useState<ExtractedProduct[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const dragY = useMotionValue(0);
  const dragControls = useDragControls();
  const bgOpacity = useTransform(dragY, [0, 300], [1, 0.3]);
  const modalScale = useTransform(dragY, [0, 300], [1, 0.92]);

  useEffect(() => {
    if (open) dragY.set(0);
  }, [open, dragY]);

  const resetState = useCallback(() => {
    setMode(null);
    setStep("choose");
    setExtracted([]);
    setSelected(new Set());
    setLoading(false);
    setEditingIdx(null);
    setError(null);
    setImagePreview(null);
    setUrlInput("");
    setIsDragging(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleBack = useCallback(() => {
    setMode(null);
    setStep("choose");
    setError(null);
    setImagePreview(null);
    setUrlInput("");
    setIsDragging(false);
  }, []);

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
      setSelected(new Set(data.extracted.map((_: ExtractedProduct, i: number) => i)));
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
      setSelected(new Set(data.extracted.map((_: ExtractedProduct, i: number) => i)));
      setStep("preview");
    } catch {
      setError("Failed to analyze image");
    } finally {
      setLoading(false);
    }
  }, [businessId, currency]);

  const handleUrlImport = useCallback(async () => {
    if (!businessId || !urlInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(urlInput.trim());
      if (!res.ok) {
        setError("Could not fetch file from that URL");
        return;
      }
      const blob = await res.blob();
      const file = new File([blob], "import.csv", { type: blob.type || "text/csv" });
      await handleFileUpload(file);
    } catch {
      setError("Failed to fetch or process URL");
    } finally {
      setLoading(false);
    }
  }, [businessId, urlInput, handleFileUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
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
    const csv = "Name,Price,Category,Description,Duration,SKU\nHaircut,150,SERVICE,\"Basic men's haircut\",30,SVC-HAIR-001\nShampoo,45,PRODUCT,\"Professional shampoo\",,";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "product-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleModeSelect = useCallback((m: ImportMode) => {
    setMode(m);
    setStep("upload");
    setError(null);
  }, []);

  if (!open) return null;

  const showBackButton = step !== "choose";
  const headerTitle = step === "choose" ? "Import Products" : mode === "file" ? "CSV File Import" : mode === "scan" ? "AI Scan Import" : "URL Import";

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 sm:pt-20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{ opacity: bgOpacity }}
      >
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />

        <motion.div
          className="relative w-full sm:w-[480px] kf-card border border-border shadow-2xl rounded-2xl max-h-[80vh] overflow-hidden flex flex-col z-10"
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 200 }}
          style={{ scale: modalScale }}
          drag="y"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.05, bottom: 0.5 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 120 || info.velocity.y > 500) {
              handleClose();
            } else {
              dragY.set(0);
            }
          }}
          onClick={e => e.stopPropagation()}
        >
          <div
            className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => dragControls.start(e)}
            style={{ touchAction: "none" }}
          >
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          <div className="flex items-center justify-between px-4 pb-2">
            <div className="flex items-center gap-2">
              {showBackButton && (
                <button
                  onClick={step === "preview" ? () => { setStep("upload"); setExtracted([]); setSelected(new Set()); setError(null); } : handleBack}
                  className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors"
                  aria-label="Back"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
              <h2 className="font-semibold text-base">{headerTitle}</h2>
            </div>
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <AnimatePresence mode="wait">
              {step === "choose" && (
                <motion.div
                  key="choose"
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
                </motion.div>
              )}

              {step === "upload" && mode === "file" && (
                <motion.div
                  key="file-upload"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="p-4 pt-2"
                >
                  <div
                    className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
                      isDragging
                        ? "border-[hsl(var(--kf-accent1))]/60 bg-[hsl(var(--kf-accent1))]/5"
                        : "border-white/20 hover:border-[hsl(var(--kf-accent1))]/40 hover:bg-muted/20"
                    }`}
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {loading ? (
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-8 h-8 text-[hsl(var(--kf-accent1))] animate-spin" />
                        <p className="text-sm text-white font-medium">Parsing file...</p>
                        <p className="text-xs text-muted-foreground">Reading columns and rows</p>
                      </div>
                    ) : (
                      <>
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: "#10b98115" }}>
                          <FileSpreadsheet className="w-6 h-6 text-emerald-400" />
                        </div>
                        <p className="text-sm text-white font-medium mb-1">Drop your CSV file here</p>
                        <p className="text-xs text-muted-foreground">or click to browse</p>
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
                    <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-red-300">{error}</p>
                    </div>
                  )}

                  <button
                    onClick={handleDownloadTemplate}
                    className="mt-4 flex items-center gap-1.5 text-xs text-[hsl(var(--kf-accent1))] hover:underline mx-auto"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download CSV template
                  </button>
                </motion.div>
              )}

              {step === "upload" && mode === "scan" && (
                <motion.div
                  key="scan-upload"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="p-4 pt-2"
                >
                  <div
                    className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
                      isDragging
                        ? "border-purple-400/60 bg-purple-500/5"
                        : "border-white/20 hover:border-purple-400/40 hover:bg-muted/20"
                    }`}
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
                    onClick={() => imageInputRef.current?.click()}
                  >
                    {loading ? (
                      <div className="flex flex-col items-center gap-3">
                        {imagePreview && (
                          <img src={imagePreview} alt="Scanning" className="w-24 h-24 object-cover rounded-lg opacity-70" />
                        )}
                        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                        <p className="text-sm text-white font-medium">AI is analyzing your image...</p>
                        <p className="text-xs text-muted-foreground">Extracting products, prices, and details</p>
                      </div>
                    ) : (
                      <>
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: "#a855f715" }}>
                          <Camera className="w-6 h-6 text-purple-400" />
                        </div>
                        <p className="text-sm text-white font-medium mb-1">Upload or take a photo</p>
                        <p className="text-xs text-muted-foreground">Menu, price list, catalog, or flyer</p>
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
                    <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-red-300">{error}</p>
                    </div>
                  )}
                </motion.div>
              )}

              {step === "upload" && mode === "url" && (
                <motion.div
                  key="url-upload"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="p-4 pt-2"
                >
                  <p className="text-xs text-muted-foreground mb-3">Paste a link to a CSV file hosted online</p>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="url"
                        value={urlInput}
                        onChange={e => setUrlInput(e.target.value)}
                        placeholder="https://example.com/products.csv"
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-border text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                        onKeyDown={e => { if (e.key === "Enter" && urlInput.trim()) handleUrlImport(); }}
                        autoFocus
                      />
                    </div>
                    <Button
                      onClick={handleUrlImport}
                      disabled={!urlInput.trim() || loading}
                      className="bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] text-white font-medium px-4 shrink-0"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Fetch"}
                    </Button>
                  </div>

                  {error && (
                    <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-red-300">{error}</p>
                    </div>
                  )}

                  <p className="mt-4 text-[11px] text-muted-foreground text-center">
                    Supports CSV files. The file must be publicly accessible.
                  </p>
                </motion.div>
              )}

              {step === "preview" && (
                <motion.div
                  key="preview"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="p-4 pt-2 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-white font-medium">
                        {extracted.length} product{extracted.length === 1 ? '' : 's'} found
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selected.size} selected · tap to edit
                      </p>
                    </div>
                    <button
                      onClick={toggleAll}
                      className="text-xs text-[hsl(var(--kf-accent1))] hover:underline"
                    >
                      {selected.size === extracted.length ? "Deselect all" : "Select all"}
                    </button>
                  </div>

                  {error && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-red-300">{error}</p>
                    </div>
                  )}

                  <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
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
                              <span className="text-sm text-white font-medium truncate">{item.name || "Unnamed"}</span>
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

                          <div className="flex items-center gap-1.5 shrink-0">
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
                  className="flex flex-col items-center gap-4 py-12 px-4"
                >
                  <Loader2 className="w-10 h-10 text-[hsl(var(--kf-accent1))] animate-spin" />
                  <p className="text-sm text-white font-medium">Importing {selected.size} product{selected.size === 1 ? '' : 's'}...</p>
                  <p className="text-xs text-muted-foreground">This may take a moment</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {step === "preview" && (
            <div className="px-4 py-3 border-t border-border flex items-center justify-end">
              <Button
                onClick={handleConfirmImport}
                disabled={selected.size === 0 || loading}
                className="bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] text-white font-medium px-5"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Package className="w-4 h-4 mr-2" />
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
