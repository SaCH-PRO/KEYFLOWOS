"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2, Link2, Eye, EyeOff } from "lucide-react";
import { listPortalAccess, createPortalAccess, revokePortalAccess } from "@/lib/portal";
import { useControlTowerData } from "../control-tower/components/use-control-tower-data";

interface PortalAccessItem {
  id: string;
  contactId: string;
  token: string;
  expiresAt: string;
  enabled: boolean;
  settings: Record<string, boolean>;
  lastAccessedAt: string | null;
  accessCount: number;
}

export default function PortalPage() {
  const { businessId } = useControlTowerData();
  const [accessList, setAccessList] = useState<PortalAccessItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [contactId, setContactId] = useState("");

  useEffect(() => {
    if (!businessId) return;
    loadData();
  }, [businessId]);

  async function loadData() {
    if (!businessId) return;
    setLoading(true);
    const res = await listPortalAccess(businessId);
    if (res.data) setAccessList(res.data);
    setLoading(false);
  }

  async function handleCreate() {
    if (!businessId || !contactId) return;
    const res = await createPortalAccess(businessId, contactId, {
      invoices: true,
      projects: true,
      documents: false,
      bookings: true,
    });
    if (res.data) {
      setShowForm(false);
      setContactId("");
      loadData();
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

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Client Portal</h1>
          <p className="text-sm text-muted-foreground">Manage client access to invoices, projects, and bookings</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(24_95%_53%)] text-white hover:brightness-110 text-sm font-medium transition-all"
        >
          <Plus className="w-4 h-4" />
          Grant Access
        </button>
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">Grant Portal Access</h3>
          <input placeholder="Contact ID" value={contactId} onChange={e => setContactId(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm bg-muted/50 border border-border outline-none" />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-2 rounded-lg bg-[hsl(24_95%_53%)] text-white text-sm font-medium">Grant</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg bg-muted text-sm">Cancel</button>
          </div>
        </motion.div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
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
                  {a.enabled && (
                    <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                      <Link2 className="w-3 h-3" />
                      <span className="truncate">{getPortalUrl(a.token)}</span>
                    </div>
                  )}
                </div>
                <button onClick={() => handleRevoke(a.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
