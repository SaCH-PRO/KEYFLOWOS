"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2, Link2, Eye, EyeOff } from "lucide-react";
import { listPortalAccess, createPortalAccess, revokePortalAccess } from "@/lib/portal";
import { useControlTowerData } from "../control-tower/components/use-control-tower-data";
import { useMemberModuleLevels } from "@/hooks/use-app-layout";

interface PortalAccessItem {
  id: string;
  contactId: string;
  /** Left out by the server (P145) for a member below crm write, who gets hasLiveLink instead. */
  token?: string;
  hasLiveLink?: boolean;
  expiresAt: string;
  enabled: boolean;
  settings: Record<string, boolean>;
  lastAccessedAt: string | null;
  accessCount: number;
}

export default function PortalPage() {
  const { businessId } = useControlTowerData();
  // P232: Grant Access and Revoke need crm write. They are not offered when my-access says the member holds less, or
  // when the server answered the read-only view (an access without its token, with hasLiveLink). Unknown hides
  // nothing: the server still refuses.
  const levels = useMemberModuleLevels();
  // P232 round 1: the last answer is kept with the business it was read for, and shown only while that business is
  // the one selected, so a switch never shows the previous business's accesses (or their links) under the new one.
  // `error` says why the list could not be read: "refused" for a 403, "failed" for anything else. `readAt` is when it
  // was read: an access that had expired by then shows as expired (read outside render, which stays pure).
  const [listed, setListed] = useState<{
    businessId: string;
    list: PortalAccessItem[];
    error: "refused" | "failed" | null;
    readAt: number;
  } | null>(null);
  // P232 round 2: the read in flight that the page waits for (the latest read for the selected business). Only it
  // shows Loading and only its answer lands: an older read, or one for a business no longer selected, never does.
  const [pending, setPending] = useState<{ businessId: string; read: number } | null>(null);
  const latestRead = useRef(0);
  // The Grant form, tied to the business it was opened for, with what was typed and why a Grant failed. It shows only
  // while that business is selected (another business opens its own, empty form; back to this one, it is as it was).
  // Opening it starts it afresh, unless it is already open here (Grant Access pressed again keeps what was typed and
  // its error); Cancel and a successful Grant close it.
  // Each opened form has its own id, so a Grant's result reaches only the form that sent it (not one cancelled and
  // opened again while the Grant ran).
  const [form, setForm] = useState<{ id: number; businessId: string; contactId: string; error: string | null } | null>(null);
  const formsOpened = useRef(0);
  // The business the page is showing: a read for any other (a switch while it ran) is neither started nor applied.
  const currentBusiness = useRef(businessId);
  useEffect(() => {
    currentBusiness.current = businessId;
  }, [businessId]);

  const current = listed && listed.businessId === businessId ? listed : null;
  const accessList = current?.list ?? [];
  const loadError = current?.error ?? null;
  const loading = !!businessId && pending?.businessId === businessId;
  const openForm = form && !!businessId && form.businessId === businessId ? form : null;
  const showForm = openForm !== null;
  const contactId = openForm?.contactId ?? "";
  const grantError = openForm?.error ?? null;
  const setShowForm = (open: boolean) =>
    setForm((f) => {
      if (!open || !businessId) return null;
      return f && f.businessId === businessId ? f : { id: ++formsOpened.current, businessId, contactId: "", error: null };
    });
  const setContactId = (value: string) => setForm((f) => (f ? { ...f, contactId: value } : f));

  async function loadData() {
    const askedFor = businessId;
    if (!askedFor || currentBusiness.current !== askedFor) return;
    const read = ++latestRead.current;
    setPending({ businessId: askedFor, read });
    const res = await listPortalAccess(askedFor);
    if (read !== latestRead.current || currentBusiness.current !== askedFor) return;
    // A read that fails keeps nothing of an earlier answer: no stale accesses under a refusal or an error.
    setListed(
      res.data
        ? { businessId: askedFor, list: res.data, error: null, readAt: Date.now() }
        : { businessId: askedFor, list: [], error: res.status === 403 ? "refused" : "failed", readAt: Date.now() },
    );
    setPending(null);
  }

  useEffect(() => {
    if (!businessId) return;
    queueMicrotask(loadData);
  }, [businessId]);

  async function handleCreate() {
    if (!businessId || !contactId || !openForm) return;
    const askedFor = businessId;
    const sentBy = openForm.id;
    const res = await createPortalAccess(askedFor, contactId, {
      invoices: true,
      projects: true,
      documents: false,
      bookings: true,
    });
    if (res.data) {
      setForm((f) => (f?.id === sentBy && f.businessId === askedFor ? null : f));
      loadData();
    } else {
      const error = res.status === 403 ? "You can't grant portal access." : "Couldn't grant portal access. Try again.";
      setForm((f) => (f?.id === sentBy && f.businessId === askedFor ? { ...f, error } : f));
    }
  }

  async function handleRevoke(id: string) {
    if (!businessId || !confirm("Revoke portal access?")) return;
    await revokePortalAccess(businessId, id);
    loadData();
  }

  function getPortalUrl(token: string) {
    return `${window.location.origin}/portal/${token}`;
  }

  const crmLevel = levels?.crm;
  const belowCrmWrite = crmLevel === "none" || crmLevel === "read";
  const readOnlyView = accessList.some((a) => !a.token && typeof a.hasLiveLink === "boolean");
  const canWrite = !belowCrmWrite && !readOnlyView;
  const isExpired = (a: PortalAccessItem) => {
    const at = Date.parse(a.expiresAt);
    return Number.isFinite(at) && at <= (current?.readAt ?? 0);
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Client Portal</h1>
          <p className="text-sm text-muted-foreground">Manage client access to invoices, projects, and bookings</p>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(24_95%_53%)] text-white hover:brightness-110 text-sm font-medium transition-all"
          >
            <Plus className="w-4 h-4" />
            Grant Access
          </button>
        )}
      </div>

      {canWrite && showForm && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">Grant Portal Access</h3>
          <input placeholder="Contact ID" value={contactId} onChange={e => setContactId(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none" />
          {grantError && <p role="alert" className="text-xs text-red-400">{grantError}</p>}
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-2 rounded-lg bg-[hsl(24_95%_53%)] text-white text-sm font-medium">Grant</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg bg-muted text-sm">Cancel</button>
          </div>
        </motion.div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : loadError ? (
          <div role="alert" className="p-8 text-center text-sm text-muted-foreground">
            {loadError === "refused"
              ? "You don't have access to the client portal in this business."
              : "Couldn't load portal access. Try again."}
          </div>
        ) : accessList.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No portal access granted yet</div>
        ) : (
          <div className="divide-y divide-border">
            {accessList.map(a => (
              <div key={a.id} className="px-4 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{a.contactId}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    {a.enabled ? <span className="flex items-center gap-1 text-emerald-400"><Eye className="w-3 h-3" /> Active</span> : <span className="flex items-center gap-1"><EyeOff className="w-3 h-3" /> Revoked</span>}
                    <span>· {a.accessCount} visits</span>
                    {a.lastAccessedAt && <span>· Last: {new Date(a.lastAccessedAt).toLocaleDateString()}</span>}
                  </div>
                  {a.enabled && isExpired(a) && (
                    <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                      <Link2 className="w-3 h-3" />
                      <span>Link expired</span>
                    </div>
                  )}
                  {a.enabled && !isExpired(a) && a.token && (
                    <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                      <Link2 className="w-3 h-3" />
                      <span className="truncate">{getPortalUrl(a.token)}</span>
                    </div>
                  )}
                  {a.enabled && !isExpired(a) && !a.token && a.hasLiveLink === true && (
                    <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                      <Link2 className="w-3 h-3" />
                      <span>Portal link active</span>
                    </div>
                  )}
                </div>
                {canWrite && (
                  <button onClick={() => handleRevoke(a.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
