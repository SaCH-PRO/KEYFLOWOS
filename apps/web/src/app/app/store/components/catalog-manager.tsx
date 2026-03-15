"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Store,
  Briefcase,
  ShoppingBag,
  Package,
  Search,
  Filter,
  ChevronDown,
  X,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Product } from "@/lib/client";
import { formatPrice } from "@/lib/format";

function formatRelativeTime(dateStr: string | undefined | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-TT", { month: "short", day: "numeric" });
}

type Props = {
  products: Product[];
  storeServiceNames: Set<string>;
  storeItemCount: number;
  processingItems: Set<string>;
  confirmRemove: string | null;
  onToggleItem: (product: Product) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onConfirmRemoveChange: (id: string | null) => void;
  onDeleteFromStore: (serviceId: string, productName?: string) => void;
  services: { id: string; name: string }[];
};

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  SERVICE: Briefcase,
  PRODUCT: ShoppingBag,
  PACKAGE: Package,
};

const CATEGORY_FILTERS = ["ALL", "SERVICE", "PRODUCT", "PACKAGE"] as const;

export function CatalogManager({
  products,
  storeServiceNames,
  storeItemCount,
  processingItems,
  confirmRemove,
  onToggleItem,
  onSelectAll,
  onDeselectAll,
  onConfirmRemoveChange,
  onDeleteFromStore,
  services,
}: Props) {
  const [searchInput, setSearchInput] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [showFilters, setShowFilters] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<"add" | "remove" | null>(null);

  const notAddedCount = products.filter((p) => !storeServiceNames.has(p.name)).length;
  const inStoreCount = storeItemCount;

  const filteredProducts = products.filter((p) => {
    if (categoryFilter !== "ALL" && p.category !== categoryFilter) return false;
    if (searchInput.trim()) {
      const q = searchInput.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !(p.description || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  function handleBulkAdd() {
    if (bulkConfirm === "add") {
      onSelectAll();
      setBulkConfirm(null);
    } else {
      setBulkConfirm("add");
    }
  }

  function handleBulkRemove() {
    if (bulkConfirm === "remove") {
      onDeselectAll();
      setBulkConfirm(null);
    } else {
      setBulkConfirm("remove");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-background) / 0.6)",
        backdropFilter: "blur(20px)",
        border: "1px solid hsl(var(--kf-accent1) / 0.15)",
        boxShadow: "0 4px 24px hsl(var(--kf-accent1) / 0.05)",
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{
          borderBottom: "1px solid hsl(var(--kf-accent1) / 0.1)",
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), transparent)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}
          >
            <Store className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Store Catalog</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Toggle items from Commerce to display in your store</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="px-2.5 py-1 rounded-full text-[10px] font-semibold"
            style={{
              background: "hsl(142 70% 45% / 0.15)",
              color: "hsl(142 70% 60%)",
              border: "1px solid hsl(142 70% 45% / 0.2)",
            }}
          >
            {inStoreCount} In Store
          </span>
          <span
            className="px-2.5 py-1 rounded-full text-[10px] font-semibold"
            style={{
              background: "hsl(var(--kf-muted) / 0.5)",
              color: "hsl(var(--kf-muted-foreground))",
              border: "1px solid hsl(var(--kf-border))",
            }}
          >
            {notAddedCount} Not Added
          </span>
        </div>
      </div>

      {products.length > 0 && (
        <div className="px-4 pt-3 pb-2 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search items..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="kf-input w-full pl-10 text-sm"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`kf-btn-secondary inline-flex items-center gap-2 text-sm ${showFilters ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""}`}
            >
              <Filter className="w-4 h-4" />
              Filter
              <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </button>
          </div>

          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap gap-2"
              >
                {CATEGORY_FILTERS.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                      categoryFilter === cat ? "kf-btn-primary" : "kf-btn-secondary"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
                {categoryFilter !== "ALL" && (
                  <button
                    onClick={() => { setCategoryFilter("ALL"); setSearchInput(""); }}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <X className="w-3 h-3" /> Clear
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleBulkAdd}
              disabled={products.every((p) => storeServiceNames.has(p.name))}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${
                bulkConfirm === "add"
                  ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-400"
                  : "kf-btn-secondary"
              }`}
              style={{ opacity: products.every((p) => storeServiceNames.has(p.name)) ? 0.3 : 1 }}
            >
              <CheckCircle2 className="w-3 h-3 inline mr-1" />
              {bulkConfirm === "add" ? "Confirm Add All?" : "Add All"}
            </button>
            {inStoreCount > 0 && (
              <button
                onClick={handleBulkRemove}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${
                  bulkConfirm === "remove"
                    ? "bg-red-500/20 border border-red-500/30 text-red-400"
                    : "kf-btn-secondary text-red-400"
                }`}
              >
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                {bulkConfirm === "remove" ? "Confirm Remove All?" : "Remove All"}
              </button>
            )}
            {bulkConfirm && (
              <button
                onClick={() => setBulkConfirm(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {filteredProducts.length > 0 ? (
        <div className="p-3 space-y-2">
          {filteredProducts.map((p, idx) => {
            const isOnStore = storeServiceNames.has(p.name);
            const isProcessing = processingItems.has(p.id);
            const isConfirming = confirmRemove === p.id;
            const Icon = CATEGORY_ICONS[p.category] || Briefcase;

            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                className={`relative w-full flex items-center gap-3 rounded-xl px-4 py-3.5 text-left text-sm cursor-pointer transition-all ${
                  isProcessing ? "opacity-60 pointer-events-none" : ""
                }`}
                style={{
                  backgroundColor: isOnStore ? "hsl(var(--kf-accent1) / 0.08)" : "hsl(var(--kf-muted) / 0.3)",
                  border: isOnStore
                    ? "1px solid hsl(var(--kf-accent1) / 0.25)"
                    : "1px solid hsl(var(--kf-border) / 0.5)",
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (!isProcessing) onToggleItem(p);
                  }
                }}
                onClick={() => !isProcessing && !isConfirming && onToggleItem(p)}
              >
                {isConfirming && (
                  <div
                    className="absolute inset-0 rounded-xl flex items-center justify-center gap-3 z-10"
                    style={{
                      background: "hsl(var(--kf-background) / 0.95)",
                      backdropFilter: "blur(8px)",
                      border: "1px solid hsl(0 70% 50% / 0.3)",
                    }}
                  >
                    <span className="text-sm font-medium text-red-400">Remove from store?</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onConfirmRemoveChange(null); }}
                      className="kf-btn-secondary text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const matched = services.find((s) => s.name === p.name);
                        if (matched) onDeleteFromStore(matched.id, p.name);
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors"
                    >
                      Confirm
                    </button>
                  </div>
                )}

                <div
                  className={`h-5 w-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                    isOnStore ? "" : "border-[hsl(var(--kf-muted-foreground)/0.3)]"
                  }`}
                  style={
                    isOnStore
                      ? { backgroundColor: "hsl(var(--kf-accent1))", borderColor: "hsl(var(--kf-accent1))" }
                      : {}
                  }
                >
                  {isProcessing ? (
                    <div className="w-3 h-3 border-2 border-[hsl(var(--kf-accent1)/0.4)] border-t-[hsl(var(--kf-accent1))] rounded-full animate-spin" />
                  ) : isOnStore ? (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : null}
                </div>

                {p.imageUrl ? (
                  <div
                    className="h-10 w-10 rounded-xl overflow-hidden flex-shrink-0"
                    style={{
                      border: isOnStore
                        ? "1px solid hsl(var(--kf-accent1) / 0.3)"
                        : "1px solid hsl(var(--kf-border))",
                    }}
                  >
                    <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                ) : (
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold"
                    style={{
                      background: isOnStore
                        ? `linear-gradient(135deg, hsl(var(--kf-accent1) / 0.2), hsl(var(--kf-accent2) / 0.1))`
                        : "hsl(var(--kf-muted))",
                      border: isOnStore
                        ? "1px solid hsl(var(--kf-accent1) / 0.3)"
                        : "1px solid hsl(var(--kf-border))",
                      color: isOnStore ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))",
                    }}
                  >
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium truncate ${isOnStore ? "" : "text-muted-foreground"}`}>{p.name}</span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full uppercase flex-shrink-0 border"
                      style={{ borderColor: "hsl(var(--kf-accent1) / 0.2)", color: "hsl(var(--kf-accent1) / 0.7)" }}
                    >
                      {p.category}
                    </span>
                    {p.sku && (
                      <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">
                        SKU: {p.sku}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[11px] font-medium ${isOnStore ? "text-emerald-400" : "text-muted-foreground/60"}`}>
                      {isProcessing ? "Processing..." : isOnStore ? "\u2713 On store" : "Not on store"}
                    </span>
                    {(() => {
                      const updated = formatRelativeTime((p as Record<string, unknown>).updatedAt as string | undefined);
                      return updated ? <span className="text-[10px] text-muted-foreground/40">&middot; {updated}</span> : null;
                    })()}
                    {p.description && (
                      <span className="text-[10px] text-muted-foreground/40 truncate max-w-[200px]">&middot; {p.description}</span>
                    )}
                  </div>
                </div>

                <span className="text-xs font-semibold flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }}>
                  {formatPrice(p.price, p.currency)}
                </span>
              </motion.div>
            );
          })}

          <div className="flex items-center justify-between pt-2 px-1">
            <span className="text-xs text-muted-foreground">
              {storeItemCount} of {products.length} item{products.length !== 1 ? "s" : ""} displayed on store
            </span>
          </div>
        </div>
      ) : products.length === 0 ? (
        <div className="p-8 text-center space-y-3">
          <Briefcase className="w-10 h-10 mx-auto" style={{ color: "hsl(var(--kf-accent1) / 0.3)" }} />
          <p className="text-sm font-medium">No items in Commerce yet</p>
          <p className="text-xs text-muted-foreground">
            Add products in the{" "}
            <span className="font-medium" style={{ color: "hsl(var(--kf-accent1))" }}>
              Commerce
            </span>{" "}
            page first, then come back here to add them to your store.
          </p>
        </div>
      ) : (
        <div className="p-8 text-center space-y-2">
          <Search className="w-8 h-8 mx-auto text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No items match your search</p>
        </div>
      )}
    </motion.div>
  );
}
