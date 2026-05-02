"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Brain,
  Zap,
  MessageSquare,
  TrendingUp,
  Copy,
  Check,
  RefreshCw,
  ChevronDown,
  Send,
  Lightbulb,
} from "lucide-react";

export interface AiInsight {
  summary: string;
  nextBestAction: string;
  reasoning?: string;
  confidence: number;
  suggestedMessage?: string;
  tags?: string[];
}

interface AiCopilotProps {
  contactName: string;
  insight?: AiInsight | null;
  isLoading?: boolean;
  onGenerateInsight?: () => Promise<void>;
  onSendSuggestion?: (message: string) => Promise<void>;
}

export function AiCopilot({
  contactName,
  insight,
  isLoading,
  onGenerateInsight,
  onSendSuggestion,
}: AiCopilotProps) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);

  const copyMessage = useCallback(() => {
    const suggestedMessage = insight?.suggestedMessage;
    if (suggestedMessage) {
      navigator.clipboard.writeText(suggestedMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [insight]);

  const handleSend = useCallback(async () => {
    const suggestedMessage = insight?.suggestedMessage;
    if (!suggestedMessage || !onSendSuggestion) return;
    setSending(true);
    await onSendSuggestion(suggestedMessage);
    setSending(false);
  }, [insight, onSendSuggestion]);

  const confidenceLabel = insight?.confidence
    ? insight.confidence >= 80
      ? "High confidence"
      : insight.confidence >= 50
      ? "Medium confidence"
      : "Low confidence"
    : null;

  const confidenceColor = insight?.confidence
    ? insight.confidence >= 80
      ? "hsl(142 76% 36%)"
      : insight.confidence >= 50
      ? "hsl(var(--kf-accent2))"
      : "hsl(var(--kf-accent1))"
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card overflow-hidden"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20">
            <Brain className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
          </div>
          <div className="text-left">
            <div className="font-semibold flex items-center gap-2">
              AI Copilot
              <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
            </div>
            <div className="text-xs text-muted-foreground">
              Smart insights for {contactName}
            </div>
          </div>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border"
          >
            <div className="p-4 space-y-4">
              {!insight && !isLoading && (
                <div className="text-center py-6">
                  <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <Lightbulb className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Generate AI insights to understand this contact better
                  </p>
                  <button
                    onClick={onGenerateInsight}
                    className="kf-btn-primary inline-flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    Generate Insights
                  </button>
                </div>
              )}

              {isLoading && (
                <div className="flex items-center justify-center py-8">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Brain className="w-8 h-8 text-[hsl(var(--kf-accent1))]" />
                      <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent2))] absolute -top-1 -right-1 animate-pulse" />
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Analyzing contact data...
                    </div>
                  </div>
                </div>
              )}

              {insight && !isLoading && (
                <>
                  <div className="p-4 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/5 to-[hsl(var(--kf-accent2))]/5 border border-[hsl(var(--kf-accent1))]/20 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium text-[hsl(var(--kf-accent1))] flex items-center gap-1 mb-1">
                          <TrendingUp className="w-3 h-3" />
                          AI Summary
                        </div>
                        <p className="text-sm">{insight.summary}</p>
                      </div>
                      {confidenceLabel && confidenceColor && (
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{ background: `${confidenceColor}20`, color: confidenceColor }}
                        >
                          {confidenceLabel}
                        </span>
                      )}
                    </div>

                    {insight.reasoning && (
                      <p className="text-xs text-muted-foreground italic">
                        {insight.reasoning}
                      </p>
                    )}
                  </div>

                  <div className="p-4 rounded-xl bg-[hsl(var(--kf-accent2))]/10 border border-[hsl(var(--kf-accent2))]/20 space-y-2">
                    <div className="text-xs font-medium text-[hsl(var(--kf-accent2))] flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      Next Best Action
                    </div>
                    <p className="text-sm font-medium">{insight.nextBestAction}</p>
                  </div>

                  {insight.suggestedMessage && (
                    <div className="p-4 rounded-xl bg-muted/30 border border-border space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          Suggested Message
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={copyMessage}
                            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                            title="Copy message"
                          >
                            {copied ? (
                              <Check className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
                            ) : (
                              <Copy className="w-4 h-4 text-muted-foreground" />
                            )}
                          </button>
                        </div>
                      </div>
                      <p className="text-sm italic border-l-2 border-[hsl(var(--kf-accent1))] pl-3">
                        &quot;{insight.suggestedMessage}&quot;
                      </p>
                      {onSendSuggestion && (
                        <button
                          onClick={handleSend}
                          disabled={sending}
                          className="w-full kf-btn-primary flex items-center justify-center gap-2"
                        >
                          <Send className="w-4 h-4" />
                          {sending ? "Sending..." : "Send This Message"}
                        </button>
                      )}
                    </div>
                  )}

                  {insight.tags && insight.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {insight.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={onGenerateInsight}
                    className="w-full flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Regenerate Insights
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
