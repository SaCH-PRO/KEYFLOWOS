"use client";

import { useState, useRef } from "react";
import { Sparkles, ArrowRight, Loader2, X, Zap, CheckCircle } from "lucide-react";
import { AiBadge } from "@/components/ui/ai-badge";
import { aiGenerateFlow } from "@/lib/client";
import {
  AUTOMATION_TEMPLATES,
  getTriggerLabel,
  getActionLabel,
  type ActionStep,
} from "./automation-constants";

interface AiFlowGeneratorProps {
  businessId: string | null;
  onGenerated: (config: { name: string; triggerEvent: string; actions: ActionStep[]; conditions: string[] }) => void;
  onClose: () => void;
}

interface GeneratedFlow {
  name: string;
  triggerEvent: string;
  actions: ActionStep[];
  conditions: string[];
  reasoning: string;
}

function matchFlowFromPrompt(prompt: string): GeneratedFlow | null {
  const lower = prompt.toLowerCase();

  const triggerKeywords: { keywords: string[]; trigger: string }[] = [
    { keywords: ["new contact", "contact created", "new lead", "someone signs up", "new client"], trigger: "contact.created" },
    { keywords: ["invoice paid", "payment comes in", "gets paid", "invoice is paid"], trigger: "invoice.paid" },
    { keywords: ["invoice overdue", "overdue", "late payment", "unpaid invoice"], trigger: "invoice.overdue" },
    { keywords: ["booking confirm", "appointment confirm", "booking is confirmed"], trigger: "booking.confirmed" },
    { keywords: ["booking complet", "after appointment", "appointment done", "service completed", "booking done"], trigger: "booking.completed" },
    { keywords: ["booking cancel", "appointment cancel", "cancellation"], trigger: "booking.cancelled" },
    { keywords: ["form submit", "form fill", "someone fills", "lead form", "website form"], trigger: "form.submitted" },
    { keywords: ["quote sent", "send quote", "proposal sent"], trigger: "quote.sent" },
    { keywords: ["quote accept", "proposal accept"], trigger: "quote.accepted" },
    { keywords: ["inactive", "dormant", "hasn't booked", "no activity"], trigger: "contact.inactive" },
    { keywords: ["every day", "daily", "each morning", "every morning"], trigger: "schedule.daily" },
    { keywords: ["every week", "weekly", "each monday", "every monday"], trigger: "schedule.weekly" },
    { keywords: ["every month", "monthly", "first of the month", "each month"], trigger: "schedule.monthly" },
    { keywords: ["campaign sent", "email campaign", "newsletter"], trigger: "campaign.sent" },
    { keywords: ["new subscriber", "subscriber joins", "signs up for newsletter"], trigger: "subscriber.joined" },
    { keywords: ["payment received", "receives payment", "money comes in"], trigger: "payment.received" },
    { keywords: ["booking remind", "remind before", "24 hour", "reminder"], trigger: "booking.reminder" },
    { keywords: ["lead score", "hot lead", "score change"], trigger: "lead.scored" },
    { keywords: ["invoice sent", "sends invoice"], trigger: "invoice.sent" },
  ];

  const actionKeywords: { keywords: string[]; action: string; config?: Record<string, string> }[] = [
    { keywords: ["send email", "email them", "email notification", "send a email", "email the"], action: "send_email" },
    { keywords: ["whatsapp", "send whatsapp", "message on whatsapp"], action: "send_whatsapp" },
    { keywords: ["sms", "text message", "send text", "send sms"], action: "send_sms" },
    { keywords: ["notification", "notify me", "alert me", "send alert", "in-app"], action: "send_notification" },
    { keywords: ["notify staff", "tell the team", "alert staff"], action: "notify_staff" },
    { keywords: ["add tag", "tag them", "tag the contact", "label them"], action: "add_tag" },
    { keywords: ["create task", "make a task", "add task", "to-do", "todo", "follow-up task"], action: "create_task" },
    { keywords: ["move pipeline", "change stage", "update pipeline", "advance stage"], action: "move_pipeline" },
    { keywords: ["create invoice", "generate invoice", "make invoice"], action: "create_invoice" },
    { keywords: ["schedule follow", "follow up", "followup", "check in later"], action: "schedule_followup" },
    { keywords: ["wait", "delay", "after a while", "hours later"], action: "delay", config: { hours: "24" } },
    { keywords: ["review request", "ask for review", "get feedback", "request review"], action: "request_review" },
    { keywords: ["enroll campaign", "add to campaign", "nurture sequence"], action: "enroll_campaign" },
    { keywords: ["update contact", "update their profile", "change contact"], action: "update_contact" },
    { keywords: ["add note", "log a note", "write a note"], action: "add_note" },
    { keywords: ["assign staff", "assign team", "assign to"], action: "assign_staff" },
    { keywords: ["re-engage", "reengage", "win back", "reactivate"], action: "schedule_reengagement" },
  ];

  let bestTrigger: string | null = null;
  let bestTriggerScore = 0;
  for (const tk of triggerKeywords) {
    for (const kw of tk.keywords) {
      if (lower.includes(kw) && kw.length > bestTriggerScore) {
        bestTrigger = tk.trigger;
        bestTriggerScore = kw.length;
      }
    }
  }

  const matchedActions: ActionStep[] = [];
  const usedActions = new Set<string>();
  for (const ak of actionKeywords) {
    for (const kw of ak.keywords) {
      if (lower.includes(kw) && !usedActions.has(ak.action)) {
        usedActions.add(ak.action);
        matchedActions.push({ type: ak.action, config: ak.config });
      }
    }
  }

  if (!bestTrigger) {
    for (const t of AUTOMATION_TEMPLATES) {
      const templateTerms = [t.name.toLowerCase(), t.businessProblem.toLowerCase(), t.description.toLowerCase()];
      for (const term of templateTerms) {
        const words = term.split(/\s+/);
        const promptWords = lower.split(/\s+/);
        const overlap = words.filter((w) => promptWords.includes(w) && w.length > 3).length;
        if (overlap >= 2) {
          return {
            name: t.name,
            triggerEvent: t.trigger,
            actions: t.actions,
            conditions: [],
            reasoning: `Matched template "${t.name}" based on your description. ${t.expectedOutcome}`,
          };
        }
      }
    }
    return null;
  }

  if (matchedActions.length === 0) {
    if (lower.includes("email") || lower.includes("message") || lower.includes("notify")) {
      matchedActions.push({ type: "send_email" });
    } else {
      matchedActions.push({ type: "send_notification" });
    }
  }

  const triggerLabel = getTriggerLabel(bestTrigger);
  const actionLabels = matchedActions.map((a) => getActionLabel(a.type).toLowerCase());
  const nameWords = prompt.split(/\s+/).slice(0, 4).join(" ");
  const generatedName = nameWords.length > 3 ? nameWords.charAt(0).toUpperCase() + nameWords.slice(1) : `Auto: ${triggerLabel}`;

  return {
    name: generatedName.length > 40 ? generatedName.slice(0, 40) + "..." : generatedName,
    triggerEvent: bestTrigger,
    actions: matchedActions,
    conditions: [],
    reasoning: `When "${triggerLabel}" occurs, this flow will ${actionLabels.join(", then ")}. You can customize conditions and actions in the editor.`,
  };
}

