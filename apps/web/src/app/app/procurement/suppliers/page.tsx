"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Truck, ArrowLeft, Loader2, Plug } from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchProcurementSuppliers } from "@/lib/client";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { Card } from "@keyflow/ui";

interface Supplier {
  id: string;
  displayName: string;
  providerType: string;
  connectionHealth: string;
  lastSyncAt: string | null;
}

export default function ProcurementSuppliersPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetchProcurementSuppliers(biz);
      if (res.data) setSuppliers(res.data);
    } catch {
      toast.error("Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <WorkspaceShell
      icon={Truck}
      title="Suppliers"
      subtitle="Connected vendor accounts"
      iconColor="#F97316"
      headerRight={
        <button
          onClick={() => router.push("/app/procurement")}
          className="flex items-center gap-1.5 h-9 px-3 kf-radius-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all text-xs font-medium"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
        </div>
      ) : suppliers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Truck className="w-10 h-10 text-muted-foreground/30 mb-3" />
          <h3 className="text-sm font-medium text-foreground/80">No suppliers connected</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            Suppliers appear here when you connect marketplace integrations.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {suppliers.map((s) => (
            <Card key={s.id}>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Plug className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{s.displayName}</span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    s.connectionHealth === "healthy" ? "bg-emerald-500/10 text-emerald-600" :
                    s.connectionHealth === "degraded" ? "bg-amber-500/10 text-amber-600" :
                    "bg-red-500/10 text-red-600"
                  }`}>
                    {s.connectionHealth}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 capitalize">{s.providerType}</p>
                {s.lastSyncAt && (
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    Last sync: {new Date(s.lastSyncAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </WorkspaceShell>
  );
}
