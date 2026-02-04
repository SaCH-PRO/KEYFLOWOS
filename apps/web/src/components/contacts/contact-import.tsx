"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Upload, Link, Camera, FileSpreadsheet, FileImage, ChevronDown, ChevronUp } from "lucide-react";

const IMPORT_TYPES = [
  { key: "csv", label: "CSV", icon: FileSpreadsheet, accept: ".csv" },
  { key: "xlsx", label: "Excel", icon: FileSpreadsheet, accept: ".xlsx,.xls" },
  { key: "image", label: "Image/OCR", icon: FileImage, accept: "image/*" },
] as const;

type ImportType = (typeof IMPORT_TYPES)[number]["key"];

interface ContactImportProps {
  onImportFile: (type: ImportType, file: File) => Promise<void>;
  onImportLink: (url: string) => Promise<void>;
  onImportOcr: (text: string) => Promise<void>;
  loading?: boolean;
}

export function ContactImport({ onImportFile, onImportLink, onImportOcr, loading }: ContactImportProps) {
  const [expanded, setExpanded] = useState(false);
  const [importType, setImportType] = useState<ImportType>("csv");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [ocrText, setOcrText] = useState("");

  const selectedType = IMPORT_TYPES.find((t) => t.key === importType) ?? IMPORT_TYPES[0];

  const handleFileImport = async () => {
    if (!file) return;
    await onImportFile(importType, file);
    setFile(null);
  };

  const handleLinkImport = async () => {
    if (!link.trim()) return;
    await onImportLink(link.trim());
    setLink("");
  };

  const handleOcrImport = async () => {
    if (!ocrText.trim()) return;
    await onImportOcr(ocrText.trim());
    setOcrText("");
  };

  return (
    <div className="kf-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Upload className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="font-medium">Import Contacts</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-5 h-5 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="px-4 pb-4 space-y-4"
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Import type:</span>
              <div className="flex gap-1">
                {IMPORT_TYPES.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setImportType(key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all ${
                      importType === key ? "kf-btn-primary" : "kf-btn-secondary"
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <label className="flex-1 flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-border hover:border-[hsl(var(--kf-accent1))] cursor-pointer transition-colors">
                <input
                  type="file"
                  accept={selectedType.accept}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
                <Upload className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {file ? file.name : `Choose ${selectedType.label} file`}
                </span>
              </label>
              <button
                onClick={handleFileImport}
                disabled={!file || loading}
                className="kf-btn-primary px-6"
              >
                {loading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link className="w-4 h-4" />
              <span>Import from URL</span>
            </div>
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="https://example.com/contacts.csv"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                className="kf-input flex-1"
              />
              <button
                onClick={handleLinkImport}
                disabled={!link.trim() || loading}
                className="kf-btn-secondary"
              >
                Import
              </button>
            </div>
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Camera className="w-4 h-4" />
              <span>Paste OCR / Business Card Text</span>
            </div>
            <textarea
              placeholder="Paste extracted text from a business card..."
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
              className="kf-input w-full min-h-[80px] resize-none"
            />
            <button
              onClick={handleOcrImport}
              disabled={!ocrText.trim() || loading}
              className="kf-btn-secondary w-full"
            >
              Create from OCR
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
