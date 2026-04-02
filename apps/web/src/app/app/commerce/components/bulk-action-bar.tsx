"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, Trash2, RefreshCw, CheckSquare } from "lucide-react";

interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onExportCsv: () => void;
  onBulkStatusChange?: (status: string) => void;
  onBulkDelete: () => void;
  statusOptions?: { value: string; label: string }[];
  entityLabel?: string;
}

export function BulkActionBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
  onExportCsv,
  onBulkStatusChange,
  onBulkDelete,
  statusOptions = [],
  entityLabel = "items",
}: BulkActionBarProps) {
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border/60 bg-card/95 backdrop-blur-md shadow-2xl"
      >
        <div className="flex items-center gap-2 pr-3 border-r border-border/40">
          <CheckSquare className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
          <span className="text-xs font-semibold whitespace-nowrap">
            {selectedCount} of {totalCount}
          </span>
          {selectedCount < totalCount && (
            <button
              onClick={onSelectAll}
              className="text-[10px] text-[hsl(var(--kf-accent1))] hover:underline whitespace-nowrap"
            >
              Select all
            </button>
          )}
        </div>

        {statusOptions.length > 0 && onBulkStatusChange && (
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              className="inline-flex items-center gap-1 px-2.5 min-h-[36px] text-[11px] font-medium rounded-lg bg-white/[0.05] border border-border/40 hover:bg-white/[0.08] transition-colors whitespace-nowrap"
            >
              <RefreshCw className="w-3 h-3" />
              Status
            </button>
            {showStatusMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowStatusMenu(false)} />
                <div className="absolute bottom-full mb-1.5 left-0 z-50 w-40 rounded-xl border border-border/50 bg-card shadow-xl overflow-hidden">
                  <div className="p-1">
                    {statusOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          onBulkStatusChange(opt.value);
                          setShowStatusMenu(false);
                        }}
                        className="w-full text-left px-3 py-2 text-[11px] rounded-lg hover:bg-white/[0.05] transition-colors"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <button
          onClick={onExportCsv}
          className="inline-flex items-center gap-1 px-2.5 min-h-[36px] text-[11px] font-medium rounded-lg bg-white/[0.05] border border-border/40 hover:bg-white/[0.08] transition-colors whitespace-nowrap"
        >
          <Download className="w-3 h-3" />
          Export CSV
        </button>

        <button
          onClick={onBulkDelete}
          className="inline-flex items-center gap-1 px-2.5 min-h-[36px] text-[11px] font-medium rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors whitespace-nowrap"
        >
          <Trash2 className="w-3 h-3" />
          Delete
        </button>

        <button
          onClick={onClearSelection}
          className="ml-1 p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors"
          aria-label="Clear selection"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground/60" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}

export function exportToCsv<T extends Record<string, unknown>>(
  items: T[],
  columns: { key: keyof T; header: string; format?: (val: unknown) => string }[],
  filename: string,
) {
  const header = columns.map((c) => c.header).join(",");
  const rows = items.map((item) =>
    columns
      .map((c) => {
        const val = item[c.key];
        const formatted = c.format ? c.format(val) : String(val ?? "");
        return `"${formatted.replace(/"/g, '""')}"`;
      })
      .join(","),
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
