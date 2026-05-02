"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Sparkles,
  Copy,
  Check,
  AlertCircle,
  Heart,
  DollarSign,
  Target,
  User,
  RefreshCw,
} from "lucide-react";

export interface ConversationContextData {
  lastDiscussed?: string;
  concerns?: string[];
  preferences?: string[];
  decisionMaker?: string;
  budgetRange?: { min: number; max: number };
  suggestedOpening?: string;
  sentiment?: "positive" | "neutral" | "negative";
  engagementLevel?: "high" | "medium" | "low";
}

interface ConversationContextProps {
  data: ConversationContextData;
  contactName: string;
  onRefresh?: () => Promise<void>;
  isLoading?: boolean;
}

export function ConversationContext({
  data,
  contactName,
  onRefresh,
  isLoading,
}: ConversationContextProps) {
  const [copied, setCopied] = useState(false);

  const copyOpening = () => {
    if (data.suggestedOpening) {
      navigator.clipboard.writeText(data.suggestedOpening);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const sentimentConfig = {
    positive: { label: "Positive", color: "hsl(142 76% 36%)", icon: Heart },
    neutral: { label: "Neutral", color: "hsl(var(--kf-accent2))", icon: User },
    negative: { label: "Needs Care", color: "hsl(var(--kf-accent1))", icon: AlertCircle },
  };

  const sentiment = data.sentiment ? sentimentConfig[data.sentiment] : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
          Conversation Context
        </h3>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${isLoading ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Sparkles className="w-5 h-5 animate-pulse" />
            <span className="text-sm">Analyzing conversations...</span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {data.lastDiscussed && (
            <div className="p-3 rounded-xl bg-muted/30 space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Last discussed</div>
              <p className="text-sm">{data.lastDiscussed}</p>
            </div>
          )}

          {data.concerns && data.concerns.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-1">
              <div className="text-xs font-medium text-amber-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Their concerns
              </div>
              <ul className="text-sm space-y-0.5">
                {data.concerns.map((concern, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-amber-400">•</span>
                    {concern}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.preferences && data.preferences.length > 0 && (
            <div className="p-3 rounded-xl bg-[hsl(var(--kf-accent2))]/10 border border-[hsl(var(--kf-accent2))]/20 space-y-1">
              <div className="text-xs font-medium text-[hsl(var(--kf-accent2))] flex items-center gap-1">
                <Heart className="w-3 h-3" />
                Their preferences
              </div>
              <ul className="text-sm space-y-0.5">
                {data.preferences.map((pref, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-[hsl(var(--kf-accent2))]">•</span>
                    {pref}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {data.decisionMaker && (
              <div className="p-3 rounded-xl bg-muted/30">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="w-3 h-3" />
                  Decision maker
                </div>
                <p className="text-sm font-medium mt-1">{data.decisionMaker}</p>
              </div>
            )}

            {data.budgetRange && (
              <div className="p-3 rounded-xl bg-muted/30">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <DollarSign className="w-3 h-3" />
                  Budget range
                </div>
                <p className="text-sm font-medium mt-1">
                  TTD {data.budgetRange.min.toLocaleString()} - {data.budgetRange.max.toLocaleString()}
                </p>
              </div>
            )}
          </div>

          {sentiment && (
            <div className="flex items-center gap-3">
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium"
                style={{ background: `${sentiment.color}20`, color: sentiment.color }}
              >
                <sentiment.icon className="w-3 h-3" />
                {sentiment.label} sentiment
              </div>
              {data.engagementLevel && (
                <div className="text-xs text-muted-foreground">
                  Engagement: <span className="font-medium capitalize">{data.engagementLevel}</span>
                </div>
              )}
            </div>
          )}

          {data.suggestedOpening && (
            <div className="p-4 rounded-xl bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/30 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[hsl(var(--kf-accent1))] flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  Suggested opening line
                </div>
                <button
                  onClick={copyOpening}
                  className="p-1.5 rounded-lg hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
                  ) : (
                    <Copy className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                  )}
                </button>
              </div>
              <p className="text-sm italic">&quot;{data.suggestedOpening}&quot;</p>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
