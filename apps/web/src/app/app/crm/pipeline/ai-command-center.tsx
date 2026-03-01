"use client";

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Send, Loader2, CheckCircle2, AlertTriangle,
  ListChecks, Shield, ChevronDown, ChevronRight, Play,
  Brain, Zap, Users, TrendingUp, Clock, Target,
  BookOpen, Save, X, RefreshCw,
} from "lucide-react";
import {
  aiAnalyzeContacts,
  aiExecuteTasks,
  fetchAiGuidelines,
  saveAiGuidelines,
  type AiAnalysisResult,
  type AiSuggestedAction,
  type AiAutomatedTask,
} from "@/lib/client";

interface AiCommandCenterProps {
  businessId: string | null;
  contactCount: number;
}

const QUICK_PROMPTS = [
  { icon: Target, label: "Pipeline Health", prompt: "Analyze my pipeline health. What's my conversion rate, which stages have bottlenecks, and what should I focus on?" },
  { icon: Users, label: "Needs Attention", prompt: "Which clients need immediate attention? Look at overdue tasks, unpaid invoices, and stale interactions." },
  { icon: TrendingUp, label: "Revenue Tips", prompt: "Give me revenue optimization suggestions. Which contacts have the most potential and what actions should I take?" },
  { icon: AlertTriangle, label: "At-Risk Clients", prompt: "Identify at-risk clients who might churn. What are the warning signs and what can I do to retain them?" },
  { icon: Clock, label: "Follow-up Tasks", prompt: "Generate follow-up tasks for all stale leads and contacts that haven't been contacted in over 30 days." },
];

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  urgent: { bg: "bg-red-500/15 border-red-500/30", text: "text-red-400" },
  high: { bg: "bg-orange-500/15 border-orange-500/30", text: "text-orange-400" },
  medium: { bg: "bg-blue-500/15 border-blue-500/30", text: "text-blue-400" },
  low: { bg: "bg-emerald-500/15 border-emerald-500/30", text: "text-emerald-400" },
};

const TASK_PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  HIGH: { bg: "bg-orange-500/15 border-orange-500/30", text: "text-orange-400" },
  NORMAL: { bg: "bg-blue-500/15 border-blue-500/30", text: "text-blue-400" },
  LOW: { bg: "bg-emerald-500/15 border-emerald-500/30", text: "text-emerald-400" },
};

function SuggestedActionCard({ action }: { action: AiSuggestedAction }) {
  const style = PRIORITY_STYLES[action.priority] ?? PRIORITY_STYLES.medium;
  return (
    <div className="rounded-xl border border-border/40 bg-white/[0.02] p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground/90 leading-snug">{action.title}</p>
        <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${style.bg} ${style.text}`}>
          {action.priority}
        </span>
      </div>
      <p className="text-xs text-muted-foreground/70 leading-relaxed">{action.description}</p>
      {action.contactName && (
        <p className="text-[10px] text-muted-foreground/50">
          Contact: {action.contactName}
        </p>
      )}
    </div>
  );
}

function AutomatedTaskCard({ task, index }: { task: AiAutomatedTask; index: number }) {
  const style = TASK_PRIORITY_STYLES[task.priority] ?? TASK_PRIORITY_STYLES.NORMAL;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-white/[0.02] p-3">
      <div className="w-6 h-6 rounded-lg bg-white/[0.05] flex items-center justify-center text-[10px] font-semibold text-muted-foreground/60 shrink-0">
        {index + 1}
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground/90 truncate">{task.title}</p>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
          {task.contactName && <span>{task.contactName}</span>}
          {task.dueDate && (
            <>
              <span>·</span>
              <span>Due {new Date(task.dueDate).toLocaleDateString("en-TT", { month: "short", day: "numeric" })}</span>
            </>
          )}
        </div>
      </div>
      <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${style.bg} ${style.text}`}>
        {task.priority}
      </span>
    </div>
  );
}

