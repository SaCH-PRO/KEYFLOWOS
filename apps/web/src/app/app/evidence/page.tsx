"use client";

import { AddonPackGate } from "@/components/addon-pack-gate";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "framer-motion";
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
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Evidence,
  fetchEvidence,
  verifyEvidence,
} from "@/lib/client";
import { getStoredBusinessId, getCachedUser } from "@/lib/workspace";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

function EvidencePage() {
  const router = useRouter();
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [showVerify, setShowVerify] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "verified" | "unverified">("all");

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
    let result = evidence;
    if (statusFilter !== "all") {
      result = result.filter((e) =>
        statusFilter === "verified" ? e.verifiedAt : !e.verifiedAt
      );
    }
    if (!searchQuery.trim()) return result;
    const q = searchQuery.toLowerCase();
    return result.filter(
      (e) =>
        e.evidenceType.toLowerCase().includes(q) ||
        e.linkedType.toLowerCase().includes(q) ||
        e.linkedId.toLowerCase().includes(q) ||
        e.url.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q)
    );
  }, [evidence, searchQuery, statusFilter]);

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

  const totalCount = evidence.length;
  const unverifiedCount = evidence.filter((e) => !e.verifiedAt).length;
  const verifiedCount = evidence.filter((e) => e.verifiedAt).length;
  const pendingCount = evidence.filter((e) => !e.verifiedAt && e.linkedType === "TASK").length;

  return (
    <WorkspaceShell icon={ClipboardCheck} title="Evidence" subtitle="Verify and track task evidence">
      {/* Metric Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="kf-card-metric animate-pulse h-20" />
          ))
        ) : (
          <>
            <motion.div variants={fadeUp} initial="hidden" animate="show">
              <MetricCard label="Total Evidence" value={totalCount} icon={ClipboardCheck} />
            </motion.div>
            <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.05 }}>
              <MetricCard label="Verified" value={verifiedCount} icon={CheckCircle2} iconColor="#10b981" />
            </motion.div>
            <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.1 }}>
              <MetricCard label="Unverified" value={unverifiedCount} icon={Shield} iconColor="#f59e0b" />
            </motion.div>
            <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.15 }}>
              <MetricCard label="Pending Tasks" value={pendingCount} icon={Loader2} iconColor="#ef4444" />
            </motion.div>
          </>
        )}
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search evidence..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-1">
          {(["all", "verified", "unverified"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusFilter === f
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Evidence Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={searchQuery || statusFilter !== "all" ? "No matching evidence" : "No evidence yet"}
          description={searchQuery || statusFilter !== "all" ? "Try adjusting your search or filters." : "Task evidence will appear here once submitted."}
          variant="compact"
        />
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {filtered.map((e) => (
            <motion.div
              key={e.id}
              variants={fadeUp}
              className="kf-card kf-radius-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{e.id.slice(0, 8)}</span>
                {e.verifiedAt ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600">
                    <CheckCircle2 className="w-3 h-3" />
                    Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-600">
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
                <span className="text-[11px] text-muted-foreground">By {e.submittedBy.slice(0, 8)}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => router.push(`/app/evidence/${e.id}`)}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                    title="View details"
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
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Verify Modal */}
      {showVerify && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-background rounded-xl shadow-xl w-full max-w-md border"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                </div>
                <h2 className="text-lg font-semibold">Verify Evidence</h2>
              </div>
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
          </motion.div>
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
