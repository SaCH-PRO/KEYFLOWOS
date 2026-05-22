"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Phone,
  CheckCircle2,
  Trash2,
  AlertTriangle,
  Clock,
  User,
  Calendar,
  Mic,
  FileText,
  X,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import {
  CallLog,
  fetchCallLog,
  completeCallTask,
  deleteCallTask,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";

const OUTCOME_LABELS: Record<string, string> = {
  reached: "Reached",
  no_answer: "No Answer",
  voicemail: "Voicemail",
  wrong_number: "Wrong Number",
  callback_requested: "Callback Requested",
  not_interested: "Not Interested",
};

const OUTCOME_COLORS: Record<string, string> = {
  reached: "bg-green-100 text-green-700",
  no_answer: "bg-amber-100 text-amber-700",
  voicemail: "bg-blue-100 text-blue-700",
  wrong_number: "bg-red-100 text-red-700",
  callback_requested: "bg-purple-100 text-purple-700",
  not_interested: "bg-slate-100 text-slate-700",
};

export default function CallTaskDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [call, setCall] = useState<CallLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const [outcome, setOutcome] = useState("reached");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");

  const businessId = getStoredBusinessId();

  const load = useCallback(async () => {
    if (!businessId || !id) return;
    setLoading(true);
    try {
      const res = await fetchCallLog(businessId, id);
      if (res.error) throw new Error(res.error);
      setCall(res.data ?? null);
    } catch (err) {
      toast.error("Failed to load call task");
    } finally {
      setLoading(false);
    }
  }, [businessId, id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleComplete = async () => {
    if (!businessId || !call) return;
    setActionLoading("complete");
    try {
      await completeCallTask(businessId, id, {
        outcome,
        duration: duration ? Number(duration) * 60 : undefined,
        notes: notes || undefined,
      });
      toast.success("Call logged");
      setShowComplete(false);
      setOutcome("reached");
      setDuration("");
      setNotes("");
      load();
    } catch {
      toast.error("Failed to log call");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!businessId || !call) return;
    if (!confirm("Delete this call task?")) return;
    setActionLoading("delete");
    try {
      await deleteCallTask(businessId, id);
      toast.success("Call task deleted");
      router.push("/app/call-tasks");
    } catch {
      toast.error("Failed to delete");
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <WorkspaceShell icon={Phone} title="Call Task">
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </WorkspaceShell>
    );
  }

  if (!call) {
    return (
      <WorkspaceShell icon={Phone} title="Call Task">
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <AlertTriangle className="w-12 h-12 text-muted-foreground mb-3" />
          <h2 className="text-lg font-medium">Call task not found</h2>
          <button
            onClick={() => router.push("/app/call-tasks")}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Call Tasks
          </button>
        </div>
      </WorkspaceShell>
    );
  }

  const isCompleted = !!call.completedAt;

  return (
    <WorkspaceShell icon={Phone} title="Call Task">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/app/call-tasks")}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold">Call with Contact {call.contactId.slice(0, 8)}</h1>
            <div className="flex items-center gap-2 mt-1">
              {call.outcome ? (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${OUTCOME_COLORS[call.outcome] || "bg-gray-100"}`}>
                  {OUTCOME_LABELS[call.outcome] || call.outcome}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                  <Clock className="w-3 h-3" />
                  Pending
                </span>
              )}
              <span className="text-muted-foreground text-sm">ID: {call.id.slice(0, 8)}</span>
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
                  <span className="text-muted-foreground">Contact</span>
                  <p className="font-medium font-mono">{call.contactId}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Caller</span>
                  <p className="font-medium font-mono">{call.callerId.slice(0, 8)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Scheduled</span>
                  <p className="font-medium">{new Date(call.scheduledAt).toLocaleString()}</p>
                </div>
                {call.completedAt && (
                  <div>
                    <span className="text-muted-foreground">Completed</span>
                    <p className="font-medium">{new Date(call.completedAt).toLocaleString()}</p>
                  </div>
                )}
                {call.duration !== null && call.duration !== undefined && (
                  <div>
                    <span className="text-muted-foreground">Duration</span>
                    <p className="font-medium">{Math.round(call.duration / 60)} minutes</p>
                  </div>
                )}
                {call.reminderMinutesBefore !== undefined && (
                  <div>
                    <span className="text-muted-foreground">Reminder</span>
                    <p className="font-medium">{call.reminderMinutesBefore} min before</p>
                  </div>
                )}
              </div>
              {call.script && (
                <div className="pt-2 border-t">
                  <span className="text-muted-foreground text-sm flex items-center gap-1">
                    <Mic className="w-3.5 h-3.5" />
                    Script
                  </span>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{call.script}</p>
                </div>
              )}
              {call.notes && (
                <div className="pt-2 border-t">
                  <span className="text-muted-foreground text-sm flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" />
                    Notes
                  </span>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{call.notes}</p>
                </div>
              )}
              {call.recordingUrl && (
                <div className="pt-2 border-t">
                  <span className="text-muted-foreground text-sm">Recording</span>
                  <a
                    href={call.recordingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline block mt-1"
                  >
                    {call.recordingUrl}
                  </a>
                </div>
              )}
            </div>

            {/* Actions */}
            {!isCompleted && (
              <div className="border rounded-xl p-4">
                <h3 className="text-sm font-medium mb-3">Actions</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setShowComplete(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Log Outcome
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={!!actionLoading}
                    className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {actionLoading === "delete" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    Delete
                  </button>
                </div>
              </div>
            )}

            {isCompleted && (
              <div className="border rounded-xl p-4">
                <h3 className="text-sm font-medium mb-3">Actions</h3>
                <button
                  onClick={handleDelete}
                  disabled={!!actionLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {actionLoading === "delete" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Delete
                </button>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="border rounded-xl p-4 space-y-3 text-sm">
              <h3 className="font-medium">Meta</h3>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Created</span>
                <span className="ml-auto">{new Date(call.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Updated</span>
                <span className="ml-auto">{new Date(call.updatedAt).toLocaleString()}</span>
              </div>
              {call.taskId && (
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Linked Task</span>
                  <span className="ml-auto font-mono">{call.taskId.slice(0, 8)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Complete modal */}
      {showComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Log Call Outcome</h2>
              <button onClick={() => setShowComplete(false)} className="p-1 rounded hover:bg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Outcome</label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {Object.entries(OUTCOME_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Duration (minutes)</label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Call notes..."
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowComplete(false)}
                  className="px-4 py-2 rounded-lg border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleComplete}
                  disabled={actionLoading === "complete"}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {actionLoading === "complete" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Log Outcome
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
