"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Sparkles, AlertTriangle, Tag, ListPlus,
  CheckCircle, Minus, TrendingDown, Zap, X,
} from "lucide-react";
import { aiNoteAnalysis, type AiNoteAnalysis } from "@/lib/client";

interface AiNoteIntelligenceProps {
  contactId: string;
  noteBody: string;
  noteId?: string;
  onCreateTask?: (title: string, options?: { priority?: string; dueDate?: string }) => Promise<void>;
  onAddTags?: (tags: string[]) => void;
  onClose?: () => void;
}

const SENTIMENT_BADGE = {
  positive: { icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Positive" },
  neutral: { icon: Minus, color: "text-blue-400", bg: "bg-blue-500/10", label: "Neutral" },
  negative: { icon: TrendingDown, color: "text-red-400", bg: "bg-red-500/10", label: "Negative" },
  urgent: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", label: "Urgent" },
};

export function AiNoteIntelligence({ contactId, noteBody, noteId, onCreateTask, onAddTags, onClose }: AiNoteIntelligenceProps) {
  const [data, setData] = useState<AiNoteAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [createdTasks, setCreatedTasks] = useState<Set<number>>(new Set());

  const analyze = async () => {
    if (!noteBody.trim()) return;
    setLoading(true);
    try {
      const result = await aiNoteAnalysis(contactId, noteBody, noteId);
      if (result.data) {
        setData(result.data);
      } else {
        toast.error(result.error ?? "Failed to analyze note");
      }
    } catch {
      toast.error("Failed to analyze note");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (item: { title: string; priority: string; dueInDays: number }, index: number) => {
    if (!onCreateTask) return;
    const dueDate = new Date(Date.now() + item.dueInDays * 86400000).toISOString();
    try {
      await onCreateTask(item.title, { priority: item.priority, dueDate });
      setCreatedTasks(prev => new Set(prev).add(index));
      toast.success("Task created");
    } catch {
      toast.error("Failed to create task");
    }
  };

  if (!data && !loading) {
    return (
      <button
        onClick={analyze}
        disabled={!noteBody.trim()}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium text-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/5 hover:bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/20 transition-colors disabled:opacity-40"
      >
        <Sparkles className="w-3 h-3" />
        Analyze
      </button>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] text-muted-foreground bg-white/5">
        <Sparkles className="w-3 h-3 animate-pulse" />
        Analyzing...
      </div>
    );
  }

  if (!data) return null;

  const sentiment = SENTIMENT_BADGE[data.sentiment] ?? SENTIMENT_BADGE.neutral;
  const SentimentIcon = sentiment.icon;

  return (
    <div className="rounded-lg border border-[hsl(var(--kf-accent1))]/20 bg-[hsl(var(--kf-accent1))]/[0.03] p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
          <span className="text-[10px] font-semibold text-[hsl(var(--kf-accent1))] uppercase tracking-wider">AI Analysis</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${sentiment.bg} ${sentiment.color}`}>
            <SentimentIcon className="w-2.5 h-2.5" /> {sentiment.label}
          </span>
          {onClose && (
            <button onClick={onClose} className="p-0.5 rounded hover:bg-white/10">
              <X className="w-3 h-3 text-muted-foreground/50" />
            </button>
          )}
        </div>
      </div>

      <p className="text-[11px] text-foreground/80 leading-relaxed">{data.summary}</p>

      {data.riskFlags.length > 0 && (
        <div className="space-y-1">
          {data.riskFlags.map((flag, i) => (
            <div key={i} className="flex gap-1.5 items-start">
              <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
              <span className="text-[10px] text-amber-300/90">{flag}</span>
            </div>
          ))}
        </div>
      )}

      {data.actionItems.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground/70">Action Items</span>
          {data.actionItems.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-md bg-white/[0.03] px-2 py-1">
              <ListPlus className="w-3 h-3 text-muted-foreground/60 shrink-0" />
              <span className="text-[10px] text-foreground/80 flex-1">{item.title}</span>
              <span className="text-[9px] text-muted-foreground/50">{item.dueInDays}d</span>
              {createdTasks.has(i) ? (
                <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
              ) : onCreateTask ? (
                <button
                  onClick={() => handleCreateTask(item, i)}
                  className="text-[9px] font-medium text-[hsl(var(--kf-accent1))] hover:underline shrink-0"
                >
                  Create
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {data.suggestedTags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <Tag className="w-3 h-3 text-muted-foreground/50" />
          {data.suggestedTags.map((tag, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-muted-foreground/80">{tag}</span>
          ))}
          {onAddTags && data.suggestedTags.length > 0 && (
            <button
              onClick={() => onAddTags(data.suggestedTags)}
              className="text-[9px] text-[hsl(var(--kf-accent1))] hover:underline ml-1"
            >
              Apply all
            </button>
          )}
        </div>
      )}

      {data.keyEntities.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <Zap className="w-3 h-3 text-muted-foreground/50" />
          {data.keyEntities.map((entity, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300/80">{entity}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function AiNoteAnalyzeButton({
  contactId,
  noteBody,
  noteId,
  onCreateTask,
}: {
  contactId: string;
  noteBody: string;
  noteId?: string;
  onCreateTask?: (title: string, options?: { priority?: string; dueDate?: string }) => Promise<void>;
}) {
  const [showAnalysis, setShowAnalysis] = useState(false);

  if (showAnalysis) {
    return (
      <AiNoteIntelligence
        contactId={contactId}
        noteBody={noteBody}
        noteId={noteId}
        onCreateTask={onCreateTask}
        onClose={() => setShowAnalysis(false)}
      />
    );
  }

  return (
    <button
      onClick={() => setShowAnalysis(true)}
      disabled={!noteBody.trim()}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[hsl(var(--kf-accent1))]/70 hover:text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/5 transition-colors disabled:opacity-30"
      title="Analyze note with AI"
    >
      <Sparkles className="w-3 h-3" />
    </button>
  );
}
