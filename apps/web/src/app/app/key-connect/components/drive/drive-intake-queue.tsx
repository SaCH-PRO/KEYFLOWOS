"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Check, X, Loader2, AlertCircle, FileText } from "lucide-react";
import { toast } from "sonner";
import {
  fetchDriveIntake,
  syncGoogleDrive,
  approveDriveIntake,
  rejectDriveIntake,
  type DriveIntakeFile,
} from "@/lib/api/drive";

interface DriveIntakeQueueProps {
  businessId: string;
}

function statusBadge(status: DriveIntakeFile["status"]) {
  const map: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-600",
    extracted: "bg-blue-500/10 text-blue-600",
    reviewing: "bg-purple-500/10 text-purple-600",
    approved: "bg-emerald-500/10 text-emerald-600",
    rejected: "bg-slate-500/10 text-slate-600",
    error: "bg-rose-500/10 text-rose-600",
  };
  return map[status] ?? "bg-muted text-muted-foreground";
}

function formatSummary(file: DriveIntakeFile): string {
  const plan = file.proposedActions as { summary?: string } | null;
  if (plan?.summary) return plan.summary;
  if (file.documentType) {
    return `Detected ${file.documentType} (${Math.round((file.confidence ?? 0) * 100)}% confidence)`;
  }
  return "Processing...";
}

export function DriveIntakeQueue({ businessId }: DriveIntakeQueueProps) {
  const [items, setItems] = useState<DriveIntakeFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchDriveIntake(businessId);
    if (res.data) setItems(res.data.items);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await syncGoogleDrive(businessId);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success(`Scanned ${res.data?.scanned ?? 0} files, ${res.data?.newFiles ?? 0} new`);
      }
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const handleApprove = async (id: string) => {
    setActionId(id);
    try {
      const res = await approveDriveIntake(businessId, id);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Actions applied successfully");
        await load();
      }
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (id: string) => {
    setActionId(id);
    try {
      const res = await rejectDriveIntake(businessId, id);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Item rejected");
        await load();
      }
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          Drive Intake Queue
        </h2>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh Drive
        </button>
      </div>

      {loading && items.length === 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading intake queue...
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No documents detected yet. Click <strong>Refresh Drive</strong> to scan for invoices, receipts, and credit notes.
        </p>
      )}

      <div className="space-y-2">
        {items.map((file) => (
          <div
            key={file.id}
            className="rounded-xl border border-border/40 bg-card/40 p-3 space-y-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{file.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{formatSummary(file)}</p>
                {file.errorMessage && (
                  <p className="text-[10px] text-rose-500 flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3" /> {file.errorMessage}
                  </p>
                )}
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${statusBadge(file.status)}`}>
                {file.status}
              </span>
            </div>

            {file.status === "reviewing" && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleApprove(file.id)}
                  disabled={actionId === file.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-emerald-500 text-white hover:opacity-90 disabled:opacity-50"
                >
                  {actionId === file.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Approve
                </button>
                <button
                  onClick={() => handleReject(file.id)}
                  disabled={actionId === file.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-rose-500 text-white hover:opacity-90 disabled:opacity-50"
                >
                  <X className="w-3 h-3" /> Reject
                </button>
              </div>
            )}

            {file.webViewLink && (
              <a
                href={file.webViewLink}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-[hsl(var(--kf-accent2))] hover:underline"
              >
                Open in Drive
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
