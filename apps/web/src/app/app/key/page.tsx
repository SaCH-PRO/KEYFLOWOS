"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Brain,
  Send,
  Zap,
  HardDrive,
  Share2,
  ShieldCheck,
  MessageSquare,
  ClipboardList,
  Settings,
  Loader2,
  CheckCircle2,
  XCircle,
  Terminal,
  Mic,
  Search,
  ChevronDown,
  Inbox,
  Activity,
  Filter,
  Clock,
  Headphones,
  Volume2,
} from "lucide-react";
import dynamic from "next/dynamic";
import { getStoredBusinessId } from "@/lib/workspace";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { SectionCard } from "@/components/ui/section-card";
import { apiGet, apiPost } from "@/lib/api";
import { fetchAiExecutionLogs, type AiExecutionLogEntry } from "@/lib/client";
import { fetchAgentConfig, updateAgentConfig, type KeyAgentConfig } from "@/lib/api/key-agent";

interface KeyCommand {
  id: string;
  rawInput: string;
  mode: string;
  status: string;
  riskLevel: string;
  createdAt: string;
}

interface ApprovalItem {
  id: string;
  title: string;
  description: string | null;
  riskTier: number;
  status: string;
}

const MODES = [
  { key: "ask", label: "Ask", desc: "Explain, analyze, answer" },
  { key: "plan", label: "Plan", desc: "Create plan, no execution" },
  { key: "draft", label: "Draft", desc: "Prepare messages/documents/actions" },
  { key: "do", label: "Do", desc: "Execute low-risk approved work" },
  { key: "auto", label: "Auto", desc: "Monitor and act under governance rules" },
];

const LOG_STATUS_OPTIONS = ["ALL", "SUCCESS", "FAILED"];
const LOG_CATEGORY_OPTIONS = ["ALL", "MONEY", "TIME", "PEOPLE", "WORK", "SALES", "MARKETING", "GOVERNANCE", "STRATEGY", "SYSTEM"];

const JarvisVoice = dynamic(() => import("../keyflow-command/components/jarvis-voice"), { ssr: false });

