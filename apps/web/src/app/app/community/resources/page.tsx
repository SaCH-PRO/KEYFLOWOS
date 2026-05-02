"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronLeft, Package, Plus, Search, Download, X, FileText } from "lucide-react";
import {
  listResources,
  publishResource,
  recordResourceDownload,
  listMyResources,
  listMyResourceDownloads,
  type ResourceListing,
  type ResourceType,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

type ResourceDownloadEntry = {
  id: string;
  productId: string;
  pricePaid: number;
  currency: string;
  createdAt: string;
  product: ResourceListing & { business?: { name?: string } | null; downloadUrl?: string };
};

const RESOURCE_TYPES = [
  { value: "TEMPLATE", label: "Template" },
  { value: "PROMPT_LIBRARY", label: "Prompts" },
  { value: "PROCESS_DOC", label: "Process Doc" },
  { value: "EDU_CONTENT", label: "Education" },
  { value: "CANVA_KIT", label: "Canva Kit" },
  { value: "OTHER", label: "Other" },
];

export default function ResourcesPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [tab, setTab] = useState<"browse" | "mine" | "downloaded">("browse");
  const [items, setItems] = useState<ResourceListing[]>([]);
  const [mine, setMine] = useState<ResourceListing[]>([]);
  const [downloads, setDownloads] = useState<ResourceDownloadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [showPublish, setShowPublish] = useState(false);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    if (tab === "browse") {
      const r = await listResources({
        search: search || undefined,
        resourceType: typeFilter || undefined,
        isFree: freeOnly ? true : undefined,
      });
      setItems(r.data?.data ?? []);
    } else if (tab === "mine" && businessId) {
      const r = await listMyResources(businessId);
      setMine(r.data ?? []);
    } else if (tab === "downloaded" && businessId) {
      const r = await listMyResourceDownloads(businessId);
      setDownloads(r.data ?? []);
    }
    setLoading(false);
  }, [tab, businessId, search, typeFilter, freeOnly]);

  useEffect(() => { void load(); }, [load]);

  const handleDownload = async (r: ResourceListing) => {
    if (!businessId) return;
    const res = await recordResourceDownload(businessId, r.id, "marketplace");
    if (res.data?.downloadUrl) window.open(res.data.downloadUrl, "_blank");
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button onClick={() => router.push("/app/community")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="w-4 h-4" />Back to Community
      </button>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10"><Package className="w-5 h-5 text-[hsl(var(--kf-accent1))]" /></div>
          <div>
            <h1 className="text-xl font-bold">Resource Marketplace</h1>
            <p className="text-xs text-muted-foreground">Templates, prompts, and digital products from the community</p>
          </div>
        </div>
        <button onClick={() => setShowPublish(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))] text-white text-xs font-medium hover:opacity-90">
          <Plus className="w-3.5 h-3.5" />Publish Resource
        </button>
      </div>

      <div className="flex gap-1 border-b border-border/30">
        {(["browse", "mine", "downloaded"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-xs font-medium capitalize ${tab === t ? "border-b-2 border-[hsl(var(--kf-accent1))] text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t === "downloaded" ? "My Downloads" : t === "mine" ? "My Listings" : "Browse"}
          </button>
        ))}
      </div>

      {tab === "browse" && (
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resources..." className="w-full pl-9 pr-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm">
            <option value="">All Types</option>
            {RESOURCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-muted-foreground px-3">
            <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> Free only
          </label>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-pulse">{[1, 2, 3, 4].map((i) => <div key={i} className="h-40 bg-muted/20 rounded-xl" />)}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tab === "browse" && items.length === 0 && <p className="col-span-2 text-center py-12 text-sm text-muted-foreground">No resources found</p>}
          {tab === "browse" && items.map((r) => <ResourceCard key={r.id} r={r} onDownload={() => handleDownload(r)} />)}
          {tab === "mine" && mine.length === 0 && <p className="col-span-2 text-center py-12 text-sm text-muted-foreground">You haven&apos;t published any resources yet</p>}
          {tab === "mine" && mine.map((r) => <ResourceCard key={r.id} r={r} hideDownload />)}
          {tab === "downloaded" && downloads.length === 0 && <p className="col-span-2 text-center py-12 text-sm text-muted-foreground">No downloads yet</p>}
          {tab === "downloaded" && downloads.map((d) => (
            <div key={d.id} className="kf-card rounded-xl p-4 border border-border/30">
              <h3 className="text-sm font-semibold">{d.product?.name}</h3>
              <p className="text-xs text-muted-foreground mt-1">by {d.product?.business?.name}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-2">Downloaded {new Date(d.createdAt).toLocaleDateString()}</p>
              {d.product?.downloadUrl && (
                <a href={d.product.downloadUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-[hsl(var(--kf-accent1))]">
                  <Download className="w-3 h-3" />Re-download
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {showPublish && businessId && (
        <PublishModal businessId={businessId} onClose={() => setShowPublish(false)} onPublished={() => { setShowPublish(false); setTab("mine"); void load(); }} />
      )}
    </div>
  );
}

function ResourceCard({ r, onDownload, hideDownload }: { r: ResourceListing; onDownload?: () => void; hideDownload?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="kf-card rounded-xl p-4 border border-border/30 flex flex-col">
      <div className="flex items-start gap-2 mb-2">
        <div className="p-2 rounded-lg bg-muted/20"><FileText className="w-4 h-4 text-muted-foreground" /></div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]">{r.resourceType}</span>
          <h3 className="text-sm font-semibold mt-1 truncate">{r.name}</h3>
          {r.business && <p className="text-[11px] text-muted-foreground truncate">by {r.business.name}</p>}
        </div>
      </div>
      {r.description && <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{r.description}</p>}
      <div className="mt-auto flex items-center justify-between">
        <div>
          {r.isFree ? (
            <span className="text-sm font-bold text-emerald-400">FREE</span>
          ) : (
            <span className="text-sm font-bold">${r.price} <span className="text-[10px] text-muted-foreground">{r.currency}</span></span>
          )}
          {r._count && <p className="text-[10px] text-muted-foreground">{r._count.resourceDownloads} downloads</p>}
        </div>
        {!hideDownload && onDownload && (
          <button onClick={onDownload} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))] text-white text-xs font-medium">
            <Download className="w-3 h-3" />{r.isFree ? "Get" : "Buy"}
          </button>
        )}
      </div>
    </motion.div>
  );
}

function PublishModal({ businessId, onClose, onPublished }: { businessId: string; onClose: () => void; onPublished: () => void }) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    resourceType: "TEMPLATE",
    price: "0",
    currency: "TTD",
    downloadUrl: "",
    previewUrl: "",
    licenseTerms: "",
    isFree: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true);
    await publishResource(businessId, {
      name: form.name,
      description: form.description || undefined,
      resourceType: form.resourceType as ResourceType,
      price: form.isFree ? 0 : Number(form.price),
      currency: form.currency,
      downloadUrl: form.downloadUrl,
      previewUrl: form.previewUrl || undefined,
      licenseTerms: form.licenseTerms || undefined,
      isFree: form.isFree,
    });
    setSubmitting(false);
    onPublished();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="kf-card rounded-2xl border border-border/30 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border/30">
          <h2 className="text-sm font-semibold">Publish Resource</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted/30"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Resource name" className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What does this provide?" rows={3} className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          <select value={form.resourceType} onChange={(e) => setForm({ ...form, resourceType: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm">
            {RESOURCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input value={form.downloadUrl} onChange={(e) => setForm({ ...form, downloadUrl: e.target.value })} placeholder="Download URL" className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          <input value={form.previewUrl} onChange={(e) => setForm({ ...form, previewUrl: e.target.value })} placeholder="Preview URL (optional)" className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={form.isFree} onChange={(e) => setForm({ ...form, isFree: e.target.checked, price: e.target.checked ? "0" : form.price })} /> Free resource
          </label>
          {!form.isFree && (
            <div className="grid grid-cols-2 gap-2">
              <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} type="number" placeholder="Price" className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
              <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} placeholder="Currency" className="px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
            </div>
          )}
          <textarea value={form.licenseTerms} onChange={(e) => setForm({ ...form, licenseTerms: e.target.value })} placeholder="License terms (optional)" rows={2} className="w-full px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-sm" />
          <button disabled={submitting || !form.name || !form.downloadUrl} onClick={submit} className="w-full py-2 rounded-lg bg-[hsl(var(--kf-accent1))] text-white text-sm font-medium disabled:opacity-50">{submitting ? "Publishing..." : "Publish"}</button>
        </div>
      </div>
    </div>
  );
}
