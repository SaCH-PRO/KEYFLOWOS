"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { createDeal, fetchContacts, type Contact } from "@/lib/client";

interface Props {
  open: boolean;
  businessId: string;
  stageId: string | null;
  stageName?: string;
  onCancel: () => void;
  onCreated: () => void | Promise<void>;
}

export function AddDealModal({ open, businessId, stageId, stageName, onCancel, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState<string>("");
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTitle(""); setValue(""); setContactSearch(""); setContactId(""); setBusy(false); setError(null);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingContacts(true);
    const handle = setTimeout(async () => {
      const res = await fetchContacts(businessId, { search: contactSearch || undefined, take: 25 });
      if (cancelled) return;
      setContacts(res.data?.contacts ?? []);
      setLoadingContacts(false);
    }, 200);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [open, businessId, contactSearch]);

  if (!open) return null;

  const canSubmit = !busy && title.trim().length > 0 && contactId !== "";

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const numValue = value ? Number(value) : undefined;
      await createDeal({
        title: title.trim(),
        contactId,
        value: Number.isFinite(numValue) ? numValue : undefined,
        stageId: stageId ?? undefined,
      }, businessId);
      await onCreated();
    } catch (e) {
      setError((e as Error).message || "Failed to create deal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background border border-border rounded-lg shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h2 className="text-sm font-semibold">
            New deal{stageName ? ` · ${stageName}` : ""}
          </h2>
          <button onClick={onCancel} className="p-1 rounded hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-3 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus
              className="w-full text-sm bg-background border border-border rounded-md px-2 py-1.5"
              placeholder="e.g. Q3 maintenance contract" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Estimated value</label>
            <input value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
              className="w-full text-sm bg-background border border-border rounded-md px-2 py-1.5"
              placeholder="0" inputMode="decimal" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Contact</label>
            <div className="relative mb-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input value={contactSearch} onChange={(e) => setContactSearch(e.target.value)}
                placeholder="Search contacts…"
                className="w-full text-xs bg-background border border-border rounded-md pl-7 pr-2 py-1.5" />
            </div>
            <div className="max-h-44 overflow-y-auto border border-border rounded-md">
              {loadingContacts ? (
                <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                </div>
              ) : contacts.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">No contacts found.</div>
              ) : (
                contacts.map((c) => {
                  const name = c.displayName || `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email || "Contact";
                  return (
                    <button key={c.id} type="button" onClick={() => setContactId(c.id)}
                      className={`w-full text-left text-xs px-2 py-1.5 hover:bg-muted ${contactId === c.id ? "bg-[hsl(var(--kf-accent2))]/10" : ""}`}>
                      <div className="font-medium truncate">{name}</div>
                      {c.companyName && <div className="text-[10px] text-muted-foreground truncate">{c.companyName}</div>}
                    </button>
                  );
                })
              )}
            </div>
          </div>
          {error && <div className="text-xs text-red-500">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 p-3 border-t border-border">
          <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted">Cancel</button>
          <button disabled={!canSubmit} onClick={submit}
            className="text-sm px-3 py-1.5 rounded-md bg-[hsl(var(--kf-accent1))] hover:opacity-90 text-white disabled:opacity-50">
            {busy ? "Creating…" : "Create deal"}
          </button>
        </div>
      </div>
    </div>
  );
}
