"use client";

import { useState, useRef, useCallback, DragEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  UserPlus,
  Camera,
  Upload,
  Globe,
  FileSpreadsheet,
  FileText,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Image as ImageIcon,
  ScanLine,
} from "lucide-react";
import { getGoogleContactsAuthUrl, scanContactImage } from "@/lib/client";
import { toast } from "sonner";

type CaptureMode = "manual" | "scan" | "file" | "google" | "url";
type FileType = "csv" | "xlsx" | "vcf";

interface ContactCaptureProps {
  onManualAdd: () => void;
  onImportFile: (type: FileType | "image", file: File) => Promise<void>;
  onImportLink: (url: string) => Promise<void>;
  onClose: () => void;
  loading?: boolean;
  businessId?: string;
}

const CSV_TEMPLATE = `firstName,lastName,email,phone,company,address,city,country,status
John,Doe,john@example.com,+1868123456,Acme Corp,123 Main Street,Port of Spain,Trinidad,LEAD
Jane,Smith,jane@example.com,+1868654321,Tech Inc,456 Oak Avenue,San Fernando,Trinidad,PROSPECT`;

const MODES: { key: CaptureMode; label: string; sublabel: string; icon: typeof UserPlus; color: string }[] = [
  { key: "manual", label: "Manual", sublabel: "Type it in", icon: UserPlus, color: "hsl(var(--kf-accent1))" },
  { key: "scan", label: "Scan", sublabel: "Photo or card", icon: Camera, color: "#a855f7" },
  { key: "file", label: "File", sublabel: "CSV, Excel, vCard", icon: Upload, color: "hsl(var(--kf-accent2))" },
  { key: "google", label: "Google", sublabel: "Sync contacts", icon: Globe, color: "#3b82f6" },
  { key: "url", label: "URL", sublabel: "Link to file", icon: Globe, color: "#10b981" },
];