export default function KeyWorkerPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [showVoice, setShowVoice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [commands, setCommands] = useState<KeyCommand[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [governance, setGovernance] = useState<{ mode?: string; maxAutoTier?: number; blockedTools?: string[] } | null>(null);
  const [executionLogs, setExecutionLogs] = useState<AiExecutionLogEntry[]>([]);
  const [agentConfig, setAgentConfig] = useState<KeyAgentConfig | null>(null);
  const [input, setInput] = useState("");
  const [selectedMode, setSelectedMode] = useState("do");
  const [submitting, setSubmitting] = useState(false);

  // Execution log filters
  const [logStatus, setLogStatus] = useState("ALL");
  const [logCategory, setLogCategory] = useState("ALL");
  const [logDateRange, setLogDateRange] = useState("ALL");
  const [logSearch, setLogSearch] = useState("");
  const [logLimit, setLogLimit] = useState(10);
  const [logLoading, setLogLoading] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [cmdRes, appRes, govRes, logRes, cfgRes] = await Promise.all([
        apiGet<KeyCommand[]>(`/ai/businesses/${businessId}/key/commands`),
        apiGet<{ items: ApprovalItem[] }>(`/ai/businesses/${businessId}/ai/approvals`),
        apiGet<{ mode?: string; maxAutoTier?: number; blockedTools?: string[] }>(`/ai/businesses/${businessId}/ai/governance`),
        fetchAiExecutionLogs(businessId, { limit: logLimit }),
        fetchAgentConfig(businessId),
      ]);
      if (cmdRes.data) setCommands(cmdRes.data.slice(0, 20));
      if (appRes.data) setApprovals(appRes.data.items ?? []);
      if (govRes.data) setGovernance(govRes.data);
      if (logRes.data) setExecutionLogs(logRes.data ?? []);
      if (cfgRes.data) setAgentConfig(cfgRes.data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [businessId, logLimit]);

  const loadLogs = useCallback(async () => {
    if (!businessId) return;
    setLogLoading(true);
    try {
      const res = await fetchAiExecutionLogs(businessId, { limit: logLimit });
      if (res.data) setExecutionLogs(res.data ?? []);
    } catch {
      // silently fail
    } finally {
      setLogLoading(false);
    }
  }, [businessId, logLimit]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !businessId) return;
    setSubmitting(true);
    try {
      await apiPost({
        path: `/ai/businesses/${businessId}/key/command`,
        body: { rawInput: input.trim(), mode: selectedMode, inputMode: "TEXT" },
      });
      setInput("");
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproval = async (id: string, resolution: string) => {
    if (!businessId) return;
    await apiPost({
      path: `/ai/businesses/${businessId}/ai/approvals/${id}/resolve`,
      body: { resolution },
    });
    await load();
  };

  const pendingApprovals = approvals.filter((a) => a.status === "pending");

  const filteredLogs = executionLogs.filter((log) => {
    if (logStatus === "SUCCESS" && !log.success) return false;
    if (logStatus === "FAILED" && log.success) return false;
    if (logCategory !== "ALL" && log.module !== logCategory) return false;
    if (logDateRange !== "ALL") {
      const logDate = new Date(log.createdAt);
      const now = new Date();
      const diffDays = (now.getTime() - logDate.getTime()) / (1000 * 60 * 60 * 24);
      if (logDateRange === "24h" && diffDays > 1) return false;
      if (logDateRange === "7d" && diffDays > 7) return false;
      if (logDateRange === "30d" && diffDays > 30) return false;
    }
    if (logSearch.trim()) {
      const term = logSearch.toLowerCase();
      const text = `${log.toolName ?? ""} ${log.action ?? ""} ${log.module ?? ""} ${log.rationale ?? ""}`.toLowerCase();
      if (!text.includes(term)) return false;
    }
    return true;
  });

  const handleTyping = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kf:key-typing"));
    }
  };

  return (
    <UnifiedPageShell
      title="KEY Worker"
      subtitle="Ask, plan, draft, and execute with AI."
      icon={Bot}
      maxWidth="5xl"
      headerActions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/app/key/voice-sessions")}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors"
          >
            <Headphones className="w-3.5 h-3.5" />
            Sessions
          </button>
          <button
            onClick={() => router.push("/app/key/voice-settings")}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 transition-colors"
          >
            <Volume2 className="w-3.5 h-3.5" />
            Voice
          </button>
        </div>
      }
    >
      {/* Command Input */}
      <SectionCard icon={Brain} title="Command KEY" noPadding>
        <div className="p-4 space-y-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setSelectedMode(m.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  selectedMode === m.key
                    ? "bg-[hsl(var(--kf-accent1))] text-white"
                    : "bg-muted hover:bg-muted/80"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={input}
                onChange={(e) => { setInput(e.target.value); handleTyping(); }}
                placeholder={`Ask KEY to ${MODES.find((m) => m.key === selectedMode)?.desc.toLowerCase()}...`}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <Bot className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            </div>
            <button
              type="button"
              onClick={() => setShowVoice((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                showVoice
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground hover:bg-muted/80"
              }`}
              title="Voice mode"
              aria-label={showVoice ? "Hide voice panel" : "Open voice panel"}
            >
              <Mic className="w-4 h-4" />
            </button>
            <button
              type="submit"
              disabled={!input.trim() || submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send
            </button>
          </form>

          {/* Voice Panel */}
          {showVoice && businessId && (
            <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "hsl(var(--kf-border))" }}>
              <JarvisVoice businessId={businessId} />
            </div>
          )}

          {/* Quick prompts */}
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { label: "Scan Drive", icon: HardDrive, text: "Scan Drive" },
              { label: "What did KEY find?", icon: Search, text: "What did KEY find?" },
              { label: "Check messages", icon: MessageSquare, text: "Check messages" },
              { label: "Recent social", icon: Share2, text: "Show recent social engagement" },
            ].map((prompt) => (
              <button
                key={prompt.label}
                type="button"
                onClick={() => { setInput(prompt.text); handleTyping(); }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-muted hover:bg-muted/80 transition-colors"
              >
                <prompt.icon className="w-3 h-3" />
                {prompt.label}
              </button>
            ))}
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Workbench */}
        <div className="lg:col-span-2 space-y-4">
          <SectionCard icon={ClipboardList} title="Workbench" subtitle="Active plans, commands, and history">
            {loading ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-10 bg-muted rounded" />
                <div className="h-10 bg-muted rounded" />
              </div>
            ) : commands.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Inbox className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-sm font-medium">Your workbench is empty</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Ask KEY above to create your first command. Try &quot;What should I focus on today?&quot;
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {commands.map((cmd) => (
                  <div key={cmd.id} className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: "hsl(var(--kf-border))" }}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{cmd.rawInput}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-muted">
                          {cmd.mode}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-muted">
                          {cmd.status}
                        </span>
                        {cmd.riskLevel !== "LOW" && (
                          <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                            {cmd.riskLevel}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {new Date(cmd.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard icon={ShieldCheck} title="Pending Approvals" subtitle={`${pendingApprovals.length} items need your review`}>
            {pendingApprovals.length === 0 ? (
              <p className="kf-text-caption py-2">No pending approvals. KEY can act freely within governance rules.</p>
            ) : (
              <div className="space-y-2">
                {pendingApprovals.map((app) => (
                  <div key={app.id} className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: "hsl(var(--kf-border))" }}>
                    <div>
                      <p className="text-sm font-medium">{app.title}</p>
                      {app.description && <p className="text-xs text-muted-foreground">{app.description}</p>}
                      {app.riskTier >= 3 && (
                        <span className="text-[10px] text-destructive font-medium">High risk</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleApproval(app.id, "approved")}
                        className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                        aria-label="Approve"
                        title="Approve"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleApproval(app.id, "rejected")}
                        className="p-1.5 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                        aria-label="Reject"
                        title="Reject"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard icon={Terminal} title="Execution Log" subtitle="Recent KEY actions and outcomes">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  placeholder="Search logs..."
                  aria-label="Search logs"
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  style={{ borderColor: "hsl(var(--kf-border))" }}
                />
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <Filter className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                  <select
                    value={logStatus}
                    onChange={(e) => setLogStatus(e.target.value)}
                    className="pl-7 pr-6 py-1.5 rounded-lg border text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary appearance-none"
                    style={{ borderColor: "hsl(var(--kf-border))" }}
                  >
                    {LOG_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s === "ALL" ? "All Status" : s}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                </div>
                <div className="relative">
                  <Filter className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                  <select
                    value={logCategory}
                    onChange={(e) => setLogCategory(e.target.value)}
                    className="pl-7 pr-6 py-1.5 rounded-lg border text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary appearance-none"
                    style={{ borderColor: "hsl(var(--kf-border))" }}
                  >
                    {LOG_CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>{c === "ALL" ? "All Categories" : c}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                </div>
                <div className="relative">
                  <Clock className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                  <select
                    value={logDateRange}
                    onChange={(e) => setLogDateRange(e.target.value)}
                    className="pl-7 pr-6 py-1.5 rounded-lg border text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary appearance-none"
                    style={{ borderColor: "hsl(var(--kf-border))" }}
                  >
                    <option value="ALL">All Time</option>
                    <option value="24h">Last 24h</option>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>

            {logLoading ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-10 bg-muted rounded" />
                <div className="h-10 bg-muted rounded" />
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Activity className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-sm font-medium">No activity yet</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Once KEY starts working, you&apos;ll see a complete log of actions and outcomes here.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {filteredLogs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: "hsl(var(--kf-border))" }}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{log.toolName ?? log.action ?? "Unknown action"}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${log.success ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"}`}>
                            {log.success ? "SUCCESS" : "FAILED"}
                          </span>
                          {log.module && (
                            <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-muted">
                              {log.module}
                            </span>
                          )}
                          {log.riskTier && log.riskTier >= 3 && (
                            <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                              Tier {log.riskTier}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {new Date(log.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
                {filteredLogs.length >= logLimit && (
                  <div className="flex justify-center mt-3">
                    <button
                      onClick={() => setLogLimit((prev) => prev + 10)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-muted transition-colors"
                      style={{ borderColor: "hsl(var(--kf-border))" }}
                    >
                      Load more
                    </button>
                  </div>
                )}
              </>
            )}
          </SectionCard>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <SectionCard icon={Zap} title="Autopilot" compact>
            {loading || !governance ? (
              <div className="animate-pulse space-y-2">
                <div className="h-4 bg-muted rounded w-3/4" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="kf-text-caption">Mode</span>
                  <span className="font-medium text-xs">{governance.mode ?? "advisory"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="kf-text-caption">Max auto tier</span>
                  <span className="font-medium text-xs">{governance.maxAutoTier ?? 1}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="kf-text-caption">Blocked tools</span>
                  <span className="font-medium text-xs">{(governance.blockedTools ?? []).length}</span>
                </div>
                <button
                  onClick={() => router.push("/app/settings/ai")}
                  className="w-full text-xs font-medium px-3 py-2 rounded-lg border hover:bg-muted transition-colors"
                  style={{ borderColor: "hsl(var(--kf-border))" }}
                >
                  <Settings className="w-3 h-3 inline mr-1" />
                  Configure
                </button>
              </div>
            )}
          </SectionCard>

          <SectionCard icon={Brain} title="Memory" compact>
            {agentConfig ? (
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase">Goals</label>
                  <textarea
                    value={Array.isArray(agentConfig.goals) ? agentConfig.goals.join("\n") : ""}
                    onChange={async (e) => {
                      const goals = e.target.value.split("\n").filter((g) => g.trim());
                      setAgentConfig((prev) => prev ? { ...prev, goals } : prev);
                      await updateAgentConfig(businessId, { goals });
                    }}
                    rows={2}
                    className="w-full mt-0.5 px-2 py-1 rounded text-xs bg-background border focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    style={{ borderColor: "hsl(var(--kf-border))" }}
                    placeholder="What should KEY focus on?"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase">Tone</label>
                  <input
                    value={typeof agentConfig.approvalPolicy?.tone === "string" ? agentConfig.approvalPolicy.tone : ""}
                    onChange={async (e) => {
                      const tone = e.target.value;
                      setAgentConfig((prev) => prev ? { ...prev, approvalPolicy: { ...prev.approvalPolicy, tone } } : prev);
                      await updateAgentConfig(businessId, { approvalPolicy: { ...agentConfig.approvalPolicy, tone } });
                    }}
                    className="w-full mt-0.5 px-2 py-1 rounded text-xs bg-background border focus:outline-none focus:ring-1 focus:ring-primary"
                    style={{ borderColor: "hsl(var(--kf-border))" }}
                    placeholder="professional, friendly, formal..."
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase">Memory scope</label>
                  <select
                    value={agentConfig.memoryScope}
                    onChange={async (e) => {
                      const memoryScope = e.target.value;
                      setAgentConfig((prev) => prev ? { ...prev, memoryScope } : prev);
                      await updateAgentConfig(businessId, { memoryScope });
                    }}
                    className="w-full mt-0.5 px-2 py-1 rounded text-xs bg-background border focus:outline-none focus:ring-1 focus:ring-primary"
                    style={{ borderColor: "hsl(var(--kf-border))" }}
                  >
                    <option value="business">Business-wide</option>
                    <option value="user">User-only</option>
                    <option value="session">Session-only</option>
                  </select>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Loading memory...</p>
            )}
          </SectionCard>

          <SectionCard icon={ShieldCheck} title="Governance" compact>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="kf-text-caption">Low risk — auto allowed</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="kf-text-caption">Medium — approval gate</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-destructive" />
                <span className="kf-text-caption">High — always requires approval</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[hsl(var(--kf-violet-accent))]" />
                <span className="kf-text-caption">Critical — owner + confirmation</span>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </UnifiedPageShell>
  );
}
