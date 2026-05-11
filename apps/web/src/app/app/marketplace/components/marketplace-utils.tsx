// @keyflow:dormant
"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

export function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TTD`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function ReachBadge({ reach }: { reach: string }) {
  const colors: Record<string, string> = {
    LOCAL: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    REGIONAL: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    INTERNATIONAL: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  };
  return (
    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${colors[reach] || "bg-white/10 text-white/60 border-white/20"}`}>
      {reach}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-emerald-500",
    PENDING: "bg-yellow-500",
    CONFIRMED: "bg-blue-500",
    PROCESSING: "bg-orange-500",
    SHIPPED: "bg-cyan-500",
    DELIVERED: "bg-emerald-500",
    CANCELLED: "bg-red-500",
    PREPARING: "bg-yellow-500",
    PICKED_UP: "bg-blue-500",
    IN_TRANSIT: "bg-cyan-500",
    CUSTOMS: "bg-purple-500",
    DRAFT: "bg-gray-500",
    FILED: "bg-blue-500",
    UNDER_REVIEW: "bg-yellow-500",
    CLEARED: "bg-emerald-500",
    REJECTED: "bg-red-500",
    FULFILLED: "bg-emerald-500",
    PARTIAL: "bg-orange-500",
    RECEIVED: "bg-emerald-500",
    ORDERED: "bg-blue-500",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`w-2 h-2 rounded-full ${colors[status] || "bg-gray-500"}`} />
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-white/30" />
      </div>
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground max-w-xs">{description}</p>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="relative bg-[#0a0a0f]/95 border border-white/10 rounded-2xl backdrop-blur-xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl"
        >
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h2 className="text-sm font-semibold">{title}</h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 space-y-3">{children}</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground font-medium">{label}</label>
      {children}
    </div>
  );
}

export const inputClass = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-500/50 transition-colors placeholder:text-white/20";
export const selectClass = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-500/50 transition-colors appearance-none";

export function usePagination<T>(items: T[], defaultPageSize = 20) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safeP = Math.min(page, totalPages);
  const paginated = useMemo(() => {
    const start = (safeP - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safeP, pageSize]);
  return { page: safeP, pageSize, setPage, setPageSize, totalPages, paginated };
}

export function PaginationBar({ page, pageSize, totalPages, setPage, setPageSize }: { page: number; pageSize: number; totalPages: number; setPage: (p: number | ((p: number) => number)) => void; setPageSize: (s: number) => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border/30">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Rows per page:</span>
        <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="bg-white/5 border border-border/40 rounded px-2 py-1 text-sm">
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Page {page} of {totalPages}</span>
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-sm">Previous</button>
        <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-sm">Next</button>
      </div>
    </div>
  );
}