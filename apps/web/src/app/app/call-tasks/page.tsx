"use client";

import { AddonPackGate } from "@/components/addon-pack-gate";
import { useState, useMemo, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Phone,
  Plus,
  Loader2,
  Search,
  Trash2,
  CheckCircle2,
  Clock,
  X,
  User,
  Eye,
  Copy,
  Sparkles,
  BarChart3,
  Calendar,
} from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { MetricCard } from "@/components/ui/metric-card";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  CallLog,
  fetchCallLogs,
  fetchScheduledCalls,
  createCallTask,
  completeCallTask,
  deleteCallTask,
  generateCallScript,
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

function CallTasksPage() {
  const router = useRouter();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [scheduled, setScheduled] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, _setFilterStatus] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [showComplete, setShowComplete] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("reached");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [scriptModal, setScriptModal] = useState<{
    greeting: string;
    talkingPoints: string[];
    ask: string;
    close: string;
    durationEstimate: number;
  } | null>(null);

  const businessId = getStoredBusinessId();

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const [callsRes, scheduledRes] = await Promise.all([
        fetchCallLogs(businessId, { status: filterStatus || undefined }),
        fetchScheduledCalls(businessId, today),
      ]);
      if (callsRes.data) setCalls(callsRes.data);
      if (scheduledRes.data) setScheduled(scheduledRes.data);
    } catch (_err) {
      toast.error("Failed to load call tasks");
    } finally {
      setLoading(false);
    }
  }, [businessId, filterStatus]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return calls;
    const q = searchQuery.toLowerCase();
    return calls.filter(
      (c) =>
        c.contactId.toLowerCase().includes(q) ||
        c.script?.toLowerCase().includes(q) ||
        c.notes?.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
    );
  }, [calls, searchQuery]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!businessId) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    setCreating(true);
    try {
      await createCallTask(businessId, {
        contactId: fd.get("contactId") as string,
        scheduledAt: new Date(fd.get("scheduledAt") as string).toISOString(),
        script: (fd.get("script") as string) || undefined,
        notes: (fd.get("notes") as string) || undefined,
      });
      toast.success("Call task created");
      setShowCreate(false);
      load();
    } catch {
      toast.error("Failed to create call task");
    } finally {
      setCreating(false);
    }
  };

  const handleComplete = async () => {
    if (!businessId || !showComplete) return;
    setCompletingId(showComplete);
    try {
      await completeCallTask(businessId, showComplete, {
        outcome,
        duration: duration ? Number(duration) * 60 : undefined,
        notes: notes || undefined,
      });
      toast.success("Call logged");
      setShowComplete(null);
      setOutcome("reached");
      setDuration("");
      setNotes("");
      load();
    } catch {
      toast.error("Failed to log call");
    } finally {
      setCompletingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    if (!confirm("Delete this call task?")) return;
    try {
      await deleteCallTask(businessId, id);
      toast.success("Call task deleted");
      load();
    } catch {
      toast.error("Failed to delete");
    }
  };

  const handleGenerateScript = async (call: CallLog) => {
    if (!businessId) return;
    setGeneratingId(call.id);
    try {
      const script = await generateCallScript(businessId, call.id);
      setScriptModal(script);
      toast.success("Script generated");
      load();
    } catch {
      toast.error("Failed to generate script");
    } finally {
      setGeneratingId(null);
    }
  };

  const copyScriptToClipboard = (script: NonNullable<typeof scriptModal>) => {
    const text = `${script.greeting}\n\nTalking points:\n${script.talkingPoints.map((p) => `- ${p}`).join("\n")}\n\nAsk: ${script.ask}\n\nClose: ${script.close}\n\nEstimated duration: ${script.durationEstimate} min`;
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const reachedCount = calls.filter((c) => c.outcome === "reached").length;
  const _noAnswerCount = calls.filter((c) => c.outcome === "no_answer").length;
  const completionRate = calls.length > 0 ? Math.round((reachedCount / calls.length) * 100) : 0;

  const fadeUp = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
  };

  const _staggerContainer = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.04 } },
  };

  return (
    <WorkspaceShell icon={Phone} title="Call Tasks" subtitle="Schedule and log phone calls">
      <div className="flex flex-col gap-6 max-w-7xl mx-auto">
        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <div key={i} className="kf-card-metric animate-pulse h-20" />)
          ) : (
            <>
              <motion.div variants={fadeUp} initial="hidden" animate="show">
                <MetricCard label="Total Calls" value={calls.length} icon={Phone} />
              </motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.05 }}>
                <MetricCard label="Scheduled Today" value={scheduled.length} icon={Calendar} iconColor="#3b82f6" />
              </motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.1 }}>
                <MetricCard label="Reached" value={reachedCount} icon={CheckCircle2} iconColor="#10b981" />
              </motion.div>
              <motion.div variants={fadeUp} initial="hidden" animate="show" transition={{ delay: 0.15 }}>
                <MetricCard label="Completion Rate" value={`${completionRate}%`} icon={BarChart3} iconColor="#8b5cf6" />
              </motion.div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Call
          </button>
        </div>

        {/* Today's scheduled */}
        {scheduled.length > 0 && (
          <SectionCard title={`Scheduled Today (${scheduled.length})`} icon={Clock} compact>
            <div className="space-y-2 p-3">
              {scheduled.slice(0, 5).map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center justify-between p-3 rounded-xl bg-muted/20 border border-border/30 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <Phone className="w-4 h-4 text-blue-500" />
                    </div>
                    <div>
                      <span className="font-medium text-sm">Contact {c.contactId.slice(0, 8)}</span>
                      <span className="text-muted-foreground text-xs ml-2">
                        {new Date(c.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowComplete(c.id)}
                    className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors"
                  >
                    Log
                  </button>
                </motion.div>
              ))}
            </div>
          </SectionCard>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search calls..."
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
          <EmptyState
            icon={Phone}
            title="No call tasks"
            description="Schedule your first call to start tracking outreach."
            actionLabel="New Call"
            actionIcon={Plus}
            onAction={() => setShowCreate(true)}
            variant="compact"
          />
        ) : (
          <SectionCard title="Call History" icon={BarChart3} compact noPadding>
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Contact</th>
                  <th className="px-4 py-3 text-left font-medium">Scheduled</th>
                  <th className="px-4 py-3 text-left font-medium">Outcome</th>
                  <th className="px-4 py-3 text-left font-medium">Duration</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{c.contactId.slice(0, 8)}</span>
                      </div>
                      {c.script && (
                        <div className="text-muted-foreground text-xs mt-0.5 truncate max-w-xs">{c.script}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {new Date(c.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-3">
                      {c.outcome ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${OUTCOME_COLORS[c.outcome] || "bg-gray-100"}`}>
                          {OUTCOME_LABELS[c.outcome] || c.outcome}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.duration ? `${Math.round(c.duration / 60)}m` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => router.push(`/app/call-tasks/${c.id}`)}
                          className="p-1.5 rounded hover:bg-muted transition-colors"
                        >
                          <Eye className="w-4 h-4 text-muted-foreground" />
                        </button>
                        {!c.outcome && (
                          <>
                            <button
                              onClick={() => handleGenerateScript(c)}
                              disabled={generatingId === c.id}
                              className="inline-flex items-center gap-1 px-3 py-1 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 transition-colors disabled:opacity-50"
                            >
                              {generatingId === c.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Sparkles className="w-3 h-3" />
                              )}
                              Script
                            </button>
                            <button
                              onClick={() => setShowComplete(c.id)}
                              className="inline-flex items-center gap-1 px-3 py-1 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              Log
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="p-1.5 rounded hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">New Call Task</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Contact ID *</label>
                <input name="contactId" required className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="contact-id" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Scheduled At *</label>
                <input type="datetime-local" name="scheduledAt" required className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Script / Talking Points</label>
                <textarea name="script" rows={3} className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="What should the caller say?" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea name="notes" rows={2} className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Any additional context..." />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border hover:bg-muted transition-colors">Cancel</button>
                <button type="submit" disabled={creating} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create Call
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Script modal */}
      {scriptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                AI Call Script
              </h2>
              <button onClick={() => setScriptModal(null)} className="p-1 rounded hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Greeting</span>
                <p className="text-sm bg-muted/50 rounded-lg p-3">{scriptModal.greeting}</p>
              </div>
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Talking Points</span>
                <ul className="space-y-2">
                  {scriptModal.talkingPoints.map((point, i) => (
                    <li key={i} className="text-sm bg-muted/50 rounded-lg p-3 flex items-start gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-medium shrink-0 mt-0.5">{i + 1}</span>
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ask</span>
                <p className="text-sm bg-muted/50 rounded-lg p-3">{scriptModal.ask}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Close</span>
                <p className="text-sm bg-muted/50 rounded-lg p-3">{scriptModal.close}</p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Estimated duration: {scriptModal.durationEstimate} min</span>
                <button
                  onClick={() => copyScriptToClipboard(scriptModal)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border hover:bg-muted transition-colors text-sm"
                >
                  <Copy className="w-4 h-4" />
                  Copy to clipboard
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Complete modal */}
      {showComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Log Call Outcome</h2>
              <button onClick={() => setShowComplete(null)} className="p-1 rounded hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Outcome</label>
                <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20">
                  {Object.entries(OUTCOME_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Duration (minutes)</label>
                <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="0" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Call notes..." />
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowComplete(null)} className="px-4 py-2 rounded-lg border hover:bg-muted transition-colors">Cancel</button>
                <button
                  onClick={handleComplete}
                  disabled={!!completingId}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {completingId === showComplete ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
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

export default function Page() {
  return (
    <AddonPackGate
      pack="salesPack"
      title="Sales Pack"
      description="Call task management, AI-generated call scripts, outcome tracking, and scheduled follow-ups for high-touch sales teams."
      features={[
        "Call task queue with priority and scheduling",
        "AI-generated call scripts based on contact context",
        "Outcome logging (reached, voicemail, callback, etc.)",
        "Scheduled call reminders and follow-up tracking",
        "Call-to-CRM linking with contact history",
      ]}
    >
      <CallTasksPage />
    </AddonPackGate>
  );
}
