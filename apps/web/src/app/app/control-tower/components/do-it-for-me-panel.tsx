"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Wand2,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  User,
  MessageSquare,
  ArrowRight,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { apiPost } from "@/lib/api";
import { toast } from "sonner";

interface SuggestedAction {
  id: string;
  contactName: string;
  contactId: string;
  reason: string;
  suggestedMessage?: string;
  expectedValue?: number;
  actionType: "follow_up" | "invoice_reminder" | "booking_confirm" | "review_request" | "custom";
}

interface DoItForMeResponse {
  goal: string;
  findings: string[];
  actions: SuggestedAction[];
}

interface DoItForMePanelProps {
  businessId: string;
}

type KeyMode = "ask" | "do" | "plan" | "auto";

const MODE_META: Record<KeyMode, { label: string; desc: string; color: string }> = {
  ask: { label: "Ask", desc: "Get answers", color: "text-blue-400" },
  do: { label: "Do", desc: "Suggest actions", color: "text-violet-400" },
  plan: { label: "Plan", desc: "Show plan only", color: "text-amber-400" },
  auto: { label: "Auto", desc: "Execute low-risk", color: "text-emerald-400" },
};

export function DoItForMePanel({ businessId }: DoItForMePanelProps) {
  const router = useRouter();
  const [mode, setMode] = useState<KeyMode>("do");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DoItForMeResponse | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [approving, setApproving] = useState<Record<string, boolean>>({});

  const handleSubmit = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await apiPost<DoItForMeResponse>({
        path: `/ai/businesses/${encodeURIComponent(businessId)}/key/command`,
        body: { rawInput: input.trim(), inputMode: "TEXT", mode },
      });
      if (res.data) {
        setResult(res.data);
      } else {
        toast.error("KEY couldn't process that request");
      }
    } catch {
      toast.error("Failed to process command");
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (action: SuggestedAction) => {
    setApproving((p) => ({ ...p, [action.id]: true }));
    try {
      await apiPost({
        path: `/ai/businesses/${encodeURIComponent(businessId)}/key/command`,
        body: {
          rawInput: `Execute: ${action.actionType} for ${action.contactName}`,
          inputMode: "TEXT",
        },
      });
      toast.success(`Action executed for ${action.contactName}`);
      setResult((prev) =>
        prev
          ? {
              ...prev,
              actions: prev.actions.filter((a) => a.id !== action.id),
            }
          : null
      );
    } catch {
      toast.error("Failed to execute action");
    } finally {
      setApproving((p) => ({ ...p, [action.id]: false }));
    }
  };

  const handleApproveAll = async () => {
    if (!result?.actions.length) return;
    setLoading(true);
    try {
      await apiPost({
        path: `/ai/businesses/${encodeURIComponent(businessId)}/key/command`,
        body: {
          rawInput: `Execute all pending actions: ${result.goal}`,
          inputMode: "TEXT",
        },
      });
      toast.success("All actions executed");
      setResult((prev) => (prev ? { ...prev, actions: [] } : null));
    } catch {
      toast.error("Failed to execute all actions");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
        <Wand2 className="w-4 h-4 text-violet-400" />
        <div className="flex items-center gap-1 ml-auto">
          {(Object.keys(MODE_META) as KeyMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              title={MODE_META[m].desc}
              className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all ${
                mode === m
                  ? "bg-white/10 text-foreground border border-white/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
              }`}
            >
              {MODE_META[m].label}
            </button>
          ))}
        </div>
        <h3 className="text-sm font-semibold">Do It For Me</h3>
        <span className="text-[10px] text-muted-foreground">Ask KEY to handle tasks</span>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder='e.g. "Clean up my follow-ups" or "Send invoice reminders"'
              className="w-full h-9 px-3 pr-9 rounded-lg border border-border/50 bg-background text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Sparkles className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          </div>
          <button
            onClick={handleSubmit}
            disabled={loading || !input.trim()}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            <span>Ask KEY</span>
          </button>
        </div>

        {result && (
          <div className="space-y-3">
            {result.goal && (
              <div className="text-xs">
                <span className="font-medium text-foreground">Goal:</span>{" "}
                <span className="text-muted-foreground">{result.goal}</span>
              </div>
            )}

            {result.findings && result.findings.length > 0 && (
              <div className="rounded-lg border border-border/30 bg-muted/20 p-3">
                <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Findings
                </h4>
                <ul className="space-y-1">
                  {result.findings.map((f, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <span className="text-primary mt-0.5">•</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.actions && result.actions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Suggested Actions ({result.actions.length})
                  </h4>
                  <button
                    onClick={handleApproveAll}
                    disabled={loading}
                    className="text-[10px] font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                  >
                    Approve All
                  </button>
                </div>

                {result.actions.map((action) => (
                  <div
                    key={action.id}
                    className="rounded-lg border border-border/40 bg-background/50 overflow-hidden"
                  >
                    <button
                      onClick={() =>
                        setExpanded((p) => ({ ...p, [action.id]: !p[action.id] }))
                      }
                      className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/20 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">{action.contactName}</span>
                        <span className="text-[10px] text-muted-foreground">{action.reason}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {action.expectedValue !== undefined && action.expectedValue > 0 && (
                          <span className="text-[10px] text-emerald-500 font-medium">
                            {action.expectedValue >= 1000
                              ? `$${(action.expectedValue / 1000).toFixed(1)}k`
                              : `$${action.expectedValue}`}
                          </span>
                        )}
                        {expanded[action.id] ? (
                          <ChevronUp className="w-3 h-3 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-muted-foreground" />
                        )}
                      </div>
                    </button>

                    {expanded[action.id] && (
                      <div className="px-3 pb-3 space-y-2">
                        {action.suggestedMessage && (
                          <div className="rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
                            <MessageSquare className="w-3 h-3 inline mr-1 text-muted-foreground/70" />
                            {action.suggestedMessage}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleApprove(action)}
                            disabled={approving[action.id]}
                            className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-md bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                          >
                            {approving[action.id] ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                            Do It
                          </button>
                          <button
                            onClick={() =>
                              router.push(`/app/crm/contacts/${action.contactId}`)
                            }
                            className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                          >
                            <ArrowRight className="w-3 h-3" />
                            Review
                          </button>
                          <button
                            onClick={() =>
                              setResult((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      actions: prev.actions.filter((a) => a.id !== action.id),
                                    }
                                  : null
                              )
                            }
                            className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <XCircle className="w-3 h-3" />
                            Skip
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {result.actions && result.actions.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-2">
                All caught up — no actions needed right now.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
