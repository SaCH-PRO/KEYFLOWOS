"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  ClipboardCheck,
  CheckCircle2,
  Shield,
  AlertTriangle,
  Clock,
  User,
  Link as LinkIcon,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import {
  Evidence,
  fetchEvidenceItem,
  verifyEvidence,
} from "@/lib/client";
import { getStoredBusinessId, getCachedUser } from "@/lib/workspace";

export default function EvidenceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [item, setItem] = useState<Evidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  const businessId = getStoredBusinessId();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetchEvidenceItem(id);
      if (res.error) throw new Error(res.error);
      setItem(res.data ?? null);
    } catch (err) {
      toast.error("Failed to load evidence");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleVerify = async () => {
    if (!item) return;
    const user = getCachedUser();
    if (!user?.id) {
      toast.error("User not authenticated");
      return;
    }
    setVerifying(true);
    try {
      await verifyEvidence(item.id, { verifierId: user.id });
      toast.success("Evidence verified");
      load();
    } catch {
      toast.error("Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <WorkspaceShell icon={ClipboardCheck} title="Evidence">
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </WorkspaceShell>
    );
  }

  if (!item) {
    return (
      <WorkspaceShell icon={ClipboardCheck} title="Evidence">
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <AlertTriangle className="w-12 h-12 text-muted-foreground mb-3" />
          <h2 className="text-lg font-medium">Evidence not found</h2>
          <button
            onClick={() => router.push("/app/evidence")}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Evidence
          </button>
        </div>
      </WorkspaceShell>
    );
  }

  const isVerified = !!item.verifiedAt;

  return (
    <WorkspaceShell icon={ClipboardCheck} title="Evidence">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/app/evidence")}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold capitalize">{item.evidenceType.replace(/_/g, " ")}</h1>
            <div className="flex items-center gap-2 mt-1">
              {isVerified ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                  <CheckCircle2 className="w-3 h-3" />
                  Verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                  Unverified
                </span>
              )}
              <span className="text-muted-foreground text-sm">ID: {item.id.slice(0, 8)}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main info */}
          <div className="lg:col-span-2 space-y-6">
            <div className="border rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-medium">Details</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Linked Type</span>
                  <p className="font-medium">{item.linkedType}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Linked ID</span>
                  <p className="font-medium font-mono">{item.linkedId.slice(0, 12)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Storage Key</span>
                  <p className="font-medium font-mono text-xs">{item.storageKey}</p>
                </div>
                {item.mimeType && (
                  <div>
                    <span className="text-muted-foreground">MIME Type</span>
                    <p className="font-medium">{item.mimeType}</p>
                  </div>
                )}
                {item.sizeBytes !== null && item.sizeBytes !== undefined && (
                  <div>
                    <span className="text-muted-foreground">Size</span>
                    <p className="font-medium">{(item.sizeBytes / 1024).toFixed(1)} KB</p>
                  </div>
                )}
              </div>
              {item.url && (
                <div className="pt-2 border-t">
                  <span className="text-muted-foreground text-sm">URL</span>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1 mt-1 break-all"
                  >
                    <LinkIcon className="w-3.5 h-3.5" />
                    {item.url}
                  </a>
                </div>
              )}
            </div>

            {!isVerified && (
              <div className="border rounded-xl p-4">
                <h3 className="text-sm font-medium mb-3">Actions</h3>
                <button
                  onClick={handleVerify}
                  disabled={verifying}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {verifying ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Shield className="w-4 h-4" />
                  )}
                  Verify Evidence
                </button>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="border rounded-xl p-4 space-y-3 text-sm">
              <h3 className="font-medium">Meta</h3>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Submitted By</span>
                <span className="ml-auto font-mono">{item.submittedBy.slice(0, 8)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Submitted At</span>
                <span className="ml-auto">{new Date(item.submittedAt).toLocaleString()}</span>
              </div>
              {item.verifiedBy && (
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-green-500" />
                  <span className="text-muted-foreground">Verified By</span>
                  <span className="ml-auto font-mono">{item.verifiedBy.slice(0, 8)}</span>
                </div>
              )}
              {item.verifiedAt && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-muted-foreground">Verified At</span>
                  <span className="ml-auto">{new Date(item.verifiedAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
