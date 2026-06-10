"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  ShieldAlert,
  UserPlus,
  RotateCcw,
  Calendar,
  Tag,
  Bot,
  AlertTriangle,
  ClipboardList,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import {
  fetchCommandItem,
  dismissCommandItem,
  snoozeCommandItem,
  approveCommandItem,
  executeCommandItem,
  completeCommandItem,
  assignCommandItem,
  reopenCommandItem,
  type CommandItem,
} from "@/lib/api/command";
import { getStoredBusinessId } from "@/lib/workspace";

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_APPROVAL: "Needs Approval",
  EXECUTED: "Executed",
  DISMISSED: "Dismissed",
  SNOOZED: "Snoozed",
  FAILED: "Failed",
  COMPLETED: "Completed",
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  WAITING_APPROVAL: "bg-purple-100 text-purple-700",
  EXECUTED: "bg-teal-100 text-teal-700",
  DISMISSED: "bg-slate-100 text-slate-700",
  SNOOZED: "bg-orange-100 text-orange-700",
  FAILED: "bg-red-100 text-red-700",
  COMPLETED: "bg-green-100 text-green-700",
};

const CATEGORY_COLORS: Record<string, string> = {
  MONEY: "hsl(var(--kf-success))",
  TIME: "hsl(var(--kf-accent2))",
  PEOPLE: "hsl(var(--kf-warning))",
  WORK: "hsl(var(--kf-violet-accent))",
  SALES: "hsl(var(--kf-accent1))",
  MARKETING: "hsl(var(--kf-accent1))",
  GOVERNANCE: "hsl(var(--kf-destructive))",
  STRATEGY: "hsl(var(--kf-accent2))",
  SYSTEM: "hsl(var(--kf-muted-foreground))",
};

interface TimelineEvent {
  label: string;
  date: string | null;
  icon: React.ReactNode;
}