export function ContactCapture({ onManualAdd, onImportFile, onImportLink, onClose, loading, businessId }: ContactCaptureProps) {
  const [activeMode, setActiveMode] = useState<CaptureMode | null>(null);
  const [fileType, setFileType] = useState<FileType>("csv");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [scanImage, setScanImage] = useState<File | null>(null);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [scanProcessing, setScanProcessing] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const handleGoogleConnect = async () => {
    if (!businessId) return;
    setGoogleLoading(true);
    try {
      const result = await getGoogleContactsAuthUrl(businessId);
      if (result?.data?.url) {
        window.location.href = result.data.url;
      } else {
        toast.error("Could not get Google authorization URL");
      }
    } catch {
      toast.error("Failed to start Google connection");
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      const ext = droppedFile.name.split(".").pop()?.toLowerCase();
      if (ext === "csv") setFileType("csv");
      else if (ext === "xlsx" || ext === "xls") setFileType("xlsx");
      else if (ext === "vcf") setFileType("vcf");
      setFile(droppedFile);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) setFile(selectedFile);
  };

  const handleFileImport = async () => {
    if (!file) return;
    try {
      await onImportFile(fileType, file);
      toast.success("Contacts imported successfully");
      setFile(null);
      onClose();
    } catch {
      toast.error("Import failed");
    }
  };

  const handleLinkImport = async () => {
    if (!link.trim()) return;
    try {
      await onImportLink(link.trim());
      toast.success("Contacts imported from URL");
      setLink("");
      onClose();
    } catch {
      toast.error("Import from URL failed");
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contacts_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleScanCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setScanImage(selectedFile);
    const reader = new FileReader();
    reader.onload = (ev) => setScanPreview(ev.target?.result as string);
    reader.readAsDataURL(selectedFile);
  }, []);

  const handleProcessScan = async () => {
    if (!scanImage || !businessId) return;
    setScanProcessing(true);
    try {
      const result = await scanContactImage(scanImage, businessId);
      const name = [result.extracted?.firstName, result.extracted?.lastName].filter(Boolean).join(" ") || "Contact";
      setScanResult(`${name} added!`);
      toast.success(`${name} created from scan`);
      setTimeout(() => { onClose(); }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not process this image";
      toast.error(msg);
    } finally {
      setScanProcessing(false);
    }
  };

  const clearScan = () => {
    setScanImage(null);
    setScanPreview(null);
    setScanResult(null);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleModeSelect = (mode: CaptureMode) => {
    if (mode === "manual") {
      onManualAdd();
      onClose();
      return;
    }
    if (mode === "google") {
      handleGoogleConnect();
      return;
    }
    setActiveMode(mode);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        className="fixed left-2 right-2 top-16 z-50 kf-card border border-border shadow-2xl rounded-2xl max-h-[80vh] overflow-y-auto sm:left-1/2 sm:top-1/2 sm:right-auto sm:bottom-auto sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[440px]"
      >
        <div className="flex items-center justify-between p-4 pb-2">
          <h2 className="font-semibold text-base">Add Contacts</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <AnimatePresence mode="wait">
          {!activeMode ? (
            <motion.div
              key="modes"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-4 pt-2"
            >
              <p className="text-xs text-muted-foreground mb-3">Choose how you'd like to add contacts</p>
              <div className="grid grid-cols-2 gap-2">
                {MODES.map(({ key, label, sublabel, icon: Icon, color }) => (
                  <button
                    key={key}
                    onClick={() => handleModeSelect(key)}
                    disabled={key === "google" && googleLoading}
                    className="flex items-center gap-3 p-3 rounded-xl border border-border hover:border-[hsl(var(--kf-accent1))]/30 hover:bg-muted/30 transition-all text-left group"
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105"
                      style={{ background: `${color}15` }}
                    >
                      {key === "google" && googleLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" style={{ color }} />
                      ) : (
                        <Icon className="w-5 h-5" style={{ color }} />
                      )}
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
                  Contacts from bookings and lead forms are added automatically
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
                onClick={() => { setActiveMode(null); clearScan(); }}
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
                    <h3 className="font-semibold text-sm mb-1">Scan a Business Card or Contact</h3>
                    <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                      Take a photo or upload an image — we'll extract the contact info automatically
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

                  <div className="p-2.5 rounded-xl bg-purple-500/5 border border-purple-500/10">
                    <p className="text-[11px] text-purple-400 flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      Works best with business cards, name tags, flyers, or contact info on screen
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
                          Extracting contact info...
                        </>
                      ) : (
                        <>
                          <ScanLine className="w-4 h-4" />
                          Extract Contact
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
                onClick={() => { setActiveMode(null); setFile(null); }}
                className="text-xs text-muted-foreground hover:text-foreground mb-3 flex items-center gap-1"
              >
                ← Back
              </button>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5">
                    {(["csv", "xlsx", "vcf"] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => { setFileType(type); setFile(null); }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                          fileType === type
                            ? "bg-[hsl(var(--kf-accent1))] text-white"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {type === "vcf" ? "vCard" : type.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {fileType !== "vcf" && (
                    <button
                      onClick={downloadTemplate}
                      className="flex items-center gap-1 text-[11px] text-[hsl(var(--kf-accent2))] hover:underline"
                    >
                      <Download className="w-3 h-3" />
                      Template
                    </button>
                  )}
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
                    accept={fileType === "csv" ? ".csv" : fileType === "xlsx" ? ".xlsx,.xls" : ".vcf"}
                    onChange={handleFileSelect}
                    className="hidden"
                  />

                  {file ? (
                    <div className="flex items-center gap-3">
                      <FileText className="w-6 h-6 text-[hsl(var(--kf-accent1))]" />
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
                        {fileType.toUpperCase()} files up to 5MB
                      </p>
                    </>
                  )}
                </div>

                {fileType === "vcf" ? (
                  <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    Export vCard from your phone Contacts, Google Contacts, or Outlook
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    Columns: firstName, lastName, email, phone, company, status
                  </p>
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
                    `Import ${file ? file.name.split(".")[0] : "Contacts"}`
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
                onClick={() => { setActiveMode(null); setLink(""); }}
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
                  className="kf-input w-full text-sm"
                />

                <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  For Google Sheets: File → Share → Publish to web → CSV format
                </p>

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
      </motion.div>
    </>
  );
}
