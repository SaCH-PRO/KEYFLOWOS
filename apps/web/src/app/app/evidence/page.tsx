"use client";

import { AddonPackGate } from "@/components/addon-pack-gate";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ClipboardCheck,
  Loader2,
  Search,
  CheckCircle2,
  Shield,
  X,
  Eye,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import {
  Evidence,
  fetchEvidence,
  verifyEvidence,
} from "@/lib/client";
import { getStoredBusinessId, getCachedUser } from "@/lib/workspace";

function EvidencePage() {
  const router = useRouter();
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [showVerify, setShowVerify] = useState<string | null>(null);

  const businessId = getStoredBusinessId();

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchEvidence(businessId);
      if (res.data) setEvidence(res.data);
    } catch (err) {
      toast.error("Failed to load evidence");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return evidence;
    const q = searchQuery.toLowerCase();
    return evidence.filter(
      (e) =>
        e.evidenceType.toLowerCase().includes(q) ||
        e.linkedType.toLowerCase().includes(q) ||
        e.linkedId.toLowerCase().includes(q) ||
        e.url.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q)
    );
  }, [evidence, searchQuery]);

  const handleVerify = async () => {
    if (!showVerify) return;
    const user = getCachedUser();
    if (!user?.id) {
      toast.error("User not authenticated");
      return;
    }
    setVerifyingId(showVerify);
    try {
      await verifyEvidence(showVerify, { verifierId: user.id });
      toast.success("Evidence verified");
      setShowVerify(null);
      load();
    } catch {
      toast.error("Verification failed");
    } finally {
      setVerifyingId(null);
    }
  };

  const unverifiedCount = evidence.filter((e) => !e.verifiedAt).length;
  const verifiedCount = evidence.filter((e) => e.verifiedAt).length;

  return (
    <WorkspaceShell icon={ClipboardCheck} title="Evidence">
      <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Evidence</h1>
            <p className="text-muted-foreground mt-1">Verify and track task evidence</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="px-3 py-1.5 rounded-full text-sm font-medium bg-muted text-muted-foreground">
            Unverified ({unverifiedCount})
          </div>
          <div className="px-3 py-1.5 rounded-full text-sm font-medium bg-muted text-muted-foreground">
            Verified ({verifiedCount})
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search evidence..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 border rounded-xl bg-muted/20">
            <ClipboardCheck className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <h3 className="text-lg font-medium">No evidence found</h3>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((e) => (
              <div key={e.id} className="border rounded-xl p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-mono">{e.id.slice(0, 8)}</span>
                  {e.verifiedAt ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      <CheckCircle2 className="w-3 h-3" />
                      Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                      Unverified
                    </span>
                  )}
                </div>
                <div className="mt-2">
                  <span className="text-sm font-medium capitalize">{e.evidenceType.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground text-xs ml-2">{e.linkedType}: {e.linkedId.slice(0, 8)}</span>
                </div>
                {e.url && (
                  <div className="mt-1 text-sm text-muted-foreground truncate">
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:underline text-primary">
                      {e.url}
                    </a>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">By {e.submittedBy.slice(0, 8)}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => router.push(`/app/evidence/${e.id}`)}
                      className="p-1.5 rounded hover:bg-muted transition-colors"
                    >
                      <Eye className="w-4 h-4 text-muted-foreground" />
                    </button>
                    {!e.verifiedAt && (
                      <button
                        onClick={() => setShowVerify(e.id)}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors"
                      >
                        <Shield className="w-3 h-3" />
                        Verify
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showVerify && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Verify Evidence</h2>
              <button onClick={() => setShowVerify(null)} className="p-1 rounded hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">
                Confirm that you have reviewed this evidence and want to mark it as verified.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowVerify(null)}
                  disabled={!!verifyingId}
                  className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleVerify()}
                  disabled={!!verifyingId}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {verifyingId === showVerify ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Verify
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}

export default function Page() {
  return (
    <AddonPackGate
      pack="compliancePack"
      title="Compliance Pack"
      description="Audit trails, verification logs, and evidence management for regulated industries that need defensible records."
      features={[
        "Tamper-evident audit trails for every business action",
        "Document verification with checksum hashing",
        "Compliance-ready export for auditors and regulators",
        "Linked evidence across contacts, invoices, and bookings",
        "Chain-of-custody tracking for sensitive records",
      ]}
    >
      <EvidencePage />
    </AddonPackGate>
  );
}