export default function CommandItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [item, setItem] = useState<CommandItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const businessId = getStoredBusinessId();

  const load = useCallback(async () => {
    if (!businessId || !id) return;
    setLoading(true);
    try {
      const res = await fetchCommandItem(businessId, id);
      if (res.data) setItem(res.data);
      else toast.error("Failed to load command item");
    } catch {
      toast.error("Failed to load command item");
    } finally {
      setLoading(false);
    }
  }, [businessId, id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAction = async (action: string, fn: () => Promise<void>) => {
    setActionLoading(action);
    try {
      await fn();
      await load();
      toast.success(`${action.charAt(0).toUpperCase() + action.slice(1)} successful`);
    } catch {
      toast.error(`Failed to ${action}`);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <WorkspaceShell icon={ClipboardList} title="Command">
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </WorkspaceShell>
    );
  }

  if (!item) {
    return (
      <WorkspaceShell icon={ClipboardList} title="Command">
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <AlertTriangle className="w-12 h-12 text-muted-foreground mb-3" />
          <h2 className="text-lg font-medium">Command item not found</h2>
          <button
            onClick={() => router.push("/app/command-center")}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Command Center
          </button>
        </div>
      </WorkspaceShell>
    );
  }

  const color = CATEGORY_COLORS[item.category] ?? "hsl(var(--kf-accent1))";

  const timeline: TimelineEvent[] = [
    { label: "Created", date: item.createdAt, icon: <Tag className="w-4 h-4" /> },
    { label: "Updated", date: item.updatedAt, icon: <Clock className="w-4 h-4" /> },
    item.completedAt ? { label: "Completed", date: item.completedAt, icon: <CheckCircle2 className="w-4 h-4 text-green-500" /> } : null,
    item.dismissedAt ? { label: "Dismissed", date: item.dismissedAt, icon: <XCircle className="w-4 h-4 text-slate-500" /> } : null,
    item.snoozedUntil ? { label: "Snoozed until", date: item.snoozedUntil, icon: <Clock className="w-4 h-4 text-orange-500" /> } : null,
  ].filter(Boolean) as TimelineEvent[];

  const isDone = item.status === "COMPLETED" || item.status === "EXECUTED" || item.status === "DISMISSED" || item.status === "SNOOZED";

  return (
    <WorkspaceShell icon={ClipboardList} title="Command">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/app/command-center")}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">{item.title}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                  STATUS_COLORS[item.status] || "bg-gray-100"
                }`}
              >
                {STATUS_LABELS[item.status] || item.status}
              </span>
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ background: `${color}15`, color }}
              >
                {item.category}
              </span>
              {item.riskTier >= 3 && (
                <span className="inline-flex items-center gap-1 text-xs text-red-500 font-medium">
                  <ShieldAlert className="w-3 h-3" />
                  High Risk
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Details */}
            <div className="border rounded-xl p-4 space-y-3" style={{ borderColor: "hsl(var(--kf-border))" }}>
              <h3 className="text-sm font-medium">Details</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Source Module</span>
                  <p className="font-medium">{item.sourceModule}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Action Type</span>
                  <p className="font-medium capitalize">{item.actionType.replace(/_/g, " ")}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Risk Tier</span>
                  <p className="font-medium">{item.riskTier}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Priority</span>
                  <p className="font-medium">{item.priority}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Expected Value</span>
                  <p className="font-medium">
                    {item.expectedValue ? `${item.currency ?? "$"} ${item.expectedValue}` : "—"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Due Date</span>
                  <p className="font-medium">
                    {item.dueAt ? new Date(item.dueAt).toLocaleDateString() : "—"}
                  </p>
                </div>
              </div>
              {item.description && (
                <div className="pt-2 border-t" style={{ borderColor: "hsl(var(--kf-border))" }}>
                  <span className="text-muted-foreground text-sm">Description</span>
                  <p className="text-sm mt-1">{item.description}</p>
                </div>
              )}
              {item.recommendedBy && (
                <div className="pt-2 border-t" style={{ borderColor: "hsl(var(--kf-border))" }}>
                  <span className="text-muted-foreground text-sm">Recommended By</span>
                  <p className="text-sm mt-1">{item.recommendedBy}</p>
                </div>
              )}
              {Boolean((item as unknown as Record<string, unknown>).recommendedAction) && (
                <div className="pt-2 border-t" style={{ borderColor: "hsl(var(--kf-border))" }}>
                  <span className="text-muted-foreground text-sm">Recommended Action</span>
                  <p className="text-sm mt-1">{(item as unknown as Record<string, unknown>).recommendedAction as string}</p>
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="border rounded-xl p-4" style={{ borderColor: "hsl(var(--kf-border))" }}>
              <h3 className="text-sm font-medium mb-3">Timeline</h3>
              <div className="space-y-3">
                {timeline.map((evt, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <div className="mt-0.5 text-muted-foreground">{evt.icon}</div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{evt.label}</p>
                      {evt.date && (
                        <p className="text-xs text-muted-foreground">
                          {new Date(evt.date).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="border rounded-xl p-4" style={{ borderColor: "hsl(var(--kf-border))" }}>
              <h3 className="text-sm font-medium mb-3">Actions</h3>
              <div className="flex flex-wrap gap-2">
                {!isDone && (
                  <>
                    <button
                      onClick={() =>
                        handleAction("complete", async () => {
                          await completeCommandItem(businessId!, item.id);
                        })
                      }
                      disabled={!!actionLoading}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === "complete" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Complete
                    </button>
                    <button
                      onClick={() =>
                        handleAction("dismiss", async () => {
                          await dismissCommandItem(businessId!, item.id);
                        })
                      }
                      disabled={!!actionLoading}
                      className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                      style={{ borderColor: "hsl(var(--kf-border))" }}
                    >
                      {actionLoading === "dismiss" ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                      Dismiss
                    </button>
                    <button
                      onClick={() => {
                        const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                        handleAction("snooze", async () => {
                          await snoozeCommandItem(businessId!, item.id, until);
                        });
                      }}
                      disabled={!!actionLoading}
                      className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                      style={{ borderColor: "hsl(var(--kf-border))" }}
                    >
                      {actionLoading === "snooze" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                      Snooze 24h
                    </button>
                    {item.requiresApproval && (
                      <button
                        onClick={() =>
                          handleAction("approve", async () => {
                            await approveCommandItem(businessId!, item.id);
                          })
                        }
                        disabled={!!actionLoading}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        Approve
                      </button>
                    )}
                    {item.executableByKey && (
                      <button
                        onClick={() =>
                          handleAction("execute", async () => {
                            await executeCommandItem(businessId!, item.id);
                          })
                        }
                        disabled={!!actionLoading}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                        style={{ background: "hsl(var(--kf-accent1))", color: "#fff" }}
                      >
                        {actionLoading === "execute" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                        Execute
                      </button>
                    )}
                    <button
                      onClick={() =>
                        handleAction("assign", async () => {
                          await assignCommandItem(businessId!, item.id, "USER", "me");
                        })
                      }
                      disabled={!!actionLoading}
                      className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                      style={{ borderColor: "hsl(var(--kf-border))" }}
                    >
                      {actionLoading === "assign" ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                      Assign
                    </button>
                  </>
                )}
                {isDone && (
                  <button
                    onClick={() =>
                      handleAction("reopen", async () => {
                        await reopenCommandItem(businessId!, item.id);
                      })
                    }
                    disabled={!!actionLoading}
                    className="inline-flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                    style={{ borderColor: "hsl(var(--kf-border))" }}
                  >
                    {actionLoading === "reopen" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    Reopen
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="border rounded-xl p-4 space-y-3 text-sm" style={{ borderColor: "hsl(var(--kf-border))" }}>
              <h3 className="font-medium">Meta</h3>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Created</span>
                <span className="ml-auto">{new Date(item.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Updated</span>
                <span className="ml-auto">{new Date(item.updatedAt).toLocaleString()}</span>
              </div>
              {item.executableByKey && (
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                  <span className="text-muted-foreground">Executable by KEY</span>
                  <span className="ml-auto text-emerald-600 font-medium">Yes</span>
                </div>
              )}
              {item.ownerType && (
                <div className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Owner</span>
                  <span className="ml-auto capitalize">{item.ownerType}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
