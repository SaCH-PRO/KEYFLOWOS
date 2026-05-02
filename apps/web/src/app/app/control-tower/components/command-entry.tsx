"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Sparkles,
  Send,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Check,
  X,
  Play,
} from "lucide-react";
import {
  planAction,
  executeAction,
  type ActionPlanResponse,
  type ActionExecuteResponse,
} from "@/lib/client";

type PlanPreview = ActionPlanResponse & { input: string };

const TIER_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "Low risk", color: "hsl(var(--kf-success))" },
  2: { label: "Medium risk", color: "hsl(var(--kf-info))" },
  3: { label: "High risk", color: "hsl(var(--kf-warning))" },
  4: { label: "Critical risk", color: "hsl(var(--kf-error))" },
};

export function CommandEntry({
  businessId,
  onActionExecuted,
}: {
  businessId: string;
  onActionExecuted?: () => void;
}) {
  const [input, setInput] = useState("");
  const [planning, setPlanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePlan = useCallback(async () => {
    const text = input.trim();
    if (!text || !businessId) return;

    setPlanning(true);
    setPreview(null);
    try {
      const res = await planAction(businessId, text);
      if (res.data) {
        setPreview({ ...res.data, input: text });
      } else {
        toast.error("Could not understand that command");
      }
    } catch {
      toast.error("Failed to plan action");
    } finally {
      setPlanning(false);
    }
  }, [input, businessId]);

  const handleExecute = useCallback(async () => {
    if (!preview?.plan || !businessId) return;

    setExecuting(true);
    try {
      const steps = preview.plan.steps ?? [];
      let lastResult: ActionExecuteResponse | null = null;
      for (const step of steps) {
        if (!step.toolName) continue;
        const res = await executeAction(
          businessId,
          step.toolName,
          (step.inputPayload ?? {}) as Record<string, unknown>,
          preview.plan.id,
          step.id,
        );
        if (res.data) {
          lastResult = res.data;
          if (res.data.blocked) {
            toast.info(res.data.requiresApproval
              ? "Action queued for approval"
              : "Action was blocked by governance");
            break;
          }
        } else {
          toast.error(`Step "${step.toolName}" failed`);
          break;
        }
      }

      if (lastResult?.success) {
        toast.success("Action executed successfully");
        if (lastResult.followOnSuggestions?.length) {
          toast.info(`Suggestion: ${lastResult.followOnSuggestions[0]}`);
        }
        window.dispatchEvent(new CustomEvent("kf:action.executed"));
      } else if (lastResult?.blocked) {
        window.dispatchEvent(new CustomEvent("kf:action.blocked"));
      }

      setPreview(null);
      setInput("");
      onActionExecuted?.();
    } catch {
      toast.error("Execution failed");
    } finally {
      setExecuting(false);
    }
  }, [preview, businessId, onActionExecuted]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (preview) {
        handleExecute();
      } else {
        handlePlan();
      }
    }
    if (e.key === "Escape") {
      setPreview(null);
      setInput("");
    }
  };

  const riskInfo = preview?.riskAssessment;
  const tierCfg = TIER_LABELS[riskInfo?.maxTier ?? 1] ?? TIER_LABELS[1];

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all"
      style={{
        background: "hsl(var(--kf-muted) / 0.04)",
        border: "1px solid hsl(var(--kf-border) / 0.3)",
      }}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1) / 0.5)" }} />
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); if (preview) setPreview(null); }}
          onKeyDown={handleKeyDown}
          placeholder="Tell me what to do... (e.g. &quot;Follow up on overdue invoices&quot;)"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40 min-h-[36px]"
          style={{ color: "hsl(var(--kf-foreground))" }}
          disabled={planning || executing}
        />
        <button
          onClick={preview ? handleExecute : handlePlan}
          disabled={!input.trim() || planning || executing}
          className="flex items-center justify-center w-8 h-8 rounded-lg transition-all hover:opacity-80 disabled:opacity-30 min-w-[32px] min-h-[32px]"
          style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
          aria-label={preview ? "Execute action" : "Plan action"}
        >
          {planning || executing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : preview ? (
            <Play className="w-3.5 h-3.5" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      <AnimatePresence>
        {preview && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="px-4 py-3 space-y-2"
              style={{ borderTop: "1px solid hsl(var(--kf-border) / 0.15)" }}
            >
              {preview.clarificationNeeded && (
                <div
                  className="flex items-center gap-2 rounded-lg px-3 py-2"
                  style={{ background: "hsl(var(--kf-warning) / 0.08)" }}
                >
                  <AlertTriangle className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-warning))" }} />
                  <span className="text-[11px]" style={{ color: "hsl(var(--kf-warning))" }}>
                    Needs clarification — try being more specific
                  </span>
                </div>
              )}

              {preview.plan && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold" style={{ color: "hsl(var(--kf-foreground))" }}>
                        Plan: {preview.plan.steps?.length ?? 0} step{(preview.plan.steps?.length ?? 0) !== 1 ? "s" : ""}
                      </span>
                      {riskInfo && (
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                          style={{ background: `${tierCfg.color}15`, color: tierCfg.color }}
                        >
                          {tierCfg.label}
                        </span>
                      )}
                    </div>
                    {(preview.plan.steps?.length ?? 0) > 0 && (
                      <button
                        onClick={() => setShowSteps((v) => !v)}
                        className="text-[10px] flex items-center gap-1 min-h-[24px]"
                        style={{ color: "hsl(var(--kf-muted-foreground))" }}
                      >
                        {showSteps ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        Details
                      </button>
                    )}
                  </div>

                  {riskInfo && (
                    <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      {riskInfo.estimatedImpact}
                      {riskInfo.affectedModules?.length > 0 && (
                        <> — affects {riskInfo.affectedModules.join(", ")}</>
                      )}
                    </p>
                  )}

                  <AnimatePresence>
                    {showSteps && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="space-y-1 overflow-hidden"
                      >
                        {preview.plan.steps?.map((step, i) => (
                          <div
                            key={step.id ?? i}
                            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                            style={{ background: "hsl(var(--kf-muted) / 0.06)" }}
                          >
                            <span className="text-[9px] font-bold w-4 text-center" style={{ color: "hsl(var(--kf-muted-foreground) / 0.5)" }}>
                              {i + 1}
                            </span>
                            <span className="text-[10px] font-medium" style={{ color: "hsl(var(--kf-foreground))" }}>
                              {step.description ?? step.action ?? step.toolName}
                            </span>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={handleExecute}
                      disabled={executing}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80 min-h-[32px]"
                      style={{ background: "hsl(var(--kf-success) / 0.1)", color: "hsl(var(--kf-success))" }}
                    >
                      {executing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      {riskInfo?.requiresApproval ? "Submit for Approval" : "Execute"}
                    </button>
                    <button
                      onClick={() => { setPreview(null); setInput(""); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80 min-h-[32px]"
                      style={{ background: "hsl(var(--kf-muted) / 0.1)", color: "hsl(var(--kf-muted-foreground))" }}
                    >
                      <X className="w-3 h-3" />
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