function GuidelinesPanel({
  businessId,
}: {
  businessId: string;
}) {
  const [guidelines, setGuidelines] = useState<string[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<string[]>([]);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    (async () => {
      setLoading(true);
      const res = await fetchAiGuidelines(businessId);
      if (res.data) {
        setGuidelines(res.data.guidelines);
        setGeneratedAt(res.data.generatedAt);
      }
      setLoading(false);
    })();
  }, [businessId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    await saveAiGuidelines(businessId, editDraft);
    setGuidelines(editDraft);
    setGeneratedAt(new Date().toISOString());
    setEditing(false);
    setSaving(false);
  }, [businessId, editDraft]);

  const handleStartEdit = useCallback(() => {
    setEditDraft([...guidelines]);
    setEditing(true);
  }, [guidelines]);

  const handleRemoveGuideline = useCallback((idx: number) => {
    setEditDraft((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleAddGuideline = useCallback(() => {
    setEditDraft((prev) => [...prev, ""]);
  }, []);

  const handleChangeGuideline = useCallback((idx: number, val: string) => {
    setEditDraft((prev) => prev.map((g, i) => (i === idx ? val : g)));
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-muted-foreground/50" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Business Guidelines</span>
        </div>
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-muted-foreground/50" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Business Guidelines</span>
        </div>
        {guidelines.length > 0 && !editing && (
          <button
            onClick={handleStartEdit}
            className="text-[10px] text-accent hover:text-accent/80 transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          {editDraft.map((g, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={g}
                onChange={(e) => handleChangeGuideline(i, e.target.value)}
                className="flex-1 bg-white/[0.03] border border-border/40 rounded-lg px-3 py-1.5 text-xs text-foreground/80 focus:outline-none focus:border-accent/50"
              />
              <button onClick={() => handleRemoveGuideline(i)} className="text-muted-foreground/40 hover:text-red-400 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={handleAddGuideline} className="text-[10px] text-accent hover:text-accent/80 transition-colors">+ Add guideline</button>
            <div className="flex-1" />
            <button onClick={() => setEditing(false)} className="text-[10px] text-muted-foreground/50 hover:text-foreground/70 transition-colors px-2 py-1">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-[10px] font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors px-3 py-1 rounded-lg flex items-center gap-1 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
          </div>
        </div>
      ) : guidelines.length > 0 ? (
        <div className="space-y-2">
          {guidelines.map((g, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-foreground/70 leading-relaxed">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/60 shrink-0 mt-0.5" />
              <span>{g}</span>
            </div>
          ))}
          {generatedAt && (
            <p className="text-[10px] text-muted-foreground/40 pt-1">
              Updated {new Date(generatedAt).toLocaleDateString("en-TT", { month: "short", day: "numeric", year: "numeric" })}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center py-4 text-center">
          <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center mb-2">
            <BookOpen className="w-4 h-4 text-muted-foreground/30" />
          </div>
          <p className="text-xs text-muted-foreground/50">AI-generated guidelines will appear here after analysis</p>
        </div>
      )}
    </div>
  );
}

function AiCommandCenterInner({ businessId, contactCount }: AiCommandCenterProps) {
  const [prompt, setPrompt] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AiAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executeResult, setExecuteResult] = useState<{ created: number; failed: number } | null>(null);
  const [showActions, setShowActions] = useState(true);
  const [showTasks, setShowTasks] = useState(true);
  const [savingGuidelines, setSavingGuidelines] = useState(false);
  const [guidelinesSaved, setGuidelinesSaved] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleAnalyze = useCallback(async (customPrompt?: string) => {
    if (!businessId) return;
    const p = customPrompt ?? prompt;
    if (!p.trim()) return;

    setAnalyzing(true);
    setError(null);
    setResult(null);
    setExecuteResult(null);
    setGuidelinesSaved(false);

    const res = await aiAnalyzeContacts(businessId, p.trim());
    setAnalyzing(false);

    if (res.error) {
      setError(res.error);
      return;
    }

    if (res.data) {
      setResult(res.data);
      setShowActions(true);
      setShowTasks(true);
    }
  }, [businessId, prompt]);

  const handleExecuteTasks = useCallback(async () => {
    if (!businessId || !result?.automatedTasks?.length) return;
    setExecuting(true);
    const res = await aiExecuteTasks(businessId, result.automatedTasks);
    setExecuting(false);
    if (res.data) {
      setExecuteResult(res.data);
    } else if (res.error) {
      setError(res.error);
    }
  }, [businessId, result]);

  const handleSaveGuidelines = useCallback(async () => {
    if (!businessId || !result?.guidelines?.length) return;
    setSavingGuidelines(true);
    await saveAiGuidelines(businessId, result.guidelines);
    setSavingGuidelines(false);
    setGuidelinesSaved(true);
  }, [businessId, result]);

  const handleQuickPrompt = useCallback((p: string) => {
    setPrompt(p);
    handleAnalyze(p);
  }, [handleAnalyze]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAnalyze();
    }
  }, [handleAnalyze]);

  const hasActions = result?.suggestedActions && result.suggestedActions.length > 0;
  const hasTasks = result?.automatedTasks && result.automatedTasks.length > 0;
  const hasGuidelines = result?.guidelines && result.guidelines.length > 0;

  if (!businessId) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/50 bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center border border-violet-500/20">
            <Brain className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground/90">AI Analyst</h3>
            <p className="text-[10px] text-muted-foreground/50">Ask questions about your {contactCount} contacts</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {QUICK_PROMPTS.map((qp) => (
            <button
              key={qp.label}
              onClick={() => handleQuickPrompt(qp.prompt)}
              disabled={analyzing}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border/40 bg-white/[0.02] text-[10px] font-medium text-foreground/70 hover:bg-white/[0.05] hover:border-border/60 transition-all disabled:opacity-50"
            >
              <qp.icon className="w-3 h-3 text-muted-foreground/60" />
              {qp.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your contacts, pipeline, revenue..."
            rows={2}
            className="w-full bg-white/[0.03] border border-border/40 rounded-xl px-4 py-3 pr-12 text-sm text-foreground/80 placeholder:text-muted-foreground/30 focus:outline-none focus:border-accent/50 resize-none"
          />
          <button
            onClick={() => handleAnalyze()}
            disabled={analyzing || !prompt.trim()}
            className="absolute right-2 bottom-2.5 w-8 h-8 rounded-lg bg-accent/15 hover:bg-accent/25 flex items-center justify-center transition-colors disabled:opacity-30"
          >
            {analyzing ? (
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
            ) : (
              <Send className="w-4 h-4 text-accent" />
            )}
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {analyzing && (
          <motion.div
            key="analyzing"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-2xl border border-border/50 bg-card p-6"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground/80">Analyzing your CRM data...</p>
                <p className="text-[10px] text-muted-foreground/50">Building context from contacts, revenue, tasks, and interactions</p>
              </div>
            </div>
          </motion.div>
        )}

        {error && !analyzing && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">Analysis failed</p>
                <p className="text-xs text-red-400/60 mt-1">{error}</p>
              </div>
            </div>
          </motion.div>
        )}

        {result && !analyzing && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-3"
          >
            <div className="rounded-2xl border border-border/50 bg-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-violet-400" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Analysis</span>
              </div>
              <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">
                {result.analysis}
              </div>
            </div>

            {hasActions && (
              <div className="rounded-2xl border border-border/50 bg-card p-5">
                <button
                  onClick={() => setShowActions((p) => !p)}
                  className="flex items-center gap-2 w-full text-left mb-3"
                >
                  {showActions ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />}
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                    Suggested Actions ({result.suggestedActions.length})
                  </span>
                </button>
                {showActions && (
                  <div className="space-y-2">
                    {result.suggestedActions.map((action, i) => (
                      <SuggestedActionCard key={i} action={action} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {hasTasks && (
              <div className="rounded-2xl border border-border/50 bg-card p-5">
                <button
                  onClick={() => setShowTasks((p) => !p)}
                  className="flex items-center gap-2 w-full text-left mb-3"
                >
                  {showTasks ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />}
                  <ListChecks className="w-4 h-4 text-blue-400" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                    Auto-Generated Tasks ({result.automatedTasks.length})
                  </span>
                </button>
                {showTasks && (
                  <div className="space-y-2">
                    {result.automatedTasks.map((task, i) => (
                      <AutomatedTaskCard key={i} task={task} index={i} />
                    ))}
                    <div className="pt-2">
                      {executeResult ? (
                        <div className="flex items-center gap-2 text-xs">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span className="text-emerald-400/80">
                            {executeResult.created} task{executeResult.created !== 1 ? "s" : ""} created
                            {executeResult.failed > 0 && `, ${executeResult.failed} failed`}
                          </span>
                        </div>
                      ) : (
                        <button
                          onClick={handleExecuteTasks}
                          disabled={executing}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-accent/15 to-accent/5 border border-accent/20 text-sm font-medium text-accent hover:from-accent/25 hover:to-accent/10 transition-all disabled:opacity-50"
                        >
                          {executing ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                          Execute All Tasks
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {hasGuidelines && (
              <div className="rounded-2xl border border-border/50 bg-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                      AI Guidelines ({result.guidelines.length})
                    </span>
                  </div>
                  {guidelinesSaved ? (
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Saved
                    </span>
                  ) : (
                    <button
                      onClick={handleSaveGuidelines}
                      disabled={savingGuidelines}
                      className="text-[10px] font-medium text-accent hover:text-accent/80 transition-colors flex items-center gap-1 disabled:opacity-50"
                    >
                      {savingGuidelines ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Save Guidelines
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {result.guidelines.map((g, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-foreground/70 leading-relaxed">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/60 shrink-0 mt-0.5" />
                      <span>{g}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <GuidelinesPanel businessId={businessId} />
    </div>
  );
}

export const AiCommandCenter = React.memo(AiCommandCenterInner);