export function AiFlowGenerator({ businessId, onGenerated, onClose }: AiFlowGeneratorProps) {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    setResult(null);

    if (businessId) {
      const aiRes = await aiGenerateFlow({ businessId, prompt: prompt.trim() });
      if (aiRes.data?.success && aiRes.data.flow) {
        const f = aiRes.data.flow;
        setResult({
          name: f.name,
          triggerEvent: f.triggerEvent,
          actions: f.actions.map((a) => ({ type: a.type, config: a.config })),
          conditions: f.conditions,
          reasoning: f.reasoning,
        });
        setGenerating(false);
        return;
      }
    }

    const flow = matchFlowFromPrompt(prompt);
    if (flow) {
      setResult(flow);
    } else {
      setError("I couldn't generate a flow from that description. Try being more specific — e.g. \"When a booking is cancelled, send them a follow-up email and tag as at-risk\"");
    }
    setGenerating(false);
  }

  function handleUse() {
    if (!result) return;
    onGenerated({
      name: result.name,
      triggerEvent: result.triggerEvent,
      actions: result.actions,
      conditions: result.conditions,
    });
    onClose();
  }

  const examples = [
    "When a new contact is created, send a welcome email and tag them",
    "After a booking is completed, wait 2 hours then request a review",
    "When an invoice goes overdue, create a follow-up task and notify me",
    "Every Monday, send me a business summary notification",
  ];

  return (
    <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "hsl(var(--kf-accent2) / 0.15)" }}>
            <Sparkles className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
          </div>
          <span className="text-sm font-semibold">Describe Your Flow</span>
          <AiBadge label="AI" compact />
        </div>
        <button
          onClick={onClose}
          className="min-w-[36px] min-h-[36px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-lg"
          aria-label="Close AI flow generator"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Describe what you want to automate in plain English. The AI will generate a flow configuration for you.
        </p>

        <div className="relative">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGenerate(); } }}
            placeholder="e.g. When a booking is cancelled, send a re-engagement email and tag the contact as at-risk..."
            rows={3}
            className="w-full rounded-xl border border-border/60 bg-input px-4 py-3 text-sm placeholder:text-muted-foreground/50 resize-none"
          />
          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="absolute right-2 bottom-2 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors min-h-[32px]"
            style={{
              background: prompt.trim() ? "hsl(var(--kf-accent2))" : "hsl(var(--muted) / 0.5)",
              color: prompt.trim() ? "hsl(var(--kf-accent2-foreground, 0 0% 100%))" : "hsl(var(--muted-foreground))",
              opacity: generating ? 0.6 : 1,
            }}
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
            {generating ? "Generating..." : "Generate"}
          </button>
        </div>

        {!result && !error && !generating && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Try these</p>
            <div className="flex flex-wrap gap-1.5">
              {examples.map((ex) => (
                <button
                  key={ex}
                  onClick={() => { setPrompt(ex); inputRef.current?.focus(); }}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg transition-colors min-h-[28px] text-left"
                  style={{ background: "hsl(var(--muted) / 0.3)", color: "hsl(var(--muted-foreground))" }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: "hsl(var(--kf-warning) / 0.08)", color: "hsl(var(--kf-warning))", border: "1px solid hsl(var(--kf-warning) / 0.2)" }}>
            {error}
          </div>
        )}

        {result && (
          <div className="rounded-xl border border-border/40 p-4 space-y-3" style={{ background: "hsl(var(--kf-success) / 0.03)" }}>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" style={{ color: "hsl(var(--kf-success))" }} />
              <span className="text-sm font-semibold">{result.name}</span>
            </div>

            <div className="rounded-lg p-2.5 space-y-1" style={{ background: "hsl(var(--muted) / 0.1)" }}>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "hsl(var(--kf-accent1))" }} />
                <span className="text-muted-foreground">Trigger:</span>
                <span className="font-medium">{getTriggerLabel(result.triggerEvent)}</span>
              </div>
              {result.conditions.length > 0 && result.conditions.map((c, i) => (
                <div key={`c-${i}`} className="flex items-center gap-2 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "hsl(var(--kf-warning))" }} />
                  <span className="text-muted-foreground">If:</span>
                  <span className="font-medium">{c.replace(/\./g, " ").replace(/^\w/, (s) => s.toUpperCase())}</span>
                </div>
              ))}
              {result.actions.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "hsl(var(--kf-success))" }} />
                  <span className="text-muted-foreground">{i === 0 ? "Then:" : "→"}</span>
                  <span className="font-medium">{getActionLabel(a.type)}</span>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed">{result.reasoning}</p>

            <div className="flex items-center gap-2">
              <button
                onClick={handleUse}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-xl transition-colors min-h-[36px]"
                style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground, 0 0% 100%))" }}
              >
                <Zap className="w-3.5 h-3.5" />
                Open in Editor
              </button>
              <button
                onClick={() => { setResult(null); setPrompt(""); }}
                className="text-xs font-medium px-3 py-2 rounded-xl transition-colors min-h-[36px] text-muted-foreground hover:text-foreground"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
