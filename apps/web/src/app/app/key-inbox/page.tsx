"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Inbox,
  HardDrive,
  Mail,
  MessageSquare,
  Instagram,
  Facebook,
  Check,
  X,
  Loader2,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchIngestionItems,
  approveIngestionItem,
  rejectIngestionItem,
  type IngestionItem,
  type IngestionItemDetail,
} from "@/lib/api/key-inbox";
import { apiGet } from "@/lib/api";

const SOURCE_ICONS: Record<string, React.ElementType> = {
  google_drive: HardDrive,
  email: Mail,
  whatsapp: MessageSquare,
  sms: MessageSquare,
  instagram: Instagram,
  messenger: Facebook,
};

const STATUS_BADGES: Record<string, string> = {
  pending: "bg-slate-500/10 text-slate-600",
  extracting: "bg-blue-500/10 text-blue-600",
  reviewing: "bg-amber-500/10 text-amber-600",
  approved: "bg-emerald-500/10 text-emerald-600",
  rejected: "bg-rose-500/10 text-rose-600",
  error: "bg-rose-500/10 text-rose-600",
  auto_executed: "bg-violet-500/10 text-violet-600",
};

function formatSource(sourceType: string) {
  return sourceType.replace(/_/g, " ");
}

export default function KeyInboxPage() {
  const businessId = getStoredBusinessId();
  const [items, setItems] = useState<IngestionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<IngestionItemDetail | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [search, setSearch] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    const res = await fetchIngestionItems(businessId, {
      status: filterStatus || undefined,
      sourceType: filterSource || undefined,
      search: search || undefined,
      limit: 50,
    });
    if (res.data) setItems(res.data.items);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [businessId, filterStatus, filterSource, search]);

  const openDetail = async (item: IngestionItem) => {
    if (!businessId) return;
    const res = await apiGet<IngestionItemDetail>(
      `/key-inbox/businesses/${encodeURIComponent(businessId)}/items/${encodeURIComponent(item.id)}`,
    );
    if (res.data) setSelected(res.data);
  };

  const approve = async (id: string) => {
    if (!businessId) return;
    setActionId(id);
    const res = await approveIngestionItem(businessId, id);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("Item approved and executed");
      await load();
      if (selected?.id === id) setSelected(null);
    }
    setActionId(null);
  };

  const reject = async (id: string) => {
    if (!businessId) return;
    setActionId(id);
    const res = await rejectIngestionItem(businessId, id, "Rejected by user");
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("Item rejected");
      await load();
      if (selected?.id === id) setSelected(null);
    }
    setActionId(null);
  };

  if (!businessId) {
    return (
      <div className="p-4 text-sm text-muted-foreground">No active business — pick a workspace first.</div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-violet-500/20 to-rose-500/20 border border-border/40 flex items-center justify-center">
            <Inbox className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Key Inbox</h1>
            <p className="text-xs text-muted-foreground">
              One place to review, correct, and approve everything KEY sees.
            </p>
          </div>
        </div>
        <Link
          href="/app/key-connect"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
        >
          <ShieldCheck className="w-3 h-3" /> Key Connect
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-2 py-1 rounded-md bg-muted/30 border border-border/20 text-xs"
        >
          <option value="">All statuses</option>
          <option value="reviewing">Reviewing</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="error">Error</option>
          <option value="auto_executed">Auto-executed</option>
        </select>
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="px-2 py-1 rounded-md bg-muted/30 border border-border/20 text-xs"
        >
          <option value="">All sources</option>
          <option value="google_drive">Google Drive</option>
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
          <option value="instagram">Instagram</option>
          <option value="messenger">Messenger</option>
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search inbox..."
          className="px-2 py-1 rounded-md bg-muted/30 border border-border/20 text-xs flex-1 min-w-[120px]"
        />
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {loading && items.length === 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading Key Inbox...
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="rounded-xl border border-border/40 bg-card/40 p-6 text-center">
          <Inbox className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No items in Key Inbox yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Connect Google Drive, email, or messaging in{" "}
            <Link href="/app/key-connect" className="text-[hsl(var(--kf-accent1))] hover:underline">
              Key Connect
            </Link>{" "}
            to start ingesting data.
          </p>
        </div>
      )}

      <div className="grid gap-2">
        {items.map((item) => {
          const Icon = SOURCE_ICONS[item.sourceType] || Inbox;
          return (
            <div
              key={item.id}
              onClick={() => openDetail(item)}
              className="rounded-xl border border-border/40 bg-card/40 p-3 cursor-pointer hover:border-[hsl(var(--kf-accent1))]/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-lg bg-muted/30 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.summary || item.subject || "Untitled"}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatSource(item.sourceType)} · {item.fromName || item.fromEmail || item.fromPhone || "Unknown"}
                    </p>
                    {item.intentType && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Intent: {item.intentType.replace(/_/g, " ")}
                        {item.confidence ? ` · ${Math.round(item.confidence * 100)}%` : ""}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_BADGES[item.status] || "bg-muted"}`}>
                    {item.status}
                  </span>
                  {item.status === "reviewing" && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          approve(item.id);
                        }}
                        disabled={actionId === item.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-500 text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {actionId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        Approve
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          reject(item.id);
                        }}
                        disabled={actionId === item.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-rose-500 text-white hover:opacity-90 disabled:opacity-50"
                      >
                        <X className="w-3 h-3" /> Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] overflow-auto rounded-2xl border border-border bg-card p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{selected.summary || selected.subject || "Untitled"}</p>
                <p className="text-xs text-muted-foreground">
                  {formatSource(selected.sourceType)} · {selected.fromName || selected.fromEmail || selected.fromPhone || "Unknown"}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {selected.errorMessage && (
              <p className="text-xs text-rose-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {selected.errorMessage}
              </p>
            )}

            {selected.body && (
              <div className="rounded-lg bg-muted/30 p-2 text-xs text-foreground/80">
                {selected.body}
              </div>
            )}

            {selected.extractedData && Object.keys(selected.extractedData).length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">Extracted data</p>
                <pre className="rounded-lg bg-muted/30 p-2 text-[10px] overflow-auto max-h-40">
                  {JSON.stringify(selected.extractedData, null, 2)}
                </pre>
              </div>
            )}

            {selected.proposedActions && selected.proposedActions.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">Proposed actions</p>
                <div className="space-y-1">
                  {selected.proposedActions.map((action) => (
                    <div key={action.id} className="rounded-lg border border-border/40 p-2 text-xs">
                      <p className="font-medium">{action.title}</p>
                      {action.description && <p className="text-muted-foreground text-[10px]">{action.description}</p>}
                      <p className="text-[10px] text-muted-foreground mt-0.5">{action.type}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selected.status === "reviewing" && (
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={() => approve(selected.id)}
                  disabled={actionId === selected.id}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-500 text-white hover:opacity-90 disabled:opacity-50"
                >
                  {actionId === selected.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Approve all
                </button>
                <button
                  onClick={() => reject(selected.id)}
                  disabled={actionId === selected.id}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-rose-500 text-white hover:opacity-90 disabled:opacity-50"
                >
                  <X className="w-3 h-3" /> Reject
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
