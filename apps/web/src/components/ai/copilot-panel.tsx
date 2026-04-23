"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain, X, Send, Loader2, Sparkles, ArrowRight,
  Activity, Shield, CheckCircle2,
  ChevronRight, Settings, TrendingUp, Calendar, AlertCircle,
  AlertTriangle, Zap, Info, Check, XIcon, Edit3,
  Clock, Package, Users, DollarSign, FileText,
  BarChart3, Target, Layers,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  sendFlowChat,
  confirmFlowAction,
  fetchAiPendingApprovals,
  fetchAiExecutionStats,
  fetchAiExecutionLogs,
  fetchActionQueue,
  resolveAiApproval,
  fetchProAutoInsights,
  fetchProfileStatus,
  sendProfileChat,
  confirmProfileExtractions,
  type AiApprovalItem,
  type AiExecutionStats,
  type AiExecutionLogEntry,
  type ActionQueueItem,
  type ProAutoInsight,
  type ProfileStatus,
  type ProfileExtraction,
  type FlowChatResponse,
  type FlowToolResult,
  type FlowPendingConfirmation,
} from "@/lib/client";
import { VerificationCardCompact } from "./verification-card";
import { useAiContext } from "@/contexts/ai-context";

type Tab = "chat" | "queue" | "activity";

export type CopilotModule =
  | "cockpit"
  | "crm"
  | "revenue"
  | "calendar"
  | "content"
  | "projects"
  | "expenses"
  | "flows"
  | "settings"
  | "store"
  | "profile"
  | null;

interface CopilotPanelProps {
  open: boolean;
  onClose: () => void;
  currentModule?: CopilotModule;
  initialPrompt?: string;
  onInitialPromptConsumed?: () => void;
}

interface QuickPrompt {
  label: string;
  prompt: string;
  dynamic?: boolean;
  severity?: "critical" | "warning" | "opportunity" | "info";
}

interface PlanStep {
  toolCallId: string;
  name: string;
  description: string;
  arguments: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "executing" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  plan?: PlanStep[];
  pendingConfirmations?: FlowPendingConfirmation[];
  toolResults?: FlowToolResult[];
  requiresConfirmation?: boolean;
}

const MODULE_LABELS: Record<string, { label: string; icon: typeof Sparkles; color: string }> = {
  crm: { label: "CRM", icon: Users, color: "text-blue-400" },
  revenue: { label: "Revenue", icon: DollarSign, color: "text-emerald-400" },
  commerce: { label: "Commerce", icon: Package, color: "text-emerald-400" },
  calendar: { label: "Calendar", icon: Calendar, color: "text-purple-400" },
  bookings: { label: "Bookings", icon: Calendar, color: "text-purple-400" },
  content: { label: "Content", icon: FileText, color: "text-pink-400" },
  projects: { label: "Projects", icon: Layers, color: "text-cyan-400" },
  expenses: { label: "Expenses", icon: BarChart3, color: "text-amber-400" },
  flows: { label: "Automations", icon: Zap, color: "text-teal-400" },
  automations: { label: "Automations", icon: Zap, color: "text-teal-400" },
  store: { label: "Store", icon: Package, color: "text-orange-400" },
  cockpit: { label: "Command Flow", icon: Target, color: "text-foreground/70" },
};

const RISK_STYLES: Record<string, { bg: string; border: string; label: string; color: string }> = {
  low: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "Safe", color: "text-emerald-400" },
  medium: { bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Confirm", color: "text-amber-400" },
  high: { bg: "bg-red-500/10", border: "border-red-500/20", label: "Approval", color: "text-red-400" },
};

