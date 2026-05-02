"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Tags,
  RefreshCw,
  Plus,
  Check,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Info,
} from "lucide-react";
import { aiSuggestTags, updateContact, type AiTagSuggestion } from "@/lib/client";

interface AiTagSuggestionsProps {
  contactId: string;
  currentTags?: string[];
  onTagsUpdated?: (tags: string[]) => void;
}

function confidenceColor(c: number) {
  if (c >= 0.8) return "text-emerald-400";
  if (c >= 0.6) return "text-blue-400";
  if (c >= 0.4) return "text-amber-400";
  return "text-muted-foreground";
}

function confidenceBg(c: number) {
  if (c >= 0.8) return "bg-emerald-500/10";
  if (c >= 0.6) return "bg-blue-500/10";
  if (c >= 0.4) return "bg-amber-500/10";
  return "bg-white/5";
}

export function AiTagSuggestionsPanel({ contactId, currentTags = [], onTagsUpdated }: AiTagSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<AiTagSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [appliedTags, setAppliedTags] = useState<Set<string>>(new Set());
  const [applyingTag, setApplyingTag] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    try {
      const result = await aiSuggestTags(contactId);
      if (result.data) {
        setSuggestions(result.data.suggestedTags);
        setAppliedTags(new Set());
        setExpanded(true);
      } else {
        toast.error(result.error ?? "Failed to generate tag suggestions");
      }
    } catch {
      toast.error("Failed to generate AI tags");
    } finally {
      setLoading(false);
    }
  };

  const applyTag = async (tag: string) => {
    setApplyingTag(tag);
    try {
      const newTags = [...new Set([...currentTags, tag])];
      const result = await updateContact({ contactId, tags: newTags });
      if (result.data) {
        setAppliedTags(prev => new Set([...prev, tag]));
        onTagsUpdated?.(newTags);
        toast.success(`Tag "${tag}" applied`);
      } else {
        toast.error(result.error ?? "Failed to apply tag");
      }
    } catch {
      toast.error("Failed to apply tag");
    } finally {
      setApplyingTag(null);
    }
  };

  const applyAll = async () => {
    const tagsToApply = suggestions
      .filter(s => !appliedTags.has(s.tag) && !currentTags.includes(s.tag))
      .map(s => s.tag);
    if (tagsToApply.length === 0) return;

    setApplyingTag("__all__");
    try {
      const newTags = [...new Set([...currentTags, ...tagsToApply])];
      const result = await updateContact({ contactId, tags: newTags });
      if (result.data) {
        setAppliedTags(new Set(tagsToApply));
        onTagsUpdated?.(newTags);
        toast.success(`${tagsToApply.length} tags applied`);
      } else {
        toast.error(result.error ?? "Failed to apply tags");
      }
    } catch {
      toast.error("Failed to apply tags");
    } finally {
      setApplyingTag(null);
    }
  };

  const unappliedCount = suggestions.filter(
    s => !appliedTags.has(s.tag) && !currentTags.includes(s.tag)
  ).length;

  return (
    <div className="rounded-xl border border-border/30 bg-white/[0.02] overflow-hidden">
      <button
        onClick={suggestions.length > 0 ? () => setExpanded(!expanded) : generate}
        disabled={loading}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-white/[0.03] transition-colors"
      >
        <Tags className="w-4 h-4 text-violet-400 shrink-0" />
        <span className="font-medium text-foreground/90">AI Tag Suggestions</span>
        {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground ml-auto" />}
        {!loading && suggestions.length === 0 && (
          <span className="ml-auto text-xs text-violet-400 flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Generate
          </span>
        )}
        {!loading && suggestions.length > 0 && (
          <span className="ml-auto flex items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""}
            </span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </span>
        )}
      </button>

      {expanded && suggestions.length > 0 && (
        <div className="border-t border-border/20 px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={generate}
                disabled={loading}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
            {unappliedCount > 1 && (
              <button
                onClick={applyAll}
                disabled={applyingTag !== null}
                className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Apply All ({unappliedCount})
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            {suggestions.map((s) => {
              const isApplied = appliedTags.has(s.tag) || currentTags.includes(s.tag);
              const isApplying = applyingTag === s.tag || applyingTag === "__all__";

              return (
                <div
                  key={s.tag}
                  className={`group flex items-start gap-2 rounded-lg px-2.5 py-2 transition-colors ${
                    isApplied ? "bg-emerald-500/5" : "bg-white/[0.02] hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${confidenceBg(s.confidence)} ${confidenceColor(s.confidence)}`}>
                        {s.tag}
                      </span>
                      <span className={`text-[10px] ${confidenceColor(s.confidence)}`}>
                        {Math.round(s.confidence * 100)}%
                      </span>
                    </div>
                    {s.reasoning && (
                      <p className="text-[11px] text-muted-foreground mt-1 flex items-start gap-1">
                        <Info className="w-3 h-3 shrink-0 mt-0.5" />
                        <span>{s.reasoning}</span>
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => !isApplied && !isApplying && applyTag(s.tag)}
                    disabled={isApplied || isApplying}
                    className={`shrink-0 mt-0.5 rounded-md p-1 transition-colors ${
                      isApplied
                        ? "text-emerald-400 cursor-default"
                        : isApplying
                        ? "text-muted-foreground animate-pulse"
                        : "text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10"
                    }`}
                    title={isApplied ? "Applied" : "Apply tag"}
                  >
                    {isApplied ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
