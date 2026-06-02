"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Trash2, RotateCcw, AlertTriangle, Search, X } from "lucide-react";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { fetchTrashItems, restoreTrashItem, permanentDeleteTrashItem } from "@/lib/client";

const MODEL_LABELS: Record<string, string> = {
  contact: "Contacts",
  deal: "Deals",
  product: "Products",
  quote: "Quotes",
  invoice: "Invoices",
  booking: "Bookings",
  project: "Projects",
  projectTask: "Tasks",
  expense: "Expenses",
  automationFlow: "Flows",
  account: "Accounts",
  service: "Services",
  staffMember: "Staff",
  socialPost: "Social Posts",
  site: "Sites",
  recurringInvoice: "Recurring",
  emailCampaign: "Campaigns",
  leadForm: "Lead Forms",
  landingPage: "Landing Pages",
  communityPost: "Posts",
  communityComment: "Comments",
  opportunity: "Opportunities",
};

function formatDeletedItem(item: Record<string, unknown>) {
  const model = (item._model as string) || "item";
  const name =
    (item.name as string) ||
    (item.title as string) ||
    (item.description as string) ||
    (item.firstName as string) ||
    (item.email as string) ||
    (item.invoiceNumber as string) ||
    (item.quoteNumber as string) ||
    (item.body as string) ||
    (item.content as string) ||
    "Untitled";
  return { model, name: String(name).slice(0, 60) };
}

export default function TrashPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) { setBusinessId(fresh); return; }
      const stored = getStoredBusinessId();
      if (stored) setBusinessId(stored);
    };
    void init();
  }, []);

  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [total, setTotal] = useState(0);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchTrashItems(businessId, {
        model: selectedModel || undefined,
        limit,
        offset,
      });
      if (res.data) {
        setItems(res.data.items);
        setTotal(res.data.total);
      }
    } catch (e) {
      console.error("Failed to load trash", e);
    } finally {
      setLoading(false);
    }
  }, [businessId, selectedModel, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRestore = async (model: string, id: string) => {
    if (!businessId) return;
    setRestoring(id);
    try {
      await restoreTrashItem(businessId, model, id);
      setItems((prev) => prev.filter((i) => (i.id as string) !== id));
      setTotal((t) => t - 1);
    } catch (e) {
      console.error("Failed to restore", e);
    } finally {
      setRestoring(null);
    }
  };

  const handleDelete = async (model: string, id: string) => {
    if (!businessId) return;
    if (!confirm("Permanently delete this item? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await permanentDeleteTrashItem(businessId, model, id);
      setItems((prev) => prev.filter((i) => (i.id as string) !== id));
      setTotal((t) => t - 1);
    } catch (e) {
      console.error("Failed to delete", e);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-muted-foreground" />
            Trash
          </h1>
          <p className="text-sm text-muted-foreground">Restore or permanently delete removed items.</p>
        </div>
        <div className="text-sm text-muted-foreground">{total} items</div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { setSelectedModel(""); setOffset(0); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            selectedModel === "" ? "bg-primary text-primary-foreground border-primary" : "bg-card/50 border-border/60 text-muted-foreground hover:bg-card"
          }`}
        >
          All
        </button>
        {Object.entries(MODEL_LABELS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setSelectedModel(key); setOffset(0); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              selectedModel === key ? "bg-primary text-primary-foreground border-primary" : "bg-card/50 border-border/60 text-muted-foreground hover:bg-card"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm overflow-hidden">
        {loading && items.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">Loading...</div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">Trash is empty.</div>
        ) : (
          <div className="divide-y divide-border/30">
            {items.map((item, i) => {
              const { model, name } = formatDeletedItem(item);
              const id = item.id as string;
              const deletedAt = item.deletedAt
                ? new Date(item.deletedAt as string).toLocaleDateString()
                : "—";

              return (
                <motion.div
                  key={`${model}-${id}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-card/60 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-muted/30 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {MODEL_LABELS[model] || model} · Deleted {deletedAt}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRestore(model, id)}
                      disabled={restoring === id || deleting === id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
                    >
                      <RotateCcw className="w-3 h-3" />
                      {restoring === id ? "Restoring..." : "Restore"}
                    </button>
                    <button
                      onClick={() => handleDelete(model, id)}
                      disabled={restoring === id || deleting === id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-40"
                    >
                      <X className="w-3 h-3" />
                      {deleting === id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {total > limit && (
        <div className="flex items-center justify-between text-sm">
          <button
            onClick={() => setOffset((o) => Math.max(0, o - limit))}
            disabled={offset === 0}
            className="px-3 py-1.5 rounded-lg border border-border/60 bg-card/50 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-muted-foreground text-xs">
            {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <button
            onClick={() => setOffset((o) => o + limit)}
            disabled={offset + limit >= total}
            className="px-3 py-1.5 rounded-lg border border-border/60 bg-card/50 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
