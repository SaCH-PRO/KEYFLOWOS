"use client";

import { useState, useRef, DragEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  Link2,
  ScanText,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  X,
  FileText,
  Download,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

type ImportMethod = "file" | "url" | "ocr";
type FileType = "csv" | "xlsx";

interface ContactImportProps {
  onImportFile: (type: FileType | "image", file: File) => Promise<void>;
  onImportLink: (url: string) => Promise<void>;
  onImportOcr: (text: string) => Promise<void>;
  loading?: boolean;
}

const CSV_TEMPLATE = `firstName,lastName,email,phone,company,status
John,Doe,john@example.com,+1868123456,Acme Corp,LEAD
Jane,Smith,jane@example.com,+1868654321,Tech Inc,PROSPECT`;

export function ContactImport({ onImportFile, onImportLink, onImportOcr, loading }: ContactImportProps) {
  const [expanded, setExpanded] = useState(false);
  const [method, setMethod] = useState<ImportMethod>("file");
  const [fileType, setFileType] = useState<FileType>("csv");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      const ext = droppedFile.name.split(".").pop()?.toLowerCase();
      if (ext === "csv") setFileType("csv");
      else if (ext === "xlsx" || ext === "xls") setFileType("xlsx");
      setFile(droppedFile);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleFileImport = async () => {
    if (!file) return;
    await onImportFile(fileType, file);
    setFile(null);
    setUploadSuccess(true);
    setTimeout(() => setUploadSuccess(false), 3000);
  };

  const handleLinkImport = async () => {
    if (!link.trim()) return;
    await onImportLink(link.trim());
    setLink("");
    setUploadSuccess(true);
    setTimeout(() => setUploadSuccess(false), 3000);
  };

  const handleOcrImport = async () => {
    if (!ocrText.trim()) return;
    await onImportOcr(ocrText.trim());
    setOcrText("");
    setUploadSuccess(true);
    setTimeout(() => setUploadSuccess(false), 3000);
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

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

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
            <span className="font-medium">Import Contacts</span>
            <p className="text-xs text-muted-foreground">CSV, Excel, URL, or Business Card</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {uploadSuccess && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <CheckCircle2 className="w-4 h-4" />
              Imported!
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
            <div className="flex border-b border-border">
              {[
                { key: "file" as const, label: "Upload File", icon: FileSpreadsheet },
                { key: "url" as const, label: "From URL", icon: Link2 },
                { key: "ocr" as const, label: "Business Card", icon: ScanText },
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setMethod(key)}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 ${
                    method === key
                      ? "border-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/5"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            <div className="p-4">
              {method === "file" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      {(["csv", "xlsx"] as const).map((type) => (
                        <button
                          key={type}
                          onClick={() => setFileType(type)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                            fileType === type
                              ? "bg-[hsl(var(--kf-accent1))] text-white"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          {type.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={downloadTemplate}
                      className="flex items-center gap-1.5 text-xs text-[hsl(var(--kf-accent2))] hover:underline"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Template
                    </button>
                  </div>

                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
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
                      accept={fileType === "csv" ? ".csv" : ".xlsx,.xls"}
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    
                    {file ? (
                      <>
                        <div className="flex items-center gap-3 p-3 bg-background rounded-lg border border-border">
                          <FileText className="w-8 h-8 text-[hsl(var(--kf-accent1))]" />
                          <div className="text-left">
                            <p className="font-medium text-sm">{file.name}</p>
                            <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setFile(null);
                            }}
                            className="p-1 hover:bg-muted rounded-full transition-colors"
                          >
                            <X className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground">Click to change file or drag a new one</p>
                      </>
                    ) : (
                      <>
                        <div className="p-3 rounded-full bg-muted">
                          <Upload className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <div className="text-center">
                          <p className="font-medium">
                            {isDragging ? "Drop file here" : "Drag & drop or click to upload"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Supports {fileType.toUpperCase()} files up to 10MB
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="p-3 rounded-lg bg-muted/50 border border-border">
                    <p className="text-xs text-muted-foreground flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>
                        Your file should have columns: <strong>firstName</strong>, <strong>lastName</strong>, <strong>email</strong>, <strong>phone</strong>, <strong>company</strong>, <strong>status</strong>. 
                        Download the template for the correct format.
                      </span>
                    </p>
                  </div>

                  <button
                    onClick={handleFileImport}
                    disabled={!file || loading}
                    className="kf-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? "Importing..." : `Import ${file ? file.name.split(".")[0] : "Contacts"}`}
                  </button>
                </div>
              )}

              {method === "url" && (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Import from URL</label>
                    <p className="text-xs text-muted-foreground mb-3">
                      Enter a direct link to a CSV file hosted online (Google Sheets, Dropbox, etc.)
                    </p>
                  </div>

                  <input
                    type="url"
                    placeholder="https://docs.google.com/spreadsheets/.../export?format=csv"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    className="kf-input w-full"
                  />

                  <div className="p-3 rounded-lg bg-muted/50 border border-border">
                    <p className="text-xs text-muted-foreground">
                      <strong>Tip:</strong> For Google Sheets, use File → Share → Publish to web, then select CSV format.
                    </p>
                  </div>

                  <button
                    onClick={handleLinkImport}
                    disabled={!link.trim() || loading}
                    className="kf-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? "Importing..." : "Import from URL"}
                  </button>
                </div>
              )}

              {method === "ocr" && (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Extract from Business Card</label>
                    <p className="text-xs text-muted-foreground mb-3">
                      Use your phone's camera to scan a business card, then paste the extracted text below.
                    </p>
                  </div>

                  <textarea
                    placeholder={`John Doe
Marketing Director
Acme Corporation
john.doe@acme.com
+1 (868) 555-1234
123 Business Ave, Port of Spain`}
                    value={ocrText}
                    onChange={(e) => setOcrText(e.target.value)}
                    className="kf-input w-full min-h-[140px] resize-none font-mono text-sm"
                  />

                  <div className="p-3 rounded-lg bg-[hsl(var(--kf-accent2))]/10 border border-[hsl(var(--kf-accent2))]/20">
                    <p className="text-xs text-[hsl(var(--kf-accent2))]">
                      <strong>How it works:</strong> Our AI will automatically extract name, email, phone, company, and job title from the text.
                    </p>
                  </div>

                  <button
                    onClick={handleOcrImport}
                    disabled={!ocrText.trim() || loading}
                    className="kf-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? "Extracting..." : "Create Contact from Text"}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