const SEVERITY_CONFIG: Record<ProAutoInsight["severity"], { icon: typeof AlertCircle; color: string; bg: string; border: string }> = {
  critical: { icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
  warning: { icon: AlertCircle, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  opportunity: { icon: Zap, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
};

const FALLBACK_PROMPTS: QuickPrompt[] = [
  { label: "Business overview", prompt: "Give me a quick business overview" },
  { label: "Today's priorities", prompt: "What should I focus on today?" },
  { label: "Revenue summary", prompt: "How is my revenue performing?" },
  { label: "Pending tasks", prompt: "Show me what needs my attention" },
];

function ModuleBadge({ moduleId }: { moduleId: string }) {
  const info = MODULE_LABELS[moduleId] || MODULE_LABELS.cockpit;
  const Icon = info.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-muted/20 ${info.color}`}>
      <Icon className="w-2.5 h-2.5" />
      {info.label}
    </span>
  );
}

function PlanStepCard({
  step,
  onApprove,
  onReject,
  onApproveWithEdits,
  loading,
}: {
  step: PlanStep;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onApproveWithEdits: (id: string, editedArgs: Record<string, unknown>) => void;
  loading: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editedArgs, setEditedArgs] = useState<Record<string, string>>({});
  const risk = RISK_STYLES[step.riskLevel] || RISK_STYLES.low;
  const toolLabel = step.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const startEditing = useCallback(() => {
    const initial: Record<string, string> = {};
    for (const [k, v] of Object.entries(step.arguments)) {
      initial[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    setEditedArgs(initial);
    setEditing(true);
  }, [step.arguments]);

  const handleSaveEdits = useCallback(() => {
    const parsed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(editedArgs)) {
      try {
        parsed[k] = JSON.parse(v);
      } catch {
        parsed[k] = v;
      }
    }
    onApproveWithEdits(step.toolCallId, parsed);
    setEditing(false);
  }, [editedArgs, step.toolCallId, onApproveWithEdits]);

  return (
    <div className={`p-3 rounded-xl border ${risk.border} ${risk.bg} space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-foreground/85">{toolLabel}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${risk.color} ${risk.bg} border ${risk.border}`}>
              {risk.label}
            </span>
          </div>
          {step.description && (
            <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{step.description}</p>
          )}
        </div>
        {step.status === "completed" && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
        {step.status === "failed" && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
      </div>

      {!editing && Object.keys(step.arguments).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(step.arguments).slice(0, 4).map(([k, v]) => (
            <span key={k} className="text-[9px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground/50">
              {k}: {typeof v === "string" ? v.slice(0, 30) : String(v)}
            </span>
          ))}
        </div>
      )}

      {editing && (
        <div className="space-y-1.5 pt-1">
          {Object.entries(editedArgs).map(([k, v]) => (
            <div key={k} className="flex items-start gap-2">
              <label className="text-[10px] text-muted-foreground/60 min-w-[60px] pt-1.5 shrink-0">{k}</label>
              <input
                type="text"
                value={v}
                onChange={(e) => setEditedArgs((prev) => ({ ...prev, [k]: e.target.value }))}
                className="flex-1 text-[11px] px-2 py-1 rounded-lg bg-muted/20 border border-border/30 text-foreground/80 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40"
              />
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSaveEdits}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] text-[11px] font-medium hover:bg-[hsl(var(--kf-accent1))]/25 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Approve with edits
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-lg bg-muted/20 text-muted-foreground/60 text-[11px] hover:bg-muted/30 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step.status === "pending" && step.riskLevel !== "low" && !editing && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onApprove(step.toolCallId)}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-[11px] font-medium hover:bg-emerald-500/25 transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Approve
          </button>
          {Object.keys(step.arguments).length > 0 && (
            <button
              onClick={startEditing}
              disabled={loading}
              className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] text-[11px] font-medium hover:bg-[hsl(var(--kf-accent1))]/20 transition-all disabled:opacity-50"
            >
              <Edit3 className="w-3 h-3" />
              Edit
            </button>
          )}
          <button
            onClick={() => onReject(step.toolCallId)}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-[11px] font-medium hover:bg-red-500/25 transition-all disabled:opacity-50"
          >
            <XIcon className="w-3 h-3" />
            Reject
          </button>
        </div>
      )}

      {step.status === "completed" && (
        <div className="text-[10px] text-emerald-400/70 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" />
          <span>Executed successfully</span>
        </div>
      )}

      {step.status === "failed" && step.error && (
        <div className="text-[10px] text-red-400/70">{step.error}</div>
      )}
    </div>
  );
}

function ExecutionLogCard({ log }: { log: AiExecutionLogEntry }) {
  const timeAgo = getTimeAgo(log.createdAt ?? "");
  const toolLabel = (log.toolName || log.action || "Unknown").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="flex items-start gap-3 p-2.5 rounded-xl bg-muted/10 border border-border/20">
      <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${log.success ? "bg-emerald-500/15" : "bg-red-500/15"}`}>
        {log.success ? (
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
        ) : (
          <AlertTriangle className="w-3 h-3 text-red-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[11px] font-medium text-foreground/80 truncate">{toolLabel}</span>
          {log.module && <ModuleBadge moduleId={log.module} />}
        </div>
        {log.rationale && (
          <p className="text-[10px] text-muted-foreground/50 leading-relaxed line-clamp-2">{log.rationale}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[9px] text-muted-foreground/40">{timeAgo}</span>
          {log.durationMs != null && (
            <span className="text-[9px] text-muted-foreground/30">{log.durationMs}ms</span>
          )}
          {log.riskTier > 0 && (
            <span className={`text-[9px] px-1 rounded ${log.riskTier <= 1 ? "text-emerald-400 bg-emerald-500/10" : log.riskTier === 2 ? "text-amber-400 bg-amber-500/10" : "text-red-400 bg-red-500/10"}`}>
              T{log.riskTier}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function QueueItemCard({
  item,
  onAction,
}: {
  item: ActionQueueItem;
  onAction?: (id: string) => void;
}) {
  const tierColor = item.riskTier <= 1
    ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
    : item.riskTier === 2
      ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
      : item.riskTier === 3
        ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
        : "text-red-400 bg-red-500/10 border-red-500/20";
  const tierLabel = item.riskTier <= 1 ? "Auto" : item.riskTier === 2 ? "Confirm" : item.riskTier === 3 ? "Approval" : "Admin";
  const statusColor = item.status === "completed"
    ? "text-emerald-400"
    : item.status === "failed"
      ? "text-red-400"
      : item.status === "pending"
        ? "text-amber-400"
        : "text-blue-400";
  const toolLabel = item.toolName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="p-3 rounded-xl border border-border/20 bg-muted/5 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[11px] font-semibold text-foreground/85">{item.title || toolLabel}</span>
            {item.module && <ModuleBadge moduleId={item.module} />}
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium border ${tierColor}`}>
              T{item.riskTier} · {tierLabel}
            </span>
          </div>
          {item.description && (
            <p className="text-[10px] text-muted-foreground/50 leading-relaxed">{item.description}</p>
          )}
        </div>
        <span className={`text-[9px] font-medium capitalize shrink-0 ${statusColor}`}>{item.status}</span>
      </div>
      {item.affectedEntities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.affectedEntities.slice(0, 3).map((e, i) => (
            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground/40">{e}</span>
          ))}
          {item.affectedEntities.length > 3 && (
            <span className="text-[9px] text-muted-foreground/30">+{item.affectedEntities.length - 3} more</span>
          )}
        </div>
      )}
      {item.status === "pending" && onAction && (
        <button
          onClick={() => onAction(item.id)}
          className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))/0.1] text-[hsl(var(--kf-accent1))] text-[11px] font-medium hover:bg-[hsl(var(--kf-accent1))/0.2] transition-all"
        >
          Review <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function getTimeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function CopilotPanel({ open, onClose, currentModule, initialPrompt, onInitialPromptConsumed }: CopilotPanelProps) {
  const aiContext = useAiContext();
  const [tab, setTab] = useState<Tab>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<AiApprovalItem[]>([]);
  const [stats, setStats] = useState<AiExecutionStats | null>(null);
  const [insights, setInsights] = useState<ProAutoInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus | null>(null);
  const [profileMode, setProfileMode] = useState(false);
  const [profileSending, setProfileSending] = useState(false);
  const [profileMessages, setProfileMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [pendingExtractions, setPendingExtractions] = useState<ProfileExtraction[]>([]);
  const [confirmingExtractions, setConfirmingExtractions] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<AiExecutionLogEntry[]>([]);
  const [actionQueue, setActionQueue] = useState<ActionQueueItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dynamicPrompts = useMemo((): QuickPrompt[] => {
    const prompts: QuickPrompt[] = [];

    const criticalInsights = insights.filter((i) => i.severity === "critical" || i.severity === "warning");
    for (const insight of criticalInsights.slice(0, 2)) {
      prompts.push({
        label: insight.title,
        prompt: insight.suggestedAction || `Tell me about: ${insight.title}`,
        dynamic: true,
        severity: insight.severity,
      });
    }

    const opportunities = insights.filter((i) => i.severity === "opportunity");
    for (const opp of opportunities.slice(0, 1)) {
      prompts.push({
        label: opp.title,
        prompt: opp.suggestedAction || `How can I leverage: ${opp.title}`,
        dynamic: true,
        severity: "opportunity",
      });
    }

    if (pendingApprovals.length > 0) {
      prompts.push({
        label: `${pendingApprovals.length} pending approval${pendingApprovals.length !== 1 ? "s" : ""}`,
        prompt: `Review my ${pendingApprovals.length} pending AI actions and help me decide`,
        dynamic: true,
        severity: "warning",
      });
    }

    while (prompts.length < 4) {
      const remaining = FALLBACK_PROMPTS.filter(
        (fp) => !prompts.some((p) => p.label === fp.label)
      );
      if (remaining.length === 0) break;
      prompts.push(remaining[0]);
    }

    return prompts.slice(0, 4);
  }, [insights, pendingApprovals]);

  const moduleInsights = useMemo(() => {
    if (!currentModule || currentModule === "cockpit") return insights;
    return insights.filter((i) => i.module === currentModule);
  }, [insights, currentModule]);

  const allQueueItems = useMemo(() => {
    const approvalItems: ActionQueueItem[] = pendingApprovals.map((a) => ({
      id: a.id,
      type: "pending_approval" as const,
      toolName: a.toolName,
      title: a.title,
      description: a.description,
      riskTier: a.riskTier,
      module: null,
      status: "pending" as const,
      createdAt: a.createdAt,
      affectedEntities: [],
    }));

    const combined = [...approvalItems, ...actionQueue.filter((q) => q.status === "pending" || q.status === "scheduled")];
    return combined.sort((a, b) => b.riskTier - a.riskTier || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [pendingApprovals, actionQueue]);

  const queueInsights = useMemo(() => {
    return insights.filter((i) => i.severity === "critical" || i.severity === "warning");
  }, [insights]);

  const totalQueueCount = allQueueItems.length + queueInsights.length;

  const loadSidebarData = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    try {
      const [approvalRes, statsRes, queueRes] = await Promise.all([
        fetchAiPendingApprovals(biz),
        fetchAiExecutionStats(biz, 7),
        fetchActionQueue(biz, undefined, 20).catch(() => ({ data: null, error: "Failed" })),
      ]);
      if (approvalRes.data) setPendingApprovals(approvalRes.data.filter((a) => a.status === "pending"));
      if (statsRes.data) setStats(statsRes.data);
      if (queueRes.data) setActionQueue(queueRes.data.items);
    } catch {
    }
  }, []);

  const loadInsights = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    setInsightsLoading(true);
    try {
      const res = await fetchProAutoInsights(biz);
      if (res.data?.insights) setInsights(res.data.insights);
    } catch {
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  const loadProfileStatus = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    try {
      const res = await fetchProfileStatus(biz);
      if (res.data) setProfileStatus(res.data);
    } catch {}
  }, []);

  const loadExecutionLogs = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    setLogsLoading(true);
    try {
      const res = await fetchAiExecutionLogs(biz, { limit: 20 });
      if (res.data) setExecutionLogs(res.data);
    } catch {
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const handleProfileSend = useCallback(async (msg: string) => {
    const biz = getStoredBusinessId();
    if (!biz || !msg.trim()) return;
    setProfileMessages((prev) => [...prev, { role: "user", content: msg }]);
    setProfileSending(true);
    try {
      const res = await sendProfileChat(biz, msg);
      if (res.data) {
        setProfileMessages((prev) => [...prev, { role: "assistant", content: res.data!.reply }]);
        if (res.data.pendingExtractions?.length > 0) {
          setPendingExtractions(res.data.pendingExtractions);
        }
        loadProfileStatus();
      }
    } catch {
      toast.error("Failed to process response");
    } finally {
      setProfileSending(false);
    }
  }, [loadProfileStatus]);

  const handleConfirmExtractions = useCallback(async (keys?: string[]) => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    setConfirmingExtractions(true);
    try {
      const res = await confirmProfileExtractions(biz, keys);
      if (res.data) {
        setPendingExtractions([]);
        loadProfileStatus();
        toast.success(`Saved ${res.data.saved} insight${res.data.saved !== 1 ? "s" : ""} to your profile`);
      }
    } catch {
      toast.error("Failed to save profile data");
    } finally {
      setConfirmingExtractions(false);
    }
  }, [loadProfileStatus]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300);
      loadSidebarData();
      loadInsights();
      loadProfileStatus();
    }
  }, [open, loadSidebarData, loadInsights, loadProfileStatus]);

  useEffect(() => {
    if (open && tab === "activity") {
      loadExecutionLogs();
    }
  }, [open, tab, loadExecutionLogs]);

  useEffect(() => {
    const handler = () => { loadSidebarData(); };
    window.addEventListener("kf:ai-activity", handler);
    return () => window.removeEventListener("kf:ai-activity", handler);
  }, [loadSidebarData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open && initialPrompt && !sending) {
      setInput(initialPrompt);
      onInitialPromptConsumed?.();
    }
  }, [open, initialPrompt, sending, onInitialPromptConsumed]);

  const processFlowResponse = useCallback((res: FlowChatResponse): ChatMessage => {
    const msg: ChatMessage = {
      role: "assistant",
      content: res.reply,
      timestamp: Date.now(),
    };

    if (res.pendingConfirmations && res.pendingConfirmations.length > 0) {
      msg.pendingConfirmations = res.pendingConfirmations;
      msg.requiresConfirmation = true;
      msg.plan = res.pendingConfirmations.map((pc) => ({
        toolCallId: pc.toolCallId,
        name: pc.name,
        description: pc.description,
        arguments: pc.arguments,
        riskLevel: pc.riskLevel,
        status: "pending" as const,
      }));
    }

    if (res.toolResults && res.toolResults.length > 0) {
      msg.toolResults = res.toolResults;
      msg.plan = res.toolResults.map((tr) => ({
        toolCallId: tr.toolCallId,
        name: tr.name,
        description: tr.followOnSuggestions?.[0] || "",
        arguments: {},
        riskLevel: tr.riskTier <= 1 ? "low" : tr.riskTier === 2 ? "medium" : "high",
        status: tr.success ? ("completed" as const) : ("failed" as const),
        result: tr.result,
        error: tr.error,
      }));
    }

    if (res.toolCalls && res.toolCalls.length > 0 && !msg.plan) {
      msg.plan = res.toolCalls.map((tc) => ({
        toolCallId: tc.id,
        name: tc.name,
        description: "",
        arguments: tc.arguments,
        riskLevel: tc.riskLevel,
        status: "pending" as const,
      }));
    }

    return msg;
  }, []);

  const buildContextPrefix = useCallback((): string => {
    const parts: string[] = [];
    if (currentModule && currentModule !== "cockpit") {
      parts.push(`[Active workspace: ${(MODULE_LABELS[currentModule] || MODULE_LABELS.cockpit).label}]`);
    }
    const contextSummary = aiContext.getAllContextSummary();
    if (contextSummary) {
      parts.push(`[Module context:\n${contextSummary}]`);
    }
    return parts.length > 0 ? parts.join("\n") + "\n\n" : "";
  }, [currentModule, aiContext]);

  const handleSend = useCallback(async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || sending) return;
    const biz = getStoredBusinessId();
    if (!biz) return;

    setInput("");
    const userMsg: ChatMessage = { role: "user", content: msg, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const contextPrefix = buildContextPrefix();
    const enrichedMessage = contextPrefix ? `${contextPrefix}${msg}` : msg;
    try {
      const res = await sendFlowChat(biz, enrichedMessage, history);
      if (res.data) {
        const assistantMsg = processFlowResponse(res.data);
        setMessages((prev) => [...prev, assistantMsg]);

        if (res.data.toolResults?.length) {
          loadSidebarData();
        }
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again.", timestamp: Date.now() }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again.", timestamp: Date.now() }]);
    } finally {
      setSending(false);
    }
  }, [input, sending, messages, processFlowResponse, loadSidebarData, buildContextPrefix]);

  const handlePlanAction = useCallback(async (toolCallId: string, confirmed: boolean, msg: ChatMessage) => {
    const biz = getStoredBusinessId();
    if (!biz || !msg.pendingConfirmations) return;
    const pc = msg.pendingConfirmations.find((p) => p.toolCallId === toolCallId);
    if (!pc) return;

    setResolvingId(toolCallId);

    setMessages((prev) =>
      prev.map((m) => {
        if (m.timestamp !== msg.timestamp || !m.plan) return m;
        return {
          ...m,
          plan: m.plan.map((s) =>
            s.toolCallId === toolCallId
              ? { ...s, status: confirmed ? ("executing" as const) : ("rejected" as const) }
              : s
          ),
        };
      })
    );

    try {
      const res = await confirmFlowAction(biz, toolCallId, pc.name, pc.arguments, confirmed);
      if (res.data) {
        const resultMsg = processFlowResponse(res.data);

        let derivedStatus: "completed" | "rejected" | "failed" = confirmed ? "completed" : "rejected";
        let derivedError: string | undefined;

        if (confirmed && res.data.toolResults?.length) {
          const matchingResult = res.data.toolResults.find((tr) => tr.toolCallId === toolCallId);
          if (matchingResult) {
            if (matchingResult.success === false) {
              derivedStatus = "failed";
              derivedError = typeof matchingResult.result === "string" ? matchingResult.result : "Execution failed";
            }
          }
        }

        setMessages((prev) =>
          prev.map((m) => {
            if (m.timestamp !== msg.timestamp || !m.plan) return m;
            return {
              ...m,
              plan: m.plan.map((s) =>
                s.toolCallId === toolCallId
                  ? { ...s, status: derivedStatus, error: derivedError }
                  : s
              ),
            };
          })
        );

        if (resultMsg.content) {
          setMessages((prev) => [...prev, resultMsg]);
        }

        loadSidebarData();
      }
    } catch {
      toast.error("Failed to process action");
      setMessages((prev) =>
        prev.map((m) => {
          if (m.timestamp !== msg.timestamp || !m.plan) return m;
          return {
            ...m,
            plan: m.plan.map((s) =>
              s.toolCallId === toolCallId ? { ...s, status: "failed" as const, error: "Execution failed" } : s
            ),
          };
        })
      );
    } finally {
      setResolvingId(null);
    }
  }, [processFlowResponse, loadSidebarData]);

  const handlePlanActionWithEdits = useCallback(async (toolCallId: string, editedArgs: Record<string, unknown>, msg: ChatMessage) => {
    const biz = getStoredBusinessId();
    if (!biz || !msg.pendingConfirmations) return;
    const pc = msg.pendingConfirmations.find((p) => p.toolCallId === toolCallId);
    if (!pc) return;

    setResolvingId(toolCallId);

    setMessages((prev) =>
      prev.map((m) => {
        if (m.timestamp !== msg.timestamp || !m.plan) return m;
        return {
          ...m,
          plan: m.plan.map((s) =>
            s.toolCallId === toolCallId
              ? { ...s, status: "executing" as const, arguments: editedArgs }
              : s
          ),
        };
      })
    );

    try {
      const res = await confirmFlowAction(biz, toolCallId, pc.name, editedArgs, true);
      if (res.data) {
        const resultMsg = processFlowResponse(res.data);

        let derivedStatus: "completed" | "rejected" | "failed" = "completed";
        let derivedError: string | undefined;

        if (res.data.toolResults?.length) {
          const matchingResult = res.data.toolResults.find((tr) => tr.toolCallId === toolCallId);
          if (matchingResult && matchingResult.success === false) {
            derivedStatus = "failed";
            derivedError = typeof matchingResult.result === "string" ? matchingResult.result : "Execution failed";
          }
        }

        setMessages((prev) =>
          prev.map((m) => {
            if (m.timestamp !== msg.timestamp || !m.plan) return m;
            return {
              ...m,
              plan: m.plan.map((s) =>
                s.toolCallId === toolCallId
                  ? { ...s, status: derivedStatus, error: derivedError }
                  : s
              ),
            };
          })
        );

        if (resultMsg.content) {
          setMessages((prev) => [...prev, resultMsg]);
        }

        loadSidebarData();
      }
    } catch {
      toast.error("Failed to process edited action");
      setMessages((prev) =>
        prev.map((m) => {
          if (m.timestamp !== msg.timestamp || !m.plan) return m;
          return {
            ...m,
            plan: m.plan.map((s) =>
              s.toolCallId === toolCallId ? { ...s, status: "failed" as const, error: "Execution failed" } : s
            ),
          };
        })
      );
    } finally {
      setResolvingId(null);
    }
  }, [processFlowResponse, loadSidebarData]);

  const handleApprove = useCallback(async (id: string) => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    setResolvingId(id);
    try {
      const res = await resolveAiApproval(biz, id, "approved");
      if (res.data) {
        setPendingApprovals((prev) => prev.filter((a) => a.id !== id));
        toast.success("Action approved");
        loadSidebarData();
      } else {
        toast.error(res.error || "Failed to approve");
      }
    } catch {
      toast.error("Failed to approve action");
    } finally {
      setResolvingId(null);
    }
  }, [loadSidebarData]);

  const handleReject = useCallback(async (id: string) => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    setResolvingId(id);
    try {
      const res = await resolveAiApproval(biz, id, "rejected");
      if (res.data) {
        setPendingApprovals((prev) => prev.filter((a) => a.id !== id));
        toast.success("Action rejected");
        loadSidebarData();
      } else {
        toast.error(res.error || "Failed to reject");
      }
    } catch {
      toast.error("Failed to reject action");
    } finally {
      setResolvingId(null);
    }
  }, [loadSidebarData]);

  const displayInsights = currentModule && currentModule !== "cockpit" ? moduleInsights : insights.slice(0, 5);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/20 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="AI Copilot"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 z-[91] w-[420px] max-w-[90vw] flex flex-col border-l border-border/40"
            style={{ background: "hsl(var(--kf-sidebar-bg))" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                >
                  <Brain className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground/90">AI Command Center</h2>
                  <p className="text-[10px] text-muted-foreground/50">
                    {currentModule && currentModule !== "cockpit"
                      ? `Context: ${(MODULE_LABELS[currentModule] || MODULE_LABELS.cockpit).label}`
                      : "Your business autopilot"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Link
                  href="/app/settings/ai-control"
                  className="p-2 rounded-lg text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/30 transition-colors"
                  title="AI Control Center"
                  aria-label="AI Control Center"
                  onClick={onClose}
                >
                  <Settings className="w-4 h-4" />
                </Link>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/30 transition-colors"
                  aria-label="Close copilot"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex items-center border-b border-border/20" role="tablist" aria-label="Copilot sections">
              {([
                { id: "chat" as Tab, label: "Chat", icon: Sparkles },
                { id: "queue" as Tab, label: `Queue${totalQueueCount > 0 ? ` (${totalQueueCount})` : ""}`, icon: Shield },
                { id: "activity" as Tab, label: "Activity", icon: Activity },
              ]).map((t) => (
                <button
                  key={t.id}
                  id={`copilot-tab-${t.id}`}
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls={`copilot-panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-all border-b-2 ${
                    tab === t.id
                      ? "border-[hsl(var(--kf-accent1))] text-foreground/90"
                      : "border-transparent text-muted-foreground/50 hover:text-foreground/70"
                  }`}
                >
                  <t.icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {tab === "chat" && profileMode && (
                <div id="copilot-panel-profile" role="tabpanel" className="flex flex-col h-full">
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-border/20">
                    <button
                      onClick={() => setProfileMode(false)}
                      className="text-xs text-muted-foreground/60 hover:text-foreground/70 transition-colors"
                    >
                      &larr; Back
                    </button>
                    <Brain className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
                    <span className="text-xs font-semibold text-foreground/80">Business Profile Interview</span>
                    {profileStatus && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent2)_/_0.15)] text-[hsl(var(--kf-accent2))] font-medium ml-auto">
                        {profileStatus.completionPercent}%
                      </span>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    {profileMessages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                            msg.role === "user"
                              ? "bg-[hsl(var(--kf-accent2))] text-white rounded-br-md"
                              : "bg-muted/30 text-foreground/85 border border-border/20 rounded-bl-md"
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {profileSending && (
                      <div className="flex justify-start">
                        <div className="bg-muted/30 border border-border/20 rounded-2xl rounded-bl-md px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[hsl(var(--kf-accent2))]" />
                            <span className="text-xs text-muted-foreground/60">Learning...</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {pendingExtractions.length > 0 && !profileSending && (
                      <div className="mx-1 p-3 rounded-xl border border-[hsl(var(--kf-accent2)_/_0.3)] bg-[hsl(var(--kf-accent2)_/_0.08)]">
                        <div className="flex items-center gap-1.5 mb-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
                          <span className="text-[11px] font-semibold text-[hsl(var(--kf-accent2))]">Confirm what I learned</span>
                        </div>
                        <div className="space-y-1.5 mb-2.5">
                          {pendingExtractions.map((ext, i) => (
                            <div key={i} className="flex items-start gap-2 text-[12px] text-foreground/75">
                              <span className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-[hsl(var(--kf-accent2))]" />
                              <div>
                                <span className="font-medium text-foreground/85">{ext.key.replace(/_/g, " ")}:</span>{" "}
                                <span>{ext.value}</span>
                                <span className="ml-1 text-[10px] text-muted-foreground/50">({Math.round(ext.confidence * 100)}%)</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleConfirmExtractions()}
                            disabled={confirmingExtractions}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[hsl(var(--kf-accent2))] text-white text-[11px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                          >
                            {confirmingExtractions ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                            Save All
                          </button>
                          <button
                            onClick={() => setPendingExtractions([])}
                            disabled={confirmingExtractions}
                            className="px-3 py-1.5 rounded-lg border border-border/30 text-[11px] text-muted-foreground/60 hover:text-foreground/70 transition-colors disabled:opacity-50"
                          >
                            Skip
                          </button>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                  <form
                    onSubmit={(e) => { e.preventDefault(); if (input.trim() && !profileSending) { handleProfileSend(input.trim()); setInput(""); } }}
                    className="p-3 border-t border-border/20"
                  >
                    <div className="flex items-center gap-2 bg-muted/20 border border-border/30 rounded-xl px-3 py-2">
                      <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Tell me about your business..."
                        className="flex-1 bg-transparent text-sm text-foreground/85 placeholder:text-muted-foreground/35 outline-none"
                        disabled={profileSending}
                      />
                      <button
                        type="submit"
                        disabled={!input.trim() || profileSending}
                        className="w-7 h-7 rounded-lg flex items-center justify-center bg-[hsl(var(--kf-accent2))] text-white disabled:opacity-30 transition-opacity"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {tab === "chat" && !profileMode && (
                <div id="copilot-panel-chat" role="tabpanel" aria-labelledby="copilot-tab-chat" className="flex flex-col h-full">
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    {messages.length === 0 && (
                      <div className="space-y-4">
                        <div className="p-3 rounded-xl border border-border/30 bg-card/40">
                          <div className="flex items-center gap-2 mb-3">
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center"
                              style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.15), hsl(var(--kf-accent2) / 0.15))" }}
                            >
                              <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-foreground/85">Today&apos;s Pulse</p>
                              <p className="text-[10px] text-muted-foreground/50">{new Date().toLocaleDateString("en-TT", { weekday: "long", month: "short", day: "numeric" })}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2 mb-3">
                            <div className="p-2 rounded-lg bg-muted/20 text-center">
                              <TrendingUp className="w-3.5 h-3.5 mx-auto mb-1 text-emerald-400" />
                              <p className="text-[10px] text-muted-foreground/60">Success</p>
                              <p className="text-xs font-medium text-foreground/80">{stats ? `${Math.round(stats.successRate)}%` : "—"}</p>
                            </div>
                            <div className="p-2 rounded-lg bg-muted/20 text-center">
                              <Calendar className="w-3.5 h-3.5 mx-auto mb-1 text-blue-400" />
                              <p className="text-[10px] text-muted-foreground/60">AI Actions</p>
                              <p className="text-xs font-medium text-foreground/80">{stats?.totalActions ?? 0}</p>
                            </div>
                            <div className="p-2 rounded-lg bg-muted/20 text-center">
                              <AlertCircle className="w-3.5 h-3.5 mx-auto mb-1 text-amber-400" />
                              <p className="text-[10px] text-muted-foreground/60">Pending</p>
                              <p className="text-xs font-medium text-foreground/80">{totalQueueCount}</p>
                            </div>
                          </div>
                          {totalQueueCount > 0 && (
                            <button
                              onClick={() => setTab("queue")}
                              className="w-full flex items-center justify-between p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 hover:bg-amber-500/15 transition-all"
                            >
                              <span className="font-medium">{totalQueueCount} action{totalQueueCount !== 1 ? "s" : ""} waiting for your review</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {displayInsights.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider mb-2">
                              {currentModule && currentModule !== "cockpit" ? `${(MODULE_LABELS[currentModule] || MODULE_LABELS.cockpit).label} Insights` : "Business Intelligence"}
                            </p>
                            <div className="space-y-1.5">
                              {displayInsights.map((insight) => {
                                const config = SEVERITY_CONFIG[insight.severity];
                                const SevIcon = config.icon;
                                return (
                                  <button
                                    key={insight.id}
                                    onClick={() => {
                                      if (insight.suggestedAction) {
                                        handleSend(insight.suggestedAction);
                                      }
                                    }}
                                    className={`w-full flex items-start gap-2 p-2.5 rounded-xl text-left text-xs border transition-all hover:bg-muted/20 ${config.border} ${config.bg}`}
                                  >
                                    <SevIcon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${config.color}`} />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <p className={`font-medium ${config.color} leading-snug`}>{insight.title}</p>
                                        {insight.module && <ModuleBadge moduleId={insight.module} />}
                                      </div>
                                      {insight.metric && (
                                        <span className="text-[10px] text-muted-foreground/50">{insight.metric}</span>
                                      )}
                                    </div>
                                    <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground/30 mt-0.5" />
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {insightsLoading && displayInsights.length === 0 && (
                          <div className="flex items-center justify-center py-3 gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[hsl(var(--kf-accent1))]" />
                            <span className="text-[10px] text-muted-foreground/40">Scanning business health...</span>
                          </div>
                        )}

                        {profileStatus && profileStatus.completionPercent < 100 && (
                          <div className="p-3 rounded-xl border border-[hsl(var(--kf-accent2)_/_0.3)] bg-[hsl(var(--kf-accent2)_/_0.05)]">
                            <div className="flex items-center gap-2 mb-2">
                              <Brain className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
                              <span className="text-xs font-semibold text-foreground/80">Teach Me Your Business</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent2)_/_0.15)] text-[hsl(var(--kf-accent2))] font-medium ml-auto">
                                {profileStatus.completionPercent}%
                              </span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-muted/30 mb-2">
                              <div
                                className="h-full rounded-full bg-[hsl(var(--kf-accent2))] transition-all"
                                style={{ width: `${profileStatus.completionPercent}%` }}
                              />
                            </div>
                            <p className="text-[10px] text-muted-foreground/60 mb-2">
                              Help me understand your business better so I can give smarter suggestions and automate more for you.
                            </p>
                            {profileStatus.remainingTopics.length > 0 && (
                              <p className="text-[10px] text-muted-foreground/40 mb-2">
                                Next: {profileStatus.remainingTopics[0]}
                              </p>
                            )}
                            <button
                              onClick={() => {
                                setProfileMode(true);
                                if (profileMessages.length === 0) {
                                  handleProfileSend("Hi, I'd like to tell you about my business");
                                }
                              }}
                              className="w-full flex items-center justify-center gap-1.5 p-2 rounded-lg bg-[hsl(var(--kf-accent2)_/_0.15)] text-xs text-[hsl(var(--kf-accent2))] font-medium hover:bg-[hsl(var(--kf-accent2)_/_0.25)] transition-all"
                            >
                              <span>Start Conversation</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          </div>
                        )}

                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider mb-2">
                            {dynamicPrompts.some((p) => p.dynamic) ? "Suggested Now" : "Quick Actions"}
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {dynamicPrompts.map((qp) => {
                              const sevConfig = qp.severity ? SEVERITY_CONFIG[qp.severity] : null;
                              return (
                                <button
                                  key={qp.label}
                                  onClick={() => handleSend(qp.prompt)}
                                  className={`flex items-center gap-2 p-2.5 rounded-xl text-xs text-left transition-all ${
                                    sevConfig
                                      ? `${sevConfig.bg} border ${sevConfig.border} ${sevConfig.color} hover:opacity-80`
                                      : "text-muted-foreground/70 bg-muted/20 border border-border/30 hover:bg-muted/30 hover:text-foreground/80"
                                  }`}
                                >
                                  {sevConfig ? (
                                    <sevConfig.icon className="w-3 h-3 shrink-0" />
                                  ) : (
                                    <ArrowRight className="w-3 h-3 shrink-0 text-[hsl(var(--kf-accent1))]" />
                                  )}
                                  <span className="line-clamp-2">{qp.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {messages.map((msg, i) => (
                      <div key={i} className="space-y-2">
                        <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div
                            className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                              msg.role === "user"
                                ? "bg-[hsl(var(--kf-accent1))] text-white rounded-br-md"
                                : "bg-muted/30 text-foreground/85 border border-border/20 rounded-bl-md"
                            }`}
                          >
                            {msg.content}
                          </div>
                        </div>

                        {msg.plan && msg.plan.length > 0 && (
                          <div className="ml-2 space-y-2">
                            <div className="flex items-center gap-2 mb-1">
                              <div className="w-5 h-5 rounded-md flex items-center justify-center bg-[hsl(var(--kf-accent1))/0.15]">
                                <Edit3 className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
                              </div>
                              <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
                                {msg.requiresConfirmation ? "Proposed Plan" : "Execution Results"}
                              </span>
                              <span className="text-[9px] text-muted-foreground/40">
                                {msg.plan.length} step{msg.plan.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                            {msg.plan.map((step) => (
                              <PlanStepCard
                                key={step.toolCallId}
                                step={step}
                                onApprove={(id) => handlePlanAction(id, true, msg)}
                                onReject={(id) => handlePlanAction(id, false, msg)}
                                onApproveWithEdits={(id, editedArgs) => handlePlanActionWithEdits(id, editedArgs, msg)}
                                loading={resolvingId === step.toolCallId}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}

                    {sending && (
                      <div className="flex justify-start">
                        <div className="bg-muted/30 border border-border/20 rounded-2xl rounded-bl-md px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[hsl(var(--kf-accent1))]" />
                            <span className="text-xs text-muted-foreground/60">Thinking...</span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>
              )}

              {tab === "queue" && (
                <div id="copilot-panel-queue" role="tabpanel" aria-labelledby="copilot-tab-queue" className="px-4 py-3 space-y-3 overflow-y-auto">
                  {allQueueItems.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
                        Priority Queue ({allQueueItems.length})
                      </p>
                      {allQueueItems.map((item) =>
                        item.type === "pending_approval" ? (
                          <VerificationCardCompact
                            key={item.id}
                            item={pendingApprovals.find((a) => a.id === item.id)!}
                            onApprove={handleApprove}
                            onReject={handleReject}
                            loading={resolvingId === item.id}
                          />
                        ) : (
                          <QueueItemCard key={item.id} item={item} />
                        )
                      )}
                    </div>
                  )}

                  {queueInsights.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Monitoring Alerts</p>
                      {queueInsights.map((insight) => {
                        const config = SEVERITY_CONFIG[insight.severity];
                        const SevIcon = config.icon;
                        const tierLabel = insight.riskTier <= 1 ? "Auto" : insight.riskTier === 2 ? "Confirm" : insight.riskTier === 3 ? "Approval" : "Admin";
                        const tierColor = insight.riskTier <= 1 ? "text-emerald-400 bg-emerald-500/10" : insight.riskTier === 2 ? "text-blue-400 bg-blue-500/10" : insight.riskTier === 3 ? "text-amber-400 bg-amber-500/10" : "text-red-400 bg-red-500/10";
                        return (
                          <div
                            key={insight.id}
                            className={`p-3 rounded-xl border ${config.border} ${config.bg} space-y-2`}
                          >
                            <div className="flex items-start gap-2">
                              <SevIcon className={`w-4 h-4 shrink-0 mt-0.5 ${config.color}`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className={`text-xs font-semibold ${config.color} leading-snug`}>{insight.title}</p>
                                  {insight.module && <ModuleBadge moduleId={insight.module} />}
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${tierColor}`}>
                                    Tier {insight.riskTier} · {tierLabel}
                                  </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground/60 mt-1 leading-relaxed">{insight.description}</p>
                              </div>
                            </div>
                            {insight.suggestedAction && (
                              <button
                                onClick={() => { setTab("chat"); handleSend(insight.suggestedAction!); }}
                                className="w-full flex items-center justify-between p-2 rounded-lg bg-muted/20 border border-border/20 text-xs text-foreground/70 hover:bg-muted/30 transition-all"
                              >
                                <span>{insight.suggestedAction}</span>
                                <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
                              </button>
                            )}
                            {insight.escalated && (
                              <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
                                <Zap className="w-3 h-3" />
                                <span>Auto-handled by Pro Auto</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {allQueueItems.length === 0 && queueInsights.length === 0 && (
                    <div className="flex flex-col items-center py-8 gap-2">
                      <CheckCircle2 className="w-6 h-6 text-emerald-400/60" />
                      <span className="text-xs text-muted-foreground/50">All clear</span>
                      <p className="text-[10px] text-muted-foreground/40 text-center">No pending approvals, queued actions, or alerts</p>
                    </div>
                  )}
                </div>
              )}

              {tab === "activity" && (
                <div id="copilot-panel-activity" role="tabpanel" aria-labelledby="copilot-tab-activity" className="px-4 py-3 space-y-3 overflow-y-auto">
                  {stats ? (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2.5 rounded-xl border border-border/30 bg-card/50">
                          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-0.5">Actions (7d)</div>
                          <div className="text-lg font-bold text-foreground/90">{stats.totalActions}</div>
                        </div>
                        <div className="p-2.5 rounded-xl border border-border/30 bg-card/50">
                          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-0.5">Success</div>
                          <div className={`text-lg font-bold ${stats.successRate >= 90 ? "text-emerald-400" : stats.successRate >= 70 ? "text-amber-400" : "text-red-400"}`}>
                            {stats.successRate}%
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl border border-border/30 bg-card/50">
                          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-0.5">Modules</div>
                          <div className="text-lg font-bold text-foreground/90">{stats.byModule.length}</div>
                        </div>
                      </div>

                      {stats.byModule.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">By Module</span>
                          {stats.byModule.sort((a, b) => b.count - a.count).map((m) => (
                            <div key={m.module} className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-muted/10">
                              <div className="flex items-center gap-2">
                                <ModuleBadge moduleId={m.module} />
                              </div>
                              <span className="text-xs font-medium text-foreground/90">{m.count}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">Recent Actions</span>
                          {logsLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/30" />}
                        </div>
                        {executionLogs.length > 0 ? (
                          <div className="space-y-1.5">
                            {executionLogs.slice(0, 10).map((log) => (
                              <ExecutionLogCard key={log.id} log={log} />
                            ))}
                          </div>
                        ) : (
                          !logsLoading && (
                            <p className="text-[10px] text-muted-foreground/40 text-center py-3">No recent actions recorded</p>
                          )
                        )}
                      </div>

                      <Link
                        href="/app/settings/ai-control"
                        onClick={onClose}
                        className="flex items-center justify-center gap-2 p-2.5 rounded-xl text-xs font-medium text-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))/0.08] hover:bg-[hsl(var(--kf-accent1))/0.15] border border-[hsl(var(--kf-accent1))/0.15] transition-all"
                      >
                        View Full History <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </>
                  ) : (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 text-[hsl(var(--kf-accent1))] animate-spin" />
                    </div>
                  )}
                </div>
              )}
            </div>

            {tab === "chat" && !profileMode && (
              <div className="px-4 py-3 border-t border-border/30">
                <div className="flex items-center gap-2 bg-muted/20 border border-border/30 rounded-xl px-3 py-1">
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    placeholder={currentModule && currentModule !== "cockpit" ? `Command ${(MODULE_LABELS[currentModule] || MODULE_LABELS.cockpit).label}...` : "What should I do for you?"}
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none py-2"
                    disabled={sending}
                  />
                  <button
                    onClick={() => handleSend()}
                    disabled={!input.trim() || sending}
                    className="p-2 rounded-lg text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))/0.1] transition-colors disabled:opacity-30"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center justify-center gap-1.5 mt-2">
                  <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground/40 border border-border/20">⌘J</kbd>
                  <span className="text-[9px] text-muted-foreground/30">to toggle</span>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
